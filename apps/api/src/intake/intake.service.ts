import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ClassificationMethod, Conversation, Prisma } from '@prisma/client';
import type { ConversationRoutingEvent, IntakePrompt } from '@bizchat/types';
import type { IntakeSubmitInput } from '@bizchat/validation';
import { ConversationTimelineService } from '../conversations/conversation-timeline.service';
import { PrismaService } from '../database/prisma.service';
import { ConversationRoutingService } from '../routing/conversation-routing.service';
import {
  classificationRecord,
  TopicCatalogService,
  topicRouting,
  widgetTopic,
  type CatalogTopic,
  type IntakeDecision,
} from './topic-catalog.service';

const EXPIRY_BATCH_SIZE = 200;

interface VisitorIdentity {
  businessId: string;
  visitorId: string;
}

/**
 * Topic intake after the first message: the visitor's own choice, a later change of topic while the
 * chat still waits for a consultant, and the fallback to the default topic when a prompt goes
 * unanswered.
 */
@Injectable()
export class IntakeService {
  private readonly logger = new Logger(IntakeService.name);

  public constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: TopicCatalogService,
    private readonly routing: ConversationRoutingService,
    private readonly timeline: ConversationTimelineService,
  ) {}

  /** The prompt shown with a new conversation, or undefined when nothing needs the visitor. */
  public prompt(decision: IntakeDecision | null): IntakePrompt | undefined {
    if (!decision || decision.decision === 'ROUTE' || decision.method !== 'KEYWORD')
      return undefined;
    return {
      step: 'TOPIC',
      mode: decision.intakeStatus === 'AWAITING_TOPIC' ? 'ASK' : 'CONFIRM',
      topics: decision.options.map(widgetTopic),
      selectedTopic: decision.topic ? widgetTopic(decision.topic) : null,
      expiresAt: decision.intakeExpiresAt?.toISOString() ?? null,
    };
  }

  /** Re-shows an unanswered topic prompt when the visitor resumes the conversation. */
  public async pendingPrompt(conversation: Conversation): Promise<IntakePrompt | undefined> {
    if (conversation.intakeStatus !== 'AWAITING_TOPIC') return undefined;
    const topics = (await this.catalog.quickReplies(conversation.businessId)).slice(0, 3);
    return {
      step: 'TOPIC',
      mode: 'ASK',
      topics,
      selectedTopic: null,
      expiresAt: conversation.intakeExpiresAt?.toISOString() ?? null,
    };
  }

  /**
   * Applies the visitor's choice (`null` = "Something else", the default topic). Allowed while the
   * prompt is open, or as a change while the conversation still waits unassigned.
   */
  public async submit(
    identity: VisitorIdentity,
    input: IntakeSubmitInput,
  ): Promise<ConversationRoutingEvent> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: input.conversationId,
        businessId: identity.businessId,
        visitorId: identity.visitorId,
      },
      select: { id: true },
    });
    if (!conversation)
      throw new NotFoundException({
        code: 'CONVERSATION_NOT_FOUND',
        message: 'Conversation not found',
      });
    const topic = await this.catalog.findActive(identity.businessId, input.topicPublicId);
    const applied = await this.apply(identity.businessId, input.conversationId, topic, {
      method: 'VISITOR_CHOICE',
      actorType: 'VISITOR',
      actorId: identity.visitorId,
      onlyWhileAwaiting: false,
    });
    if (!applied)
      throw new ConflictException({
        code: 'TOPIC_LOCKED',
        message: 'A consultant is already handling this conversation',
      });
    return this.routing.routeConversation(identity.businessId, input.conversationId);
  }

  /** Reliability-sweep step: unanswered prompts take the default topic and route. */
  public async expirePrompts(now = new Date()): Promise<number> {
    const due = await this.prisma.conversation.findMany({
      where: { intakeStatus: 'AWAITING_TOPIC', intakeExpiresAt: { lte: now } },
      orderBy: { intakeExpiresAt: 'asc' },
      take: EXPIRY_BATCH_SIZE,
      select: { id: true, businessId: true },
    });
    let expired = 0;
    for (const conversation of due) {
      try {
        const topic = await this.catalog.findActive(conversation.businessId, null);
        const applied = await this.apply(conversation.businessId, conversation.id, topic, {
          method: 'TIMEOUT',
          actorType: 'SYSTEM',
          onlyWhileAwaiting: true,
        });
        if (!applied) continue;
        expired += 1;
        await this.routing.routeConversation(conversation.businessId, conversation.id);
      } catch (error) {
        this.logger.warn(
          `Topic prompt fallback failed for ${conversation.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return expired;
  }

  private async apply(
    businessId: string,
    conversationId: string,
    topic: CatalogTopic | null,
    options: {
      method: ClassificationMethod;
      actorType: 'VISITOR' | 'SYSTEM';
      actorId?: string;
      onlyWhileAwaiting: boolean;
    },
  ): Promise<boolean> {
    const routing = topicRouting(topic);
    const departmentId = routing.departmentId ?? (await this.defaultDepartmentId(businessId));
    return this.prisma.$transaction(async (transaction) => {
      const awaiting: Prisma.ConversationWhereInput = { intakeStatus: 'AWAITING_TOPIC' };
      // A change of topic is fine until a consultant is offered or assigned the chat.
      const waiting: Prisma.ConversationWhereInput = {
        intakeStatus: { in: ['NOT_REQUIRED', 'COMPLETE'] },
        status: { in: ['NEW', 'QUEUED'] },
        assignedAgentMembershipId: null,
      };
      const changed = await transaction.conversation.updateMany({
        where: {
          id: conversationId,
          businessId,
          ...(options.onlyWhileAwaiting ? awaiting : { OR: [awaiting, waiting] }),
        },
        data: {
          topicId: routing.topicId,
          departmentId,
          priority: routing.priority,
          requiredSkillId: routing.requiredSkillId,
          requiredSkillMinProficiency: routing.requiredSkillMinProficiency,
          intakeStatus: 'COMPLETE',
          intakeExpiresAt: null,
        },
      });
      if (changed.count !== 1) return false;
      // A conversation already queued moves to the new topic's queue, keeping its wait time.
      await transaction.conversationQueueEntry.updateMany({
        where: { conversationId, assignedAt: null, removedAt: null },
        data: { departmentId, priority: routing.priority },
      });
      await transaction.conversationClassification.create({
        data: classificationRecord(businessId, conversationId, {
          topic,
          method: options.method,
          decision: 'ROUTE',
          confidence: null,
          candidates: [],
        }),
      });
      await this.timeline.recordInTransaction(transaction, {
        businessId,
        conversationId,
        type: 'TOPIC_SET',
        actorType: options.actorType,
        ...(options.actorId ? { actorId: options.actorId } : {}),
        metadata: {
          topicId: topic?.id ?? null,
          topicName: topic?.name ?? null,
          method: options.method,
        },
      });
      return true;
    });
  }

  private async defaultDepartmentId(businessId: string): Promise<string | null> {
    const department = await this.prisma.department.findFirst({
      where: { businessId, status: 'ACTIVE', isDefault: true },
      select: { id: true },
    });
    return department?.id ?? null;
  }
}
