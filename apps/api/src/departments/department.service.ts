import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { DepartmentResponse } from '@bizchat/types';
import type {
  CreateDepartmentInput,
  UpdateAgentDepartmentsInput,
  UpdateDepartmentInput,
} from '@bizchat/validation';
import type { AuthContext } from '../common/http.types';
import { PrismaService } from '../database/prisma.service';
import {
  CONVERSATION_CAPACITY_RELEASED_EVENT,
  type ConversationCapacityReleasedApplicationEvent,
} from '../routing/routing-events';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class DepartmentService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly audit: AuditService,
  ) {}

  public async list(auth: AuthContext): Promise<DepartmentResponse[]> {
    const departments = await this.prisma.department.findMany({
      where: { businessId: auth.business.id },
      include: {
        agents: { select: { agentProfileId: true } },
        _count: {
          select: {
            conversations: {
              where: {
                status: { in: ['ASSIGNED', 'ACTIVE', 'WAITING_FOR_CUSTOMER', 'WAITING_FOR_AGENT'] },
              },
            },
            queueEntries: { where: { assignedAt: null, removedAt: null } },
          },
        },
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return departments.map((department) => this.serialize(department));
  }

  public async create(
    auth: AuthContext,
    input: CreateDepartmentInput,
    requestId: string,
    ipAddress?: string,
  ): Promise<DepartmentResponse> {
    try {
      const department = await this.prisma.$transaction(async (transaction) => {
        if (input.isDefault)
          await transaction.department.updateMany({
            where: { businessId: auth.business.id, isDefault: true },
            data: { isDefault: false },
          });
        const profile = await transaction.agentProfile.findUnique({
          where: { membershipId: auth.membership.id },
        });
        return transaction.department.create({
          data: {
            businessId: auth.business.id,
            publicId: `dept_${randomBytes(18).toString('base64url')}`,
            name: input.name,
            description: input.description,
            isDefault: input.isDefault ?? false,
            ...(profile
              ? { agents: { create: { businessId: auth.business.id, agentProfileId: profile.id } } }
              : {}),
          },
          include: {
            agents: { select: { agentProfileId: true } },
            _count: { select: { conversations: true, queueEntries: true } },
          },
        });
      });
      await this.audit.record({
        businessId: auth.business.id,
        actorUserId: auth.user.id,
        action: 'department.created',
        targetType: 'Department',
        targetId: department.id,
        requestId,
        ipAddress,
        metadata: input,
      });
      return this.serialize(department);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: 'DEPARTMENT_EXISTS',
          message: 'A department with this name already exists',
        });
      }
      throw error;
    }
  }

  public async update(
    auth: AuthContext,
    id: string,
    input: UpdateDepartmentInput,
    requestId: string,
    ipAddress?: string,
  ): Promise<DepartmentResponse> {
    await this.find(auth.business.id, id);
    const department = await this.prisma.$transaction(async (transaction) => {
      if (input.isDefault)
        await transaction.department.updateMany({
          where: { businessId: auth.business.id, id: { not: id }, isDefault: true },
          data: { isDefault: false },
        });
      return transaction.department.update({
        where: { id, businessId: auth.business.id },
        data: input,
        include: {
          agents: { select: { agentProfileId: true } },
          _count: {
            select: {
              conversations: {
                where: {
                  status: {
                    in: ['ASSIGNED', 'ACTIVE', 'WAITING_FOR_CUSTOMER', 'WAITING_FOR_AGENT'],
                  },
                },
              },
              queueEntries: { where: { assignedAt: null, removedAt: null } },
            },
          },
        },
      });
    });
    await this.audit.record({
      businessId: auth.business.id,
      actorUserId: auth.user.id,
      action: 'department.updated',
      targetType: 'Department',
      targetId: department.id,
      requestId,
      ipAddress,
      metadata: input,
    });
    return this.serialize(department);
  }

  public async setMine(
    auth: AuthContext,
    input: UpdateAgentDepartmentsInput,
    requestId: string,
    ipAddress?: string,
  ): Promise<{ departmentIds: string[] }> {
    const profile = await this.prisma.agentProfile.upsert({
      where: { membershipId: auth.membership.id },
      update: {},
      create: {
        businessId: auth.business.id,
        userId: auth.user.id,
        membershipId: auth.membership.id,
      },
    });
    const valid = await this.prisma.department.findMany({
      where: { businessId: auth.business.id, id: { in: input.departmentIds }, status: 'ACTIVE' },
      select: { id: true },
    });
    if (valid.length !== new Set(input.departmentIds).size)
      throw new NotFoundException({
        code: 'DEPARTMENT_NOT_FOUND',
        message: 'One or more departments do not exist',
      });
    await this.prisma.$transaction(async (transaction) => {
      await transaction.agentDepartment.deleteMany({
        where: { businessId: auth.business.id, agentProfileId: profile.id },
      });
      if (valid.length)
        await transaction.agentDepartment.createMany({
          data: valid.map(({ id }) => ({
            businessId: auth.business.id,
            agentProfileId: profile.id,
            departmentId: id,
          })),
        });
    });
    this.events.emit(CONVERSATION_CAPACITY_RELEASED_EVENT, {
      businessId: auth.business.id,
      agentMembershipId: auth.membership.id,
      conversationId: 'department-membership-change',
    } satisfies ConversationCapacityReleasedApplicationEvent);
    await this.audit.record({
      businessId: auth.business.id,
      actorUserId: auth.user.id,
      action: 'user.departments_updated',
      targetType: 'BusinessMembership',
      targetId: auth.membership.id,
      requestId,
      ipAddress,
      metadata: { departmentIds: valid.map(({ id }) => id) },
    });
    return { departmentIds: valid.map(({ id }) => id) };
  }

  private async find(businessId: string, id: string): Promise<void> {
    const department = await this.prisma.department.findFirst({
      where: { id, businessId },
      select: { id: true },
    });
    if (!department)
      throw new NotFoundException({
        code: 'DEPARTMENT_NOT_FOUND',
        message: 'Department not found',
      });
  }

  private serialize(department: {
    id: string;
    publicId: string;
    name: string;
    description: string | null;
    status: 'ACTIVE' | 'DISABLED';
    isDefault: boolean;
    createdAt: Date;
    updatedAt: Date;
    agents: { agentProfileId: string }[];
    _count: { conversations: number; queueEntries: number };
  }): DepartmentResponse {
    return {
      id: department.id,
      publicId: department.publicId,
      name: department.name,
      description: department.description,
      status: department.status,
      isDefault: department.isDefault,
      agentProfileIds: department.agents.map(({ agentProfileId }) => agentProfileId),
      activeConversations: department._count.conversations,
      queuedConversations: department._count.queueEntries,
      createdAt: department.createdAt.toISOString(),
      updatedAt: department.updatedAt.toISOString(),
    };
  }
}
