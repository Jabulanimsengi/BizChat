import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Client } from 'pg';

export interface MigrationFile {
  name: string;
  checksum: string;
  sql: string;
}

export interface AppliedMigration {
  name: string;
  checksum: string;
}

export const LEDGER_TABLE = '_bizchat_migrations';
const ADVISORY_LOCK_KEY = 'bizchat:migration-runner';

export type MigrationCommand = 'deploy' | 'status' | 'baseline' | 'dry-run';

export async function loadMigrations(directory: string): Promise<MigrationFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const migrations: MigrationFile[] = [];
  for (const name of directories) {
    const sql = await readFile(join(directory, name, 'migration.sql'), 'utf8');
    migrations.push({ name, checksum: checksum(sql), sql });
  }
  return migrations;
}

export function checksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

export function verifyChecksums(migrations: MigrationFile[], applied: Map<string, string>): void {
  for (const migration of migrations) {
    const recorded = applied.get(migration.name);
    if (recorded && recorded !== migration.checksum) {
      throw new Error(
        `Migration ${migration.name} has changed since it was applied. ` +
          'Never edit an applied migration; add a new one instead.',
      );
    }
  }
}

export async function ensureLedger(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
      name varchar(255) PRIMARY KEY,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      execution_ms integer NOT NULL DEFAULT 0
    )
  `);
}

export async function loadApplied(client: Client): Promise<Map<string, string>> {
  const result = await client.query<{ name: string; checksum: string }>(
    `SELECT name, checksum FROM ${LEDGER_TABLE}`,
  );
  return new Map(result.rows.map((row) => [row.name, row.checksum]));
}

async function previousPrismaMigrations(client: Client): Promise<number> {
  const exists = await client.query<{ present: string | null }>(
    `SELECT to_regclass('public._prisma_migrations')::text AS present`,
  );
  if (!exists.rows[0]?.present) return 0;
  const count = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM _prisma_migrations`,
  );
  return Number(count.rows[0]?.count ?? '0');
}

async function record(
  client: Client,
  migration: MigrationFile,
  executionMs: number,
): Promise<void> {
  await client.query(
    `INSERT INTO ${LEDGER_TABLE} (name, checksum, execution_ms) VALUES ($1, $2, $3)`,
    [migration.name, migration.checksum, executionMs],
  );
}

async function apply(client: Client, migration: MigrationFile): Promise<number> {
  const startedAt = Date.now();
  await client.query('BEGIN');
  try {
    await client.query(migration.sql);
    await record(client, migration, Date.now() - startedAt);
    await client.query('COMMIT');
    return Date.now() - startedAt;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function run(
  command: MigrationCommand,
  options: { connectionString: string; migrationsDir: string },
  log: (message: string) => void = console.log,
): Promise<void> {
  const migrations = await loadMigrations(options.migrationsDir);
  const client = new Client({ connectionString: options.connectionString });
  await client.connect();
  try {
    await ensureLedger(client);
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [ADVISORY_LOCK_KEY]);
    try {
      const applied = await loadApplied(client);
      verifyChecksums(migrations, applied);
      const pending = migrations.filter((migration) => !applied.has(migration.name));

      if (command === 'status' || command === 'dry-run') {
        log(`Applied: ${applied.size}/${migrations.length}`);
        for (const migration of migrations) {
          log(`  ${applied.has(migration.name) ? 'applied' : 'pending'} ${migration.name}`);
        }
        if (command === 'dry-run') log(`Would apply ${pending.length} migration(s)`);
        return;
      }

      if (command === 'baseline') {
        if (applied.size > 0) {
          throw new Error('Baseline is only valid when the migration ledger is empty');
        }
        for (const migration of migrations) await record(client, migration, 0);
        log(`Baseline recorded ${migrations.length} migration(s) without executing them`);
        return;
      }

      if (applied.size === 0 && (await previousPrismaMigrations(client)) > 0) {
        throw new Error(
          'This database was migrated with Prisma. Run `npm run db:migrate:baseline` ' +
            'once to adopt it, then deploy normally.',
        );
      }

      if (pending.length === 0) {
        log('No pending migrations');
        return;
      }
      for (const migration of pending) {
        const executionMs = await apply(client, migration);
        log(`Applied ${migration.name} (${executionMs}ms)`);
      }
      log(`Applied ${pending.length} migration(s)`);
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [ADVISORY_LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
}

export function resolveCommand(args: string[]): MigrationCommand {
  if (args.includes('--dry-run')) return 'dry-run';
  if (args.includes('--status')) return 'status';
  const candidate = args.find((arg) => !arg.startsWith('-')) ?? 'deploy';
  if (!['deploy', 'status', 'baseline', 'dry-run'].includes(candidate)) {
    throw new Error(`Unknown migration command: ${candidate}`);
  }
  return candidate as MigrationCommand;
}

async function main(): Promise<void> {
  const command = resolveCommand(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  await run(command, {
    connectionString,
    migrationsDir: resolve(__dirname, 'migrations'),
  });
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
