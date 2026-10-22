import { randomUUID } from 'node:crypto';

const baseUrl = (process.env.PRODUCTION_API_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
const apiUrl = `${baseUrl}/api/v1`;
const deadline = Date.now() + 240_000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      ...headers,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  return { response, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

async function waitForReady() {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiUrl}/health/ready`);
      if (response.ok) return;
    } catch {
      // retry until the deadline
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error('production API did not become ready');
}

async function main() {
  await waitForReady();

  const health = await request('/health/ready');
  assert(health.response.status === 200, 'readiness check failed');

  for (const header of ['x-content-type-options', 'x-frame-options', 'strict-transport-security']) {
    assert(health.response.headers.has(header), `missing security header: ${header}`);
  }

  const metricsResponse = await fetch(`${apiUrl}/metrics`);
  const metricsBody = await metricsResponse.text();
  assert(metricsResponse.status === 200, 'metrics endpoint unavailable');
  assert(
    metricsResponse.headers.get('content-type')?.includes('text/plain') === true,
    'metrics content type invalid',
  );
  assert(metricsBody.includes('bizchat_http_requests_total'), 'metrics payload invalid');

  const email = `production-smoke-${randomUUID()}@example.test`;
  const registered = await request('/auth/register', {
    method: 'POST',
    body: {
      businessName: 'Production Smoke Co',
      displayName: 'Production Smoke',
      email,
      password: 'production-smoke-passphrase',
      timezone: 'UTC',
    },
  });
  assert(registered.response.status === 201 && registered.cookie, 'registration failed');

  const session = await request('/auth/me', { cookie: registered.cookie });
  assert(session.response.status === 200, 'session lookup failed');
  assert(session.data?.user?.email === email, 'session returned the wrong user');

  const issued = await request('/integration-settings/keys', {
    method: 'POST',
    cookie: registered.cookie,
    body: {
      name: 'Production smoke',
      scopes: ['conversations:read', 'conversations:write', 'messages:write'],
    },
  });
  assert(issued.response.status === 201 && issued.data?.token, 'integration key issuance failed');
  const headers = { authorization: `Bearer ${issued.data.token}`, 'idempotency-key': randomUUID() };
  const created = await request('/integrations/conversations', {
    method: 'POST',
    headers,
    body: { externalId: 'production-smoke-customer', content: 'Production chat test' },
  });
  assert(created.response.status === 201, 'integration conversation creation failed');
  const replay = await request('/integrations/conversations', {
    method: 'POST',
    headers,
    body: { externalId: 'production-smoke-customer', content: 'Production chat test' },
  });
  assert(
    replay.data?.conversation?.id === created.data.conversation.id,
    'integration retry created a duplicate',
  );
  const form = new FormData();
  const content = 'Production attachment staging and scanning smoke';
  form.set('clientMessageId', randomUUID());
  form.set('file', new Blob([content], { type: 'text/plain' }), 'production-smoke.txt');
  const upload = await fetch(
    `${apiUrl}/conversations/${created.data.conversation.id}/attachments`,
    {
      method: 'POST',
      headers: { cookie: registered.cookie },
      body: form,
      signal: AbortSignal.timeout(30000),
    },
  );
  const attachment = await upload.json();
  assert(
    upload.status === 201 && attachment.attachments?.[0]?.downloadUrl,
    'production attachment upload failed',
  );
  const download = await fetch(`${baseUrl}${attachment.attachments[0].downloadUrl}`, {
    headers: { cookie: registered.cookie },
    signal: AbortSignal.timeout(15000),
  });
  assert(
    download.ok && (await download.text()) === content,
    'production attachment download failed',
  );
  const revoked = await request(`/integration-settings/keys/${issued.data.id}/revoke`, {
    method: 'POST',
    cookie: registered.cookie,
  });
  assert(revoked.response.status === 204, 'integration key revocation failed');
  assert(
    (await request('/integrations/conversations', { headers })).response.status === 401,
    'revoked API key still works',
  );

  const forgot = await request('/auth/password/forgot', { method: 'POST', body: { email } });
  assert(forgot.response.status === 202, 'password reset request failed');

  const logout = await request('/auth/logout', { method: 'POST', cookie: registered.cookie });
  assert(logout.response.status === 204, 'logout failed');

  const afterLogout = await request('/auth/me', { cookie: registered.cookie });
  assert(afterLogout.response.status === 401, 'session was not revoked on logout');

  console.log(
    JSON.stringify({
      ok: true,
      ready: true,
      securityHeaders: true,
      metrics: true,
      register: true,
      sessionRevocation: true,
      integrations: true,
      attachments: true,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
