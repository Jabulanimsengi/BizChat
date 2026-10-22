import { ConfigService } from '@nestjs/config';
import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Environment } from '../config/environment';
import { AttachmentMaintenanceService } from './attachment-maintenance.service';

describe('AttachmentMaintenanceService', () => {
  let root: string;
  let staging: string;
  let service: AttachmentMaintenanceService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'bizchat-sweep-'));
    staging = join(root, '.tmp');
    await writeFile(join(root, 'placeholder'), '');
    await rm(join(root, 'placeholder'));
    await import('node:fs/promises').then(({ mkdir }) =>
      mkdir(staging, { recursive: true, mode: 0o700 }),
    );
    service = new AttachmentMaintenanceService({
      get: () => root,
    } as unknown as ConfigService<Environment, true>);
  });

  afterEach(async () => {
    service.onModuleDestroy();
    await rm(root, { recursive: true, force: true });
  });

  it('removes stale staged files and keeps fresh ones', async () => {
    const stale = join(staging, 'stale');
    const fresh = join(staging, 'fresh');
    await writeFile(stale, 'old');
    await writeFile(fresh, 'new');
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(stale, old, old);

    await expect(service.sweep()).resolves.toBe(1);
    await expect(readdir(staging)).resolves.toEqual(['fresh']);
  });

  it('tolerates a missing staging directory', async () => {
    await rm(staging, { recursive: true, force: true });
    await expect(service.sweep()).resolves.toBe(0);
  });
});
