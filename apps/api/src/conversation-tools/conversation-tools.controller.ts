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
import type { CannedResponseResponse, TagResponse } from '@bizchat/types';
import {
  cannedResponseListQuerySchema,
  createCannedResponseSchema,
  createTagSchema,
  updateCannedResponseSchema,
  updateTagSchema,
  type CannedResponseListQuery,
  type CreateCannedResponseInput,
  type CreateTagInput,
  type UpdateCannedResponseInput,
  type UpdateTagInput,
} from '@bizchat/validation';
import { AuthorizationGuard } from '../auth/authorization.guard';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators';
import { OriginGuard } from '../auth/origin.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { AuthContext } from '../common/http.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CannedResponseService } from './canned-response.service';
import { TagService } from './tag.service';

@Controller()
@UseGuards(SessionAuthGuard, AuthorizationGuard)
export class ConversationToolsController {
  public constructor(
    private readonly tags: TagService,
    private readonly canned: CannedResponseService,
  ) {}
  @Get('tags')
  @RequirePermissions('conversation:view_assigned')
  public listTags(@CurrentAuth() auth: AuthContext): Promise<TagResponse[]> {
    return this.tags.list(auth);
  }
  @Post('tags')
  @UseGuards(OriginGuard)
  @RequirePermissions('settings:manage')
  public createTag(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createTagSchema)) input: CreateTagInput,
  ): Promise<TagResponse> {
    return this.tags.create(auth, input);
  }
  @Patch('tags/:id')
  @UseGuards(OriginGuard)
  @RequirePermissions('settings:manage')
  public updateTag(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateTagSchema)) input: UpdateTagInput,
  ): Promise<TagResponse> {
    return this.tags.update(auth, id, input);
  }
  @Get('canned-responses')
  @RequirePermissions('conversation:view_assigned')
  public listCanned(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(cannedResponseListQuerySchema)) query: CannedResponseListQuery,
  ): Promise<CannedResponseResponse[]> {
    return this.canned.list(auth, query);
  }
  @Post('canned-responses')
  @UseGuards(OriginGuard)
  @RequirePermissions('settings:manage')
  public createCanned(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createCannedResponseSchema)) input: CreateCannedResponseInput,
  ): Promise<CannedResponseResponse> {
    return this.canned.create(auth, input);
  }
  @Patch('canned-responses/:id')
  @UseGuards(OriginGuard)
  @RequirePermissions('settings:manage')
  public updateCanned(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateCannedResponseSchema)) input: UpdateCannedResponseInput,
  ): Promise<CannedResponseResponse> {
    return this.canned.update(auth, id, input);
  }
}
