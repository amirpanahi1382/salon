# Architecture

**Status:** Current modular monolith  
**Not:** a target architecture for marketplace, Kafka, or microservices

---

## 1. Style

One product, **two NestJS deployables** plus a Flutter client:

| Process | Path | Responsibility |
| --- | --- | --- |
| HTTP API | `apps/api` | Auth, validation, use-cases, Prisma writes, audit+outbox in the same DB transaction |
| Worker | `apps/worker` | Claim outbox (`FOR UPDATE SKIP LOCKED`), Bale send, retention, VIP upload recovery and abandoned-object cleanup |
| Flutter | `apps/mobile` | Persian/Jalali salon + platform-admin UI |
| Shared | `packages/shared`, `packages/database`, `packages/config` | Rules, Prisma, env |

Do not merge API and worker into one HTTP process. Do not split domains into microservices.

Internal API layout is use-case modules (`auth`, `salon`, `user`, `customer`, `visit`, `service`, `transaction`, `intelligence`, `action`, `messaging`, `vip`) plus `infrastructure/*`.

---

## 2. Runtime diagram

```text
                    Flutter (Bearer JWT)
                            │
                            ▼
                 NestJS API :3000
                   Helmet, ValidationPipe, Throttler (in-memory),
                   Pino, Prometheus /metrics, Swagger (non-prod)
                            │
              JWT → DB user/admin lookup → principal
                            │
                            ▼
                 PostgreSQL 16 + Prisma 6.4.1
                   domain rows + audit_logs + outbox_events
                   + idempotency_records
                            │
          same transaction as the business write
                            │
                            ▼
                 Worker polls outbox
                   known no-op events → PROCESSED
                   MessageDeliveryActivated / MessageSendRequested
                     → BaleSafirMessageSender (abortable HTTP)
                            │
                            ▼
                 MinIO (VIP sample-work bytes only)

Redis: Compose + REDIS_URL required; no app client.
```

---

## 3. Auth and tenant model

- Salon users: Argon2id password, JWT `sub` + `tid` + `role`. Default expiry 8h. No refresh token.
- Platform admins: separate table and `POST /admin/auth/login`; JWT `scp=platform`, **no** `tid`.
- Every salon request loads the user from DB (status, salon status, current role). Token `role` is not the authorization source after login.
- Guards: `JwtAuthGuard`, `RolesGuard`, `PlatformAdminGuard`.
- Tenant on writes always `principal.tenantId`.

---

## 4. Transaction boundaries

Typical mutating use-case:

1. Optional `Idempotency-Key` fingerprint
2. `prisma.$transaction`:
   - row locks / unique inserts as required
   - domain persist
   - `audit_logs` insert (no PII bodies)
   - `outbox_events` insert
3. Map HTTP result

VIP sample upload is an explicit cross-store lifecycle; PostgreSQL and MinIO are not atomic. The API first commits a `VipSampleWorkUpload` intent and reserves one of the request's three positions. It then performs PUT and read-back verification without an open database transaction, and conditionally creates `VipSampleWork` only while it still owns the same generation/token. Retries use generation-specific object keys. A stale finalizer can only re-arm cleanup for its own uncommitted generation.

The worker releases expired upload leases in bounded batches and retries deletion through `VipSampleWorkCleanup`. Cleanup claims carry both a claim generation and the cleanup request generation. A durable settlement horizon requires a final successful DELETE after the configured maximum PUT lifetime, so process exit does not make recovery depend on a finalizer. Cleanup excludes any key referenced by committed `VipSampleWork`; submitted, historical, committed, or ambiguously owned objects are never automatic deletion targets. The client must resend bytes to resume a `RETRYABLE` intent; the worker never invents or stores upload bodies.

---

## 5. Outbox, retries, dead-letter

- At-least-once. Lease `OUTBOX_LEASE_MS` (30s). Handler timeout 80% of lease.
- Retry with full jitter until `OUTBOX_MAX_ATTEMPTS` (8), then `DEAD_LETTER`.
- Unknown `eventType` → immediate dead-letter (`UNKNOWN_EVENT_TYPE`).
- **Side-effect consumer today:** Bale activation events only. Other `DOMAIN_EVENT_TYPES` are acknowledged no-ops (future extension points, not a bus).
- `DEAD_LETTER` is kept. `PROCESSED` deleted after `OUTBOX_PROCESSED_RETENTION_DAYS` (14).

---

## 6. Storage and config

- PostgreSQL is the system of record.
- MinIO/S3-compatible: VIP images through `@salon/object-storage`, used by API upload/read and the worker's narrowly scoped abandoned-attempt cleanup.
- Env via `@salon/config` Zod schema. Names in `.env.example`. Never document secret values.
- Bale credentials are **platform env**, not per-salon secrets.

---

## 7. Observability and failure

See `architecture/operations.md` (logs, health, shutdown, metrics, throttle).

Failure model:

- Provider down: MessageRequest still queues; admin Bale select may fail later; worker retries BALE deliveries.
- API drain: readiness 503; in-flight up to `API_SHUTDOWN_GRACE_MS`.
- Worker drain: stop claiming; finish in-flight batch.

---

## 8. Deployment assumptions

- Single-region modular monolith.
- API replicas possible; throttle counters are **per process** (Redis throttle deferred).
- Each process has its own Prisma pool (`DATABASE_CONNECTION_LIMIT`).
- Worker is required in any environment that must send Bale, reclaim outbox/idempotency, or release/reconcile abandoned VIP uploads.
- Flutter talks HTTPS in production; local Android emulator uses `http://10.0.2.2:3000` unless `API_BASE_URL` is set.

---

## 9. What this architecture is not

- Not event sourcing / CQRS
- Not Kafka
- Not RLS (yet)
- Not a billing system
- Not a second messaging queue for VIP
