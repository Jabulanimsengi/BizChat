import { Injectable } from '@nestjs/common';
import type { WidgetSettingsResponse } from '@bizchat/types';
import type { UpdateWidgetSettingsInput } from '@bizchat/validation';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/http.types';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class WidgetSettingsService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  public async get(auth: AuthContext): Promise<WidgetSettingsResponse> {
    const settings = await this.prisma.widgetSettings.upsert({
      where: { businessId: auth.business.id },
      update: {},
      create: { businessId: auth.business.id },
    });
    return this.serialize(auth, settings);
  }

  public async update(
    auth: AuthContext,
    input: UpdateWidgetSettingsInput,
    requestId: string,
    ipAddress?: string,
  ): Promise<WidgetSettingsResponse> {
    const settings = await this.prisma.widgetSettings.upsert({
      where: { businessId: auth.business.id },
      update: input,
      create: { businessId: auth.business.id, ...input },
    });
    await this.audit.record({
      businessId: auth.business.id,
      actorUserId: auth.user.id,
      action: 'widget.settings_updated',
      targetType: 'WidgetSettings',
      targetId: settings.id,
      requestId,
      ipAddress,
      metadata: input,
    });
    return this.serialize(auth, settings);
  }

  private serialize(
    auth: AuthContext,
    settings: {
      displayName: string | null;
      primaryColor: string;
      greeting: string;
      launcherPosition: 'BOTTOM_RIGHT' | 'BOTTOM_LEFT';
      enabled: boolean;
      departmentSelectionEnabled: boolean;
      preferPreviousConsultant: boolean;
      queueMessage: string;
      offlineMessage: string;
      resolvedMessage: string;
      reopenWindowMinutes: number;
      agentDisconnectGraceSeconds: number;
    },
  ): WidgetSettingsResponse {
    return {
      businessPublicId: auth.business.publicId,
      businessName: settings.displayName ?? auth.business.name,
      primaryColor: settings.primaryColor,
      greeting: settings.greeting,
      launcherPosition: settings.launcherPosition,
      departmentSelectionEnabled: settings.departmentSelectionEnabled,
      preferPreviousConsultant: settings.preferPreviousConsultant,
      queueMessage: settings.queueMessage,
      offlineMessage: settings.offlineMessage,
      resolvedMessage: settings.resolvedMessage,
      reopenWindowMinutes: settings.reopenWindowMinutes,
      agentDisconnectGraceSeconds: settings.agentDisconnectGraceSeconds,
      enabled: settings.enabled,
    };
  }
}
