import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { io } from 'socket.io-client';

const baseUrl = process.env.SMOKE_API_URL ?? 'http://localhost:4400';
const apiUrl = `${baseUrl}/api/v1`;
const dashboardOrigin = 'http://localhost:3000';
const runId = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
const prisma = new PrismaClient();
const OFFER_TIMEOUT_SECONDS = 10;

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
/** Resolves with the first socket (by key) that receives a matching event. */
function waitForAny(sockets, event, predicate, timeoutMs = 10_000) {
  return Promise.race(
    Object.entries(sockets).map(([key, socket]) =>
      waitFor(socket, event, predicate, timeoutMs).then((value) => ({ key, value })),
    ),
  );
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
      businessName: `Phase B2 ${runId}`,
      displayName: 'Offer Owner',
      email: `phaseb2-${runId}@example.test`,
      password: 'phase-b2-secure-passphrase',
      timezone: 'Africa/Johannesburg',
    },
  });
  assert(result.response.status === 201 && result.cookie, 'registration failed');
  const me = await request('/auth/me', { cookie: result.cookie });
  return { cookie: result.cookie, me: me.data };
}
async function addConsultant(owner, departmentId) {
  const email = `phaseb2-consultant-${runId}@example.test`;
  const password = 'phase-b2-consultant-passphrase';
  const created = await request('/users', {
    method: 'POST',
    cookie: owner.cookie,
    body: {
      displayName: 'Offer Consultant',
      email,
      password,
      role: 'CONSULTANT',
      departmentIds: [departmentId],
    },
  });
  assert(created.response.status === 201, 'consultant creation failed');
  const login = await request('/auth/login', { method: 'POST', body: { email, password } });
  assert(login.response.ok && login.cookie, 'consultant login failed');
  const me = await request('/auth/me', { cookie: login.cookie });
  return { cookie: login.cookie, me: me.data };
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
async function connectAgent(cookie) {
  const socket = io(`${baseUrl}/agent`, {
    extraHeaders: { Origin: dashboardOrigin, Cookie: cookie },
    transports: ['websocket'],
    forceNew: true,
  });
  await waitFor(socket, 'agent.connected');
  return socket;
}
async function startVisitor(account, origin) {
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
  // Keep the widget session fresh so the visitor is never treated as departed.
  const heartbeat = setInterval(() => socket.emit('widget.heartbeat'), 5_000);
  socket.on('disconnect', () => clearInterval(heartbeat));
  const started = await emit(socket, 'conversation.start', {
    clientMessageId: randomUUID(),
    content: `I need help with my registration ${randomUUID().slice(0, 8)}`,
  });
  assert(started.ok, 'conversation start failed');
  return { socket, conversationId: started.data.conversation.id, started: started.data };
}

async function main() {
  const owner = await register();
  const departments = await request('/departments', { cookie: owner.cookie });
  const general = departments.data.find((department) => department.isDefault);
  const consultant = await addConsultant(owner, general.id);
  const hostname = `phaseb2-${runId}.localhost`;
  const origin = `http://${hostname}:3000`;
  await setupDomain(owner, hostname);
  const configured = await request('/routing/settings', {
    method: 'PUT',
    cookie: owner.cookie,
    body: {
      assignmentMode: 'OFFER',
      offerTimeoutSeconds: OFFER_TIMEOUT_SECONDS,
      missedOffersBeforeAway: 2,
      exclusionSeconds: 60,
    },
  });
  assert(configured.response.ok, 'routing settings update failed');

  const memberships = {
    owner: owner.me.membership.id,
    consultant: consultant.me.membership.id,
  };
  const agents = {
    owner: await connectAgent(owner.cookie),
    consultant: await connectAgent(consultant.cookie),
  };
  // A second dashboard tab per consultant, so the accept race always runs whoever accepts.
  const secondTabs = {
    owner: await connectAgent(owner.cookie),
    consultant: await connectAgent(consultant.cookie),
  };
  const sockets = [agents.owner, agents.consultant, secondTabs.owner, secondTabs.consultant];
  const results = {};
  try {
    // 1. A declined offer moves to the other consultant; two tabs racing to accept yield one winner.
    const firstOfferPromise = waitForAny(agents, 'conversation.offered', () => true);
    const first = await startVisitor(owner, origin);
    sockets.push(first.socket);
    assert(first.started.conversation.status === 'OFFERED', 'first chat was not offered');
    const firstOffer = await firstOfferPromise;
    const decliner = firstOffer.key;
    const accepter = decliner === 'owner' ? 'consultant' : 'owner';
    const reofferPromise = waitFor(
      agents[accepter],
      'conversation.offered',
      (offer) => offer.conversation.id === first.conversationId,
    );
    const declined = await emit(agents[decliner], 'offer.decline', {
      offerId: firstOffer.value.offerId,
      reason: 'Not my area',
    });
    assert(declined.ok, 'decline failed');
    const reoffer = await reofferPromise;
    const acceptingTabs = [agents[accepter], secondTabs[accepter]];
    const assignedForVisitor = waitFor(
      first.socket,
      'conversation.routed',
      (event) => event.outcome === 'ASSIGNED',
    );
    const accepts = await Promise.all(
      acceptingTabs.map((socket) => emit(socket, 'offer.accept', { offerId: reoffer.offerId })),
    );
    assert(
      accepts.filter((result) => result.ok).length === 1,
      'accept race did not yield one winner',
    );
    for (const result of accepts.filter((item) => !item.ok))
      assert(
        result.error.code === 'OFFER_NO_LONGER_AVAILABLE',
        'losing accept had the wrong error',
      );
    await assignedForVisitor;
    const firstState = await prisma.conversation.findUniqueOrThrow({
      where: { id: first.conversationId },
      include: { offers: { orderBy: { offeredAt: 'asc' } }, assignments: true },
    });
    assert(
      firstState.status === 'ASSIGNED' &&
        firstState.assignedAgentMembershipId === memberships[accepter] &&
        firstState.currentOfferId === null,
      'accepted conversation is not assigned to the accepter',
    );
    assert(
      firstState.offers.map((offer) => offer.outcome).join(',') === 'DECLINED,ACCEPTED' &&
        firstState.assignments.length === 1,
      'offer history or assignment record is wrong',
    );
    results.declineThenAccept = `${decliner} declined, ${accepter} accepted`;
    results.acceptRace = `${accepts.filter((result) => result.ok).length} of ${accepts.length} tabs won`;

    // 2. With the other consultant busy, two missed offers set the decliner away.
    const busy = await emit(agents[accepter], 'agent.presence.set', { state: 'BUSY' });
    assert(busy.ok, 'could not set the accepter busy');
    const missed = [];
    for (let index = 0; index < 2; index += 1) {
      const offered = waitFor(agents[decliner], 'conversation.offered', () => true);
      const visitor = await startVisitor(owner, origin);
      sockets.push(visitor.socket);
      const offer = await offered;
      const withdrawn = waitFor(
        agents[decliner],
        'conversation.offer.withdrawn',
        (event) => event.offerId === offer.offerId,
        (OFFER_TIMEOUT_SECONDS + 10) * 1_000,
      );
      const notice =
        index === 1
          ? waitFor(
              agents[decliner],
              'agent.notice',
              () => true,
              (OFFER_TIMEOUT_SECONDS + 10) * 1_000,
            )
          : null;
      const expired = await withdrawn;
      assert(expired.reason === 'EXPIRED', 'unanswered offer was not expired');
      if (notice) {
        const received = await notice;
        assert(received.code === 'SET_AWAY_AFTER_MISSED_OFFERS', 'missed-offer notice missing');
      }
      missed.push(visitor.conversationId);
    }
    const lateAccept = await emit(agents[decliner], 'offer.accept', {
      offerId: (
        await prisma.conversationOffer.findFirstOrThrow({
          where: { conversationId: missed[0], outcome: 'EXPIRED' },
        })
      ).id,
    });
    assert(
      !lateAccept.ok && lateAccept.error.code === 'OFFER_NO_LONGER_AVAILABLE',
      'an expired offer could still be accepted',
    );
    for (const conversationId of missed) {
      const state = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
      assert(state.status === 'QUEUED', 'missed conversation did not return to the queue');
    }
    results.missedOffers = `two expiries, ${decliner} set away, chats requeued`;

    // 3. When the busy consultant comes back, the queue drains to them oldest first.
    const drained = waitFor(
      agents[accepter],
      'conversation.offered',
      (offer) => offer.conversation.id === missed[0],
    );
    const online = await emit(agents[accepter], 'agent.presence.set', { state: 'ONLINE' });
    assert(online.ok, 'could not set the accepter online');
    await drained;
    results.drainOnReturn = 'oldest missed chat offered to returning consultant';

    // 4. A consultant who disconnects loses pending offers immediately. The decliner is now the
    // least busy, so a fresh chat is offered to them; disconnecting moves it to the accepter.
    const backOnline = await emit(agents[decliner], 'agent.presence.set', { state: 'ONLINE' });
    assert(backOnline.ok, 'could not bring the decliner back online');
    const freshOffered = waitFor(agents[decliner], 'conversation.offered', () => true);
    const fresh = await startVisitor(owner, origin);
    sockets.push(fresh.socket);
    const freshOffer = await freshOffered;
    assert(freshOffer.conversation.id === fresh.conversationId, 'fresh chat went elsewhere');
    const reoffered = waitFor(
      agents[accepter],
      'conversation.offered',
      (offer) => offer.conversation.id === fresh.conversationId,
      15_000,
    );
    for (const socket of [agents[decliner], secondTabs[decliner]]) socket.disconnect();
    await reoffered;
    const cancelled = await prisma.conversationOffer.findUniqueOrThrow({
      where: { id: freshOffer.offerId },
    });
    assert(
      cancelled.outcome === 'CANCELLED' && cancelled.reason === 'AGENT_DISCONNECTED',
      'disconnect did not cancel the pending offer',
    );
    results.disconnect = 'pending offer cancelled and re-offered';

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
