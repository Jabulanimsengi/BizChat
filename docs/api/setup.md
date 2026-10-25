# Setup API

Configure routing from your own systems instead of the dashboard: for example, create a department
and topic when you launch a service, or put consultants into departments from your staff directory.

Create a key in **Dashboard → Integrations** with `setup:read` (reads and the classification
preview) and `setup:write` (changes). Requests use `Authorization: Bearer bzc_...` like the rest of
the integration API, share its rate limits, and only ever reach the key's own business.

The API calls the dashboard's own configuration code, so every rule is the same: names are unique
per business (`409` on a duplicate), references must belong to the business (`404`), invalid bodies
return `400 VALIDATION_ERROR`, topic changes take effect for new chats immediately, and changes to a
consultant's routing drain the queue at once. Each change is written to the audit log with no person
as the actor and the key's ID in its metadata. Creates are not idempotent by header: retry a failed
create by listing first, or rely on the name conflict.

| Method and path                        | Scope        | Body                                                                     |
| -------------------------------------- | ------------ | ------------------------------------------------------------------------ |
| GET /setup/departments                 | setup:read   |                                                                          |
| POST /setup/departments                | setup:write  | `name`, `description?`, `isDefault?`                                     |
| PATCH /setup/departments/:id           | setup:write  | any of `name`, `description`, `status`, `isDefault`                      |
| GET, POST /setup/skills                | read / write | `name`, `description?`                                                   |
| PATCH /setup/skills/:id                | setup:write  | any of `name`, `description`, `status`                                   |
| GET, POST /setup/topics                | read / write | the topic fields, including keywords, overflow steps, maximum wait       |
| PATCH /setup/topics/:id                | setup:write  | any topic field, or `status`                                             |
| POST /setup/topics/test                | setup:read   | `{ message }`; returns the classification without creating a chat        |
| GET, POST /setup/intake-forms          | read / write | `name`, `fields`, `consentText?`                                         |
| PATCH /setup/intake-forms/:id          | setup:write  | any form field, or `status`; content changes bump the version            |
| GET, PUT /setup/routing-settings       | read / write | any routing setting                                                      |
| GET, PUT /setup/business-hours         | read / write | `{ hours: [7 days of weekday, openingTime, closingTime, isClosed] }`     |
| GET /setup/consultants                 | setup:read   |                                                                          |
| PATCH /setup/consultants/:membershipId | setup:write  | any of `departmentIds`, `skills`, `maxConcurrentChats`, `routingEnabled` |

Field rules match the dashboard and are listed in `docs/architecture/intent-routing.md` (topics,
overflow, forms) and `docs/api/agent-profile.md`.

## Limits

- People are invited and removed in the dashboard. A key cannot create users or change a role,
  name, password, or account status.
- A key has administrator rights, and administrators cannot change an owner's account, so routing
  for an owner who also takes chats is set in the dashboard by an owner.
- Departments created by a key have no members until consultants are added to them.
