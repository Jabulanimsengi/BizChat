import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { diskStorage } from 'multer';
import { AuthModule } from '../auth/auth.module';
import type { Environment } from '../config/environment';
import { ConversationModule } from '../conversations/conversation.module';
import { WidgetModule } from '../widget/widget.module';
import { AttachmentController, WidgetAttachmentController } from './attachment.controller';
import { AttachmentService } from './attachment.service';
import { AttachmentMaintenanceService } from './attachment-maintenance.service';
import { AttachmentStorageService } from './attachment-storage.service';
import {
  ATTACHMENT_OBJECT_STORE,
  FilesystemAttachmentObjectStore,
  S3AttachmentObjectStore,
  type AttachmentObjectStore,
} from './attachment-object-store';
import {
  ATTACHMENT_SCANNER,
  ClamavAttachmentScanner,
  DisabledAttachmentScanner,
  type AttachmentScanner,
} from './attachment-scanner.service';

@Module({
  imports: [
    AuthModule,
    ConversationModule,
    WidgetModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService<Environment, true>) => {
        const destination = resolve(
          process.cwd(),
          config.get('ATTACHMENT_STORAGE_PATH', { infer: true }),
          '.tmp',
        );
        await mkdir(destination, { recursive: true, mode: 0o700 });
        return {
          storage: diskStorage({
            destination,
            filename: (_request, _file, callback) => callback(null, randomUUID()),
          }),
        };
      },
    }),
  ],
  controllers: [AttachmentController, WidgetAttachmentController],
  providers: [
    AttachmentService,
    AttachmentStorageService,
    AttachmentMaintenanceService,
    {
      provide: ATTACHMENT_OBJECT_STORE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>): AttachmentObjectStore => {
        const root = resolve(process.cwd(), config.get('ATTACHMENT_STORAGE_PATH', { infer: true }));
        if (config.get('ATTACHMENT_STORAGE_DRIVER', { infer: true }) !== 's3') {
          return new FilesystemAttachmentObjectStore(root);
        }
        const bucket = config.get('S3_BUCKET', { infer: true });
        const accessKeyId = config.get('S3_ACCESS_KEY_ID', { infer: true });
        const secretAccessKey = config.get('S3_SECRET_ACCESS_KEY', { infer: true });
        if (!bucket || !accessKeyId || !secretAccessKey) {
          throw new Error('S3 attachment storage requires bucket and credentials');
        }
        return new S3AttachmentObjectStore({
          region: config.get('S3_REGION', { infer: true }),
          endpoint: config.get('S3_ENDPOINT', { infer: true }),
          bucket,
          accessKeyId,
          secretAccessKey,
          forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
          prefix: config.get('S3_PREFIX', { infer: true }),
          serverSideEncryption: config.get('S3_SERVER_SIDE_ENCRYPTION', { infer: true }),
        });
      },
    },
    {
      provide: ATTACHMENT_SCANNER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>): AttachmentScanner =>
        config.get('ATTACHMENT_SCANNER', { infer: true }) === 'clamav'
          ? new ClamavAttachmentScanner({
              host: config.get('CLAMAV_HOST', { infer: true }),
              port: config.get('CLAMAV_PORT', { infer: true }),
              timeoutMs: config.get('CLAMAV_TIMEOUT_MS', { infer: true }),
            })
          : new DisabledAttachmentScanner(),
    },
  ],
  exports: [AttachmentStorageService],
})
export class AttachmentModule {}
