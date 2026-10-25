# BizChat website integration

## Install chat

In **Dashboard → Websites**, add and verify your hostname, then copy the generated embed snippet. The snippet must contain the public widget URL, public business ID, and the API origin (`data-api`). It contains no API key.

Allow the widget CDN in your site's `script-src`, the API HTTPS and WSS origins in `connect-src`, and the widget's injected styles in your style policy. With a nonce-based style policy, set the same nonce on the loader script; the widget propagates it to its Shadow DOM style element. Shadow DOM isolates styling, not access from scripts on the host website. Test installation using `bizchat:ready` and `bizchat:error` events.

```js
window.addEventListener('bizchat:ready', () => console.log('Chat initialized'));
window.addEventListener('bizchat:error', (event) => console.error(event.detail.message));
window.addEventListener('bizchat:unread', (event) => updateBadge(event.detail.count));
// After the loader has executed:
window.BizChat.open();
window.BizChat.close();
```

## Backend API

Create a key in **Dashboard → Integrations**, selecting only the permissions your application needs. Copy it once to your backend secret store. Keys expire after 90 days by default (maximum 365); rotation immediately revokes the previous key. Lists show metadata, never the secret or hash. Keys are scoped to one business and can access its selected resources across all agents. Only owners and admins manage keys and webhook subscriptions.

Base URL: `https://YOUR_API_HOST/api/v1/integrations`.
OpenAPI: `https://YOUR_API_HOST/api/v1/integrations/openapi.json`.

| Operation                                                        | Scope                       |
| ---------------------------------------------------------------- | --------------------------- |
| GET /conversations                                               | conversations:read          |
| GET /conversations/:id                                           | conversations:read          |
| GET /conversations/:id/messages                                  | messages:read               |
| POST /conversations                                              | conversations:write         |
| POST /conversations/:id/messages                                 | messages:write              |
| POST /conversations/:id/resolve                                  | conversations:write         |
| POST /customers/identify                                         | customers:identify          |
| Pre-chat answers and follow-up contact on GET /conversations/:id | intake:read                 |
| GET /availability                                                | availability:read           |
| Setup endpoints (docs/api/setup.md)                              | setup:read, setup:write     |
| POST /privacy/customers/export, /erase (docs/api/privacy.md)     | privacy:read, privacy:write |

Conversations include `priority`, `departmentId`, `topicId`, `overflowLevel`, and
`followUpRequested`. With `intake:read`, `followUp` adds when the visitor asked to be contacted and the
contact details they left.

`GET /availability` reports whether a new chat would reach someone now: `open` (inside business
hours, always true when no hours are saved), `availability` (`ONLINE` when open and at least one
consultant is online), `onlineAgents`, `availableAgents` (online and below their chat limit), and the
same counts per active department. Poll it no more than about once a minute per page view, or cache
it server-side; the widget already receives live availability.

All machine requests use `Authorization: Bearer bzc_...`; dashboard cookies are not accepted. Do not send business IDs: tenant context comes from the credential. Request bodies reject unknown properties. Message history excludes internal notes and deleted messages. This release returns public message content/metadata; attachment download remains a separate authorized widget/dashboard capability.

Conversation creation accepts `externalId`, `content`, optional `subject`, optional `departmentPublicId`, optional `topicPublicId`, and optional `intake: { answers, consent }` for the tenant's pre-chat form (validated against the form; omit it when you have no answers). Reading answers back requires a key with the `intake:read` scope, because they are personal information. Without a department or topic, the subject and first message are matched against the tenant's topics; an uncertain match uses the default topic, because nobody can answer a prompt over the API. It creates a conversation and an inbound visitor message for that tenant's external customer identity, then uses existing routing/recovery. A different idempotency key deliberately creates a new conversation even for the same customer. Outbound message writes are attributed to `INTEGRATION` and record the key ID; they do not impersonate an agent, change an assignment, or count as a human first response. Resolve accepts `{}` or `{ "reason": "..." }`, releases assignment/queue capacity, and notifies connected clients. Resolved/closed conversations reject outbound writes.

### Retries and limits

Every chat write needs `Idempotency-Key`: 8–128 characters from letters, digits, `_ . : -`. Generate one per logical action, persist it with your job, and reuse it for retries. The request and response are persisted in the same transaction as the chat mutation, and concurrent retries return the original response. Reusing the key with a different resource, operation, or normalized body returns `409 IDEMPOTENCY_CONFLICT`. Records are retained for at least 30 days; do not retry an old action beyond that retention period. Keys are tenant-scoped, so rotating a credential preserves retry identity. A replay returns the original snapshot; GET the resource for current state.

Limits: 120 requests per key per minute and 600 per business per minute, in addition to existing IP abuse limits. Machine quota responses expose `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `Retry-After` on 429. Redis failure rejects machine requests with 503. Use bounded exponential backoff on transient failures. Conversation lists accept `cursor` and `limit` (1–100), returning `nextCursor`. Message history accepts decimal-string `afterSequence` and `limit`, returning ascending messages, `hasMore`, and `nextSequence`. Keep sequence numbers as strings or BigInt.

```sh
curl "$BIZCHAT_URL/api/v1/integrations/conversations" \
  -H "Authorization: Bearer $BIZCHAT_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: your-persisted-order-support-job-id' \
  -d '{"externalId":"customer-42","content":"I need help with my order"}'
```

```js
// Backend JavaScript: persist actionId before sending and reuse it on retry.
const response = await fetch(`${process.env.BIZCHAT_URL}/api/v1/integrations/conversations`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.BIZCHAT_API_KEY}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': actionId,
  },
  body: JSON.stringify({ externalId: authenticatedCustomer.id, content: 'Please help' }),
  signal: AbortSignal.timeout(15000),
});
if (!response.ok) throw new Error(`BizChat returned ${response.status}`);
const result = await response.json();
```

```php
// Backend PHP: $actionId is persisted with your job, not regenerated on retries.
$ch = curl_init(getenv('BIZCHAT_URL') . '/api/v1/integrations/conversations');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 15,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer ' . getenv('BIZCHAT_API_KEY'),
        'Content-Type: application/json',
        'Idempotency-Key: ' . $actionId,
    ],
    CURLOPT_POSTFIELDS => json_encode(['externalId' => $customerId, 'content' => 'Please help']),
]);
$body = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
// Check transport errors/status; retry transient failures with the same $actionId.
```

## Signed customer identity

Your authenticated website backend calls `POST /customers/identify` with `{ "externalId": "customer-42" }`, optionally adding `name` and `email` claims; pre-chat form fields set to fill from those claims are then completed for that customer. Derive this ID from your authenticated session, never an unverified browser parameter. Return the resulting `identityToken` and `expiresAt` to that customer only, with `Cache-Control: no-store`. In the browser call `window.BizChat.identify(identityToken)`. BizChat verifies the signature, expiry, key validity, and tenant before selecting that customer's visitor identity and latest conversation. No API key is sent to the browser. External IDs are unique per tenant.

Proofs and their widget sessions last at most five minutes. Refresh through your authenticated backend and call identify again before expiry (for example every four minutes); handle `bizchat:error` if refresh fails. The widget keeps identified credentials in memory and recreates its UI when identity changes. Call `window.BizChat.logout()` as part of website logout to clear local chat state and return to an anonymous visitor. Already-issued credentials expire within five minutes; rotation stops new proof use but does not cancel an already-authenticated socket immediately. Avoid issuing proofs unless your site can enforce this logout/refresh contract.

## Webhooks

Add a public HTTPS endpoint in the dashboard, choose its events (all are selected by default), and store the one-time signing secret at the receiving server.

| Event                              | Sent when                                                         | `data`                                           |
| ---------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------ |
| `conversation.created`             | a conversation is created                                         | `id`, `status`, `source`, `subject`, `createdAt` |
| `message.created`                  | a public message is stored                                        | message fields; internal notes are never sent    |
| `conversation.resolved`            | a conversation becomes resolved                                   | `id`, `status`, `resolvedAt`                     |
| `conversation.queued`              | it waits for a consultant (also after a declined or missed offer) | routing fields                                   |
| `conversation.offered`             | a consultant is asked to take it                                  | routing fields, `consultant`, `offerExpiresAt`   |
| `conversation.assigned`            | a consultant has it                                               | routing fields, `consultant`, `assignedAt`       |
| `conversation.overflowed`          | an overflow step widened who may take it                          | routing fields, `fromLevel`                      |
| `conversation.follow_up_requested` | the visitor left contact details instead of waiting               | routing fields, `followUpRequestedAt`            |
| `conversation.closed`              | it closed without resolution, e.g. the visitor left the queue     | `id`, `status`, `closedAt`                       |

Routing fields are `id`, `status`, `priority`, `departmentId`, `topicId`, and `overflowLevel`;
`consultant` is `{ membershipId, displayName }`. Follow-up contact details are never sent in a
webhook; fetch the conversation with an `intake:read` key. Timestamps are ISO 8601 UTC ending in
`Z` (before 2026-10-25 webhook timestamps omitted the `Z` but were already UTC). Internal notes are never enqueued. Events from widgets, agents, integrations, and system actions are inserted into a transactional outbox by database triggers, so rollbacks do not leak events and application crashes do not lose the queued delivery.

Each body has `id`, `type`, `version`, `createdAt`, and `data`. `X-BizChat-Event-Id` is stable across retries/replays. `X-BizChat-Signature` is `t=<unix-seconds>,v1=<hex-HMAC-SHA256>` over the exact string `<timestamp>.<raw-body>`. Verify both the timestamp (for example ±5 minutes) and signature using a constant-time comparison before parsing or processing the body. Deduplicate using the event ID and acknowledge promptly with 2xx. Delivery is at least once and ordering is not guaranteed; use message sequence numbers where needed.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';
export function verifyWebhook(rawBody, header, secret) {
  const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(header ?? '');
  if (!match || Math.abs(Date.now() / 1000 - Number(match[1])) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${match[1]}.`).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(match[2], 'hex'));
}
```

The worker claims leased batches across replicas, uses exponential retry with jitter, and marks failures after 10 attempts. Inspect and replay failed deliveries in the dashboard; the event ID remains unchanged. A crash after remote acceptance can cause a duplicate. Disabling an endpoint cancels queued deliveries; one already in flight may finish. Recreate an endpoint to change URL or signing secret. Delivered and failed records are retained for 30 days after completion/failure.

Only public DNS hostnames resolving to public IPv4 addresses on HTTPS port 443 are supported in this release. Every attempt resolves and validates DNS again, then connects to the exact approved address with the original TLS server name. Redirects, IP literal URLs, credentials in URLs, private/reserved IPs, and nonstandard ports are rejected. Use your existing HTTPS ingress for local sandbox testing; production validation is never disabled for localhost. Apply outbound network restrictions as an additional deployment control.

Webhook secrets are AES-GCM encrypted using a purpose-derived key from `WIDGET_TOKEN_SECRET`. Preserve that secret in backups and plan re-encryption or endpoint recreation when rotating it; changing it invalidates widget/customer proofs and makes existing webhook secrets unreadable. API key hashes are independent.

## Deploy and verify

Apply the new additive migration with `npm run db:migrate:deploy` before starting the new API. It adds enum values, integration tables, an attribution column, and the transactional webhook triggers. Database triggers are part of the contract: use the migration runner, not `prisma db push` or a schema-only restore. Deploy API/dashboard/widget together; older clients may not render the new INTEGRATION sender correctly. Do not roll back to an older binary without evaluating the new enum values/data.

Run `npm run check`, `npm run test:http`, the existing real-stack smoke suite, and the production container job. The new HTTP suite uses the real application middleware and isolated test tenants. Run it only against a test database. Use separate keys, customer IDs, and webhook destinations for your staging sandbox. A hosted public sandbox and public TLS/browser/load/restore sign-off are operator deployment tasks, not created by this code change.
