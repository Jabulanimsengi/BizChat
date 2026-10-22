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

async function register(label) {
  const result = await request('/auth/register', {
    method: 'POST',
    body: {
      businessName: `Phase 3 ${label} ${runId}`,
      displayName: `${label} Owner`,
      email: `phase3-${label.toLowerCase()}-${runId}@example.test`,
      password: 'phase-3-secure-passphrase',
      timezone: 'Africa/Johannesburg',
    },
  });
  assert(
    result.response.status === 201 && result.cookie,
    `${label} registration failed: ${result.response.status}`,
  );
  const me = await request('/auth/me', { cookie: result.cookie });
  assert(me.response.ok, `${label} session failed`);
  return { cookie: result.cookie, me: me.data };
}

async function verifyDomain(account, hostname) {
  const created = await request('/domains', {
    method: 'POST',
    cookie: account.cookie,
    body: { domain: hostname },
  });
  assert(created.response.status === 201, `domain create failed: ${created.response.status}`);
  const verified = await request(`/domains/${created.data.id}/verify`, {
    method: 'POST',
    cookie: account.cookie,
  });
  assert(
    verified.response.ok && verified.data.status === 'VERIFIED',
    `domain verify failed: ${verified.response.status}`,
  );
}

async function bootstrap(account, origin, visitorToken) {
  const result = await request('/widget/bootstrap', {
    method: 'POST',
    origin,
    body: {
      businessPublicId: account.me.business.publicId,
      ...(visitorToken ? { visitorToken } : {}),
    },
  });
  assert(result.response.ok, `widget bootstrap failed: ${result.response.status}`);
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

async function main() {
  const tenantA = await register('Alpha');
  const tenantB = await register('Beta');
  const hostnameA = `tenant-a-${runId}.localhost`;
  const hostnameB = `tenant-b-${runId}.localhost`;
  const originA = `http://${hostnameA}:3000`;
  const originB = `http://${hostnameB}:3000`;
  await verifyDomain(tenantA, hostnameA);
  await verifyDomain(tenantB, hostnameB);

  const bootstrapA = await bootstrap(tenantA, originA);
  const bootstrapOtherVisitor = await bootstrap(tenantA, originA);
  const bootstrapB = await bootstrap(tenantB, originB);
  const visitor = await connectWidget(originA, bootstrapA.widgetSessionToken);
  const otherVisitor = await connectWidget(originA, bootstrapOtherVisitor.widgetSessionToken);
  const crossTenant = await connectWidget(originB, bootstrapB.widgetSessionToken);

  try {
    const startId = randomUUID();
    const started = await emit(visitor, 'conversation.start', {
      clientMessageId: startId,
      content: 'Phase 3 first message',
    });
    assert(started.ok, `conversation start failed: ${started.error?.message}`);
    const conversationId = started.data.conversation.id;

    const unauthorizedVisitor = await emit(otherVisitor, 'conversation.resume', {
      conversationId,
      limit: 50,
    });
    const unauthorizedTenant = await emit(crossTenant, 'conversation.resume', {
      conversationId,
      limit: 50,
    });
    assert(!unauthorizedVisitor.ok && !unauthorizedTenant.ok, 'visitor or tenant isolation failed');

    const concurrentIds = Array.from({ length: 20 }, () => randomUUID());
    const concurrent = await Promise.all(
      concurrentIds.map((clientMessageId, index) =>
        emit(visitor, 'message.send', {
          conversationId,
          clientMessageId,
          content: `Concurrent visitor message ${index + 1}`,
        }),
      ),
    );
    assert(
      concurrent.every((result) => result.ok),
      'one or more concurrent sends failed',
    );

    const retryId = randomUUID();
    const [retryOne, retryTwo] = await Promise.all([
      emit(visitor, 'message.send', {
        conversationId,
        clientMessageId: retryId,
        content: 'Retry-safe message',
      }),
      emit(visitor, 'message.send', {
        conversationId,
        clientMessageId: retryId,
        content: 'Retry-safe message',
      }),
    ]);
    assert(
      retryOne.ok && retryTwo.ok && retryOne.data.id === retryTwo.data.id,
      'idempotent retry created divergent results',
    );

    const history = await request(`/conversations/${conversationId}/messages?limit=100`, {
      cookie: tenantA.cookie,
    });
    assert(history.response.ok, `agent history failed: ${history.response.status}`);
    const visitorMessages = history.data.messages;
    const sequences = visitorMessages.map((message) => BigInt(message.sequenceNumber));
    assert(
      visitorMessages.length === 22,
      `expected 22 unique visitor messages, received ${visitorMessages.length}`,
    );
    assert(
      sequences.every((sequence, index) => sequence === BigInt(index + 1)),
      'message sequences are not continuous',
    );

    const catchup = await emit(visitor, 'conversation.resume', {
      conversationId,
      afterSequence: '10',
      limit: 100,
    });
    assert(
      catchup.ok &&
        catchup.data.history.messages.length === 12 &&
        catchup.data.history.messages[0].sequenceNumber === '11',
      'reconnect catch-up failed',
    );
    const earlier = await emit(visitor, 'conversation.history', {
      conversationId,
      beforeSequence: '11',
      limit: 5,
    });
    assert(
      earlier.ok &&
        earlier.data.messages.length === 5 &&
        earlier.data.messages[0].sequenceNumber === '6',
      'backward history page failed',
    );

    const agentMessagePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('agent message was not broadcast')),
        10_000,
      );
      visitor.once('message.new', (message) => {
        clearTimeout(timeout);
        resolve(message);
      });
    });
    const replyId = randomUUID();
    const reply = await request(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      cookie: tenantA.cookie,
      body: { clientMessageId: replyId, content: 'Agent reply' },
    });
    assert(reply.response.status === 201, `agent reply failed: ${reply.response.status}`);
    const broadcast = await agentMessagePromise;
    assert(
      broadcast.id === reply.data.id && broadcast.sequenceNumber === '23',
      'committed agent broadcast mismatch',
    );

    const delivered = await emit(visitor, 'message.delivered', {
      conversationId,
      messageId: reply.data.id,
    });
    const read = await emit(visitor, 'message.read', {
      conversationId,
      throughSequence: reply.data.sequenceNumber,
    });
    assert(delivered.ok && read.ok, 'receipt persistence failed');

    const tenantEscape = await request(`/conversations/${conversationId}`, {
      cookie: tenantB.cookie,
    });
    assert(
      tenantEscape.response.status === 403,
      `cross-tenant dashboard access returned ${tenantEscape.response.status}`,
    );
    const invalidTransition = await request(`/conversations/${conversationId}/status`, {
      method: 'PATCH',
      cookie: tenantA.cookie,
      body: { status: 'CLOSED' },
    });
    assert(
      invalidTransition.response.status === 409,
      `invalid lifecycle transition returned ${invalidTransition.response.status}`,
    );
    const queued = await request(`/conversations/${conversationId}/status`, {
      method: 'PATCH',
      cookie: tenantA.cookie,
      body: { status: 'QUEUED' },
    });
    assert(
      queued.response.ok && queued.data.status === 'QUEUED',
      'valid lifecycle transition failed',
    );

    const stored = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { messages: { orderBy: { sequenceNumber: 'asc' } }, participants: true },
    });
    const receipt = await prisma.messageReceipt.findFirst({
      where: { messageId: reply.data.id, participantType: 'VISITOR' },
    });
    assert(
      stored?.messages.length === 23 && stored.nextSequence === 23n,
      'database message count/sequence mismatch',
    );
    assert(
      stored.participants.some((participant) => participant.participantType === 'VISITOR') &&
        stored.participants.some((participant) => participant.participantType === 'AGENT'),
      'participant persistence failed',
    );
    assert(receipt?.deliveredAt && receipt.readAt, 'database receipt timestamps missing');

    console.log(
      JSON.stringify({
        ok: true,
        conversationId,
        messages: stored.messages.length,
        nextSequence: stored.nextSequence.toString(),
        participants: stored.participants.length,
        crossTenantStatus: tenantEscape.response.status,
        invalidTransitionStatus: invalidTransition.response.status,
      }),
    );
  } finally {
    visitor.disconnect();
    otherVisitor.disconnect();
    crossTenant.disconnect();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
