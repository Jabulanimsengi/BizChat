import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { PlanResponse, PlanUsageResponse, PlatformTenantResponse } from '@bizchat/types';
import {
  createPlanSchema,
  platformTenantQuerySchema,
  updatePlanSchema,
  updateTenantSchema,
  type CreatePlanInput,
  type PlatformTenantQuery,
  type UpdatePlanInput,
  type UpdateTenantInput,
} from '@bizchat/validation';
import { AuthorizationGuard } from '../auth/authorization.guard';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators';
import { OriginGuard } from '../auth/origin.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { AuthContext } from '../common/http.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PlanService } from './plan.service';
import { PlatformAdminGuard } from './platform-admin.guard';

/** A tenant's own plan and usage, for owners and admins. */
@Controller('plan')
@UseGuards(SessionAuthGuard, AuthorizationGuard)
export class PlanController {
  public constructor(private readonly plans: PlanService) {}

  @Get()
  @RequirePermissions('settings:manage')
  public usage(@CurrentAuth() auth: AuthContext): Promise<PlanUsageResponse> {
    return this.plans.usage(auth.business.id);
  }
}

/** Platform administration: plans and tenants across the whole installation. */
@Controller('platform')
@UseGuards(SessionAuthGuard, PlatformAdminGuard)
export class PlatformController {
  public constructor(private readonly plans: PlanService) {}

  @Get('plans')
  public listPlans(): Promise<PlanResponse[]> {
    return this.plans.listPlans();
  }

  @Post('plans')
  @UseGuards(OriginGuard)
  public createPlan(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createPlanSchema)) input: CreatePlanInput,
  ): Promise<PlanResponse> {
    return this.plans.createPlan(auth, input);
  }

  @Patch('plans/:id')
  @UseGuards(OriginGuard)
  public updatePlan(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updatePlanSchema)) input: UpdatePlanInput,
  ): Promise<PlanResponse> {
    return this.plans.updatePlan(auth, id, input);
  }

  @Get('tenants')
  public listTenants(
    @Query(new ZodValidationPipe(platformTenantQuerySchema)) query: PlatformTenantQuery,
  ): Promise<PlatformTenantResponse[]> {
    return this.plans.listTenants(query);
  }

  @Patch('tenants/:id')
  @UseGuards(OriginGuard)
  public updateTenant(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateTenantSchema)) input: UpdateTenantInput,
  ): Promise<PlatformTenantResponse> {
    return this.plans.updateTenant(auth, id, input);
  }
}
