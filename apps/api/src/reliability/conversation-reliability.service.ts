import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import type { Conversation, Message, MessageReceipt } from '@prisma/client';
import type { Environment } from '../config/environment';
import {
  MESSAGE_CREATED_EVENT,
  type MessageCreatedApplicationEvent,
} from '../conversations/conversation-events';
import { serializeMessage } from '../conversations/conversation-serializer';
import { ConversationTimelineService } from '../conversations/conversation-timeline.service';
import { PrismaService } from '../database/prisma.service';
import { PresenceService } from '../realtime/presence.service';
import { RedisService } from '../realtime/redis.service';
import { ACQUIRE_OR_RENEW_LEASE_SCRIPT, RELEASE_IF_HOLDER_SCRIPT } from '../realtime/redis-lock';
import { ConversationOfferService } from '../routing/conversation-offer.service';
import { IntakeService } from '../intake/intake.service';
import { ConversationRoutingService } from '../routing/conversation-routing.service';
import { QueueWaitService } from '../routing/queue-wait.service';
import { ASSIGNED_STATUSES } from '../routing/routing-policy';
import {
  CONVERSATION_RECOVERY_EVENT,
  type ConversationRecoveryApplicationEvent,
} from './reliability-events';

// Accepted conversations get a disconnect grace period; pending offers are cancelled instead.
const RECOVERABLE_STATUSES = [...ASSIGNED_STATUSES] as Conversation['status'][];
const SWEEP_LEASE_KEY = 'reliability:sweep:leader';
const SWEEP_BATCH_SIZE = 200;
const BACKLOG_TENANTS_PER_SWEEP = 100;

@Injectable()
export class ConversationReliabilityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConversationReliabilityService.name);
  private readonly sweepIntervalMs: number;
  private readonly retryBaseMs: number;
  private readonly leaseTtlMs: number;
  private readonly instanceId = randomUUID();
  private timer?: NodeJS.Timeout;
  private sweeping = false;

  public constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly routing: ConversationRoutingService,
    private readonly timeline: ConversationTimelineService,
    private readonly events: EventEmitter2,
    private readonly redis: RedisService,
    config: ConfigService<Environment, true>,
    private readonly offers: ConversationOfferService,
    private readonly intake: IntakeService,
    private readonly waits: QueueWaitService,
  ) {
    this.sweepIntervalMs = config.get('RELIABILITY_SWEEP_INTERVAL_MS', { infer: true });
    this.retryBaseMs = config.get('RELIABILITY_RETRY_BASE_MS', { infer: true });
    this.leaseTtlMs = Math.max(this.sweepIntervalMs * 3, 15_000);
  }

  public onModuleInit(): void {
    void this.runSweep();
    this.timer = setInterval(() => void this.runSweep(), this.sweepIntervalMs);
    this.timer.unref();
  }

  public async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.redis
      .eval(RELEASE_IF_HOLDER_SCRIPT, 1, SWEEP_LEASE_KEY, this.instanceId)
      .catch(() => undefined);
  }

  public async agentDisconnected(
    businessId: string,
    profileId: string,
    membershipId: string,
  ): Promise<string[]> {
    if ((await this.presence.getAgentState(businessId, profileId)) !== 'OFFLINE') return [];
    // Pending offers are not covered by the grace period: they move on to another consultant now.
    await this.offers.cancelForAgent(businessId, membershipId);
    const settings = await this.prisma.widgetSettings.findUnique({
      where: { businessId },
      select: { agentDisconnectGraceSeconds: true },
    });
    const disconnectedAt = new Date();
    const dueAt = new Date(
      disconnectedAt.getTime() + (settings?.agentDisconnectGraceSeconds ?? 30) * 1_000,
    );
    const conversations = await this.prisma.conversation.findMany({
      where: {
        businessId,
        assignedAgentMembershipId: membershipId,
        status: { in: RECOVERABLE_STATUSES },
        reassignmentDueAt: null,
      },
      select: { id: true, visitorId: true },
    });
    if (conversations.length === 0) return [];
    const ids = conversations.map(({ id }) => id);
    await this.prisma.conversation.updateMany({
      where: {
        id: { in: ids },
        businessId,
        assignedAgentMembershipId: membershipId,
        reassignmentDueAt: null,
      },
      data: {
        agentDisconnectedAt: disconnectedAt,
        reassignmentDueAt: dueAt,
        reassignmentAttempts: 0,
        reassignmentLastError: null,
      },
    });
    for (const conversation of conversations) {
      this.publish({
        businessId,
        visitorId: conversation.visitorId,
        conversationId: conversation.id,
        state: 'DISCONNECTED_GRACE',
        assignedAgentMembershipId: membershipId,
        graceExpiresAt: dueAt.toISOString(),
        attempt: 0,
        changedAt: disconnectedAt.toISOString(),
      });
    }
    return ids;
  }

  public async agentReconnected(businessId: string, membershipId: string): Promise<string[]> {
    const assigned = await this.prisma.conversation.findMany({
      where: {
        businessId,
        assignedAgentMembershipId: membershipId,
        status: { in: RECOVERABLE_STATUSES },
      },
      select: { id: true, visitorId: true, reassignmentDueAt: true, reassignmentAttempts: true },
    });
    const pending = assigned.filter(({ reassignmentDueAt }) => reassignmentDueAt !== null);
    if (pending.length > 0) {
      await this.prisma.conversation.updateMany({
        where: {
          id: { in: pending.map(({ id }) => id) },
          businessId,
          assignedAgentMembershipId: membershipId,
        },
        data: {
          agentDisconnectedAt: null,
          reassignmentDueAt: null,
          reassignmentAttempts: 0,
          reassignmentLastError: null,
        },
      });
      const changedAt = new Date().toISOString();
      for (const conversation of pending) {
        this.publish({
          businessId,
          visitorId: conversation.visitorId,
          conversationId: conversation.id,
          state: 'RESTORED',
          assignedAgentMembershipId: membershipId,
          graceExpiresAt: null,
          attempt: conversation.reassignmentAttempts,
          changedAt,
        });
      }
    }
    return assigned.map(({ id }) => id);
  }

  /**
   * Runs on the single API instance holding the Redis sweep lease. Without Redis no instance sweeps:
   * presence is unknown then, and expiring grace periods would reassign chats from live consultants.
   */
  public async runSweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      if (!(await this.holdSweepLease())) return;
      await this.reconstructQueueState();
      const due = await this.prisma.conversation.findMany({
        where: {
          reassignmentDueAt: { lte: new Date() },
          status: { in: ['NEW', 'QUEUED', ...RECOVERABLE_STATUSES] },
        },
        take: SWEEP_BATCH_SIZE,
        orderBy: { reassignmentDueAt: 'asc' },
      });
      for (const conversation of due) await this.processDueConversation(conversation);
      await this.offers.expireDue();
      await this.intake.expirePrompts();
      await this.waits.advanceOverflow();
      await this.waits.notifyLongWaits();
      await this.routing.abandonDepartedVisitors();
      const unrouted = await this.prisma.conversation.findMany({
        where: {
          assignedAgentMembershipId: null,
          status: 'NEW',
          reassignmentDueAt: null,
          intakeStatus: { in: ['NOT_REQUIRED', 'COMPLETE'] },
        },
        select: { businessId: true, id: true },
        orderBy: { createdAt: 'asc' },
        take: SWEEP_BATCH_SIZE,
      });
      for (const conversation of unrouted) {
        await this.routing
          .routeConversation(conversation.businessId, conversation.id)
          .catch((error: unknown) => {
            this.logger.warn(
              `Durable routing retry failed for ${conversation.id}: ${this.message(error)}`,
            );
          });
      }
      // Tenants with the longest-waiting customer drain first, so one busy tenant cannot starve others.
      const backlog = await this.prisma.conversationQueueEntry.groupBy({
        by: ['businessId'],
        where: {
          assignedAt: null,
          removedAt: null,
          conversation: {
            status: 'QUEUED',
            assignedAgentMembershipId: null,
            intakeStatus: { in: ['NOT_REQUIRED', 'COMPLETE'] },
          },
        },
        _min: { enqueuedAt: true },
        orderBy: { _min: { enqueuedAt: 'asc' } },
        take: BACKLOG_TENANTS_PER_SWEEP,
      });
      for (const { businessId } of backlog) {
        await this.routing.drainBusinessQueue(businessId).catch((error: unknown) => {
          this.logger.warn(`Queue drain failed for ${businessId}: ${this.message(error)}`);
        });
      }
    } catch (error) {
      this.logger.error(`Reliability sweep failed: ${this.message(error)}`);
    } finally {
      this.sweeping = false;
    }
  }

  private async processDueConversation(snapshot: Conversation): Promise<void> {
    if (!snapshot.assignedAgentMembershipId) {
      await this.retryRouting(snapshot);
      return;
    }
    const profile = await this.prisma.agentProfile.findUnique({
      where: { membershipId: snapshot.assignedAgentMembershipId },
      select: { id: true },
    });
    if (
      profile &&
      (await this.presence.getAgentState(snapshot.businessId, profile.id)) !== 'OFFLINE'
    ) {
      await this.agentReconnected(snapshot.businessId, snapshot.assignedAgentMembershipId);
      return;
    }

    try {
      const released = await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reassignment:${snapshot.id}`}, 0)) IS NULL AS acquired`;
        const current = await transaction.conversation.findUnique({ where: { id: snapshot.id } });
        if (
          !current ||
          !current.assignedAgentMembershipId ||
          !current.reassignmentDueAt ||
          current.reassignmentDueAt > new Date() ||
          !RECOVERABLE_STATUSES.includes(current.status)
        )
          return null;
        const membership = await transaction.businessMembership.findUniqueOrThrow({
          where: { id: current.assignedAgentMembershipId },
          select: { userId: true },
        });
        await transaction.conversationAssignment.updateMany({
          where: { conversationId: current.id, releasedAt: null },
          data: { releasedAt: new Date() },
        });
        await transaction.conversationParticipant.updateMany({
          where: {
            conversationId: current.id,
            participantType: 'AGENT',
            participantId: membership.userId,
            leftAt: null,
          },
          data: { leftAt: new Date() },
        });
        await transaction.conversationQueueEntry.upsert({
          where: { conversationId: current.id },
          update: { assignedAt: null, removedAt: null, departmentId: current.departmentId },
          create: {
            businessId: current.businessId,
            conversationId: current.id,
            departmentId: current.departmentId,
            priority: current.priority,
            attempts: 0,
          },
        });
        const updated = await transaction.conversation.update({
          where: { id: current.id },
          data: {
            assignedAgentMembershipId: null,
            assignedAt: null,
            status: 'NEW',
            agentDisconnectedAt: null,
            reassignmentDueAt: null,
            reassignmentAttempts: { increment: 1 },
            reassignmentLastError: null,
          },
        });
        const timeline = await this.timeline.recordInTransaction(transaction, {
          businessId: current.businessId,
          conversationId: current.id,
          type: 'REASSIGNED',
          actorType: 'SYSTEM',
          metadata: {
            previousAssignedAgentMembershipId: current.assignedAgentMembershipId,
            reason: 'agent_disconnect_grace_expired',
            attempt: updated.reassignmentAttempts,
          },
          systemMessage: "We're reconnecting you with a consultant.",
        });
        return {
          conversation: updated,
          previousMembershipId: current.assignedAgentMembershipId,
          timeline,
        };
      });
      if (!released) return;
      if (released.timeline.message)
        this.publishMessage(released.timeline.message, released.conversation.visitorId);
      this.publish({
        businessId: released.conversation.businessId,
        visitorId: released.conversation.visitorId,
        conversationId: released.conversation.id,
        state: 'REASSIGNING',
        assignedAgentMembershipId: released.previousMembershipId,
        graceExpiresAt: null,
        attempt: released.conversation.reassignmentAttempts,
        changedAt: new Date().toISOString(),
      });
      await this.routing.routeConversation(
        released.conversation.businessId,
        released.conversation.id,
        { assignmentType: 'REASSIGNMENT' },
      );
    } catch (error) {
      await this.scheduleRetry(snapshot, error);
    }
  }

  private async retryRouting(conversation: Conversation): Promise<void> {
    try {
      await this.routing.routeConversation(conversation.businessId, conversation.id, {
        assignmentType: 'REASSIGNMENT',
      });
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { reassignmentDueAt: null, reassignmentLastError: null },
      });
    } catch (error) {
      await this.scheduleRetry(conversation, error);
    }
  }

  private async scheduleRetry(conversation: Conversation, error: unknown): Promise<void> {
    const attempt = conversation.reassignmentAttempts + 1;
    const delay = Math.min(this.retryBaseMs * 2 ** Math.min(attempt - 1, 6), 60_000);
    const dueAt = new Date(Date.now() + delay);
    const message = this.message(error).slice(0, 500);
    await this.prisma.conversation.updateMany({
      where: { id: conversation.id, businessId: conversation.businessId },
      data: {
        reassignmentDueAt: dueAt,
        reassignmentAttempts: attempt,
        reassignmentLastError: message,
      },
    });
    this.logger.warn(`Reassignment retry ${attempt} scheduled for ${conversation.id}: ${message}`);
    this.publish({
      businessId: conversation.businessId,
      visitorId: conversation.visitorId,
      conversationId: conversation.id,
      state: 'RETRY_SCHEDULED',
      assignedAgentMembershipId: conversation.assignedAgentMembershipId,
      graceExpiresAt: dueAt.toISOString(),
      attempt,
      changedAt: new Date().toISOString(),
    });
  }

  private async holdSweepLease(): Promise<boolean> {
    try {
      const held = await this.redis.eval(
        ACQUIRE_OR_RENEW_LEASE_SCRIPT,
        1,
        SWEEP_LEASE_KEY,
        this.instanceId,
        this.leaseTtlMs,
      );
      return held === 1;
    } catch (error) {
      this.logger.warn(`Sweep lease unavailable: ${this.message(error)}`);
      return false;
    }
  }

  /** Repairs only queued conversations whose queue entry is missing or no longer active. */
  private async reconstructQueueState(): Promise<void> {
    const queued = await this.prisma.conversation.findMany({
      where: {
        status: 'QUEUED',
        assignedAgentMembershipId: null,
        OR: [
          { queueEntry: { is: null } },
          {
            queueEntry: {
              is: { OR: [{ assignedAt: { not: null } }, { removedAt: { not: null } }] },
            },
          },
        ],
      },
      select: { id: true, businessId: true, departmentId: true, priority: true },
      take: 500,
    });
    for (const conversation of queued) {
      await this.prisma.conversationQueueEntry.upsert({
        where: { conversationId: conversation.id },
        update: {
          assignedAt: null,
          removedAt: null,
          departmentId: conversation.departmentId,
          priority: conversation.priority,
        },
        create: {
          businessId: conversation.businessId,
          conversationId: conversation.id,
          departmentId: conversation.departmentId,
          priority: conversation.priority,
          attempts: 0,
        },
      });
    }
  }

  private publish(event: ConversationRecoveryApplicationEvent): void {
    this.events.emit(CONVERSATION_RECOVERY_EVENT, event);
  }

  private publishMessage(
    message: Message & { receipts?: MessageReceipt[] },
    visitorId: string | null,
  ): void {
    this.events.emit(MESSAGE_CREATED_EVENT, {
      businessId: message.businessId,
      visitorId,
      message: serializeMessage(message),
    } satisfies MessageCreatedApplicationEvent);
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
