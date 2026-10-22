import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

const baseUrl = process.env.SMOKE_API_URL ?? 'http://localhost:4400';
const apiUrl = `${baseUrl}/api/v1`;
const dashboardOrigin = 'http://localhost:3000';
const runId = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
const prisma = new PrismaClient();

const s3 = new S3Client({
  region: process.env.S3_REGION ?? 'us-east-1',
  endpoint: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:59000',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'bizchat',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'bizchat-secret',
  },
});
const bucket = process.env.S3_BUCKET ?? 'bizchat-attachments';

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, { cookie, origin = dashboardOrigin, method = 'GET', body } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(origin ? { origin } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  return { response, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

async function register(label) {
  const result = await request('/auth/register', {
    method: 'POST',
    body: {
      businessName: `Phase 9 ${label} ${runId}`,
      displayName: `${label} Owner`,
      email: `phase9-${label.toLowerCase()}-${runId}@example.test`,
      password: 'phase-9-secure-passphrase',
      timezone: 'Africa/Johannesburg',
    },
  });
  assert(result.response.status === 201 && result.cookie, `${label} registration failed`);
  const me = await request('/auth/me', { cookie: result.cookie });
  return { cookie: result.cookie, me: me.data };
}

async function verifyDomain(account, hostname) {
  const created = await request('/domains', {
    method: 'POST',
    cookie: account.cookie,
    body: { domain: hostname },
  });
  assert(created.response.status === 201, 'domain create failed');
  const verified = await request(`/domains/${created.data.id}/verify`, {
    method: 'POST',
    cookie: account.cookie,
  });
  assert(verified.data?.status === 'VERIFIED', 'domain verify failed');
}

async function bootstrap(account, origin) {
  const result = await request('/widget/bootstrap', {
    method: 'POST',
    origin,
    body: { businessPublicId: account.me.business.publicId },
  });
  assert(result.response.ok, 'widget bootstrap failed');
  return result.data;
}

async function connectWidget(origin, token) {
  const socket = io(`${baseUrl}/widget`, {
    auth: { token },
    extraHeaders: { Origin: origin },
    transports: ['websocket'],
    forceNew: true,
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('socket connect timeout')), 10_000);
    socket.once('widget.connected', () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once('connect_error', reject);
  });
  return socket;
}

function emit(socket, event, input) {
  return new Promise((resolve, reject) =>
    socket
      .timeout(10_000)
      .emit(event, input, (error, response) => (error ? reject(error) : resolve(response))),
  );
}

async function upload(path, { cookie, token, origin, name, type, bytes }) {
  const form = new FormData();
  form.set('clientMessageId', randomUUID());
  form.set('content', name);
  form.set('file', new Blob([bytes], { type }), name);
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(origin ? { origin } : {}),
    },
    body: form,
  });
  const data = await response.json().catch(() => undefined);
  return { response, data };
}

async function download(path, { cookie, token, origin }) {
  const response = await fetch(`${apiUrl}${path}`, {
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(origin ? { origin } : {}),
    },
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return { response, buffer };
}

async function main() {
  const tenant = await register('Alpha');
  const hostname = `phase9-${runId}.localhost`;
  const origin = `http://${hostname}:3000`;
  await verifyDomain(tenant, hostname);
  const session = await bootstrap(tenant, origin);
  const visitor = await connectWidget(origin, session.widgetSessionToken);

  try {
    const started = await emit(visitor, 'conversation.start', {
      clientMessageId: randomUUID(),
      content: 'Phase 9 attachment host message',
    });
    assert(started.ok, 'conversation start failed');
    const conversationId = started.data.conversation.id;

    const clean = await upload(`/widget/conversations/${conversationId}/attachments`, {
      token: session.widgetSessionToken,
      origin,
      name: 'hello.png',
      type: 'image/png',
      bytes: PNG,
    });
    assert(
      clean.response.ok,
      `clean upload failed: ${clean.response.status} ${JSON.stringify(clean.data)}`,
    );
    const attachment = clean.data.attachments[0];
    assert(attachment?.status === 'READY', 'clean attachment was not READY');
    assert(attachment.mimeType === 'image/png', 'clean attachment mime mismatch');

    const row = await prisma.attachment.findFirst({
      where: { conversationId, status: 'READY' },
      orderBy: { createdAt: 'desc' },
    });
    assert(row?.sha256?.length === 64, 'attachment row missing digest');
    await s3.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: `${process.env.S3_PREFIX ?? 'attachments'}/${row.storageKey}`,
      }),
    );

    const fetched = await download(`/widget/attachments/${attachment.id}/download`, {
      token: session.widgetSessionToken,
      origin,
    });
    assert(fetched.response.ok, 'visitor download failed');
    assert(fetched.buffer.equals(PNG), 'downloaded bytes differ from upload');
    assert(
      fetched.response.headers.get('x-content-type-options') === 'nosniff',
      'download missing nosniff header',
    );

    const infected = await upload(`/widget/conversations/${conversationId}/attachments`, {
      token: session.widgetSessionToken,
      origin,
      name: 'eicar.txt',
      type: 'text/plain',
      bytes: Buffer.from(EICAR),
    });
    assert(infected.response.status === 400, 'infected upload was not rejected');
    assert(infected.data?.error?.code === 'ATTACHMENT_REJECTED', 'infected upload code mismatch');

    const agentUpload = await upload(`/conversations/${conversationId}/attachments`, {
      cookie: tenant.cookie,
      name: 'agent.png',
      type: 'image/png',
      bytes: PNG,
    });
    assert(agentUpload.response.ok, `agent upload failed: ${agentUpload.response.status}`);
    const agentAttachment = agentUpload.data.attachments[0];
    assert(agentAttachment?.status === 'READY', 'agent attachment was not READY');

    const visitorDownload = await download(`/widget/attachments/${agentAttachment.id}/download`, {
      token: session.widgetSessionToken,
      origin,
    });
    assert(visitorDownload.response.ok, 'visitor cannot download agent attachment');

    const crossTenant = await register('Beta');
    const forbidden = await request(`/attachments/${agentAttachment.id}/download`, {
      cookie: crossTenant.cookie,
    });
    assert(
      forbidden.response.status === 404 || forbidden.response.status === 403,
      `cross-tenant download was not blocked: ${forbidden.response.status}`,
    );

    const rejectedCount = await prisma.auditLog.count({
      where: { businessId: tenant.me.business.id, action: 'attachment.rejected' },
    });
    assert(rejectedCount >= 1, 'rejected upload was not audited');

    console.log('Phase 9 attachments smoke passed');
  } finally {
    visitor.close();
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
