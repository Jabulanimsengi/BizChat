# High availability

BizChat's API is designed to run as several identical replicas. This document describes what each
component needs, the reference deployment in `docker-compose.ha.yml`, and how the system behaves
when a part fails.

## Why replicas are safe

| Concern                                  | How it is handled                                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Durable state                            | PostgreSQL only: conversations, offers, queue, intake, retention, usage, webhooks outbox                 |
| Realtime fan-out                         | Socket.IO Redis adapter; any replica can serve any socket                                                |
| Background work (reliability, retention) | one leader per job through renewable Redis leases (`reliability:sweep:leader`, `retention:sweep:leader`) |
| Queue drains                             | a per-tenant Redis lock coalesces drains; conditional PostgreSQL claims keep a duplicate drain harmless  |
| Assignment and offers                    | conditional updates and advisory locks: exactly one replica wins a claim, accept, or expiry              |
| Webhook delivery                         | leased batches in the transactional outbox; a replica that dies mid-batch releases its lease by expiry   |
| Integration retries                      | idempotency records in PostgreSQL, so a retry routed to another replica replays the stored response      |
| Presence                                 | Redis keys with TTLs refreshed by heartbeats; a consultant on a lost replica reconnects to another       |
| Attachments                              | S3-compatible object storage; each replica stages uploads in its own temporary directory                 |

## Reference deployment

```bash
docker compose -f docker-compose.production.yml -f docker-compose.ha.yml up -d --wait
```

The overlay scales the API to `API_REPLICAS` (default 2) and puts `infra/nginx/api-lb.conf`
(nginx 1.28) on `127.0.0.1:4000`, where the single API used to be, so the edge proxy and dashboard
configuration do not change.

- HTTP is balanced by least connections. A replica that fails twice is skipped for 10 seconds;
  only requests that cannot have changed anything (connection errors, 502, 503) are retried on
  another replica.
- `/socket.io/` is balanced by client address. The dashboard and widget use WebSocket only, so any
  replica would do, but Socket.IO still accepts long-polling, whose requests must reach one replica.
- nginx re-resolves the `api` service name every 10 seconds, so replicas can be scaled, restarted,
  or replaced without reloading the balancer.
- `/api/v1/metrics` is not served through the balancer; scrape each replica on the internal
  network.
- `TRUSTED_PROXIES` on the replicas becomes your edge addresses plus `HA_LB_SUBNET` (default
  `172.16.0.0/12`, Docker's private range), so client IPs survive both hops. Narrow
  `HA_LB_SUBNET` to the Compose network's subnet in production.

### What the overlay does not make highly available

PostgreSQL, Redis, MinIO, and ClamAV in the production file are single containers on one host. For
real high availability:

- **PostgreSQL:** a managed service with synchronous standby and automatic failover (or Patroni).
  Point `DATABASE_URL` at the failover endpoint. The API reconnects; requests during the switchover
  fail and are retried by clients (idempotency keys make integration retries safe).
- **Redis:** a managed service with automatic failover. During an outage, presence and typing
  indicators cannot be updated, sweeps pause (by design, so nobody is reassigned on unknown
  presence), rate limiting fails closed, and queue drains fall back to uncoordinated but safe
  claims. Everything resumes when Redis returns; presence is rebuilt from heartbeats.
- **Object storage:** managed S3 (or replicated MinIO). Set `S3_ALLOW_INSECURE=false` for HTTPS
  endpoints.
- **ClamAV:** run two instances behind a service address, or accept that uploads fail while the
  scanner restarts (uploads are rejected rather than stored unscanned).
- **Hosts:** run replicas on at least two hosts or availability zones (Kubernetes or Swarm with the
  same images and environment); a single Docker host remains a single point of failure.

## Failure behaviour

| Failure                | What users see                                                                                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One API replica stops  | Its sockets reconnect to another replica within seconds; visitors resume their conversation and missed messages are recovered by sequence number. A consultant who does not return within the disconnect grace period has their chats reassigned. |
| Sweep leader stops     | Another replica takes the lease after it expires (3 sweep intervals, minimum 15 s; retention after 2 hours at the default interval).                                                                                                              |
| Load balancer restarts | All sockets reconnect; no state is lost. Run two balancers behind the edge (or a managed load balancer) to avoid the gap.                                                                                                                         |
| PostgreSQL failover    | Requests fail for the switchover; the API reconnects automatically.                                                                                                                                                                               |
| Redis outage           | Described above; the API keeps serving REST and existing data.                                                                                                                                                                                    |

## Verification

`tools/ha-failover-smoke.mjs` runs at the end of `npm run e2e` when Docker is available. It starts two
API nodes and nginx with this exact `api-lb.conf` (only the upstream lines changed, to the host's
IPv4 gateway address), connects a consultant and a visitor through the balancer, kills one node,
and checks that HTTP, the signed-in session, both sockets, conversation resume, and message delivery
continue on the remaining node. Run it alone with `E2E_ONLY=ha-failover-smoke.mjs npm run e2e`. The
cross-replica fan-out, missed-message recovery, grace-period reassignment, and queue reconstruction
are covered by `tools/phase7-smoke.mjs` on two nodes.

Writing the first version of this test showed why upstreams must resolve to IPv4 only: on Docker
Desktop the host gateway also has an unreachable IPv6 address, which nginx treated as extra peers,
so a request's two attempts could both fail with 502. The production configuration's resolver sets
`ipv6=off` for the same reason; keep it if you change the resolver.

The configuration passes `nginx -t` on nginx 1.28, and the merged
`docker-compose.production.yml` + `docker-compose.ha.yml` passes `docker compose config`. The full
stack (built images, scaled replicas, DNS re-resolution) has not been started end to end in this
repository's test runs; do so in staging before relying on it.
