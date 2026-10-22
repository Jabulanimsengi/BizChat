# Widget HTTP API

## `POST /api/v1/widget/bootstrap`

The browser `Origin` header is mandatory. The origin must exactly match a verified domain belonging
to the supplied safe public business identifier.

Request:

```json
{
  "businessPublicId": "pub_example",
  "visitorToken": "optional returning-browser token"
}
```

The response contains public branding, the persistent browser visitor token, and a separate
short-lived widget-session token. It never exposes visitor, session, membership, or business
database IDs. The short-lived token is used only for `/widget` Socket.IO authentication.

Expected security failures include `ORIGIN_REQUIRED`, `ORIGIN_NOT_ALLOWED`, `WIDGET_DISABLED`, and
`WIDGET_NOT_FOUND`. Error responses use the standard API error envelope and request ID.
