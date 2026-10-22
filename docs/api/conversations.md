# Conversation HTTP API

All routes require an authenticated dashboard session. Tenant identity comes from that session and
is never accepted from request input. Consultants are limited to assigned conversations; roles with
`conversation:view_all` can access the tenant inbox.

## Routes

- `GET /api/v1/conversations?cursor=&limit=&status=` - cursor-paginated inbox.
- `GET /api/v1/conversations/:id` - one authorized conversation.
- `GET /api/v1/conversations/:id/messages?beforeSequence=&afterSequence=&limit=` - bounded ordered history.
- `POST /api/v1/conversations/:id/messages` - durable agent reply using `{ clientMessageId, content }`.
- `PATCH /api/v1/conversations/:id/status` - validated lifecycle transition using `{ status }`.

Write routes also require a trusted browser origin. Message sequence numbers are JSON strings because
the database representation is `BIGINT`. Reusing a `clientMessageId` for the same conversation returns
the original message instead of creating a duplicate.
