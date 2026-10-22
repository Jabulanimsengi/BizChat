import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import type { BusinessHoursResponse } from '@bizchat/types';
import { updateBusinessHoursSchema, type UpdateBusinessHoursInput } from '@bizchat/validation';
import { AuthorizationGuard } from '../auth/authorization.guard';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators';
import { OriginGuard } from '../auth/origin.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { AuthContext, AuthenticatedRequest } from '../common/http.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { BusinessHoursService } from './business-hours.service';

@Controller('business-hours')
@UseGuards(SessionAuthGuard, AuthorizationGuard)
export class BusinessHoursController {
  public constructor(private readonly hours: BusinessHoursService) {}
  @Get()
  @RequirePermissions('conversation:view_assigned')
  public get(@CurrentAuth() auth: AuthContext): Promise<BusinessHoursResponse> {
    return this.hours.get(auth.business.id, auth.business.timezone);
  }
  @Put()
  @UseGuards(OriginGuard)
  @RequirePermissions('settings:manage')
  public update(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(updateBusinessHoursSchema)) input: UpdateBusinessHoursInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<BusinessHoursResponse> {
    return this.hours.update(auth, input, request.requestId, request.ip);
  }
}
