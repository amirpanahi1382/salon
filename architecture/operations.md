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

Redis is **not** a readiness dependency and is **not used by application code**. MinIO is used for VIP sample-work and private activation-receipt upload/download on the API; it is still **not** part of `/health/ready` (Postgres only). A MinIO outage fails those image use-cases, not process liveness.

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

**R3 storage fence:** before the `UPLOADING` intent commits, the API locally fixes a generation-key PUT authorization whose absolute expiry is no later than its lease. The API executes that exact authorization after commit; it never signs the same attempt anew after a pause. Authorization preparation failure rolls back the intent and capacity/idempotency claim. Disposable MinIO rejected a PUT started after expiry (including the reproduced pause past terminal cleanup), while a newer generation uploaded at its distinct key. The prior fresh-sign behavior did leave an orphan. A pre-PUT database check alone would have a check-to-use race; the storage service must enforce the fixed expiry. The signed request is not returned to callers; it travels from API to storage and must be redacted from proxy, gateway, and object-store request logs.

There are **two separate bounds**. The last permissible PUT start is the storage-validated authorization expiry, fixed before commit. A PUT accepted before that expiry may finish afterward; `VIP_UPLOAD_CLEANUP_SETTLE_MS` must still exceed the target's maximum accepted-PUT completion/abort lifetime measured from the lease boundary, with margin. Disposable MinIO accepted a request started before expiry and completed after it. Verify expiry enforcement, clock synchronization, proxy caching/re-signing behavior, request lifetime, and log redaction through the actual target path before claiming the target guarantee. The disposable test injected an API-path interruption after a real PUT; it did not kill an OS process. A separate read-only inventory may flag historical/ambiguous bucket objects, but no automatic bucket-wide scan or deletion of committed/historical images is authorized. In a versioned bucket, DELETE can leave noncurrent bytes even when GET is not found; validate version retention separately.

`AVAILABLE` means an exact digest/type/length read succeeded at `verifiedAt`. Submit verifies every sample immediately before its database transition and confirms the metadata set under the request lock. MinIO and PostgreSQL still have no cross-store transaction: bytes can disappear after verification. Download verifies again. Alert on repeated `vip_sample_work_recovery.tick` failures and growing non-`PROCESSED` cleanup counts.

Legacy replay checks a pre-intent idempotency record's scoped committed sample and object bytes; it never backfills an upload intent or treats migration as storage verification. Failed historical reads return an infrastructure error and do not refresh `verifiedAt`. Submission takes its deadline decision after object reads under the request lock; failed expiry decisions roll back the idempotency claim and success audit/outbox. Operators must still validate historical objects in the target bucket separately from these disposable tests.

Deployment order is migration, worker, then API. The migration adds nullable `verified_at` without backfilling history and creates lifecycle/cleanup tables; it does not contact MinIO. Deploy the recovery-capable worker before accepting new lifecycle uploads. API credentials require bucket GetObject/PutObject; worker credentials require DeleteObject and GetObject only for the configured VIP bucket/prefix. Confirm the actual S3-compatible service gives read-after-write consistency. Inspect bucket versioning and lifecycle policy: automatic lifecycle deletion must not target committed `vip/` images. If versioning is enabled, a normal DELETE may create a delete marker while retaining noncurrent bytes; either account for those retained versions operationally or provide narrowly scoped version cleanup before calling physical-byte cleanup complete.

Legacy orphan inventory is deliberately non-destructive. Export committed `vip_sample_works.object_key` values and durable upload/cleanup keys from PostgreSQL, obtain a read-only bucket object/version listing with size and modification time, and compare offline. Treat bucket-only keys that predate durable intents as ambiguous; review them individually and do not feed them into automatic cleanup. A migration or matching path shape does not verify a historical object.

## Activation receipt storage

Receipt bytes use the same S3-compatible adapter as VIP sample work, in a separate key prefix `activation-receipts/{salonId}/{receiptId}`. Before a receipt can become `STORED`, the API fully decodes the JPEG, PNG, or WebP and rejects a truncated, corrupt, or oversized image. Decoding does not replace the uploaded bytes. The API does not return a public or long-lived URL. Admin and owner reads stream the object only after an authenticated ownership or platform-admin check, and an admin read writes an audit row without the bytes. The admin screen enables the bank attestation only after the image widget renders.

PostgreSQL and object storage are not one transaction. A replacement does not mark the previous `STORED` receipt `SUPERSEDED` until the new object has been stored and its digest verified. Those two phase changes and the `ACTIVATION_RECEIPT_STORED` success audit then commit together. If the new upload fails, times out, or fails verification, the previous receipt stays `STORED`, its object is kept, the new row becomes `FAILED`, and no success audit is written. A failed PUT attempts one delete of the new key only. A crash after the new PUT and before the phase transaction, or an audit-insert failure inside that transaction, leaves the new row `UPLOADING` and its object in the bucket; the previous `STORED` receipt stays submittable, and no success audit is visible. The audit-insert failure is not retried and does not delete the object. That orphan is not deleted when a later upload marks the stale `UPLOADING` row `FAILED` after 60 seconds. `FAILED` and `UPLOADING` are not reviewable. `SUPERSEDED`, rejected, and approved objects are kept. Approval reads the digest again, requires the exact manual bank attestation, and then changes the salon in the database. If the object disappears after that read, the database can still say `APPROVED` while a later admin view fails. There is no receipt cleanup worker and no bucket versioning or lifecycle policy in this slice. Turning the flag off stops new instructions and decisions; it does not hide an existing review or its image.

Backup of `salon` does not include these objects. Restoring PostgreSQL without the bucket keeps the receipt rows and blocks a new approval when the bytes or digest do not match. Restoring the bucket without the rows does not create a review. Operators must back up the private bucket prefix separately and must not put a public read policy on it. Confirm the card number, cardholder, and accepted amount before `MANUAL_TRANSFER_ENABLED=true`. Enabling the flag is not authorization to request live payments.

## Phone-first cutover

This is the recoverable order. It is not authorization to perform it.

1. Stop writers to the old `salon` database and its object storage only after an explicit decision.
2. Archive that database and the private object-storage prefixes. Record the archive names, sizes, and checksums.
3. Restore the archive into a disposable database and a disposable bucket. Prove a read of the restored catalog and one restored object. Do not point the product at that restore.
4. Create a new empty database. Apply the migration chain there. It builds the phone-first schema from scratch. The phone-first migration checks every ordinary table in `public` and refuses the migration when any of them already has a row. Prisma's migration ledger is the only excluded table. That refusal happens before any schema change. Do not apply it to the persistent database named `salon`.
5. Set a database comment on that new database. Establish the first platform admin with the operator command, passing the exact database name, system identifier, and comment. The command reads those from the live connection and stops before any message or insert when they do not match. The phone is supplied at that time, verified, and not hard-coded. Confirm one admin exists and a second run does not change it.
6. Switch API and worker configuration to the new database and storage only after a separate explicit authorization. Leave the archive until that new system has been accepted.

Do not migrate historical accounts or business rows into the new database. Do not run the phone-first migration against `salon` or `salon_preview`.

## API bind

`API_PORT` chooses the port only. `API_BIND_HOST` is optional and defaults to unset. Unset keeps `listen(port)`, which is the generic development behavior. The only accepted value is `127.0.0.1`; any other value stops startup before the process accepts connections. Docker Compose does not set this value.

## Canonical phone-first startup

Generic `pnpm start:api` and `pnpm dev:api` still load the root `.env`. They do not prove which database accepted the connection.

The canonical entry point is `pnpm start:canonical` (`scripts/start-canonical-api.sh`). It loads only `.env.phone-first-product`, exports `API_BIND_HOST=127.0.0.1` and `CANONICAL_DATABASE_REQUIRED=true`, and does not fall back to the root `.env`. Before `listen`, the API calls `canonical_database_identity()` and requires `CANONICAL_DATABASE_NAME`, `CANONICAL_SYSTEM_IDENTIFIER`, and `CANONICAL_DATABASE_COMMENT` to match. The names `salon`, `salon_preview`, and `salon_opp_integrity_20261024` are refused. The supported canonical command is `pnpm start:canonical`. `pnpm start:api` and `pnpm dev:api` load the root `.env` and are not a fallback for this database. A missing function or a mismatch exits before the port opens. The log line contains the database name only.

The logical database name is `salon-db`. It was renamed in place from `phone_first_product` on PostgreSQL system identifier `7700113693112733735`. The database OID, rows, roles, ownership, and grants stayed with that database. The comment stays `phone-first-empty:20261024T061347Z`. That comment is the original cluster marker, not a claim that the database is still empty or still named `phone_first_product`. The Docker container, the data volume, and the MinIO bucket were not renamed; those names identify storage, not a second product database. The VIP transfer audit still says the import targeted `phone_first_product`. Do not replay `scripts/transfer-vip-inventory.py` against this cluster. Its execute and rollback modes refuse the canonical system identifier.

That function is `SECURITY DEFINER`, owned by the operator superuser, with `search_path` fixed to `pg_catalog`. It returns the database name, system identifier, and comment. `EXECUTE` is granted to `salon_app` and `salon_migrator` and revoked from `PUBLIC`. `EXECUTE` on `pg_control_system()` is revoked from `PUBLIC` and from both restricted roles. The operator superuser can still call it. The API role is not a member of `pg_monitor`.

PostgreSQL and MinIO for this environment stay published on `127.0.0.1` only. The Android emulator reaches `127.0.0.1:3000` through `10.0.2.2`. Do not publish the database or object storage on a LAN address for the emulator.

Canonical migrations, when explicitly requested, use `pnpm db:migrate:canonical` (`scripts/canonical-migrate.sh`). It loads `.env.phone-first-migrate` and, before Prisma, requires `current_user` to be `salon_migrator` and `canonical_database_identity()` to match `CANONICAL_DATABASE_NAME`, `CANONICAL_SYSTEM_IDENTIFIER`, and `CANONICAL_DATABASE_COMMENT` from that file. A mismatch exits before Prisma opens a migration and before ledger cleanup. After Prisma deploy, whether that deploy succeeds or fails, the same identity check runs again. Only then does cleanup revoke runtime privileges on `public._prisma_migrations` from `salon_app` and `PUBLIC` when the ledger table is present (`CANONICAL_MIGRATE_LEDGER_LOCKED`). An absent ledger is reported as `CANONICAL_MIGRATE_LEDGER_ABSENT` and is left untouched. A failed deploy keeps Prisma's exit status. A failed cleanup prints `CANONICAL_MIGRATE_LEDGER_CLEANUP_FAILED` and becomes the process status only when Prisma itself succeeded. An identity failure during cleanup is not reported as a cleanup failure. Do not point that command at the historical `salon` database. API startup does not migrate.

A plain `pg_dump` of `salon-db` does not restore cluster roles. The dump taken immediately before the rename is the current local recovery point: `/Users/amir-panahi/salon-archives/salon-db-rename-20261028/phone_first_product-before-rename.dump`, with `SHA256SUMS` in that directory. It was taken while the logical name was still `phone_first_product`. Restoring it does not require a server or an off-device copy. Recovery stays on this Mac. Create a database named `"salon-db"` on the replacement cluster, restore that dump into it, set the comment `phone-first-empty:20261024T061347Z` if the restore did not keep it, run `scripts/apply-canonical-database-access.py` with the new cluster's system identifier and the name `salon-db`, point `.env.phone-first-product` at `salon_app`, and start with `pnpm start:canonical`. The receipt object is `activation-receipt.bin` in the same directory and must be restored to the private bucket separately. Older Stage 1 dumps predate the VIP transfer and the rename. To undo only the rename, stop the API, connect to `postgres`, run `ALTER DATABASE "salon-db" RENAME TO phone_first_product`, restore the saved env files from that directory, and start `pnpm start:canonical` again. Do not point the application at a historical or disposable database. After restoring the dump into a new cluster, run `scripts/apply-canonical-database-access.py` with the new cluster's system identifier, database name, and comment supplied explicitly, then point `.env.phone-first-product` at `salon_app` and start with `pnpm start:canonical`. The Stage 1 owner image, `salon-stage1-recovery-owner.dmg`, is the encrypted backup taken before both these roles and the VIP inventory transfer. Restoring it recovers the pre-transfer canonical dump, the historical VIP dump, and the receipt bytes. It does not contain the 29 pending lists and 2,194 contacts now in `phone_first_product`. No post-transfer canonical backup was taken. Role recovery is still restore, then `scripts/apply-canonical-database-access.py` for that cluster's own identity, then `pnpm start:canonical`. Rebuilding the transferred inventory after that restore is a separate run of `scripts/transfer-vip-inventory.py` from a provenance-checked historical clone, checked afterward with the pre-transfer baseline, the `VIP_INVENTORY_TRANSFER` success audit, and the list-id and sorted-phone MD5 values. Those provenance records are not a second database backup. Do not treat restoring the pre-rotation operator env file as a working rollback: that password was rotated. The working service configuration is the current `.env.phone-first-product`, which logs in as `salon_app`.

`scripts/apply-canonical-database-access.py` reads passwords from a mode `0600` file owned by the invoking user. It compares the supplied identity with the live database inside one transaction and makes no change when they differ. It does not print passwords or the SQL that contains them.

## Database roles

On `salon-db` only:

| Role | Use | Limits |
| --- | --- | --- |
| `salon` | Operator recovery. `docker exec` local trust, or the rotated host password stored outside Git | Superuser. Not used by the API |
| `salon_migrator` | Prisma migrate for this database. Owns `public` and the application tables | `NOSUPERUSER`, no createdb, no createrole, no replication, connection limit 5. No statement timeout |
| `salon_app` | API, the VIP inventory transfer, and, later, the worker | `NOSUPERUSER`, no createdb, no createrole, no replication, no bypassrls, noinherit, connection limit 20. Not a member of `salon` or `salon_migrator` |

`salon_app` has `CONNECT` on `salon-db`, `USAGE` on `public`, and `SELECT`, `INSERT`, `UPDATE`, `DELETE` on application tables. Two intentional exceptions follow that blanket grant in the same provisioning transaction. `public._prisma_migrations` has no runtime privileges: Prisma Client does not read that ledger, and `salon_migrator` owns it. `public.audit_logs` keeps `SELECT` and `INSERT` for `salon_app` and loses `UPDATE`, `DELETE`, and `TRUNCATE`, including column-level `UPDATE`. `PUBLIC` loses those rewrite privileges too. The restriction is skipped when the table is absent, so bootstrap before the first migration still applies. Rerunning provisioning repeats both restrictions, so the blanket grant does not stick. Default privileges still grant `SELECT`, `INSERT`, `UPDATE`, and `DELETE` to `salon_app` on tables `salon_migrator` creates later. `db:migrate:canonical` repeats the ledger revoke and the audit restriction after Prisma, including after a failed deploy. That cleanup removes runtime access to `_prisma_migrations` and rewrite access to `audit_logs`. It does not remove DML from other new application tables. A table created under a different name keeps the default DML grants until an explicit revoke names it. An absent ledger still prints `CANONICAL_MIGRATE_LEDGER_ABSENT` and runs the audit statement, which returns without changes when `audit_logs` is absent. `salon_migrator` and the operator superuser retain maintenance of both tables. The runtime role has sequence usage and function `EXECUTE`, including trigger functions. It does not have `CREATE` or `TRUNCATE`. `CONNECT` on `salon_opp_integrity_20261024` is revoked from `PUBLIC`, `salon_app`, and `salon_migrator`. The operator superuser can still open that database. To restore the previous runtime audit grants, the operator runs `GRANT UPDATE, DELETE ON TABLE public.audit_logs TO salon_app`. The next provisioning run or canonical migrate cleanup removes those grants again.

Role timeouts for `salon_app` only: `statement_timeout=30s`, `lock_timeout=5s`, `idle_in_transaction_session_timeout=30s`. These are PostgreSQL limits on one statement, one lock wait, and one idle open transaction. They are not a promise that a multi-statement import finishes. Prisma's own interactive transaction budget for customer and VIP imports is 20 seconds. A single statement that runs longer than 30 seconds, a lock wait longer than 5 seconds, or a transaction left idle for 30 seconds becomes `INFRASTRUCTURE_ERROR` (503). `salon_migrator` does not inherit those timeouts.

`DATABASE_CONNECTION_LIMIT=10` for the canonical API. One worker, when started later with the same file, opens its own pool of 10. `max_connections` stays 100. The app role's connection limit is 20, leaving the rest of the cluster for the operator and the migration role.

`scripts/apply-canonical-database-access.py` reads passwords from a mode `0600` file and applies the roles to one named database. It does not print those passwords.

## VIP inventory transfer

`scripts/transfer-vip-inventory.py` copies one historical VIP inventory into a phone-first destination. It transfers `vip_target_lists` and `vip_target_contacts`, plus one provenance audit row. It does not copy salons, users, VIP requests, recipient snapshots, entitlements, financial rows, message requests, deliveries, or outbox events. It does not activate lists. Publishing this procedure does not authorize a write to the canonical database. Run the live command only after the write-freeze below has been completed in the same window.

The historical source is database `salon` from volume `salon-platform_salon_platform_pg_data`, original system identifier `7683163620851879970`: 29 `ORIGINAL_TEHRAN` lists, 2,194 contacts, list-id MD5 `0c64dcf9be0b92049406c13af43d0ece`, sorted-phone MD5 `b2724bfc710ad59aae6466bd0384079e`. Keep container `salon-platform-postgres-1` stopped. Read a provenance-verified clone. The Stage 1 restore checked on 2026-10-27 is container `salon-stage1-restore-historical-pg-20261027T1051Z`, clone system identifier `7701299687051079714`, database comment null. Re-read that identity immediately before a live run. If it differs, stop and pass the new clone's identity explicitly. The script refuses the original container and refuses a source whose system identifier is the original volume.

The destination at transfer time was database `phone_first_product`, system identifier `7700113693112733735`, comment `phone-first-empty:20261024T061347Z`, container `salon-phone-first-empty-pg-20261024T061347Z`. That database was later renamed in place to `salon-db`. The command below is the historical record, not a command to run again. The destination platform admin is `01a16c99-db0b-7338-96b8-b4cc3b0a135e`. Expected identities are arguments. The script does not copy an expected identity from the connection it is judging.

Transformation:

- Preserve list and contact ids, names, `region_code`, `ORIGINAL_TEHRAN` membership, `contact_count`, `sort_order`, `display_name`, phone numbers, `created_at`, and `updated_at`.
- Set every destination list to `PENDING`. Clear `reserved_by_salon_id` and `reserved_at`. `vip_target_lists` has no reservation-expiry column.
- Remap `created_by_admin_id` to the destination admin. The success audit keeps the original creator, status, and reservation metadata, the owned ids, and the safety counts. The manifest has no phone numbers and no message text.
- Leave `VIP-11-01` at 28 contacts and `VIP-14-01` at 27 contacts.
- A list is requestable only when it is `ACTIVE`, unreserved, `ORIGINAL_TEHRAN`, and region `01`–`14`. Pending lists are not requestable.

Stop if `platform_message_stops`, `platform_message_stop_events`, `message_global_stop_outcomes`, or `message_deliveries` is non-zero on the source. Zero delivery rows do not prove that no message was ever sent. Historical recipient snapshots stay in the source and are counted in the manifest as not copied.

The write identity is `salon_app`: `INSERT` on the two VIP tables and `audit_logs`, `SELECT` for the checks, and `DELETE` only when `--mode rollback` is explicit. `salon_app` is not a superuser and cannot disable triggers. `salon_migrator` is not the transfer identity because it owns the tables. Source reads, and the destination migration-head check, use a separate read-only `salon` session: the historical clone has no `salon_app`, and `salon_app` cannot read `_prisma_migrations`. Do not create roles on the preservation clone. Do not grant `salon_app` ledger privileges for this transfer. The script does not disable constraints or triggers, does not take a table lock, and does not use `ON CONFLICT DO NOTHING`. It takes transaction advisory lock `pg_advisory_xact_lock(8742, 3)` only.

One destination transaction inserts all 29 lists, then the 2,194 contacts in batches of 400, verifies the result, and inserts one `VIP_INVENTORY_TRANSFER` / `SUCCESS` audit. Parent rows are not committed before the contacts. Before that transaction the script checks both identities, migration compatibility (source head `20261015190000_activation_receipts`, 41 finished; destination head `20261017150000_phone_first_identity`, 42 finished; no unfinished rows), the active destination admin, the safety counts, and the list-id, phone, and contact-tuple fingerprints.

An exact second execute detects the same ids, contact tuples, pending unreserved rows, and list shape, then opens a transaction, takes the same advisory lock, and runs only the verification statements. The transaction is not `BEGIN READ ONLY`, because that lock cannot be taken in a read-only transaction. The statement text rejects `INSERT`, `UPDATE`, `DELETE`, and `TRUNCATE`. It does not change rows and does not insert another success audit. An id collision, a changed contact set, a different region, or any other difference fails before commit. The first execute also fails closed when the destination already has VIP rows and no transfer manifest.

Rollback is `VIP_INVENTORY_TRANSFER_ROLLBACK`. It is valid only before a `vip_requests` row references a transferred list or a `vip_request_recipients` row references a transferred contact, and only while every manifest id is still present. It deletes those manifest ids and leaves every other VIP row in place. It refuses, with exit code 4, when a business reference exists or an owned id is already missing. It does not delete the success audit. After a salon request, message, or any other business reference uses those ids, do not delete them. A later import after a clean rollback is a new execution.

Preflight and dry-run use the command below with `--mode dry-run`. Dry-run reads and prints counts only. Execution uses `--mode execute`. Before execution, `--mode baseline --baseline-file <protected-file>` reads one snapshot and writes a mode `0600` file containing the destination identity and the account, agreement, receipt, and pre-transfer audit fingerprints. It does not write to the database, and it refuses to overwrite an existing file. Reconciliation uses `--mode reconcile` with that same file. It reads one read-only snapshot and exits nonzero on any mismatch: list and contact ids, contact equivalence, the 29 and 2,194 counts, pending unreserved rows, names, canonical regions, catalog membership, creator mapping, per-list contact counts, the 28-contact and 27-contact lists, zero requestable lists, exactly one success manifest, no later rollback, and the preserved baseline. Reconcile does not insert, update, delete, or repair rows. Rollback uses `--mode rollback`.

```bash
python3 scripts/transfer-vip-inventory.py \
  --source-container salon-stage1-restore-historical-pg-20261027T1051Z \
  --source-database salon \
  --source-system-identifier 7701299687051079714 \
  --source-origin-system-identifier 7683163620851879970 \
  --source-comment-null \
  --destination-container salon-phone-first-empty-pg-20261024T061347Z \
  --destination-database phone_first_product \
  --destination-system-identifier 7700113693112733735 \
  --destination-comment phone-first-empty:20261024T061347Z \
  --destination-admin-id 01a16c99-db0b-7338-96b8-b4cc3b0a135e \
  --expected-list-count 29 \
  --expected-contact-count 2194 \
  --expected-list-id-md5 0c64dcf9be0b92049406c13af43d0ece \
  --expected-phone-md5 b2724bfc710ad59aae6466bd0384079e \
  --allow-canonical-destination \
  --baseline-file /Users/amir-panahi/salon-archives/salon-stage1-preserve-20261027T1051Z/stage4-vip-pretransfer-baseline.json \
  --mode execute
```

There is no database URL or password in that command. The canonical flag is the explicit destination authorization. `--mode execute` is the only mode that imports. `--baseline-file` is required for `baseline` and `reconcile`. Replace `--mode execute` with `dry-run`, `baseline`, `reconcile`, or `rollback`. Re-read both system identifiers before substituting a different clone. Write the baseline after the write-freeze and before execute. Run reconcile before starting the API again.

Write-freeze, immediately before a live dry-run and again before execute:

1. Confirm `salon-platform-postgres-1` is stopped and the original volume system identifier is still `7683163620851879970`. Do not start that container.
2. Confirm the source clone identity, 29 lists, 2,194 contacts, both MD5 values, and zero rows in the four safety tables above. A non-zero safety count stops the transfer.
3. Send `SIGTERM` to the canonical API and wait until its port is closed. Do not start the worker. Do not send OTP or messages.
4. Confirm `phone_first_product` has no other sessions.
5. Re-read the canonical identity, comment, migration head, 42 finished and 0 unfinished migrations, and the active destination admin. The first import also required zero VIP lists and zero VIP contacts. That empty check described the destination before the 2026-10-27 transfer. It is not the current inventory.
6. Run `--mode dry-run`, then `--mode baseline`, then `--mode execute`, then `--mode reconcile`, before starting the API again. Reconcile must exit 0. Do not activate lists in that command.

A disposable rehearsal on 2026-10-27 used destination cluster system identifier `7701369962014908451`, comment `stage3-vip-rehearsal:20261027`. It did not write the canonical database.

On 2026-10-27 the canonical database received this inventory. The API was already stopped. The write-freeze confirmed no other `phone_first_product` session, then ran dry-run, baseline, execute, and reconcile. Reconcile exited 0. The destination has 29 `PENDING` unreserved lists, 2,194 contacts, and one `VIP_INVENTORY_TRANSFER` success audit. The API was resumed with `pnpm start:canonical` on `127.0.0.1:3000`. The worker stayed stopped. No list was activated. A later execute must take the unchanged rerun path. Do not expect zero VIP rows on this database. That inventory is not inside `salon-stage1-recovery-owner.dmg` or the Stage 1 canonical dumps. No post-transfer canonical backup was taken. Rebuilding it means restoring the pre-transfer canonical dump, provisioning roles, and running this transfer again from a provenance-checked historical restore. The baseline file, the one success audit, and the two MD5 values are what reconcile checks. They are not a backup of the post-transfer cluster.

## Timeouts

- Outbound HTTP helper `fetchWithTimeout` uses `HTTP_TIMEOUT_MS` (default 5s). No automatic retries.
- Worker outbound HTTP: Bale Safir send. The effective wait is the smaller of `BALE_SAFIR_TIMEOUT_MS` (configured maximum 60s) and the lease-derived budget above. VIP Bale is not implemented. A VIP Excel file already downloaded cannot be pulled back. A newly generated export locks the recipient phones in sorted order and omits an active stop or a durable skip that is committed before that lock; the summary sheet contains only the omitted count.
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

`@nestjs/throttler` is **in-memory per process**. Phone login and phone-signup completion have tighter limits. Email registration and email-password login are closed.

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
