# Financial domain semantics

**Status:** Implemented  
**Currency:** IRR only  
**Reporting time:** UTC calendar (not salon-local)  
**See also:** `domain/domain-model.md`, `architecture/data-model.md`

Header vs line-item equality is application-validated and, for new financial writes after Phase 9 migration, database-enforced at commit. A valid transaction has at least one item and `transactions.amount = SUM(transaction_items.total_amount)` exactly. Each new/financially updated item has `total_amount = unit_price * quantity`. The database uses exact `NUMERIC`, not floating point. Both `COMPLETED` and `VOIDED` retain the same invariant; voiding changes status, not money.

## Source of truth

- A **Visit** is a completed historical interaction. It is not revenue.
- A **Transaction** (`transactions` table) is the financial source of truth.
- `Transaction.amount` is the authoritative total.
- Line items (`transaction_items`) must sum exactly to `Transaction.amount`.
- Zero-valued standalone transactions/items are valid with a nonempty item list. Visit-with-sale requires amount greater than zero.
- Amounts are PostgreSQL `NUMERIC(19,2)`, Prisma `Decimal`, and API **decimal strings** (never JS `number`).
- API writes accept unsigned decimal strings with at most two fractional digits and no surrounding whitespace, exponent, or separator. The maximum storable amount is `99999999999999999.99` IRR. The API checks each unit price, multiplied item total, aggregate total, and transaction header before persistence; quantity is a JSON integer from 1 to 9999. A value one cent over the bound is rejected instead of rounded or delegated to PostgreSQL.

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

The application exposes no amount, item, or financial deletion workflow. Direct database writes to financial columns must satisfy both item arithmetic and the header aggregate; deleting the last item or moving one without balancing both parents fails at commit. The existing database still permits deletion of an entire synthetic transaction and its items in one transaction after child deletion; Phase 9 does not add a new financial-history edit/delete API or change existing FK deletion behavior.

- Customer delete: **409** if the customer has **any** transaction row (including `VOIDED`). Voided rows are still financial history and keep the customer FK.
- Visit delete: **409** if any transaction references the visit.
- Customers with no transactions keep the previous hard-delete of the customer and their visits.

## Phase 9 historical compatibility and deployment

The forward-only migrations add deferred aggregate constraint triggers and a payload-free item-arithmetic trigger. They do **not** scan, validate, backfill, or rewrite old rows. Existing mismatched or empty-item rows remain visible; status-only voiding and unrelated header updates remain possible. A financial-column change to one of those rows must leave it valid at commit; an item arithmetic change must itself be valid. No `VALIDATE CONSTRAINT` command exists for the aggregate trigger, so a successful migration is **not** proof that old money history is valid.

Before deployment, run the read-only `packages/database/prisma/preflight/phase9_transaction_totals.sql` on the intended database through an approved read-only connection. It reports both statuses, empty items, total differences, bad item arithmetic, and tenant/link anomalies. Review each finding with financial provenance; do not invent balancing items or alter historical money to make the query green. Apply the three Phase 9 migrations using Prisma `migrate:deploy` after compatible writers are deployed: multi-statement header/item creation must use one database transaction. Pause financial writes until all three migrations finish; the intermediate `NOT VALID` item CHECK can include row values in database error detail before the second migration replaces it with a payload-free trigger. If deployment stops between migrations, keep writes paused until it resumes successfully. The migrations briefly lock `transaction_items` to create/drop a constraint and triggers; schedule accordingly. The supporting `(salon_id, transaction_id)` item index already exists. After a provenance decision for every exception, rerun the preflight and archive its result as the historical validation evidence. It is a read-only verification, not a persistent validated-constraint bit.

At application/default PostgreSQL `READ COMMITTED`, commit-time checks lock each affected parent transaction row in UUID order, then read item totals with a new statement snapshot. Competing item/header writes serialize or one transaction rolls back on an ordinary deadlock/constraint failure. The trigger explicitly rejects financial writes at stronger transaction isolation instead of claiming a stale-snapshot guarantee. Existing status-only voids do not change the financial amount and remain compatible with historical discrepancies. Privileged trigger disabling is outside the ordinary-write guarantee.

`READ COMMITTED` is therefore a deployment prerequisite for every connection that creates a transaction header, assigns `amount`/`salon_id`, or inserts, deletes, reparents, or changes financial columns on an item. The API's Prisma client and all supported financial command transactions set no isolation override, so they use PostgreSQL's configured default; there is no automatic transaction retry wrapper. Status-only voiding and header updates that do not assign `amount` or `salon_id` do not invoke the aggregate trigger and remain usable at stronger isolation. A no-op assignment to a guarded financial column still invokes it and is rejected above `READ COMMITTED`. The isolation error is deliberately not mapped to an input-validation response: it indicates unsupported deployment configuration and remains an internal failure rather than blaming client data.

Before enabling financial writes, an operator must check the intended database and application role without changing either setting:

```sql
SHOW default_transaction_isolation;
SELECT current_user, current_setting('transaction_isolation'),
       current_setting('default_transaction_isolation');
SELECT coalesce(d.datname, '*') AS database_name,
       coalesce(r.rolname, '*') AS role_name,
       s.setconfig
FROM pg_db_role_setting s
LEFT JOIN pg_database d ON d.oid = s.setdatabase
LEFT JOIN pg_roles r ON r.oid = s.setrole
WHERE s.setdatabase IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))
  AND s.setrole IN (0, (SELECT oid FROM pg_roles WHERE rolname = current_user));
```

Both effective values must be `read committed`, with no returned database/role setting that selects a stronger default. An empty catalog result means there is no relevant override. Repeat the check through the same connection configuration used by the API. If the result differs, keep financial writes paused and change the deployment configuration explicitly; application code does not silently downgrade it.

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
