import { randomUUID } from 'node:crypto';
import { hash } from 'argon2';
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
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(origin ? { origin } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
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
      businessName: `Phase 6 ${runId}`,
      displayName: 'Owner Agent',
      email: `phase6-owner-${runId}@example.test`,
      password: 'phase-6-owner-passphrase',
      timezone: 'Africa/Johannesburg',
    },
  });
  assert(result.response.status === 201 && result.cookie, 'registration failed');
  const me = await request('/auth/me', { cookie: result.cookie });
  return { cookie: result.cookie, me: me.data };
}
async function createConsultant(account, departmentId) {
  const email = `phase6-consultant-${runId}@example.test`;
  const password = 'phase-6-consultant-passphrase';
  const passwordHash = await hash(password, { type: 2 });
  const created = await prisma.$transaction(async (transaction) => {
    const user = await transaction.user.create({
      data: { email, displayName: 'Receiving Agent', passwordHash },
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
  const login = await request('/auth/login', { method: 'POST', body: { email, password } });
  assert(login.response.status === 200 && login.cookie, 'consultant login failed');
  return { ...created, cookie: login.cookie };
}
async function setupDomain(account, hostname) {
  const created = await request('/domains', {
    method: 'POST',
    cookie: account.cookie,
    body: { domain: hostname },
  });
  assert(created.response.status === 201, 'domain creation failed');
  assert(
    (
      await request(`/domains/${created.data.id}/verify`, {
        method: 'POST',
        cookie: account.cookie,
      })
    ).response.ok,
    'domain verification failed',
  );
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
async function connectWidget(account, origin) {
  const bootstrap = await request('/widget/bootstrap', {
    method: 'POST',
    origin,
    body: { businessPublicId: account.me.business.publicId },
  });
  assert(bootstrap.response.ok, 'bootstrap failed');
  const socket = io(`${baseUrl}/widget`, {
    auth: { token: bootstrap.data.widgetSessionToken },
    extraHeaders: { Origin: origin },
    transports: ['websocket'],
    forceNew: true,
  });
  await waitFor(socket, 'widget.connected');
  return socket;
}

async function main() {
  const account = await register();
  const hostname = `phase6-${runId}.localhost`;
  const widgetOrigin = `http://${hostname}:3000`;
  await setupDomain(account, hostname);
  const departments = await request('/departments', { cookie: account.cookie });
  const general = departments.data[0];
  const consultant = await createConsultant(account, general.id);
  const ownerConnection = await connectAgent(account.cookie);
  const consultantConnection = await connectAgent(consultant.cookie);
  const ownerSocket = ownerConnection.socket;
  const consultantSocket = consultantConnection.socket;
  const widget = await connectWidget(account, widgetOrigin);
  try {
    assert(
      (await emit(ownerSocket, 'agent.presence.set', { state: 'AWAY' })).ok,
      'owner away state failed',
    );
    const started = await emit(widget, 'conversation.start', {
      clientMessageId: randomUUID(),
      content: 'I need help with a complaint',
      departmentPublicId: general.publicId,
    });
    assert(started.ok, 'conversation start failed');
    const conversationId = started.data.conversation.id;
    assert(
      started.data.conversation.assignedAgentMembershipId === consultant.membership.id,
      'conversation was not assigned to the only online eligible consultant',
    );

    const tag = await request('/tags', {
      cookie: account.cookie,
      method: 'POST',
      body: { name: 'Complaint', color: '#b45309' },
    });
    assert(tag.response.status === 201, 'tag creation failed');
    const tagged = await request(`/conversations/${conversationId}/tags`, {
      cookie: account.cookie,
      method: 'POST',
      body: { tagIds: [tag.data.id] },
    });
    assert(
      tagged.response.ok && tagged.data.tags[0].name === 'Complaint',
      'conversation tag assignment failed',
    );
    const canned = await request('/canned-responses', {
      cookie: account.cookie,
      method: 'POST',
      body: {
        title: 'Complaint greeting',
        content: 'Thank you for explaining the issue. I will investigate it.',
        shortcut: '/complaint',
        departmentId: general.id,
      },
    });
    assert(canned.response.status === 201, 'canned response creation failed');
    const cannedSearch = await request('/canned-responses?q=complaint', {
      cookie: consultant.cookie,
    });
    assert(
      cannedSearch.response.ok && cannedSearch.data.some((item) => item.id === canned.data.id),
      'canned response search failed',
    );

    const note = await request(`/conversations/${conversationId}/notes`, {
      cookie: consultant.cookie,
      method: 'POST',
      body: {
        clientMessageId: randomUUID(),
        content: 'Customer has contacted us twice; do not expose this note.',
      },
    });
    assert(
      note.response.status === 201 && note.data.messageType === 'INTERNAL_NOTE',
      'internal note creation failed',
    );
    const dashboardHistory = await request(`/conversations/${conversationId}/messages?limit=100`, {
      cookie: consultant.cookie,
    });
    assert(
      dashboardHistory.data.messages.some((item) => item.id === note.data.id),
      'internal note missing from dashboard history',
    );
    const visitorHistory = await emit(widget, 'conversation.resume', {
      conversationId,
      limit: 100,
    });
    assert(
      visitorHistory.ok &&
        visitorHistory.data.history.messages.every((item) => item.messageType !== 'INTERNAL_NOTE'),
      'internal note leaked to visitor history',
    );

    const transferEvent = waitFor(
      ownerSocket,
      'conversation.transferred',
      (event) => event.conversation.id === conversationId,
    );
    const transferred = await request(`/conversations/${conversationId}/transfer`, {
      cookie: consultant.cookie,
      method: 'POST',
      body: {
        agentProfileId: ownerConnection.connected.profile.id,
        expectedAssignedAgentMembershipId: consultant.membership.id,
        reason: 'Owner escalation',
      },
    });
    assert(
      transferred.response.ok &&
        transferred.data.id === conversationId &&
        transferred.data.assignedAgentMembershipId === account.me.membership.id,
      'agent transfer failed',
    );
    await transferEvent;
    const denied = await request(`/conversations/${conversationId}`, { cookie: consultant.cookie });
    assert(
      denied.response.status === 403,
      'departing consultant retained assigned-conversation access',
    );
    const assignmentsAfterTransfer = await prisma.conversationAssignment.count({
      where: { conversationId },
    });
    assert(assignmentsAfterTransfer === 2, 'transfer assignment history was not append-only');

    const resolvedEvent = waitFor(
      widget,
      'conversation.updated',
      (event) => event.conversation.id === conversationId && event.operation === 'RESOLVED',
    );
    const resolved = await request(`/conversations/${conversationId}/resolve`, {
      cookie: account.cookie,
      method: 'POST',
      body: {},
    });
    assert(
      resolved.response.ok && resolved.data.status === 'RESOLVED' && resolved.data.resolvedAt,
      'resolve operation failed',
    );
    await resolvedEvent;
    const reopened = await request(`/conversations/${conversationId}/reopen`, {
      cookie: account.cookie,
      method: 'POST',
      body: { reason: 'Customer supplied more context' },
    });
    assert(
      reopened.response.ok &&
        reopened.data.id === conversationId &&
        reopened.data.status === 'ASSIGNED',
      'reopen did not preserve and reroute the conversation',
    );
    assert(
      reopened.data.assignedAgentMembershipId === consultant.membership.id,
      'reopen did not fall back to the online consultant',
    );

    const sales = await request('/departments', {
      cookie: account.cookie,
      method: 'POST',
      body: { name: 'Escalations', description: 'Escalated cases' },
    });
    assert(sales.response.status === 201, 'department creation failed');
    const departmentTransfer = await request(`/conversations/${conversationId}/transfer`, {
      cookie: account.cookie,
      method: 'POST',
      body: {
        departmentId: sales.data.id,
        expectedAssignedAgentMembershipId: consultant.membership.id,
      },
    });
    assert(
      departmentTransfer.response.ok &&
        departmentTransfer.data.status === 'QUEUED' &&
        departmentTransfer.data.id === conversationId,
      'department transfer did not queue without an online eligible member',
    );
    const assignedToOwner = waitFor(
      ownerSocket,
      'conversation.assigned',
      (event) => event.conversation.id === conversationId,
    );
    assert(
      (await emit(ownerSocket, 'agent.presence.set', { state: 'ONLINE' })).ok,
      'owner online state failed',
    );
    await assignedToOwner;
    const consultantMembership = await request('/departments/mine', {
      cookie: consultant.cookie,
      method: 'PUT',
      body: { departmentIds: [general.id, sales.data.id] },
    });
    assert(consultantMembership.response.ok, 'consultant escalation membership failed');

    const beforeRace = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    const raceBody = {
      agentProfileId: consultant.profile.id,
      expectedAssignedAgentMembershipId: beforeRace.assignedAgentMembershipId,
    };
    const raced = await Promise.all([
      request(`/conversations/${conversationId}/transfer`, {
        cookie: account.cookie,
        method: 'POST',
        body: raceBody,
      }),
      request(`/conversations/${conversationId}/transfer`, {
        cookie: account.cookie,
        method: 'POST',
        body: raceBody,
      }),
    ]);
    assert(
      raced.filter((item) => item.response.ok).length === 1 &&
        raced.filter((item) => item.response.status === 409).length === 1,
      'concurrent transfer did not produce exactly one winner',
    );

    const events = await request(`/conversations/${conversationId}/events`, {
      cookie: account.cookie,
    });
    const eventTypes = new Set(events.data.map((event) => event.type));
    assert(
      [
        'CREATED',
        'ASSIGNED',
        'TAGS_CHANGED',
        'INTERNAL_NOTE_ADDED',
        'TRANSFERRED',
        'RESOLVED',
        'REOPENED',
      ].every((type) => eventTypes.has(type)),
      'conversation timeline is incomplete',
    );
    const finalConversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    const finalAssignments = await prisma.conversationAssignment.count({
      where: { conversationId },
    });
    console.log(
      JSON.stringify({
        ok: true,
        conversationPreserved: finalConversation.id === conversationId,
        internalNotePrivate: true,
        agentTransfer: true,
        departmentTransfer: 'QUEUED->ASSIGNED',
        resolveReopen: 'RESOLVED->ASSIGNED',
        atomicTransferWinners: 1,
        tags: 1,
        cannedResponses: 1,
        timelineEvents: events.data.length,
        assignmentHistory: finalAssignments,
      }),
    );
  } finally {
    widget.disconnect();
    ownerSocket.disconnect();
    consultantSocket.disconnect();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
