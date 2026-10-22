# BizChat production readiness and integration assessment

Assessment date: 2026-09-14. Scope: repository inspection, local checks, deployment configuration, and external integration design. No application implementation changes were made. This is not a certification of a deployed environment or an exhaustive security audit.

## Decision

Do not approve an unrestricted production launch yet. The existing architecture is suitable for a multi-tenant live-chat product, and substantial functionality is implemented. Resolve the deployment defects below and demonstrate production-mode operation before launch. A server-to-server developer API is still missing.

## Findings that affect launch

1. **Production container CI cannot resolve its Compose configuration.** `.github/workflows/ci.yml` supplies neither `SMTP_HOST`, `SMTP_FROM`, nor `NEXT_PUBLIC_WIDGET_URL` in the containers job, but `docker-compose.production.yml` requires all three. Reproducing the declared job environment with `docker compose ... config --quiet` fails on a required SMTP variable before building. Add non-secret CI placeholders, validate configuration explicitly, and boot the resulting images in CI instead of only building them.
2. **Fresh production staging storage has an ownership mismatch.** `Dockerfile.api:30` creates and assigns `/data/attachments` to the non-root node user. Compose instead mounts `/data/staging` and selects that path. `apps/api/src/attachments/attachment.module.ts:42` creates `.tmp` during module initialization. A fresh root-owned named volume is therefore expected to cause an EACCES startup failure. Align the image path and ownership, then verify startup and upload using a fresh volume. This finding is based on configuration inspection; a fresh-container runtime reproduction was not performed.
3. **Metrics cardinality is unbounded for unmatched paths.** `apps/api/src/common/request-logging.middleware.ts:33` preserves arbitrary alphabetic path segments on unmatched requests. `apps/api/src/metrics/metrics.service.ts:11` stores these labels in Maps without eviction. Requests to unique unknown paths keep adding memory and metric series, including rejected responses. Use a constant unmatched-route label and a bounded set of methods; test a large batch of distinct 404 paths.
4. **Release verification does not exercise the production deployment end to end.** Container CI builds images but does not start them. The HTTP integration suite constructs its own Nest application without all `main.ts` middleware; the smoke harness defaults to development mode. Existing tests are useful but cannot establish correctness of production TLS, CORS, proxy trust, storage permissions, SMTP, or production startup guards. Add a production-mode container smoke job and browser tests through the actual ingress.

## Existing strengths

Verification during this assessment: all 113 unit tests passed (86 API, 10 dashboard, 3 widget, 14 validation); workspace type checking and production builds passed; the existing formatting check passed. The production dependency audit completed with zero reported vulnerabilities after retrying with network access. The combined `npm run check` stopped at Prisma generation with an EPERM DLL rename error, so its remaining checks were run separately. No real-stack integration, fresh-volume production boot, browser, load, or restore tests were run during this assessment. Prior success claims in implementation-status.md are historical evidence only. Command logs are in `var/readiness-*.log`.

- Modular NestJS API with an `/api/v1` prefix, shared TypeScript contracts, and Zod validation.
- Tenant-scoped business services, session authentication, authorization guards, and audit records.
- DNS verification and origin-bound anonymous visitor/widget sessions.
- PostgreSQL message persistence with unique client message IDs, sequence numbers, transaction-based append, history pagination, and retry handling.
- Routing, transfers, internal notes, departments, business hours, receipts, reconnect catch-up, and Redis-backed presence.
- Argon2 authentication, hashed reset/verification tokens, production environment checks, and fail-closed HTTP throttling.
- S3-compatible attachments, upload validation, ClamAV scanning, migrations, backup/restore scripts, and CI smoke harnesses.

These are implemented controls, not proof that every path or operational scenario is correct.

## Technology fit

| Technology                       | Assessment                                                                                                                                                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript and npm workspaces    | Keep. Shared contracts and one language reduce integration drift.                                                                                                                                                    |
| NestJS 11 and Express            | Keep. A modular backend is appropriate for authorization, chat operations, and a developer API. There is no demonstrated need for microservices.                                                                     |
| PostgreSQL 16 and Prisma 6       | Keep. Transactions, constraints, and indexes fit durable multi-tenant messaging. Profile query latency, pool usage, and per-tenant routing contention under load.                                                    |
| Socket.IO 4, Redis 7, ioredis    | Keep for interactive delivery and ephemeral coordination. PostgreSQL must remain authoritative. The Redis Pub/Sub adapter does not provide built-in connection-state recovery; retain and test application catch-up. |
| Next.js 16 and React 19          | Suitable for the dashboard. The separate NestJS API already owns business logic; preserve that separation. Address the middleware deprecation reported by the build during maintenance.                              |
| Vite 6 and native Web Components | Suitable for a small framework-independent widget. Shadow DOM gives style encapsulation; it is not an iframe security boundary from the embedding page.                                                              |
| S3-compatible storage and ClamAV | Suitable for attachments. Capacity-plan simultaneous buffered uploads and scanning. Prefer managed storage when operational staffing is limited.                                                                     |
| Docker Compose                   | Suitable as a single-host reference deployment. It does not provide host-level high availability. Match deployment topology to agreed availability and recovery objectives.                                          |

Node 22 is a supported maintenance-LTS line, with scheduled end of life on 2027-04-30. PostgreSQL 16 is supported through 2028-11-09. Pin tested patch/image versions or digests, including MinIO and ClamAV currently referenced with floating tags, and automate reviewed updates. The unrestricted Node engine range `>=22` is broader than the CI-tested major.

References: [Node release schedule](https://github.com/nodejs/Release), [PostgreSQL support policy](https://www.postgresql.org/support/versioning/), [Socket.IO Redis adapter](https://socket.io/docs/v4/redis-adapter/).

## Website-owner integration

There are two distinct needs:

1. **Install chat on a website:** already substantially supported by the widget loader, domain verification, public business ID, bootstrap endpoint, and authenticated widget socket. Improve onboarding with a copyable snippet, installation diagnostics, and documented CSP requirements. Offer a small documented browser interface such as open, close, and unread events.
2. **Connect a website backend or CRM:** implement a dedicated integration API in the existing NestJS application. Management endpoints currently rely on `bizchat_session` cookies and browser-origin checks. They are not a supported machine-authentication contract. Repository inspection found no integration-key lifecycle, OAuth authorization flow, OpenAPI document, webhook delivery service, or transactional webhook outbox.

### Proposed first API release

- Namespace: `/api/v1/integrations`, with a separately documented contract.
- Tenant-owned machine credentials: show a secret once, store only its hash, support scopes, expiry, rotation, revocation, last-use metadata, and audit records. Derive tenant context from the credential, never from a trusted request-body business ID. Keep secrets on the site owner's backend.
- Model an integration principal explicitly. Reuse chat services through appropriate authorization; do not impersonate an arbitrary agent to bypass assignment rules or expose private notes.
- Initial operations: read conversations, read permitted messages, create conversations, send messages, and resolve conversations. Define how integration messages are attributed and how they affect routing before implementation.
- Add signed customer identification for linking an authenticated website customer to a visitor. Scope external customer IDs by tenant and never trust a browser-supplied identity without server verification.
- Require idempotency keys for retryable writes, with request-payload conflict detection and documented retention. Keep cursor pagination, stable errors, request IDs, explicit limits, and backward-compatibility rules.
- Enforce per-key and per-tenant quotas plus IP abuse limits. Return actionable retry information.
- Generate OpenAPI documentation and examples for JavaScript, PHP, and curl. Publish a sandbox and contract tests. Nest supports this through its [OpenAPI integration](https://docs.nestjs.com/openapi/introduction).
- Deliver signed webhooks for conversation creation, new messages, and resolution using a transactional outbox and worker. Provide stable event IDs, timestamped signatures, bounded retries, failed-delivery inspection, and replay. Validate outbound destinations against private/internal network access, including redirects and DNS changes.
- Add OAuth later if third-party platforms need delegated installation across many customer accounts; simple tenant-managed keys are sufficient for an initial owner-controlled backend integration.

## Release acceptance

Fix the concrete defects, obtain a clean quality pipeline, and run real-stack HTTP, two-node reconnect, attachment, and backup/restore tests. Test cross-tenant reads/writes, role boundaries, key revocation, webhook retries, and duplicate requests for the integration API. Run actual browser tests against deployed dashboard and embedded widget, including restrictive CSP and connection failures.

Set measurable concurrent-connection, messages-per-second, latency, availability, and recovery targets before capacity testing. Configure centralized logs, alerts, backups, restore ownership, and retention/deletion behavior. The repository alone cannot verify that these operations are deployed. Analytics is explicitly unfinished in the implementation-status document; decide whether it is part of the launch promise.

## Implementation follow-up — 2026-09-14

The implementation now includes the integration API described above, a management dashboard,
customer identity proofs, and signed durable webhooks. The previously identified Compose variables,
staging ownership, and metrics cardinality fixes are present; production smoke coverage now also
exercises key lifecycle, retry-safe chat creation, and scanned attachment upload/download. See
`docs/api/integrations.md` for the delivered API contract, deployment procedure, and explicit limits.
The original assessment above remains a historical record, not the current implementation inventory.
