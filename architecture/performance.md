# Performance and scale

Dated measurements (2026-09-06) used a disposable salon of **3,000 customers / 15,000 visits** (`pnpm perf:bench`). HTTP load: `RUN_LOAD=true pnpm perf:load` against a running API. Those numbers are historical evidence, not a live SLA.

## Pagination

List endpoints remain bounded (max 200). They now return `nextCursor` when `hasMore` is true.

- Customers: `(created_at DESC, id DESC)`
- Visits: `(visited_at DESC, created_at DESC, id DESC)`
- Intelligence opportunities / segments: global SQL rank over tenant-scoped visit aggregates; bounded 500-candidate transfers, with an eligible-result lookahead (max 200 response items)

Offset `skip` at 0 / 100 / 1,000 / 2,950 was ~2–4ms on this dataset (no material difference vs cursor). Cursor is still the supported way to read past the first page so we never `OFFSET` at 10k+ later.

## Intelligence

Visit timestamps are **not** loaded into Node for salon-wide intelligence. PostgreSQL computes visit count, first/last visit, and average positive whole-day gaps. Classification rules in `@salon/shared` are unchanged.

The former 5,000-customer truncation is removed. Summary scans the indexed customer creation order in 500-customer batches and aggregates only those customers' visits, revenue, and suppression state per batch. It performs one salon revenue-total query plus up to three queries per batch and one terminal customer probe. Ranked list queries compute global days-since-last-visit order in PostgreSQL and transfer at most 500 candidate rows per batch; filtered lists may scan several batches before finding 201 eligible results. Each ranked batch recomputes tenant visit aggregates, so repeated pages on very large salons remain a scale cost. The Phase 6B disposable fixture of 5,201 customers and 2,201 Visits completed a summary in about 0.13s, a sparse filtered opportunity traversal in about 1.8s, and an unfiltered 5,201-segment traversal in about 5.5s locally. These are diagnostics, not production guarantees. No customer/visit fetch-all, cache, snapshot, or new index was added.

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
