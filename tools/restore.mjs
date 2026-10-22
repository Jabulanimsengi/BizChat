import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const composeFile = process.env.COMPOSE_FILE ?? 'docker-compose.test.yml';
const user = process.env.PG_USER ?? 'bizchat';
const targetDatabase = process.env.RESTORE_DATABASE ?? 'bizchat_restore';
const bucket = process.env.S3_BUCKET ?? 'bizchat-attachments';
const backupRoot = resolve(process.env.BACKUP_DIR ?? 'var/backups/latest');

const s3 = new S3Client({
  region: process.env.S3_REGION ?? 'us-east-1',
  endpoint: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:59000',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'bizchat',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'bizchat-secret',
  },
});

function docker(args, stdin) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('docker', args, {
      stdio: [stdin ? 'pipe' : 'ignore', 'inherit', 'inherit'],
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`docker exited with code ${code}`));
    });
    if (stdin && child.stdin) {
      stdin.pipe(child.stdin);
      stdin.on('error', reject);
    }
  });
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function listObjectFiles(directory) {
  try {
    return await listFiles(directory);
  } catch {
    return [];
  }
}

async function main() {
  const manifest = JSON.parse(await readFile(join(backupRoot, 'manifest.json'), 'utf8'));

  await docker([
    'compose',
    '-f',
    composeFile,
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    user,
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `DROP DATABASE IF EXISTS ${targetDatabase}`,
    '-c',
    `CREATE DATABASE ${targetDatabase}`,
  ]);

  await docker(
    [
      'compose',
      '-f',
      composeFile,
      'exec',
      '-T',
      'postgres',
      'pg_restore',
      '-U',
      user,
      '-d',
      targetDatabase,
      '--no-owner',
    ],
    createReadStream(join(backupRoot, 'database.dump')),
  );

  const objectRoot = join(backupRoot, 'objects');
  const files = await listObjectFiles(objectRoot);
  for (const file of files) {
    const key = relative(objectRoot, file).split('\\').join('/');
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: await readFile(file) }));
  }

  console.log(
    `Restore complete into ${targetDatabase}: ${manifest.objectCount} object(s) re-uploaded`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
