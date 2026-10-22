import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { BusinessDomainResponse } from '@bizchat/types';
import {
  createDomainSchema,
  updateDomainStatusSchema,
  type CreateDomainInput,
  type UpdateDomainStatusInput,
} from '@bizchat/validation';
import { AuthorizationGuard } from '../auth/authorization.guard';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators';
import { OriginGuard } from '../auth/origin.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { AuthContext, AuthenticatedRequest } from '../common/http.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DomainService } from './domain.service';

@Controller('domains')
@UseGuards(SessionAuthGuard, AuthorizationGuard)
@RequirePermissions('settings:manage')
export class DomainController {
  public constructor(private readonly domains: DomainService) {}

  @Get()
  public list(@CurrentAuth() auth: AuthContext): Promise<BusinessDomainResponse[]> {
    return this.domains.list(auth.business.id);
  }

  @Post()
  @UseGuards(OriginGuard)
  public create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createDomainSchema)) input: CreateDomainInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<BusinessDomainResponse> {
    return this.domains.create(auth, input, request.requestId, request.ip);
  }

  @Post(':id/challenge')
  @UseGuards(OriginGuard)
  public regenerateChallenge(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BusinessDomainResponse> {
    return this.domains.regenerateChallenge(auth, id);
  }

  @Post(':id/verify')
  @UseGuards(OriginGuard)
  public verify(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<BusinessDomainResponse> {
    return this.domains.verify(auth, id, request.requestId, request.ip);
  }

  @Patch(':id')
  @UseGuards(OriginGuard)
  public updateStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateDomainStatusSchema)) input: UpdateDomainStatusInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<BusinessDomainResponse> {
    return this.domains.updateStatus(auth, id, input, request.requestId, request.ip);
  }
}
