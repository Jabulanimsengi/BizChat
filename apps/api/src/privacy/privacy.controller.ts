import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type {
  PrivacySettingsResponse,
  VisitorDataExport,
  VisitorErasureResponse,
} from '@bizchat/types';
import {
  eraseVisitorSchema,
  updatePrivacySettingsSchema,
  type UpdatePrivacySettingsInput,
} from '@bizchat/validation';
import { AuthorizationGuard } from '../auth/authorization.guard';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators';
import { OriginGuard } from '../auth/origin.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { AuthContext, AuthenticatedRequest } from '../common/http.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrivacyService } from './privacy.service';

/** Owners and admins only: retention settings and data subject requests. */
@Controller('privacy')
@UseGuards(SessionAuthGuard, AuthorizationGuard)
export class PrivacyController {
  public constructor(private readonly privacy: PrivacyService) {}

  @Get('settings')
  @RequirePermissions('settings:manage')
  public settings(@CurrentAuth() auth: AuthContext): Promise<PrivacySettingsResponse> {
    return this.privacy.settings(auth.business.id);
  }

  @Put('settings')
  @UseGuards(OriginGuard)
  @RequirePermissions('settings:manage')
  public updateSettings(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(updatePrivacySettingsSchema)) input: UpdatePrivacySettingsInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<PrivacySettingsResponse> {
    return this.privacy.updateSettings(auth, input, request.requestId, request.ip);
  }

  @Get('visitors/:visitorId/export')
  @RequirePermissions('settings:manage')
  public export(
    @CurrentAuth() auth: AuthContext,
    @Param('visitorId', ParseUUIDPipe) visitorId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<VisitorDataExport> {
    return this.privacy.export(auth, { visitorId }, request.requestId, request.ip);
  }

  /** The same requests from a conversation in the inbox, for the visitor who started it. */
  @Get('conversations/:conversationId/visitor/export')
  @RequirePermissions('settings:manage')
  public exportByConversation(
    @CurrentAuth() auth: AuthContext,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<VisitorDataExport> {
    return this.privacy.export(auth, { conversationId }, request.requestId, request.ip);
  }

  @Post('conversations/:conversationId/visitor/erase')
  @HttpCode(200)
  @UseGuards(OriginGuard)
  @RequirePermissions('settings:manage')
  public eraseByConversation(
    @CurrentAuth() auth: AuthContext,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body(new ZodValidationPipe(eraseVisitorSchema)) _confirmed: { confirm: true },
    @Req() request: AuthenticatedRequest,
  ): Promise<VisitorErasureResponse> {
    return this.privacy.erase(auth, { conversationId }, request.requestId, request.ip);
  }

  @Post('visitors/:visitorId/erase')
  @HttpCode(200)
  @UseGuards(OriginGuard)
  @RequirePermissions('settings:manage')
  public erase(
    @CurrentAuth() auth: AuthContext,
    @Param('visitorId', ParseUUIDPipe) visitorId: string,
    @Body(new ZodValidationPipe(eraseVisitorSchema)) _confirmed: { confirm: true },
    @Req() request: AuthenticatedRequest,
  ): Promise<VisitorErasureResponse> {
    return this.privacy.erase(auth, { visitorId }, request.requestId, request.ip);
  }
}
