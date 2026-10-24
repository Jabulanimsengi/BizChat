import { CustomerIdentityService } from '../integrations/customer-identity.service';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes } from 'node:crypto';
import type { WidgetBootstrapResponse, WidgetPublicConfig } from '@bizchat/types';
import type { WidgetBootstrapInput } from '@bizchat/validation';
import type { Environment } from '../config/environment';
import { PrismaService } from '../database/prisma.service';
import { normalizeWidgetOrigin } from '../domains/domain-normalization';

interface SocketWidgetSession {
  id: string;
  businessId: string;
  visitorId: string;
  expiresAt: Date;
}

@Injectable()
export class WidgetService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Environment, true>,
    private readonly identities: CustomerIdentityService,
  ) {}

  public async bootstrap(
    input: WidgetBootstrapInput,
    originHeader: string | undefined,
    userAgent?: string,
  ): Promise<WidgetBootstrapResponse> {
    if (!originHeader)
      throw new ForbiddenException({
        code: 'ORIGIN_REQUIRED',
        message: 'Widget initialization requires a browser origin',
      });
    const normalizedOrigin = normalizeWidgetOrigin(originHeader, this.isDevelopment());
    const business = await this.prisma.business.findUnique({
      where: { publicId: input.businessPublicId },
      include: {
        widgetSettings: true,
        domains: { where: { domain: normalizedOrigin.domain, status: 'VERIFIED' } },
      },
    });
    if (!business || !['ACTIVE', 'TRIAL'].includes(business.status)) {
      throw new NotFoundException({
        code: 'WIDGET_NOT_FOUND',
        message: 'Widget configuration is unavailable',
      });
    }
    if (business.domains.length !== 1) {
      throw new ForbiddenException({
        code: 'ORIGIN_NOT_ALLOWED',
        message: 'This website is not authorized to load the widget',
      });
    }
    if (business.widgetSettings && !business.widgetSettings.enabled) {
      throw new ForbiddenException({
        code: 'WIDGET_DISABLED',
        message: 'This widget is currently disabled',
      });
    }

    const identity = input.identityToken
      ? await this.identities.verify(input.identityToken, business.id)
      : undefined;
    const visitor = identity
      ? await this.identifiedVisitor(business.id, identity.visitorId, identity.expiresAt)
      : await this.resolveVisitor(business.id, input.visitorToken, userAgent);
    const widgetToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + this.config.get('WIDGET_SESSION_TTL_MINUTES', { infer: true }) * 60_000,
    );
    if (identity && expiresAt > identity.expiresAt) expiresAt.setTime(identity.expiresAt.getTime());
    await this.prisma.widgetSession.create({
      data: {
        businessId: business.id,
        visitorSessionId: visitor.visitorSessionId,
        tokenHash: this.hashToken(widgetToken),
        origin: normalizedOrigin.origin,
        expiresAt,
      },
    });

    const settings = business.widgetSettings;
    const config: WidgetPublicConfig = {
      businessName: settings?.displayName ?? business.name,
      primaryColor: settings?.primaryColor ?? '#155f43',
      greeting: settings?.greeting ?? 'How can we help?',
      launcherPosition: settings?.launcherPosition ?? 'BOTTOM_RIGHT',
      departmentSelectionEnabled: settings?.departmentSelectionEnabled ?? false,
      queueMessage:
        settings?.queueMessage ??
        "All consultants are busy. You're in the queue and we'll be with you shortly.",
      offlineMessage:
        settings?.offlineMessage ??
        "We're currently offline. Leave us a message and we'll respond when we're back.",
      resolvedMessage:
        settings?.resolvedMessage ??
        'Thanks for chatting with us. This conversation has been resolved.',
    };
    const departments = await this.prisma.department.findMany({
      where: { businessId: business.id, status: 'ACTIVE' },
      select: { publicId: true, name: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    const topics = await this.prisma.topic.findMany({
      where: { businessId: business.id, status: 'ACTIVE', showAsQuickReply: true },
      select: { publicId: true, name: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return {
      ...(identity
        ? {
            conversationId: (
              await this.prisma.conversation.findFirst({
                where: {
                  businessId: business.id,
                  visitorId: identity.visitorId,
                  status: { not: 'CLOSED' },
                },
                orderBy: { createdAt: 'desc' },
                select: { id: true },
              })
            )?.id,
          }
        : {}),
      visitorToken: visitor.visitorToken,
      widgetSessionToken: widgetToken,
      widgetSessionExpiresAt: expiresAt.toISOString(),
      availability: 'UNKNOWN',
      config,
      departments,
      topics,
    };
  }

  public async authenticateSocket(
    token: string | undefined,
    originHeader: string | undefined,
  ): Promise<SocketWidgetSession> {
    if (!token || !originHeader)
      throw new UnauthorizedException({
        code: 'WIDGET_AUTH_REQUIRED',
        message: 'Widget authentication is required',
      });
    const origin = normalizeWidgetOrigin(originHeader, this.isDevelopment()).origin;
    const session = await this.prisma.widgetSession.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: { business: true, visitorSession: true },
    });
    if (
      !session ||
      session.origin !== origin ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.visitorSession.revokedAt ||
      session.visitorSession.expiresAt <= new Date() ||
      !['ACTIVE', 'TRIAL'].includes(session.business.status)
    )
      throw new UnauthorizedException({
        code: 'WIDGET_SESSION_INVALID',
        message: 'Widget session is invalid or expired',
      });
    await this.prisma.widgetSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });
    return {
      id: session.id,
      businessId: session.businessId,
      visitorId: session.visitorSession.visitorId,
      expiresAt: session.expiresAt,
    };
  }

  public async heartbeat(sessionId: string): Promise<void> {
    await this.prisma.widgetSession.updateMany({
      where: { id: sessionId, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { lastSeenAt: new Date() },
    });
  }

  private async identifiedVisitor(
    businessId: string,
    visitorId: string,
    expiresAt: Date,
  ): Promise<{ visitorSessionId: string; visitorToken: string }> {
    const visitorToken = randomBytes(32).toString('base64url');
    const session = await this.prisma.visitorSession.create({
      data: { businessId, visitorId, tokenHash: this.hashToken(visitorToken), expiresAt },
    });
    return { visitorSessionId: session.id, visitorToken };
  }

  private async resolveVisitor(
    businessId: string,
    suppliedToken: string | undefined,
    userAgent?: string,
  ): Promise<{ visitorSessionId: string; visitorToken: string }> {
    if (suppliedToken) {
      const existing = await this.prisma.visitorSession.findFirst({
        where: {
          businessId,
          tokenHash: this.hashToken(suppliedToken),
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (existing) {
        const now = new Date();
        await this.prisma.$transaction([
          this.prisma.visitorSession.update({
            where: { id: existing.id },
            data: { lastSeenAt: now, userAgent: userAgent?.slice(0, 512) },
          }),
          this.prisma.visitor.update({
            where: { id: existing.visitorId },
            data: { lastSeenAt: now },
          }),
        ]);
        return { visitorSessionId: existing.id, visitorToken: suppliedToken };
      }
    }

    const visitorToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const created = await this.prisma.$transaction(async (transaction) => {
      const visitor = await transaction.visitor.create({
        data: { businessId, anonymousIdentifier: `anon_${randomBytes(18).toString('base64url')}` },
      });
      const visitorSession = await transaction.visitorSession.create({
        data: {
          businessId,
          visitorId: visitor.id,
          tokenHash: this.hashToken(visitorToken),
          expiresAt,
          userAgent: userAgent?.slice(0, 512),
        },
      });
      return visitorSession;
    });
    return { visitorSessionId: created.id, visitorToken };
  }

  private hashToken(token: string): string {
    return createHmac('sha256', this.config.get('WIDGET_TOKEN_SECRET', { infer: true }))
      .update(token)
      .digest('hex');
  }

  private isDevelopment(): boolean {
    return this.config.get('NODE_ENV', { infer: true }) !== 'production';
  }
}
