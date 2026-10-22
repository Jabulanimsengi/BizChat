# Implementation status

Last updated: 2026-08-15

## Current phase

Phase 11 - Hardening is complete. Phase 10 - Analytics remains the next feature work.

## Completed

### Phase 1 - Foundation

- Strict TypeScript monorepo, PostgreSQL/Redis infrastructure, authentication, tenant context, RBAC, audit records, health checks, and dashboard shell.

### Phase 2 - Widget foundation

- Domain verification, persistent anonymous visitor identity, origin-bound widget sessions, authenticated widget sockets, and an isolated Shadow DOM widget.

### Phase 3 - Conversations

- Durable conversations, participants, ordered/idempotent messages, history pagination, receipts, lifecycle transitions, visitor chat UI, and dashboard conversation API.

### Phase 4 - Consultants

- Durable `AgentProfile` per business membership with status, routing preference, and bounded maximum concurrent chats.
- Redis-backed agent and visitor connection leases with TTL expiry; durable online state is deliberately not stored in PostgreSQL.
- Manual `ONLINE`, `BUSY`, `AWAY`, and `DO_NOT_DISTURB` states, computed `OFFLINE`, and workload-derived busy display.
- Reusable session authentication for protected HTTP and the origin-checked `/agent` Socket.IO namespace.
- Agent heartbeat, presence changes, authorized conversation subscription/catch-up, messages, delivery/read receipts, and typing events.
- Ephemeral visitor/agent typing keys with automatic Redis expiry and client-side expiry safeguards.
- Live business availability in the visitor widget, plus consultant typing, unread badge, connection heartbeat, and read/delivery updates.
- Professional three-column consultant inbox with live conversation/message events, durable unread counts, previews, customer presence, typing, context, and workload.
- Multiple open chat tabs with isolated drafts and scroll positions; switching threads does not unsubscribe other chats.
- Consultant profile/settings page for durable capacity and routing preferences.
- Phase 4 Prisma migration, Redis presence/typing tests, and repeatable real-stack Phase 4 smoke harness.

### Phase 5 - Routing

- Durable tenant-scoped departments with public widget identifiers, default department provisioning, active/disabled state, and many-to-many consultant membership.
- Dashboard department management, live active/queued counts, self-service consultant membership, and widget routing settings.
- Optional visitor department selection using public IDs only; the selected department is validated and persisted on the conversation.
- Dedicated `ConversationRoutingService`; routing logic is not embedded in WebSocket handlers.
- Online-only eligibility with disabled, away, do-not-disturb, routing-disabled, inactive membership/user, department mismatch, and at-capacity exclusion.
- Centralized capacity policy: `ASSIGNED`, `ACTIVE`, `WAITING_FOR_CUSTOMER`, and `WAITING_FOR_AGENT` consume capacity.
- Configurable previous-consultant preference, followed by least-active-chat selection and oldest-last-assignment fairness.
- Atomic PostgreSQL assignment using a transaction-scoped capacity lock plus a conditional `assignedAgentMembershipId IS NULL` claim whose affected row count must equal one.
- Append-only `ConversationAssignment` history; current conversation assignment and fairness timestamp update in the same transaction.
- Durable priority-aware queue metadata in PostgreSQL, exact queue position, oldest-first ordering within priority, and automatic queue draining on capacity release or renewed online presence.
- Realtime assigned/queued events to both consultant dashboard and visitor widget, including queue position and department context.
- Repeatable real-stack Phase 5 smoke harness covering concurrent assignment, capacity queueing, capacity release, department eligibility, and durable assignment history.

### Phase 6 - Conversation operations

- Atomic agent-to-agent and agent-to-department transfers that preserve the conversation, messages, tags, participants, and append-only assignment history without creating duplicate conversations.
- Transfer concurrency control using transaction-scoped advisory locks and expected-current-assignee checks; stale or racing transfer requests return a conflict.
- Durable transfer, queue, assignment, acceptance, resolution, reopen, tag, and internal-note timeline events with persisted actor and metadata context.
- Realtime operation events for the business inbox and visitor widget, including receiver notification and immediate removal of a departing consultant's room access.
- Server-authorized internal notes stored as distinct message records, rendered separately in the dashboard, excluded from visitor history and realtime delivery, and excluded from first-response metrics.
- Tenant-scoped tags with dashboard management and conversation assignment controls.
- Tenant-scoped canned responses with optional department scope, title, content, shortcut, bounded search, dashboard management, and composer insertion.
- Explicit resolve operations that persist actor/time, release active assignment capacity, emit system history, and drain the queue.
- Configurable reopen window with same-conversation reopen and rerouting inside the window; expired visitor follow-ups start a new conversation.
- Dashboard operations for transfers, resolve/reopen, internal notes, tags, canned replies, and visually distinct system/internal timeline entries.
- Repeatable real-stack Phase 6 smoke harness covering note privacy, transfers, department queueing and drain, resolve/reopen, tags, canned responses, persisted timeline events, access removal, and a concurrent-transfer race.

### Phase 7 - Reliability

- Socket.IO Redis adapter with reconnecting publisher/subscriber clients for cross-instance room broadcasts, assignment notifications, messages, receipts, typing, presence, operations, and recovery events.
- PostgreSQL-backed disconnect grace state with tenant-configurable duration, customer/consultant recovery events, and assignment restoration when the consultant reconnects before expiry.
- Atomic grace-expiry reassignment using an advisory lock, append-only `REASSIGNMENT` assignment history, participant access release, durable `REASSIGNED` timeline event, customer-safe system message, and same-conversation rerouting.
- Durable exponential retry metadata for transient reassignment failures and an overlap-safe periodic recovery sweep.
- Startup/runtime reconstruction of missing queue entries from authoritative `QUEUED` conversation rows and retry of unassigned `NEW`/`QUEUED` conversations.
- Agent reconnect restores all assigned rooms; the dashboard resubscribes every open tab from its last committed sequence and refreshes read receipts.
- Widget reconnect drains all missed-message pages from its last committed sequence, refreshes receipts, distinguishes connecting/reconnecting/error states, and refreshes expired secure widget sessions.
- Retry-safe visitor and consultant send UX that reuses the original `clientMessageId`; acknowledgement loss cannot create a duplicate durable message.
- Grace-period and recovery status shown explicitly in both visitor and consultant interfaces, plus dashboard configuration for the disconnect grace duration.
- Documented Redis key patterns and PostgreSQL-authoritative recovery procedure.
- Repeatable two-node real-stack Phase 7 smoke harness covering cross-instance fan-out, missed-message catch-up, grace restoration, timed reassignment, idempotent retry, Redis presence reconstruction, and queue reconstruction.

### Phase 8 - Administration

- Complete business profile administration for name, IANA timezone, and locale, with timezone validation and audit records.
- Full widget administration for display identity, brand color, launcher position, enablement, department selection, previous-consultant preference, reopen and disconnect windows, plus online, queue, offline, and resolved messages.
- Seven-day tenant operating schedules with closed days and overnight windows, evaluated in the business timezone; an unconfigured tenant remains open for backward compatibility.
- Business availability now requires both an eligible online consultant and an open operating window, while the existing durable offline-message flow remains available.
- Tenant user administration for secure account creation, roles, access status, routing capacity, routing enablement, and department membership.
- Immediate session revocation when a membership is disabled, self-disable prevention, owner-only owner management, and a last-active-owner invariant.
- Expanded department administration with default and active/disabled controls, consultant assignments, and audit events.
- Searchable, cursor-paginated, tenant-scoped audit history with actor, target, request, IP, metadata, and timestamp context.
- Dedicated administration dashboard pages for settings, users, and audit logs; administrative navigation is hidden from non-admin roles.
- Production API start path and dashboard CORS `PUT` support corrected during live verification.

### Phase 9 - Attachments

- Validated upload pipeline with magic-byte detection, size limits, SHA-256 hashing, and path-traversal protection.
- Pluggable storage with a `filesystem` development driver and a mandatory S3-compatible driver in production.
- Mandatory ClamAV malware scanning in production with configurable host, port, and timeout; rejected uploads are audited.
- Tenant-scoped upload/download authorization for both consultants and origin-bound widget sessions.
- Stale staged-attachment maintenance sweep.
- Attachment E2E smoke harness and a backup/restore drill wired into CI.

### Phase 11 - Hardening

- Password reset: hashed single-use tokens, enumeration-safe `POST /auth/password/forgot`, token-consuming
  `POST /auth/password/reset`, and full session revocation on completion.
- Email verification: delivery on registration, `POST /auth/email/verify`, session-authenticated
  `POST /auth/email/resend`, and an unverified-email banner in the dashboard.
- Outbound email through Nodemailer over SMTP (`SMTP_*`), with a console transport for local development;
  SMTP is required by the production environment guard. Links are HTML-escaped.
- Fail-closed rate limiting: the Redis throttler blocks requests when Redis is unavailable in production
  (`THROTTLER_FAIL_MODE`, default `closed` in production, `open` elsewhere).
- Structured JSON logging with request IDs plus a Prometheus-format `GET /api/v1/metrics` endpoint that
  reports request counters, duration summaries, uptime, and resident memory.
- API security headers (`nosniff`, frame deny, referrer policy, HSTS in production) and `x-powered-by` disabled.
- Dashboard Content-Security-Policy, error/loading/not-found boundaries, favicon, and per-request API
  timeout handling with a global 401 session watcher.
- Mobile dashboard navigation drawer (sidebar was desktop-only) with an accessible sign-out; removed the
  dead Analytics navigation link and refreshed stale placeholder copy.
- Widget hardening: `closed` shadow root, safe re-mount after disconnect, production source maps disabled,
  and public embed URL sourced from `NEXT_PUBLIC_WIDGET_URL`.
- New automated tests: API password-reset/email-verification and mailer unit tests, web (Vitest + Testing
  Library) and widget tests, and a real-stack HTTP integration suite (`npm run test:http`).
- Coverage regression gate for the API and all real-stack smoke harnesses (Phases 3-7 and 9) wired into CI.

### Phase 12 - Deployment hardening

- Production container images now build reproducibly on Linux: the lockfile records the Linux
  `@rollup/rollup-linux-x64-gnu` binary needed by Vite, and Prisma targets `debian-openssl-3.0.x`.
- The API image creates `/data/staging` owned by the non-root `node` user so a fresh named staging
  volume starts without an `EACCES` failure.
- The environment guard accepts a plaintext internal S3 endpoint only when `S3_ALLOW_INSECURE=true`,
  which the bundled MinIO reference deployment sets; managed HTTPS endpoints stay strict.
- Metrics are bounded: unmatched routes collapse to a constant `unmatched` label, unknown methods map
  to `OTHER`, and the series maps cap at a fixed size with an `overflow` bucket.
- Removed the dashboard edge middleware: the session cookie is scoped to the API origin, so a
  split-domain deployment could not read it. The API remains authoritative and a client watcher
  handles `401` redirects.
- Assignment system events are excluded from the inbox message preview so the list shows the last real
  customer or consultant message.
- Added `tools/production-smoke.mjs` and a CI job that validates the production Compose file, boots the
  images, and exercises readiness, security headers, metrics, registration, session, and logout
  revocation against the running stack.
- Reset Redis rate-limit windows between smoke phases so the production registration throttle does not
  turn sequential runs into spurious `429`s.

## Verification

- Type checking passes across all five workspaces; lint passes for the API, dashboard, and widget.
- Automated tests pass: 94 API unit tests, 14 shared validation tests, 10 dashboard tests, and 3 widget
  tests, plus a real-stack HTTP integration suite (`npm run test:http`) covering registration, session
  issuance/revocation, health readiness, and unauthenticated access rejection.
- Production builds pass for shared packages, API, dashboard, and widget.
- Widget production bundle is 67.87 kB raw / 21.20 kB gzip with no source map emitted.
- npm reports zero known production vulnerabilities.
- All eleven Prisma migrations are applied.
- API unit coverage stays above the enforced regression floor (20% statements; measured ~22%).
- Phase 11 verification: password reset issues a hashed single-use token and revokes sessions, email
  verification flips `emailVerifiedAt`, forgotten-password requests do not reveal account existence,
  production environment validation refuses missing SMTP and fail-open throttling, and the metrics
  endpoint renders Prometheus text.
- Phase 12 verification: the production Compose configuration validates; the API, dashboard, and widget
  images build under Linux; the full production stack reaches a healthy state; `/data/staging` and its
  `.tmp` directory are owned by the non-root `node` user; and `node tools/production-smoke.mjs` passes
  readiness, security headers, metrics, registration, and session revocation against the running stack.
  A single `npm run e2e` run passes Phases 3, 4, 5, 6, 9, and the two-node Phase 7.
- Live Phase 4 verification passed: profile provisioning/update, online availability, live inbox events,
  two-way typing, Redis TTL expiry, unread `1 -> 0`, agent reply, receipts, manual presence,
  disconnect/offline propagation, and authenticated reconnect catch-up.
- Live Phase 5 verification passed: default/custom departments, capacity `1`, exactly one assignment
  during concurrent routing, durable queue state, automatic `QUEUED -> ASSIGNED` on capacity release,
  department-based exclusion and re-eligibility, and append-only assignment history.
- Live Phase 6 verification passed: private internal notes, agent transfer and access removal,
  department transfer with `QUEUED -> ASSIGNED` drain, `RESOLVED -> ASSIGNED` reopen on the same
  conversation, tags, canned-response search, 11 durable timeline events, five append-only assignment
  records, and exactly one winner in a concurrent-transfer race.
- Live Phase 7 verification passed across two API nodes: Redis-adapter assignment/message fan-out,
  two missed messages recovered by sequence, assignment restoration inside grace, durable timed
  reassignment after grace, one row from two identical retry commands, agent presence rebuilt after
  tenant-scoped Redis key loss, missing queue state reconstructed from PostgreSQL, and the original
  conversation preserved throughout.
- Live Phase 8 verification passed: business/timezone/locale update, seven persisted operating days,
  widget lifecycle messages, consultant creation and department assignment, routing capacity update,
  filtered audit retrieval, `409` last-owner protection, and `404` cross-tenant mutation protection.

## Not started

- Phase 10: analytics (reporting over conversations, consultants, and response times).

## Known limitations

- Customer enrichment (linking visitors to known customers) is later-phase work.
- Background-job queues and a scheduled analytics pipeline remain later-phase work.
- External DNS verification depends on public TXT propagation.
- `widget.js` must be published to a CDN and its public URL set as `NEXT_PUBLIC_WIDGET_URL`; the
  dashboard embed snippet uses that value.
- The dashboard Content-Security-Policy allows `'unsafe-inline'` for scripts and styles because Next.js
  injects inline bootstrap tags. A nonce-based policy is a future hardening step.
- Rate limiting fails closed in production, so a Redis outage returns `429` until Redis recovers.

## Integration API implementation — 2026-09-14

The follow-up implementation adds scoped tenant API keys, rotation/revocation, quotas, a versioned
conversation/message API, transactional idempotency, signed customer identity proofs, and a durable
webhook outbox with retries/replay. Dashboard → Integrations manages keys and endpoints; the widget
exposes open/close/identify/logout and readiness/error/unread events. API messages have an explicit
INTEGRATION sender and do not count as human first responses. Private notes are excluded from
integration history and webhook events. See `docs/api/integrations.md` for the supported contract and
limits.

Production CI now boots the images and exercises API keys, idempotent creation, scanned attachment
upload/download, and session revocation. HTTP integration tests reuse the application's real
middleware setup. Fresh-volume production API startup and this expanded smoke test were verified
locally using an isolated test database. The additive integration migration was applied successfully
to that database; operational databases have not been migrated by this implementation task.

Verification for the integration release: `npm run check` passed, including formatting, lint,
workspace type checking, all 150 unit tests, and production builds. The API coverage gate passed
(23.87% statements, 26.12% branches; 121 API unit tests). All 16 real-stack HTTP tests passed.
The complete end-to-end suite passed on isolated dependencies, including two-node reconnect,
reassignment, presence reconstruction, retry deduplication, routing, transfers, and attachments.
Production Compose validation, the API Docker image build, and the expanded fresh-volume
production-mode smoke test passed. An initial reconnect run shared its database with a smoke
instance using a different Redis database; the isolated rerun passed after removing that interference.
Public TLS/browser compatibility, real SMTP delivery, load targets, and backup/restore deployment
sign-off remain operator checks and are not claimed by these local results.

## Phase A - Routing stabilisation — 2026-10-22

- Queue drains read entries ordered by priority, then wait time, so the oldest urgent customers are
  never skipped once more than 200 are queued.
- Steady consultant heartbeats no longer drain the queue. Drains are triggered by events and
  coalesced per tenant across API instances with a Redis lock; a drain stops trying a department once
  no consultant in it is eligible and republishes queue positions only where they moved.
- The reliability sweep runs on one API instance holding a Redis lease. It repairs only inconsistent
  queue entries, retries unrouted conversations oldest first, and drains tenant backlogs
  longest-waiting tenant first. With Redis unavailable no instance sweeps.
- Queued web conversations whose visitor left for `QUEUE_ABANDON_AFTER_SECONDS` (default 120) are
  closed with a `VISITOR_LEFT_QUEUE` reason, removed from the queue, and reported to the inbox and
  widget as `ABANDONED`.

Verification: format, lint, and type checks pass in every workspace; 136 API unit tests (coverage
gate passed, 29.53% statements), 10 dashboard, 5 widget, and 14 validation tests pass. Against the
Docker test stack, all 16 HTTP integration tests and the end-to-end suite (Phases 3-7 and 9,
including the two-node Phase 7) pass. Load targets and production deployment were not exercised.
