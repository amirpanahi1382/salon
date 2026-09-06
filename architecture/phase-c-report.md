# Phase C Performance & Scale Report

## 1. Executive Summary

Phase C measured a 3,000-customer / 15,000-visit salon on PostgreSQL 16, then applied only changes justified by those measurements (or by a clear product gap: no way to read past the first 200 list rows).

Window-over-tenant visits (no join to a LIMIT customer CTE): **~26–31ms p50**. A joined CTE that limited customers first was **1.6–3.8s** and was rejected. The API uses the fast window query plus a separate customer identity query.

## 2. Initial Architecture Assessment

Modular monolith: NestJS API + worker, Prisma 6.4.1, PostgreSQL 16. Tenant scoping via JWT. Lists already used `take: 201` (not OFFSET). Intelligence loaded all visit dates for up to 5,000 customers via Prisma `IN (...)`.

## 3. Baseline Measurements

**MEASURED** (`pnpm perf:bench`, 2026-09-06T09:12Z, after indexes). Times in ms unless noted.

| Workload | p50 | p95 | Notes |
| --- | --- | --- | --- |
| Customer list take 201 | 4.2 | 5.6 | Index Only Scan `customers_salon_id_created_at_id_idx`; EXPLAIN 0.11ms |
| Customer search ILIKE | 5.8 | 11.8 | Seq Scan + filter, EXPLAIN 1.6ms |
| Customer getById | 1.9 | 2.0 | |
| Visit history / salon list | 5.4 / 3.6 | 6.4 / 4.2 | Visit list Index Scan `visits_salon_id_visited_at_idx` |
| OFFSET skip 0 / 100 / 1000 / 2950 | 2.3 / 2.4 / 2.3 / 2.2 | | No cliff at this size |
| Cursor first 20 pages mean | 3.4 | 19.3 | Similar to offset here |
| Intelligence Prisma load-all visits | 155 | 200 | 15,000 visit rows into Node |
| Intelligence SQL window+group | 29.4 | 32.0 | **chosen** |
| SQL GROUP BY count only | 10.6 | 14.1 | |
| CTE join customers (unstable) | 48 | 3355 | **rejected** (p99 spike) |
| Intelligence visit EXPLAIN | | | Seq Scan 4.7ms DB; ORM transfer dominated |
| Outbox claim EXPLAIN | | | Index Scan `outbox_events_claimable_created_at_idx`, 0.43ms |

Seed 3k/15k: 4.0s. Node RSS after bench 163MB (heap 41MB).

## 4. Bottlenecks Found

1. Salon intelligence transferred every visit row through Prisma (`IN` 3,000 UUIDs) — **FIXED**.
2. Outbox claim seq-scanned `outbox_events` — **IMPROVED** (partial index).
3. Lists could not page beyond 200 — **FIXED** (cursor; not because offset was slow at 3k).
4. Processed outbox/idempotency unbounded growth — **FIXED** (batched retention).
5. ILIKE filter over the tenant — **DEFERRED** (`pg_trgm`); Seq Scan 1.6ms at ~3k customers (GREEN).

## 5. Database Query Analysis

See `architecture/performance.md` and bench EXPLAIN output. Customer/visit first pages were already index scans (GREEN).

## 6. Pagination Changes

**FIXED** (product). `items` + `hasMore` unchanged. Added `nextCursor`. Flutter reads `ItemPage` and still works when `nextCursor` is null.

## 7. Customer Search Changes

**DEFERRED.** MEASURED ~6ms p50 / 1.6ms EXPLAIN Seq Scan. PROJECTED: still acceptable near 5k customers/salon. Revisit trigram if a tenant is much larger.

## 8. Intelligence Optimization

**IMPROVED.** The API loads newest 5,000 customer identities, then one tenant-scoped window/`GROUP BY` over visits (~30ms MEASURED). A joined “limit customers then window” CTE was 1.6–3.8s and is not used. Shared `RuleBasedRetentionAnalyzer` unchanged. Equivalence spec compares SQL vs `deriveCustomerBehavior` including same-day visits.

## 9. Excel Import Optimization

**ACCEPTED** existing sync path (row/file/ZIP limits, parse outside TX, chunked writes, 20s TX timeout). No async job — 5k rows is the supported max.

## 10. Outbox Growth Strategy

**FIXED.** Delete `PROCESSED` older than 14 days in batches of 1,000. Keep `DEAD_LETTER`. Partial index on claimable rows.

## 11. Idempotency Retention

**FIXED.** Delete records older than **7 days** (documented guarantee window). Batched.

## 12. Connection Pool Findings

**ACCEPTED.** `DATABASE_CONNECTION_LIMIT` per process. Do not inflate the pool to chase throughput. Recommend API 10 + worker 5 as a starting production point (not load-tested to saturation here).

## 13. Transaction Duration Findings

Import TX still bounded at 20s; parse is outside. Visit/customer writes unchanged. **ACCEPTED.**

## 14. Load Test Methodology

`apps/api/perf/load.ts` — opt-in `RUN_LOAD=true`. Not part of `pnpm test`. Covers Tests A–H (unique creates, duplicate phone, visits, visit idempotency, delete vs visit, list-during-write, concurrent intelligence, concurrent 100-row imports).

## 15. Load Test Results

**MEASURED** against a running Nest API on localhost (empty-ish salon, not the 15k-visit bench salon), 2026-09-06.

| Test | Result |
| --- | --- |
| GET /customers (20) | p50 15ms, p95 35ms, errors 0 |
| GET /intelligence/summary (20) | p50 16ms, p95 36ms, errors 0 |
| A unique concurrent create ×25 | 25 created, 170ms wall, errorRate 0 |
| B same phone ×8 | **exactly one** 201, seven 409 |
| C concurrent visits ×8 | 8 created, 49ms wall |
| D same Idempotency-Key ×4 | four 201, **one** visit id |
| E delete vs visit create | 201 + 204, no 500 |
| F list during writes | p50 15ms, p95 32ms |
| G concurrent intelligence ×12 | p50 46ms, p95 51ms, errors 0 |
| H 3 salons × 100-row import | all HTTP 200, 246ms wall |
| Client RSS | 90MB → 98MB |

Saturation of `max_connections` / pool wait: **DEFERRED** (not measured to failure).

## 16. Before / After Comparison

### Customers
Before: first 200 only, `created_at` order. After: same plus `nextCursor` / `id` tie-break. Latency unchanged (GREEN).

### Visits
Before: first 200. After: cursor + stable tie-break. GREEN.

### Intelligence
Before: ~155–185ms p50 loading 15k dates. After: ~29ms SQL window aggregates (MEASURED). App uses the SQL path.

### Import
Unchanged (ACCEPTED).

### Pagination
Offset vs cursor similar at 3k (MEASURED). Cursor added for scale (PROJECTED OFFSET cost).

### Database
New indexes: customers `(salon_id, created_at, id)`, outbox `processed_at`, partial claimable `created_at`.

### Load
A–H concurrency script **MEASURED** (GREEN on this machine). Pool saturation **DEFERRED**.

## 17. Flutter Impact

Repositories parse `ItemPage` (`items`, `hasMore`, `nextCursor`). First page still drives Dashboard/Customers/Opportunities. No UI redesign.

## 18. Security / Tenant Isolation Verification

SQL aggregates filter `salon_id` on both `customers` and `visits`. Cursors carry timestamps/ids only, always combined with tenant predicates. Retention deletes are global operational tables, not cross-tenant reads.

## 19. Regression Results

| Check | Result |
| --- | --- |
| `pnpm test` | pass (config/shared/database/api/worker; intelligence SQL equivalence included) |
| `pnpm test:e2e` | 8 suites, 36 tests pass |
| `pnpm --filter @salon/api exec tsc --noEmit` | pass |
| `pnpm build` | pass |
| `flutter analyze` | no issues |
| `flutter test` | 39 pass |
| `flutter build web` | pass |
| `flutter build windows` | not re-run; previously failed without Developer Mode / directory junctions |
| `pnpm perf:bench` | pass (see §3) |
| `RUN_LOAD=true pnpm perf:load` | pass (see §15) |

Phase A/B behaviors covered by existing e2e: auth, salon users/RBAC, customers, deletion races, visits, visit delete, Excel import, intelligence, idempotency, tenant isolation.

## 20. Files Changed

API intelligence SQL, list cursors, worker retention, Prisma migration, Flutter `ItemPage`, `apps/api/perf/bench.ts` + `load.ts`, this report, `architecture/performance.md`.

## 21. Database Migrations

`packages/database/prisma/migrations/20260906140000_phase_c_scale_indexes/`

On huge production heaps, use concurrent index builds instead of a blocking transaction.

## 22. Remaining Risks

| ID | Risk |
| --- | --- |
| P1 | Very large single-tenant visit histories still run a window function per intelligence request (26ms at 15k visits; PROJECTED slower at 500k). |
| P2 | Connection-pool saturation not measured under multi-replica load. |
| P2 | Opportunity/segment paging is in-memory after a 5k-customer scan. |
| P3 | Search ILIKE will degrade if one salon has far more than ~5k customers. |

## 23. Deferred Items

- `pg_trgm` / Elasticsearch
- Async Excel import / new queues
- Kafka, Redis-backed search, microservices
- Raising Node heap
- Offline Flutter cache

## 24. Production Scale Assessment

### 100 salons (Level 1)
**MEASURED** pattern at one 3k/15k salon is comfortable. **PROJECTED:** 100 such salons is fine on one PG + API if connection limits stay modest.

### 1,000 salons (Level 2)
~1,000 customers/salon average. **PROJECTED:** lists/search GREEN; watch outbox volume and pool size. Next bottleneck: connection count × replicas, then outbox claim if events are not retained/cleaned.

### 10,000 salons (Level 3)
**PROJECTED:** still a modular monolith if tenants stay near the 5k intelligence cap. Limits: PG CPU for window aggregates on oversized tenants, `max_connections`, single-region PG. Not a reason to split microservices from this dataset.

GREEN / YELLOW / RED (this hardware, 3k/15k salon): lists GREEN, search GREEN, intelligence after SQL GREEN, import ACCEPTED/YELLOW at 5k rows, outbox claim YELLOW until partial index + cleanup.
