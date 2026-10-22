# Agent profile HTTP API

Agent profiles are tenant-owned durable configuration linked one-to-one with a business membership.
Presence is intentionally excluded because Redis connection leases are the real-time authority.

- `GET /api/v1/agent-profile/me` returns the profile, current computed presence, and active workload.
- `PATCH /api/v1/agent-profile/me` accepts any non-empty subset of:
  - `maxConcurrentChats`: integer from 1 through 50.
  - `routingEnabled`: boolean.
  - `status`: `ACTIVE` or `DISABLED`.

Existing memberships are lazily provisioned on first access; newly registered owners receive a profile
inside the registration transaction.
