# Privacy: retention, access, and erasure

BizChat holds personal information on behalf of each business (the responsible party under POPIA).
These controls let a business meet retention limits and data subject requests. They do not replace
the business's own privacy policy, consent wording, or records of processing.

## Retention

**Dashboard → Settings → Data retention** (owners and admins) or `PUT /api/v1/privacy/settings` with
`{ "conversationRetentionDays": 30..3650 | null }`. Resolved and closed conversations that have not
changed for that many days are deleted with their messages, files, form answers, timeline, and the
copies held for webhook retries and idempotent replays. Open conversations are never deleted. `null`
(the default) keeps conversations.

A sweep runs on one API instance at a time (Redis lease `retention:sweep:leader`) every
`RETENTION_SWEEP_INTERVAL_MS` (default one hour) and deletes up to 100 conversations per tenant per
run, recording a `privacy.retention_applied` audit entry with counts only. Attachment objects are
deleted before rows, so an interrupted run is repeated rather than leaving unreachable files.

## Access and erasure requests

| Request                 | Dashboard (owners, admins)                   | Integration API                                                |
| ----------------------- | -------------------------------------------- | -------------------------------------------------------------- |
| Export a visitor's data | Inbox → conversation → Visitor data → Export | `POST /integrations/privacy/customers/export` (`privacy:read`) |
| Erase a visitor's data  | Inbox → conversation → Visitor data → Erase  | `POST /integrations/privacy/customers/erase` (`privacy:write`) |

Dashboard endpoints: `GET /privacy/conversations/:id/visitor/export`,
`POST /privacy/conversations/:id/visitor/erase`, and the same under `/privacy/visitors/:visitorId`.
Integration requests identify the customer by `{ "externalId" }`, the ID used for identity proofs.

- **Export** returns the visitor, the customer's identity claims, and every conversation's public
  messages, form answers, follow-up contact details, and file names. Staff-only internal notes are
  not included; review them separately if the request covers them.
- **Erase** requires `{ "confirm": true }` and is refused with `409 CONVERSATION_OPEN` while any of
  the visitor's conversations is open. It deletes their conversations as above, the visitor, their
  browser sessions, and the integration customer mapping. It cannot be undone.
- Both are audited (`privacy.visitor_exported`, `privacy.visitor_erased`) with counts and the
  visitor ID only.

Backups taken before an erasure still contain the data until they expire; set backup retention
accordingly and do not restore erased data into production.
