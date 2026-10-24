import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hash } from 'argon2';
import type { BusinessUserResponse } from '@bizchat/types';
import type { CreateBusinessUserInput, UpdateBusinessUserInput } from '@bizchat/validation';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/http.types';
import { PrismaService } from '../database/prisma.service';

const agentProfileInclude = {
  departments: { select: { departmentId: true } },
  skills: { select: { skillId: true, proficiency: true }, orderBy: { createdAt: 'asc' } },
} as const;

@Injectable()
export class BusinessUsersService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  public async list(businessId: string): Promise<BusinessUserResponse[]> {
    const memberships = await this.prisma.businessMembership.findMany({
      where: { businessId },
      include: {
        user: true,
        agentProfile: { include: agentProfileInclude },
      },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((membership) => this.serialize(membership));
  }

  public async create(
    auth: AuthContext,
    input: CreateBusinessUserInput,
    requestId: string,
    ipAddress?: string,
  ): Promise<BusinessUserResponse> {
    await this.validateDepartments(auth.business.id, input.departmentIds);
    const passwordHash = await hash(input.password, { type: 2 });
    try {
      const membership = await this.prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: { email: input.email, displayName: input.displayName, passwordHash },
        });
        const created = await transaction.businessMembership.create({
          data: { businessId: auth.business.id, userId: user.id, role: input.role },
        });
        await transaction.agentProfile.create({
          data: {
            businessId: auth.business.id,
            userId: user.id,
            membershipId: created.id,
            departments: {
              create: input.departmentIds.map((departmentId) => ({
                businessId: auth.business.id,
                departmentId,
              })),
            },
          },
        });
        return transaction.businessMembership.findUniqueOrThrow({
          where: { id: created.id },
          include: {
            user: true,
            agentProfile: { include: agentProfileInclude },
          },
        });
      });
      await this.audit.record({
        businessId: auth.business.id,
        actorUserId: auth.user.id,
        action: 'user.created',
        targetType: 'BusinessMembership',
        targetId: membership.id,
        requestId,
        ipAddress,
        metadata: { email: input.email, role: input.role, departmentIds: input.departmentIds },
      });
      return this.serialize(membership);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException({
          code: 'USER_EXISTS',
          message: 'An account with this email already exists',
        });
      throw error;
    }
  }

  public async update(
    auth: AuthContext,
    membershipId: string,
    input: UpdateBusinessUserInput,
    requestId: string,
    ipAddress?: string,
  ): Promise<BusinessUserResponse> {
    const existing = await this.prisma.businessMembership.findFirst({
      where: { id: membershipId, businessId: auth.business.id },
      include: { agentProfile: true },
    });
    if (!existing || !existing.agentProfile)
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'Business user not found' });
    if (auth.membership.role !== 'OWNER' && (existing.role === 'OWNER' || input.role === 'OWNER'))
      throw new ForbiddenException({
        code: 'OWNER_MANAGEMENT_FORBIDDEN',
        message: 'Only an owner can change an owner account',
      });
    if (input.status === 'DISABLED' && membershipId === auth.membership.id)
      throw new ConflictException({
        code: 'SELF_DISABLE_FORBIDDEN',
        message: 'You cannot disable your own membership',
      });
    if (
      existing.role === 'OWNER' &&
      ((input.role && input.role !== 'OWNER') || input.status === 'DISABLED')
    ) {
      const ownerCount = await this.prisma.businessMembership.count({
        where: { businessId: auth.business.id, role: 'OWNER', status: 'ACTIVE' },
      });
      if (ownerCount <= 1)
        throw new ConflictException({
          code: 'LAST_OWNER_REQUIRED',
          message: 'The business must retain an active owner',
        });
    }
    if (input.departmentIds) await this.validateDepartments(auth.business.id, input.departmentIds);
    if (input.skills) await this.validateSkills(auth.business.id, input.skills);
    const updated = await this.prisma.$transaction(async (transaction) => {
      if (input.displayName)
        await transaction.user.update({
          where: { id: existing.userId },
          data: { displayName: input.displayName },
        });
      await transaction.businessMembership.update({
        where: { id: existing.id },
        data: { role: input.role, status: input.status },
      });
      await transaction.agentProfile.update({
        where: { id: existing.agentProfile!.id },
        data: {
          maxConcurrentChats: input.maxConcurrentChats,
          routingEnabled: input.routingEnabled,
          status:
            input.status === 'DISABLED'
              ? 'DISABLED'
              : input.status === 'ACTIVE'
                ? 'ACTIVE'
                : undefined,
        },
      });
      if (input.departmentIds) {
        await transaction.agentDepartment.deleteMany({
          where: { businessId: auth.business.id, agentProfileId: existing.agentProfile!.id },
        });
        if (input.departmentIds.length)
          await transaction.agentDepartment.createMany({
            data: input.departmentIds.map((departmentId) => ({
              businessId: auth.business.id,
              agentProfileId: existing.agentProfile!.id,
              departmentId,
            })),
          });
      }
      if (input.skills) {
        await transaction.agentSkill.deleteMany({
          where: { businessId: auth.business.id, agentProfileId: existing.agentProfile!.id },
        });
        if (input.skills.length)
          await transaction.agentSkill.createMany({
            data: input.skills.map(({ skillId, proficiency }) => ({
              businessId: auth.business.id,
              agentProfileId: existing.agentProfile!.id,
              skillId,
              proficiency,
            })),
          });
      }
      if (input.status === 'DISABLED')
        await transaction.session.updateMany({
          where: { membershipId: existing.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      return transaction.businessMembership.findUniqueOrThrow({
        where: { id: existing.id },
        include: {
          user: true,
          agentProfile: { include: agentProfileInclude },
        },
      });
    });
    await this.audit.record({
      businessId: auth.business.id,
      actorUserId: auth.user.id,
      action: 'user.updated',
      targetType: 'BusinessMembership',
      targetId: membershipId,
      requestId,
      ipAddress,
      metadata: input,
    });
    return this.serialize(updated);
  }

  private async validateDepartments(businessId: string, departmentIds: string[]): Promise<void> {
    if (!departmentIds.length) return;
    const count = await this.prisma.department.count({
      where: { businessId, id: { in: [...new Set(departmentIds)] }, status: 'ACTIVE' },
    });
    if (count !== new Set(departmentIds).size)
      throw new NotFoundException({
        code: 'DEPARTMENT_NOT_FOUND',
        message: 'One or more departments do not exist',
      });
  }

  private async validateSkills(businessId: string, skills: { skillId: string }[]): Promise<void> {
    if (!skills.length) return;
    const count = await this.prisma.skill.count({
      where: { businessId, id: { in: skills.map(({ skillId }) => skillId) }, status: 'ACTIVE' },
    });
    if (count !== skills.length)
      throw new NotFoundException({
        code: 'SKILL_NOT_FOUND',
        message: 'One or more skills do not exist',
      });
  }

  private serialize(membership: {
    id: string;
    userId: string;
    role: 'OWNER' | 'ADMIN' | 'SUPERVISOR' | 'CONSULTANT';
    status: 'ACTIVE' | 'INVITED' | 'DISABLED';
    createdAt: Date;
    user: { email: string; displayName: string; lastLoginAt: Date | null };
    agentProfile: {
      id: string;
      maxConcurrentChats: number;
      routingEnabled: boolean;
      departments: { departmentId: string }[];
      skills: { skillId: string; proficiency: number }[];
    } | null;
  }): BusinessUserResponse {
    if (!membership.agentProfile)
      throw new Error('Business membership is missing an agent profile');
    return {
      membershipId: membership.id,
      userId: membership.userId,
      email: membership.user.email,
      displayName: membership.user.displayName,
      role: membership.role,
      status: membership.status,
      lastLoginAt: membership.user.lastLoginAt?.toISOString() ?? null,
      agentProfileId: membership.agentProfile.id,
      maxConcurrentChats: membership.agentProfile.maxConcurrentChats,
      routingEnabled: membership.agentProfile.routingEnabled,
      departmentIds: membership.agentProfile.departments.map(({ departmentId }) => departmentId),
      skills: membership.agentProfile.skills.map(({ skillId, proficiency }) => ({
        skillId,
        proficiency,
      })),
      createdAt: membership.createdAt.toISOString(),
    };
  }
}
