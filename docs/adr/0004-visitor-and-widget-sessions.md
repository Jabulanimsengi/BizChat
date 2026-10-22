# ADR 0004: Separate visitor identity from widget authorization

## Status

Accepted

## Decision

An anonymous `Visitor` is a tenant-owned durable identity. A browser receives a long-lived opaque
visitor-session token whose HMAC digest is stored in PostgreSQL. Each widget bootstrap creates a
separate short-lived `WidgetSession` bound to the verified request origin. Socket.IO authenticates
with that short-lived token and joins only the server-selected widget-session room.

## Consequences

- Public business IDs and internal visitor IDs are not credentials.
- A stolen widget token has a short lifetime and cannot be replayed from another origin.
- Returning browsers reuse the same anonymous visitor without fingerprinting.
- Clearing browser storage starts a new anonymous identity, which is expected until verified
  customer identity linking is implemented.
