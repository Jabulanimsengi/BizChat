import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Attachment } from '@prisma/client';
import type { MessageResponse } from '@bizchat/types';
import type { AttachmentMessageInput } from '@bizchat/validation';
import type { AuthContext } from '../common/http.types';
import { AuditService } from '../audit/audit.service';
import { ConversationService } from '../conversations/conversation.service';
import { PrismaService } from '../database/prisma.service';
import { WidgetService } from '../widget/widget.service';
import {
  AttachmentStorageService,
  type StoredAttachment,
  type UploadedAttachmentFile,
} from './attachment-storage.service';
import { AttachmentRejectedError } from './attachment-scanner.service';

@Injectable()
export class AttachmentService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly storage: AttachmentStorageService,
    private readonly conversations: ConversationService,
    private readonly widgets: WidgetService,
    private readonly audit: AuditService,
  ) {}

  public async uploadForDashboard(
    auth: AuthContext,
    conversationId: string,
    input: AttachmentMessageInput,
    file: UploadedAttachmentFile,
    requestId: string,
    ipAddress?: string,
  ): Promise<MessageResponse> {
    await this.conversations.authorizeDashboard(auth, conversationId);
    const stored = await this.scanOrReject(file, {
      businessId: auth.business.id,
      actorUserId: auth.user.id,
      conversationId,
      requestId,
      ipAddress,
    });
    try {
      const result = await this.conversations.sendAgentAttachment(auth, conversationId, {
        ...input,
        conversationId,
        attachment: {
          ...stored,
          uploadedByType: 'BUSINESS_USER',
          uploadedById: auth.user.id,
          status: 'READY',
        },
      });
      if (!result.created) await this.storage.remove(stored.storageKey);
      await this.audit.record({
        businessId: auth.business.id,
        actorUserId: auth.user.id,
        action: 'attachment.uploaded',
        targetType: 'Attachment',
        targetId: result.message.attachments[0]?.id,
        requestId,
        ipAddress,
        metadata: {
          conversationId,
          fileName: stored.originalFileName,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          sha256: stored.sha256,
        },
      });
      return result.message;
    } catch (error) {
      await this.storage.remove(stored.storageKey);
      throw error;
    }
  }

  public async uploadForVisitor(
    token: string | undefined,
    origin: string | undefined,
    conversationId: string,
    input: AttachmentMessageInput,
    file: UploadedAttachmentFile,
    requestId: string,
    ipAddress?: string,
  ): Promise<MessageResponse> {
    const session = await this.widgets.authenticateSocket(token, origin);
    await this.conversations.authorizeVisitor(
      { businessId: session.businessId, visitorId: session.visitorId },
      conversationId,
    );
    const stored = await this.scanOrReject(file, {
      businessId: session.businessId,
      conversationId,
      requestId,
      ipAddress,
    });
    try {
      const result = await this.conversations.sendVisitorAttachment(
        { businessId: session.businessId, visitorId: session.visitorId },
        {
          ...input,
          conversationId,
          attachment: {
            ...stored,
            uploadedByType: 'VISITOR',
            uploadedById: session.visitorId,
            status: 'READY',
          },
        },
      );
      if (!result.created) await this.storage.remove(stored.storageKey);
      await this.audit.record({
        businessId: session.businessId,
        action: 'attachment.uploaded',
        targetType: 'Attachment',
        targetId: result.message.attachments[0]?.id,
        requestId,
        ipAddress,
        metadata: {
          conversationId,
          visitorId: session.visitorId,
          fileName: stored.originalFileName,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          sha256: stored.sha256,
        },
      });
      return result.message;
    } catch (error) {
      await this.storage.remove(stored.storageKey);
      throw error;
    }
  }

  public async downloadForDashboard(
    auth: AuthContext,
    id: string,
  ): Promise<{ attachment: Attachment; content: Buffer }> {
    const attachment = await this.findReady(id, auth.business.id);
    await this.conversations.authorizeDashboard(auth, attachment.conversationId);
    return { attachment, content: await this.storage.read(attachment.storageKey) };
  }

  public async downloadForVisitor(
    token: string | undefined,
    origin: string | undefined,
    id: string,
  ): Promise<{ attachment: Attachment; content: Buffer }> {
    const session = await this.widgets.authenticateSocket(token, origin);
    const attachment = await this.findReady(id, session.businessId);
    await this.conversations.authorizeVisitor(
      { businessId: session.businessId, visitorId: session.visitorId },
      attachment.conversationId,
    );
    return { attachment, content: await this.storage.read(attachment.storageKey) };
  }

  private async scanOrReject(
    file: UploadedAttachmentFile,
    context: {
      businessId: string;
      actorUserId?: string;
      conversationId: string;
      requestId: string;
      ipAddress?: string;
    },
  ): Promise<StoredAttachment> {
    try {
      return await this.storage.store(file);
    } catch (error) {
      if (error instanceof AttachmentRejectedError) {
        await this.audit.record({
          businessId: context.businessId,
          actorUserId: context.actorUserId,
          action: 'attachment.rejected',
          targetType: 'Conversation',
          targetId: context.conversationId,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          metadata: {
            conversationId: context.conversationId,
            fileName: file.originalname,
            sizeBytes: file.size,
            signature: error.signature,
          },
        });
        throw new BadRequestException({
          code: 'ATTACHMENT_REJECTED',
          message: 'The attachment was rejected by malware scanning',
        });
      }
      throw error;
    }
  }

  private async findReady(id: string, businessId: string): Promise<Attachment> {
    const attachment = await this.prisma.attachment.findFirst({
      where: { id, businessId, status: 'READY' },
    });
    if (!attachment)
      throw new NotFoundException({
        code: 'ATTACHMENT_NOT_FOUND',
        message: 'Attachment not found',
      });
    return attachment;
  }
}
