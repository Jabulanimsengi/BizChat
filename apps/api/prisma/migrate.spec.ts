import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checksum, loadMigrations, resolveCommand, verifyChecksums } from './migrate';

describe('migration runner', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'bizchat-migrations-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const add = async (name: string, sql: string): Promise<void> => {
    await mkdir(join(directory, name), { recursive: true });
    await writeFile(join(directory, name, 'migration.sql'), sql);
  };

  it('loads migrations in lexicographic order with checksums', async () => {
    await add('20260101000000_second', 'SELECT 2;');
    await add('20260101000000_first', 'SELECT 1;');
    const migrations = await loadMigrations(directory);
    expect(migrations.map((migration) => migration.sql)).toEqual(['SELECT 1;', 'SELECT 2;']);
    expect(migrations[0]?.checksum).toBe(checksum('SELECT 1;'));
  });

  it('is empty for an empty directory', async () => {
    await expect(loadMigrations(directory)).resolves.toEqual([]);
  });

  it('detects a modified applied migration', async () => {
    await add('20260101000000_first', 'SELECT 1;');
    const migrations = await loadMigrations(directory);
    const applied = new Map([['20260101000000_first', checksum('SELECT something else;')]]);
    expect(() => verifyChecksums(migrations, applied)).toThrow('has changed');
  });

  it('accepts matching checksums', async () => {
    await add('20260101000000_first', 'SELECT 1;');
    const migrations = await loadMigrations(directory);
    const applied = new Map([[migrations[0]!.name, migrations[0]!.checksum]]);
    expect(() => verifyChecksums(migrations, applied)).not.toThrow();
  });

  it('resolves commands and flags', () => {
    expect(resolveCommand([])).toBe('deploy');
    expect(resolveCommand(['deploy'])).toBe('deploy');
    expect(resolveCommand(['baseline'])).toBe('baseline');
    expect(resolveCommand(['deploy', '--dry-run'])).toBe('dry-run');
    expect(resolveCommand(['--status'])).toBe('status');
    expect(() => resolveCommand(['explode'])).toThrow('Unknown migration command');
  });
});
