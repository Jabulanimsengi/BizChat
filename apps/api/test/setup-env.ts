// Provides safe defaults for the HTTP integration suite so it can boot the real
// Nest application against the docker-compose.test.yml stack.
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://bizchat:bizchat@127.0.0.1:55440/bizchat?schema=public';
process.env.REDIS_URL ??= 'redis://127.0.0.1:56380';
process.env.SESSION_SECRET ??= 'x'.repeat(32);
process.env.WIDGET_TOKEN_SECRET ??= 'y'.repeat(32);
process.env.APP_URL ??= 'http://127.0.0.1:4400';
process.env.DASHBOARD_URL ??= 'http://127.0.0.1:3000';
process.env.ATTACHMENT_STORAGE_PATH ??= 'var/attachments';
process.env.SOCKET_REDIS_ADAPTER_ENABLED ??= 'false';
