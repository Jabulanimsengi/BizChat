import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const sourceUrl =
  process.env.DATABASE_URL ?? 'postgresql://bizchat:bizchat@127.0.0.1:55440/bizchat?schema=public';
const restoreDatabase = process.env.RESTORE_DATABASE ?? 'bizchat_restore';
const targetUrlObject = new URL(sourceUrl);
targetUrlObject.pathname = `/${restoreDatabase}`;
const targetUrl = targetUrlObject.toString();
const backupRoot = resolve(process.env.BACKUP_DIR ?? 'var/backups/latest');
const bucket = process.env.S3_BUCKET ?? 'bizchat-attachments';
const prefix = process.env.S3_PREFIX ?? 'attachments';

const s3 = new S3Client({
  region: process.env.S3_REGION ?? 'us-east-1',
  endpoint: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:59000',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'bizchat',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'bizchat-secret',
  },
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(script) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [script], {
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: sourceUrl,
        BACKUP_DIR: backupRoot,
        RESTORE_DATABASE: restoreDatabase,
      },
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`${script} exited with ${code}`)),
    );
  });
}

async function counts(prisma) {
  const [businesses, conversations, messages, attachments] = await Promise.all([
    prisma.business.count(),
    prisma.conversation.count(),
    prisma.message.count(),
    prisma.attachment.count(),
  ]);
  return { businesses, conversations, messages, attachments };
}

async function main() {
  await run(resolve('tools/backup.mjs'));
  const manifest = JSON.parse(await readFile(join(backupRoot, 'manifest.json'), 'utf8'));
  assert(manifest.dumpBytes > 0, 'database dump is empty');

  await run(resolve('tools/restore.mjs'));

  const source = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
  const target = new PrismaClient({ datasources: { db: { url: targetUrl } } });
  try {
    const before = await counts(source);
    const after = await counts(target);
    for (const key of Object.keys(before)) {
      assert(before[key] === after[key], `${key} count mismatch: ${before[key]} != ${after[key]}`);
    }

    const attachmentRows = await target.attachment.findMany({ select: { storageKey: true } });
    for (const row of attachmentRows) {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: `${prefix}/${row.storageKey}` }));
    }

    const ledger = await target.$queryRaw`SELECT count(*)::int AS count FROM _bizchat_migrations`;
    assert(
      ledger[0].count === manifest.keys.length || ledger[0].count > 0,
      'migration ledger missing',
    );

    console.log(
      `Backup/restore verified: ${after.businesses} business(es), ` +
        `${after.conversations} conversation(s), ${after.attachments} attachment object(s)`,
    );
  } finally {
    await source.$disconnect();
    await target.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
