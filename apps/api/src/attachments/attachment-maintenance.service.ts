import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Environment } from '../config/environment';

const STAGING_TTL_MS = 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 30 * 60 * 1000;

@Injectable()
export class AttachmentMaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AttachmentMaintenanceService.name);
  private readonly stagingRoot: string;
  private timer?: NodeJS.Timeout;

  public constructor(config: ConfigService<Environment, true>) {
    this.stagingRoot = resolve(
      process.cwd(),
      config.get('ATTACHMENT_STORAGE_PATH', { infer: true }),
      '.tmp',
    );
  }

  public onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.sweep().catch((error: unknown) => {
        this.logger.warn(
          `Attachment staging sweep failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      });
    }, SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  public onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  public async sweep(now: number = Date.now()): Promise<number> {
    const entries = await readdir(this.stagingRoot, { withFileTypes: true }).catch(() => []);
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const path = resolve(this.stagingRoot, entry.name);
      const details = await stat(path).catch(() => undefined);
      if (details && now - details.mtimeMs > STAGING_TTL_MS) {
        await rm(path, { force: true }).catch(() => undefined);
        removed += 1;
      }
    }
    if (removed > 0) this.logger.log(`Removed ${removed} stale staged attachment(s)`);
    return removed;
  }
}
