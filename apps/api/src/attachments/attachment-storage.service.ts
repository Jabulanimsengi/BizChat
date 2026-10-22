import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rm, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { Environment } from '../config/environment';
import { ATTACHMENT_OBJECT_STORE, type AttachmentObjectStore } from './attachment-object-store';
import {
  ATTACHMENT_SCANNER,
  AttachmentRejectedError,
  type AttachmentScanner,
} from './attachment-scanner.service';

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export interface UploadedAttachmentFile {
  originalname: string;
  mimetype: string;
  size: number;
  path: string;
}

export interface StoredAttachment {
  originalFileName: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

@Injectable()
export class AttachmentStorageService {
  private readonly stagingRoot: string;

  public constructor(
    @Inject(ATTACHMENT_OBJECT_STORE) private readonly objectStore: AttachmentObjectStore,
    @Inject(ATTACHMENT_SCANNER) private readonly scanner: AttachmentScanner,
    config: ConfigService<Environment, true>,
  ) {
    this.stagingRoot = resolve(
      process.cwd(),
      config.get('ATTACHMENT_STORAGE_PATH', { infer: true }),
      '.tmp',
    );
  }

  public async store(file: UploadedAttachmentFile): Promise<StoredAttachment> {
    const temporaryPath = resolve(file.path);
    if (
      !temporaryPath.startsWith(`${this.stagingRoot}\\`) &&
      !temporaryPath.startsWith(`${this.stagingRoot}/`)
    ) {
      throw new BadRequestException({
        code: 'ATTACHMENT_STORAGE_KEY_INVALID',
        message: 'Attachment staging reference is invalid',
      });
    }
    const details = await stat(temporaryPath).catch(() => undefined);
    if (!details?.isFile() || details.size !== file.size) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw new BadRequestException({
        code: 'ATTACHMENT_REQUIRED',
        message: 'A complete file is required',
      });
    }
    let buffer: Buffer;
    let valid: { originalFileName: string; mimeType: string };
    try {
      buffer = await readFile(temporaryPath);
      valid = validateAttachment(file, buffer);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
    try {
      const scan = await this.scanner.scan({
        buffer,
        fileName: valid.originalFileName,
      });
      if (!scan.clean) throw new AttachmentRejectedError(scan.signature);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
    const storageKey = `attachments/${randomUUID()}`;
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    try {
      await this.objectStore.put(storageKey, buffer, valid.mimeType);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw new InternalServerErrorException({
        code: 'ATTACHMENT_STORAGE_FAILED',
        message: 'The attachment could not be stored',
        cause: error instanceof Error ? error.message : undefined,
      });
    }
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    return {
      originalFileName: valid.originalFileName,
      storageKey,
      mimeType: valid.mimeType,
      sizeBytes: file.size,
      sha256,
    };
  }

  public read(storageKey: string): Promise<Buffer> {
    return this.objectStore.get(storageKey);
  }

  public remove(storageKey: string): Promise<void> {
    return this.objectStore.delete(storageKey);
  }
}

export function validateAttachment(
  file: UploadedAttachmentFile,
  buffer: Buffer,
): { originalFileName: string; mimeType: string } {
  if (!buffer.length || file.size !== buffer.length)
    throw new BadRequestException({ code: 'ATTACHMENT_REQUIRED', message: 'A file is required' });
  if (file.size > MAX_ATTACHMENT_BYTES)
    throw new BadRequestException({
      code: 'ATTACHMENT_TOO_LARGE',
      message: 'Attachments are limited to 10 MB',
    });
  const originalFileName = sanitizeFileName(file.originalname);
  if (!originalFileName)
    throw new BadRequestException({
      code: 'ATTACHMENT_FILENAME_INVALID',
      message: 'The attachment filename is invalid',
    });
  const extension = originalFileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  const detected = detectMime(buffer);
  const allowed: Record<string, { extensions: string[]; mime: string }> = {
    'image/jpeg': { extensions: ['jpg', 'jpeg'], mime: 'image/jpeg' },
    'image/png': { extensions: ['png'], mime: 'image/png' },
    'image/gif': { extensions: ['gif'], mime: 'image/gif' },
    'image/webp': { extensions: ['webp'], mime: 'image/webp' },
    'application/pdf': { extensions: ['pdf'], mime: 'application/pdf' },
    'text/plain': { extensions: ['txt', 'csv'], mime: 'text/plain' },
  };
  const definition = detected ? allowed[detected] : undefined;
  if (
    !definition ||
    !definition.extensions.includes(extension) ||
    file.mimetype !== definition.mime
  )
    throw new BadRequestException({
      code: 'ATTACHMENT_TYPE_REJECTED',
      message: 'Only JPEG, PNG, GIF, WebP, PDF, and plain-text attachments are allowed',
    });
  return { originalFileName, mimeType: definition.mime };
}

export function detectMime(buffer: Buffer): string | undefined {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  if (
    buffer.subarray(0, 6).toString('ascii') === 'GIF87a' ||
    buffer.subarray(0, 6).toString('ascii') === 'GIF89a'
  )
    return 'image/gif';
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp';
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (!buffer.includes(0) && isUtf8(buffer)) return 'text/plain';
  return undefined;
}

function isUtf8(buffer: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

function sanitizeFileName(value: string): string {
  return [...basename(value).replace(/[\\/:*?"<>|]/g, '_')]
    .map((character) => (character.charCodeAt(0) < 32 ? '_' : character))
    .join('')
    .trim()
    .slice(0, 255);
}
