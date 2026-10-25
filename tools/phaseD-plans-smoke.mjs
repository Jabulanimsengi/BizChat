import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { io } from 'socket.io-client';

const baseUrl = process.env.SMOKE_API_URL ?? 'http://localhost:4400';
const apiUrl = `${baseUrl}/api/v1`;
const dashboardOrigin = 'http://localhost:3000';
const runId = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
// tools/run-e2e.mjs puts this address on PLATFORM_ADMIN_EMAILS.
const adminEmail = 'platform-admin-e2e@example.test';
const password = 'phase-d-secure-passphrase';
const prisma = new PrismaClient();

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
function waitFor(socket, event, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${event} timeout`)), timeoutMs);
    socket.once(event, (value) => {
      clearTimeout(timeout);
      resolve(value);
    });
  });
}
function emit(socket, event, input) {
  return new Promise((resolve, reject) =>
    socket
      .timeout(10_000)
      .emit(event, input, (error, response) => (error ? reject(error) : resolve(response))),
  );
}
async function register(email, businessName) {
  const result = await request('/auth/register', {
    method: 'POST',
    body: { businessName, displayName: 'Owner', email, password, timezone: 'UTC' },
  });
  assert(result.response.status === 201 && result.cookie, `registration failed for ${email}`);
  return result.cookie;
}
/** The admin account survives between runs against the same database. */
async function platformAdmin() {
  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existing) await register(adminEmail, `Platform ${runId}`);
  await prisma.user.update({ where: { email: adminEmail }, data: { emailVerifiedAt: new Date() } });
  const login = await request('/auth/login', {
    method: 'POST',
    body: { email: adminEmail, password },
  });
  assert(login.response.ok && login.cookie, 'platform admin login failed');
  return login.cookie;
}
async function widgetStart(publicId, origin) {
  const boot = await request('/widget/bootstrap', {
    method: 'POST',
    origin,
    body: { businessPublicId: publicId },
  });
  assert(boot.response.ok, 'widget bootstrap failed');
  const socket = io(`${baseUrl}/widget`, {
    auth: { token: boot.data.widgetSessionToken },
    extraHeaders: { Origin: origin },
    transports: ['websocket'],
    forceNew: true,
  });
  await waitFor(socket, 'widget.connected');
  try {
    return await emit(socket, 'conversation.start', {
      clientMessageId: randomUUID(),
      content: 'Hello, is anyone there?',
    });
  } finally {
    socket.disconnect();
  }
}

async function main() {
  const admin = await platformAdmin();
  const me = await request('/auth/me', { cookie: admin });
  assert(me.data.platformAdmin === true, 'allowlisted account is not a platform admin');

  const owner = await register(`plans-${runId}@example.test`, `Plans ${runId}`);
  const tenant = (await request('/auth/me', { cookie: owner })).data;
  assert(tenant.platformAdmin === false, 'tenant owner must not be a platform admin');
  const denied = await request('/platform/plans', { cookie: owner });
  assert(denied.response.status === 403, 'tenant owner reached platform administration');

  const hostname = `phased-${runId}.localhost`;
  const origin = `http://${hostname}:3000`;
  const domain = await request('/domains', {
    method: 'POST',
    cookie: owner,
    body: { domain: hostname },
  });
  await request(`/domains/${domain.data.id}/verify`, { method: 'POST', cookie: owner });

  const plan = await request('/platform/plans', {
    method: 'POST',
    cookie: admin,
    body: { code: `one-${runId}`.slice(0, 40), name: 'One chat', maxConversationsPerMonth: 1 },
  });
  assert(plan.response.status === 201, `plan creation failed: ${plan.response.status}`);
  const assigned = await request(`/platform/tenants/${tenant.business.id}`, {
    method: 'PATCH',
    cookie: admin,
    body: { planId: plan.data.id },
  });
  assert(assigned.response.ok, 'plan assignment failed');

  const first = await widgetStart(tenant.business.publicId, origin);
  assert(first.ok, `first chat should start: ${JSON.stringify(first.error)}`);
  const second = await widgetStart(tenant.business.publicId, origin);
  assert(!second.ok && second.error.code === 'CHAT_UNAVAILABLE', 'second chat should be refused');
  assert(!/plan/i.test(second.error.message), 'the visitor must not see plan details');
  const usage = await request('/plan', { cookie: owner });
  assert(usage.data.usage.conversations.used === 1, 'usage should count the first chat');

  console.log(
    JSON.stringify({
      ok: true,
      platformAdmin: 'allowlisted verified account only',
      limit: 'first widget chat started, second refused with a neutral message',
      usage: 'one conversation metered',
    }),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
