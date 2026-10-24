import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RoutingSettingsResponse, SkillResponse } from '@bizchat/types';
import {
  createSkillSchema,
  updateRoutingSettingsSchema,
  updateSkillSchema,
  type CreateSkillInput,
  type UpdateRoutingSettingsInput,
  type UpdateSkillInput,
} from '@bizchat/validation';
import { AuthorizationGuard } from '../auth/authorization.guard';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators';
import { OriginGuard } from '../auth/origin.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { AuthContext, AuthenticatedRequest } from '../common/http.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RoutingSettingsService } from './routing-settings.service';
import { SkillService } from './skill.service';

@Controller()
@UseGuards(SessionAuthGuard, AuthorizationGuard)
export class RoutingConfigController {
  public constructor(
    private readonly skills: SkillService,
    private readonly settings: RoutingSettingsService,
  ) {}

  @Get('skills')
  @RequirePermissions('department:manage')
  public listSkills(@CurrentAuth() auth: AuthContext): Promise<SkillResponse[]> {
    return this.skills.list(auth);
  }

  @Post('skills')
  @UseGuards(OriginGuard)
  @RequirePermissions('department:manage')
  public createSkill(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createSkillSchema)) input: CreateSkillInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<SkillResponse> {
    return this.skills.create(auth, input, request.requestId, request.ip);
  }

  @Patch('skills/:id')
  @UseGuards(OriginGuard)
  @RequirePermissions('department:manage')
  public updateSkill(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSkillSchema)) input: UpdateSkillInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<SkillResponse> {
    return this.skills.update(auth, id, input, request.requestId, request.ip);
  }

  @Get('routing/settings')
  @RequirePermissions('settings:manage')
  public getSettings(@CurrentAuth() auth: AuthContext): Promise<RoutingSettingsResponse> {
    return this.settings.get(auth);
  }

  @Put('routing/settings')
  @UseGuards(OriginGuard)
  @RequirePermissions('settings:manage')
  public updateSettings(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(updateRoutingSettingsSchema)) input: UpdateRoutingSettingsInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<RoutingSettingsResponse> {
    return this.settings.update(auth, input, request.requestId, request.ip);
  }
}
