# Current-state system specification

**Product:** Beauty Salon Revenue Intelligence (salon-facing name in Flutter: توجه سالن / Salon Attention)  
**As of:** 2026-09-15  
**Authority:** executable code, Prisma schema, SQL migrations, tests, Flutter client, then `.env.example` names, then other docs.

This document answers **what exists today**. It is not a roadmap.

Authority is **current repository HEAD**. Do not treat this as a statement about `origin/main` unless that remote has been verified.

Legend: **Implemented** · **Partial** · **Deferred** · **Out of scope** · **Known debt**

---

## 1. Product identity

**Implemented:** Vertical SaaS for a single-salon tenant. Thesis: more revenue from customers the salon already has. Visits are completed history, not bookings.

**Not encoded in schema:** “women’s salon” (product decision only).

**Out of scope (verified absent):** booking/calendar, POS hardware, payments, accounting, payroll, commissions, inventory, supplier marketplace, product price catalog, campaign aggregates, ML/LLM.

---

## 2. Repository layout

| Path | Used? |
| --- | --- |
| `apps/api` | Yes — NestJS HTTP |
| `apps/worker` | Yes — outbox + retention, no HTTP |
| `apps/mobile` | Yes — Flutter; not in pnpm workspace |
| `packages/{database,config,shared}` | Yes |
| `infra/docker` | Postgres used; Redis unused by code; MinIO used for VIP images |
| `packages/database/prisma/migrations` | Yes (foundation through VIP, including MessageRequest opportunity-context CHECK) |

```text
Flutter → NestJS API → PostgreSQL/Prisma
                         → outbox → Worker → Bale Safir (BALE only)
                         → MinIO (VIP sample works)
```

---

## 3. Auth

| Item | Status |
| --- | --- |
| `POST /auth/register` | **Implemented** — salon + OWNER + starter services (not `@example.test`); throttle 5/min |
| `POST /auth/login` | **Implemented** — generic failure copy; throttle 10/min |
| `GET /auth/me` | **Implemented** |
| `GET /auth/owner` | **Implemented** leftover OWNER probe |
| JWT salon | `sub`, `tid`, `role`; `JWT_EXPIRES_IN` default 8h; no refresh |
| Passwords | Argon2id |
| `POST /admin/auth/login` `GET /admin/auth/me` | **Implemented** — `scp=platform`, no tid |
| `pnpm db:bootstrap-admin` | **Implemented** — dev only; both env vars or neither; skipped in production bootstrap |
| Logout | Client token clear |
| Suspended salon / DISABLED user | Login and subsequent JWT checks fail closed |

Principal is re-loaded from DB (role/status/salon).

---

## 4. Salon users and RBAC

Roles: `OWNER` | `MANAGER` | `STAFF`. User status `ACTIVE` | `DISABLED`. Salon `ACTIVE` | `SUSPENDED`.

| Action | OWNER | MANAGER | STAFF | Platform admin |
| --- | --- | --- | --- | --- |
| Customers CRUD except delete | yes | yes | yes | no |
| Delete customer / visit | yes | yes | no | no |
| Record visit without sale | yes | yes | yes | no |
| complete-with-sale / create tx / void | yes | yes | no | no |
| Service write | yes | no | no | no |
| Service read ACTIVE | yes | yes | yes | no |
| User admin | any role | STAFF only | no | no |
| Intelligence / actions / messages / return commitments | yes | yes | yes | queue only |
| Owner recovery outcomes (`GET /recovery/outcomes/*`) | yes | yes | no | no |
| VIP salon routes | if entitled | if entitled | if entitled | lists/entitlements/dispatch |
| Message queue dispatch | no | no | no | yes |

Last active OWNER cannot be demoted/disabled. Flutter does **not** expose user admin or `PATCH /salon` (**Partial**).

---

## 5. Customers

**Implemented:** create, patch, get, cursor list (200), search `ILIKE` name/phone, hard delete with rules, Excel import + template.

Phone: `^09[0-9]{9}$`. Import does not convert `+98` / leading-zero-stripped numbers. Duplicate `(salonId, phone)` → skip `ALREADY_EXISTS` / `DUPLICATE_IN_FILE`. Max 5,000 rows / 2 MB. Tenant from JWT.

Delete 409 if any transaction (including VOIDED) or message history.

`GET /customers/:id/activity` — **Implemented**: visits, transactions, opportunity actions except DISMISSED, manual MessageRequests; no bodies; cursor 200.

---

## 6. Visits

**Implemented:** `POST /visits` (optional Idempotency-Key), `POST /visits/complete-with-sale` (required key, OWNER/MANAGER), list with `customerId` / UTC `date` / `from`/`to`, get, delete, `GET /visits/export` (Persian xlsx, max 5,000), `GET /customers/:id/visits`.

`visitedAt` must not be in the future (small clock skew). **No notes field.** Not a booking.

Flutter: record visit, list, export, delete for non-STAFF.

---

## 7. Services

**Implemented:** list (ACTIVE default; OWNER `includeInactive`), create/patch OWNER. Unique name per salon. Starter Hair Service + Nail Service.

**Not:** price list, duration, staff assignment, category column (older docs mentioned category — **not in schema**).

---

## 8. Revenue

**Implemented:** `LedgerTransaction` + items; create; list; get; void (repeat void no-op); customer transactions list. Amount decimal strings. IRR. Complete-with-sale writes visit+tx+item atomically.

Revenue metrics on intelligence summary/customer: completed only; UTC months; `REVENUE_DECLINE` when trend `DECREASING`. Details: `domain/financial-domain.md`.

Flutter sale path: complete-with-sale, not void UI (**Partial**).

---

## 9. Intelligence

**Implemented (derived on read):** `@salon/shared` `RuleBasedRetentionAnalyzer`. Statuses `NEW ACTIVE RETURNING AT_RISK INACTIVE`. Opportunities `REACTIVATION CUSTOMER_RETURN REVENUE_DECLINE`. Signals `NEW_CUSTOMER OVERDUE FREQUENT REVENUE_DECLINING`.

APIs: `GET /intelligence/summary|opportunities|segments|customers/:id`.

Cap: `INTELLIGENCE_CUSTOMER_CAP = 5000` (**Known debt**). Flutter shows summary + opportunities + customer intelligence; **no segments screen**.

`HIGH_VALUE` / cross-sell: **Deferred**.

---

## 10. Opportunity actions

**Implemented:** `POST .../actions` (required Idempotency-Key), list, customer list, complete, dismiss.

Statuses `OPEN COMPLETED DISMISSED`. `sourceVisitId` episode snapshot. Concurrent create coalesces. Messaging does not complete the action.

---

## 11. Messaging

**Implemented.** See `docs/messaging-domain.md`.

Salon: opportunity messages, manual messages, get, customer message list, manual-outreach inbox.

Admin: `GET /admin/message-queue`, get one, `select-bale`, `select-manual`, `mark-manual-sent`, `retry`.

Worker: BALE only. `SENT` = provider accepted.

Daily limit Tehran calendar, shared opportunity+manual. VIP excluded from daily limit.

`ReturnCommitment` **Implemented (API + Flutter customer/recovery UX):** `POST /messages/:messageRequestId/return-commitments` (Idempotency-Key required), `PATCH /return-commitments/:id` (Idempotency-Key + `updatedAt` CAS), `GET /customers/:id/return-commitments`, `GET /return-commitments/upcoming` (14-day default / 31-day max **query window**, not a booking horizon), `GET /return-commitments/open` (**operationally open** agreed returns: `actualVisitId` IS NULL **and** no same-salon Visit with `visitedAt` > source `MessageDelivery.submittedAt`; not identical to unlinked rows; one row per customer from remaining open commitments by earliest `expectedAt` then id; overdue included and flagged; phone from `Customer`), `POST /return-commitments/:id/arrive` (atomic Visit + link; OWNER/MANAGER optional sale; 409 `RETURN_COMMITMENT_VISIT_REVIEW_REQUIRED` if `actualVisitId` is null but a post-outreach Visit already exists — does not infer `actualVisitId`; replay of a successful linked arrive is unchanged), `POST /return-commitments/:id/link-visit` (API correction; **not** Flutter V1). Platform admin: `POST /admin/message-queue/:messageRequestId/return-commitments` and `PATCH /admin/return-commitments/:id` record the **same** tenant-bound row; actor is XOR salon `User` XOR `PlatformAdmin` (CHECK). Salon reads expose `recordedBySupport`, not admin identity. Customer commitment reads include derived `operationallyOpen`. Message GET/list include `returnCommitment` summary or null. OWNER/MANAGER/STAFF. Not a Visit or appointment. Flutter records agreed return time from SENT customer outreach (salon profile or admin message sheet), edits **operationally open** commitments, arrives via `/arrive` (not generic `POST /visits`), and shows future commitments separately from completed visits. Today dashboard and نتیجه پیگیری‌ها show «مشتریان نوبت گرفته بازگشتی» from the server open list (no client-side Visit hiding). Composer shows upcoming commitments as send-time context only (failure does not block send). No calendar, booking, or capacity. Salon-wide EVENT recovery totals: `GET /recovery/outcomes/*`. Independent `POST /visits` / complete-with-sale **do not** infer `actualVisitId` (explicit link only). A later authoritative Visit **does** settle operational follow-up without becoming COMMITMENT_BACKED.

`GET /customers/:id/observed-returns` **Implemented (API + Flutter):** derived last-touch SENT message → later Visit. Flutter presents OBSERVED only when the same Visit is not already shown as COMMITMENT_BACKED. Copy is evidence-based (associated recorded revenue), not campaign causality.

`GET /recovery/outcomes/summary` and `GET /recovery/outcomes/returns` **Implemented (API + Flutter owner/manager):** live EVENT-based salon totals for the Asia/Tehran Saturday business week `[Saturday 00:00, next Saturday 00:00)`. Counts SENT eligible deliveries (`submittedAt`), ReturnCommitments (`createdAt`), commitment-backed Visits (`visitedAt` and `visitedAt > source submittedAt`), associated COMPLETED visit-linked IRR on those Visits only, and OBSERVED-only Visits after `visitId` dedup (COMMITMENT_BACKED wins). No rates, no causal/incremental claims, no intelligence scan / 5,000 cap. STAFF is forbidden. Corrections (void, unlink) appear on the next read.

---

## 12. VIP

**Implemented** (API + Flutter in current repository HEAD).

Admin: import template/import, list CRUD-ish (patch/delete), entitlements grant/revoke, list salons, export request Excel, sample download, `dispatch-manual`, `dispatch-bale` (placeholder).

Salon: `GET /vip/capability`, `GET /vip/lists`, `POST /vip/requests`, get, upload sample, submit, download own sample.

Statuses and quota: `docs/messaging-domain.md`. VIP Bale **not** implemented.

Entitlement is not billing.

---

## 13. Infrastructure

| Concern | Status |
| --- | --- |
| Outbox + worker | **Implemented** |
| Audit | **Implemented** |
| Idempotency table | **Implemented** (7-day retention) |
| Health / ready / metrics | **Implemented** — ready = Postgres |
| Pino + request IDs | **Implemented** |
| Throttle | **Implemented** in-memory |
| Swagger `/docs` | **Implemented** non-prod default |
| MinIO | **Implemented** VIP images |
| Redis | env required, **unused** |
| RLS | **Not** present |
| Billing | **Out of scope** |

---

## 14. Flutter

Persian-first, RTL, `fa_IR`, Vazirmatn, **dark** charcoal/champagne theme (`AppTheme.app()`). Jalali used where the visits UX needs a local calendar day.

| Screen | Status |
| --- | --- |
| Login / register / splash | Implemented |
| Platform admin login | Implemented |
| Admin message queue | Implemented (agreed-return record/edit on SENT customer messages) |
| Admin VIP lists/detail | Implemented |
| Today dashboard | Implemented (`GET /intelligence/summary` + open agreed-return list) |
| Customers list/detail/create/edit/import | Implemented |
| Customer activity on profile | Implemented |
| Record visit / sale | Implemented |
| Manual outreach multi-select + composer | Implemented (upcoming ReturnCommitment context on composer) |
| Customer message history + agreed returns + arrival | Implemented (Customer Detail; not a booking surface) |
| Opportunities + complete/dismiss + message | Implemented |
| Salon VIP section (from opportunities) | Implemented |
| Visits list/export/delete | Implemented |
| Profile + OWNER services | Implemented |
| User admin / void / segments / salon PATCH | **Absent** (API exists) |

Android emulator API default `http://10.0.2.2:3000`. Physical device: LAN IP via `--dart-define=API_BASE_URL`. Production: HTTPS.

---

## 15. Tests (presence)

API E2E: auth, salon-user, customer, import, visit, visit-with-sale, export, finance, intelligence, action, messaging, observed-returns, return-commitments, vip, observability, reliability.

Unit: shared intelligence/money/vip, database constraints, many API use-case specs.

Flutter: `apps/mobile/test/*`.

Perf: `pnpm perf:bench` / `perf:load` (opt-in).

---

## 16. Flutter vs API gaps

**API-complete, Flutter-absent:** `PATCH /salon`, user CRUD/role/status, `POST /transactions`, void, `GET /intelligence/segments`.

**Flutter session-only until persist:** manual outreach selection (max 30) before each MessageRequest.

---

## 17. Events the worker actually handles

Side effects: `MessageDeliveryActivated`, legacy `MessageSendRequested`.

No-op processed: `SalonCreated`, `UserCreated`, `VisitCompleted`, `TransactionCreated`, `ActionCreated`, `MessageRequested`, `VipRequestCreated`, and other `DOMAIN_EVENT_TYPES` in `packages/shared/src/events.ts`.

Unknown types: dead-letter immediately.

---

## 18. Environment names (values never documented)

See `.env.example`: `DATABASE_URL`, `REDIS_URL`, `MINIO_*`, `JWT_*`, `OUTBOX_*`, `IDEMPOTENCY_RETENTION_DAYS`, `BALE_SAFIR_*`, `PLATFORM_ADMIN_*`, `SWAGGER_ENABLED`, pool/timeouts.

---

## 19. Related docs

`product/mvp.md` · `architecture/architecture.md` · `domain/domain-model.md` · `docs/technical-debt.md` · messaging docs.
