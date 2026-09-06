# Operations (Phase B)

Production-candidate operations for the modular monolith. Not a distributed tracing platform.

## Logging

JSON logs via Pino (pretty-printed only in `NODE_ENV=development`).

Common fields:

| Field | API | Worker |
| --- | --- | --- |
| timestamp | yes (pino) | yes (pino) |
| level | yes | yes |
| service | `api` | `worker` |
| environment | `NODE_ENV` | `NODE_ENV` |
| requestId | yes | — |
| correlationId | yes | — |
| method / route / statusCode / durationMs | yes | — |
| tenantId / userId | authenticated JWT context only | tenantId from outbox row |
| operation | Nest handler name | `outbox.consume` / `outbox.poll` |
| eventId / eventType / attempt / outcome | — | yes |
| errorCode / errorType / stack | server logs | server logs |
| prismaCode | when a Prisma known error is mapped | — |

Never logged: passwords, JWTs, `Authorization`, cookies, request bodies, phone numbers, secrets, database URLs.

Client error bodies stay stable (`statusCode`, `error`, `message`, `requestId`). Diagnostics stay in server logs.

## Request / correlation IDs

- `x-request-id` and `x-correlation-id` are accepted only when they are UUID-shaped.
- Unsafe or missing values are replaced with a generated UUID.
- If correlation is omitted, it equals the request ID.
- Both values are echoed on the response.
- Tenant identity is never taken from headers or bodies; it comes from JWT → database user lookup.

The Flutter client sends a generated UUID v4 on each request (`x-request-id` / `x-correlation-id`). Timeouts: connect 12s, receive 20s, Excel upload 90s.

No AsyncLocalStorage: request fields ride on the Express request / Pino `customProps`.

## Health

| Endpoint | Meaning | Dependencies | Success | Failure |
| --- | --- | --- | --- | --- |
| `GET /health` | Liveness: process is up | none | 200 `{ status: "ok" }` | process not running |
| `GET /health/ready` | Ready to serve API traffic | PostgreSQL; not draining | 200 `{ status: "ok", checks.postgres: "up" }` | 503 |

Redis and MinIO are **not** readiness dependencies. They are not used on the request path today. Constructing a client is not a health check.

During SIGTERM/SIGINT the API marks itself draining; readiness returns 503 while in-flight requests finish.

The worker has no HTTP server. Orchestrators should treat process exit / container status as liveness.

## Shutdown

**API:** stop advertising ready → HTTP server stops accepting new connections → in-flight requests may finish up to `API_SHUTDOWN_GRACE_MS` (default 15s) → Prisma disconnects. If close hangs past the grace period, the process exits 1.

**Worker:** stop the poll timer → do not claim new outbox rows → finish the in-flight claimed batch → Prisma disconnects.

## Outbox

Delivery is **at-least-once**, not exactly-once. Consumers must be idempotent.

- Claim: `FOR UPDATE SKIP LOCKED` + lease (`OUTBOX_LEASE_MS`, default 30s).
- Handler timeout is 80% of the lease so a stuck handler fails before another worker reclaims the row. No heartbeat: current handlers are no-ops and must stay faster than the lease.
- Retry: full jitter backoff, then `DEAD_LETTER` at `OUTBOX_MAX_ATTEMPTS`.
- Unknown `eventType` values are **dead-lettered immediately** with `UNKNOWN_EVENT_TYPE`. They are never marked processed. Replay after deploying a handler.
- Crash after a side effect and before `PROCESSED` will retry (duplicate delivery).

## Timeouts

- Outbound HTTP helper `fetchWithTimeout` uses `HTTP_TIMEOUT_MS` (default 5s). No automatic retries.
- There are no production outbound HTTP calls in this phase.
- PostgreSQL readiness uses `HEALTH_CHECK_TIMEOUT_MS` (default 2s).
- Inbound HTTP socket idle timeout is 120s (Excel import client timeout is 90s).

## Database pool

Prisma pool size is **per process**. Set `DATABASE_CONNECTION_LIMIT` explicitly in production. `DATABASE_POOL_TIMEOUT_SECONDS` defaults to 10.

Principle: `(API_replicas × API_pool) + worker_pool` must stay safely below `postgres.max_connections` (typically 100 on local Postgres 16).

| Deployment | Suggested starting point (unset still uses Prisma defaults) |
| --- | --- |
| Local (1 API + 1 worker) | `DATABASE_CONNECTION_LIMIT=10` (≈20 connections total) |
| Single production API + 1 worker | API 10–15, worker 5 (use separate process env if you need different sizes) |
| N API replicas + 1 worker | keep total under ~70% of `max_connections` |

Do not raise pool size without measuring. Same `DATABASE_URL` in API and worker means each process opens its own pool.

## Swagger

- Development/test: `/docs` enabled unless `SWAGGER_ENABLED=false`.
- Production: disabled unless `SWAGGER_ENABLED=true`.

## Throttling

`@nestjs/throttler` is **in-memory per process**. Login/register have tighter limits.

- Single API instance: counters are correct for that process.
- Multiple API replicas: limits are **not** globally consistent. Redis-backed throttling is deferred until multi-instance deployment is an actual requirement. Redis failure must not silently disable brute-force protection; that is why Redis is not in the path today.

## Metrics

`GET /metrics` (Prometheus text, unauthenticated, skip throttle).

- `http_requests_total{method,route,status}` — route templates only (`/customers/:id`), never customer/user/request IDs.
- `http_request_duration_ms` histogram (same labels minus status).
- `outbox_events{status}` gauges from PostgreSQL (bounded enum). If the database is down, HTTP metrics still scrape.

Keep `/metrics` off the public internet (bind to a private network or scrape from the same host).

## Error taxonomy (client `error` field)

`VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `BUSINESS_RULE`, `INFRASTRUCTURE_ERROR` (503), `INTERNAL_ERROR` (unexpected; no internals in the body).
