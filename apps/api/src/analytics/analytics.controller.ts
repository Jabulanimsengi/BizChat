import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { AnalyticsOverviewResponse, ConsultantAnalyticsRow } from '@bizchat/types';
import { analyticsQuerySchema, type AnalyticsQueryInput } from '@bizchat/validation';
import { AuthorizationGuard } from '../auth/authorization.guard';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { AuthContext } from '../common/http.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
@UseGuards(SessionAuthGuard, AuthorizationGuard)
export class AnalyticsController {
  public constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @RequirePermissions('analytics:view')
  public overview(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQueryInput,
  ): Promise<AnalyticsOverviewResponse> {
    return this.analytics.overview(auth, query);
  }

  @Get('consultants')
  @RequirePermissions('analytics:view')
  public consultants(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQueryInput,
  ): Promise<ConsultantAnalyticsRow[]> {
    return this.analytics.consultants(auth, query);
  }
}
