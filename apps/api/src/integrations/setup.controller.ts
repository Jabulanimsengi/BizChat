import {
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type {
  BusinessHoursResponse,
  DepartmentResponse,
  IntakeFormResponse,
  RoutingSettingsResponse,
  SkillResponse,
  TopicResponse,
  TopicTestResponse,
} from '@bizchat/types';
import {
  createDepartmentSchema,
  createIntakeFormSchema,
  createSkillSchema,
  createTopicSchema,
  setupConsultantSchema,
  topicTestSchema,
  updateBusinessHoursSchema,
  updateDepartmentSchema,
  updateIntakeFormSchema,
  updateRoutingSettingsSchema,
  updateSkillSchema,
  updateTopicSchema,
  type CreateDepartmentInput,
  type CreateIntakeFormInput,
  type CreateSkillInput,
  type CreateTopicInput,
  type SetupConsultantInput,
  type TopicTestInput,
  type UpdateBusinessHoursInput,
  type UpdateDepartmentInput,
  type UpdateIntakeFormInput,
  type UpdateRoutingSettingsInput,
  type UpdateSkillInput,
  type UpdateTopicInput,
} from '@bizchat/validation';
import { BusinessHoursService } from '../business-hours/business-hours.service';
import type { AuthContext, RequestWithId } from '../common/http.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../database/prisma.service';
import { DepartmentService } from '../departments/department.service';
import { IntakeFormAdminService } from '../routing-config/intake-form-admin.service';
import { RoutingSettingsService } from '../routing-config/routing-settings.service';
import { SkillService } from '../routing-config/skill.service';
import { TopicService } from '../routing-config/topic.service';
import { BusinessUsersService } from '../users/business-users.service';
import {
  IntegrationGuard,
  IntegrationScopeRequired,
  type IntegrationRequest,
} from './integration.guard';

export type SetupRequest = IntegrationRequest & RequestWithId;

/** Consultant routing as the setup API shows it. */
export interface SetupConsultant {
  membershipId: string;
  displayName: string;
  email: string;
  role: string;
  status: string;
  maxConcurrentChats: number;
  routingEnabled: boolean;
  departmentIds: string[];
  skills: { skillId: string; proficiency: number }[];
}

/**
 * Runs the dashboard's own configuration services for an integration key, so API and dashboard
 * changes share validation, audit records, catalogue invalidation, and queue drains. The key acts as
 * an administrator without a person: it cannot change owners, roles, names, or account status.
 */
@Injectable()
export class SetupContextService {
  public constructor(private readonly prisma: PrismaService) {}

  public async auth(request: IntegrationRequest): Promise<AuthContext> {
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: request.integration.businessId },
      select: {
        id: true,
        name: true,
        slug: true,
        publicId: true,
        status: true,
        timezone: true,
        defaultLocale: true,
      },
    });
    return {
      sessionId: `integration:${request.integration.keyId}`,
      user: {
        id: '',
        email: '',
        displayName: 'Integration',
        status: 'ACTIVE',
        emailVerified: true,
      },
      membership: { id: '', role: 'ADMIN', status: 'ACTIVE' },
      business,
      integrationKeyId: request.integration.keyId,
    };
  }
}

@Controller('integrations/setup')
@UseGuards(IntegrationGuard)
export class SetupController {
  public constructor(
    private readonly context: SetupContextService,
    private readonly departments: DepartmentService,
    private readonly skills: SkillService,
    private readonly topics: TopicService,
    private readonly forms: IntakeFormAdminService,
    private readonly settings: RoutingSettingsService,
    private readonly hours: BusinessHoursService,
    private readonly users: BusinessUsersService,
  ) {}

  @Get('departments')
  @IntegrationScopeRequired('setup:read')
  public async listDepartments(@Req() request: SetupRequest): Promise<DepartmentResponse[]> {
    return this.departments.list(await this.context.auth(request));
  }

  @Post('departments')
  @IntegrationScopeRequired('setup:write')
  public async createDepartment(
    @Req() request: SetupRequest,
    @Body(new ZodValidationPipe(createDepartmentSchema)) input: CreateDepartmentInput,
  ): Promise<DepartmentResponse> {
    return this.departments.create(
      await this.context.auth(request),
      input,
      request.requestId,
      request.ip,
    );
  }

  @Patch('departments/:id')
  @IntegrationScopeRequired('setup:write')
  public async updateDepartment(
    @Req() request: SetupRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateDepartmentSchema)) input: UpdateDepartmentInput,
  ): Promise<DepartmentResponse> {
    return this.departments.update(
      await this.context.auth(request),
      id,
      input,
      request.requestId,
      request.ip,
    );
  }

  @Get('skills')
  @IntegrationScopeRequired('setup:read')
  public async listSkills(@Req() request: SetupRequest): Promise<SkillResponse[]> {
    return this.skills.list(await this.context.auth(request));
  }

  @Post('skills')
  @IntegrationScopeRequired('setup:write')
  public async createSkill(
    @Req() request: SetupRequest,
    @Body(new ZodValidationPipe(createSkillSchema)) input: CreateSkillInput,
  ): Promise<SkillResponse> {
    return this.skills.create(
      await this.context.auth(request),
      input,
      request.requestId,
      request.ip,
    );
  }

  @Patch('skills/:id')
  @IntegrationScopeRequired('setup:write')
  public async updateSkill(
    @Req() request: SetupRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSkillSchema)) input: UpdateSkillInput,
  ): Promise<SkillResponse> {
    return this.skills.update(
      await this.context.auth(request),
      id,
      input,
      request.requestId,
      request.ip,
    );
  }

  @Get('topics')
  @IntegrationScopeRequired('setup:read')
  public async listTopics(@Req() request: SetupRequest): Promise<TopicResponse[]> {
    return this.topics.list(await this.context.auth(request));
  }

  @Post('topics')
  @IntegrationScopeRequired('setup:write')
  public async createTopic(
    @Req() request: SetupRequest,
    @Body(new ZodValidationPipe(createTopicSchema)) input: CreateTopicInput,
  ): Promise<TopicResponse> {
    return this.topics.create(
      await this.context.auth(request),
      input,
      request.requestId,
      request.ip,
    );
  }

  @Patch('topics/:id')
  @IntegrationScopeRequired('setup:write')
  public async updateTopic(
    @Req() request: SetupRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateTopicSchema)) input: UpdateTopicInput,
  ): Promise<TopicResponse> {
    return this.topics.update(
      await this.context.auth(request),
      id,
      input,
      request.requestId,
      request.ip,
    );
  }

  /** Previews how a message would be classified, without creating anything. */
  @Post('topics/test')
  @HttpCode(200)
  @IntegrationScopeRequired('setup:read')
  public async testTopic(
    @Req() request: SetupRequest,
    @Body(new ZodValidationPipe(topicTestSchema)) input: TopicTestInput,
  ): Promise<TopicTestResponse> {
    return this.topics.test(await this.context.auth(request), input.message);
  }

  @Get('intake-forms')
  @IntegrationScopeRequired('setup:read')
  public async listForms(@Req() request: SetupRequest): Promise<IntakeFormResponse[]> {
    return this.forms.list(await this.context.auth(request));
  }

  @Post('intake-forms')
  @IntegrationScopeRequired('setup:write')
  public async createForm(
    @Req() request: SetupRequest,
    @Body(new ZodValidationPipe(createIntakeFormSchema)) input: CreateIntakeFormInput,
  ): Promise<IntakeFormResponse> {
    return this.forms.create(
      await this.context.auth(request),
      input,
      request.requestId,
      request.ip,
    );
  }

  @Patch('intake-forms/:id')
  @IntegrationScopeRequired('setup:write')
  public async updateForm(
    @Req() request: SetupRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateIntakeFormSchema)) input: UpdateIntakeFormInput,
  ): Promise<IntakeFormResponse> {
    return this.forms.update(
      await this.context.auth(request),
      id,
      input,
      request.requestId,
      request.ip,
    );
  }

  @Get('routing-settings')
  @IntegrationScopeRequired('setup:read')
  public async getSettings(@Req() request: SetupRequest): Promise<RoutingSettingsResponse> {
    return this.settings.get(await this.context.auth(request));
  }

  @Put('routing-settings')
  @IntegrationScopeRequired('setup:write')
  public async updateSettings(
    @Req() request: SetupRequest,
    @Body(new ZodValidationPipe(updateRoutingSettingsSchema)) input: UpdateRoutingSettingsInput,
  ): Promise<RoutingSettingsResponse> {
    return this.settings.update(
      await this.context.auth(request),
      input,
      request.requestId,
      request.ip,
    );
  }

  @Get('business-hours')
  @IntegrationScopeRequired('setup:read')
  public async getHours(@Req() request: SetupRequest): Promise<BusinessHoursResponse> {
    const auth = await this.context.auth(request);
    return this.hours.get(auth.business.id, auth.business.timezone);
  }

  @Put('business-hours')
  @IntegrationScopeRequired('setup:write')
  public async updateHours(
    @Req() request: SetupRequest,
    @Body(new ZodValidationPipe(updateBusinessHoursSchema)) input: UpdateBusinessHoursInput,
  ): Promise<BusinessHoursResponse> {
    return this.hours.update(
      await this.context.auth(request),
      input,
      request.requestId,
      request.ip,
    );
  }

  /** Consultants are invited in the dashboard; the API sets how they are routed. */
  @Get('consultants')
  @IntegrationScopeRequired('setup:read')
  public async listConsultants(@Req() request: SetupRequest): Promise<SetupConsultant[]> {
    return (await this.users.list(request.integration.businessId)).map(consultant);
  }

  @Patch('consultants/:membershipId')
  @IntegrationScopeRequired('setup:write')
  public async updateConsultant(
    @Req() request: SetupRequest,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body(new ZodValidationPipe(setupConsultantSchema)) input: SetupConsultantInput,
  ): Promise<SetupConsultant> {
    const users = await this.users.list(request.integration.businessId);
    if (!users.some((user) => user.membershipId === membershipId))
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'Consultant not found' });
    return consultant(
      await this.users.update(
        await this.context.auth(request),
        membershipId,
        input,
        request.requestId,
        request.ip,
      ),
    );
  }
}

function consultant(user: {
  membershipId: string;
  displayName: string;
  email: string;
  role: string;
  status: string;
  maxConcurrentChats: number;
  routingEnabled: boolean;
  departmentIds: string[];
  skills: { skillId: string; proficiency: number }[];
}): SetupConsultant {
  return {
    membershipId: user.membershipId,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    status: user.status,
    maxConcurrentChats: user.maxConcurrentChats,
    routingEnabled: user.routingEnabled,
    departmentIds: user.departmentIds,
    skills: user.skills,
  };
}
