# BizChat

BizChat is a multi-tenant, real-time business communication platform. This TypeScript monorepo
contains the NestJS API, Next.js dashboard, embeddable widget, and shared contracts.

## Local quick start

1. Copy `.env.example` to `.env` and replace `SESSION_SECRET`.
2. Run `npm install`.
3. Run `npm run infra:up`.
4. Run `npm run db:generate` and `npm run db:migrate`.
5. Run `npm run dev`.

The dashboard runs on `http://localhost:3000`, the API on `http://localhost:4000`, and the widget
sandbox on `http://localhost:4173`.

Password reset and verification emails are written to the structured API log in development because
`SMTP_HOST` is empty. Set the `SMTP_*` variables to deliver real email.

## Quality checks

- `npm run check` - format check, lint, typecheck, unit tests, and production builds.
- `npm run test:cov` - API unit tests with the coverage gate.
- `npm run test:stack:up && npm run test:http && npm run e2e && npm run test:stack:down` - real-stack
  HTTP integration and end-to-end smoke suites against PostgreSQL, Redis, MinIO, and ClamAV.

See `docs/implementation-status.md` for current scope and
`docs/architecture/bizchat-architecture.md` for the system design. Production hardening controls are
documented in `docs/architecture/hardening.md`.

Production operators should follow `docs/production-runbook.md` and use
`docker-compose.production.yml` as the single-host reference topology.

## Website integrations

Use **Dashboard → Websites** to verify a domain and copy the chat embed snippet. Use
**Dashboard → Integrations** to create scoped API keys, rotate/revoke them, subscribe to signed
webhooks, and inspect/replay failed deliveries.

The server-to-server API is under `/api/v1/integrations`; its OpenAPI specification is available at
`/api/v1/integrations/openapi.json`. See [integration documentation](docs/api/integrations.md) for
JavaScript/PHP/curl examples, customer identification, webhook verification, and deployment steps.
Apply migrations before running the new API. The HTTP test suite now includes integration contract,
tenant isolation, idempotency, identity, and transactional webhook tests against PostgreSQL and Redis.
