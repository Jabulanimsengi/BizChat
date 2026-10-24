import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type {
  IntakeFormResponse,
  RoutingSettingsResponse,
  SkillResponse,
  TopicResponse,
  TopicTestResponse,
} from '@bizchat/types';
import {
  createIntakeFormSchema,
  createSkillSchema,
  createTopicSchema,
  topicTestSchema,
  updateIntakeFormSchema,
  updateRoutingSettingsSchema,
  updateSkillSchema,
  updateTopicSchema,
  type CreateIntakeFormInput,
  type CreateSkillInput,
  type CreateTopicInput,
  type TopicTestInput,
  type UpdateIntakeFormInput,
  type UpdateRoutingSettingsInput,
  type UpdateSkillInput,
  type UpdateTopicInput,
} from '@bizchat/validation';
import { AuthorizationGuard } from '../auth/authorization.guard';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators';
import { OriginGuard } from '../auth/origin.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { AuthContext, AuthenticatedRequest } from '../common/http.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { IntakeFormAdminService } from './intake-form-admin.service';
import { RoutingSettingsService } from './routing-settings.service';
import { SkillService } from './skill.service';
import { TopicService } from './topic.service';

@Controller()
@UseGuards(SessionAuthGuard, AuthorizationGuard)
export class RoutingConfigController {
  public constructor(
    private readonly skills: SkillService,
    private readonly settings: RoutingSettingsService,
    private readonly topics: TopicService,
    private readonly forms: IntakeFormAdminService,
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

  @Get('topics')
  @RequirePermissions('department:manage')
  public listTopics(@CurrentAuth() auth: AuthContext): Promise<TopicResponse[]> {
    return this.topics.list(auth);
  }

  @Post('topics')
  @UseGuards(OriginGuard)
  @RequirePermissions('department:manage')
  public createTopic(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createTopicSchema)) input: CreateTopicInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<TopicResponse> {
    return this.topics.create(auth, input, request.requestId, request.ip);
  }

  @Patch('topics/:id')
  @UseGuards(OriginGuard)
  @RequirePermissions('department:manage')
  public updateTopic(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateTopicSchema)) input: UpdateTopicInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<TopicResponse> {
    return this.topics.update(auth, id, input, request.requestId, request.ip);
  }

  /** Previews how a message would be classified, without creating anything. */
  @Post('topics/test')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OriginGuard)
  @RequirePermissions('department:manage')
  public testTopic(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(topicTestSchema)) input: TopicTestInput,
  ): Promise<TopicTestResponse> {
    return this.topics.test(auth, input.message);
  }

  @Get('intake-forms')
  @RequirePermissions('department:manage')
  public listForms(@CurrentAuth() auth: AuthContext): Promise<IntakeFormResponse[]> {
    return this.forms.list(auth);
  }

  @Post('intake-forms')
  @UseGuards(OriginGuard)
  @RequirePermissions('department:manage')
  public createForm(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createIntakeFormSchema)) input: CreateIntakeFormInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<IntakeFormResponse> {
    return this.forms.create(auth, input, request.requestId, request.ip);
  }

  @Patch('intake-forms/:id')
  @UseGuards(OriginGuard)
  @RequirePermissions('department:manage')
  public updateForm(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateIntakeFormSchema)) input: UpdateIntakeFormInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<IntakeFormResponse> {
    return this.forms.update(auth, id, input, request.requestId, request.ip);
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
