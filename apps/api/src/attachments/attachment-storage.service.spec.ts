import { ConfigService } from '@nestjs/config';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Environment } from '../config/environment';
import type { AttachmentObjectStore } from './attachment-object-store';
import {
  AttachmentRejectedError,
  DisabledAttachmentScanner,
  type AttachmentScanner,
  type AttachmentScanResult,
} from './attachment-scanner.service';
import { AttachmentStorageService } from './attachment-storage.service';

class MemoryObjectStore implements AttachmentObjectStore {
  public readonly objects = new Map<string, Buffer>();

  public put(key: string, body: Buffer): Promise<void> {
    this.objects.set(key, body);
    return Promise.resolve();
  }

  public get(key: string): Promise<Buffer> {
    const value = this.objects.get(key);
    if (!value) throw new Error(`missing object ${key}`);
    return Promise.resolve(value);
  }

  public delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  public healthCheck(): Promise<void> {
    return Promise.resolve();
  }
}

class FixedScanner implements AttachmentScanner {
  public constructor(private readonly result: AttachmentScanResult) {}

  public scan(): Promise<AttachmentScanResult> {
    return Promise.resolve(this.result);
  }
}

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);

describe('AttachmentStorageService', () => {
  let root: string;
  let staging: string;

  const build = (
    store: AttachmentObjectStore = new MemoryObjectStore(),
    scanner: AttachmentScanner = new DisabledAttachmentScanner(),
  ): AttachmentStorageService =>
    new AttachmentStorageService(store, scanner, { get: () => root } as unknown as ConfigService<
      Environment,
      true
    >);

  const stage = async (content: Buffer, name = 'staged-upload'): Promise<string> => {
    const path = join(staging, name);
    await writeFile(path, content);
    return path;
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'bizchat-attachments-'));
    staging = join(root, '.tmp');
    await mkdir(staging, { recursive: true, mode: 0o700 });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('validates, scans, and stores an upload as a private object', async () => {
    const store = new MemoryObjectStore();
    const service = build(store);
    const path = await stage(png);
    const stored = await service.store({
      originalname: 'photo.png',
      mimetype: 'image/png',
      size: png.length,
      path,
    });

    expect(stored.storageKey).toMatch(/^attachments\/[0-9a-f-]{36}$/);
    expect(stored.sha256).toHaveLength(64);
    expect(store.objects.get(stored.storageKey)?.equals(png)).toBe(true);
    await expect(readFile(path)).rejects.toThrow();
    await expect(service.read(stored.storageKey)).resolves.toEqual(png);
    await service.remove(stored.storageKey);
    expect(store.objects.size).toBe(0);
  });

  it('rejects mismatched content and removes the staged file', async () => {
    const service = build();
    const content = Buffer.from('not a PDF');
    const path = await stage(content);
    await expect(
      service.store({
        originalname: 'invoice.pdf',
        mimetype: 'application/pdf',
        size: content.length,
        path,
      }),
    ).rejects.toThrow('Only JPEG');
    await expect(readFile(path)).rejects.toThrow();
  });

  it('rejects malware before anything is persisted', async () => {
    const store = new MemoryObjectStore();
    const service = build(store, new FixedScanner({ clean: false, signature: 'Eicar-Test' }));
    const path = await stage(png);
    await expect(
      service.store({ originalname: 'photo.png', mimetype: 'image/png', size: png.length, path }),
    ).rejects.toBeInstanceOf(AttachmentRejectedError);
    expect(store.objects.size).toBe(0);
    await expect(readFile(path)).rejects.toThrow();
  });

  it('rejects an oversized upload', async () => {
    const service = build();
    const path = await stage(png);
    await expect(
      service.store({
        originalname: 'photo.png',
        mimetype: 'image/png',
        size: 11 * 1024 * 1024,
        path,
      }),
    ).rejects.toThrow();
  });

  it('refuses a staging path outside the configured root', async () => {
    const service = build();
    await expect(
      service.store({
        originalname: 'photo.png',
        mimetype: 'image/png',
        size: 1,
        path: join(tmpdir(), 'x'),
      }),
    ).rejects.toThrow('staging reference is invalid');
  });
});
