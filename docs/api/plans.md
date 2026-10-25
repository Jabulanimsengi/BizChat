# Plans, usage, and limits

Plans set what each business may use. They are assigned by a platform administrator; there is no
billing or payment in BizChat.

## Plans

| Limit                    | Counted as                                                     |
| ------------------------ | -------------------------------------------------------------- |
| Users (`maxConsultants`) | active memberships of any role                                 |
| Conversations per month  | conversations created in the current UTC month, by any channel |
| Integration keys         | keys that are neither revoked nor expired                      |
| Webhook endpoints        | enabled endpoints (the fixed ceiling of 5 still applies)       |

An empty limit is unlimited, and a business without a plan has no limits (every business created
before plans existed). The migration creates `free`, `starter`, and `business` plans to edit or
replace. `NEW_TENANT_PLAN_CODE` chooses the plan for new registrations (empty means none).

Conversations are counted by a database trigger, so widget, API, and any future channel are metered
the same way; reopening a conversation does not count again, and erasing or retaining data does not
reduce the count. Limits are checked before something is created and refused with
`403 PLAN_LIMIT_REACHED` (`details: { metric, limit, used }`). Keys, webhooks, and users are created
under per-tenant locks, so their limits are exact; two conversations started at the same instant can
exceed a monthly limit by one or two. Website visitors never see plan details: their first message
is refused with `CHAT_UNAVAILABLE` and a neutral message. Lowering a limit below current use blocks
new items but removes nothing.

Owners and admins see their plan and usage in **Dashboard → Settings → Plan and usage**
(`GET /api/v1/plan`).

## Platform administration

Accounts whose email is listed in `PLATFORM_ADMIN_EMAILS` (comma-separated) and verified see
**Dashboard → Platform**. Platform administration is separate from tenant roles: an owner of a
business is not a platform administrator unless listed.

| Endpoint                      | Purpose                                                               |
| ----------------------------- | --------------------------------------------------------------------- |
| `GET /platform/plans`         | plans with the number of tenants on each                              |
| `POST /platform/plans`        | create a plan (`code`, `name`, limits)                                |
| `PATCH /platform/plans/:id`   | change a plan's name or limits                                        |
| `GET /platform/tenants`       | businesses with status, plan, and usage (`search`, `limit`, `offset`) |
| `PATCH /platform/tenants/:id` | set `planId` (null removes limits) and/or `status`                    |

Suspending or cancelling a business stops its sign-ins, widgets, and integration keys immediately;
setting it back to `ACTIVE` or `TRIAL` restores them. Every tenant change is written to that
tenant's audit log, so its owners can see what the platform changed and when. Plan changes are
written to the administrator's own audit log.
