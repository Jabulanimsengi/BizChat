# Implementation status

Last updated: 2026-08-15

## Current phase

Phase 11 - Hardening is complete. Phase 10 - Analytics is implemented (see below).

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

## Phase B1 - Skills and routing settings — 2026-10-24

- Tenant skill catalogue (`skills`) and consultant proficiency 1-5 (`agent_skills`, enforced by a
  database check), managed on **Dashboard → Routing** and **Dashboard → Users**, with audit records.
- Per-tenant `routing_settings` with `routingStrategy`: `LEAST_BUSY` (default; load, then
  proficiency) or `BEST_SKILL` (proficiency, then load). The previous consultant stays first.
- Conversations can carry `requiredSkillId` and `requiredSkillMinProficiency`. Routing then offers
  them only to consultants with that skill at that level, re-checked inside the claim transaction. A
  requirement on a disabled skill is ignored. Topics (B3) will set these fields; until then routing
  outcomes are unchanged.
- Queue drains track exhaustion by eligibility scope (department, skill, minimum proficiency), so a
  skill shortage no longer blocks looser requirements in the same pass.
- Migration `20261024090000_phase_b1_skills` is additive and also adds the `conversations
(status, createdAt)` index for the sweep scans Phase A introduced.

Verification: format, lint, and type checks pass in every workspace; 150 API unit tests (coverage
gate passed, 31.76% statements), 10 dashboard, 5 widget, and 17 validation tests pass. Against the
Docker test stack, all 13 migrations apply to an empty database, all 19 HTTP integration tests pass
(including the new tenant-isolation tests for skills and routing settings), and the end-to-end suite
(Phases 3-7 and 9, including two nodes) passes. The dashboard pages were type-checked but not
exercised in a browser.

## Phase B2 - Chat offers — 2026-10-24

- New conversation status `OFFERED`: in `OFFER` mode, routing reserves one consultant's capacity and
  offers the chat for `offerTimeoutSeconds` (default 30) instead of assigning it. Offers are durable
  `conversation_offers` rows with outcome `ACCEPTED`, `DECLINED`, `EXPIRED`, or `CANCELLED`.
- Accept, decline, expiry, consultant disconnect, and visitor abandonment are each a conditional
  update on the conversation's current offer, so concurrent actors produce one winner. A declined,
  expired, or cancelled offer returns the chat to the queue (keeping its original wait time) and
  offers it to the next eligible consultant; the consultant who passed is skipped for
  `exclusionSeconds` (default 300).
- Expiry runs on a timer in the offering API instance, with the single-instance reliability sweep as
  the backstop. After `missedOffersBeforeAway` (default 2) consecutive expiries an online consultant
  is set away and notified; accepting an offer resets the count.
- Consultants can preview an offered chat but cannot reply (`OFFER_NOT_ACCEPTED`); transfers wait
  until the offer resolves (`CONVERSATION_OFFER_PENDING`). Disconnecting cancels pending offers at
  once; accepted chats keep the existing grace period.
- Newly registered businesses default to `OFFER` (`NEW_TENANT_ASSIGNMENT_MODE`); existing businesses
  stay on direct assignment until they opt in on **Dashboard → Routing**. The inbox shows offer cards
  with a countdown and Accept/Decline; the widget shows "Connecting you with a consultant".
- Migrations `20261024100000_phase_b2_offer_enums` (enum values alone, as PostgreSQL requires) and
  `20261024100100_phase_b2_offers` (tables, columns, range checks) are additive.

Verification: format, lint, and type checks pass in every workspace; 165 API unit tests (coverage
gate passed, 34.23% statements), 10 dashboard, 5 widget, and 19 validation tests pass. Against the
Docker test stack, all 15 migrations apply to an empty database and all 20 HTTP integration tests
pass. The end-to-end suite passes, including the new `phaseB2-smoke.mjs`: decline then re-offer and
accept, two dashboard tabs racing to accept with exactly one winner, two expiries setting a
consultant away with both chats requeued and an expired offer rejected, the queue draining to a
consultant who returns, and a disconnect cancelling and re-offering a pending offer. The dashboard
offer card and settings were type-checked but not exercised in a browser.

## Phase B3 - Topics and intent routing — 2026-10-24

- Tenant topics (**Dashboard → Routing**) with a department, optional required skill and minimum
  level, priority, weighted keywords and phrases, negative keywords, example messages, quick-reply
  visibility, ordering, and one default topic per tenant. Every edit bumps a catalogue version, so
  each API instance recompiles its cached classifier on next use.
- A deterministic keyword classifier normalises the first message, stems words, tolerates one typo
  in longer words, matches phrases only when their words are adjacent, and scores examples as a
  weaker signal. Confidence `s1 / (s1 + s2 + 1)` decides: route (default ≥ 0.6), route and let the
  visitor change the topic (≥ 0.35), or ask. Thresholds and the 60-second prompt timeout are tenant
  settings. **Test a message** previews a decision without creating anything.
- The widget shows topic buttons before the first message. When asked, routing waits
  (`AWAITING_TOPIC`) until the visitor chooses or the prompt expires, then the default topic applies.
  A visitor can change the topic until a consultant is offered or assigned the chat.
- The integration API accepts `topicPublicId` or classifies the subject and message, falling back to
  the default topic when uncertain. Every decision is stored in `conversation_classifications`.
- Fixed while building B3: the widget sent the hidden department picker's first option with every
  new chat, and a chat that started as `OFFERED` briefly told the visitor it was assigned.
- Migrations `20261024110000_phase_b3_topic_enums` and `20261024110100_phase_b3_topics` are
  additive. Tenants without topics route exactly as before.

Verification: format, lint, and type checks pass in every workspace; 196 API unit tests (coverage
gate passed, 37.54% statements), 11 dashboard, 5 widget, and 23 validation tests pass. Against the
Docker test stack, all 17 migrations apply to an empty database and all 23 HTTP integration tests
pass, including topic management, one default per tenant, cross-tenant isolation, the preview, and
integration API classification. The end-to-end suite passes, including the new `phaseB3-smoke.mjs`:
a confident match routed to its department with the topic locked once assigned, an unclear message
held until the visitor chose a topic, a quick-reply topic applied without classification, and an
unanswered prompt falling back to the default topic. The first HTTP run failed one assertion that
still expected the pre-B3 settings object; it passed after the expectation was updated. The widget
prompts and dashboard topic editor were type-checked but not exercised in a browser.

## Phase B4 - Pre-chat forms — 2026-10-25

- Tenant forms (**Dashboard → Routing → Pre-chat forms**) with up to 10 fields: text, email, phone,
  choice, and reference numbers checked against a business-defined format (`#` digit, `A` letter,
  `*` either) by a linear character check, never a regular expression. Optional consent statement.
  Changing fields or consent bumps the form version; stored answers record the version shown.
- Timing per tenant: after the topic is known (each topic may name its form, otherwise the default
  form) or before the first message (default form, sent with that message). Routing, queue drains,
  and the sweep skip a conversation while it waits for a form.
- Identity proofs accept optional `name` and `email` claims that pre-fill matching fields; when the
  claims answer every required field and no consent is needed, the form is stored without asking.
- Answers appear in the consultant's side panel and on offer cards, through
  `GET /conversations/:id/intake`, and through the integration API only for keys with the new
  `intake:read` scope. The integration API accepts and validates answers when creating a conversation.
- Invalid answers return `INTAKE_INVALID` with per-field errors, which the widget shows next to each
  field. Migration `20261025090000_phase_b4_intake_forms` is additive.

Verification: format, lint, and type checks pass in every workspace; 183 API unit tests (coverage
gate passed), 13 dashboard, 5 widget, and 29 validation tests pass. Against the Docker test stack,
all 18 migrations apply to an empty database and all 28 HTTP integration tests pass, including form
management and versioning, tenant isolation, integration answers and the `intake:read` scope,
identity claims, and the consultant answers endpoint. The end-to-end suite passes, including the new
`phaseB4-smoke.mjs` (form after a confident topic with per-field errors, form after a topic choice,
and the before-chat mode). The first run failed one HTTP assertion and the B3 harness because both
still expected pre-B4 response shapes; both were updated and the re-run passed. The widget form and
dashboard form editor were type-checked but not exercised in a browser.

## Phase B5 - Overflow, maximum wait, follow-ups, and business hours — 2026-10-25

- Topics take up to five overflow steps (after N seconds: add departments, drop the skill
  requirement, or allow any online consultant; steps add up). The reliability sweep moves a waiting
  chat to the level its wait has reached, records `OVERFLOWED`, starts a new routing cycle (earlier
  declines no longer exclude a consultant), and drains the tenant.
- Topics take an optional maximum wait. Widget visitors are then offered a follow-up once; they can
  leave a name, email or phone, and a note. The chat stays queued, is flagged in the inbox with the
  contact details, and is no longer closed when the visitor leaves.
- Outside business hours nobody is offered or assigned a chat, an unclear first message is not
  questioned, and the widget offers a follow-up whenever the team shows offline. Tenants without
  saved hours are always open, so existing tenants are unchanged.
- Fixed a starvation bug: a chat that stayed queued only because of its own exclusions used to mark
  its whole department exhausted for the drain pass, holding back newer chats in that department.
- Migrations `20261025100000_phase_b5_event_types` and `20261025100100_phase_b5_overflow` are
  additive, with database checks on step count, maximum wait, and overflow level.

Verification: format, lint, and type checks pass in every workspace; 223 API unit tests, 16
dashboard, 6 widget, and 31 validation tests pass. Against the Docker test stack, all 20 migrations
apply to an empty database and all 30 HTTP integration tests pass, including overflow settings,
tenant checks on overflow departments, and the sweep advancing a queued chat on schedule. The
end-to-end suite passes, including the new `phaseB5-smoke.mjs` (overflow after 10 s then assigned;
wait options after 30 s with a validated, single follow-up; closed hours then opening) and the
two-node `phase7`. The first runs failed for harness reasons, not product ones: the harness asserted
the state before asynchronous routing finished, and assumed a new department starts empty (its
creator is added). Windows had also reserved ports 4331-4430 after a restart, so the suite ran with
`API_PORT=4600 SMOKE_API_B_PORT=4601`. The widget follow-up form and the dashboard overflow editor
were type-checked and unit-tested but not exercised in a browser.

## Gap fixes after the Phase B browser check — 2026-10-25

- Conversations carry `topicName`; the inbox list, context panel, and offer cards show the topic.
- New offers play a short synthesised chime (once per offer, not again on reconnect) with a
  per-browser Sound on/off toggle on the offer tray. Browsers that block audio until a user gesture
  still show the card.
- Changing a consultant's departments, skills, capacity, routing switch, or status from
  **Dashboard → Users** drains the queue immediately instead of waiting for the sweep (changing your
  own departments already did).
- Consultant heartbeats broadcast presence only when it changes, and widgets receive
  `business.presence` only when tenant availability actually changes (deduplicated through Redis
  across instances). Previously every heartbeat made every widget recompute availability.
- The integration identity HTTP test now clears the shared `localhost` domain first, so the suite
  can run twice against the same database.

Verification: format, lint, and type checks pass in every workspace; 224 API unit tests and 16
dashboard tests pass; on a freshly reset Docker test stack all 20 migrations apply and all 30 HTTP
integration tests pass; the end-to-end suite passes, including the two-node `phase7`. A rerun of the
HTTP suite against the same database first failed in two integration tests because of data left by
earlier runs (the shared domain, and old pending webhook deliveries ahead of the test's own); the
first is fixed, the second still assumes a fresh stack. The chime was not heard in a browser yet.

## Phase 10 - Analytics — 2026-10-25

- **Dashboard → Analytics** (owners, admins, supervisors through `analytics:view`): conversations
  started in a range of the tenant's local days (7/30/90-day shortcuts, up to 92 days), filterable by
  department and topic. Headline tiles for reach and abandonment rates, follow-ups and overflow,
  median and 90th-percentile wait, first response and handle time, and the offer accept rate; a daily
  volume chart with per-day hover details and a table view; breakdowns by topic, department, and
  channel; topic-matching outcomes (including how often visitors changed an automatically chosen
  topic); and a per-consultant table.
- `GET /analytics/overview` and `GET /analytics/consultants` aggregate in PostgreSQL over one cohort
  definition (`docs/api/analytics.md`). Internal notes do not count as a first response; cancelled
  offers do not count against the accept rate. Migration `20261025120000_phase_10_analytics` adds an
  index on `conversations(businessId, createdAt)`.
- The bar colour (`#1f8a5f`) was checked with the palette validator (lightness band, chroma floor,
  3:1 contrast); the brand green failed the chroma floor for chart marks.

Verification: format, lint, and type checks pass in every workspace; 224 API unit tests, 20
dashboard, and 32 validation tests pass. On a fresh Docker test stack all 21 migrations apply and all
32 HTTP integration tests pass, including two analytics tests that seed a known history and check
every figure exactly (local-day boundaries in Africa/Johannesburg, percentiles, notes excluded from
first response, offer and classification counts, tenant isolation, and range validation). The
end-to-end suite passes. The analytics page has not yet been viewed in a browser.

## Phase C1 - Routing webhooks and availability — 2026-10-25

- Six new webhook events from the same transactional outbox triggers: `conversation.queued`,
  `conversation.offered`, `conversation.assigned` (both with the consultant's membership ID and
  name), `conversation.overflowed`, `conversation.follow_up_requested`, and `conversation.closed`.
  Follow-up contact details are never sent in a webhook. **Dashboard → Integrations** now lets you
  choose events per endpoint (all by default) and shows each endpoint's subscription.
- Webhook payload timestamps now end in `Z` (they were UTC before, without a zone marker).
- `GET /integrations/availability` (new scope `availability:read`) reports business hours, online
  and available consultants, overall and per department.
- Integration conversations now include `priority`, `departmentId`, `topicId`, `overflowLevel`, and
  `followUpRequested`; with `intake:read`, `followUp` adds the contact details. The dashboard's key
  form now offers `intake:read` (missing since B4) and `availability:read`. Keys may hold every
  scope (previously at most five).
- Migration `20261025130000_phase_c_routing_webhooks` replaces the trigger function and widens the
  conversation trigger to status, overflow level, and follow-up changes.

Verification: format, lint, and type checks pass in every workspace; 224 API unit tests and 20
dashboard tests pass; on a fresh Docker test stack all 22 migrations apply and all 35 HTTP tests pass,
including a new suite that changes a conversation through each routing state and checks the outbox
(ordering, consultant name, a rolled-back change leaving no event, unsubscribed events not enqueued,
no contact details in payloads), the `intake:read` gate on follow-up details, and the availability
scope. The existing webhook signing, retry, and replay tests still pass. The end-to-end suite passes.

## Phase C2 - Setup API — 2026-10-25

- New key scopes `setup:read` and `setup:write` (offered in **Dashboard → Integrations**) expose
  `/integrations/setup/*`: departments, skills, topics (with a classification preview), pre-chat
  forms, routing settings, business hours, and consultants' routing (departments, skills, capacity,
  routing switch). See `docs/api/setup.md`.
- The endpoints call the dashboard's configuration services with an integration context, so the
  rules are identical. A key acts as an administrator without a person: it cannot create users or
  change roles, names, passwords, account status, or an owner's account, and a department it
  creates starts without members.
- Audit records made by a key have no user actor and carry `integrationKeyId` in their metadata
  (`auditActor` replaces direct `auth.user.id` use in the configuration services).
- The integration OpenAPI document lists the setup paths.

Verification: format, lint, and type checks pass in every workspace; 226 API unit tests (including
audit attribution) and 20 dashboard tests pass; on a fresh Docker test stack all 22 migrations apply
and all 38 HTTP tests pass, including a new setup suite (configuring a department, skill, topic,
routing settings, and hours; key-attributed audit records; routing a consultant while rejecting role
changes and owner edits; scope and tenant boundaries). The end-to-end suite passes.

## Phase C3 - JavaScript SDK — 2026-10-25

- New workspace package `@bizchat/sdk` (`docs/api/sdk.md`): a typed, dependency-free server-side
  client for conversations, messages, customer identity proofs, availability, and every setup
  endpoint. Writes that carry an idempotency key (generated per call unless supplied) are retried
  with the same key on network errors, 429, 502-504, honouring `Retry-After`; other writes are not
  retried. Errors are `BizChatError` with status, code, and request ID.
- `verifyWebhook` and `parseWebhook` check the signature in constant time and the timestamp window.
- The package is private to the repository; publishing it would need its types bundled.

Verification: format, lint, and type checks pass in every workspace; 9 SDK unit tests pass,
including a signature produced by the API's own signing function and retry behaviour with fake
timers. A new end-to-end harness, `phaseC-sdk-smoke.mjs`, drives the built SDK against the API
(setup with a duplicate rejected and an owner edit refused, availability, an idempotent create
replayed, classification, send, history, resolve, an identity proof, and an invalid key), and the
full end-to-end suite passes. Webhook delivery to a real receiver is not part of the harness, because
endpoints must be public HTTPS hosts.

## Phase D1 - Retention and data subject requests (POPIA) — 2026-10-25

- Per-tenant retention (**Dashboard → Settings → Data retention**, 30-3650 days or keep): an hourly
  single-instance sweep deletes resolved and closed conversations unchanged for longer, with their
  messages, files (objects first, then rows), form answers, timeline, and the copies held for webhook
  retries and idempotent replays.
- Access and erasure for one visitor: from a conversation in the inbox (owners and admins), or by
  external ID through the integration API with the new `privacy:read` and `privacy:write` scopes.
  Export excludes staff-only internal notes. Erasure needs explicit confirmation, is refused while a
  conversation is open, and removes the visitor, sessions, and customer mapping. Audit entries hold
  counts and IDs only. See `docs/api/privacy.md`, including the note on backups.
- Migration `20261025140000_phase_d_privacy` adds `privacy_settings` (with a 30-3650 check) and an
  index for finding finished conversations by age.

Verification: format, lint, and type checks pass in every workspace; 228 API unit tests (including
the sweep's lease and per-tenant isolation) and 20 dashboard tests pass. On a fresh Docker test stack
all 23 migrations apply and all 42 HTTP tests pass, including a new privacy suite: retention bounds;
export without notes; erasure blocked while open and without confirmation, then leaving no
conversation, visitor, customer mapping, attachment object, webhook or replay copy, or personal data
in the audit entry; retention deleting only expired finished chats even when a file object is
already missing; and tenant and scope boundaries. The end-to-end suite passes. The new dashboard
controls were type-checked but not used in a browser yet.
