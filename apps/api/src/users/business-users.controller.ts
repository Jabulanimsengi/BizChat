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
import type { BusinessUserResponse } from '@bizchat/types';
import {
  createBusinessUserSchema,
  updateBusinessUserSchema,
  type CreateBusinessUserInput,
  type UpdateBusinessUserInput,
} from '@bizchat/validation';
import { AuthorizationGuard } from '../auth/authorization.guard';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators';
import { OriginGuard } from '../auth/origin.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { AuthContext, AuthenticatedRequest } from '../common/http.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { BusinessUsersService } from './business-users.service';

@Controller('users')
@UseGuards(SessionAuthGuard, AuthorizationGuard)
export class BusinessUsersController {
  public constructor(private readonly users: BusinessUsersService) {}
  @Get()
  @RequirePermissions('user:create')
  public list(@CurrentAuth() auth: AuthContext): Promise<BusinessUserResponse[]> {
    return this.users.list(auth.business.id);
  }
  @Post()
  @UseGuards(OriginGuard)
  @RequirePermissions('user:create')
  public create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createBusinessUserSchema)) input: CreateBusinessUserInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<BusinessUserResponse> {
    return this.users.create(auth, input, request.requestId, request.ip);
  }
  @Patch(':membershipId')
  @UseGuards(OriginGuard)
  @RequirePermissions('user:disable')
  public update(
    @CurrentAuth() auth: AuthContext,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body(new ZodValidationPipe(updateBusinessUserSchema)) input: UpdateBusinessUserInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<BusinessUserResponse> {
    return this.users.update(auth, membershipId, input, request.requestId, request.ip);
  }
}
