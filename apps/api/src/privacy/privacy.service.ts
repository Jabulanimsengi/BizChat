import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type {
  FollowUpContact,
  IntakeAnswer,
  PrivacySettingsResponse,
  VisitorDataExport,
  VisitorErasureResponse,
} from '@bizchat/types';
import type { UpdatePrivacySettingsInput } from '@bizchat/validation';
import { AttachmentStorageService } from '../attachments/attachment-storage.service';
import { AuditService, auditActor } from '../audit/audit.service';
import type { AuthContext } from '../common/http.types';
import type { Environment } from '../config/environment';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { ACQUIRE_OR_RENEW_LEASE_SCRIPT, RELEASE_IF_HOLDER_SCRIPT } from '../realtime/redis-lock';

const OPEN_STATUSES = [
  'NEW',
  'QUEUED',
  'OFFERED',
  'ASSIGNED',
  'ACTIVE',
  'WAITING_FOR_CUSTOMER',
  'WAITING_FOR_AGENT',
] as const;
const RETENTION_BATCH = 100;
const LEASE_KEY = 'retention:sweep:leader';

/**
 * Who to act on: a visitor, the visitor behind a conversation (from the inbox), or an integration
 * customer's external ID.
 */
export type DataSubject =
  { visitorId: string } | { conversationId: string } | { externalId: string };

/**
 * Personal data handling (POPIA): retention of finished conversations, and access and erasure
 * requests for one visitor. Deleting removes attachment objects first, then rows; if a run stops in
 * between, the rows remain and the next run repeats it, and deleting a missing object is harmless.
 */
@Injectable()
export class PrivacyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrivacyService.name);
  private readonly intervalMs: number;
  private readonly instanceId = randomUUID();
  private timer?: NodeJS.Timeout;
  private sweeping = false;

  public constructor(
    private readonly prisma: PrismaService,
    private readonly storage: AttachmentStorageService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    config: ConfigService<Environment, true>,
  ) {
    this.intervalMs = config.get('RETENTION_SWEEP_INTERVAL_MS', { infer: true });
  }

  public onModuleInit(): void {
    this.timer = setInterval(() => void this.runRetention(), this.intervalMs);
    this.timer.unref();
  }

  public async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.redis
      .eval(RELEASE_IF_HOLDER_SCRIPT, 1, LEASE_KEY, this.instanceId)
      .catch(() => undefined);
  }

  public async settings(businessId: string): Promise<PrivacySettingsResponse> {
    const settings = await this.prisma.privacySettings.findUnique({ where: { businessId } });
    return { conversationRetentionDays: settings?.conversationRetentionDays ?? null };
  }

  public async updateSettings(
    auth: AuthContext,
    input: UpdatePrivacySettingsInput,
    requestId: string,
    ipAddress?: string,
  ): Promise<PrivacySettingsResponse> {
    await this.prisma.privacySettings.upsert({
      where: { businessId: auth.business.id },
      update: { conversationRetentionDays: input.conversationRetentionDays },
      create: {
        businessId: auth.business.id,
        conversationRetentionDays: input.conversationRetentionDays,
      },
    });
    await this.audit.record({
      businessId: auth.business.id,
      ...auditActor(auth),
      action: 'privacy.settings_updated',
      targetType: 'Business',
      targetId: auth.business.id,
      requestId,
      ipAddress,
      metadata: { conversationRetentionDays: input.conversationRetentionDays },
    });
    return this.settings(auth.business.id);
  }

  /** Everything held about one visitor, excluding staff-only internal notes. */
  public async export(
    auth: AuthContext,
    subject: DataSubject,
    requestId: string,
    ipAddress?: string,
  ): Promise<VisitorDataExport> {
    const visitorId = await this.visitorId(auth.business.id, subject);
    const visitor = await this.prisma.visitor.findUniqueOrThrow({
      where: { id: visitorId },
      include: { integrationCustomer: true },
    });
    const conversations = await this.prisma.conversation.findMany({
      where: { businessId: auth.business.id, visitorId },
      orderBy: { createdAt: 'asc' },
      include: {
        topic: { select: { name: true } },
        intake: { select: { answers: true } },
        messages: {
          where: { messageType: { not: 'INTERNAL_NOTE' }, deletedAt: null },
          orderBy: { sequenceNumber: 'asc' },
          select: { senderType: true, content: true, createdAt: true },
        },
        attachments: {
          where: { status: 'READY' },
          select: { originalFileName: true, mimeType: true, sizeBytes: true, createdAt: true },
        },
      },
    });
    await this.audit.record({
      businessId: auth.business.id,
      ...auditActor(auth),
      action: 'privacy.visitor_exported',
      targetType: 'Visitor',
      targetId: visitorId,
      requestId,
      ipAddress,
      metadata: { conversations: conversations.length },
    });
    const customer = visitor.integrationCustomer;
    return {
      exportedAt: new Date().toISOString(),
      visitor: {
        id: visitor.id,
        createdAt: visitor.createdAt.toISOString(),
        lastSeenAt: visitor.lastSeenAt.toISOString(),
      },
      customer: customer
        ? {
            externalId: customer.externalId,
            displayName: customer.displayName,
            email: customer.email,
          }
        : null,
      conversations: conversations.map((conversation) => ({
        id: conversation.id,
        status: conversation.status,
        createdAt: conversation.createdAt.toISOString(),
        resolvedAt: conversation.resolvedAt?.toISOString() ?? null,
        topic: conversation.topic?.name ?? null,
        followUpContact: conversation.followUpContact as FollowUpContact | null,
        intake: (conversation.intake?.answers as IntakeAnswer[] | undefined) ?? null,
        messages: conversation.messages.map((message) => ({
          senderType: message.senderType,
          content: message.content,
          createdAt: message.createdAt.toISOString(),
        })),
        attachments: conversation.attachments.map((attachment) => ({
          ...attachment,
          createdAt: attachment.createdAt.toISOString(),
        })),
      })),
    };
  }

  /**
   * Deletes a visitor and everything about them. Open conversations must be resolved first, so a
   * consultant is never left holding a chat that disappears.
   */
  public async erase(
    auth: AuthContext,
    subject: DataSubject,
    requestId: string,
    ipAddress?: string,
  ): Promise<VisitorErasureResponse> {
    const businessId = auth.business.id;
    const visitorId = await this.visitorId(businessId, subject);
    if (
      await this.prisma.conversation.count({
        where: { businessId, visitorId, status: { in: [...OPEN_STATUSES] } },
      })
    )
      throw new ConflictException({
        code: 'CONVERSATION_OPEN',
        message: 'Resolve this visitor’s open conversations before erasing their data',
      });
    const conversations = await this.prisma.conversation.findMany({
      where: { businessId, visitorId },
      select: { id: true },
    });
    const purged = await this.purge(
      businessId,
      conversations.map(({ id }) => id),
    );
    await this.prisma.$transaction(async (transaction) => {
      // A message started after the open-chat check would leave a conversation behind.
      if (await transaction.conversation.count({ where: { visitorId } }))
        throw new ConflictException({
          code: 'CONVERSATION_OPEN',
          message: 'The visitor started a new conversation; try again once it is resolved',
        });
      await transaction.integrationCustomer.deleteMany({ where: { businessId, visitorId } });
      // Sessions and widget sessions cascade with the visitor.
      await transaction.visitor.delete({ where: { id: visitorId } });
    });
    // No personal data in the record: the visitor ID no longer refers to anything.
    await this.audit.record({
      businessId,
      ...auditActor(auth),
      action: 'privacy.visitor_erased',
      targetType: 'Visitor',
      targetId: visitorId,
      requestId,
      ipAddress,
      metadata: { conversations: purged.conversations, attachments: purged.attachments },
    });
    return {
      visitorId,
      conversationsDeleted: purged.conversations,
      attachmentsDeleted: purged.attachments,
    };
  }

  /** One retention pass, on the instance holding the lease. Returns conversations deleted. */
  public async runRetention(now = new Date()): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    try {
      const held = await this.redis
        .eval(ACQUIRE_OR_RENEW_LEASE_SCRIPT, 1, LEASE_KEY, this.instanceId, this.intervalMs * 2)
        .catch(() => 0);
      if (held !== 1) return 0;
      const policies = await this.prisma.privacySettings.findMany({
        where: { conversationRetentionDays: { not: null } },
      });
      let deleted = 0;
      for (const policy of policies) {
        const cutoff = new Date(now.getTime() - policy.conversationRetentionDays! * 86_400_000);
        try {
          deleted += await this.expire(policy.businessId, cutoff);
        } catch (error) {
          this.logger.warn(
            `Retention failed for ${policy.businessId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      return deleted;
    } finally {
      this.sweeping = false;
    }
  }

  /** Deletes a tenant's finished conversations last changed before the cutoff. */
  public async expire(businessId: string, cutoff: Date): Promise<number> {
    const expired = await this.prisma.conversation.findMany({
      where: { businessId, status: { in: ['RESOLVED', 'CLOSED'] }, updatedAt: { lt: cutoff } },
      orderBy: { updatedAt: 'asc' },
      take: RETENTION_BATCH,
      select: { id: true },
    });
    if (expired.length === 0) return 0;
    const purged = await this.purge(
      businessId,
      expired.map(({ id }) => id),
    );
    await this.audit.record({
      businessId,
      action: 'privacy.retention_applied',
      targetType: 'Business',
      targetId: businessId,
      metadata: {
        conversations: purged.conversations,
        attachments: purged.attachments,
        cutoff: cutoff.toISOString(),
      },
    });
    return purged.conversations;
  }

  /**
   * Removes conversations with their attachments and the copies of their content held for
   * idempotent replays and webhook retries.
   */
  private async purge(
    businessId: string,
    conversationIds: string[],
  ): Promise<{ conversations: number; attachments: number }> {
    if (conversationIds.length === 0) return { conversations: 0, attachments: 0 };
    const attachments = await this.prisma.attachment.findMany({
      where: { businessId, conversationId: { in: conversationIds } },
      select: { storageKey: true },
    });
    for (const { storageKey } of attachments) await this.storage.remove(storageKey);
    const ids = Prisma.join(conversationIds.map((id) => Prisma.sql`${id}`));
    const deleted = await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        DELETE FROM webhook_deliveries d USING webhook_endpoints e
         WHERE d."endpointId" = e.id AND e."businessId" = ${businessId}::uuid
           AND (d.payload->'data'->>'id' IN (${ids})
                OR d.payload->'data'->>'conversationId' IN (${ids}))`;
      await transaction.$executeRaw`
        DELETE FROM integration_requests r
         WHERE r."businessId" = ${businessId}::uuid
           AND (r.response->'conversation'->>'id' IN (${ids})
                OR r.response->>'conversationId' IN (${ids})
                OR r.response->>'id' IN (${ids}))`;
      return transaction.conversation.deleteMany({
        where: { businessId, id: { in: conversationIds } },
      });
    });
    return { conversations: deleted.count, attachments: attachments.length };
  }

  private async visitorId(businessId: string, subject: DataSubject): Promise<string> {
    const found =
      'visitorId' in subject
        ? await this.prisma.visitor.findFirst({
            where: { id: subject.visitorId, businessId },
            select: { id: true },
          })
        : 'conversationId' in subject
          ? await this.prisma.conversation
              .findFirst({
                where: { id: subject.conversationId, businessId },
                select: { visitorId: true },
              })
              .then((conversation) =>
                conversation?.visitorId ? { id: conversation.visitorId } : null,
              )
          : await this.prisma.integrationCustomer
              .findUnique({
                where: { businessId_externalId: { businessId, externalId: subject.externalId } },
                select: { visitorId: true },
              })
              .then((customer) => (customer ? { id: customer.visitorId } : null));
    if (!found)
      throw new NotFoundException({ code: 'VISITOR_NOT_FOUND', message: 'Visitor not found' });
    return found.id;
  }
}
