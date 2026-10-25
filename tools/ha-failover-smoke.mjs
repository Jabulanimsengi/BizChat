import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { io } from 'socket.io-client';

// Exercises infra/nginx/api-lb.conf in front of two API nodes, then kills one. Started by
// tools/run-e2e.mjs after the API is built; skipped (successfully) when Docker is unavailable.
const run = promisify(execFile);
const nodePorts = ['4620', '4621'];
const lbPort = '4630';
const lbUrl = `http://127.0.0.1:${lbPort}`;
const apiUrl = `${lbUrl}/api/v1`;
const dashboardOrigin = 'http://localhost:3000';
const container = `bizchat-ha-lb-${process.pid}`;
const runId = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

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
function waitFor(socket, event, predicate = () => true, timeoutMs = 15_000) {
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`${event} timeout`));
    }, timeoutMs);
    const handler = (value) => {
      if (!predicate(value)) return;
      clearTimeout(timeout);
      socket.off(event, handler);
      resolvePromise(value);
    };
    socket.on(event, handler);
  });
}
function emit(socket, event, input) {
  return new Promise((resolvePromise, reject) =>
    socket
      .timeout(10_000)
      .emit(event, input, (error, response) => (error ? reject(error) : resolvePromise(response))),
  );
}
async function waitForReady(url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await fetch(`${url}/api/v1/health/ready`).catch(() => undefined);
    if (ready?.ok) return;
    await sleep(500);
  }
  throw new Error(`${url} did not become ready`);
}

function startNode(port) {
  return spawn('node', ['apps/api/dist/src/main.js'], {
    stdio: 'ignore',
    env: {
      ...process.env,
      API_PORT: port,
      APP_URL: `http://127.0.0.1:${port}`,
      // Requests arrive from the balancer container through Docker's host gateway.
      TRUSTED_PROXIES: '',
    },
  });
}

/** The production configuration, with only the upstream addresses pointed at this machine. */
/**
 * The host's IPv4 address as containers see it. Docker Desktop maps the host gateway to an IPv4 and
 * an unreachable IPv6 address; a name would give nginx phantom peers, as production's
 * `ipv6=off` resolver avoids for the api service.
 */
async function hostGatewayIpv4() {
  const { stdout } = await run('docker', [
    'run',
    '--rm',
    '--add-host=bizchat-host:host-gateway',
    'nginx:1.28-alpine',
    'getent',
    'ahostsv4',
    'bizchat-host',
  ]);
  const address = stdout.split(/\s+/)[0];
  assert(/^\d+\.\d+\.\d+\.\d+$/.test(address ?? ''), `no IPv4 host gateway: ${stdout}`);
  return address;
}

async function balancerConfig() {
  const production = await readFile(resolve('infra/nginx/api-lb.conf'), 'utf8');
  const host = await hostGatewayIpv4();
  const servers = nodePorts
    .map((port) => `  server ${host}:${port} max_fails=2 fail_timeout=10s;`)
    .join('\n');
  const local = production
    .replace(/^resolver .*$/m, '')
    .replace(/^\s*server api:4000 resolve .*$/gm, servers)
    .replace(/^\s*zone .*$/gm, '');
  assert(local.includes(`${host}:4620`), 'could not adapt the balancer config');
  return local;
}

async function main() {
  try {
    await run('docker', ['version', '--format', '{{.Server.Version}}']);
  } catch {
    console.log(JSON.stringify({ ok: true, skipped: 'Docker is not available' }));
    return;
  }
  const nodes = nodePorts.map(startNode);
  const directory = await mkdtemp(join(tmpdir(), 'bizchat-ha-'));
  const sockets = [];
  try {
    await Promise.all(nodePorts.map((port) => waitForReady(`http://127.0.0.1:${port}`)));
    await writeFile(join(directory, 'default.conf'), await balancerConfig());
    await run('docker', [
      'run',
      '-d',
      '--rm',
      '--name',
      container,
      '-p',
      `127.0.0.1:${lbPort}:8080`,
      '-v',
      `${join(directory, 'default.conf')}:/etc/nginx/conf.d/default.conf:ro`,
      'nginx:1.28-alpine',
    ]);
    await waitForReady(lbUrl);
    const metrics = await fetch(`${lbUrl}/api/v1/metrics`);
    assert(metrics.status === 404, 'metrics must not be reachable through the balancer');

    // A consultant and a visitor, both through the balancer.
    const registered = await request('/auth/register', {
      method: 'POST',
      body: {
        businessName: `HA ${runId}`,
        displayName: 'HA Owner',
        email: `ha-${runId}@example.test`,
        password: 'ha-failover-passphrase',
        timezone: 'UTC',
      },
    });
    assert(registered.response.status === 201, 'registration through the balancer failed');
    const cookie = registered.cookie;
    const me = (await request('/auth/me', { cookie })).data;
    const hostname = `ha-${runId}.localhost`;
    const origin = `http://${hostname}:3000`;
    const domain = await request('/domains', {
      method: 'POST',
      cookie,
      body: { domain: hostname },
    });
    await request(`/domains/${domain.data.id}/verify`, { method: 'POST', cookie });

    const agent = io(`${lbUrl}/agent`, {
      extraHeaders: { Origin: dashboardOrigin, Cookie: cookie },
      transports: ['websocket'],
      reconnectionDelay: 200,
      forceNew: true,
    });
    sockets.push(agent);
    await waitFor(agent, 'agent.connected');
    const boot = await request('/widget/bootstrap', {
      method: 'POST',
      origin,
      body: { businessPublicId: me.business.publicId },
    });
    const widget = io(`${lbUrl}/widget`, {
      auth: { token: boot.data.widgetSessionToken },
      extraHeaders: { Origin: origin },
      transports: ['websocket'],
      reconnectionDelay: 200,
      forceNew: true,
    });
    sockets.push(widget);
    await waitFor(widget, 'widget.connected');
    const heartbeat = setInterval(() => widget.emit('widget.heartbeat'), 5_000);

    const started = await emit(widget, 'conversation.start', {
      clientMessageId: randomUUID(),
      content: 'Before the failover',
    });
    assert(started.ok, `conversation start failed: ${JSON.stringify(started.error)}`);
    const conversationId = started.data.conversation.id;

    // Lose one node. Every socket on it drops and reconnects through the balancer to the other.
    nodes[0].kill();
    await sleep(1_000);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const ready = await fetch(`${lbUrl}/api/v1/health/ready`).catch(() => undefined);
      if (ready?.ok) break;
      await sleep(250);
    }
    const after = await Promise.all(
      Array.from({ length: 6 }, () => fetch(`${lbUrl}/api/v1/health/ready`)),
    );
    assert(
      after.every((response) => response.ok),
      `requests failed after losing a node: ${after.map((response) => response.status).join(', ')}`,
    );
    const session = await request('/auth/me', { cookie });
    assert(session.response.ok, 'the signed-in session did not survive the failover');

    if (!widget.connected) await waitFor(widget, 'widget.connected');
    if (!agent.connected) await waitFor(agent, 'agent.connected');
    const resumed = await emit(widget, 'conversation.resume', { conversationId });
    assert(resumed.ok, `resume after failover failed: ${JSON.stringify(resumed.error)}`);
    const delivered = waitFor(
      agent,
      'message.new',
      (message) => message.conversationId === conversationId && message.content === 'After',
    );
    const sent = await emit(widget, 'message.send', {
      conversationId,
      clientMessageId: randomUUID(),
      content: 'After',
    });
    assert(sent.ok, `message after failover failed: ${JSON.stringify(sent.error)}`);
    await delivered;
    clearInterval(heartbeat);

    console.log(
      JSON.stringify({
        ok: true,
        balancer: 'infra/nginx/api-lb.conf on nginx 1.28; metrics not exposed',
        failover: 'one of two nodes killed; HTTP and the session kept working',
        sockets: 'consultant and visitor reconnected; conversation resumed; message delivered',
      }),
    );
  } catch (error) {
    // The balancer's own account of a failure is the most useful evidence.
    const logs = await run('docker', ['logs', '--tail', '400', container]).catch(() => undefined);
    const problems = `${logs?.stdout ?? ''}${logs?.stderr ?? ''}`
      .split('\n')
      .filter((line) => /\[(error|warn)\]/.test(line))
      .slice(-15);
    if (problems.length) console.error(`nginx errors:\n${problems.join('\n')}`);
    throw error;
  } finally {
    for (const socket of sockets) socket.disconnect();
    for (const node of nodes) node.kill();
    await run('docker', ['rm', '-f', container]).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
}

// Exit explicitly: reconnecting sockets and child processes must not keep a failed run alive.
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(), 500).unref());
