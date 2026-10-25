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
      businessName: `Phase B4 ${runId}`,
      displayName: 'Form Owner',
      email: `phaseb4-${runId}@example.test`,
      password: 'phase-b4-secure-passphrase',
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

function intakeOf(conversationId) {
  return prisma.conversationIntake.findUnique({ where: { conversationId } });
}

async function main() {
  const owner = await register();
  const hostname = `phaseb4-${runId}.localhost`;
  const origin = `http://${hostname}:3000`;
  const domain = await create(owner.cookie, '/domains', { domain: hostname });
  const verified = await request(`/domains/${domain.id}/verify`, {
    method: 'POST',
    cookie: owner.cookie,
  });
  assert(verified.response.ok, 'domain verification failed');
  const form = await create(owner.cookie, '/intake-forms', {
    name: 'Company details',
    consentText: 'I agree that my details may be used for this request.',
    fields: [
      { key: 'full_name', label: 'Full name', type: 'TEXT', required: true },
      {
        key: 'registration_number',
        label: 'Registration number',
        type: 'REFERENCE',
        required: false,
        mask: '####/######/##',
      },
    ],
  });
  const registration = await create(owner.cookie, '/topics', {
    name: 'Company registration',
    keywords: [{ phrase: 'register' }, { phrase: 'new company' }],
    intakeFormId: form.id,
  });
  await create(owner.cookie, '/topics', { name: 'General', isDefault: true });

  const agent = await connectAgent(owner.cookie);
  const sockets = [agent];
  const results = {};
  try {
    // 1. A confident topic with a form waits for the form, rejects bad answers, then routes.
    const confident = await openWidget(owner, origin);
    sockets.push(confident.socket);
    const started = await start(confident, 'How do I register a new company?');
    assert(started.intake?.step === 'FORM', 'topic with a form did not ask for it');
    assert(
      started.intake.form.fields.map((field) => field.key).join() ===
        'full_name,registration_number',
      'form fields missing from the prompt',
    );
    const waiting = await stateOf(started.conversation.id);
    assert(
      waiting.intakeStatus === 'AWAITING_FORM' && waiting.assignedAgentMembershipId === null,
      'conversation routed before the form was completed',
    );
    const rejected = await emit(confident.socket, 'conversation.intake.form', {
      conversationId: started.conversation.id,
      answers: { registration_number: '2019-1' },
    });
    assert(
      !rejected.ok &&
        rejected.error.code === 'INTAKE_INVALID' &&
        Object.keys(rejected.error.details.fieldErrors).sort().join() ===
          'consent,full_name,registration_number',
      'invalid answers were not reported per field',
    );
    const submitted = await emit(confident.socket, 'conversation.intake.form', {
      conversationId: started.conversation.id,
      answers: { full_name: 'Thandi Mokoena', registration_number: '2019/123456/07' },
      consent: true,
    });
    assert(submitted.ok && submitted.data.routed?.outcome === 'ASSIGNED', 'form did not route');
    const stored = await intakeOf(started.conversation.id);
    assert(
      stored?.formVersion === 1 &&
        stored.consentAt &&
        stored.answers.some((answer) => answer.value === '2019/123456/07'),
      'answers were not stored',
    );
    const visible = await request(`/conversations/${started.conversation.id}/intake`, {
      cookie: owner.cookie,
    });
    assert(visible.data?.formName === 'Company details', 'consultant cannot see the answers');
    results.formAfterTopic = 'held for the form, field errors reported, then routed';

    // 2. Choosing a topic from the prompt leads to that topic's form.
    const unclear = await openWidget(owner, origin);
    sockets.push(unclear.socket);
    const asked = await start(unclear, 'hello there');
    assert(asked.intake?.step === 'TOPIC', 'unclear message did not ask for a topic');
    const chosen = await emit(unclear.socket, 'conversation.intake.submit', {
      conversationId: asked.conversation.id,
      topicPublicId: registration.publicId,
    });
    assert(
      chosen.ok && chosen.data.routed === null && chosen.data.intake?.step === 'FORM',
      'topic choice did not lead to its form',
    );
    const completed = await emit(unclear.socket, 'conversation.intake.form', {
      conversationId: asked.conversation.id,
      answers: { full_name: 'Sipho Dlamini' },
      consent: true,
    });
    assert(completed.ok && completed.data.routed, 'form after topic choice did not route');
    results.formAfterChoice = 'topic choice, then form, then routed';

    // 3. Before-chat mode: the first message must carry valid answers.
    const timing = await request('/routing/settings', {
      method: 'PUT',
      cookie: owner.cookie,
      body: { intakeFormTiming: 'BEFORE_CHAT', defaultIntakeFormId: form.id },
    });
    assert(timing.response.ok, 'form timing update failed');
    const early = await openWidget(owner, origin);
    sockets.push(early.socket);
    assert(early.boot.form?.name === 'Company details', 'bootstrap did not include the form');
    const missing = await emit(early.socket, 'conversation.start', {
      clientMessageId: randomUUID(),
      content: 'I want to register a new company',
    });
    assert(
      !missing.ok && missing.error.code === 'INTAKE_INVALID',
      'a chat started without the required form',
    );
    const withAnswers = await start(early, 'I want to register a new company', {
      intake: { answers: { full_name: 'Lerato Khumalo' }, consent: true },
    });
    assert(!withAnswers.intake, 'before-chat answers prompted again');
    assert(
      (await intakeOf(withAnswers.conversation.id))?.answers[0]?.value === 'Lerato Khumalo',
      'before-chat answers were not stored',
    );
    results.beforeChat = 'first message rejected without answers, accepted with them';

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
