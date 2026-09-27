# Performance and scale

Dated measurements (2026-09-06) used a disposable salon of **3,000 customers / 15,000 visits** (`pnpm perf:bench`). HTTP load: `RUN_LOAD=true pnpm perf:load` against a running API. Those numbers are historical evidence, not a live SLA.

## Pagination

List endpoints remain bounded (max 200). They now return `nextCursor` when `hasMore` is true.

- Customers: `(created_at DESC, id DESC)`
- Visits: `(visited_at DESC, created_at DESC, id DESC)`
- Intelligence opportunities / segments: global SQL rank over tenant-scoped last visits, then visit-gap aggregation only for the selected 500-candidate batch; bounded transfers, with an eligible-result lookahead (max 200 response items)

Offset `skip` at 0 / 100 / 1,000 / 2,950 was ~2–4ms on this dataset (no material difference vs cursor). Cursor is still the supported way to read past the first page so we never `OFFSET` at 10k+ later.

## Intelligence

Visit timestamps are **not** loaded into Node for salon-wide intelligence. PostgreSQL computes visit count, first/last visit, and average positive whole-day gaps. Classification rules in `@salon/shared` are unchanged.

The former 5,000-customer truncation is removed. Summary scans the indexed customer creation order in 500-customer batches and aggregates only those customers' visits, revenue, and suppression state per batch. It performs one salon revenue-total query plus up to three queries per batch and one terminal customer probe. Ranked list queries compute global days-since-last-visit order in PostgreSQL and transfer at most 500 candidate rows per batch; filtered lists may scan several batches before finding 201 eligible results. The Phase 7 change moves the visit-gap window from the entire salon to the selected candidate batch. Every ranked batch still recomputes the tenant-wide last-visit rank and sorts eligible customers, and live cursor pages do not share a database snapshot. No customer/visit fetch-all, cache, snapshot, or new index was added.

Phase 7 diagnostic (2026-09-27): disposable PostgreSQL 16, synthetic salons of 5,201 / 20,000 / 50,000 customers on the same database, deterministic IDs, `ANALYZE` after seeding. The fixture includes no-visit, repeated-visit, tied-rank, sparse-match, suppressed, COMPLETED/VOIDED revenue, and other-tenant rows. Values below are **use-case** wall-time medians in milliseconds, one warmup plus three measured runs per variant; old and revised SQL were run against identical populated fixtures. They are not HTTP latency, production p95, or an SLA.

| Customers | Summary old → new | Segment first / deeper old → new | Sparse CUSTOMER_RETURN first old → new | Full opportunities traversal old → new | Per customer old → new |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 5,201 | 78 → 80 | 6 / 7 → 5 / 6 | 68 → 50 | 144 → 101 | 2 → 1 |
| 20,000 | 404 → 407 | 22 / 26 → 14 / 18 | 613 → 453 | 1,361 → 910 | 2 → 2 |
| 50,000 | 1,513 → 1,493 | 54 / 59 → 30 / 38 | 3,985 → 2,781 | 8,537 → 5,751 | 2 → 2 |

At 50,000 customers, `EXPLAIN (ANALYZE, BUFFERS)` for the first ranked batch fell from 60.258ms to 37.177ms on the warmed fixture. The old plan windows roughly 52,500 tenant visit rows per batch; the new plan windows 1,000 visits for the selected 500 customers, while retaining a tenant-wide `MAX(visited_at)` ranking pass. The observed plan still scans tenant visits again to join them to the selected customers; it removes full-population windowing, not all full-population reads. Query counts and transferred candidate rows did not increase: sparse first page used 153 queries / 51 ranked batches / 25,500 candidate rows in both variants; full traversal used 345 / 115 / 57,073. Summary used 402 queries in both variants. This leaves repeated global ranking and sparse scans as the main scale cost. Node RSS was not used as a comparative metric because both variants ran in the same long-lived process with GC and fixture effects; bounded transferred rows were counted directly.

To reproduce, start an explicitly disposable PostgreSQL 16 container with database `phase7_bench` bound to `127.0.0.1:59176`, apply existing Prisma migrations to that database, then run `apps/api/perf/intelligence-phase7.ts` with `DATABASE_URL` and matching `PHASE7_ISOLATED_DATABASE_URL` set to its URL. Use `PHASE7_VARIANT=baseline` and `PHASE7_VARIANT=current` against the same fully seeded database, `PHASE7_SIZES=5201,20000,50000`, `PHASE7_RUNS=3`; `PHASE7_VERIFY_PARITY=1` compares every ranked row in both no-visit modes. The script refuses a different host, port, or database name. Do not point it at an application or preview database.

## Search

Customer search is still `ILIKE` / `contains` (substring). Re-benchmark (2026-09-06): Seq Scan + filter, **1.6ms** execution, ~178 matches of 3k+. `pg_trgm` remains **deferred** (no measured need at this salon size).

## Import

Excel import stays **synchronous** inside the existing 5,000-row / 2MB / 20s transaction budget. Parse remains outside the DB transaction. Async outbox jobs were not justified by this dataset.

## Retention

Worker bounded deletes (not a giant `DELETE`):

| Store | Default window | What is deleted |
| --- | --- | --- |
| `outbox_events` | `OUTBOX_PROCESSED_RETENTION_DAYS` (14) | `PROCESSED` only. `DEAD_LETTER` is kept. |
| `idempotency_records` | `IDEMPOTENCY_RETENTION_DAYS` (7) | Rows older than the duplicate-key guarantee. |

Batch size: `RETENTION_CLEANUP_BATCH_SIZE` (1000). Interval: `RETENTION_CLEANUP_INTERVAL_MS` (300000).

## Connection pool

`DATABASE_CONNECTION_LIMIT` is per process (API replica + worker). Do not raise it toward `max_connections` as a first step. A starting production point: API 10, worker 5, leave headroom for admin/migrations.

## Production index creation

`20260906140000_phase_c_scale_indexes` is a normal Prisma migration (transactional `CREATE INDEX`). On a large existing table, prefer `CREATE INDEX CONCURRENTLY` during a maintenance window instead of applying this migration as-is on a huge `outbox_events` heap.
