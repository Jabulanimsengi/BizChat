# ADR 0007: Redis is the authority for presence and typing

## Status

Accepted

## Decision

Durable consultant preferences live in `AgentProfile`, but current online state does not. Every agent or
visitor socket receives a scored Redis lease whose score is its expiry time. Heartbeats remove stale leases,
refresh the current socket lease, and extend the manual agent-state TTL. Disconnect removes only that socket,
so multiple tabs remain online until their final lease disappears.

Typing is stored under a conversation/participant key with a short TTL. Start and stop events are broadcast
only after conversation authorization. The payload includes `expiresAt`, allowing every client to clear a
stuck indicator even without receiving an explicit stop event.

## Consequences

- Browser sleep, crashes, and network loss cannot create permanently online or typing users.
- Multiple sockets for one identity do not incorrectly mark the identity offline when one tab closes.
- Restarting Redis loses only transient presence/typing state; PostgreSQL conversations and messages remain intact.
- Routing can query fresh presence and durable capacity independently in Phase 5.
