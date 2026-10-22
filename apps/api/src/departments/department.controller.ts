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
import type { DepartmentResponse } from '@bizchat/types';
import {
  createDepartmentSchema,
  updateAgentDepartmentsSchema,
  updateDepartmentSchema,
  type CreateDepartmentInput,
  type UpdateAgentDepartmentsInput,
  type UpdateDepartmentInput,
} from '@bizchat/validation';
import { AuthorizationGuard } from '../auth/authorization.guard';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators';
import { OriginGuard } from '../auth/origin.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { AuthContext, AuthenticatedRequest } from '../common/http.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DepartmentService } from './department.service';

@Controller('departments')
@UseGuards(SessionAuthGuard, AuthorizationGuard)
export class DepartmentController {
  public constructor(private readonly departments: DepartmentService) {}

  @Get()
  @RequirePermissions('conversation:view_assigned')
  public list(@CurrentAuth() auth: AuthContext): Promise<DepartmentResponse[]> {
    return this.departments.list(auth);
  }

  @Post()
  @UseGuards(OriginGuard)
  @RequirePermissions('department:manage')
  public create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createDepartmentSchema)) input: CreateDepartmentInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<DepartmentResponse> {
    return this.departments.create(auth, input, request.requestId, request.ip);
  }

  @Patch(':id')
  @UseGuards(OriginGuard)
  @RequirePermissions('department:manage')
  public update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateDepartmentSchema)) input: UpdateDepartmentInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<DepartmentResponse> {
    return this.departments.update(auth, id, input, request.requestId, request.ip);
  }

  @Put('mine')
  @UseGuards(OriginGuard)
  @RequirePermissions('conversation:view_assigned')
  public setMine(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(updateAgentDepartmentsSchema)) input: UpdateAgentDepartmentsInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ departmentIds: string[] }> {
    return this.departments.setMine(auth, input, request.requestId, request.ip);
  }
}
