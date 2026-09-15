# ADR-001: Visit write idempotency

**Status:** Accepted  
**Date:** 2026-09-06

## Title

Idempotency-Key for `POST /visits`

## Context

A Visit is a completed historical interaction and is a source of truth. Mobile clients, timeouts, and lost responses cause retries of `POST /visits`. Duplicate rows corrupt intelligence.

## Problem

Retries after a committed write must not create a second Visit. Two legitimate visits at the same `visitedAt` must still be allowed.

## Options considered

1. Unique `(customerId, visitedAt)` — rejects legitimate same-instant visits.
2. Idempotency-Key table scoped to tenant + actor + operation + key, with a request fingerprint of `customerId` + `visitedAt`.
3. Both.

## Decision

Option 2. Header `Idempotency-Key` is optional for backward compatibility. The Flutter client always sends a UUID generated once per user-initiated save (reset if the user changes the visit time). Same key + same fingerprint returns the original Visit without a second outbox or audit row. Same key + different fingerprint returns 409. Different keys with the same payload create two Visits.

## Why this decision

`visitedAt` is not a business unique key. PostgreSQL `ON CONFLICT DO NOTHING` on the idempotency unique index serializes concurrent retries without aborting the surrounding transaction.

## Consequences

- New `idempotency_records` table.
- Visit create, idempotency row, outbox, and audit remain one transaction.
- If the visit is later deleted, a retry of the same key returns 404 rather than inserting a replacement visit.
- Keys are not a generic framework for every POST.
- `POST /visits/complete-with-sale` reuses this table with operation `VISIT_COMPLETE_WITH_SALE` and a fingerprint of customer, visitedAt, service, amount, and currency.

## Later use of the same table

Retention of keys older than `IDEMPOTENCY_RETENTION_DAYS` (default 7) is implemented by the worker.

The same `idempotency_records` table is reused (different `operation` values) for complete-with-sale, standalone transactions, opportunity actions, opportunity/manual messages, and VIP mutating APIs. It is still not a generic middleware for every POST.

Campaign aggregates were never added; messaging uses this table plus the Tehran-day unique index.
