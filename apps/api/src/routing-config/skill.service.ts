import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { SkillResponse } from '@bizchat/types';
import type { CreateSkillInput, UpdateSkillInput } from '@bizchat/validation';
import { AuditService, auditActor } from '../audit/audit.service';
import type { AuthContext } from '../common/http.types';
import { PrismaService } from '../database/prisma.service';

const skillInclude = { _count: { select: { agents: true } } } as const;

@Injectable()
export class SkillService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  public async list(auth: AuthContext): Promise<SkillResponse[]> {
    const skills = await this.prisma.skill.findMany({
      where: { businessId: auth.business.id },
      include: skillInclude,
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    return skills.map(serializeSkill);
  }

  public async create(
    auth: AuthContext,
    input: CreateSkillInput,
    requestId: string,
    ipAddress?: string,
  ): Promise<SkillResponse> {
    const skill = await this.unique(() =>
      this.prisma.skill.create({
        data: { businessId: auth.business.id, ...input },
        include: skillInclude,
      }),
    );
    await this.audit.record({
      businessId: auth.business.id,
      ...auditActor(auth),
      action: 'skill.created',
      targetType: 'Skill',
      targetId: skill.id,
      requestId,
      ipAddress,
      metadata: input,
    });
    return serializeSkill(skill);
  }

  public async update(
    auth: AuthContext,
    id: string,
    input: UpdateSkillInput,
    requestId: string,
    ipAddress?: string,
  ): Promise<SkillResponse> {
    const existing = await this.prisma.skill.findFirst({
      where: { id, businessId: auth.business.id },
      select: { id: true },
    });
    if (!existing)
      throw new NotFoundException({ code: 'SKILL_NOT_FOUND', message: 'Skill not found' });
    const skill = await this.unique(() =>
      this.prisma.skill.update({ where: { id }, data: input, include: skillInclude }),
    );
    await this.audit.record({
      businessId: auth.business.id,
      ...auditActor(auth),
      action: 'skill.updated',
      targetType: 'Skill',
      targetId: skill.id,
      requestId,
      ipAddress,
      metadata: input,
    });
    return serializeSkill(skill);
  }

  private async unique<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException({
          code: 'SKILL_EXISTS',
          message: 'A skill with this name already exists',
        });
      throw error;
    }
  }
}

function serializeSkill(skill: {
  id: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'DISABLED';
  createdAt: Date;
  updatedAt: Date;
  _count: { agents: number };
}): SkillResponse {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    status: skill.status,
    consultantCount: skill._count.agents,
    createdAt: skill.createdAt.toISOString(),
    updatedAt: skill.updatedAt.toISOString(),
  };
}
