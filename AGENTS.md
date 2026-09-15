# AGENTS.md

Operating contract for AI coding agents and engineers in this repository.

Think like a **Product Architect + Staff Engineer + Domain Expert**. Do not behave as a code generator.

---

## Product identity

This is a **vertical SaaS for women's beauty salons**.

North star:

> Help beauty salons generate more revenue from customers they already have.

Primary wedge: **Retention & Revenue Intelligence**.

The product is **not** a booking system, salon calendar, POS, accounting package, payroll/commission engine, inventory ERP, generic CRM, or supplier marketplace.

Completed **visits** are historical facts. **Transactions** are financial facts. **Intelligence** is derived. **OpportunityAction** is a durable human response. **MessageRequest** is durable send intent. **MessageDelivery** is execution. **Bale/Safir** is a provider, not the domain.

VIP outreach is a **separate** capability (platform-managed contact lists). It reuses the messaging execution pipeline. It does **not** create salon `Customer` rows.

Long-term wedges (marketplace, attribution/incentives) exist as **strategy**, not as current implementation. Do not build them unless product docs explicitly pull them into scope.

---

## How to work

Before any non-trivial change:

1. Inspect the repository (code, schema, tests).
2. Read the relevant authoritative docs listed below.
3. Identify the domain boundary and tenant/money impact.
4. Implement the smallest production-grade change.
5. Test the business-critical path.
6. Update the docs that own that truth.

When documentation and implementation disagree, investigate. Do not silently treat old MVP checklists as current scope, and do not treat code accidents as product strategy.

---

## Hard constraints

### Tenant safety

- `Salon` is the tenant.
- Tenant identity comes from the authenticated principal (`JWT` `tid` after DB user lookup). Never from request body, query, headers, files, or Flutter “salonId”.
- Ignore or reject unexpected `salonId` input.
- Every query, job, outbox payload, and file key that touches salon data must be tenant-scoped.
- Do not weaken composite tenant foreign keys `(id, salon_id)` on the money/CRM graph.
- There is **no PostgreSQL RLS** today. Application + schema constraints are the isolation mechanism. Do not assume RLS exists.

### Money safety

- Never use floating-point for money.
- Persist `NUMERIC(19,2)` / Prisma `Decimal`. APIs use **decimal strings**.
- Currency is **IRR** only.
- `Transaction.amount` is the financial source of truth. Line items must sum to the header (application-enforced today).
- Do not rewrite historical financial rows. **Void** instead.
- `ON DELETE RESTRICT` on financial history. Customer/visit delete must 409 when transactions (including `VOIDED`) or message history exist.

### Source of truth

| Kind | Examples | Rule |
| --- | --- | --- |
| Business facts | Customer, Visit, Service, User, Salon | Persist; do not invent from intelligence |
| Financial facts | LedgerTransaction, TransactionItem | Immutable except void |
| Derived intelligence | status, signals, opportunities, segments, revenue trend | Computed on read; never a competing ledger |
| Human action | OpportunityAction | Durable operational fact |
| Intent | MessageRequest, VipRequest | Durable business intent |
| Execution | MessageDelivery, VipSampleWork object bytes | Provider/storage state |
| Infrastructure | OutboxEvent, AuditLog, IdempotencyRecord | Transport, audit, retry safety |

Do not complete an OpportunityAction merely because a message was queued or sent.
Do not create a Visit or Transaction from messaging or VIP.

### Transactions, idempotency, outbox

- Domain write + audit + outbox row belong in **one database transaction**.
- Outbox delivery is **at-least-once**. Consumers must be idempotent.
- Worker handlers that actually send (Bale) must reuse `providerRequestId`.
- `Idempotency-Key` is required on selected mutating operations (visits-with-sale, transactions, opportunity actions, messages, VIP mutations). Same key + same hash replays; same key + different hash → 409.
- Idempotency rows older than `IDEMPOTENCY_RETENTION_DAYS` (default 7) are deleted. That window is the duplicate-key guarantee. Do not silently rely on keys older than retention.

### Messaging

- Business logic must not import Safir DTOs or call the provider from the salon request path.
- Queueing a MessageRequest must succeed without Bale credentials.
- VIP MessageRequests are **manual-only** until an explicit product decision implements VIP Bale. Do not “just enable Safir” for VIP.
- Message bodies are PII. Do not write them to audit metadata or logs.

### Migrations

- Schema changes go through Prisma migrations. Do not edit applied migration SQL.
- Do not add PostgreSQL extensions, RLS, sharding, or extra databases without an explicit decision.
- Prefer `RESTRICT` over cascade for historical facts.

### Security

- Never commit secrets. Never log passwords, JWTs, Authorization, phones, message bodies, or database URLs.
- Roles: salon `OWNER` / `MANAGER` / `STAFF`; platform operators are `platform_admins` with `scp=platform` and **no** tenant id.
- Passwords: Argon2id.

### Git

- Canonical remote: GitHub `amirpanahi1382/salon`.
- Pull current `main` before long work. Do not work for a long period on stale main.
- Commit only when asked. Do not push unless asked.
- Never force-push. Never rewrite shared history. Never discard another device’s work.

---

## Architecture rules

- **Modular monolith**: NestJS `apps/api` + NestJS `apps/worker` + Flutter `apps/mobile` + `packages/*`.
- Do not split microservices, add Kafka, CQRS, event sourcing, or multi-region designs for prestige.
- Do not add Redis to the request path just because Compose requires `REDIS_URL` (Redis is unused by application code today).
- MinIO is used for VIP sample-work bytes. Do not store those bytes in PostgreSQL.

---

## Testing expectations

Prioritize:

```text
Customer → Visit → Transaction → Intelligence → OpportunityAction → MessageRequest → Delivery
```

Also test: tenant isolation, authorization, financial void/delete 409s, messaging daily limit, VIP reservation/quota, idempotency conflicts.

Do not change tests merely to make documentation look true. Do not change production code to make old docs true.

---

## What not to build

Unless product strategy + MVP docs explicitly change:

- Booking, reservations, calendar, appointment scheduling
- POS hardware, tenders, receipts, payments, tax/accounting
- Payroll, employee commissions, attribution, rewards
- Inventory ERP
- Supplier marketplace, ordering, checkout
- Beauty product price catalog
- Campaign aggregates / bulk blast engines
- LLM/autonomous agents as the retention brain
- Microservices / Kafka / CQRS / event sourcing / sharding

Do not expand intelligence into a stored competing source of truth.

---

## Documentation map

`AGENTS.md` (this file) is **how to work**.

| Need | Read |
| --- | --- |
| Business intent | `business-model.md` |
| Product thesis, exclusions, sequencing | `product-strategy.md` |
| Current scope (implemented / deferred / out of scope) | `product/mvp.md` |
| What exists today | `docs/current-state-system-spec.md` |
| Architecture | `architecture/architecture.md` |
| Domain concepts | `domain/domain-model.md` |
| Money semantics | `domain/financial-domain.md` |
| Physical data | `architecture/data-model.md` |
| Messaging business | `docs/messaging-domain.md` |
| Messaging execution | `docs/messaging-architecture.md` |
| Bale/Safir provider contract | `architecture/messaging-bale-safir.md` |
| Operations | `architecture/operations.md` |
| Security | `architecture/security.md` |
| Scale notes | `architecture/performance.md` |
| Known debt | `docs/technical-debt.md` |
| Local setup | `README.md` |

When you change a capability, update **current-state** plus the one domain/architecture doc that owns it. Do not copy the same architecture into five files.

---

## Definition of done

A change is not done because it compiles. Evaluate, as relevant:

Business requirement · workflow · domain boundary · data integrity · authorization · tenant isolation · error handling · tests · observability · documentation · commercial impact.
