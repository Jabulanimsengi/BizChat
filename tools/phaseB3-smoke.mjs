import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { io } from 'socket.io-client';

const baseUrl = process.env.SMOKE_API_URL ?? 'http://localhost:4400';
const apiUrl = `${baseUrl}/api/v1`;
const dashboardOrigin = 'http://localhost:3000';
const runId = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
const prisma = new PrismaClient();
const PROMPT_TIMEOUT_SECONDS = 15;

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
      businessName: `Phase B3 ${runId}`,
      displayName: 'Topic Owner',
      email: `phaseb3-${runId}@example.test`,
      password: 'phase-b3-secure-passphrase',
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
async function start(widget, content, extra = {}) {
  const started = await emit(widget.socket, 'conversation.start', {
    clientMessageId: randomUUID(),
    content,
    ...extra,
  });
  assert(started.ok, `conversation start failed: ${JSON.stringify(started.error)}`);
  return started.data;
}
function stateOf(conversationId) {
  return prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: { topic: true, classifications: { orderBy: { createdAt: 'asc' } } },
  });
}

async function main() {
  const owner = await register();
  const hostname = `phaseb3-${runId}.localhost`;
  const origin = `http://${hostname}:3000`;
  const domain = await create(owner.cookie, '/domains', { domain: hostname });
  const verified = await request(`/domains/${domain.id}/verify`, {
    method: 'POST',
    cookie: owner.cookie,
  });
  assert(verified.response.ok, 'domain verification failed');
  const sales = await create(owner.cookie, '/departments', { name: 'Company services' });
  const departments = await request('/departments', { cookie: owner.cookie });
  const mine = await request('/departments/mine', {
    method: 'PUT',
    cookie: owner.cookie,
    body: { departmentIds: departments.data.map((department) => department.id) },
  });
  assert(mine.response.ok, 'department membership failed');
  const registration = await create(owner.cookie, '/topics', {
    name: 'Company registration',
    departmentId: sales.id,
    priority: 'HIGH',
    keywords: [{ phrase: 'register' }, { phrase: 'new company' }],
  });
  const general = await create(owner.cookie, '/topics', { name: 'General', isDefault: true });
  const settings = await request('/routing/settings', {
    method: 'PUT',
    cookie: owner.cookie,
    body: { topicPromptTimeoutSeconds: PROMPT_TIMEOUT_SECONDS },
  });
  assert(settings.response.ok, 'routing settings update failed');

  const agent = await connectAgent(owner.cookie);
  const sockets = [agent];
  const results = {};
  try {
    // 1. A confident match routes straight to the topic's department.
    const confident = await openWidget(owner, origin);
    sockets.push(confident.socket);
    assert(
      confident.boot.topics.some((topic) => topic.publicId === registration.publicId),
      'bootstrap did not offer the topic buttons',
    );
    const routed = await start(confident, 'How do I register a new company?');
    assert(!routed.intake, 'a confident match prompted the visitor');
    const routedState = await stateOf(routed.conversation.id);
    assert(
      routedState.topicId === registration.id &&
        routedState.departmentId === sales.id &&
        routedState.priority === 'HIGH' &&
        routedState.status === 'ASSIGNED',
      'confident match did not route to the topic department',
    );
    assert(
      routedState.classifications.map((row) => `${row.method}:${row.decision}`).join() ===
        'KEYWORD:ROUTE',
      'classification record missing',
    );
    const locked = await emit(confident.socket, 'conversation.intake.submit', {
      conversationId: routed.conversation.id,
      topicPublicId: general.publicId,
    });
    assert(
      !locked.ok && locked.error.code === 'TOPIC_LOCKED',
      'topic could change after assignment',
    );
    results.confidentMatch = 'routed to Company services; topic locked once assigned';

    // 2. An unclear message waits for the visitor's choice, then routes.
    const unclear = await openWidget(owner, origin);
    sockets.push(unclear.socket);
    const asked = await start(unclear, 'hello there');
    assert(asked.intake?.mode === 'ASK', 'unclear message did not prompt the visitor');
    assert(
      asked.intake.topics.some((topic) => topic.publicId === registration.publicId),
      'prompt did not offer the topics',
    );
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const waiting = await stateOf(asked.conversation.id);
    assert(
      waiting.intakeStatus === 'AWAITING_TOPIC' && waiting.assignedAgentMembershipId === null,
      'conversation routed before the visitor chose a topic',
    );
    const chosen = await emit(unclear.socket, 'conversation.intake.submit', {
      conversationId: asked.conversation.id,
      topicPublicId: registration.publicId,
    });
    assert(chosen.ok && chosen.data.outcome === 'ASSIGNED', 'chosen topic did not route');
    const chosenState = await stateOf(asked.conversation.id);
    assert(
      chosenState.topicId === registration.id &&
        chosenState.departmentId === sales.id &&
        chosenState.classifications.map((row) => row.method).join() === 'KEYWORD,VISITOR_CHOICE',
      'visitor choice was not applied',
    );
    results.visitorChoice = 'prompted, held, then routed to the chosen topic';

    // 3. A quick-reply button picked before typing skips classification.
    const quick = await openWidget(owner, origin);
    sockets.push(quick.socket);
    const picked = await start(quick, 'I have a question', { topicPublicId: general.publicId });
    const pickedState = await stateOf(picked.conversation.id);
    assert(
      pickedState.topicId === general.id &&
        pickedState.classifications.map((row) => row.method).join() === 'VISITOR_CHOICE',
      'quick-reply topic was not applied',
    );
    results.quickReply = 'explicit topic applied without classification';

    // 4. An unanswered prompt falls back to the default topic and routes.
    const silent = await openWidget(owner, origin);
    sockets.push(silent.socket);
    const silentStart = await start(silent, 'hello again');
    assert(silentStart.intake?.mode === 'ASK', 'second unclear message did not prompt');
    await waitFor(
      silent.socket,
      'conversation.routed',
      (event) =>
        event.conversation.id === silentStart.conversation.id && event.outcome !== 'QUEUED',
      (PROMPT_TIMEOUT_SECONDS + 15) * 1_000,
    );
    const silentState = await stateOf(silentStart.conversation.id);
    assert(
      silentState.topicId === general.id &&
        silentState.intakeStatus === 'COMPLETE' &&
        silentState.classifications.at(-1)?.method === 'TIMEOUT',
      'unanswered prompt did not fall back to the default topic',
    );
    results.promptTimeout = 'default topic applied after the prompt expired';

    console.log(JSON.stringify({ ok: true, ...results }));
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
