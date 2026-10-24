import { Injectable } from '@nestjs/common';
import type { RoutingSettingsResponse } from '@bizchat/types';
import type { UpdateRoutingSettingsInput } from '@bizchat/validation';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/http.types';
import { PrismaService } from '../database/prisma.service';

/** Applies to tenants with no stored row: direct assignment, as before Phase B. */
export const DEFAULT_ROUTING_SETTINGS: RoutingSettingsResponse = {
  routingStrategy: 'LEAST_BUSY',
  assignmentMode: 'AUTO',
  offerTimeoutSeconds: 30,
  missedOffersBeforeAway: 2,
  exclusionSeconds: 300,
};

const settingsSelect = {
  routingStrategy: true,
  assignmentMode: true,
  offerTimeoutSeconds: true,
  missedOffersBeforeAway: true,
  exclusionSeconds: true,
} as const;

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
      select: settingsSelect,
    });
    return settings ?? DEFAULT_ROUTING_SETTINGS;
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
      create: { ...DEFAULT_ROUTING_SETTINGS, ...input, businessId: auth.business.id },
      select: settingsSelect,
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
