import { Injectable } from '@nestjs/common';
import type { RoutingSettingsResponse } from '@bizchat/types';
import type { UpdateRoutingSettingsInput } from '@bizchat/validation';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/http.types';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class RoutingSettingsService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Tenants without a stored row use the defaults, so no backfill is needed. */
  public async get(auth: AuthContext): Promise<RoutingSettingsResponse> {
    const settings = await this.prisma.routingSettings.findUnique({
      where: { businessId: auth.business.id },
      select: { routingStrategy: true },
    });
    return { routingStrategy: settings?.routingStrategy ?? 'LEAST_BUSY' };
  }

  public async update(
    auth: AuthContext,
    input: UpdateRoutingSettingsInput,
    requestId: string,
    ipAddress?: string,
  ): Promise<RoutingSettingsResponse> {
    const settings = await this.prisma.routingSettings.upsert({
      where: { businessId: auth.business.id },
      update: input,
      create: { businessId: auth.business.id, ...input },
      select: { routingStrategy: true },
    });
    await this.audit.record({
      businessId: auth.business.id,
      actorUserId: auth.user.id,
      action: 'routing.settings_updated',
      targetType: 'RoutingSettings',
      targetId: auth.business.id,
      requestId,
      ipAddress,
      metadata: input,
    });
    return settings;
  }
}
