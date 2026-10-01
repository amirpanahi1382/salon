# Data model

**Status:** Physical persistence as in `packages/database/prisma/schema.prisma` and SQL migrations  
**Domain meaning:** `domain/domain-model.md`

PostgreSQL 16. Prisma 6.4.1. No extra databases. No RLS. No Event Sourcing.

Philosophy: strong constraints + useful indexes. Do not add tables to mirror every derived DTO.

---

## 1. Tenant

`salons` is the tenant. Salon-owned tables carry `salon_id`.

Core CRM/money graph uses **composite tenant FKs**: child `(entity_id, salon_id)` → parent `(id, salon_id)` with `ON DELETE RESTRICT`.

Platform-owned: `platform_admins`, `vip_target_lists`, `vip_target_contacts` (list-scoped, not salon CRM).

---

## 2. Tables

| Table | Kind | Notes |
| --- | --- | --- |
| `salons` | Tenant | `ACTIVE` / `SUSPENDED` |
| `users` | Operator | Unique `email`; `role`, `status`; unique `(id, salon_id)` supports composite creator FKs |
| `platform_admins` | Platform operator | No tenant |
| `customers` | Business fact | Unique `(salon_id, phone_number)` |
| `visits` | Business fact | `visited_at`; unique `(id, salon_id)` |
| `services` | Catalog | Unique `(salon_id, name)` |
| `transactions` | Financial fact | Prisma model `LedgerTransaction`; `amount NUMERIC(19,2)`; `currency CHAR(3)` default IRR; `COMPLETED` / `VOIDED` |
| `transaction_items` | Financial fact | `quantity`, `unit_price`, `total_amount`; FK to transaction and service with salon composite |
| `opportunity_actions` | Human fact | `source_visit_id` UUID nullable, **not FK** |
| `message_requests` | Intent | See CHECKs below |
| `message_deliveries` | Execution | Unique `message_request_id`; unique `(salon_id, provider_request_id)` |
| `return_commitments` | Recovery fact | Unique per `(salon_id, source_message_request_id)` and `(salon_id, source_message_delivery_id)`. Partial unique `(salon_id, actual_visit_id)` WHERE not null. Creator/updater XOR: composite salon user FKs **or** `platform_admins.id` (`return_commitments_created_actor_chk` / `updated_actor_chk`). Partial index `(salon_id, expected_at, id)` WHERE `actual_visit_id` IS NULL is a **candidate** filter for the operational open list; operational openness also requires NOT EXISTS a later Visit after source `submitted_at`. Not an appointment. |
| `vip_target_lists` | Platform list | Reservation CHECK: `IN_USE` iff reserved fields set. Optional `region_code` (`01`–`14` CHECK); null = historical/non-regional |
| `vip_target_contacts` | List rows | Phone CHECK `09[0-9]{9}`; unique phone per list; display name optional |
| `vip_salon_entitlements` | Product flag | Unique `salon_id`; revoke pair CHECK |
| `vip_requests` | Intent | Unique `(id, salon_id)` |
| `vip_request_recipients` | Snapshot | Optional `message_request_id`; linked request must share `salon_id` |
| `vip_sample_works` | Committed metadata | Unique `object_key`; bytes in MinIO; nullable `verified_at` is point-in-time evidence and remains null for unverified history |
| `vip_sample_work_uploads` | Durable upload intent | Request/tenant, digest/type/size, reserved position, generation/token/lease, and optional committed sample link |
| `vip_sample_work_cleanups` | Abandoned-attempt cleanup | Unique generation-specific key; request + claim generation fences; bounded worker retries |
| `outbox_events` | Infra | `PENDING/PROCESSING/PROCESSED/DEAD_LETTER` |
| `audit_logs` | Infra | `tenant_id` nullable (platform actors) |
| `idempotency_records` | Infra | Unique `(tenant_id, actor_id, operation, key)` |

There are **no** `campaigns`, `products`, or `appointments` tables. `return_commitments` is not an appointment table.

---

## 3. Important keys and CHECKs

MessageRequest SQL (migrations, not all visible as Prisma attributes):

- `message_requests_opportunity_context_consistent`: `(action_id IS NULL) = (opportunity_type IS NULL)`
- Recipient origin XOR (customer vs VIP snapshot) — `message_requests_recipient_origin_consistent`
- Partial unique `message_requests_salon_customer_day_key`: `(salon_id, customer_id, message_business_date) WHERE counts_toward_daily_limit`
- Partial unique one MessageRequest per VIP recipient phone on a request

Opportunity actions: unique open-row and per-episode uniqueness enforced in SQL (`ON CONFLICT DO NOTHING` on insert).

Phase 8 adds tenant-composite creator FKs on `opportunity_actions`, `message_requests`, `message_deliveries`, and `vip_requests`: `(created_by[_user_id], salon_id) → users(id, salon_id)`. `vip_request_recipients(message_request_id, salon_id) → message_requests(id, salon_id)` is optional: a null `message_request_id` remains valid under PostgreSQL's default `MATCH SIMPLE`. All five use `ON DELETE RESTRICT ON UPDATE RESTRICT`; parent IDs and tenant ownership cannot cascade into historical rows. The existing `users(id, salon_id)` and `message_requests(id, salon_id)` unique keys suffice. The existing unique `vip_request_recipients.message_request_id` index still enforces one recipient per linked message. Prisma represents its inverse as a list because Prisma 6 requires another composite unique index to model this particular composite relation as one-to-one; the physical unique index remains authoritative.

VIP list contact count 1–100. Sample works 1–3 at submit (application).

Pending `UPLOADING` rows reserve a position through a partial unique `(vip_request_id, position)` index. CHECKs require ownership fields only in `UPLOADING` and a verified committed link only in `AVAILABLE`. Cleanup keys originate only from a durable upload generation and are never inferred by listing the bucket.

---

## 4. Lifecycle / retention

| Store | Retention |
| --- | --- |
| Domain facts (customers, visits, txs, messages, VIP) | Keep; no silent product delete job |
| `outbox_events` PROCESSED | `OUTBOX_PROCESSED_RETENTION_DAYS` (14), batched |
| `outbox_events` DEAD_LETTER | Kept (no auto-delete) |
| `idempotency_records` | `IDEMPOTENCY_RETENTION_DAYS` (7) |
| `audit_logs` | Unbounded today (debt) |
| Message bodies | Operational PII; recommended future archive ~24 months — **not implemented** |

Customer/visit **hard delete** is allowed only when financial and message history rules pass.

---

## 5. Money

See `domain/financial-domain.md`. Header amount is authoritative. Phase 9 deferred constraint triggers check nonempty `SUM(transaction_items.total_amount) = transactions.amount` on new/financially changed rows at commit; an immediate payload-free trigger checks new/financially changed item arithmetic. Both statuses are covered. Existing mismatches are not rewritten or automatically validated; use the Phase 9 read-only preflight and provenance review.

---

## 6. Intelligence

No intelligence tables. Read path: newest N customers + SQL visit aggregates + completed-transaction aggregates + `@salon/shared` rules.

---

## 7. Known data debt

Tracked in `docs/technical-debt.md`. Highlights: no RLS; Phase 8 historical relationship validation remains pending; `transaction_items` lack `(id, salon_id)` unique; finite idempotency window; unused Redis; some outbox types have no real consumer; possible redundant indexes from scale migrations.

Do not “fix” these inside a documentation change.

---

## 8. Migrations

Under `packages/database/prisma/migrations/`. Foundation → customers → visits → idempotency → scale indexes → revenue → opportunity actions → message deliveries → message request queue → optional action/manual outreach → opportunity context CHECK → source visit → VIP (+ quota/composite FK follow-ups).

Apply only via Prisma; do not edit applied migration files.

Phase 8 migration `20260927120000_phase8_tenant_composite_relations` installs five composite `NOT VALID` FKs without rewriting old rows. The forward-only `20260927130000_phase8b_preserve_historical_parent_fks` migration restores and validates the five original global-ID parent FKs alongside them. This is necessary because an old cross-salon VIP recipient link did not match its parent under the composite FK alone: deleting that parent succeeded and orphaned the historical link. The extra global-ID constraints are intentionally migration-only; Prisma models the composite relations, and schema diff proposes dropping the extra FKs. Do not apply that generated drop. Both families use `ON DELETE RESTRICT ON UPDATE RESTRICT`; the old global-ID FKs used `ON UPDATE CASCADE`. Parent metadata updates remain legal. Tenant/key moves can be rejected by other references and are not supported application workflows. An isolated parent MessageRequest tenant move can still succeed when only an already inconsistent recipient refers to it; the global-ID guard preserves parent existence, while the composite relation remains unvalidated. No data is backfilled or repaired.

PostgreSQL checks inserted rows and updates that assign a composite key. On a historical mismatch, an unrelated mutable-column update succeeds. Raw SQL `SET reference = reference` fails with `23503`, as do another bad reference and an invalid tenant change. Prisma 6 `updateMany` explicitly assigning the existing scalar value succeeded in disposable tests for all five relationships; its generated UPDATE was observed, so do not infer raw-SQL behavior from the ORM call or vice versa. Application commands that update only status can proceed; commands creating a new child with that bad creator fail atomically. `NOT VALID` does **not** mean all updates to old bad rows fail, nor does migration success establish historical tenant integrity.

Operator sequence: run read-only `packages/database/prisma/preflight/phase8_tenant_relations.sql` on the intended database before deployment. Install both migrations with the repository's Prisma `migrate:deploy` workflow in a planned write window. The Phase 8 `ALTER TABLE` steps need strong child-table locks and parent FK locks; Phase 8B's validated global-ID FKs scan historical rows and may fail atomically if orphaned parents exist. Investigate any migration failure without rewriting history. The composite FKs enforce new key writes immediately but remain `convalidated = false`. Run preflight again before later validation. If violations exist, obtain an explicit provenance decision for each; do not blanket-delete, null, reassign, or copy current tenant/user values onto historical facts.

When all five preflight counts are zero, validate each composite FK separately in a maintenance window (validation scans history and takes locks, and a failure leaves historical rows unchanged):

```sql
ALTER TABLE opportunity_actions VALIDATE CONSTRAINT opportunity_actions_created_by_salon_id_fkey;
ALTER TABLE message_requests VALIDATE CONSTRAINT message_requests_created_by_user_id_salon_id_fkey;
ALTER TABLE message_deliveries VALIDATE CONSTRAINT message_deliveries_created_by_salon_id_fkey;
ALTER TABLE vip_requests VALIDATE CONSTRAINT vip_requests_created_by_user_id_salon_id_fkey;
ALTER TABLE vip_request_recipients VALIDATE CONSTRAINT vip_request_recipients_message_request_id_salon_id_fkey;
SELECT conrelid::regclass, conname, convalidated FROM pg_constraint
WHERE conname IN (
  'opportunity_actions_created_by_salon_id_fkey',
  'message_requests_created_by_user_id_salon_id_fkey',
  'message_deliveries_created_by_salon_id_fkey',
  'vip_requests_created_by_user_id_salon_id_fkey',
  'vip_request_recipients_message_request_id_salon_id_fkey');
```

All five final `convalidated` values must be true. Synthetic-only tests: on a **task-owned disposable** PostgreSQL instance create `phase8_relations`, apply the 24 predecessor migrations and `verification/phase8_fixture_before.sql`, then deploy both Phase 8 migrations. Run `psql -v ON_ERROR_STOP=1 -f` for `phase8_constraint_checks.sql`, `phase8b_historical_checks.sql`, and `phase8b_validate_dirty.sql`; each asserts outcomes and fails nonzero on mismatch. With `PHASE8B_ISOLATED_DATABASE_URL` set to that exact loopback database, run `pnpm --filter @salon/api test:e2e --runInBand phase8b-historical-relations.e2e-spec.ts` on a fresh fixture. Separately create empty `phase8b_clean`, deploy all migrations, then run `phase8b_validate_clean.sql`. Never substitute an application or preview database. These probes establish synthetic behavior only; target-database preflight, provenance review, and composite validation remain deployment gates. Pre-existing Prisma drift includes ReturnCommitment index order/constraint names and two index names; Phase 8B additionally causes five intentional global-ID FK drop suggestions.
