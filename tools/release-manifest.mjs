import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

async function migrationManifest() {
  const directory = resolve('apps/api/prisma/migrations');
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const migrations = [];
  for (const name of names) {
    const sql = await readFile(join(directory, name, 'migration.sql'));
    migrations.push({ name, checksum: createHash('sha256').update(sql).digest('hex') });
  }
  return migrations;
}

function composeImageDigests() {
  return new Promise((resolvePromise) => {
    const child = spawn(
      'docker',
      ['compose', '-f', 'docker-compose.production.yml', 'images', '--format', 'json'],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.on('error', () => resolvePromise([]));
    child.on('close', () => {
      try {
        const parsed = JSON.parse(output);
        resolvePromise(
          (Array.isArray(parsed) ? parsed : []).map((image) => ({
            service: image.Service,
            image: image.Image,
            id: image.ID,
          })),
        );
      } catch {
        resolvePromise([]);
      }
    });
  });
}

async function main() {
  const lockfile = await readFile('package-lock.json');
  const root = JSON.parse(await readFile('package.json', 'utf8'));
  const manifest = {
    product: root.name,
    version: root.version,
    revision: process.env.GITHUB_SHA ?? process.env.GIT_SHA ?? 'unknown',
    node: process.version,
    lockfileSha256: createHash('sha256').update(lockfile).digest('hex'),
    migrations: await migrationManifest(),
    images: await composeImageDigests(),
    createdAt: new Date().toISOString(),
  };
  await writeFile('var/release-manifest.json', JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
