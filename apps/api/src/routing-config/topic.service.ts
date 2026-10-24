import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Topic } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import type { TopicKeyword, TopicResponse, TopicTestResponse } from '@bizchat/types';
import type { CreateTopicInput, UpdateTopicInput } from '@bizchat/validation';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/http.types';
import { PrismaService } from '../database/prisma.service';
import { TopicCatalogService } from '../intake/topic-catalog.service';

@Injectable()
export class TopicService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly catalog: TopicCatalogService,
  ) {}

  public async list(auth: AuthContext): Promise<TopicResponse[]> {
    const topics = await this.prisma.topic.findMany({
      where: { businessId: auth.business.id },
      orderBy: [{ status: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
    return topics.map(serializeTopic);
  }

  public async create(
    auth: AuthContext,
    input: CreateTopicInput,
    requestId: string,
    ipAddress?: string,
  ): Promise<TopicResponse> {
    await this.validateReferences(auth.business.id, input);
    const topic = await this.write(auth.business.id, input.isDefault, (transaction) =>
      transaction.topic.create({
        data: {
          ...input,
          businessId: auth.business.id,
          publicId: `topic_${randomBytes(12).toString('base64url')}`,
        },
      }),
    );
    await this.record(auth, 'topic.created', topic.id, input, requestId, ipAddress);
    return serializeTopic(topic);
  }

  public async update(
    auth: AuthContext,
    id: string,
    input: UpdateTopicInput,
    requestId: string,
    ipAddress?: string,
  ): Promise<TopicResponse> {
    const existing = await this.prisma.topic.findFirst({
      where: { id, businessId: auth.business.id },
      select: { id: true },
    });
    if (!existing)
      throw new NotFoundException({ code: 'TOPIC_NOT_FOUND', message: 'Topic not found' });
    await this.validateReferences(auth.business.id, input);
    const topic = await this.write(auth.business.id, input.isDefault ?? false, (transaction) =>
      transaction.topic.update({
        where: { id },
        data: {
          ...input,
          // A disabled topic cannot stay the default, or "Something else" would route nowhere.
          ...(input.status === 'DISABLED' ? { isDefault: false } : {}),
        },
      }),
    );
    await this.record(auth, 'topic.updated', topic.id, input, requestId, ipAddress);
    return serializeTopic(topic);
  }

  public test(auth: AuthContext, message: string): Promise<TopicTestResponse> {
    return this.catalog.preview(auth.business.id, message);
  }

  /** Every topic write bumps the catalogue version so all API instances recompile the classifier. */
  private async write(
    businessId: string,
    makeDefault: boolean,
    operation: (transaction: Prisma.TransactionClient) => Promise<Topic>,
  ): Promise<Topic> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        if (makeDefault)
          await transaction.topic.updateMany({
            where: { businessId, isDefault: true },
            data: { isDefault: false },
          });
        const topic = await operation(transaction);
        await transaction.business.update({
          where: { id: businessId },
          data: { topicCatalogVersion: { increment: 1 } },
        });
        return topic;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException({
          code: 'TOPIC_EXISTS',
          message: 'A topic with this name already exists',
        });
      throw error;
    }
  }

  private async validateReferences(
    businessId: string,
    input: { departmentId?: string | null; requiredSkillId?: string | null },
  ): Promise<void> {
    if (input.departmentId) {
      const department = await this.prisma.department.count({
        where: { id: input.departmentId, businessId, status: 'ACTIVE' },
      });
      if (!department)
        throw new NotFoundException({
          code: 'DEPARTMENT_NOT_FOUND',
          message: 'The selected department does not exist',
        });
    }
    if (input.requiredSkillId) {
      const skill = await this.prisma.skill.count({
        where: { id: input.requiredSkillId, businessId, status: 'ACTIVE' },
      });
      if (!skill)
        throw new NotFoundException({
          code: 'SKILL_NOT_FOUND',
          message: 'The selected skill does not exist',
        });
    }
  }

  private record(
    auth: AuthContext,
    action: string,
    topicId: string,
    metadata: Prisma.InputJsonValue,
    requestId: string,
    ipAddress?: string,
  ): Promise<void> {
    return this.audit.record({
      businessId: auth.business.id,
      actorUserId: auth.user.id,
      action,
      targetType: 'Topic',
      targetId: topicId,
      requestId,
      ipAddress,
      metadata,
    });
  }
}

function serializeTopic(topic: Topic): TopicResponse {
  return {
    id: topic.id,
    publicId: topic.publicId,
    name: topic.name,
    description: topic.description,
    departmentId: topic.departmentId,
    requiredSkillId: topic.requiredSkillId,
    requiredSkillMinProficiency: topic.requiredSkillMinProficiency,
    priority: topic.priority,
    keywords: topic.keywords as unknown as TopicKeyword[],
    negativeKeywords: topic.negativeKeywords,
    examples: topic.examples,
    showAsQuickReply: topic.showAsQuickReply,
    isDefault: topic.isDefault,
    status: topic.status,
    sortOrder: topic.sortOrder,
    createdAt: topic.createdAt.toISOString(),
    updatedAt: topic.updatedAt.toISOString(),
  };
}
