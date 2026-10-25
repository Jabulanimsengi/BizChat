import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { ClassificationMethod, Conversation, Prisma } from '@prisma/client';
import type { IntakePrompt, IntakeSubmitResult } from '@bizchat/types';
import type { IntakeFormSubmitInput, IntakeSubmitInput } from '@bizchat/validation';
import { ConversationTimelineService } from '../conversations/conversation-timeline.service';
import { PrismaService } from '../database/prisma.service';
import { ConversationRoutingService } from '../routing/conversation-routing.service';
import { INTAKE_REQUIRED_EVENT, type IntakeRequiredApplicationEvent } from './intake-events';
import { IntakeFormService, type FormRequirement } from './intake-form.service';
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
 * Intake after the first message: the visitor's topic choice, a later change of topic while the chat
 * still waits for a consultant, the pre-chat form, and the fallback to the default topic when a
 * topic prompt goes unanswered.
 */
@Injectable()
export class IntakeService {
  private readonly logger = new Logger(IntakeService.name);

  public constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: TopicCatalogService,
    private readonly forms: IntakeFormService,
    private readonly routing: ConversationRoutingService,
    private readonly timeline: ConversationTimelineService,
    private readonly events: EventEmitter2,
  ) {}

  /** The topic prompt shown with a new conversation, or undefined when nothing needs the visitor. */
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

  /** Re-shows an unanswered topic prompt or pending form when the visitor resumes. */
  public async pendingPrompt(conversation: Conversation): Promise<IntakePrompt | undefined> {
    if (conversation.intakeStatus === 'AWAITING_TOPIC') {
      const topics = (await this.catalog.quickReplies(conversation.businessId)).slice(0, 3);
      return {
        step: 'TOPIC',
        mode: 'ASK',
        topics,
        selectedTopic: null,
        expiresAt: conversation.intakeExpiresAt?.toISOString() ?? null,
      };
    }
    if (conversation.intakeStatus !== 'AWAITING_FORM') return undefined;
    const requirement = await this.forms.requirement(
      conversation.businessId,
      conversation.topicId,
      conversation.visitorId,
    );
    return requirement ? this.formPrompt(requirement) : undefined;
  }

  public formPrompt(requirement: FormRequirement): IntakePrompt {
    return {
      step: 'FORM',
      mode: 'ASK',
      topics: [],
      selectedTopic: null,
      expiresAt: null,
      form: this.forms.widgetForm(requirement.form, requirement.prefill),
    };
  }

  /**
   * Applies the visitor's choice (`null` = "Something else", the default topic). Allowed while the
   * prompt is open, or as a change while the conversation still waits unassigned. A topic with a
   * pre-chat form moves to the form step instead of routing.
   */
  public async submit(
    identity: VisitorIdentity,
    input: IntakeSubmitInput,
  ): Promise<IntakeSubmitResult> {
    await this.owned(identity, input.conversationId);
    const topic = await this.catalog.findActive(identity.businessId, input.topicPublicId);
    const requirement = await this.requirementFor(
      identity.businessId,
      input.conversationId,
      topic,
      identity.visitorId,
    );
    const applied = await this.apply(
      identity.businessId,
      input.conversationId,
      topic,
      requirement,
      {
        method: 'VISITOR_CHOICE',
        actorType: 'VISITOR',
        actorId: identity.visitorId,
        onlyWhileAwaiting: false,
      },
    );
    if (!applied)
      throw new ConflictException({
        code: 'TOPIC_LOCKED',
        message: 'A consultant is already handling this conversation',
      });
    if (requirement && !requirement.autoAnswers)
      return { routed: null, intake: this.formPrompt(requirement) };
    return {
      routed: await this.routing.routeConversation(identity.businessId, input.conversationId),
      intake: null,
    };
  }

  /** Stores the pre-chat form answers and routes the conversation. */
  public async submitForm(
    identity: VisitorIdentity,
    input: IntakeFormSubmitInput,
  ): Promise<IntakeSubmitResult> {
    const conversation = await this.owned(identity, input.conversationId);
    if (conversation.intakeStatus !== 'AWAITING_FORM')
      throw new ConflictException({
        code: 'INTAKE_NOT_PENDING',
        message: 'This conversation is not waiting for a form',
      });
    const requirement = await this.forms.requirement(
      identity.businessId,
      conversation.topicId,
      identity.visitorId,
    );
    const answers = requirement
      ? this.forms.validate(requirement.form, input, requirement.prefill)
      : null;
    const completed = await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.conversation.updateMany({
        where: {
          id: conversation.id,
          businessId: identity.businessId,
          intakeStatus: 'AWAITING_FORM',
        },
        data: { intakeStatus: 'COMPLETE' },
      });
      if (changed.count !== 1) return false;
      // The form may have been removed since the prompt; the conversation then simply routes.
      if (requirement && answers)
        await this.forms.record(
          transaction,
          identity.businessId,
          conversation.id,
          requirement.form,
          answers,
          input.consent ?? false,
        );
      return true;
    });
    if (!completed)
      throw new ConflictException({
        code: 'INTAKE_NOT_PENDING',
        message: 'This conversation is not waiting for a form',
      });
    return {
      routed: await this.routing.routeConversation(identity.businessId, conversation.id),
      intake: null,
    };
  }

  /** Reliability-sweep step: unanswered topic prompts take the default topic and continue. */
  public async expirePrompts(now = new Date()): Promise<number> {
    const due = await this.prisma.conversation.findMany({
      where: { intakeStatus: 'AWAITING_TOPIC', intakeExpiresAt: { lte: now } },
      orderBy: { intakeExpiresAt: 'asc' },
      take: EXPIRY_BATCH_SIZE,
      select: { id: true, businessId: true, visitorId: true },
    });
    let expired = 0;
    for (const conversation of due) {
      try {
        const topic = await this.catalog.findActive(conversation.businessId, null);
        const requirement = await this.requirementFor(
          conversation.businessId,
          conversation.id,
          topic,
          conversation.visitorId,
        );
        const applied = await this.apply(
          conversation.businessId,
          conversation.id,
          topic,
          requirement,
          {
            method: 'TIMEOUT',
            actorType: 'SYSTEM',
            onlyWhileAwaiting: true,
          },
        );
        if (!applied) continue;
        expired += 1;
        if (requirement && !requirement.autoAnswers)
          this.events.emit(INTAKE_REQUIRED_EVENT, {
            businessId: conversation.businessId,
            conversationId: conversation.id,
            prompt: this.formPrompt(requirement),
          } satisfies IntakeRequiredApplicationEvent);
        else await this.routing.routeConversation(conversation.businessId, conversation.id);
      } catch (error) {
        this.logger.warn(
          `Topic prompt fallback failed for ${conversation.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return expired;
  }

  private async owned(identity: VisitorIdentity, conversationId: string): Promise<Conversation> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, businessId: identity.businessId, visitorId: identity.visitorId },
    });
    if (!conversation)
      throw new NotFoundException({
        code: 'CONVERSATION_NOT_FOUND',
        message: 'Conversation not found',
      });
    return conversation;
  }

  /** A topic's form, unless the visitor already submitted one for this conversation. */
  private async requirementFor(
    businessId: string,
    conversationId: string,
    topic: CatalogTopic | null,
    visitorId: string | null,
  ): Promise<FormRequirement | null> {
    const submitted = await this.prisma.conversationIntake.count({ where: { conversationId } });
    return submitted ? null : this.forms.requirement(businessId, topic?.id ?? null, visitorId);
  }

  private async apply(
    businessId: string,
    conversationId: string,
    topic: CatalogTopic | null,
    requirement: FormRequirement | null,
    options: {
      method: ClassificationMethod;
      actorType: 'VISITOR' | 'SYSTEM';
      actorId?: string;
      onlyWhileAwaiting: boolean;
    },
  ): Promise<boolean> {
    const routing = topicRouting(topic);
    const departmentId = routing.departmentId ?? (await this.defaultDepartmentId(businessId));
    const awaitingForm = Boolean(requirement && !requirement.autoAnswers);
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
          intakeStatus: awaitingForm ? 'AWAITING_FORM' : 'COMPLETE',
          intakeExpiresAt: null,
        },
      });
      if (changed.count !== 1) return false;
      // Identity claims answered the whole form, so it is stored without asking.
      if (requirement?.autoAnswers)
        await this.forms.record(
          transaction,
          businessId,
          conversationId,
          requirement.form,
          requirement.autoAnswers,
          false,
        );
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
