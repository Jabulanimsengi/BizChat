import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { updateBusinessSchema, type UpdateBusinessInput } from '@bizchat/validation';
import { AuthorizationGuard } from '../auth/authorization.guard';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators';
import { OriginGuard } from '../auth/origin.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { AuthContext, AuthenticatedRequest } from '../common/http.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { BusinessService, type BusinessResponse } from './business.service';

@Controller('business')
@UseGuards(SessionAuthGuard, AuthorizationGuard)
export class BusinessController {
  public constructor(private readonly businessService: BusinessService) {}

  @Get()
  public get(@CurrentAuth() auth: AuthContext): AuthContext['business'] {
    return auth.business;
  }

  @Patch()
  @UseGuards(OriginGuard)
  @RequirePermissions('settings:manage')
  public update(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(updateBusinessSchema)) input: UpdateBusinessInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<BusinessResponse> {
    return this.businessService.update(auth, input, request.requestId, request.ip);
  }
}
