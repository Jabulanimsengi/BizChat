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
- Client to server `conversation.start`: `{ clientMessageId, content, topicPublicId?,
departmentPublicId? }`. When the tenant has topics and no topic or department is given, the message
  is classified. The acknowledgement may include `intake`: with `mode: 'ASK'` routing waits until
  the visitor chooses (or the prompt expires); with `mode: 'CONFIRM'` the chat is already routing and
  the visitor may change the topic.
- Client to server `conversation.intake.submit`: `{ conversationId, topicPublicId }` where `null`
  means "Something else" (the default topic). Returns `{ routed, intake }` (see forms below), or
  `TOPIC_LOCKED` once a consultant has been offered or assigned the chat. `conversation.resume` re-sends an unanswered
  `ASK` prompt.
- Bootstrap includes `topics`: the tenant's quick-reply topics, shown as buttons before the first
  message, and `form` when the tenant asks for a form before the chat (`BEFORE_CHAT`). In that mode
  `conversation.start` must include `intake: { answers, consent? }`.
- An `intake` prompt with `step: 'FORM'` carries the form to complete; routing waits. Client to server
  `conversation.intake.form`: `{ conversationId, answers, consent? }` returns `{ routed, intake }`, or
  `INTAKE_INVALID` with `details.fieldErrors`. `conversation.intake.submit` also returns
  `{ routed, intake }`, where `intake` is the form when the chosen topic needs one.
- Server to client `conversation.intake.required`: `{ conversationId, prompt }` when the server starts
  an intake step itself (a topic prompt timed out into a topic with a form).
- Server to client `conversation.wait.options`: `{ conversationId, reason: 'MAX_WAIT' }` once the topic's
  maximum wait passes. Client to server `conversation.followup.request`:
  `{ conversationId, name?, email?, phone?, note? }` (email or phone required) returns the
  `ConversationResponse`; errors are `FOLLOW_UP_ALREADY_REQUESTED`, `FOLLOW_UP_UNAVAILABLE` (a
  consultant has the chat), and `INTAKE_PENDING`. The chat stays queued and is no longer closed when
  the visitor leaves. Conversations carry `overflowLevel`, `maxWaitReachedAt`, `followUpRequestedAt`,
  and `followUpContact`.
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
- Server to client `conversation.routed`: outcome `QUEUED` (with position), `OFFERED` (a consultant is
  being asked; no name is shown yet), or `ASSIGNED`
- Server to client `conversation.updated`: transfer, resolve, reopen, tag, `OVERFLOWED`,
  `FOLLOW_UP_REQUESTED`, and `ABANDONED`
  operations. `ABANDONED` means the visitor's place in the queue expired after they left; the widget
  forgets the conversation and the next message starts a new one.
- Server to client `widget.error`: safe authentication/session error

All input is validated. Start, resume, history, send, and receipt operations re-authorize the durable
visitor identity against the tenant and conversation. Visitor history and broadcasts never include
`INTERNAL_NOTE` messages.
