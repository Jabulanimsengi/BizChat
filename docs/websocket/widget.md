# Widget WebSocket contract

Namespace: `/widget`

## Authentication and rooms

The handshake sends the short-lived `widgetSessionToken` in `auth.token`. The gateway verifies its
digest, expiry, revocation state, tenant status, visitor session, and exact origin. Clients initially
join only their server-selected session room. A successful conversation start or resume authorizes
and joins `conversation:<businessId>:<conversationId>:visitor`; clients cannot request arbitrary rooms.

## Event acknowledgement

Durable client events use a callback acknowledgement:

```ts
type SocketAck<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } };
```

Success is acknowledged only after PostgreSQL commits.

## Events

- Server to client `widget.connected`: `{ connectedAt, sessionExpiresAt }`
- Client to server `widget.heartbeat`: no payload
- Server to client `widget.heartbeat.ack`: `{ serverTime }`
- Client to server `conversation.start`: `{ clientMessageId, content }`
- Client to server `conversation.resume`: `{ conversationId, afterSequence?, limit? }`
- Client to server `conversation.history`: `{ conversationId, beforeSequence, limit? }`
- Client to server `message.send`: `{ conversationId, clientMessageId, content }`
- Client to server `message.delivered`: `{ conversationId, messageId }`
- Client to server `message.read`: `{ conversationId, throughSequence }`
- Client to server `typing.start` / `typing.stop`: `{ conversationId }`
- Server to client `message.new`: committed `MessageResponse`
- Server to client `message.receipt`: committed delivery/read receipt
- Server to client `typing.changed`: authorized consultant typing with automatic expiry
- Server to client `business.presence`: aggregated `ONLINE`/`OFFLINE` consultant availability
- Server to client `conversation.updated`: transfer, resolve, reopen, tag, and `ABANDONED`
  operations. `ABANDONED` means the visitor's place in the queue expired after they left; the widget
  forgets the conversation and the next message starts a new one.
- Server to client `widget.error`: safe authentication/session error

All input is validated. Start, resume, history, send, and receipt operations re-authorize the durable
visitor identity against the tenant and conversation. Visitor history and broadcasts never include
`INTERNAL_NOTE` messages.
