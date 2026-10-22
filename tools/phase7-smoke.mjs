import { randomUUID } from 'node:crypto';
import { hash } from 'argon2';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { io } from 'socket.io-client';

const apiA = process.env.SMOKE_API_A ?? 'http://127.0.0.1:4400';
const apiB = process.env.SMOKE_API_B ?? 'http://127.0.0.1:4401';
const dashboardOrigin = 'http://localhost:3000';
const runId = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:46379');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(
  baseUrl,
  path,
  { cookie, origin = dashboardOrigin, method = 'GET', body } = {},
) {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(origin ? { origin } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  return { response, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

function waitFor(socket, event, predicate = () => true, timeoutMs = 12_000) {
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

async function poll(check, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('poll timeout');
}

async function register() {
  const result = await request(apiA, '/auth/register', {
    method: 'POST',
    body: {
      businessName: `Phase 7 ${runId}`,
      displayName: 'Recovery Owner',
      email: `phase7-owner-${runId}@example.test`,
      password: 'phase-7-owner-passphrase',
      timezone: 'Africa/Johannesburg',
    },
  });
  assert(result.response.status === 201 && result.cookie, 'registration failed');
  const me = await request(apiA, '/auth/me', { cookie: result.cookie });
  return { cookie: result.cookie, me: me.data };
}

async function createConsultant(account, departmentId) {
  const email = `phase7-consultant-${runId}@example.test`;
  const password = 'phase-7-consultant-passphrase';
  const passwordHash = await hash(password, { type: 2 });
  const created = await prisma.$transaction(async (transaction) => {
    const user = await transaction.user.create({
      data: { email, displayName: 'Recovery Consultant', passwordHash },
    });
    const membership = await transaction.businessMembership.create({
      data: { businessId: account.me.business.id, userId: user.id, role: 'CONSULTANT' },
    });
    const profile = await transaction.agentProfile.create({
      data: { businessId: account.me.business.id, userId: user.id, membershipId: membership.id },
    });
    await transaction.agentDepartment.create({
      data: { businessId: account.me.business.id, agentProfileId: profile.id, departmentId },
    });
    return { user, membership, profile };
  });
  const login = await request(apiB, '/auth/login', { method: 'POST', body: { email, password } });
  assert(login.response.status === 200 && login.cookie, 'consultant login failed');
  return { ...created, cookie: login.cookie };
}

async function connectAgent(baseUrl, cookie) {
  const socket = io(`${baseUrl}/agent`, {
    extraHeaders: { Origin: dashboardOrigin, Cookie: cookie },
    transports: ['websocket'],
    forceNew: true,
  });
  const connected = await waitFor(socket, 'agent.connected');
  return { socket, connected };
}

async function connectWidget(baseUrl, token, origin) {
  const socket = io(`${baseUrl}/widget`, {
    auth: { token },
    extraHeaders: { Origin: origin },
    transports: ['websocket'],
    forceNew: true,
  });
  await waitFor(socket, 'widget.connected');
  return socket;
}

async function main() {
  const account = await register();
  const hostname = `phase7-${runId}.localhost`;
  const widgetOrigin = `http://${hostname}:3000`;
  const domain = await request(apiA, '/domains', {
    cookie: account.cookie,
    method: 'POST',
    body: { domain: hostname },
  });
  assert(domain.response.status === 201, 'domain creation failed');
  assert(
    (
      await request(apiA, `/domains/${domain.data.id}/verify`, {
        cookie: account.cookie,
        method: 'POST',
      })
    ).response.ok,
    'domain verification failed',
  );
  const departments = await request(apiA, '/departments', { cookie: account.cookie });
  const general = departments.data[0];
  const consultant = await createConsultant(account, general.id);
  const settings = await request(apiA, '/widget-settings', {
    cookie: account.cookie,
    method: 'PATCH',
    body: { agentDisconnectGraceSeconds: 2 },
  });
  assert(
    settings.response.ok && settings.data.agentDisconnectGraceSeconds === 2,
    'grace setting failed',
  );

  const ownerConnection = await connectAgent(apiB, account.cookie);
  let consultantConnection = await connectAgent(apiB, consultant.cookie);
  const owner = ownerConnection.socket;
  let consultantSocket = consultantConnection.socket;
  const sockets = [owner, consultantSocket];
  const bootstrap = await request(apiA, '/widget/bootstrap', {
    origin: widgetOrigin,
    method: 'POST',
    body: { businessPublicId: account.me.business.publicId },
  });
  assert(bootstrap.response.ok, 'widget bootstrap failed');
  let widget = await connectWidget(apiA, bootstrap.data.widgetSessionToken, widgetOrigin);
  sockets.push(widget);

  try {
    assert((await emit(owner, 'agent.presence.set', { state: 'AWAY' })).ok, 'owner away failed');
    const crossInstanceAssignment = waitFor(
      consultantSocket,
      'conversation.assigned',
      (event) => event.assignedAgentMembershipId === consultant.membership.id,
    );
    const started = await emit(widget, 'conversation.start', {
      clientMessageId: randomUUID(),
      content: 'Please test recovery reliability',
      departmentPublicId: general.publicId,
    });
    assert(started.ok, 'conversation start failed');
    const conversationId = started.data.conversation.id;
    await crossInstanceAssignment;
    assert(
      started.data.conversation.assignedAgentMembershipId === consultant.membership.id,
      'cross-instance routing did not select consultant',
    );

    const crossInstanceMessage = waitFor(
      widget,
      'message.new',
      (message) =>
        message.conversationId === conversationId && message.content === 'Cross-instance reply',
    );
    const firstReply = await emit(consultantSocket, 'message.send', {
      conversationId,
      clientMessageId: randomUUID(),
      content: 'Cross-instance reply',
    });
    assert(firstReply.ok, 'consultant reply failed');
    await crossInstanceMessage;
    const lastReceivedSequence = firstReply.data.sequenceNumber;

    widget.disconnect();
    const offlineReplyIds = [];
    for (const content of ['Missed reply one', 'Missed reply two']) {
      const reply = await emit(consultantSocket, 'message.send', {
        conversationId,
        clientMessageId: randomUUID(),
        content,
      });
      assert(reply.ok, 'offline reply persistence failed');
      offlineReplyIds.push(reply.data.id);
    }
    widget = await connectWidget(apiA, bootstrap.data.widgetSessionToken, widgetOrigin);
    sockets.push(widget);
    const recovered = await emit(widget, 'conversation.resume', {
      conversationId,
      afterSequence: lastReceivedSequence,
      limit: 100,
    });
    assert(
      recovered.ok &&
        offlineReplyIds.every((id) =>
          recovered.data.history.messages.some((message) => message.id === id),
        ),
      'missed messages were not recovered by sequence',
    );

    const grace = waitFor(
      widget,
      'conversation.recovery',
      (event) => event.conversationId === conversationId && event.state === 'DISCONNECTED_GRACE',
    );
    consultantSocket.disconnect();
    await grace;
    const restored = waitFor(
      widget,
      'conversation.recovery',
      (event) => event.conversationId === conversationId && event.state === 'RESTORED',
    );
    consultantConnection = await connectAgent(apiB, consultant.cookie);
    consultantSocket = consultantConnection.socket;
    sockets.push(consultantSocket);
    await restored;
    const stillAssigned = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    assert(
      stillAssigned.assignedAgentMembershipId === consultant.membership.id,
      'grace reconnect changed assignment',
    );

    const secondGrace = waitFor(
      widget,
      'conversation.recovery',
      (event) => event.conversationId === conversationId && event.state === 'DISCONNECTED_GRACE',
    );
    const reassigning = waitFor(
      widget,
      'conversation.recovery',
      (event) => event.conversationId === conversationId && event.state === 'REASSIGNING',
    );
    const ownerAssigned = waitFor(
      owner,
      'conversation.assigned',
      (event) =>
        event.conversation.id === conversationId &&
        event.assignedAgentMembershipId === account.me.membership.id,
    );
    consultantSocket.disconnect();
    await secondGrace;
    assert(
      (await emit(owner, 'agent.presence.set', { state: 'ONLINE' })).ok,
      'owner online failed',
    );
    await reassigning;
    await ownerAssigned;
    const reassignment = await prisma.conversationAssignment.findFirst({
      where: { conversationId, assignmentType: 'REASSIGNMENT' },
      orderBy: { assignedAt: 'desc' },
    });
    assert(
      reassignment?.agentProfileId === ownerConnection.connected.profile.id,
      'durable reassignment history missing',
    );

    const retryId = randomUUID();
    const retryInput = {
      conversationId,
      clientMessageId: retryId,
      content: 'Retry-safe visitor message',
    };
    const retryOne = await emit(widget, 'message.send', retryInput);
    const retryTwo = await emit(widget, 'message.send', retryInput);
    assert(
      retryOne.ok && retryTwo.ok && retryOne.data.id === retryTwo.data.id,
      'retry did not return idempotent message',
    );
    assert(
      (await prisma.message.count({
        where: { businessId: account.me.business.id, clientMessageId: retryId },
      })) === 1,
      'retry created a duplicate durable message',
    );

    assert(
      (await emit(owner, 'agent.presence.set', { state: 'AWAY' })).ok,
      'owner second away failed',
    );
    const ownerProfileId = ownerConnection.connected.profile.id;
    await redis.del(
      `presence:agent:${account.me.business.id}:${ownerProfileId}:sockets`,
      `presence:agent:${account.me.business.id}:${ownerProfileId}:state`,
    );
    const heartbeat = await emit(owner, 'agent.heartbeat', {});
    assert(
      heartbeat.ok && heartbeat.data.presence.state === 'AWAY',
      'presence did not rebuild after Redis key loss',
    );
    assert(
      (await redis.zcard(`presence:agent:${account.me.business.id}:${ownerProfileId}:sockets`)) ===
        1,
      'agent socket lease was not rebuilt',
    );

    const source = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    const orphanQueueConversation = await prisma.conversation.create({
      data: {
        businessId: source.businessId,
        visitorId: source.visitorId,
        departmentId: general.id,
        status: 'QUEUED',
        priority: 'HIGH',
      },
    });
    const reconstructed = await poll(() =>
      prisma.conversationQueueEntry.findUnique({
        where: { conversationId: orphanQueueConversation.id },
      }),
    );
    assert(
      reconstructed.assignedAt === null && reconstructed.removedAt === null,
      'PostgreSQL queue state was not reconstructed',
    );

    const timeline = await prisma.conversationEvent.findMany({ where: { conversationId } });
    assert(
      timeline.some((event) => event.type === 'REASSIGNED'),
      'reassignment timeline event missing',
    );
    console.log(
      JSON.stringify({
        ok: true,
        crossInstanceFanout: true,
        missedMessagesRecovered: offlineReplyIds.length,
        graceRestoredAssignment: true,
        timedReassignment: true,
        retryDuplicateCount: 1,
        redisPresenceRebuilt: true,
        queueReconstructed: true,
        conversationPreserved: true,
      }),
    );
  } finally {
    for (const socket of sockets) socket.disconnect();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
  });
