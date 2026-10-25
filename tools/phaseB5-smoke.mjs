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
      businessName: `Phase B5 ${runId}`,
      displayName: 'Overflow Owner',
      email: `phaseb5-${runId}@example.test`,
      password: 'phase-b5-secure-passphrase',
      timezone: 'Africa/Johannesburg',
    },
  });
  assert(result.response.status === 201 && result.cookie, 'registration failed');
  const me = await request('/auth/me', { cookie: result.cookie });
  return { cookie: result.cookie, me: me.data };
}
async function create(cookie, path, body) {
  const result = await request(path, { method: 'POST', cookie, body });
  assert(result.response.status === 201, `${path} creation failed: ${result.response.status}`);
  return result.data;
}
async function connectAgent(cookie) {
  const socket = io(`${baseUrl}/agent`, {
    extraHeaders: { Origin: dashboardOrigin, Cookie: cookie },
    transports: ['websocket'],
    forceNew: true,
  });
  await waitFor(socket, 'agent.connected');
  return socket;
}
async function openWidget(account, origin) {
  const boot = await request('/widget/bootstrap', {
    method: 'POST',
    origin,
    body: { businessPublicId: account.me.business.publicId },
  });
  assert(boot.response.ok, 'widget bootstrap failed');
  const socket = io(`${baseUrl}/widget`, {
    auth: { token: boot.data.widgetSessionToken },
    extraHeaders: { Origin: origin },
    transports: ['websocket'],
    forceNew: true,
  });
  await waitFor(socket, 'widget.connected');
  const heartbeat = setInterval(() => socket.emit('widget.heartbeat'), 5_000);
  socket.on('disconnect', () => clearInterval(heartbeat));
  return { socket, boot: boot.data };
}
async function start(widget, content) {
  const started = await emit(widget.socket, 'conversation.start', {
    clientMessageId: randomUUID(),
    content,
  });
  assert(started.ok, `conversation start failed: ${JSON.stringify(started.error)}`);
  return started.data;
}

/** Routing runs after the start acknowledgement, so wait for the stored state to leave NEW. */
async function settled(conversationId) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const row = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    if (row.status !== 'NEW') return row;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
}
function describeRow(row) {
  return `${row.status}, intake ${row.intakeStatus}, topic ${row.topicId ?? 'none'}`;
}

/** A queued chat overflows into the consultant's department once its first step falls due. */
async function overflowScenario(widget) {
  const started = await start(widget, 'I need help with my tax return');
  const conversationId = started.conversation.id;
  const queued = await settled(conversationId);
  assert(queued.status === 'QUEUED', `tax chat should queue: ${describeRow(queued)}`);
  const assigned = await waitFor(
    widget.socket,
    'conversation.routed',
    (event) => event.conversation.id === conversationId && event.outcome === 'ASSIGNED',
    40_000,
  );
  const row = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: { events: { where: { type: 'OVERFLOWED' } } },
  });
  assert(row.overflowLevel === 1, `expected overflow level 1, got ${row.overflowLevel}`);
  assert(row.events.length === 1, 'expected one OVERFLOWED timeline event');
  assert(assigned.conversation.overflowLevel === 1, 'routing event should carry the level');
  return 'queued in an empty department, overflowed after 10 s, then assigned';
}

/** After the maximum wait the visitor is offered a follow-up and leaves contact details. */
async function followUpScenario(widget) {
  const started = await start(widget, 'A question about payroll');
  const conversationId = started.conversation.id;
  const queued = await settled(conversationId);
  assert(queued.status === 'QUEUED', `payroll chat should queue: ${describeRow(queued)}`);
  await waitFor(
    widget.socket,
    'conversation.wait.options',
    (event) => event.conversationId === conversationId && event.reason === 'MAX_WAIT',
    50_000,
  );
  const empty = await emit(widget.socket, 'conversation.followup.request', { conversationId });
  assert(!empty.ok && empty.error.code === 'VALIDATION_ERROR', 'contact details are required');
  const confirmation = waitFor(
    widget.socket,
    'message.new',
    (message) => message.conversationId === conversationId && message.senderType === 'SYSTEM',
  );
  const requested = await emit(widget.socket, 'conversation.followup.request', {
    conversationId,
    name: 'Thandi',
    email: `visitor-${runId}@example.test`,
  });
  assert(requested.ok, `follow-up failed: ${JSON.stringify(requested.error)}`);
  assert(requested.data.followUpContact.email.startsWith('visitor-'), 'contact should be stored');
  await confirmation;
  const again = await emit(widget.socket, 'conversation.followup.request', {
    conversationId,
    phone: '+27 11 555 0100',
  });
  assert(!again.ok && again.error.code === 'FOLLOW_UP_ALREADY_REQUESTED', 'one follow-up only');
  const row = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  assert(row.status === 'QUEUED' && row.followUpRequestedAt, 'follow-up stays queued');
  assert(row.maxWaitNotifiedAt && !row.maxWaitAt, 'maximum wait recorded once');
  return 'wait options after 30 s, details validated, stored once, chat stays queued';
}

/** Closed: no topic question, nobody offered the chat; it routes once the business opens. */
async function closedScenario(owner, widget) {
  const closedWeek = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    openingTime: '09:00',
    closingTime: '17:00',
    isClosed: true,
  }));
  const closed = await request('/business-hours', {
    method: 'PUT',
    cookie: owner.cookie,
    body: { hours: closedWeek },
  });
  assert(closed.response.ok, 'closing the business failed');
  const started = await start(widget, 'hello there');
  const conversationId = started.conversation.id;
  assert(!started.intake, 'no topic question while closed');
  const queued = await settled(conversationId);
  assert(
    queued.status === 'QUEUED',
    `closed businesses queue instead of assigning: ${describeRow(queued)}`,
  );
  // A tenant without hours is always open; the sweep then drains the waiting chat.
  await prisma.businessHour.deleteMany({ where: { businessId: owner.me.business.id } });
  await waitFor(
    widget.socket,
    'conversation.routed',
    (event) => event.conversation.id === conversationId && event.outcome === 'ASSIGNED',
    20_000,
  );
  return 'queued without a topic prompt while closed, assigned after opening';
}

async function main() {
  const owner = await register();
  const hostname = `phaseb5-${runId}.localhost`;
  const origin = `http://${hostname}:3000`;
  const domain = await create(owner.cookie, '/domains', { domain: hostname });
  const verified = await request(`/domains/${domain.id}/verify`, {
    method: 'POST',
    cookie: owner.cookie,
  });
  assert(verified.response.ok, 'domain verification failed');
  const departments = await request('/departments', { cookie: owner.cookie });
  const home = departments.data.find((department) => department.isDefault);
  assert(home, 'the owner should have a default department');
  // Nobody belongs to this department, so its chats can only be taken after overflowing.
  const specialists = await create(owner.cookie, '/departments', { name: 'Specialists' });
  // Creating a department adds its creator; keep the owner in the home department only.
  const mine = await request('/departments/mine', {
    method: 'PUT',
    cookie: owner.cookie,
    body: { departmentIds: [home.id] },
  });
  assert(mine.response.ok, `leaving Specialists failed: ${mine.response.status}`);
  await create(owner.cookie, '/topics', {
    name: 'Tax returns',
    departmentId: specialists.id,
    keywords: [{ phrase: 'tax return', weight: 3 }],
    overflowSteps: [{ afterSeconds: 10, addDepartmentIds: [home.id] }],
  });
  await create(owner.cookie, '/topics', {
    name: 'Payroll',
    departmentId: specialists.id,
    keywords: [{ phrase: 'payroll', weight: 3 }],
    maxWaitSeconds: 30,
  });

  const agent = await connectAgent(owner.cookie);
  const sockets = [agent];
  try {
    const visitors = await Promise.all([
      openWidget(owner, origin),
      openWidget(owner, origin),
      openWidget(owner, origin),
    ]);
    sockets.push(...visitors.map(({ socket }) => socket));
    // The two timed scenarios run together; the closed one changes tenant hours, so it runs after.
    const [overflow, followUp] = await Promise.all([
      overflowScenario(visitors[0]),
      followUpScenario(visitors[1]),
    ]);
    const closedHours = await closedScenario(owner, visitors[2]);
    console.log(JSON.stringify({ ok: true, overflow, followUp, closedHours }));
  } finally {
    for (const socket of sockets) socket.disconnect();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
