import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import type { WidgetSettingsResponse } from '@bizchat/types';
import { updateWidgetSettingsSchema, type UpdateWidgetSettingsInput } from '@bizchat/validation';
import { AuthorizationGuard } from '../auth/authorization.guard';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators';
import { OriginGuard } from '../auth/origin.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { AuthContext, AuthenticatedRequest } from '../common/http.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { WidgetSettingsService } from './widget-settings.service';

@Controller('widget-settings')
@UseGuards(SessionAuthGuard, AuthorizationGuard)
@RequirePermissions('settings:manage')
export class WidgetSettingsController {
  public constructor(private readonly settings: WidgetSettingsService) {}

  @Get()
  public get(@CurrentAuth() auth: AuthContext): Promise<WidgetSettingsResponse> {
    return this.settings.get(auth);
  }

  @Patch()
  @UseGuards(OriginGuard)
  public update(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(updateWidgetSettingsSchema)) input: UpdateWidgetSettingsInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<WidgetSettingsResponse> {
    return this.settings.update(auth, input, request.requestId, request.ip);
  }
}
