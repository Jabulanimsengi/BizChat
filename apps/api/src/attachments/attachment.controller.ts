import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { MessageResponse } from '@bizchat/types';
import { attachmentMessageSchema, type AttachmentMessageInput } from '@bizchat/validation';
import type { Request, Response } from 'express';
import { AuthorizationGuard } from '../auth/authorization.guard';
import { CurrentAuth } from '../auth/auth.decorators';
import { OriginGuard } from '../auth/origin.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { AuthContext, AuthenticatedRequest, RequestWithId } from '../common/http.types';
import { AttachmentService } from './attachment.service';
import type { UploadedAttachmentFile } from './attachment-storage.service';

const uploadInterceptor = FileInterceptor('file', {
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5, parts: 10, headerPairs: 200 },
});

@Controller()
export class AttachmentController {
  public constructor(private readonly attachments: AttachmentService) {}
  @Post('conversations/:id/attachments')
  @UseGuards(SessionAuthGuard, AuthorizationGuard, OriginGuard)
  @UseInterceptors(uploadInterceptor)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  public upload(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @UploadedFile() file: UploadedAttachmentFile | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<MessageResponse> {
    return this.attachments.uploadForDashboard(
      auth,
      id,
      parseInput(body),
      requireFile(file),
      request.requestId,
      request.ip,
    );
  }
  @Get('attachments/:id/download')
  @UseGuards(SessionAuthGuard, AuthorizationGuard)
  public async download(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.attachments.downloadForDashboard(auth, id);
    sendDownload(
      response,
      result.attachment.originalFileName,
      result.attachment.mimeType,
      result.content,
    );
  }
}

@Controller('widget')
export class WidgetAttachmentController {
  public constructor(private readonly attachments: AttachmentService) {}
  @Post('conversations/:id/attachments')
  @UseInterceptors(uploadInterceptor)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  public upload(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @UploadedFile() file: UploadedAttachmentFile | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Req() request: RequestWithId,
  ): Promise<MessageResponse> {
    return this.attachments.uploadForVisitor(
      tokenFrom(authorization),
      request.header('origin'),
      id,
      parseInput(body),
      requireFile(file),
      request.requestId,
      request.ip,
    );
  }
  @Get('attachments/:id/download')
  public async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') authorization: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.attachments.downloadForVisitor(
      tokenFrom(authorization),
      request.header('origin'),
      id,
    );
    sendDownload(
      response,
      result.attachment.originalFileName,
      result.attachment.mimeType,
      result.content,
    );
  }
}

function parseInput(body: unknown): AttachmentMessageInput {
  const result = attachmentMessageSchema.safeParse(body);
  if (!result.success)
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'The attachment request is invalid',
      details: result.error.flatten(),
    });
  return result.data;
}
function requireFile(file: UploadedAttachmentFile | undefined): UploadedAttachmentFile {
  if (!file)
    throw new BadRequestException({ code: 'ATTACHMENT_REQUIRED', message: 'A file is required' });
  return file;
}
function tokenFrom(value: string | undefined): string | undefined {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}
function sendDownload(
  response: Response,
  fileName: string,
  mimeType: string,
  content: Buffer,
): void {
  response.setHeader('Content-Type', mimeType);
  response.setHeader('Content-Length', String(content.length));
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );
  response.send(content);
}
