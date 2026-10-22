# Agent WebSocket contract

Namespace: `/agent`

The browser sends its HttpOnly dashboard session cookie with credentials. The gateway also requires an
exact configured dashboard origin, validates the durable session, derives the tenant/membership, and
loads the active agent profile. Privileged roles join the tenant live-inbox room; conversation rooms are
joined only after a service-level authorization check.

## Client events with structured acknowledgements

- `agent.heartbeat`: refreshes the Redis socket lease and returns current presence/workload.
- `agent.presence.set`: `{ state }` where state is `ONLINE`, `BUSY`, `AWAY`, or `DO_NOT_DISTURB`.
- `conversation.subscribe`: `{ conversationId, afterSequence? }`; authorizes, joins, and returns history.
- `message.send`: `{ conversationId, clientMessageId, content }`.
- `message.delivered`: `{ conversationId, messageId }`.
- `message.read`: `{ conversationId, throughSequence }`.
- `typing.start` / `typing.stop`: `{ conversationId }`.

## Server events

- `agent.connected`, `agent.error`, `agent.presence`.
- `conversation.new`, `message.new`, `message.receipt`.
- `typing.changed`, `visitor.presence`.

Typing never enters PostgreSQL. Redis keys expire after the configured typing TTL, and clients also hide
the indicator at the event's `expiresAt` time.
