import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const ATTACHMENT_OBJECT_STORE = Symbol('ATTACHMENT_OBJECT_STORE');

export interface AttachmentObjectStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  healthCheck(): Promise<void>;
}

export function assertAttachmentStorageKey(key: string): void {
  if (!/^attachments\/[0-9a-f-]{36}$/i.test(key)) {
    throw new BadRequestException({
      code: 'ATTACHMENT_STORAGE_KEY_INVALID',
      message: 'Attachment storage reference is invalid',
    });
  }
}

export class FilesystemAttachmentObjectStore implements AttachmentObjectStore {
  private readonly root: string;

  public constructor(root: string) {
    this.root = resolve(root);
  }

  public async put(key: string, body: Buffer): Promise<void> {
    const target = this.pathFor(key);
    await mkdir(resolve(this.root, 'attachments'), { recursive: true, mode: 0o700 });
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, body, { mode: 0o600 });
    await rename(temporary, target);
  }

  public get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  public async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  public async healthCheck(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const details = await stat(this.root);
    if (!details.isDirectory()) throw new Error('Attachment storage root is not a directory');
  }

  private pathFor(key: string): string {
    assertAttachmentStorageKey(key);
    const target = resolve(this.root, key);
    if (!target.startsWith(`${this.root}\\`) && !target.startsWith(`${this.root}/`)) {
      throw new BadRequestException({
        code: 'ATTACHMENT_STORAGE_KEY_INVALID',
        message: 'Attachment storage reference is invalid',
      });
    }
    return target;
  }
}

export interface S3AttachmentObjectStoreOptions {
  region: string;
  endpoint?: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  prefix: string;
  serverSideEncryption: boolean;
}

export class S3AttachmentObjectStore implements AttachmentObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly serverSideEncryption: boolean;

  public constructor(options: S3AttachmentObjectStoreOptions) {
    this.bucket = options.bucket;
    this.prefix = options.prefix.replace(/^\/+|\/+$/g, '');
    this.serverSideEncryption = options.serverSideEncryption;
    this.client = new S3Client({
      region: options.region,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      forcePathStyle: options.forcePathStyle,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  public async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
        Body: body,
        ContentType: contentType,
        ...(this.serverSideEncryption ? { ServerSideEncryption: 'AES256' as const } : {}),
      }),
    );
  }

  public async get(key: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
    );
    if (!result.Body) {
      throw new InternalServerErrorException({
        code: 'ATTACHMENT_STORAGE_FAILED',
        message: 'The attachment could not be read',
      });
    }
    return Buffer.from(await result.Body.transformToByteArray());
  }

  public async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
    );
  }

  public async healthCheck(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  private objectKey(key: string): string {
    assertAttachmentStorageKey(key);
    return this.prefix ? `${this.prefix}/${key}` : key;
  }
}
