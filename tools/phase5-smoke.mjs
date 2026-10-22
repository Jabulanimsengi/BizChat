import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { io } from 'socket.io-client';

const baseUrl = process.env.SMOKE_API_URL ?? 'http://localhost:4400';
const apiUrl = `${baseUrl}/api/v1`;
const dashboardOrigin = 'http://localhost:3000';
const runId = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
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
function waitFor(socket, event, predicate = () => true, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`${event} timeout`));
    }, timeoutMs);
    const handler = (value) => {
      if (!predicate(value)) return;
      clearTimeout(timeout);
      socket.off(event, handler);
      resolve(value);
    };
    socket.on(event, handler);
  });
}
function emit(socket, event, input) {
  return new Promise((resolve, reject) =>
    socket
      .timeout(10_000)
      .emit(event, input, (error, response) => (error ? reject(error) : resolve(response))),
  );
}

async function register() {
  const result = await request('/auth/register', {
    method: 'POST',
    body: {
      businessName: `Phase 5 ${runId}`,
      displayName: 'Routing Agent',
      email: `phase5-${runId}@example.test`,
      password: 'phase-5-secure-passphrase',
      timezone: 'Africa/Johannesburg',
    },
  });
  assert(result.response.status === 201 && result.cookie, 'registration failed');
  const me = await request('/auth/me', { cookie: result.cookie });
  return { cookie: result.cookie, me: me.data };
}
async function setupDomain(account, hostname) {
  const created = await request('/domains', {
    method: 'POST',
    cookie: account.cookie,
    body: { domain: hostname },
  });
  assert(created.response.status === 201, 'domain creation failed');
  const verified = await request(`/domains/${created.data.id}/verify`, {
    method: 'POST',
    cookie: account.cookie,
  });
  assert(verified.response.ok, 'domain verification failed');
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
async function connectAgent(cookie) {
  const socket = io(`${baseUrl}/agent`, {
    extraHeaders: { Origin: dashboardOrigin, Cookie: cookie },
    transports: ['websocket'],
    forceNew: true,
  });
  const connected = await waitFor(socket, 'agent.connected');
  return { socket, connected };
}
async function connectWidget(origin, token) {
  const socket = io(`${baseUrl}/widget`, {
    auth: { token },
    extraHeaders: { Origin: origin },
    transports: ['websocket'],
    forceNew: true,
  });
  await waitFor(socket, 'widget.connected');
  return socket;
}
async function startVisitor(account, origin, departmentPublicId) {
  const boot = await bootstrap(account, origin);
  const socket = await connectWidget(origin, boot.widgetSessionToken);
  const started = await emit(socket, 'conversation.start', {
    clientMessageId: randomUUID(),
    content: `Routing smoke ${randomUUID()}`,
    ...(departmentPublicId ? { departmentPublicId } : {}),
  });
  assert(started.ok, 'conversation start failed');
  return { socket, boot, started: started.data };
}
async function transition(cookie, id, status) {
  const result = await request(`/conversations/${id}/status`, {
    cookie,
    method: 'PATCH',
    body: { status },
  });
  assert(result.response.ok, `transition to ${status} failed`);
}

async function main() {
  const account = await register();
  const hostname = `phase5-${runId}.localhost`;
  const widgetOrigin = `http://${hostname}:3000`;
  await setupDomain(account, hostname);
  const profileUpdate = await request('/agent-profile/me', {
    cookie: account.cookie,
    method: 'PATCH',
    body: { maxConcurrentChats: 1, routingEnabled: true },
  });
  assert(profileUpdate.response.ok, 'capacity update failed');
  const departments = await request('/departments', { cookie: account.cookie });
  assert(
    departments.response.ok && departments.data.length === 1 && departments.data[0].isDefault,
    'default department missing',
  );
  const general = departments.data[0];
  const settings = await request('/widget-settings', {
    cookie: account.cookie,
    method: 'PATCH',
    body: {
      departmentSelectionEnabled: true,
      preferPreviousConsultant: true,
      queueMessage: 'Routing queue active.',
    },
  });
  assert(settings.response.ok, 'routing settings update failed');
  const agentConnection = await connectAgent(account.cookie);
  const agent = agentConnection.socket;
  const widgets = [];
  try {
    const first = await startVisitor(account, widgetOrigin, general.publicId);
    widgets.push(first.socket);
    assert(
      first.started.conversation.status === 'ASSIGNED' &&
        first.started.conversation.assignedAgentMembershipId === account.me.membership.id,
      'first conversation was not assigned',
    );
    const firstAssignments = await prisma.conversationAssignment.count({
      where: { conversationId: first.started.conversation.id },
    });
    assert(firstAssignments === 1, 'concurrent routing created duplicate assignments');

    const second = await startVisitor(account, widgetOrigin, general.publicId);
    widgets.push(second.socket);
    assert(
      second.started.conversation.status === 'QUEUED' &&
        second.started.conversation.queuePosition === 1,
      'capacity did not queue second conversation',
    );
    const durableQueue = await prisma.conversationQueueEntry.findUnique({
      where: { conversationId: second.started.conversation.id },
    });
    assert(
      durableQueue && !durableQueue.assignedAt && durableQueue.attempts >= 1,
      'durable queue metadata missing',
    );

    await transition(account.cookie, first.started.conversation.id, 'ACTIVE');
    const secondAssignedEvent = waitFor(
      agent,
      'conversation.assigned',
      (event) => event.conversation.id === second.started.conversation.id,
    );
    await transition(account.cookie, first.started.conversation.id, 'RESOLVED');
    const secondAssigned = await secondAssignedEvent;
    assert(secondAssigned.outcome === 'ASSIGNED', 'queue did not drain when capacity was released');
    const secondState = await prisma.conversation.findUnique({
      where: { id: second.started.conversation.id },
    });
    assert(
      secondState?.assignedAgentMembershipId === account.me.membership.id,
      'queued conversation assignment was not durable',
    );

    await transition(account.cookie, second.started.conversation.id, 'ACTIVE');
    await transition(account.cookie, second.started.conversation.id, 'RESOLVED');
    const salesResult = await request('/departments', {
      cookie: account.cookie,
      method: 'POST',
      body: { name: 'Sales', description: 'Sales enquiries' },
    });
    assert(salesResult.response.status === 201, 'sales department creation failed');
    const sales = salesResult.data;
    await request('/departments/mine', {
      cookie: account.cookie,
      method: 'PUT',
      body: { departmentIds: [general.id] },
    });
    const restricted = await startVisitor(account, widgetOrigin, sales.publicId);
    widgets.push(restricted.socket);
    assert(
      restricted.started.conversation.status === 'QUEUED',
      'department restriction did not exclude non-member agent',
    );
    const restrictedAssignedEvent = waitFor(
      agent,
      'conversation.assigned',
      (event) => event.conversation.id === restricted.started.conversation.id,
    );
    await request('/departments/mine', {
      cookie: account.cookie,
      method: 'PUT',
      body: { departmentIds: [general.id, sales.id] },
    });
    const online = await emit(agent, 'agent.presence.set', { state: 'ONLINE' });
    assert(online.ok, 'presence refresh failed');
    await restrictedAssignedEvent;
    const salesAssigned = await prisma.conversation.findUnique({
      where: { id: restricted.started.conversation.id },
    });
    assert(
      salesAssigned?.assignedAgentMembershipId === account.me.membership.id,
      'department queue did not drain after membership became eligible',
    );

    const history = await prisma.conversationAssignment.count({
      where: { businessId: account.me.business.id },
    });
    console.log(
      JSON.stringify({
        ok: true,
        departments: 2,
        capacity: 1,
        atomicAssignments: firstAssignments,
        queue: 'QUEUED->ASSIGNED',
        departmentRestriction: 'QUEUED->ASSIGNED',
        assignmentHistory: history,
      }),
    );
  } finally {
    for (const socket of widgets) socket.disconnect();
    agent.disconnect();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
