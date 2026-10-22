# Hardening

This document describes the production-hardening controls added in Phase 11. See
`docs/production-runbook.md` for operator steps and `docs/api/authentication.md` for the auth surface.

## Account security

- Sessions are random 256-bit tokens; only an HMAC-SHA256 digest is persisted. Cookies are `HttpOnly`,
  `SameSite=Lax`, and `Secure` in production.
- Password reset and email verification use hashed, single-use, expiring tokens scoped by purpose
  (`password-reset:` / `email-verify:` HMAC input) so a token cannot be replayed across flows.
- Forgotten-password requests return `202` regardless of whether the account exists, avoiding
  enumeration. Completing a reset revokes every session for the user.
- The production environment guard refuses to start without `SMTP_HOST`, fail-open throttling, an
  insecure HTTP `APP_URL`/`DASHBOARD_URL`, a missing S3 driver, or disabled malware scanning.

## Email delivery

`MailerService` uses Nodemailer over SMTP (`SMTP_*`). Values interpolated into email bodies are
HTML-escaped. When `SMTP_HOST` is unset in development, messages are written to the structured log
instead of being sent so local flows keep working.

## Rate limiting

The default throttler is Redis-backed and distributed. `THROTTLER_FAIL_MODE` controls behaviour when
Redis is unreachable:

- `closed` (production default, enforced): requests are blocked until Redis recovers.
- `open` (development default): requests pass through, favouring availability.

## Observability

- `JsonLogger` emits one JSON line per Nest log event with `timestamp`, `level`, `context`, and
  payload; `RequestLoggingMiddleware` emits one line per request with `requestId`, method, route,
  status, and duration.
- `GET /api/v1/metrics` exposes Prometheus-format counters and summaries
  (`bizchat_http_requests_total`, `bizchat_http_request_duration_ms_*`) plus uptime and resident
  memory. Scrape it from the private network only.
- Metric labels are bounded: unmatched paths collapse to a constant `unmatched` route, unknown methods
  map to `OTHER`, and each series map is capped with an `overflow` bucket so hostile traffic cannot
  grow memory without limit.

## HTTP security

- The API sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and HSTS in
  production, and disables `x-powered-by`.
- The dashboard sets a Content-Security-Policy alongside the existing headers. Script and style
  sources allow `'unsafe-inline'` because Next.js injects inline bootstrap tags; `connect-src` is
  restricted to the API origin and its WebSocket counterpart.
- A client watcher redirects to `/login` on any `401`. The API session remains the only authority;
  there is no edge middleware because the session cookie is scoped to the API origin and cannot be
  read from the dashboard origin in a split-domain deployment.

## Widget

- The widget uses a `closed` shadow root and rebuilds safely after being disconnected and re-appended.
- Production bundles ship without source maps, and the nginx asset sets `nosniff`, a restrictive
  cache policy, and `Cross-Origin-Resource-Policy: cross-origin`.
- The dashboard embed snippet is generated from `NEXT_PUBLIC_WIDGET_URL` so it can point at a real CDN.

## Testing and CI gates

- Unit and component tests run for the API, shared validation, dashboard, and widget.
- The API enforces a coverage regression floor (`npm run test:cov`).
- A real-stack HTTP integration suite (`npm run test:http`) and the Phase 3-7 and 9 smoke harnesses
  (`npm run e2e`) run in CI against PostgreSQL, Redis, MinIO, and ClamAV.
