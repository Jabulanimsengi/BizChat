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
- `offer.accept`: `{ offerId }`; returns the `ASSIGNED` routing event, or `OFFER_NO_LONGER_AVAILABLE`
  when the offer expired, was declined, or another tab accepted first.
- `offer.decline`: `{ offerId, reason? }`; the chat is offered to the next eligible consultant.

## Server events

- `agent.connected`, `agent.error`, `agent.presence`.
- `conversation.new`, `message.new`, `message.receipt`.
- `typing.changed`, `visitor.presence`.
- `conversation.offered`: `{ offerId, conversation, firstMessage, offeredAt, expiresAt }`, sent to the
  offered consultant only. Pending offers are re-sent after `agent.connected` on reconnect.
- `conversation.offer.withdrawn`: `{ offerId, conversationId, reason }` where reason is `ACCEPTED`,
  `DECLINED`, `EXPIRED`, or `CANCELLED`; the dashboard removes the offer card.
- `agent.notice`: `{ code, message }`, currently `SET_AWAY_AFTER_MISSED_OFFERS` when consecutive missed
  offers set the consultant away.

While a conversation is `OFFERED`, the offered consultant can preview it but replies return
`OFFER_NOT_ACCEPTED`, and transfers return `CONVERSATION_OFFER_PENDING`.

Typing never enters PostgreSQL. Redis keys expire after the configured typing TTL, and clients also hide
the indicator at the event's `expiresAt` time.
