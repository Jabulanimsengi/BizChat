# Administration architecture

## Tenant boundary

Every administration query is derived from the authenticated `businessId`. Resource identifiers are never sufficient on their own: user, department, domain, and audit-log lookups also constrain the owning business. Cross-tenant identifiers therefore resolve as not found.

## Users and access

Owners and administrators can create users, assign roles, control routing, set chat capacity, and assign departments. New accounts receive an Argon2id password hash. Disabling a membership also disables its agent profile and revokes every active session for that membership in the same transaction.

Only an owner may modify another owner. A membership cannot disable itself, and the service rejects any update that would leave the business without an active owner. These rules live in the service layer so every current or future transport receives the same protection.

## Operating hours

`BusinessHour` stores one row per weekday using minutes since midnight. Hours are interpreted using the business IANA timezone and support both normal and overnight windows. Until a business explicitly saves a schedule, availability remains backward-compatible and treats the business as open.

Visitor availability is `ONLINE` only when the operating window is open and at least one eligible consultant is online. Outside that state, visitors can still create a durable conversation and leave a message using the configured offline copy.

## Audit history

Administrative mutations append tenant-scoped audit records containing actor, action, target, request ID, IP address, metadata, and UTC creation time. Audit reads require `audit:view`, use stable descending cursor pagination, and cannot use a cursor owned by another tenant.
