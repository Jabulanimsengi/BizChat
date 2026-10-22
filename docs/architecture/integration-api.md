# Integration API (proposed)

Status: **proposed, not implemented**. The existing management endpoints rely on the browser
`bizchat_session` cookie and origin checks. They are not a machine-authentication contract. This
document captures the agreed shape of a server-to-server API for website owners and CRM integrations
so it can be built as a scoped release.

## Namespace

`/api/v1/integrations`, separately versioned and documented from the browser API.

## Credentials

- Tenant-owned machine credentials created by an owner/admin in the dashboard.
- Show the secret once; store only a hash (`sha256`/HMAC), plus a non-secret prefix for lookup and a
  `lastUsedAt` timestamp.
- Scopes, optional expiry, rotation, and revocation; all lifecycle events written to the audit log.
- Tenant context is derived from the credential only. Never trust a business id in the request body.
- Explicit integration principal rather than impersonating an agent, so assignment rules and
  private-note visibility are preserved.

## Initial operations

- Read conversations and permitted messages (cursor pagination, stable errors, request IDs, limits).
- Create a conversation.
- Send a message (fixed attribution rules and routing behaviour defined before implementation).
- Resolve a conversation.
- Signed customer identification to link an authenticated website customer to a visitor, scoped per
  tenant; never trust a browser-supplied identity without server verification.

## Reliability contract

- Idempotency keys required for retryable writes, with payload-conflict detection and documented
  retention.
- Per-key and per-tenant quotas plus IP abuse limits; actionable retry information.
- Stable error envelope shared with the browser API.

## Documentation and webhooks

- Generated OpenAPI document with JavaScript, PHP, and curl examples; sandbox and contract tests.
- Signed webhooks for conversation creation, new messages, and resolution, delivered through a
  transactional outbox and worker with stable event ids, timestamped signatures, bounded retries,
  failed-delivery inspection, and replay.
- Outbound destinations validated against private/internal network access, including redirects and DNS
  changes (SSRF protection).

## Not in the first release

- OAuth delegated installation for third-party platforms. Tenant-managed keys cover owner-controlled
  backends first; OAuth is added when a platform needs to install across many customer accounts.
