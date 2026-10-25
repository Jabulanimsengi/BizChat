import { PlanService } from '../plans/plan.service';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import type { Prisma, WebhookDelivery } from '@prisma/client';
import type { Environment } from '../config/environment';
import { PrismaService } from '../database/prisma.service';
import type { AuthContext } from '../common/http.types';
import type { WebhookInput } from './integration.contracts';
import { WebhookTransport } from './webhook-transport';

export function webhookSignature(
  secret: string,
  body: string,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}
const endpointSelect = {
  id: true,
  url: true,
  events: true,
  enabled: true,
  createdAt: true,
} as const;
@Injectable()
export class WebhookService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookService.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private lastCleanup = 0;
  private readonly encryptionKey: Buffer;
  public constructor(
    private readonly prisma: PrismaService,
    private readonly transport: WebhookTransport,
    config: ConfigService<Environment, true>,
    private readonly plans: PlanService,
  ) {
    this.encryptionKey = createHash('sha256')
      .update(`bizchat.webhook.encryption.v1:${config.get('WIDGET_TOKEN_SECRET', { infer: true })}`)
      .digest();
  }
  public onModuleInit(): void {
    this.timer = setInterval(() => {
      if (!this.running)
        this.running = this.sweep()
          .catch(() => this.logger.error('Webhook sweep failed'))
          .finally(() => {
            this.running = undefined;
          });
    }, 2000);
    this.timer.unref();
  }
  public async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  public async list(businessId: string): Promise<object[]> {
    return this.prisma.webhookEndpoint.findMany({
      where: { businessId },
      select: endpointSelect,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  public async create(auth: AuthContext, input: WebhookInput): Promise<object> {
    await this.transport.validate(input.url);
    const secret = `whsec_${randomBytes(32).toString('base64url')}`;
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`webhook:${auth.business.id}`}, 0)) IS NULL AS acquired`;
      await this.plans.assertWithin(auth.business.id, 'webhookEndpoints', tx);
      if (
        (await tx.webhookEndpoint.count({
          where: { businessId: auth.business.id, enabled: true },
        })) >= 5
      )
        throw new ConflictException({
          code: 'WEBHOOK_LIMIT',
          message: 'Disable an endpoint before creating another',
        });
      const endpoint = await tx.webhookEndpoint.create({
        data: {
          businessId: auth.business.id,
          url: input.url,
          events: input.events,
          secretEncrypted: this.encrypt(secret),
        },
        select: endpointSelect,
      });
      await this.audit(tx, auth, 'webhook.created', endpoint.id);
      return { ...endpoint, secret };
    });
  }
  public async disable(auth: AuthContext, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.webhookEndpoint.updateMany({
        where: { id, businessId: auth.business.id },
        data: { enabled: false },
      });
      if (!result.count)
        throw new NotFoundException({ code: 'WEBHOOK_NOT_FOUND', message: 'Webhook not found' });
      await tx.webhookDelivery.updateMany({
        where: { endpointId: id, deliveredAt: null, failedAt: null },
        data: { failedAt: new Date(), leaseToken: null },
      });
      await this.audit(tx, auth, 'webhook.disabled', id);
    });
  }
  public async deliveries(businessId: string, id: string): Promise<object[]> {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({ where: { id, businessId } });
    if (!endpoint)
      throw new NotFoundException({ code: 'WEBHOOK_NOT_FOUND', message: 'Webhook not found' });
    return this.prisma.webhookDelivery.findMany({
      where: { endpointId: id },
      select: {
        id: true,
        eventId: true,
        attempts: true,
        createdAt: true,
        nextAttemptAt: true,
        deliveredAt: true,
        failedAt: true,
        lastStatus: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  public async replay(auth: AuthContext, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.webhookDelivery.updateMany({
        where: {
          id,
          failedAt: { not: null },
          endpoint: { businessId: auth.business.id, enabled: true },
        },
        data: { failedAt: null, attempts: 0, nextAttemptAt: new Date(), leaseToken: null },
      });
      if (!result.count)
        throw new NotFoundException({
          code: 'DELIVERY_NOT_FOUND',
          message: 'Failed delivery on an active endpoint not found',
        });
      await this.audit(tx, auth, 'webhook.replayed', id);
    });
  }

  public async sweep(): Promise<void> {
    await this.prisma.webhookDelivery.updateMany({
      where: {
        deliveredAt: null,
        failedAt: null,
        attempts: { gte: 10 },
        nextAttemptAt: { lte: new Date() },
      },
      data: { failedAt: new Date(), leaseToken: null },
    });
    const leaseToken = randomUUID();
    const deliveries = await this.prisma.$queryRaw<WebhookDelivery[]>`
      UPDATE webhook_deliveries SET "leaseToken" = ${leaseToken}::uuid, attempts = attempts + 1, "nextAttemptAt" = NOW() + INTERVAL '90 seconds'
      WHERE id IN (
        SELECT d.id FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d."endpointId" JOIN businesses b ON b.id = e."businessId"
        WHERE d."deliveredAt" IS NULL AND d."failedAt" IS NULL AND d.attempts < 10 AND d."nextAttemptAt" <= NOW() AND e.enabled AND b.status IN ('ACTIVE', 'TRIAL')
        ORDER BY d."nextAttemptAt" LIMIT 3 FOR UPDATE OF d SKIP LOCKED
      ) RETURNING *`;
    await Promise.all(deliveries.map((delivery) => this.deliver(delivery, leaseToken)));
    if (Date.now() - this.lastCleanup > 3_600_000) {
      const cutoff = new Date(Date.now() - 30 * 86_400_000);
      await this.prisma.webhookDelivery.deleteMany({
        where: { OR: [{ deliveredAt: { lt: cutoff } }, { failedAt: { lt: cutoff } }] },
      });
      await this.prisma.integrationRequest.deleteMany({ where: { createdAt: { lt: cutoff } } });
      this.lastCleanup = Date.now();
    }
  }
  private async deliver(delivery: WebhookDelivery, leaseToken: string): Promise<void> {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({
      where: {
        id: delivery.endpointId,
        enabled: true,
        business: { status: { in: ['ACTIVE', 'TRIAL'] } },
      },
    });
    if (!endpoint) return;
    let status: number | null = null;
    try {
      const body = JSON.stringify(delivery.payload);
      status = await this.transport.send(
        endpoint.url,
        body,
        webhookSignature(this.decrypt(endpoint.secretEncrypted), body),
        delivery.eventId,
      );
    } catch {
      /* Persist retry metadata without storing remote response bodies or secrets. */
    }
    const success = status !== null && status >= 200 && status < 300;
    await this.prisma.webhookDelivery.updateMany({
      where: { id: delivery.id, leaseToken, deliveredAt: null, failedAt: null },
      data: {
        lastStatus: status,
        leaseToken: null,
        deliveredAt: success ? new Date() : null,
        failedAt: !success && delivery.attempts >= 10 ? new Date() : null,
        nextAttemptAt: new Date(
          Date.now() +
            Math.min(3_600_000, 1000 * 2 ** delivery.attempts) +
            Math.floor(Math.random() * 1000),
        ),
      },
    });
  }
  private encrypt(secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64url')).join('.');
  }
  private decrypt(value: string): string {
    const [iv, tag, data] = value.split('.').map((part) => Buffer.from(part, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv!);
    decipher.setAuthTag(tag!);
    return Buffer.concat([decipher.update(data!), decipher.final()]).toString('utf8');
  }
  private async audit(
    tx: Prisma.TransactionClient,
    auth: AuthContext,
    action: string,
    targetId: string,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        businessId: auth.business.id,
        actorUserId: auth.user.id,
        action,
        targetType: 'Webhook',
        targetId,
      },
    });
  }
}
