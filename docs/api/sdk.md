# JavaScript SDK (`@bizchat/sdk`)

A typed, dependency-free client for the integration API, for Node.js 18.17 or later. Use it on your
server only: it needs an integration key, which must never reach a browser.

```ts
import { BizChatClient, BizChatError, parseWebhook } from '@bizchat/sdk';

const bizchat = new BizChatClient({
  apiKey: process.env.BIZCHAT_KEY!,
  baseUrl: 'https://api.example.com',
});

// Configure routing (setup:write).
const department = await bizchat.setup.departments.create({ name: 'Company registration' });
await bizchat.setup.topics.create({
  name: 'Register a company',
  departmentId: department.id,
  keywords: [{ phrase: 'register' }, { phrase: 'new company', weight: 3 }],
});

// Show a chat button only when someone can answer (availability:read).
const { availability } = await bizchat.availability();

// Start a conversation from your own channel (conversations:write).
const { conversation } = await bizchat.conversations.create(
  { externalId: 'customer-42', content: 'I want to register a company' },
  { idempotencyKey: `ticket-${ticketId}` },
);

// Let a signed-in customer resume their chat in the widget (customers:identify).
const { identityToken } = await bizchat.customers.identify({ externalId: 'customer-42', email });
```

| Area                                                     | Methods                                                |
| -------------------------------------------------------- | ------------------------------------------------------ |
| `conversations`                                          | `list`, `get`, `messages`, `create`, `send`, `resolve` |
| `customers`                                              | `identify`                                             |
| `availability()`                                         | overall and per-department availability                |
| `setup.departments`, `setup.skills`, `setup.intakeForms` | `list`, `create`, `update`                             |
| `setup.topics`                                           | `list`, `create`, `update`, `test(message)`            |
| `setup.routingSettings`, `setup.businessHours`           | `get`, `update`                                        |
| `setup.consultants`                                      | `list`, `update(membershipId, routing)`                |

## Retries and idempotency

`create`, `send`, and `resolve` always send an `Idempotency-Key`: yours if you pass one, otherwise a
new UUID per call. Reads and those writes are retried up to `maxRetries` times (default 2) on network
errors, `429`, `502`, `503`, and `504`, honouring `Retry-After` and otherwise using capped exponential
backoff with jitter; a retry reuses the same key, so it can never apply an action twice. Setup writes
and identity proofs are not retried automatically. To retry an action across process restarts, pass
your own key and store it with the job.

Failures throw `BizChatError` with `status`, `code` (for example `TOPIC_EXISTS`), `message`,
`requestId`, and `details`. Network failures and timeouts (`timeoutMs`, default 15 s) have status `0`
and code `NETWORK_ERROR`.

## Webhooks

```ts
app.post('/webhooks/bizchat', express.raw({ type: 'application/json' }), (req, res) => {
  const event = parseWebhook({
    rawBody: req.body, // the exact bytes; do not parse JSON first
    signature: req.header('x-bizchat-signature'),
    secret: process.env.BIZCHAT_WEBHOOK_SECRET!,
  });
  // Deduplicate on event.id, then handle event.type.
  res.sendStatus(204);
});
```

`parseWebhook` throws unless the signature matches and the timestamp is within five minutes
(`toleranceSeconds`); `verifyWebhook` returns a boolean instead. Both compare in constant time.

The package is private to this repository for now and depends on `@bizchat/types` for its response
types; publishing it would mean bundling those types.
