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
| `users` | Operator | Unique `email`; `role`, `status`; unique `(id, salon_id)` (for ReturnCommitment composite creator FKs). Other creator FKs still global-id only (TD-03) |
| `platform_admins` | Platform operator | No tenant |
| `customers` | Business fact | Unique `(salon_id, phone_number)` |
| `visits` | Business fact | `visited_at`; unique `(id, salon_id)` |
| `services` | Catalog | Unique `(salon_id, name)` |
| `transactions` | Financial fact | Prisma model `LedgerTransaction`; `amount NUMERIC(19,2)`; `currency CHAR(3)` default IRR; `COMPLETED` / `VOIDED` |
| `transaction_items` | Financial fact | `quantity`, `unit_price`, `total_amount`; FK to transaction and service with salon composite |
| `opportunity_actions` | Human fact | `source_visit_id` UUID nullable, **not FK** |
| `message_requests` | Intent | See CHECKs below |
| `message_deliveries` | Execution | Unique `message_request_id`; unique `(salon_id, provider_request_id)` |
| `return_commitments` | Recovery fact | Unique per `(salon_id, source_message_request_id)` and `(salon_id, source_message_delivery_id)`. Partial unique `(salon_id, actual_visit_id)` WHERE not null. Composite tenant FKs including creator/updater users. Not an appointment. |
| `vip_target_lists` | Platform list | Reservation CHECK: `IN_USE` iff reserved fields set |
| `vip_target_contacts` | List rows | Phone CHECK `09[0-9]{9}`; unique phone per list |
| `vip_salon_entitlements` | Product flag | Unique `salon_id`; revoke pair CHECK |
| `vip_requests` | Intent | Unique `(id, salon_id)` |
| `vip_request_recipients` | Snapshot | Optional `message_request_id` |
| `vip_sample_works` | Metadata | Unique `object_key`; bytes in MinIO |
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

VIP list contact count 1–100. Sample works 1–3 at submit (application).

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

See `domain/financial-domain.md`. Header amount is authoritative. Item sum equality is application-side.

---

## 6. Intelligence

No intelligence tables. Read path: newest N customers + SQL visit aggregates + completed-transaction aggregates + `@salon/shared` rules.

---

## 7. Known data debt

Tracked in `docs/technical-debt.md`. Highlights: no RLS; some creator FKs not tenant-composite; `VipRequestRecipient.messageRequestId` is not a tenant-composite FK; `transaction_items` lack `(id, salon_id)` unique; finite idempotency window; intelligence cap 5,000; unused Redis; some outbox types have no real consumer; possible redundant indexes from scale migrations.

Do not “fix” these inside a documentation change.

---

## 8. Migrations

Under `packages/database/prisma/migrations/`. Foundation → customers → visits → idempotency → scale indexes → revenue → opportunity actions → message deliveries → message request queue → optional action/manual outreach → opportunity context CHECK → source visit → VIP (+ quota/composite FK follow-ups).

Apply only via Prisma; do not edit applied migration files.
