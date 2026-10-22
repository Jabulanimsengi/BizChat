import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { AuditLogPage } from '@bizchat/types';
import { auditLogQuerySchema, type AuditLogQuery } from '@bizchat/validation';
import { AuthorizationGuard } from '../auth/authorization.guard';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { AuthContext } from '../common/http.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuditService } from './audit.service';

@Controller('audit-logs')
@UseGuards(SessionAuthGuard, AuthorizationGuard)
@RequirePermissions('audit:view')
export class AuditController {
  public constructor(private readonly audit: AuditService) {}
  @Get()
  public list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(auditLogQuerySchema)) query: AuditLogQuery,
  ): Promise<AuditLogPage> {
    return this.audit.list(auth.business.id, query);
  }
}
