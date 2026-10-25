# Production runbook

## Supported deployment shape

The supplied production Compose file is a single-host reference deployment. PostgreSQL, Redis, and
attachments use named volumes; the API, dashboard, and widget bind only to loopback and must sit
behind a TLS-terminating reverse proxy or managed load balancer.

For more than one API replica, replace the attachment filesystem implementation with shared
S3-compatible object storage before scaling. Do not mount the same ordinary filesystem directory
read-write on multiple hosts.

`docker-compose.ha.yml` layers several API replicas and an nginx load balancer onto the production
file (`docker compose -f docker-compose.production.yml -f docker-compose.ha.yml up -d --wait`). It
does not replicate PostgreSQL, Redis, or object storage; see
`docs/architecture/high-availability.md` for what each needs and how failures behave.

## Required configuration

- Generate independent `SESSION_SECRET` and `WIDGET_TOKEN_SECRET` values with at least 32 random
  bytes, for example `openssl rand -base64 48` twice. Store them in a secret manager.
- Use HTTPS URLs for `APP_URL`, `DASHBOARD_URL`, and `NEXT_PUBLIC_API_URL`.
- Set `NEXT_PUBLIC_WIDGET_URL` to the public CDN URL of the built `widget.js`.
- Configure outbound email through `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
  `SMTP_PASSWORD`, and `SMTP_FROM`. It is required in production for password reset and email
  verification. `PASSWORD_RESET_TTL_MINUTES` and `EMAIL_VERIFICATION_TTL_HOURS` tune link lifetimes.
- Keep `THROTTLER_FAIL_MODE=closed` so rate limiting rejects traffic while Redis is unavailable.
- Leave `S3_ALLOW_INSECURE=false` for managed HTTPS object storage. Set it to `true` only when the
  endpoint is a trusted private/internal service reached over plaintext HTTP, as the bundled MinIO
  service is. The reference Compose file defaults it to `true` for that reason.
- Set `TRUSTED_PROXIES` to the exact IP addresses or CIDR ranges of the reverse proxy. Leave it empty
  when the API is directly exposed, and never trust all proxies.
- Restrict PostgreSQL and Redis to the private service network and use unique strong passwords.
- Terminate TLS at the edge and route the dashboard, API/WebSocket endpoint, and widget asset to
  their respective loopback ports.

## Release

1. Build immutable images and run `npm ci && npm run check` in CI.
2. Back up PostgreSQL and the attachment volume and verify both artifacts can be read.
3. Run `npm run db:migrate:deploy` once from the release image.
4. Start the API and wait for `/api/v1/health/ready` to succeed before routing traffic.
5. Start the dashboard and widget, then run login, widget bootstrap, message, reconnect, and
   attachment smoke tests through the public TLS endpoint.

The Compose reference implements steps 3 and 4 with a one-shot `migrate` service and health-based
dependencies. For the bundled reference topology, `docker compose -f docker-compose.production.yml up
-d --wait` followed by `npm run smoke:production` verifies readiness, security headers, the metrics
endpoint, registration, and session revocation against the running containers. Container images are
Linux/amd64 (or arm64) and require the platform-specific Prisma engine and Vite/Rollup binaries; keep
the lockfile and `binaryTargets` in sync when dependencies change.

## Backup and restore

- Take encrypted PostgreSQL backups on a schedule appropriate to the recovery-point objective.
- Snapshot or copy the attachment volume at the same logical release boundary as the database.
- Regularly restore both into an isolated environment and run the smoke suite; an untested backup is
  not considered recoverable.
- Redis contains ephemeral coordination state and is rebuilt from PostgreSQL, but persistence is
  enabled to reduce disruption.

## Rollback

Deploy the previous immutable API, dashboard, and widget images. Database migrations must remain
backward-compatible for at least one application release. If a migration is destructive, provide
and rehearse a specific restore plan before approval; never use `prisma migrate dev` in production.

## Monitoring

The API emits one JSON log line per request (including `requestId`, method, route, status, and
duration) and one JSON line per application log event, so log shippers can index structured fields.
Scrape `GET /api/v1/metrics` for Prometheus-format `bizchat_http_requests_total`,
`bizchat_http_request_duration_ms_*`, uptime, and memory series.

Alert on readiness failures, elevated HTTP 5xx/429 rates, WebSocket disconnects, routing recovery
failures, outbound email failures, PostgreSQL/Redis capacity, disk usage for attachments, and
backup/restore failures. Keep request IDs in centralized logs and avoid logging session, widget, or
SMTP credentials.
