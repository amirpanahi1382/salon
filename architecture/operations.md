# Operations

Production operations for the modular monolith. Not a distributed tracing platform.

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
| errorCode / safe errorType | server logs | server logs and stable outbox failure code |
| prismaCode | when a Prisma known error is mapped | — |

Never logged: passwords, JWTs, `Authorization`, cookies, request bodies, phone numbers, secrets, database URLs, or raw unexpected exception messages/stacks/causes. Error logs carry allowlisted codes and broad categories instead of connector/provider/storage text. A matched route template is logged; unmatched request paths are labeled `unmatched`.

Client error bodies retain (`statusCode`, `error`, `message`, `requestId`). Existing 4xx contracts are unchanged; unexpected 5xx and `InfrastructureError` responses use fixed text. For diagnosis, look up `requestId` or `eventId`, then use `operation`, `outcome`, status, stable `errorCode`, and worker `attempt`/`delayMs`. The code in `outbox_events.last_error` is a reason for retry or dead-letter, not a copy of an exception. `message_deliveries.failure_code` and VIP cleanup `last_error_code` likewise use stable codes. No operator UI currently displays `outbox_events.last_error`; manual replay remains an operational action after examining the code and fixing the cause. Existing historical logs and `last_error` rows are not scrubbed by this change. Their retention or remediation requires a separate review; current retention deletes old `PROCESSED` outbox rows but keeps `DEAD_LETTER` rows.
Both processes suppress Nest's raw dependency-initialization logging before their safe bootstrap handlers run. A bootstrap failure emits a fixed operation/code and exits; it does not include configuration or connector exception text.

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

Redis is **not** a readiness dependency and is **not used by application code**. MinIO is used for VIP sample-work upload/download on the API; it is still **not** part of `/health/ready` (Postgres only). A MinIO outage fails VIP image use-cases, not process liveness.

During SIGTERM/SIGINT the API marks itself draining; readiness returns 503 while in-flight requests finish.

The worker has no HTTP server. Orchestrators should treat process exit / container status as liveness.

## Shutdown

**API:** stop advertising ready → HTTP server stops accepting new connections → in-flight requests may finish up to `API_SHUTDOWN_GRACE_MS` (default 15s) → Prisma disconnects. If close hangs past the grace period, the process exits 1.

**Worker:** stop the poll timer → do not claim new outbox rows → finish the in-flight claimed batch → Prisma disconnects.

## Outbox

Delivery is **at-least-once**, not exactly-once. Consumers must be idempotent.

- Claim: `FOR UPDATE SKIP LOCKED` + lease (`OUTBOX_LEASE_MS`, default 30s).
- Handler timeout is 80% of the lease so a stuck handler fails before another worker reclaims the row. No heartbeat. Bale send must finish (or abort) within that budget; other event types are no-ops.
- Retry: full jitter backoff, then `DEAD_LETTER` at `OUTBOX_MAX_ATTEMPTS`.
- Unknown `eventType` values are **dead-lettered immediately** with `UNKNOWN_EVENT_TYPE`. They are never marked processed. Replay after deploying a handler.
- Crash after a side effect and before `PROCESSED` will retry (duplicate delivery).

Processed events older than `OUTBOX_PROCESSED_RETENTION_DAYS` (default 14) are deleted in batches (`RETENTION_CLEANUP_BATCH_SIZE`). `DEAD_LETTER` rows are not deleted. Idempotency rows older than `IDEMPOTENCY_RETENTION_DAYS` (default 7) are deleted the same way. That 7-day window is the duplicate `Idempotency-Key` guarantee.

## VIP sample-work recovery

The API commits upload intent before PUT and never holds a PostgreSQL transaction or row lock during MinIO I/O. `UPLOADING` reserves one of three positions. Its generation, owner token, and lease fence finalization; expiration changes an otherwise eligible intent to `RETRYABLE`, or to `ABANDONED` when its request is no longer eligible, and releases the position. A client resumes `RETRYABLE` by sending the bytes again. The worker runs this bounded recovery every `VIP_UPLOAD_RECOVERY_INTERVAL_MS` (default 30s), at most `VIP_UPLOAD_RECOVERY_BATCH_SIZE` rows (default 50) per pass.

Every obsolete generation creates or re-arms one cleanup tombstone. Cleanup is first attempted after the upload lease and `MINIO_REQUEST_TIMEOUT_MS`; that delay is scheduling protection, not proof that a timed-out PUT failed. A successful early DELETE is durably rescheduled for a mandatory final DELETE at `settleUntil`. The cleanup becomes `PROCESSED` only after a successful DELETE at or after that horizon. This discovers a PUT that finishes after an early DELETE even when the API process died and never ran a finalizer. `VIP_UPLOAD_CLEANUP_SETTLE_MS` defaults to one hour and must exceed the deployed object store/proxy's maximum time to finish or discard an accepted PUT; without that bounded-lifetime assumption, no finite client-side horizon can prove that a future write is impossible.

Before rollout, operators must establish that bound from the configured request/body/idle timeouts of every ingress, load balancer, S3-compatible gateway, and object-store component that can continue an accepted PUT, including any multipart-abort policy. Use the largest remaining lifetime, add operational margin, set `VIP_UPLOAD_CLEANUP_SETTLE_MS` above it, and verify the setting with a delayed-PUT fault test through the deployed path. The client `MINIO_REQUEST_TIMEOUT_MS` is not evidence for this server-side bound, and the one-hour default is not proof that a target is suitable. If the complete path has no documented finite bound, deployment must not claim guaranteed eventual cleanup under this strategy.

The worker claims cleanup with `FOR UPDATE SKIP LOCKED`, performs bounded DELETE outside the transaction, and writes retry/reschedule/terminal state only with the current claim generation/token and cleanup request generation. A live delayed finalizer also increments the request generation, so an in-flight cleanup cannot become terminal. DELETE timeout has an ambiguous outcome and returns the tombstone to `PENDING`; deletion is idempotently retried. A key referenced by `vip_sample_works` is excluded and rechecked before DELETE. There is no deletion policy for legitimate images.

`AVAILABLE` means an exact digest/type/length read succeeded at `verifiedAt`. Submit verifies every sample immediately before its database transition and confirms the metadata set under the request lock. MinIO and PostgreSQL still have no cross-store transaction: bytes can disappear after verification. Download verifies again. Alert on repeated `vip_sample_work_recovery.tick` failures and growing non-`PROCESSED` cleanup counts.

Legacy replay checks a pre-intent idempotency record's scoped committed sample and object bytes; it never backfills an upload intent or treats migration as storage verification. Failed historical reads return an infrastructure error and do not refresh `verifiedAt`. Submission takes its deadline decision after object reads under the request lock; failed expiry decisions roll back the idempotency claim and success audit/outbox. Operators must still validate historical objects in the target bucket separately from these disposable tests.

Deployment order is migration, worker, then API. The migration adds nullable `verified_at` without backfilling history and creates lifecycle/cleanup tables; it does not contact MinIO. Deploy the recovery-capable worker before accepting new lifecycle uploads. API credentials require bucket GetObject/PutObject; worker credentials require DeleteObject and GetObject only for the configured VIP bucket/prefix. Confirm the actual S3-compatible service gives read-after-write consistency. Inspect bucket versioning and lifecycle policy: automatic lifecycle deletion must not target committed `vip/` images. If versioning is enabled, a normal DELETE may create a delete marker while retaining noncurrent bytes; either account for those retained versions operationally or provide narrowly scoped version cleanup before calling physical-byte cleanup complete.

Legacy orphan inventory is deliberately non-destructive. Export committed `vip_sample_works.object_key` values and durable upload/cleanup keys from PostgreSQL, obtain a read-only bucket object/version listing with size and modification time, and compare offline. Treat bucket-only keys that predate durable intents as ambiguous; review them individually and do not feed them into automatic cleanup. A migration or matching path shape does not verify a historical object.

## Timeouts

- Outbound HTTP helper `fetchWithTimeout` uses `HTTP_TIMEOUT_MS` (default 5s). No automatic retries.
- Worker outbound HTTP: Bale Safir send (`BALE_SAFIR_TIMEOUT_MS`, default 10s) when a BALE delivery is activated. VIP Bale is not implemented.
- S3-compatible requests use `MINIO_REQUEST_TIMEOUT_MS` (default 10s). A timeout is an unknown outcome, so ownership remains recoverable rather than declaring the PUT absent.
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
