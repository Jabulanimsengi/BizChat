# Analytics API

Session-authenticated dashboard endpoints. Both require the `analytics:view` permission (owners,
admins, and supervisors) and only ever read the caller's tenant.

## Query

| Parameter      | Required | Meaning                                                                              |
| -------------- | -------- | ------------------------------------------------------------------------------------ |
| `from`, `to`   | yes      | Inclusive local dates (`YYYY-MM-DD`) in the tenant's timezone, at most 92 days apart |
| `departmentId` | no       | Only conversations currently in this department                                      |
| `topicId`      | no       | Only conversations with this topic                                                   |

Invalid ranges return `400 VALIDATION_ERROR`.

## Cohort

Every figure describes the conversations **created** in the range. A chat created on the last day and
resolved a week later still counts as resolved; widening the range never changes an older day's
creation count, but outcomes for recent days can still move.

| Figure                    | Definition                                                                   |
| ------------------------- | ---------------------------------------------------------------------------- |
| Wait for a consultant     | creation to the first assignment (topic prompts and pre-chat forms included) |
| First response            | creation to the first consultant message; internal notes excluded            |
| Handle time               | first assignment to `resolvedAt` (the latest resolution after a reopen)      |
| Abandoned                 | closed by the queue-abandonment sweep (`VISITOR_LEFT_QUEUE`)                 |
| Offer accept rate         | accepted / (accepted + declined + expired); cancelled offers are not counted |
| Visitor changed the topic | keyword-routed or confirmed chats whose visitor then chose a different topic |

Durations report the count that reached the point, the median, the 90th percentile, and the mean,
all in whole seconds; they are `null` when no conversation reached the point.

## `GET /api/v1/analytics/overview`

Returns `AnalyticsOverviewResponse`: `totals`, `daily` (every local day in the range, zero-filled),
`waitToAssignment`, `firstResponse`, `handleTime`, `offers`, `bySource`, `byTopic` and
`byDepartment` (top 20 by volume, each with its median wait), and `classification`.

## `GET /api/v1/analytics/consultants`

Returns one `ConsultantAnalyticsRow` per active consultant: chats assigned to them, chats they held
when resolved, the median first response for chats they received first, and their offer outcomes.
