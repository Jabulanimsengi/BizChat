import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma, Conversation } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { MessageService } from '../conversations/message.service';
import { ConversationTimelineService } from '../conversations/conversation-timeline.service';
import { serializeConversation, serializeMessage } from '../conversations/conversation-serializer';
import {
  CONVERSATION_CREATED_EVENT,
  CONVERSATION_OPERATION_EVENT,
  MESSAGE_CREATED_EVENT,
} from '../conversations/conversation-events';
import { CONVERSATION_CAPACITY_RELEASED_EVENT } from '../routing/routing-events';
import { classificationRecord, TopicCatalogService } from '../intake/topic-catalog.service';
import { IntakeFormService } from '../intake/intake-form.service';
import { CustomerIdentityService } from './customer-identity.service';
import {
  idempotencySchema,
  type IntegrationPrincipal,
  type PageInput,
  type HistoryInput,
  type StartInput,
  type SendInput,
  type ResolveInput,
} from './integration.contracts';

export function requestFingerprint(operation: string, input: object): string {
  return createHash('sha256')
    .update(JSON.stringify([operation, input]))
    .digest('hex');
}
function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
function publicConversation(row: Conversation): object {
  return {
    id: row.id,
    status: row.status,
    source: row.source,
    subject: row.subject,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class IntegrationService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessageService,
    private readonly timeline: ConversationTimelineService,
    private readonly customers: CustomerIdentityService,
    private readonly events: EventEmitter2,
    private readonly topics: TopicCatalogService,
    private readonly forms: IntakeFormService,
  ) {}

  public async list(principal: IntegrationPrincipal, query: PageInput): Promise<object> {
    const rows = await this.prisma.conversation.findMany({
      where: {
        businessId: principal.businessId,
        ...(query.cursor ? { id: { gt: query.cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: query.limit + 1,
    });
    return {
      conversations: rows.slice(0, query.limit).map(publicConversation),
      nextCursor: rows.length > query.limit ? rows[query.limit - 1]!.id : null,
    };
  }

  public async get(principal: IntegrationPrincipal, id: string): Promise<object> {
    const conversation = publicConversation(await this.find(this.prisma, principal.businessId, id));
    // Pre-chat answers are personal information and need the separate intake:read scope.
    return principal.scopes.includes('intake:read')
      ? { ...conversation, intake: await this.forms.forConversation(id) }
      : conversation;
  }

  public async history(
    principal: IntegrationPrincipal,
    id: string,
    query: HistoryInput,
  ): Promise<object> {
    await this.find(this.prisma, principal.businessId, id);
    const rows = await this.prisma.message.findMany({
      where: {
        businessId: principal.businessId,
        conversationId: id,
        messageType: { not: 'INTERNAL_NOTE' },
        deletedAt: null,
        sequenceNumber: { gt: BigInt(query.afterSequence) },
      },
      orderBy: { sequenceNumber: 'asc' },
      take: query.limit + 1,
    });
    const selected = rows.slice(0, query.limit).map((row) => ({
      id: row.id,
      conversationId: id,
      sequenceNumber: row.sequenceNumber.toString(),
      senderType: row.senderType,
      integrationKeyId: row.integrationKeyId,
      messageType: row.messageType,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
    }));
    return {
      messages: selected,
      hasMore: rows.length > query.limit,
      nextSequence: selected.at(-1)?.sequenceNumber ?? query.afterSequence,
    };
  }

  public async start(
    principal: IntegrationPrincipal,
    key: string | undefined,
    input: StartInput,
  ): Promise<Prisma.InputJsonValue> {
    return this.write(principal, key, 'conversation.create', input, async (tx, publish) => {
      const visitorId = await this.customers.customer(tx, principal.businessId, input.externalId);
      // No visitor can answer a prompt here, so an uncertain classification takes the default topic.
      const intake = input.departmentPublicId
        ? null
        : await this.topics.decide(
            principal.businessId,
            [input.subject, input.content].filter(Boolean).join('\n'),
            {
              ...(input.topicPublicId ? { topicPublicId: input.topicPublicId } : {}),
              explicitMethod: 'INTEGRATION',
              canAsk: false,
            },
          );
      const department = await tx.department.findFirst({
        where: {
          businessId: principal.businessId,
          status: 'ACTIVE',
          ...(input.departmentPublicId
            ? { publicId: input.departmentPublicId }
            : intake?.routing.departmentId
              ? { id: intake.routing.departmentId }
              : { isDefault: true }),
        },
      });
      if (input.departmentPublicId && !department)
        throw new NotFoundException({
          code: 'DEPARTMENT_NOT_FOUND',
          message: 'Department not found',
        });
      const conversation = await tx.conversation.create({
        data: {
          businessId: principal.businessId,
          visitorId,
          source: 'INTEGRATION',
          subject: input.subject,
          departmentId: department?.id,
          ...(intake
            ? {
                topicId: intake.routing.topicId,
                priority: intake.routing.priority,
                requiredSkillId: intake.routing.requiredSkillId,
                requiredSkillMinProficiency: intake.routing.requiredSkillMinProficiency,
                intakeStatus: intake.intakeStatus,
              }
            : {}),
          participants: {
            create: {
              businessId: principal.businessId,
              participantType: 'VISITOR',
              participantId: visitorId,
            },
          },
        },
      });
      await this.timeline.recordInTransaction(tx, {
        businessId: principal.businessId,
        conversationId: conversation.id,
        type: 'CREATED',
        actorType: 'INTEGRATION',
        actorId: principal.keyId,
      });
      if (intake)
        await tx.conversationClassification.create({
          data: classificationRecord(principal.businessId, conversation.id, intake),
        });
      // Answers are optional over the API (no visitor to ask), but must be valid when sent.
      if (input.intake) {
        const form =
          (await this.forms.beforeChatForm(principal.businessId)) ??
          (await this.forms.afterTopicForm(principal.businessId, intake?.routing.topicId ?? null));
        if (form)
          await this.forms.record(
            tx,
            principal.businessId,
            conversation.id,
            form,
            this.forms.validate(form, input.intake, await this.forms.prefill(form, visitorId)),
            input.intake.consent ?? false,
          );
      }
      const result = await this.messages.createInTransaction(tx, {
        businessId: principal.businessId,
        conversationId: conversation.id,
        senderType: 'VISITOR',
        senderVisitorId: visitorId,
        integrationKeyId: principal.keyId,
        clientMessageId: randomUUID(),
        content: input.content,
      });
      publish.push(() => {
        this.events.emit(CONVERSATION_CREATED_EVENT, {
          businessId: principal.businessId,
          visitorId,
          conversation: serializeConversation(conversation),
        });
        this.events.emit(MESSAGE_CREATED_EVENT, {
          businessId: principal.businessId,
          visitorId,
          message: serializeMessage(result.message),
        });
      });
      return json({
        conversation: publicConversation(conversation),
        message: serializeMessage(result.message),
      });
    });
  }

  public async send(
    principal: IntegrationPrincipal,
    id: string,
    key: string | undefined,
    input: SendInput,
  ): Promise<Prisma.InputJsonValue> {
    return this.write(principal, key, `message.create:${id}`, input, async (tx, publish) => {
      const row = await this.lock(tx, principal.businessId, id);
      if (['CLOSED', 'RESOLVED'].includes(row.status))
        throw new ConflictException({
          code: 'CONVERSATION_NOT_OPEN',
          message: 'Cannot send to a resolved or closed conversation',
        });
      const result = await this.messages.createInTransaction(tx, {
        businessId: principal.businessId,
        conversationId: id,
        senderType: 'INTEGRATION',
        integrationKeyId: principal.keyId,
        clientMessageId: randomUUID(),
        content: input.content,
      });
      publish.push(() => {
        this.events.emit(MESSAGE_CREATED_EVENT, {
          businessId: principal.businessId,
          visitorId: row.visitorId,
          message: serializeMessage(result.message),
        });
      });
      return json(serializeMessage(result.message));
    });
  }

  public async resolve(
    principal: IntegrationPrincipal,
    id: string,
    key: string | undefined,
    input: ResolveInput,
  ): Promise<Prisma.InputJsonValue> {
    return this.write(principal, key, `conversation.resolve:${id}`, input, async (tx, publish) => {
      const row = await this.lock(tx, principal.businessId, id);
      if (row.status === 'CLOSED')
        throw new ConflictException({
          code: 'CONVERSATION_CLOSED',
          message: 'Conversation is closed',
        });
      if (row.status === 'RESOLVED') return json(publicConversation(row));
      const now = new Date();
      const updated = await tx.conversation.update({
        where: { id },
        data: {
          status: 'RESOLVED',
          resolvedAt: now,
          agentDisconnectedAt: null,
          reassignmentDueAt: null,
        },
      });
      await tx.conversationAssignment.updateMany({
        where: { businessId: principal.businessId, conversationId: id, releasedAt: null },
        data: { releasedAt: now, reason: input.reason ?? 'Resolved by integration' },
      });
      await tx.conversationQueueEntry.updateMany({
        where: { businessId: principal.businessId, conversationId: id, removedAt: null },
        data: { removedAt: now },
      });
      const outcome = await this.timeline.recordInTransaction(tx, {
        businessId: principal.businessId,
        conversationId: id,
        type: 'RESOLVED',
        actorType: 'INTEGRATION',
        actorId: principal.keyId,
        metadata: { reason: input.reason ?? null },
        systemMessage: 'Conversation marked resolved.',
      });
      publish.push(() => {
        if (outcome.message)
          this.events.emit(MESSAGE_CREATED_EVENT, {
            businessId: principal.businessId,
            visitorId: row.visitorId,
            message: serializeMessage(outcome.message),
          });
        this.events.emit(CONVERSATION_OPERATION_EVENT, {
          businessId: principal.businessId,
          visitorId: row.visitorId,
          conversation: serializeConversation(updated),
          event: this.timeline.serialize(outcome.event),
          operation: 'RESOLVED',
          previousAssignedAgentMembershipId: row.assignedAgentMembershipId,
          assignedAgentMembershipId: row.assignedAgentMembershipId,
        });
        this.events.emit(CONVERSATION_CAPACITY_RELEASED_EVENT, {
          businessId: principal.businessId,
          conversationId: id,
          agentMembershipId: row.assignedAgentMembershipId,
        });
      });
      return json(publicConversation(updated));
    });
  }

  private async write(
    principal: IntegrationPrincipal,
    key: string | undefined,
    operation: string,
    input: object,
    action: (
      tx: Prisma.TransactionClient,
      publish: (() => void)[],
    ) => Promise<Prisma.InputJsonValue>,
  ): Promise<Prisma.InputJsonValue> {
    if (!idempotencySchema.safeParse(key).success)
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'Supply an Idempotency-Key of 8-128 letters, digits, or _.:-',
      });
    const fingerprint = requestFingerprint(operation, input);
    const publish: (() => void)[] = [];
    const response = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`integration-request:${principal.businessId}:${key}`}, 0)) IS NULL AS acquired`;
      const existing = await tx.integrationRequest.findUnique({
        where: { businessId_key: { businessId: principal.businessId, key: key! } },
      });
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new ConflictException({
            code: 'IDEMPOTENCY_CONFLICT',
            message: 'This key was already used for a different request',
          });
        return existing.response as Prisma.InputJsonValue;
      }
      const result = await action(tx, publish);
      await tx.integrationRequest.create({
        data: { businessId: principal.businessId, key: key!, fingerprint, response: result },
      });
      await tx.auditLog.create({
        data: {
          businessId: principal.businessId,
          action: `integration.${operation.split(':')[0]}`,
          targetType: 'IntegrationKey',
          targetId: principal.keyId,
        },
      });
      return result;
    });
    for (const emit of publish) emit();
    return response;
  }

  private async find(
    tx: Prisma.TransactionClient,
    businessId: string,
    id: string,
  ): Promise<Conversation> {
    const row = await tx.conversation.findFirst({ where: { id, businessId } });
    if (!row)
      throw new NotFoundException({
        code: 'CONVERSATION_NOT_FOUND',
        message: 'Conversation not found',
      });
    return row;
  }
  private async lock(
    tx: Prisma.TransactionClient,
    businessId: string,
    id: string,
  ): Promise<Conversation> {
    // Same operation lock as transfers/resolution; row lock also serializes routing updates.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`conversation-operation:${businessId}:${id}`}, 0)) IS NULL AS acquired`;
    await tx.$queryRaw`SELECT id FROM conversations WHERE id = ${id}::uuid AND "businessId" = ${businessId}::uuid FOR UPDATE`;
    return this.find(tx, businessId, id);
  }
}
