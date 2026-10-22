import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertAttachmentStorageKey,
  FilesystemAttachmentObjectStore,
  type AttachmentObjectStore,
} from './attachment-object-store';

describe('FilesystemAttachmentObjectStore', () => {
  let root: string;
  const key = `attachments/00000000-0000-4000-8000-000000000000`;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'bizchat-store-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes, reads, and deletes objects', async () => {
    const store: AttachmentObjectStore = new FilesystemAttachmentObjectStore(root);
    await store.put(key, Buffer.from('payload'), 'text/plain');
    await expect(store.get(key)).resolves.toEqual(Buffer.from('payload'));
    await store.delete(key);
    await expect(store.get(key)).rejects.toThrow();
    await expect(store.healthCheck()).resolves.toBeUndefined();
  });

  it('rejects traversal and malformed storage keys', () => {
    expect(() => assertAttachmentStorageKey('../secrets')).toThrow('invalid');
    expect(() => assertAttachmentStorageKey('attachments/../../etc/passwd')).toThrow('invalid');
    expect(() => assertAttachmentStorageKey('attachments/not-a-uuid')).toThrow('invalid');
    expect(() => assertAttachmentStorageKey(key)).not.toThrow();
  });
});
