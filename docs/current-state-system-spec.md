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

API input contract: `PATCH /salon` leaves omitted fields unchanged; `name` requires a nonblank string and is trimmed before its 120-character limit, while explicit `null` clears only nullable `phone`/`address`. Customer, service, and VIP list metadata PATCH fields reject explicit `null` where non-nullable. Transaction and visit-with-sale money remains decimal-string IRR, with `NUMERIC(19,2)` bounds checked before writes. Visit/transaction/return-commitment instants require an explicit timezone (offsets accepted); UTC date filters require a real `YYYY-MM-DD` calendar date. Opaque list cursors reject malformed encoding, tuples, timestamps, identifiers, and integer components with the standard 400 validation response; valid ordering and tenant scope are unchanged.

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

`GET /intelligence/summary` covers every customer in the authenticated salon, with complete derived status, signal, and unsuppressed opportunity counts and completed-transaction IRR totals. It scans customer/visit metrics in bounded 500-customer internal batches; the retained `hasMore` response field is always false because the summary is complete. `GET /intelligence/segments` and `/intelligence/opportunities` return up to 200 eligible results per page, globally ordered by days since last Visit descending, customer UUID descending, then opportunity type descending where applicable. Segment customers without Visits rank at −1; opportunity rows without Visits rank at 0. Filters are applied to qualifying outputs across the full tenant population. `hasMore=true` means another eligible result was found and always includes a usable `nextCursor`.

New list cursors retain the evaluation instant, active status/type filter, and result sort tuple. A continued read uses the same retention and UTC revenue reporting instant; pre-existing two-part segment and three-part opportunity cursors remain accepted and use the current instant. These are live reads, not database snapshots: concurrent customer, visit, action, or transaction changes can affect later pages or a multi-query summary. Refresh to reconcile. Flutter **Today** and **Opportunities** use their newer serving paths; customer detail still uses `GET /intelligence/customers/:id`; there is no segments screen.

**Opportunities V2** `GET /opportunities/workspace?filter=ALL|SALON_MESSAGES|VIP|REVENUE_DROP` **Implemented (API + Flutter):** server-paginated derived-on-read workspace. Tenant from JWT. Not the intelligence 5,000 scan. Cancelled unsent `MessageRequest` rows appear as `CANCELLED` in execution history; they do not count as SENT and are not recovery interventions.

- `ALL` / `SALON_MESSAGES` / `VIP`: messaging execution facts. Ordinary rows are one `Customer` per latest non-VIP `MessageRequest` (`customerId` set, `vipRequestId` null). VIP rows are one `MessageRequest` per VIP-origin request (`vipRequestId` set). Identities `SALON_CUSTOMER:<customerId>` and `VIP_RECIPIENT:<messageRequestId>` are not merged by phone.
- Message state is derived from `MessageRequest` + `MessageDelivery` + `ReturnCommitment.sourceMessageRequestId` + canonical COMMITMENT_BACKED/OBSERVED evidence for **that reference request**. Canonical SENT requires `MessageDelivery.status=SENT` and `submittedAt`. FAILED is not queued. `IN_PIPELINE` covers DISPATCHED/PENDING/PROCESSING. `SENT_WITH_*` is factual association, not causality.
- `REVENUE_DROP` (visible label «افت درآمد») is a **visit-lapse proxy**, not monetary revenue loss: Visit exists in the previous comparable Jalali month window in Asia/Tehran and no Visit exists in the current comparable window. Equal elapsed time; shorter previous months clamp to the last previous-month instant. No amount is displayed. Qualifying customers can be multi-selected (max 30) into the existing `POST /customers/:id/messages` composer.

Old `REACTIVATION` / `CUSTOMER_RETURN` chips are removed from this UI. OpportunityAction history and intelligence APIs remain.

`GET /salon/overall-performance` **Implemented (API + Flutter Today):** all-time derived-on-read counts for the authenticated salon (`OWNER`/`MANAGER`/`STAFF`): Customer rows, SENT non-VIP customer `MessageDelivery`s, SENT VIP-origin `MessageDelivery`s (`vip_request_id`), all `ReturnCommitment`s, unique customers with COMMITMENT_BACKED and/or OBSERVED visit evidence (same association SQL as recovery outcomes, no week filter, one customer once), unique customers with ≥2 Visits. Not causal. Not the intelligence 5,000 scan.

`HIGH_VALUE` / cross-sell: **Deferred**.

---

## 10. Opportunity actions

**Implemented:** `POST .../actions` (required Idempotency-Key), list, customer list, complete, dismiss.

Statuses `OPEN COMPLETED DISMISSED`. `sourceVisitId` episode snapshot. Concurrent create coalesces. Messaging does not complete the action.

---

## 11. Messaging

**Implemented.** See `docs/messaging-domain.md`.

Salon: opportunity messages, manual messages, get, customer message list, manual-outreach inbox.

Admin: `GET /admin/message-queue`, get one, `select-bale`, `select-manual`, `mark-manual-sent` (QUEUED may be fulfilled in one step), `cancel` (QUEUED or manual PENDING only; durable `CANCELLED`, not a delete), `retry`. Derived ordinary salon folders: `GET /admin/messages/normal/salons` and `GET /admin/messages/normal/salons/:salonId` (customer-bound, non-VIP only; SQL aggregates; cursor pagination; optional salon-name `q`).

Worker: BALE only. Outbox acknowledgements are fenced by claim generation; each Bale delivery attempt has a token and lease, while admin retries advance the logical activation generation. Stale handler outcomes leave the event reclaimable without terminal evidence. Each bounded concurrent batch drains all started handlers before polling again, including after timeout cancellation. `SENT` = provider accepted.
MessageRequest owns the immutable execution destination for new customer and VIP intents. Customer phone edits affect future requests only; admin execution and Bale worker use the request snapshot. Legacy ordinary rows without provable destination remain null and cannot be sent automatically. `SENT` means provider accepted the request destination, not delivery or reading.

Daily limit Tehran calendar, shared opportunity+manual. VIP excluded from daily limit.

`ReturnCommitment` **Implemented (API + Flutter customer/recovery UX):** `POST /messages/:messageRequestId/return-commitments` (Idempotency-Key required), `PATCH /return-commitments/:id` (Idempotency-Key + `updatedAt` CAS), `GET /customers/:id/return-commitments`, `GET /return-commitments/upcoming` (14-day default / 31-day max **query window**, not a booking horizon), `GET /return-commitments/open` (**operationally open** agreed returns: `actualVisitId` IS NULL **and** no same-salon Visit with `visitedAt` > source `MessageDelivery.submittedAt`; not identical to unlinked rows; one row per customer from remaining open commitments by earliest `expectedAt` then id; overdue included and flagged; phone from `Customer`), `POST /return-commitments/:id/arrive` (atomic Visit + link; OWNER/MANAGER optional sale; 409 `RETURN_COMMITMENT_VISIT_REVIEW_REQUIRED` if `actualVisitId` is null but a post-outreach Visit already exists — does not infer `actualVisitId`; replay of a successful linked arrive is unchanged), `POST /return-commitments/:id/link-visit` (API correction; **not** Flutter V1). Platform admin: `POST /admin/message-queue/:messageRequestId/return-commitments` and `PATCH /admin/return-commitments/:id` record the **same** tenant-bound row; actor is XOR salon `User` XOR `PlatformAdmin` (CHECK). Salon reads expose `recordedBySupport`, not admin identity. Customer commitment reads include derived `operationallyOpen`. Message GET/list include `returnCommitment` summary or null. OWNER/MANAGER/STAFF. Not a Visit or appointment. Flutter records agreed return time from SENT customer outreach (salon profile or admin message sheet), edits **operationally open** commitments, arrives via `/arrive` (not generic `POST /visits`), and shows future commitments separately from completed visits. OWNER/MANAGER open «نتیجه ارسال پیام‌ها» (recovery outcomes) which still lists «مشتریان نوبت گرفته بازگشتی». STAFF open that operational list from Today without recovery KPI routes. Composer shows upcoming commitments as send-time context only (failure does not block send). No calendar, booking, or capacity. Salon-wide EVENT recovery totals: `GET /recovery/outcomes/*`. Independent `POST /visits` / complete-with-sale **do not** infer `actualVisitId` (explicit link only). A later authoritative Visit **does** settle operational follow-up without becoming COMMITMENT_BACKED.

`GET /customers/:id/observed-returns` **Implemented (API + Flutter):** derived last-touch SENT message → later Visit. Flutter presents OBSERVED only when the same Visit is not already shown as COMMITMENT_BACKED. Copy is evidence-based (associated recorded revenue), not campaign causality.

`GET /recovery/outcomes/summary` and `GET /recovery/outcomes/returns` **Implemented (API + Flutter owner/manager):** live EVENT-based salon totals for the Asia/Tehran Saturday business week `[Saturday 00:00, next Saturday 00:00)`. Counts SENT eligible deliveries (`submittedAt`), ReturnCommitments (`createdAt`), commitment-backed Visits (`visitedAt` and `visitedAt > source submittedAt`), associated COMPLETED visit-linked IRR on those Visits only, and OBSERVED-only Visits after `visitId` dedup (COMMITMENT_BACKED wins). No rates, no causal/incremental claims, no intelligence scan / 5,000 cap. STAFF is forbidden. Corrections (void, unlink) appear on the next read.

Flutter pages COMMITMENT_BACKED, OBSERVED, operationally open commitments, and customer-detail messages/commitments/observed returns separately through their existing cursors. A failed later page keeps loaded rows and offers retry; changing the reporting period or customer resets the page state and ignores an old response. Visible row counts mean **loaded rows**, while recovery headline totals come from the separate aggregate. Customer-detail OBSERVED cards wait for all commitment pages before applying commitment precedence. API evidence selection uses full tenant history before period and cursor filtering; each endpoint's existing keyset order and maximum page size remain unchanged. Keyset pages are live reads, not a snapshot: concurrent inserts, deletes, or edits can change later results, so refresh to reconcile.

Return-evidence selection is all-history and tenant/customer-ID based before week or page filtering: eligible SENT non-VIP delivery with non-null `submittedAt`, strict `submittedAt < visitedAt`, last touch per Visit (`submittedAt`, delivery `createdAt`, id descending), then first Visit per delivery (`visitedAt`, Visit `createdAt`, id ascending). The raw customer observed-return endpoint keeps that OBSERVED association even for a commitment-linked Visit; customer presentation and effective recovery/overall/workspace views give a valid explicit COMMITMENT_BACKED link precedence **after** first-return selection. Thus a September 9 send claimed by a September 10 linked Visit cannot be counted again as OBSERVED on September 15; a second send on September 14 can select September 15. An unlinked later Visit may settle operational follow-up without creating explicit fulfillment. COMMITMENT_BACKED requires matching salon, customer, request, delivery, SENT submission, and strict Visit chronology; inconsistent legacy links remain stored but do not create return evidence. An otherwise provenance-valid explicit link to a Visit at/before its own source submission is not COMMITMENT_BACKED, but the existing visit-level precedence rule still suppresses OBSERVED for that same Visit. Period counts use `visitedAt` for returns, `submittedAt` for sent messages, and `createdAt` for recorded commitments. Associated money uses COMPLETED Visit transactions only and distinguishes no recorded sale from a recorded zero sale. These read changes do not rewrite historical Visit, Transaction, MessageRequest, or MessageDelivery rows.

---

## 12. VIP

**Implemented** (API + Flutter in current repository HEAD).

Admin: import template/import (phone required, name optional), list CRUD-ish (patch/delete), entitlements grant/revoke, list salons, export request Excel, sample download, `dispatch-manual`, `dispatch-bale` (placeholder). Derived **admin VIP outreach workspace** (not a folder table): `GET /admin/vip/outreach/salons` (cursor `latestActivityAt DESC, salonId DESC`, optional `q` salon-name contains) and `GET /admin/vip/outreach/salons/:salonId` / `GET /admin/vip/outreach/requests/:id`. Folder identity is `salonId`. Counts are SQL aggregates from `VipRequest` / `VipRequestRecipient` / `MessageRequest` / `MessageDelivery`. Canonical SENT is delivery `SENT` + `submittedAt`. Salon JWT is 403. `VipTargetContact.displayName` is optional; unnamed targets persist `null` and render as «بدون نام» in admin. Phone `^09[0-9]{9}$` remains required.

Salon: `GET /vip/capability`, `GET /vip/regions` (14 canonical Tehran regions; counts are ACTIVE + `regionCode` set + unreserved only), `GET /vip/lists?regionCode=01` (that region’s ACTIVE lists only; historical `regionCode` null lists excluded), `POST /vip/requests`, get, upload sample, submit, download own sample. Flutter VIP request flow is region-first. `VipRequest.geographicRange` remains message-template copy and may be prefilled from the selected region name.

Statuses and quota: `docs/messaging-domain.md`. Rolling 7-day quota of 500 is a **temporary** product limit; request sizes remain 30/50/100. VIP Bale **not** implemented.

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
| Admin message queue | Implemented as **ارسال پیام عادی** salon folders + detail; queue removal and manual-sent capabilities are server-owned |
| Admin VIP lists/detail | Implemented (inventory; not the VIP send destination). Entitlement salon selection uses `GET /admin/vip/salons`: 50-row pages ordered by `createdAt DESC, id DESC`, with an optional case-insensitive full-population name `q`. `nextCursor` encodes the last returned timestamp and ID and is present exactly when `hasMore` is true. Flutter debounces search, resets its cursor on query change, retains prior pages on a later-page error, and retries that page. Names need not be unique; entitlement actions use salon IDs. Live pages are not a snapshot under concurrent changes. |
| Admin VIP outreach folders | Implemented as **ارسال پیام VIP** (`/admin/vip/outreach`) |
| Today dashboard | Implemented (overall performance + operational agreed-return entry; not intelligence summary) |
| Customers list/detail/create/edit/import | Implemented |
| Customer activity on profile | Implemented |
| Record visit / sale | Implemented |
| Manual outreach multi-select + composer | Implemented (upcoming ReturnCommitment context on composer) |
| Customer message history + agreed returns + arrival | Implemented (Customer Detail; not a booking surface) |
| Opportunities V2 four-filter workspace | Implemented (`GET /opportunities/workspace`; not intelligence worklist) |
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
