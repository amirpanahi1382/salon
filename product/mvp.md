# Current product scope

**Status:** Scope as of 2026-09-15  
**Authority for “does it exist?”:** `docs/current-state-system-spec.md`

This file defines **what the product is allowed to be now**. It is not a historical phase checklist.

Objective:

> Can women's beauty salons generate more revenue from existing customers by turning visit/transaction history into actions they actually take?

---

## Implemented MVP

These capabilities exist in the repository (API + schema + tests; Flutter unless noted).

### Salon & access

- Salon registration (`POST /auth/register`) creates tenant + OWNER
- Login JWT (salon users and platform admins)
- Roles: `OWNER`, `MANAGER`, `STAFF`
- Salon profile `GET/PATCH /salon`
- User administration APIs (create, role, status, last-OWNER invariant)
- Tenant isolation from JWT, not client `salonId`

### Customers

- Create, update, list/search (cursor, `ILIKE`), get, delete
- Phone: exactly `09` + 9 digits; same rule on Excel import
- Excel import (`POST /customers/import`) + template; 2 MB / 5,000 rows; no overwrite on duplicate phone
- Customer activity feed (`GET /customers/:id/activity`) — visits, transactions, opportunity actions (not dismissed), manual messages; no message bodies

### Visits & services & money

- Completed visits (`POST /visits`, not future bookings)
- `POST /visits/complete-with-sale` (OWNER/MANAGER) — visit + COMPLETED transaction + item in one DB transaction
- List/filter/export visits (Persian Excel, max 5,000)
- Delete visit (OWNER/MANAGER) unless a transaction references it
- Service catalog name + ACTIVE/INACTIVE; starter Hair/Nail on real registration
- Standalone `POST /transactions` and void (API; Flutter records sales via complete-with-sale)
- IRR `NUMERIC(19,2)`; void instead of rewrite

### Intelligence (derived, on read)

- Statuses: `NEW`, `ACTIVE`, `RETURNING`, `AT_RISK`, `INACTIVE`
- Opportunities: `REACTIVATION`, `CUSTOMER_RETURN`, `REVENUE_DECLINE`
- Signals including `OVERDUE`, `FREQUENT`, `REVENUE_DECLINING`
- Complete salon-wide summary + cursor-paginated, globally ranked opportunities and segments + per-customer intelligence

### Actions

- `OpportunityAction` OPEN / COMPLETED / DISMISSED
- Episode identity via `sourceVisitId` (snapshot of last visit at open; not an FK)
- Idempotent create; concurrent open coalesces

### Messaging (human queue)

- `MessageRequest` + `MessageDelivery` (BALE or MANUAL)
- Opportunity send and **manual outreach** (no fake Opportunity)
- One new salon+customer message per **Asia/Tehran** day (shared across opportunity + manual)
- Platform admin queue; worker sends Bale
- Flutter multi-select (session, max 30) + composer + server-authoritative status after submit
- Return commitment after SENT customer outreach (agreed future return time, not a booking); arrival creates an actual Visit; Flutter shows commitments vs completed visits and associated recorded revenue where present
- Owner recovery outcome view (EVENT, Tehran Saturday week): SENT follow-ups, recorded return commitments, commitment-backed Visits + associated recorded revenue, separate OBSERVED counts; no rates or causal claims

### VIP outreach

- Admin target lists (Excel, max 100 contacts)
- Salon entitlement grant/revoke (not billing)
- Reserve ACTIVE list, quota 100 contacts / 14 days, sample works in MinIO, submit CAS
- Recipients snapshotted; manual dispatch onto the **same** message queue
- VIP Bale: placeholder `BALE_NOT_IMPLEMENTED` / queue select-bale rejected

### Platform

- Modular monolith API + worker
- PostgreSQL, transactional outbox, audit, idempotency records
- Health, readiness, metrics, Pino, throttling, Swagger (non-prod)

---

## Partial

| Item | What exists | What does not |
| --- | --- | --- |
| Flutter vs API | Core salon loop + admin queue + VIP UI in current repository HEAD | User admin, salon PATCH, void, segments screen, standalone transactions |
| Campaigns | Per-customer MessageRequest | Campaign aggregate, recipient lists as a first-class entity, send-all |
| Outcome measurement | EVENT owner view + customer OBSERVED/COMMITMENT_BACKED evidence | Cohort analytics, rates, incremental/causal revenue |
| Consent | — | Opt-in/opt-out, STOP handling |
| VIP Bale | Status + API rejection | Safir send for VIP phones |
| Intelligence scale | SQL aggregates for visits | Uncapped, indexed serving for large tenants |
| Billing | VIP entitlement flag | Subscriptions, invoices, metering |
| Redis | Compose + required env | Application client |
| `GET /auth/owner` | Exists | Product surface; leftover auth probe |

---

## Deferred (allowed later, not current work)

- Beauty product price intelligence / Product tables
- Visit/transaction Excel import
- Customer notes, visit notes, service category/price list
- HIGH_VALUE / GROWING_VALUE spend segments
- Cross-sell opportunities from service mix
- Configurable retention thresholds per salon
- Message retention archive policy (recommended 24 months)
- `pg_trgm` / prefix search
- Redis-backed throttle for multi-instance API
- PostgreSQL RLS
- Refresh tokens
- VIP Bale
- Influenced-revenue reporting
- Marketplace, suppliers, ordering
- Attribution / commissions / rewards

---

## Explicitly out of scope

```text
Booking, reservations, calendar, staff scheduling
POS, payments, cash drawer, tax accounting
Payroll, employee commission engine
Inventory ERP
Supplier marketplace, ratings, checkout, delivery
Generic CRM for non-salons
LLM/autonomous messaging agents
Microservices, Kafka, CQRS, event sourcing, sharding
```

If a change starts to become one of these, stop.

---

## Success condition

The MVP is successful when salons **identify customers, take retention (or VIP) actions, and can see return visits / completed revenue** — not when every long-term wedge exists.

Older drafts that listed Campaign modules and Product Price screens as MVP are **superseded**.
