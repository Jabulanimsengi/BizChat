import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function databaseFromUrl() {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname.replace(/^\//, '') || 'bizchat';
  } catch {
    return 'bizchat';
  }
}

const composeFile = process.env.COMPOSE_FILE ?? 'docker-compose.test.yml';
const database = process.env.PG_DATABASE ?? databaseFromUrl();
const user = process.env.PG_USER ?? 'bizchat';
const bucket = process.env.S3_BUCKET ?? 'bizchat-attachments';
const prefix = process.env.S3_PREFIX ?? 'attachments';
const backupRoot = resolve(
  process.env.BACKUP_DIR ?? join('var', 'backups', new Date().toISOString().replace(/[:.]/g, '-')),
);

const s3 = new S3Client({
  region: process.env.S3_REGION ?? 'us-east-1',
  endpoint: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:59000',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'bizchat',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'bizchat-secret',
  },
});

export function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'inherit'] });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise(Buffer.concat(chunks));
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function dumpDatabase() {
  return run('docker', [
    'compose',
    '-f',
    composeFile,
    'exec',
    '-T',
    'postgres',
    'pg_dump',
    '-U',
    user,
    '-d',
    database,
    '--format=custom',
    '--no-owner',
  ]);
}

async function mirrorObjects() {
  const keys = [];
  let token;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: `${prefix}/`, ContinuationToken: token }),
    );
    for (const object of page.Contents ?? []) {
      if (!object.Key) continue;
      keys.push(object.Key);
      const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: object.Key }));
      const body = result.Body
        ? Buffer.from(await result.Body.transformToByteArray())
        : Buffer.alloc(0);
      const target = join(backupRoot, 'objects', object.Key);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, body);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function main() {
  await mkdir(backupRoot, { recursive: true });
  const dump = await dumpDatabase();
  const dumpPath = join(backupRoot, 'database.dump');
  await writeFile(dumpPath, dump);

  const keys = await mirrorObjects();
  const digest = createHash('sha256').update(dump).digest('hex');
  await writeFile(
    join(backupRoot, 'manifest.json'),
    JSON.stringify(
      {
        database,
        bucket,
        prefix,
        keys,
        objectCount: keys.length,
        dumpSha256: digest,
        dumpBytes: dump.length,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(`Backup complete: ${backupRoot} (${keys.length} object(s), ${dump.length} bytes)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
