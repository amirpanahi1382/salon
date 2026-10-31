# Reporting ledger — 2026-10-31

HEAD `ea1d0450e5ef82bf5764b9c2bf27d1215f3576a9` on `cursor/opportunity-action-layer`. Uncommitted. Not pushed.

Disposable database: `salon_metric_oracle_20261030` on `127.0.0.1:55931`, container `salon-metric-oracle-pg-20261030`, comment `metric-oracle-disposable:20261030`, system identifier `7702523359876800547`. Canonical `7700113693112733735` was not used. Canonical Postgres stayed stopped.

## Done

- VIP requested quantity is `SUM(requested_count)` for `SUBMITTED`, `MANUAL_QUEUED`, `BALE_NOT_IMPLEMENTED`. Edge fixture HTTP: 10 recorded sends / 130 requested.
- Ordinary requested quantity remains every non-VIP `MessageRequest`, including `CANCELLED`. Edge fixture HTTP: 3 / 5.
- Monthly revenue is `numeric(19,2)::text` formatted by `formatExactMoneyText`. Edge fixture HTTP: `12345678901236068.40`.
- `GET /vip/capability`, `/vip/regions`, and `/vip/lists` do not expire drafts. Salon commands expire only that salon, and reserve also reclaims the named list. The sample-work recovery tick expires across salons in batches.
- Large seed: 50,000 customers and 250,000 visits in salon `55555555-5555-4555-8555-555555555555`, plus 2,000 and 200 customer tenants. HTTP timings are in `/tmp/salon-scale-http.json`. Dashboard EXPLAIN is in `/tmp/salon-scale-explain.json` (137 ms, buffer hits, no sort spill).

## Done on the follow-up pass

- «وقت توافق‌شده» counts operationally open `ReturnCommitment` rows plus every `VisitIntention` with `linked_visit_id` null, including `UNKNOWN`. The two tables are not merged. HTTP reconciliation passed on the oracle database.
- Revenue-drop paging of 251 qualifying customers passed, with a fixed `asOf` and no duplicate ids.
- `overall-performance.e2e-spec.ts` passed on the oracle database as `salon_app`.
- `vip-multiple-requests.e2e-spec.ts` passed on database `salon_vip_multi_20261031` (same disposable cluster, port 55931, comment `vip-multi-disposable:20261031`) as the `salon` superuser.
- Classified HTTP benchmark: 4,820 attempts, 3,937 HTTP 200, 0 HTTP 4xx/5xx, 883 `ECONNRESET` (`connect` or `read`). In-flight samples saw `BufFileRead` / `BufFileWrite` on the dashboard and revenue-drop queries. Throttle check: 60 allowed then 5 times HTTP 429.
- Large salon after the coverage add: 50,251 customers, 250,000 visits, 251 previous-month revenue-drop customers, 3 VIP requests on list `55555555-5555-4555-8555-5555555555d1`.

## Capacity harness — 2026-10-31 later

- Standalone API `apps/api/perf/capacity-main.ts`, compiled with `tsc -p tsconfig.capacity.json` to `dist-capacity/`. It listens on `127.0.0.1:18141` only when `CAPACITY_BENCHMARK=1` and the benchmark identity matches. `nest build` does not emit it. `pnpm start` remains `node dist/main.js`. Throttling is disabled only in that process.
- `apps/api/perf/load-http.ts` reads every response body, does not retry, and records status or exception code.
- Lightweight `/health` at concurrency 50 for 8 seconds: 136,205 attempts, 0 failures. Supertest against the same standalone server: 112,012 attempts, 0 failures. Idle 6-second keep-alive waves also had 0 failures.
- The earlier 883 `ECONNRESET`s were not reproduced on this stable process, including a stale keep-alive agent after a 6-second idle and Supertest at concurrency 50. A fresh in-process Jest reproduction was not run, so the in-process mechanism is not isolated. The harness correction used for the sustained numbers is a separate long-lived API plus a client that reads every body and does not retry.
- Sustained 60-second runs, all HTTP 200, 0 timeouts: dashboard c10/25/50 (2327/2244/2195), mixed tenants (3434/3542/3658), mixed routes (12746/12649/12153).
- Dashboard c50 over 60s: temp_files +2193, temp_bytes +9.4 GB, about one temp file per request. Isolated EXPLAIN still showed hash batches 1 and no sort spill. No query rewrite and no `work_mem` change.
- VIP execution-graph e2e passed. Admin activation 4 passed. Activation race 3 passed.
- Bounded export of one RFC-valid customer: 10/10 HTTP 200. An earlier export burst returned 400 because md5-derived ids fail `IsUUID`.

## Closing stage — 2026-10-31

- Edge oracle database `salon_metric_oracle_edge_20261031`, comment `metric-oracle-edge-disposable:20261031`, same cluster system identifier `7702523359876800547`. `metric-oracle-run.ts --destructive-reset` truncates only that database. `scale-seed.ts` truncates the benchmark only with the same flag. The populated benchmark was not reset.
- Edge HTTP-repository check: ordinary 3/5, VIP 10/130, money `12345678901236068.40`. Historical commitments 3, open commitments 1, operational agreed count 4. The dashboard returned 4. The other salon returned 2 and did not change the edge count.
- Dashboard temp files are the materialized `eligible` CTE tuplestore: the saved plan wrote 526 blocks, about 4.1MB, while hash batches stayed 1. `NOT MATERIALIZED` removed those blocks on both custom and generic plans. Under concurrency the parallel plan asked `/dev/shm` for 4MB segments and returned SQLSTATE 53100. Forcing `max_parallel_workers_per_gather=0` removed the 500s and the temp files, and dashboard throughput fell from about 36 rps to about 28 rps. That change was reverted. No index and no migration.
- Export of one RFC-valid customer, 5 visits, window `2026-10-26T00:00:00.000Z` through `2026-10-31T00:00:00.000Z`: preflight 200 with 5 rows, workbook matched headers and amounts, other tenant 404, invalid UUID 400. Sustained concurrency 5 for 30s: 60/60 HTTP 200, 426,140 bytes, p50 42 ms, p95 52 ms, 60 `VISITS_EXPORTED` audit rows. Cap 60 requests and 16MB.
- In-process Jest `ECONNRESET` remains unresolved. It was not reproduced again.

## Verification gates — 2026-10-31

- Reused activation database `salon_admin_vip_activate_20261031` had one region `03` list: `IN_USE`, `ORIGINAL_TEHRAN`, owner matched the request salon, status `AWAITING_SAMPLE_WORK`, `reserved_until` `2026-10-31 09:56:49+00`, already overdue. Effective requestability now includes that hold in admin `requestableBySalons`, region counts, and browse. Reads still do not release it. The reserve command reclaims it atomically.
- Fresh databases, migrated by `salon_migrator` and tested as `salon_app`: `salon_admin_vip_activate_gate20261031`, `salon_admin_vip_act_race_gate20261031`, `salon_export_hist_20261031`. Activation suite passed twice, 5 tests each. Race suite passed, 3 tests. `salon_migrator` needed `CREATEDB` only while Prisma applied the migrations; that privilege was removed afterward.
- Export history fixture: 3,000 in-window visits, 20 earlier visits, one visit on the exclusive end. Workbook matched order, Jalali text, fractional completed amounts, voided null amounts, and tenant isolation. 5,001 visits returned HTTP 400 naming the 5,000 limit. Exactly 5,000 returned HTTP 200. Bounded load: 20/20 HTTP 200, max in flight 5, wall 30.0s, p50 530 ms, 1,622,260 bytes, 20 audit rows, 159 commits. A count-only explain of the window was 1.1 ms and wrote no temporary blocks.

## VIP package quantity and reopen — candidate, distinguishable from the reporting work

- Groups 30/50/100 classify usable contact counts. Request quantity is `min(usable contacts, remaining quota)`.
- `next_reservation_open` is one admin grant. The next reservation consumes it. Existing requests stay.
- Migration `20261031180000_vip_package_quantity_and_reopen` is candidate SQL only until applied on a named disposable database. It is not applied to canonical `salon-db`.
- Reporting formulas are unchanged: a 52-recipient submitted request adds 52, and a capped 20 adds 20. The group is not summed.
- Partial unique index `vip_requests_one_active_per_salon_list` guards one live request per salon and list. It does not add a browse index.
- `20261031181000_vip_multi_salon_reservation` drops `vip_requests_one_open_reservation_per_list`, which allowed only one draft per list.
- Applied only on disposable `salon_vip_multi_20261031`, `salon_admin_vip_activate_gate20261031`, and `salon_admin_vip_act_race_gate20261031` as `salon_migrator`. Tested as `salon_app`. Cluster system identifier `7702523359876800547`. Canonical container stayed exited.
- HTTP: `vip-multiple-requests` 16 passed, including a 52-recipient request, a quota cap of 20, and one-opening multi-salon reservation. Activation 6 passed. Activation race 3 passed. Flutter `vip_region_ux_test.dart` 21 passed.

## Closing verification — package quantity and reopen

- Deactivate clears the latest-reserver pointer and the opening flag, leaves requests and snapshots, and blocks browse, reserve, and reopen. Activate restores `ACTIVE` without setting `next_reservation_open`. A later reopen admits one new salon. Existing holders stay excluded.
- Confirmed order terms are list, effective quantity, and geographic range. A later stop that leaves the same quantity does not conflict. A changed quantity returns 409 and writes no request.
- An expired draft stays stored on read. `reservedUntil == now` does not cancel it. The next salon command cancels that salon’s overdue draft before insert. Another salon’s request on the same list stays.
- Fresh database `salon_vip_multi_freshgate`, comment `vip-multi-disposable:freshgate`, 44 migrations as `salon_migrator`, HTTP as `salon_app`: VIP suite 19 passed.
- Upgrade database `salon_vip_upgrade_gate20261031`: historical 30/50/100 rows, 30 snapshots, audits, and outbox survived. `next_reservation_open` stayed false. Dispatch of the 30-recipient request returned the same request on replay.
- Failure database `salon_vip_upgrade_fail_gate20261031`: duplicate live salon/list rows made `20261031180000` fail with SQLSTATE 23505. The column and new index were not created. Both historical rows remain. The old 30/50/100 check remains.
- Benchmark `salon_metric_oracle_20261030` was not given the unique index. Four salon/list pairs already have 52 live requests. Only `next_reservation_open boolean NOT NULL DEFAULT false` was added so the current Prisma client can read it. No benchmark rows were deleted.
- `CREATE UNIQUE INDEX` takes a write lock on `vip_requests` for the build. The boolean column add is a short metadata change. A failed migration rolls the DDL back and leaves a failed Prisma migration row.

## Final-schema reconciliation — distinct from benchmark timings

- Integration database `salon_metric_final_gate20261031`, comment `metric-final-disposable:gate20261031`, system identifier `7702523359876800547`. `salon_migrator` applied all 44 migrations, 0 unfinished. `salon_app` ran the HTTP tests. `CREATEDB` was removed afterward.
- Present: `vip_requests_count_positive`, `next_reservation_open` default false, `vip_requests_one_active_per_salon_list`, and `vip_requests_one_awaiting_draft_per_salon`. Absent: `vip_requests_one_open_reservation_per_list` and `vip_requests_count_allowed`.
- On that database as `salon_app`: metric serving path, agreed-time, VIP execution graph, and overall performance passed. HTTP quantities were ordinary 3/5, VIP 10/130, and money `12345678901236068.40`. The graph history is 53 requests on 52 lists, two pages, no duplicate ids.
- `salon_vip_multi_freshgate` remains a separate 44-migration database. Its VIP suite passed again, 19 tests, as `salon_app`.
- Benchmark `salon_metric_oracle_20261030` was not migrated and was not reset. Its earlier timings are not final-schema evidence.

## Canonical read-only preflight

`scripts/vip-active-request-preflight.py` reports duplicate active `(salon_id, list_id)` groups and `requested_count` values outside 1..500. The duplicate predicate is the stored statuses `AWAITING_SAMPLE_WORK`, `SUBMITTED`, `MANUAL_QUEUED`, and `BALE_NOT_IMPLEMENTED`, including overdue drafts that are still stored in those statuses. It matches `20261031180000_vip_package_quantity_and_reopen`. It does not use `reserved_until` and it does not read `next_reservation_open`. The report says whether the catalog is the predecessor shape or the final shape.

Default mode refuses canonical and persistent targets before it connects. Canonical mode is an explicit opt-in. The expected database name, system identifier, and comment are verified against the connected database inside one `BEGIN READ ONLY` transaction. Those expected values are not evidence that a connection is canonical. The script grants nothing. If the selected role cannot read the identity or `vip_requests`, it reports that requirement and exits. It does not expire, cancel, merge, delete, or rewrite rows.

Exit 0 is a clean predecessor or final schema. Exit 2 prints the full duplicate-group count, the full out-of-range count, and at most 20 conflicting `salon_id` / `list_id` pairs. Exit 1 is an identity, privilege, or operational failure. Conflicts are reported. Historical repairs are not automated.

Disposable invocation:

```text
python3 scripts/vip-active-request-preflight.py \
  --container <disposable-container> \
  --database <disposable-database> \
  --expected-system-identifier <system-identifier> \
  --expected-comment <comment>
```

A later authorized canonical check, after that database is started by a separate decision:

```text
python3 scripts/vip-active-request-preflight.py \
  --canonical-read-only \
  --container salon-phone-first-empty-pg-20261024T061347Z \
  --user salon \
  --database salon-db \
  --expected-system-identifier 7700113693112733735 \
  --expected-comment phone-first-empty:20261024T061347Z
```

Starting canonical `salon-db`, running this preflight against it, and applying the migration remain a later authorized operational step. This change did not connect to that database. The canonical container stayed exited.

Earlier disposable results remain: clear on `salon_metric_final_gate20261031`; exit 2 on the benchmark (5 duplicate salon/list groups) and on `salon_vip_upgrade_fail_gate20261031` (1 duplicate group). The conflicting predecessor was left unfinished on purpose.

## Still open

- Message and transaction volume remains about one row per customer, not one per visit.
- Dashboard temp-file IO is identified and left in place. Revenue-drop queries still spill under the mixed workload.
- In-process Jest `ECONNRESET` was not reproduced in a fresh in-process test.

## Reproduce without secrets

From `apps/api`, with `tsx` from `apps/worker/node_modules/.bin` and `DATABASE_URL` pointed at the disposable oracle as `salon_app`:

- `tsx perf/metric-oracle-run.ts --destructive-reset` rebuilds the edge fixture. It truncates only `salon_metric_oracle_edge_20261031`.
- `tsx perf/scale-seed.ts --destructive-reset` truncates and loads the 50,000 / 250,000 set on the benchmark database. Do not pass the flag unless that reset is intended.
- `tsx perf/scale-explain.ts` explains the dashboard on that set.
- Jest `test/metric-serving-path.e2e-spec.ts` and `test/scale-http.e2e-spec.ts` need the matching `DATABASE_URL` plus synthetic Redis, MinIO, and JWT values. Do not load root `.env`.
