import { spawn } from 'node:child_process';
import { mkdir, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import Redis from 'ioredis';

const apiPort = process.env.API_PORT ?? '4400';
const secondaryPort = process.env.SMOKE_API_B_PORT ?? '4401';
const apiUrl = `http://127.0.0.1:${apiPort}`;
const secondaryUrl = `http://127.0.0.1:${secondaryPort}`;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const environment = {
  NODE_ENV: 'development',
  DATABASE_URL:
    process.env.DATABASE_URL ??
    'postgresql://bizchat:bizchat@127.0.0.1:55440/bizchat?schema=public',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:56380',
  SESSION_SECRET: 'session-secret-for-e2e-32-characters-long',
  WIDGET_TOKEN_SECRET: 'widget-secret-for-e2e-32-characters-long',
  APP_URL: apiUrl,
  DASHBOARD_URL: 'http://localhost:3000',
  ALLOWED_DEV_ORIGINS: 'http://localhost:3000',
  API_PORT: apiPort,
  SOCKET_REDIS_ADAPTER_ENABLED: 'true',
  ATTACHMENT_STORAGE_PATH: 'apps/api/var/staging',
  ATTACHMENT_STORAGE_DRIVER: 's3',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:59000',
  S3_REGION: process.env.S3_REGION ?? 'us-east-1',
  S3_BUCKET: process.env.S3_BUCKET ?? 'bizchat-attachments',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'bizchat',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'bizchat-secret',
  S3_FORCE_PATH_STYLE: 'true',
  S3_SERVER_SIDE_ENCRYPTION: 'false',
  S3_PREFIX: process.env.S3_PREFIX ?? 'attachments',
  ATTACHMENT_SCANNER: 'clamav',
  CLAMAV_HOST: process.env.CLAMAV_HOST ?? '127.0.0.1',
  CLAMAV_PORT: process.env.CLAMAV_PORT ?? '53310',
  // The Phase 3-9 harnesses exercise direct assignment; the offer harness switches its own tenant.
  NEW_TENANT_ASSIGNMENT_MODE: 'AUTO',
  // The plans harness signs in as this platform administrator.
  PLATFORM_ADMIN_EMAILS: 'platform-admin-e2e@example.test',
  ...process.env,
};

// Single-node harnesses, executed in order against the primary API node.
const singleNodePhases = [
  'phase3-smoke.mjs',
  'phase4-smoke.mjs',
  'phase5-smoke.mjs',
  'phase6-smoke.mjs',
  'phase9-smoke.mjs',
  'phaseB2-smoke.mjs',
  'phaseB3-smoke.mjs',
  'phaseB4-smoke.mjs',
  'phaseB5-smoke.mjs',
  'phaseC-sdk-smoke.mjs',
  'phaseD-plans-smoke.mjs',
];

const redis = new Redis(environment.REDIS_URL);

// The suites register accounts back to back; each phase gets a clean rate-limit window so the
// production 5/min registration throttle does not turn sequential runs into spurious 429s.
async function clearThrottleCounters() {
  const keys = await redis.keys('bizchat:throttle:*');
  if (keys.length > 0) await redis.del(...keys);
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: environment,
      shell: process.platform === 'win32',
      ...options,
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${code}`)),
    );
  });
}

async function waitForHealth(baseUrl, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/v1/health/ready`);
      if (response.ok) return;
    } catch {
      // retry until the deadline
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }
  throw new Error(`API at ${baseUrl} did not become healthy in time`);
}

async function startApi(port, logName) {
  const logPath = resolve(`apps/api/var/${logName}`);
  await mkdir(dirname(logPath), { recursive: true });
  const logHandle = await open(logPath, 'w');
  const api = spawn('node', ['apps/api/dist/src/main.js'], {
    stdio: ['ignore', logHandle.fd, logHandle.fd],
    env: { ...environment, API_PORT: port, APP_URL: `http://127.0.0.1:${port}` },
    detached: false,
  });
  api.on('close', () => void logHandle.close());
  return api;
}

async function main() {
  await run(npm, ['run', 'db:generate']);
  await run(npm, ['run', 'build', '-w', '@bizchat/api']);
  // The SDK harness drives the API through the built client.
  await run(npm, ['run', 'build', '-w', '@bizchat/sdk']);
  await run(npm, ['run', 'db:migrate:deploy']);

  const primary = await startApi(apiPort, 'e2e-api.log');
  const secondary = await startApi(secondaryPort, 'e2e-api-b.log');

  try {
    await waitForHealth(apiUrl);
    await waitForHealth(secondaryUrl);

    for (const phase of singleNodePhases) {
      await clearThrottleCounters();
      console.log(`Running ${phase}…`);
      await run('node', [`tools/${phase}`], {
        env: { ...environment, SMOKE_API_URL: apiUrl },
      });
    }

    await clearThrottleCounters();
    console.log('Running phase7-smoke.mjs (two nodes)…');
    await run('node', ['tools/phase7-smoke.mjs'], {
      env: { ...environment, SMOKE_API_A: apiUrl, SMOKE_API_B: secondaryUrl },
    });

    console.log('End-to-end smoke suite passed');
  } finally {
    primary.kill();
    secondary.kill();
    await redis.quit();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
