import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

// The SDK is CommonJS, built by tools/run-e2e.mjs before the harnesses run.
const { BizChatClient, BizChatError } = createRequire(import.meta.url)(
  '../packages/sdk/dist/index.js',
);

const baseUrl = process.env.SMOKE_API_URL ?? 'http://localhost:4400';
const apiUrl = `${baseUrl}/api/v1`;
const dashboardOrigin = 'http://localhost:3000';
const runId = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
async function request(path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      origin: dashboardOrigin,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => undefined);
  return { response, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function expectError(promise, status, code) {
  try {
    await promise;
  } catch (error) {
    assert(error instanceof BizChatError, `expected a BizChatError, got ${error}`);
    assert(error.status === status, `expected ${status}, got ${error.status} ${error.code}`);
    if (code) assert(error.code === code, `expected ${code}, got ${error.code}`);
    return;
  }
  throw new Error(`expected ${status} ${code ?? ''}`);
}

async function main() {
  const registered = await request('/auth/register', {
    method: 'POST',
    body: {
      businessName: `SDK ${runId}`,
      displayName: 'SDK Owner',
      email: `sdk-${runId}@example.test`,
      password: 'phase-c-secure-passphrase',
      timezone: 'Africa/Johannesburg',
    },
  });
  assert(registered.response.status === 201 && registered.cookie, 'registration failed');
  const issued = await request('/integration-settings/keys', {
    method: 'POST',
    cookie: registered.cookie,
    body: {
      name: 'SDK smoke',
      scopes: [
        'conversations:read',
        'conversations:write',
        'messages:read',
        'messages:write',
        'customers:identify',
        'availability:read',
        'setup:read',
        'setup:write',
      ],
    },
  });
  assert(issued.response.status === 201, 'key creation failed');
  const sdk = new BizChatClient({ apiKey: issued.data.token, baseUrl });

  // Setup: a department, a skill, and a topic, then a classification preview.
  const department = await sdk.setup.departments.create({ name: 'Company registration' });
  const skill = await sdk.setup.skills.create({ name: 'CIPC filings' });
  const topic = await sdk.setup.topics.create({
    name: 'Register a company',
    departmentId: department.id,
    requiredSkillId: skill.id,
    keywords: [
      { phrase: 'register', weight: 2 },
      { phrase: 'new company', weight: 3 },
    ],
  });
  const preview = await sdk.setup.topics.test('How do I register a new company?');
  assert(preview.decision === 'ROUTE' && preview.topic?.id === topic.id, 'topic preview failed');
  await expectError(sdk.setup.topics.create({ name: 'Register a company' }), 409, 'TOPIC_EXISTS');
  const consultants = await sdk.setup.consultants.list();
  assert(consultants.length === 1 && consultants[0].role === 'OWNER', 'consultant list wrong');
  await expectError(
    sdk.setup.consultants.update(consultants[0].membershipId, { maxConcurrentChats: 2 }),
    403,
    'OWNER_MANAGEMENT_FORBIDDEN',
  );

  // Nobody is connected, so the business is open but offline.
  const availability = await sdk.availability();
  assert(availability.open && availability.availability === 'OFFLINE', 'availability wrong');
  assert(
    availability.departments.some((item) => item.publicId === department.publicId),
    'new department missing from availability',
  );

  // An idempotent create replays the original conversation instead of making a second one.
  const idempotencyKey = `sdk-${randomUUID()}`;
  const input = { externalId: `customer-${runId}`, content: 'I want to register a new company' };
  const first = await sdk.conversations.create(input, { idempotencyKey });
  const replay = await sdk.conversations.create(input, { idempotencyKey });
  assert(first.conversation.id === replay.conversation.id, 'idempotent create made two chats');
  const conversation = await sdk.conversations.get(first.conversation.id);
  assert(conversation.topicId === topic.id, 'conversation was not classified to the topic');
  await sdk.conversations.send(conversation.id, 'Thanks, we have your request.');
  const history = await sdk.conversations.messages(conversation.id);
  assert(history.messages.length === 2, `expected 2 messages, got ${history.messages.length}`);
  const resolved = await sdk.conversations.resolve(conversation.id, { reason: 'Handled' });
  assert(resolved.status === 'RESOLVED', 'resolve failed');

  const proof = await sdk.customers.identify({ externalId: `customer-${runId}`, name: 'Thandi' });
  assert(typeof proof.identityToken === 'string' && proof.expiresAt, 'identity proof missing');

  const stranger = new BizChatClient({ apiKey: 'bzc_not_a_real_key', baseUrl });
  await expectError(stranger.availability(), 401);

  console.log(
    JSON.stringify({
      ok: true,
      setup: 'department, skill, topic, preview, duplicate rejected, owner protected',
      availability: 'open, offline, new department listed',
      conversations: 'idempotent create replayed, classified, sent, read, resolved',
      identity: 'proof issued',
      errors: 'BizChatError with status and code',
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
