# Financial domain semantics

**Status:** Implemented  
**Currency:** IRR only  
**Reporting time:** UTC calendar (not salon-local)  
**See also:** `domain/domain-model.md`, `architecture/data-model.md`

Header vs line-item equality is **application-enforced** (no database CHECK that `SUM(items) = transactions.amount)`). Treat that as known debt, not as a missing product feature.

## Source of truth

- A **Visit** is a completed historical interaction. It is not revenue.
- A **Transaction** (`transactions` table) is the financial source of truth.
- `Transaction.amount` is the authoritative total.
- Line items (`transaction_items`) must sum exactly to `Transaction.amount`.
- Amounts are PostgreSQL `NUMERIC(19,2)`, Prisma `Decimal`, and API **decimal strings** (never JS `number`).

## Lifecycle

- Create as `COMPLETED`. Amount cannot be patched.
- `OWNER`/`MANAGER` may set status to `VOIDED`. Repeat void is a no-op success.
- Revenue metrics include `COMPLETED` only.

## Visit link

`visitId` is optional. Same salon and same customer if present. Multiple transactions per visit are allowed.

`POST /visits` never creates a transaction. Revenue is never inferred from a Visit.

`POST /visits/complete-with-sale` is an explicit OWNER/MANAGER application operation that records a Visit **and** a COMPLETED Transaction (with TransactionItem → Service) in **one database transaction** when amount received is provided. Visit and Transaction remain separate entities. The Transaction remains the financial source of truth.

## Deletion

Financial rows use `ON DELETE RESTRICT`. They are never cascade-deleted.

- Customer delete: **409** if the customer has **any** transaction row (including `VOIDED`). Voided rows are still financial history and keep the customer FK.
- Visit delete: **409** if any transaction references the visit.
- Customers with no transactions keep the previous hard-delete of the customer and their visits.

## RBAC

Read services/transactions/revenue: `OWNER`, `MANAGER`, `STAFF`.  
Create/update service, create/void transaction: `OWNER`, `MANAGER` only.

## Metrics (no value labels)

- `totalRevenue` — sum of completed amounts  
- `transactionCount` — completed rows  
- `averageRevenuePerTransaction` — total / completed count (null if count is 0)  
- `averageSpendPerVisit` — sum of completed amounts **with a visitId** / distinct linked visits (null if none; unlinked transactions are excluded)  
- `lastRevenueAt` — max completed `occurredAt`  
- `revenueTrend` — this UTC month vs previous UTC month when the previous month has ≥1 completed transaction; otherwise null (`INCREASING` / `DECREASING` / `STABLE`)

`HIGH_VALUE` / `GROWING_VALUE` are deferred.

## Opportunity

Existing visit-based `REACTIVATION` / `CUSTOMER_RETURN` are unchanged.  
`REVENUE_DECLINE` is added only when `revenueTrend` is `DECREASING`.
