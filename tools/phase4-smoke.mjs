import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { io } from 'socket.io-client';

const baseUrl = process.env.SMOKE_API_URL ?? 'http://localhost:4400';
const apiUrl = `${baseUrl}/api/v1`;
const dashboardOrigin = 'http://localhost:3000';
const runId = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:46379');
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
async function register() {
  const result = await request('/auth/register', {
    method: 'POST',
    body: {
      businessName: `Phase 4 ${runId}`,
      displayName: 'Live Agent',
      email: `phase4-${runId}@example.test`,
      password: 'phase-4-secure-passphrase',
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
async function connectAgent(cookie) {
  const socket = io(`${baseUrl}/agent`, {
    extraHeaders: { Origin: dashboardOrigin, Cookie: cookie },
    transports: ['websocket'],
    forceNew: true,
  });
  const connected = await waitFor(socket, 'agent.connected');
  return { socket, connected };
}

async function main() {
  const account = await register();
  const hostname = `phase4-${runId}.localhost`;
  const widgetOrigin = `http://${hostname}:3000`;
  await setupDomain(account, hostname);
  const profile = await request('/agent-profile/me', { cookie: account.cookie });
  assert(
    profile.response.ok && profile.data.maxConcurrentChats === 5,
    'agent profile was not provisioned',
  );
  const updated = await request('/agent-profile/me', {
    method: 'PATCH',
    cookie: account.cookie,
    body: { maxConcurrentChats: 7, routingEnabled: true },
  });
  assert(
    updated.response.ok && updated.data.maxConcurrentChats === 7,
    'agent profile update failed',
  );

  const agentConnection = await connectAgent(account.cookie);
  const agent = agentConnection.socket;
  assert(agentConnection.connected.profile.presence === 'ONLINE', 'agent did not become online');
  const widgetBootstrap = await bootstrap(account, widgetOrigin);
  const availabilityPromise = new Promise((resolve) => {
    const socket = io(`${baseUrl}/widget`, {
      auth: { token: widgetBootstrap.widgetSessionToken },
      extraHeaders: { Origin: widgetOrigin },
      transports: ['websocket'],
      forceNew: true,
    });
    socket.once('business.presence', (event) => resolve({ socket, event }));
  });
  const { socket: widget, event: availability } = await availabilityPromise;
  assert(
    availability.availability === 'ONLINE' && availability.onlineAgents === 1,
    'widget did not receive online availability',
  );

  try {
    const newConversation = waitFor(agent, 'conversation.new');
    const newMessage = waitFor(agent, 'message.new');
    const started = await emit(widget, 'conversation.start', {
      clientMessageId: randomUUID(),
      content: 'Visitor needs live help',
    });
    assert(started.ok, 'visitor conversation start failed');
    const conversationId = started.data.conversation.id;
    assert(
      (await newConversation).id === conversationId &&
        (await newMessage).conversationId === conversationId,
      'live inbox did not receive new conversation/message',
    );

    const visitorPresence = waitFor(
      agent,
      'visitor.presence',
      (event) => event.conversationId === conversationId,
    );
    const subscribed = await emit(agent, 'conversation.subscribe', { conversationId });
    assert(
      subscribed.ok &&
        subscribed.data.history.messages.some(
          (message) =>
            message.senderType === 'VISITOR' && message.content === 'Visitor needs live help',
        ),
      'agent subscription/history failed',
    );
    assert((await visitorPresence).state === 'ONLINE', 'initial visitor presence was not restored');

    const agentSeesTyping = waitFor(
      agent,
      'typing.changed',
      (event) => event.conversationId === conversationId && event.typing,
    );
    const visitorTyping = await emit(widget, 'typing.start', { conversationId });
    assert(
      visitorTyping.ok && (await agentSeesTyping).participantType === 'VISITOR',
      'visitor typing was not delivered',
    );
    const typingKeys = await redis.keys(`typing:${conversationId}:VISITOR:*`);
    assert(
      typingKeys.length === 1 && (await redis.ttl(typingKeys[0])) > 0,
      'visitor typing did not receive Redis TTL',
    );
    await new Promise((resolve) => setTimeout(resolve, 7_000));
    assert(
      (await redis.keys(`typing:${conversationId}:VISITOR:*`)).length === 0,
      'stuck typing state did not expire',
    );

    const widgetSeesTyping = waitFor(
      widget,
      'typing.changed',
      (event) => event.conversationId === conversationId && event.typing,
    );
    const agentTyping = await emit(agent, 'typing.start', { conversationId });
    assert(
      agentTyping.ok && (await widgetSeesTyping).displayName === 'Live Agent',
      'agent typing was not delivered',
    );
    await emit(agent, 'typing.stop', { conversationId });

    const unreadBefore = await request('/conversations?limit=30', { cookie: account.cookie });
    const summaryBefore = unreadBefore.data.conversations.find(
      (item) => item.id === conversationId,
    );
    assert(
      summaryBefore.unreadCount === 1 &&
        summaryBefore.lastMessagePreview === 'Visitor needs live help',
      'durable unread/preview state incorrect',
    );
    const read = await emit(agent, 'message.read', { conversationId, throughSequence: '1' });
    assert(read.ok, 'agent read receipt failed');
    const unreadAfter = await request('/conversations?limit=30', { cookie: account.cookie });
    assert(
      unreadAfter.data.conversations.find((item) => item.id === conversationId).unreadCount === 0,
      'agent read state did not clear unread count',
    );

    const visitorReply = waitFor(
      widget,
      'message.new',
      (message) => message.conversationId === conversationId && message.senderType === 'AGENT',
    );
    const sent = await emit(agent, 'message.send', {
      conversationId,
      clientMessageId: randomUUID(),
      content: 'I am here to help',
    });
    assert(sent.ok && (await visitorReply).id === sent.data.id, 'agent live reply failed');
    const receipt = await emit(widget, 'message.read', {
      conversationId,
      throughSequence: sent.data.sequenceNumber,
    });
    assert(receipt.ok, 'visitor read receipt failed');

    const heartbeat = await emit(agent, 'agent.heartbeat', {});
    assert(heartbeat.ok && heartbeat.data.presence.state === 'ONLINE', 'agent heartbeat failed');
    const away = await emit(agent, 'agent.presence.set', { state: 'AWAY' });
    assert(away.ok && away.data.state === 'AWAY', 'manual presence failed');
    const offlinePromise = waitFor(
      widget,
      'business.presence',
      (event) => event.availability === 'OFFLINE',
    );
    agent.disconnect();
    assert(
      (await offlinePromise).onlineAgents === 0,
      'disconnect did not update business availability',
    );

    const reconnect = await connectAgent(account.cookie);
    const catchup = await emit(reconnect.socket, 'conversation.subscribe', {
      conversationId,
      afterSequence: '1',
    });
    assert(
      catchup.ok &&
        catchup.data.history.messages.some(
          (message) => message.senderType === 'AGENT' && message.content === 'I am here to help',
        ),
      'agent reconnect catch-up failed',
    );
    reconnect.socket.disconnect();
    console.log(
      JSON.stringify({
        ok: true,
        conversationId,
        profileMaxChats: updated.data.maxConcurrentChats,
        presence: 'ONLINE->AWAY->OFFLINE->ONLINE',
        unread: '1->0',
        typingTtlExpired: true,
        messages: 2,
      }),
    );
  } finally {
    widget.disconnect();
    agent.disconnect();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => redis.quit());
