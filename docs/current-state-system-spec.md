# Current-State Business + Product + Technical Specification

**Product:** Salon Attention / Beauty Salon Revenue Intelligence Platform  
**Scan date:** 2026-09-07  
**Scope:** Existing implementation in the `cursor/` monorepo  
**Authority:** executable code, Prisma schema, migrations, automated tests, Flutter client, then configuration, then documentation  

This document describes **what the system actually does today**. It is not a roadmap.

Legend:

| Marker | Meaning |
| --- | --- |
| **IMPLEMENTED** | Verified in application code, schema, and/or tests |
| **IMPLEMENTED — NOT FORMALLY DOCUMENTED** | Present in code; product/architecture docs omit or understate it |
| **DOCUMENTED / INTENDED — NOT VERIFIED IN IMPLEMENTATION** | Spec or comment claims it; runtime code does not do it |
| **AMBIGUOUS — REQUIRES PRODUCT DECISION** | Two sources disagree, or behavior is incomplete |

No secrets are reproduced here. Environment variable **names** are listed; values are not.

---

## 0. Source of truth

Priority used for this scan:

1. NestJS API / worker application code  
2. Prisma schema + SQL migrations + CHECK / unique / FK constraints  
3. API unit/integration/E2E tests and Flutter tests  
4. Flutter (`apps/mobile`)  
5. `@salon/config` / `.env.example` (names only)  
6. `README.md`, `product/`, `architecture/`, `domain/`  
7. Comments  

When documentation disagrees with code, **code wins** and the disagreement is listed in §43.

Evidence convention: file / class / method / endpoint / Prisma model / migration / test / Flutter screen. Line numbers are not cited.

---

## 1. Full repository discovery

### 1.1 Workspace vs monorepo

The Cursor workspace root is `salon-platform/`. The **active product monorepo** is `cursor/`. Paths in this document are relative to `cursor/` unless noted.

### 1.2 Layout (active)

| Path | Role | Used? |
| --- | --- | --- |
| `apps/api` | NestJS HTTP API (default port 3000) | Yes |
| `apps/worker` | NestJS `createApplicationContext` outbox + retention (no HTTP) | Yes |
| `apps/mobile` | Flutter Windows/mobile client | Yes (excluded from pnpm workspace; built with Flutter SDK) |
| `packages/shared` | Domain helpers, money, JWT principal types, intelligence, errors, events | Yes |
| `packages/database` | Prisma schema, client, outbox SQL, starter catalog | Yes |
| `packages/config` | Zod env loading | Yes |
| `infra/docker` | Compose: Postgres, Redis, MinIO | Postgres used by apps; Redis/MinIO **required by env**, **not used by API/worker code** |
| `packages/database/prisma/migrations` | Six SQL migrations | Yes |
| `apps/api/test` | Jest E2E | Yes |
| `apps/api/src/**/*.spec.ts` | Unit tests | Yes |
| `apps/mobile/test` | Flutter widget/unit/integration tests | Yes |
| `product/`, `architecture/`, `domain/` | Intent docs | Present; not runtime |
| `pnpm-workspace.yaml` | `apps/*` except `apps/mobile`, plus `packages/*` | Yes |

Evidence: `pnpm-workspace.yaml`, `README.md`, `apps/api/src/app.module.ts`, `apps/worker/src/main.ts`.

### 1.3 High-level architecture map

```text
[Flutter Windows/mobile]
        HTTPS JSON + Bearer JWT
                |
                v
     [NestJS API  apps/api]
        |     |      |
        |     |      +-- Helmet, ValidationPipe, Throttler, Pino, Prometheus /metrics
        |     |      +-- JWT (passport) tenant from token `tid`
        |     v
        |  [PostgreSQL + Prisma]
        |     tables: salons, users, customers, visits, services,
        |             transactions, transaction_items, outbox_events,
        |             audit_logs, idempotency_records, opportunity_actions
        |
        +-- writes AuditLog + OutboxEvent in same DB transaction as domain writes

[NestJS Worker  apps/worker]
        polls outbox (FOR UPDATE SKIP LOCKED)
        consume() is idempotent no-op for known event types
        retention deletes old PROCESSED outbox + expired idempotency rows

[Redis] [MinIO]
        Compose + env required
        No application client usage found in apps/api or apps/worker
```

### 1.4 Capabilities present in code

| Concern | Status |
| --- | --- |
| Authentication | JWT access tokens (Argon2id passwords) |
| Authorization | RolesGuard + use-case role checks |
| Logging | Pino structured logs, request/correlation IDs, redact paths |
| Auditing | `audit_logs` written in domain transactions |
| Outbox | `outbox_events` + worker claim/retry/dead-letter |
| Idempotency | `idempotency_records` for visits, transactions, and opportunity Action creation |
| Health | `GET /health`, `GET /health/ready` |
| Metrics | `GET /metrics` Prometheus text |
| Swagger | `/docs` when enabled (default on outside production) |
| Background jobs | Worker outbox processor + retention processor |

---

## 2. Product identity

### 2.1 What the product is (implemented)

**Category:** Vertical SaaS for **salon customer history + revenue intelligence**.  
**Target business:** A single salon tenant (`Salon` row). Product copy and MVP docs say **women’s beauty salons**; the schema does **not** encode gender or salon type.  
**Primary buyer / operator:** Salon **OWNER** (registers the tenant).  
**Primary users:** OWNER, MANAGER, STAFF (`UserRole` enum).  
**Core problem addressed in code:** Keep a tenant-scoped record of customers, completed visits, and completed money, then **compute retention/revenue signals on read** so staff can act manually.  
**Product thesis (docs + README, aligned with code):** Help salons earn more from customers they already have — **not** by booking future appointments.  
**Current wedge / MVP boundary (code):** Register a salon → manage customers → record completed visits (optionally with a sale) → inspect intelligence and opportunities → record a manual Action outcome → export visits.

Evidence: `README.md`, `apps/api` modules, `packages/database/prisma/schema.prisma`, Flutter shell tabs.

### 2.2 What the product is not (verified)

| Capability | In current implementation? |
| --- | --- |
| Booking / appointment / reservation / calendar | **No.** `Visit.visitedAt` must not be in the future (2-minute skew). |
| POS replacement (tenders, cash drawer, receipts hardware) | **No.** Ledger transactions only. |
| Accounting / tax / payroll / commissions | **No.** |
| Supplier marketplace / product ordering / checkout | **No.** |
| Payment processing / card gateways | **No.** |
| Inventory | **No.** |
| Campaign send/automation | **No.** Opportunities recommend **manual** action text only. |
| Advanced AI/ML / LLM | **No.** Rule-based `RuleBasedRetentionAnalyzer`. |
| Customer rewards / loyalty points | **No.** |
| Employee attribution of visits/sales | **No.** Actor is audit/JWT user, not a stylist on the visit. |
| Service **price catalog** | **No.** `Service` is name + ACTIVE/INACTIVE only. Amount is entered per sale. |
| Beauty product price intelligence | **No.** Listed in `product/mvp.md` only. |

**DOCUMENTED / INTENDED — NOT VERIFIED IN IMPLEMENTATION:** `product/mvp.md` “Basic Campaign Actions” and “Beauty Product Price Intelligence”.

---

## 3. Complete user journey (matrix)

Flutter is the only first-party client. Backend also supports user-admin and standalone transaction APIs that Flutter does **not** expose.

| Step | User sees (Flutter) | Input | Validation | API | Authz | DB effect | Audit | Outbox | Success | Failure UX |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| App open | Splash `LoadingView` | — | Session restore | none until restore | — | — | — | — | Redirect `/` or `/login` | Stay splash until status known |
| Register | Register form | salon, owner, email, password | UI: non-empty; password ≥8. API: DTO lengths, email | `POST /auth/register` | Public (5/min) | Salon, OWNER user, starter services (unless `@example.test`), outbox, audit | `USER_REGISTERED` + `SERVICE_CREATED` per starter | `SalonCreated`, `UserCreated`, `ServiceCreated` | JWT stored; shell | Duplicate email 409; validation 400 |
| Login | Login form | email, password | Non-empty | `POST /auth/login` | Public (10/min) | none | none | none | JWT + user | Same message for bad user/password/disabled/suspended salon |
| Session | Shell tabs | — | Bearer | `GET /auth/me` on restore | Any active user | none | none | none | `{ userId, tenantId, role }`; Flutter keeps **local** name/email from last login | 401 → signed out |
| Today | Dashboard | — | — | `GET /intelligence/summary` | STAFF+ | none (read) | none | none | Counts + revenue | Error banner |
| Customers | List + search | search, cursor | trim | `GET /customers` | STAFF+ | none | none | none | Page | 401/403 |
| Create customer | Form | name, phone | Flutter + API phone `09########` | `POST /customers` | STAFF+ | Customer | `CUSTOMER_CREATED` | `CustomerCreated` | Detail | 409 duplicate phone |
| Customer detail | Profile + intelligence + history | — | — | `GET /customers/:id`, `GET /intelligence/customers/:id`, `GET /customers/:id/visits` | STAFF+ | none | none | none | Combined UI | 404 |
| Record visit only | Record Visit (STAFF always; others if no amount) | visitedAt, notes | Future visit blocked | `POST /visits` | STAFF+ | Visit | `VISIT_CREATED` | `VisitCompleted` | History refresh | 400 future / 404 customer |
| Record visit + sale | Same screen OWNER/MANAGER | service, amount, visitedAt | Amount > 0; active service | `POST /visits/complete-with-sale` + Idempotency-Key | OWNER, MANAGER | Visit + Transaction + Item | `VISIT_CREATED`, `TRANSACTION_CREATED` | `VisitCompleted`, `TransactionCreated` | History + intelligence | 403 STAFF; 400 amount; 409 idempotency mismatch |
| Opportunities | List + complete/dismiss | optional type | — | `GET /intelligence/opportunities`, Action APIs | STAFF+ | OpportunityAction | `ACTION_*` | `ActionCreated` / `ActionCompleted` / `ActionDismissed` | History + status | empty copy |
| Global visits | Visits tab | local calendar day | Flutter local day → `from`/`to` UTC | `GET /visits` | STAFF+ | none | none | none | Rows + previous-visit days | empty |
| Export | Save dialog | same filters | — | `GET /visits/export` | STAFF+ | none | `VISITS_EXPORTED` | none | `.xlsx` saved | 400 if >5000 |
| Profile | Name, role, logout | — | — | none for salon PATCH | — | — | — | — | Logout clears storage | — |
| Service management | OWNER only | name, status | unique name | `GET/POST/PATCH /services` | OWNER write; all read ACTIVE | Service | `SERVICE_*` | `ServiceCreated/Updated` | Catalog | 403 other roles |
| Logout | Login | — | — | **none** | Client clears token | none | none | none | Login | — |
| Session expiry | Redirect login | — | JWT `exp` + DB re-check | any | 401 | none | none | none | Signed out | Generic unauthenticated |

**Tenant:** always JWT `tid` / `principal.tenantId`. Roles as in §5.

User management, salon PATCH, standalone `POST /transactions`, void, and intelligence **segments** are **API-complete, Flutter-absent**.

---

## 4. Authentication / registration

Evidence: `apps/api/src/auth/register-salon-owner.use-case.ts`, `login.use-case.ts`, `jwt.strategy.ts`, `auth.dto.ts`, `auth.controller.ts`, `apps/api/test/auth.e2e-spec.ts`.

### 4.1 Registration `POST /auth/register`

| Field | Required | Rules |
| --- | --- | --- |
| `salonName` | yes | string 1–120, trimmed on persist |
| `ownerName` | yes | string 1–120, trimmed |
| `email` | yes | class-validator `@IsEmail`, max 255; **normalized** `trim().toLowerCase()` |
| `password` | yes | 8–128 chars; hashed **Argon2id** (`argon2.hash`, `type: argon2.argon2id`) |

- Duplicate **email** (global unique `users.email`): **409** `An account with this email already exists` (pre-check + P2002).  
- Duplicate **salon name**: **allowed** (no unique on `salons.name`).  
- Transaction: salon + owner + outbox + starter services + audit in **one** `$transaction`.  
- Role: `OWNER`, status `ACTIVE`. Salon status `ACTIVE`. Phone/address unset.  
- Starter catalog: `Hair Service`, `Nail Service` via `insertSalonService` unless email ends with `@example.test`.  
- JWT after commit: claims `sub`, `tid`, `role: OWNER`. Default expiry **`JWT_EXPIRES_IN` = `8h`**.  
- **No refresh token.** Logout is client-side (`SessionStore` clear).  
- Audit: `USER_REGISTERED`. Outbox: `SalonCreated`, `UserCreated`, plus `ServiceCreated` per starter.  
- Throttle: **5 requests / 60s** on this route (in addition to global 60/min).

### 4.2 Login `POST /auth/login`

- Credentials: email + password. Email trimmed + lowercased.  
- Unknown user, bad password, `DISABLED` user, `SUSPENDED` salon: **same** `UnauthenticatedError('Invalid email or password')`.  
- Timing: dummy Argon2id hash verified when user missing (`phase-a-login-timing-dummy`).  
- JWT claims: `sub` (user id), `tid` (salon id), `role` (from DB).  
- Response: `{ accessToken, user: { id, tenantId, name, email, role } }`.  
- Throttle: **10 / 60s**.

### 4.3 `GET /auth/me`

Bearer required. Returns the JWT principal **as loaded from the database**, not the login envelope:

`{ userId, tenantId, role }`

Evidence: `AuthController.me`, `apps/api/test/auth.e2e-spec.ts` (`me.body.userId`). **Name and email are not returned.** Flutter `AuthController.restore` merges `me()` with `SessionStore` name/email from the last register/login. If an OWNER later changes a user’s name via `POST /users` / there is no rename-self API, the Flutter profile name stays stale until a new login payload is stored.

**IMPLEMENTED — Flutter compensates; backend `/auth/me` is thinner than login.**

### 4.4 `GET /auth/owner`

OWNER-only probe (`RolesGuard`). Used in tests more than Flutter.

### 4.5 JWT validation (every authenticated request)

`JwtStrategy.validate`: payload must have `sub`, `tid`, valid role enum; then **reload user** where `id = sub`, `salonId = tid`, `status = ACTIVE`, `salon.status = ACTIVE`. Role in the returned principal is **database role**, not a stale token role if they diverged after a role change (token still must contain a syntactically valid role).

**Security-sensitive:** passwords never returned; hashes redacted in logs; failed login does not disclose which check failed; tenant not client-supplied.

---

## 5. Roles and permissions (backend authority)

Roles: `OWNER`, `MANAGER`, `STAFF`. Evidence: `RolesGuard`, use cases (`ForbiddenError` / `@Roles`).

| RESOURCE | ACTION | OWNER | MANAGER | STAFF |
| --- | --- | --- | --- | --- |
| Auth me | read | Y | Y | Y |
| Auth owner probe | read | Y | N | N |
| Salon profile | GET | Y | Y | Y |
| Salon profile | PATCH | Y | N | N |
| Users | list/get | Y | Y | N |
| Users | create | Y (any role) | Y (**STAFF only**, `canAssignRole`) | N |
| Users | change role | Y | N | N |
| Users | change status | Y | Y (**STAFF targets only**, `canChangeUserStatus`) | N |
| Customers | list/get/create/import/template | Y | Y | Y |
| Customers | update/delete | Y | Y | N |
| Visits | list/get/create/export/customer history | Y | Y | Y |
| Visits | complete-with-sale | Y | Y | N |
| Visits | delete | Y | Y | N |
| Services | GET (ACTIVE; OWNER may `includeInactive`) | Y | Y | Y |
| Services | POST/PATCH | Y | N | N |
| Transactions | GET list/get/by customer | Y | Y | Y |
| Transactions | POST create / void | Y | Y | N |
| Intelligence | all GET | Y | Y | Y |
| Opportunity Actions | create/list/complete/dismiss | Y | Y | Y |
| Health/metrics | public | — | — | — |

DTO `CreateSalonUserDto.role` accepts any `USER_ROLES` value, but **`canAssignRole` rejects MANAGER→OWNER and MANAGER→MANAGER** with 403. Evidence: `packages/shared/src/salon-user-policy.ts`, `create-salon-user.use-case.ts`, `salon-user-policy.spec.ts`. Last-OWNER invariant still applies on role/status changes (`wouldLeaveSalonWithoutOwner`).

**Cannot:** STAFF cannot mutate salon, users, customer update/delete, sales, voids, service catalog writes, visit deletes.

Flutter hides service management and sale fields from STAFF; **does not** hide customer import or customer create. Flutter **does not** expose user admin.

---

## 6. Tenancy / multi-tenancy

**Tenant = `Salon` row. `tenantId` ≡ `salonId`.**

| Question | Current behavior |
| --- | --- |
| How obtained? | JWT `tid` → `AuthenticatedPrincipal.tenantId` after DB check |
| Client-provided tenantId trusted? | **No.** Not accepted as a write authority |
| Repository filtering | `salonId: tenantId` on finds/lists/deletes |
| Composite FKs | Customer, visit, service, transaction, item use `(id, salonId)` uniqueness + FKs so children cannot attach to another tenant’s parent |
| Unique email | **Global** `users.email`, not per salon |
| Unique customer phone | **Per salon** `@@unique([salonId, phoneNumber])` |
| Unique service name | **Per salon** |
| Cross-tenant GET/PATCH/DELETE | Repositories `findFirst` with tenant → **404** not 403 |
| DB vs app | **Both:** app always scopes queries; DB FKs/uniques prevent cross-tenant graph edges for financial/customer/visit/service. Users FK to salon. Outbox/audit store `tenantId` nullable at schema (system rows possible) |

E2E: `apps/api/test/auth.e2e-spec.ts`, `customer.e2e-spec.ts`, `finance.e2e-spec.ts` (catalog isolation), `visit.e2e-spec.ts`.

Every authenticated business endpoint is tenant-scoped except public auth/health/metrics.

---

## 7. Salon management

- **Create:** only via registration (no `POST /salon`).  
- **Read:** `GET /salon` — `{ id, name, phone, address, status, createdAt, updatedAt }`.  
- **Update:** `PATCH /salon` OWNER only. Optional `name` 1–120, `phone` max 40, `address` max 255. **No** status change API (SUSPENDED exists in enum only).  
- Audit: `SALON_UPDATED`. Outbox: `SalonUpdated`.  
- Flutter: **does not call PATCH /salon**. Profile shows user name/role, not editable salon fields.

Evidence: `salon.controller.ts`, `salon.dto.ts`.

---

## 8. User management

APIs: `GET/POST /users`, `GET /users/:id`, `PATCH /users/:id/role` (OWNER), `PATCH /users/:id/status` (OWNER+MANAGER).

- Create: name, email (normalized), password 8–128 Argon2id, role in enum. Same global email uniqueness.  
- Status: `ACTIVE` | `DISABLED`. Disabled users cannot login / JWT validate.  
- **Last active OWNER:** `wouldLeaveSalonWithoutOwner` used on role and status changes with `lockSalonForUpdate`. Message: `A salon must keep at least one active OWNER`. **IMPLEMENTED.**  
- No user **delete** endpoint.  
- Audit: `USER_CREATED`, `USER_ROLE_CHANGED`, `USER_STATUS_CHANGED`. Outbox: `UserCreated`, `UserRoleChanged`, `UserStatusChanged`.  
- Flutter: **no user-admin screens**.

---

## 9. Customer domain

Fields: `id`, `salonId`, `firstName`, `lastName` (may be empty string), `phoneNumber`, timestamps.

- Phone: **exactly** Iranian mobile `09` + 9 digits. Stored as entered after validation — **not** rewritten to another format. Unique per salon.  
- Name: first 1–80; last max 80. Flutter splits display name.  
- List: cursor on `(createdAt desc, id desc)`, limit **200**, optional `search` ILIKE first/last, contains phone.  
- GET/PATCH/DELETE tenant-scoped.  
- Delete: see §36.  
- Intelligence: derived on read, not stored on customer.  
- Visits: `onDelete: Cascade` from customer. Transactions: `onDelete: Restrict`.

Evidence: `customer.repository.ts`, `@salon/shared` phone helpers, `customer.e2e-spec.ts`.

---

## 10. Excel customer import

Evidence: `import-customers.use-case.ts`, `parse-customer-excel.ts`, `customer-import.constants.ts`, `customer-import.e2e-spec.ts`.

| Rule | Value |
| --- | --- |
| Format | `.xlsx` only (filename ends `.xlsx`, no `..` `/` `\`) |
| Magic | ZIP local header `PK` (`0x50 0x4b`) |
| Size | 2 MB (`CUSTOMER_IMPORT_MAX_FILE_BYTES`); Multer 413 |
| Sheets | max 8 |
| Rows | max 5000 |
| Cell chars | 256 (clipped) |
| Zip bomb guards | max 64 entries; uncompressed member/total caps |
| Headers | first row; keys trimmed **lowercased**; must include `name` and `phone` |
| MIME | expected spreadsheet MIME on responses; upload field `file` |
| Persistence of file | **Discarded** after parse — no MinIO write |
| TX | Parse outside TX; inserts in one TX timeout 20s; chunk **250** `createMany` |
| Idempotency | **none** (re-upload is a new import) |
| Audit | `CUSTOMERS_IMPORTED` with counts |
| Outbox | `CustomerCreated` per **new** row |

Row outcomes: `IMPORTED` | `ALREADY_EXISTS` (phone in salon) | `DUPLICATE_IN_FILE` | `INVALID`. Existing customers **not** updated. Invalid/duplicate-in-file skipped; imported set is all-or-nothing for the write transaction of new rows.

---

## 11. Visit domain

**Visit = completed historical customer interaction.** Not a booking.

Evidence: `visited-at.ts` comment and `parseCompletedVisitedAt`; `visit.e2e-spec.ts`.

- `visitedAt` invalid timestamp → 400. Future beyond **now + 120s** → 400 `visitedAt must be a completed visit time, not a future booking`.  
- Optional notes. Optional Idempotency-Key on `POST /visits`.  
- List `GET /visits`: tenant, optional `date=YYYY-MM-DD` as **UTC day**, or `from`+`to` instants; cursor; includes customer name, optional sale service/amount. Default order **visitedAt desc**.  
- Customer history `GET /customers/:id/visits` includes inactive service names (no ACTIVE filter).  
- Delete: OWNER+MANAGER if no transactions reference visit.

---

## 12. Completed visit + sale

Flow (Flutter OWNER/MANAGER): Customer detail → Record Visit → pick **ACTIVE** service → amount IRR → submit.

`POST /visits/complete-with-sale`  
Required: `customerId`, `visitedAt`, `serviceId`, `amount` (> 0), `currency` = `IRR`, header `Idempotency-Key` (8–128 `[A-Za-z0-9._-]`).  
Atomic `$transaction`: claim idempotency → verify customer in tenant → service **ACTIVE** in tenant → insert Visit + COMPLETED Transaction + one TransactionItem (qty 1, unitPrice = amount) → audit + outbox.

| Case | Behavior |
| --- | --- |
| amount 0 or negative | 400 `amount must be greater than 0` (also DB CHECK `amount >= 0` would reject negative) |
| inactive service | not found / not eligible for new sale (use case loads ACTIVE) |
| other salon customer | 404 |
| same key + same fingerprint | replay stored resource (200, no second write) |
| same key + different payload | 409 `Idempotency-Key was already used with a different request` |
| mid-TX failure | full rollback including visit, money, outbox, audit, idempotency insert |

Fingerprint: `customerId:visitedAt ISO:serviceId:amount:currency`. Scope: `(tenantId, actorId, operation, key)`.

STAFF Flutter posts **visit-only** (`POST /visits`) without amount.

---

## 13. Service catalog

`Service` = **type/name + status**, not a price list.

- Unique `(salonId, name)` (normalized name rules in `insert-salon-service` / `service-name`).  
- `GET /services` ACTIVE only unless OWNER `includeInactive=true`.  
- OWNER `POST` / `PATCH` (name, status ACTIVE/INACTIVE).  
- Deactivate: cannot be chosen for **new** paid visits; historical visit/item rows keep `serviceId` and still expose `serviceName`. Revenue unchanged. Reactivate: eligible again.  
- Hair/Nail: **ordinary tenant rows** created at registration (or skipped for `@example.test`). Renamable/deactivatable like any other.  
- No service DELETE API.

Evidence: `service.controller.ts`, `packages/database/src/dev-catalog.ts`, Flutter `service_screens.dart`.

---

## 14. Transaction / revenue domain

- **Source of truth for money:** `transactions.amount` (`LedgerTransaction`), currency `IRR`, `NUMERIC(19,2)`, CHECK ≥ 0 and currency = IRR.  
- Status: `COMPLETED` (default) or `VOIDED`. Intelligence **sums COMPLETED only**.  
- Items: line breakdown; create API requires **sum of item totals = header amount** (max 50 items). Complete-with-sale always 1 item.  
- Why split: header is immutable commercial total; items support multi-service sales via `POST /transactions` even though Flutter only uses single-item complete-with-sale.  
- **No amount edit.** Void is status flip; idempotent if already VOIDED (no second audit).  
- Visit optional on standalone create; complete-with-sale always sets `visitId`.  
- Delete of transactions: **no API**. FK Restrict from items and from customer/visit.

---

## 15. Revenue intelligence

**On-read**, not persisted, not ML.

Raw: COMPLETED transactions grouped by customer / salon (`intelligence-revenue.ts`).  
Derived: totals, counts, UTC month vs previous UTC month, trend.  
Signals: `REVENUE_DECLINING` if trend DECREASING (requires ≥1 tx previous UTC month).  
Opportunity: `REVENUE_DECLINE` with recommendedAction `Review this customer’s recent decline.`  
Visit-based retention still from visit dates (cap **5000** customers, `hasMore` if truncated). Salon revenue totals query is **not** capped the same way (all COMPLETED txs in tenant).

Formulas:

- Average revenue/tx: round-half-up integer minor / count.  
- Average spend/visit: linked COMPLETED revenue / distinct linked visits.  
- Trend: compare `thisUtcMonthMinor` vs `previousUtcMonthMinor`; null if previous month tx count = 0.

**DOCUMENTED / INTENDED conflict:** `thresholds.ts` header still says “Transactions and service mix do not exist yet” while the same file later says revenue comes from COMPLETED transactions. Code **does** use transactions.

---

## 16. Customer intelligence status

Analyzer: `RuleBasedRetentionAnalyzer` (`packages/shared/src/intelligence/retention.ts`).  
Expected return: **35** days if interval cannot be measured; else average interval of visits on **different UTC days**.  
Inactive after `expected * 2` (70 days default).  
AT_RISK: last visit **> expected** and **≤ inactiveAfter**.  
RETURNING: visitCount ≥ 2 and still inside expected window.  
ACTIVE: exactly one visit and inside expected window.  
NEW: zero visits.

Signals:

| Signal | Rule |
| --- | --- |
| NEW_CUSTOMER | status NEW |
| OVERDUE | AT_RISK or INACTIVE |
| FREQUENT | visits ≥ 6 **and** average interval ≤ 28 days |
| REVENUE_DECLINING | revenue trend DECREASING |

API: `GET /intelligence/customers/:id` STAFF+. Flutter customer detail.

There is **no** `RECENTLY_ACTIVE` / `RETURNING_CUSTOMER` signal enum — those ideas appear as **status** RETURNING / ACTIVE only.

---

## 17. Opportunities

Types: `REACTIVATION` (INACTIVE), `CUSTOMER_RETURN` (AT_RISK), `REVENUE_DECLINE` (month-over-month decrease).

**Opportunity ≠ campaign.** No send, no scheduling, no templates. `recommendedAction` is a string.

List: in-memory after scanning up to 5000 customers; sort by `daysSinceLastVisit` desc, then customerId, then type; cursor 200/page.

### 17.1 Opportunity Actions (operational history)

**IMPLEMENTED.** `opportunity_actions` is **not** a second intelligence source of truth. Opportunities remain derived on read. An Action records that the salon responded to a currently derived opportunity (`salonId` + `customerId` + `opportunityType` + `sourceVisitId` snapshot of the customer's last visit).

Lifecycle: `OPEN` → `COMPLETED` or `DISMISSED`. Terminal states do not reopen. Completing or dismissing **does not** change intelligence status, visit history, or thresholds. The **presentation** of that opportunity (list, customer intelligence `opportunities[]`, dashboard counts) is suppressed while the last visit is still the Action's `sourceVisitId`. A later visit that again satisfies the intelligence rules creates a new episode and the opportunity may reappear. At most one `OPEN` row per salon+customer+type (partial unique index). At most one Action row per salon+customer+type+**non-null** `sourceVisitId` (partial unique index). Historical Actions with a NULL fingerprint are preserved as-is; uniqueness is not forced by inventing visit ids. Database uniqueness is the concurrency backstop for identified episodes.

`COMPLETED` is user-visible retention work (`GET /actions?status=COMPLETED`, Opportunities «اقدام‌های اخیر»). `DISMISSED` is suppression only: it is persisted so the same episode does not reopen, audited as `ACTION_DISMISSED`, and excluded from recent-action UI and customer activity. It is not completed business work.

APIs (STAFF+; tenant from JWT):

- `POST /intelligence/opportunities/:opportunityType/customers/:customerId/actions` — required `Idempotency-Key`; replay same key+payload; 409 different payload; existing OPEN **or** existing Action for the current last visit is returned instead of a duplicate.
- `GET /actions`, `GET /customers/:customerId/actions` — cursor `{ createdAt, id }`, page 200; optional `status`. Recent-action UI uses `COMPLETED`.
- `POST /actions/:id/complete`, `POST /actions/:id/dismiss` — `SELECT … FOR UPDATE`; repeat of the same terminal state is idempotent (no extra Action/Audit/Outbox); opposite terminal is 409.

Audit: `ACTION_CREATED`, `ACTION_COMPLETED`, `ACTION_DISMISSED`. Outbox: `ActionCreated`, `ActionCompleted`, `ActionDismissed`.

Manual Bale Safir text send is a separate `message_deliveries` record. Sending a message does **not** complete the Action.

Evidence: `apps/api/src/action/`, Flutter `opportunity_action_bar.dart`, `action.e2e-spec.ts`.

### 17.2 Opportunity messages (durable queue)

**IMPLEMENTED.** Salon users request a durable `MessageRequest`. Bale Safir is a delivery provider, not a requirement for queueing. Platform admins (`platform_admins`, JWT `scp=platform`) choose `BALE` or `MANUAL`.

- API: `POST /intelligence/opportunities/:opportunityType/customers/:customerId/messages` (STAFF+; required `Idempotency-Key`). Returns salon status `QUEUED`. Missing Bale credentials do **not** block this.
- One **new** salon request per salon+customer per **Asia/Tehran** calendar day (`MESSAGE_DAILY_LIMIT_REACHED`), enforced by partial unique index `message_requests_salon_customer_day_key` on rows with `counts_toward_daily_limit`. Pre-queue deliveries are backfilled 1:1 with that flag false. Idempotency is a separate key+hash replay.
- `GET /messages/:id`, `GET /customers/:customerId/messages` (tenant-scoped).
- Admin: `GET /admin/message-queue`, `POST .../select-bale|select-manual|mark-manual-sent|retry`. Development bootstrap: `pnpm db:bootstrap-admin` using `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` (never in production).
- Outbox: `MessageRequested` on queue; `MessageDeliveryActivated` when Bale is selected **and** credentials exist. Worker still accepts legacy `MessageSendRequested`.
- Credentials remain platform env. Customer delete is blocked while message history exists.
- Retention: message requests/deliveries are operational PII history; they are **not** auto-deleted. Outbox/idempotency retention is unchanged.

Provider contract and Bale failure matrix: `architecture/messaging-bale-safir.md`. Domain: `docs/messaging-domain.md`.

---

## 18. Global visits

Flutter Visits tab: **local calendar day** as `from`/`to` ISO instants (not `date=`). Backend `date=` is UTC midnight–midnight.  
Columns: customer, service, amount, visitedAt, days since previous visit (SQL lag). Pagination cursor. Export same filters. Tenant from JWT.

---

## 19. Visits Excel export

- `GET /visits/export` STAFF+, same filters as list, max **5000** rows else 400.  
- Filename `visits.xlsx`, sheet `مراجعات`, RTL frozen header, font Tahoma, Persian headers (§ visit-export.constants).  
- Amount numeric `#,##0.00`; datetime `yyyy-mm-dd hh:mm`; days integer.  
- Audit `VISITS_EXPORTED`. No outbox.  
- Flutter: `FilePicker.saveFile` `.xlsx`.

---

## 20–22. Flutter application, journeys, profile

**Startup:** `main.dart` → Riverpod → `SessionStore` restore JWT → `GET /auth/me` → GoRouter.

**State:** Riverpod providers; repositories in `lib/core/networking/repositories.dart`; `ApiClient` Bearer + error mapping.

**Screens → API**

| Screen | APIs |
| --- | --- |
| Splash/Login/Register | login/register/me |
| Dashboard (Today) | intelligence/summary |
| Customers | GET /customers, create/update/delete, import, template |
| Customer detail | GET customer, intelligence, visits, complete-with-sale or POST visits |
| Visits | GET /visits, export |
| Opportunities | GET /intelligence/opportunities |
| Profile | logout local; OWNER → services |
| Service management | GET includeInactive, POST, PATCH |

**OWNER:** all Flutter features including catalog and sales.  
**MANAGER:** sales + customers mutate; **no** service write UI (backend forbids). **No** salon PATCH UI.  
**STAFF:** visit-only, customers create/import/list, intelligence read, export; no sale, no customer edit/delete in UI (backend would 403 on update/delete).

Profile does not edit salon. Service deactivate confirmation copy warns history remains.

Windows: same Flutter app; Excel save uses file picker.

**IMPLEMENTED — NOT FORMALLY DOCUMENTED:** OWNER service catalog UI; visit export; complete-with-sale.

---

## 23. API contract inventory

Public: `POST /auth/register`, `POST /auth/login`, `GET /health`, `GET /health/ready`, `GET /metrics`.  
All others: Bearer JWT. Tenant = JWT.

| METHOD | PATH | Purpose | Roles | Input notes | Success | Audit | Outbox | Idempotency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| POST | /auth/register | Create salon+owner | public | DTO §4 | 201 + JWT | USER_REGISTERED | SalonCreated, UserCreated, ServiceCreated* | no |
| POST | /auth/login | Token | public | email/password | 201/200 + JWT | no | no | no |
| GET | /auth/me | Session | any | — | 200 `{ userId, tenantId, role }` | no | no | no |
| GET | /auth/owner | Probe | OWNER | — | 200 | no | no | no |
| GET | /salon | Profile | any | — | 200 | no | no | no |
| PATCH | /salon | Update | OWNER | name/phone/address | 200 | SALON_UPDATED | SalonUpdated | no |
| GET | /users | List | O+M | — | 200 array | no | no | no |
| POST | /users | Create | O+M | CreateSalonUserDto | 201 | USER_CREATED | UserCreated | no |
| GET | /users/:id | Get | O+M | — | 200 | no | no | no |
| PATCH | /users/:id/role | Role | OWNER | role | 200 | USER_ROLE_CHANGED | UserRoleChanged | no |
| PATCH | /users/:id/status | Status | O+M | status | 200 | USER_STATUS_CHANGED | UserStatusChanged | no |
| GET | /customers/import/template | Template xlsx | any | — | 200 file | no | no | no |
| POST | /customers/import | Import | any | multipart file | 201 summary | CUSTOMERS_IMPORTED | CustomerCreated* | no |
| GET | /customers | List | any | search, cursor | 200 page | no | no | no |
| POST | /customers | Create | any | names, phone | 201 | CUSTOMER_CREATED | CustomerCreated | no |
| GET | /customers/:id | Get | any | — | 200 | no | no | no |
| PATCH | /customers/:id | Update | O+M | fields | 200 | CUSTOMER_UPDATED | no | no |
| DELETE | /customers/:id | Delete | O+M | — | 204 | CUSTOMER_DELETED | CustomerDeleted | no |
| POST | /visits/complete-with-sale | Visit+sale | O+M | DTO + key | 201 | VISIT_CREATED, TRANSACTION_CREATED | VisitCompleted, TransactionCreated | required |
| POST | /visits | Visit | any | DTO; key optional | 201 | VISIT_CREATED | VisitCompleted | optional |
| GET | /visits | List | any | date/from/to/cursor | 200 page | no | no | no |
| GET | /visits/export | Excel | any | same filters | 200 xlsx | VISITS_EXPORTED | no | no |
| GET | /visits/:id | Get | any | — | 200 | no | no | no |
| DELETE | /visits/:id | Delete | O+M | — | 204 | VISIT_DELETED | VisitDeleted | no |
| GET | /customers/:id/visits | History | any | cursor | 200 page | no | no | no |
| GET | /services | List | any | includeInactive OWNER | 200 | no | no | no |
| POST | /services | Create | OWNER | name | 201 | SERVICE_CREATED | ServiceCreated | no |
| PATCH | /services/:id | Update | OWNER | name/status | 200 | SERVICE_UPDATED / _ACTIVATED / _DEACTIVATED | ServiceUpdated | no |
| POST | /transactions | Create | O+M | items+amount+key | 201 | TRANSACTION_CREATED | TransactionCreated | required |
| GET | /transactions | List | any | cursor | 200 page | no | no | no |
| GET | /transactions/:id | Get | any | — | 200 | no | no | no |
| POST | /transactions/:id/void | Void | O+M | — | 200 | TRANSACTION_VOIDED (if newly voided) | TransactionVoided | no |
| GET | /customers/:id/transactions | List | any | — | 200 | no | no | no |
| GET | /intelligence/summary | Dashboard | any | — | 200 | no | no | no |
| GET | /intelligence/opportunities | List | any | type, cursor | 200 page | no | no | no |
| GET | /intelligence/segments | Segment list | any | status, cursor | 200 page | no | no | no |
| GET | /intelligence/customers/:id | Detail | any | — | 200 | no | no | no |
| POST | /intelligence/opportunities/:type/customers/:customerId/actions | Create Action | any | Idempotency-Key | 201 | ACTION_CREATED | ActionCreated | required |
| GET | /actions | List Actions | any | status, customerId, cursor | 200 page | no | no | no |
| GET | /customers/:id/actions | Customer Actions | any | status, cursor | 200 page | no | no | no |
| POST | /actions/:id/complete | Complete Action | any | — | 201 | ACTION_COMPLETED | ActionCompleted | no |
| POST | /actions/:id/dismiss | Dismiss Action | any | — | 201 | ACTION_DISMISSED | ActionDismissed | no |
| GET | /health | Live | public | — | 200 `{status:ok}` | no | no | no |
| GET | /health/ready | Ready | public | — | 200 or 503 | no | no | no |
| GET | /metrics | Prometheus | public | — | 200 text | no | no | no |

\*Starter services on register; import only for new phones.

Typical errors: 400 validation (class-validator or `ValidationError`); 401; 403; 404; 409 conflict/business rule; 413 import too large; 429 throttle; 500 unhandled; 503 not ready / infrastructure.

**Endpoint count: 40.**

---

## 24. Database schema

Prisma models (`packages/database/prisma/schema.prisma`):

| Model | Table | PK | Tenant | Notes |
| --- | --- | --- | --- | --- |
| Salon | salons | UUID | self | status ACTIVE/SUSPENDED |
| User | users | UUID | salonId FK Restrict | unique email global; role; status |
| Customer | customers | UUID | salonId | unique (salonId, phone); unique (id, salonId) |
| Visit | visits | UUID | salonId | FK customer composite; Cascade from customer |
| Service | services | UUID | salonId | unique name per salon; unique (id, salonId) |
| LedgerTransaction | transactions | UUID | salonId | amount Decimal(19,2); COMPLETED/VOIDED; FKs Restrict |
| TransactionItem | transaction_items | UUID | salonId | FK tx + service composite Restrict |
| OutboxEvent | outbox_events | UUID | tenantId nullable | status enum; JSON payload |
| AuditLog | audit_logs | UUID | tenantId nullable | actorId nullable |
| IdempotencyRecord | idempotency_records | UUID | tenantId | unique (tenantId, actorId, operation, key) |

Indexes: salon+visitedAt, salon+status+available_at, etc. (phase_c + revenue migrations).

**Model count: 10.**

---

## 25. Data integrity

| Protection | App | DB | Both |
| --- | --- | --- | --- |
| Tenant query scope | Y | composite FKs | Y |
| Phone unique per salon | Y | unique | Y |
| Email unique | Y | unique | Y |
| Visit not in future | Y | no CHECK | app |
| Money ≥ 0, IRR | Y | CHECK | Y |
| Item sum = header | Y | no CHECK | app |
| Active service for new sale | Y | no | app |
| Last OWNER | Y + row lock salon | no | app |
| Delete customer with txs | Y | Restrict on txs | Y |
| Delete visit with txs | Y | Restrict | Y |
| Idempotency | Y | unique | Y |
| Immutable amounts | no PATCH | no update API | app |
| UUID v7 ids | `createId()` | UUID type | both |

Race: customer delete retries P2003; idempotency `ON CONFLICT DO NOTHING`; outbox `SKIP LOCKED`; salon lock on owner rules.

---

## 26. Migrations (chronological)

Reconstructable: **yes** (linear Prisma migrations matching schema).

| Name | Purpose |
| --- | --- |
| `20260904120000_init_foundation` | salons, users, outbox, audit, enums, email unique |
| `20260904180000_customers` | customers |
| `20260904200000_visits` | visits |
| `20260906120000_idempotency_records` | idempotency |
| `20260906140000_phase_c_scale_indexes` | list/query indexes |
| `20260906180000_revenue_intelligence_foundation` | services, transactions, items, CHECKs, visit composite unique |

Dates are migration timestamps (2026-09-04 … 2026-09-06), not git author dates.

---

## 27. Idempotency

| Operation | Header | Required | Fingerprint |
| --- | --- | --- | --- |
| VISIT_CREATE | Idempotency-Key | optional | customerId + visitedAt ISO |
| VISIT_COMPLETE_WITH_SALE | required | SHA256 of sale fields | |
| TRANSACTION_CREATE | required | customer, visit, occurredAt, amount, currency, items | |
| OPPORTUNITY_ACTION_CREATE | required | customerId + opportunityType |

Scope unique: tenant + actor + operation + key. Replay same hash returns original resource. Different hash → 409. Retention: worker deletes rows older than `IDEMPOTENCY_RETENTION_DAYS` (default 7). Cleanup batch `RETENTION_CLEANUP_BATCH_SIZE`.

---

## 28. Outbox / events

**Why:** publish facts after commit without dual-write; worker at-least-once.

Claim: `FOR UPDATE SKIP LOCKED`, lease `OUTBOX_LEASE_MS` (30s default), batch `OUTBOX_BATCH_SIZE` (10). Retry: full jitter backoff, max attempts 8, then DEAD_LETTER. Unknown types: immediate dead-letter. PROCESSED retained `OUTBOX_PROCESSED_RETENTION_DAYS` (14) then deleted. DEAD_LETTER kept.

**Consumer side effect today:** `MessageSendRequested` and `MessageDeliveryActivated` submit BALE text through the Safir adapter. Other known types are idempotent no-ops.

| Event | Trigger | Payload gist |
| --- | --- | --- |
| SalonCreated | register | salonId |
| SalonUpdated | PATCH salon | salonId |
| UserCreated | register / POST users | userId, salonId, role |
| UserRoleChanged | PATCH role | from, to |
| UserStatusChanged | PATCH status | status |
| CustomerCreated | create/import/register path | customerId |
| CustomerDeleted | delete | customerId, visitCount, actionCount |
| VisitCompleted | create visit / complete-with-sale | visitId, customerId |
| VisitDeleted | delete visit | visitId, customerId |
| ServiceCreated | insert service | serviceId |
| ServiceUpdated | patch | serviceId, status/name |
| TransactionCreated | sale / POST tx | transactionId |
| TransactionVoided | void | transactionId |
| ActionCreated | create Action | actionId, customerId, opportunityType |
| ActionCompleted | complete Action | actionId, customerId, opportunityType |
| ActionDismissed | dismiss Action | actionId, customerId, opportunityType |
| MessageRequested | salon queues a message | messageRequestId, salonId |
| MessageDeliveryActivated | admin selects BALE with credentials | messageDeliveryId, messageRequestId, salonId |
| MessageSent | Bale or manual sent | messageDeliveryId, messageRequestId, mode |
| MessageFailed | Bale terminal failure | messageDeliveryId, failureCode |
| MessageSendRequested | legacy Bale activation (still consumed) | messageDeliveryId, salonId |

These are **facts**, not commands.

---

## 29. Audit log

| Action | Typical trigger | Sensitive? |
| --- | --- | --- |
| USER_REGISTERED | register | yes (account) |
| USER_CREATED | POST users | yes |
| USER_ROLE_CHANGED | PATCH role | yes |
| USER_STATUS_CHANGED | PATCH status | yes |
| SALON_UPDATED | PATCH salon | normal |
| CUSTOMER_CREATED | create | normal |
| CUSTOMER_UPDATED | patch | normal |
| CUSTOMER_DELETED | delete | **destructive** |
| CUSTOMERS_IMPORTED | import | bulk |
| VISIT_CREATED | visit / sale | normal |
| VISIT_DELETED | delete visit | **destructive** |
| VISITS_EXPORTED | export | data egress |
| SERVICE_CREATED / UPDATED / ACTIVATED / DEACTIVATED | catalog | normal |
| TRANSACTION_CREATED | money in | **financial** |
| TRANSACTION_VOIDED | void | **financial** |
| ACTION_CREATED | create Action | normal |
| ACTION_COMPLETED | complete Action | normal |
| ACTION_DISMISSED | dismiss Action | normal |

Actor = JWT user; tenant stored. Failures are generally **not** written as FAILED audit rows (success-path writes). **Audit action names: 18.**

---

## 30. Security audit (current state only)

- Argon2id passwords; JWT HS secret `JWT_SECRET` min 32 chars; 8h access tokens; no refresh.  
- Helmet on; **CORS not enabled** in `main.ts` (Flutter desktop/native not browser CORS).  
- Swagger `/docs` unless production and `SWAGGER_ENABLED` unset (disabled in production by default).  
- Throttle 60/min global; stricter register/login.  
- ValidationPipe whitelist + forbidNonWhitelisted.  
- Tenant from JWT+DB. IDs UUID v7 (harder sequential enumeration, not a secret).  
- Excel zip-bomb and type checks; file not stored.  
- Prisma parameterized; map P2002/P2003/P2025/P2023/P2020.  
- Logs redact password, tokens, phoneNumber, DATABASE_URL, JWT_SECRET.  
- Redis/MinIO credentials required in env but unused by app code (secret sprawl).  
- Metrics and health unauthenticated.  
- STAFF can export all tenant visits and import customers (privilege breadth).

Do not treat this list as a pentest.

---

## 31. API error semantics

| HTTP | App code | Typical cause |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | DTO, money, visitedAt, excel, idempotency format |
| 401 | UNAUTHENTICATED | missing/bad JWT, login fail |
| 403 | FORBIDDEN | role |
| 404 | NOT_FOUND | wrong id or **other tenant** (hidden) |
| 409 | CONFLICT or BUSINESS_RULE | duplicate email/phone/name, last OWNER, financial delete, idempotency mismatch, P2002/P2003 mapped |
| 413 | VALIDATION_ERROR | Multer file size |
| 429 | throttler | register 5, login 10, global 60 |
| 500 | INTERNAL | unhandled |
| 503 | ready check / INFRASTRUCTURE_ERROR | postgres down, draining |

Nest class-validator often **400** with message array (filter maps HttpException).

Prisma: P2002→409 conflict; P2003→409 related records (visit insert may map 404 in visit path); P2025→404; P2023/P2020→400 invalid id. **IMPLEMENTED** in `prisma-error.ts`.

**422 is not used** (`ValidationError` is 400).

---

## 32. Observability

- Pino + nestjs-pino; `x-request-id`, `x-correlation-id`.  
- Metrics interceptor: HTTP duration histograms; outbox gauges.  
- Health live: no deps. Ready: `SELECT 1` with timeout; 503 if shutting down. Worker has **no** HTTP health.  
- Graceful shutdown: `API_SHUTDOWN_GRACE_MS` default 15s.  
- HTTP timeout config `HTTP_TIMEOUT_MS` for outbound; inbound socket timeout 120s (import).  
- `DATABASE_CONNECTION_LIMIT` optional per process.

---

## 33. Worker / async

API: HTTP. Worker: `NestFactory.createApplicationContext(WorkerModule)` — **no listen**.  
Processors: outbox poll `OUTBOX_POLL_INTERVAL_MS` (1s); retention interval default 300s.  
Shutdown waits in-flight batch.

---

## 34. Pagination / filtering

| Endpoint | Type | Limit | Order | Filters |
| --- | --- | --- | --- | --- |
| GET /customers | cursor | 200 | createdAt desc, id desc | search |
| GET /visits | cursor | (repo limit) | visitedAt desc | date UTC or from/to |
| GET /customers/:id/visits | cursor | | visitedAt desc | — |
| GET /transactions | cursor | | | |
| Intelligence lists | cursor | 200 | custom | status/type |
| GET /users | **full list** | unbounded in code | | |
| GET /services | full catalog for tenant filter | | | includeInactive |

Timezone: storage TIMESTAMPTZ; intelligence months **UTC**; Flutter visit day **local**.

---

## 35. Time / money

**Time:** all timestamps TIMESTAMPTZ; `utcNow()` in intelligence; Flutter displays local. Previous-visit days computed in SQL on `visitedAt`.

**Money:** IRR only; API strings like `1500000.00`; Prisma Decimal; bigint minor helpers in shared (`parseMoneyString`). VOIDED excluded from intelligence sums. Complete-with-sale amount must be **> 0**; CHECK allows 0 at DB for generic transactions if app allowed it — create-transaction uses parseMoneyString (non-negative) and item sum; **zero-amount standalone TX may be allowed by CHECK** if items sum to 0 — **AMBIGUOUS / edge**. Complete-with-sale forbids zero.

---

## 36. Deletion rules

**Customer (OWNER+MANAGER):** If **any** `transactions` for that customer (COMPLETED **or** VOIDED) → 409 `Customer cannot be deleted while financial records exist`. If any `message_requests` exist → 409 `Customer cannot be deleted while message history exists`. Else delete opportunity Actions then visits then customer; outbox `CustomerDeleted` with visitCount and actionCount; audit `CUSTOMER_DELETED`.

**Visit (OWNER+MANAGER):** If any transaction has `visit_id` → 409. Else delete visit; `VisitDeleted`. Items/transactions never cascade-delete money.

Flutter: customer delete on detail for manager/owner; visit delete **not** exposed in Visits UI (API exists).

---

## 37. Starter service catalog

Registration (non-`@example.test`): atomic insert of `Hair Service`, `Nail Service` as normal `Service` rows. Renamable/deactivatable. Not global.  
`ensure-dev-catalog.cjs`: optional backfill script, not production request path.  
Tests using `@example.test` start with **empty** catalog unless tests insert services.

---

## 38. Test coverage

| Feature | Tests | Location |
| --- | --- | --- |
| Auth register/login/me/tenant | E2E | `apps/api/test/auth.e2e-spec.ts` |
| Users / last OWNER | E2E | `salon-user.e2e-spec.ts` |
| Customers CRUD isolation | E2E | `customer.e2e-spec.ts` |
| Import excel | E2E + unit | `customer-import.e2e-spec.ts`, `parse-customer-excel.spec.ts` |
| Visits / future date | E2E + unit | `visit.e2e-spec.ts`, `visited-at.spec.ts` |
| Visit+sale / finance / catalog | E2E | `visit-with-sale.e2e-spec.ts`, `finance.e2e-spec.ts` |
| Export | E2E + unit | `visit-export.e2e-spec.ts`, `visit-export.xlsx.spec.ts` |
| Intelligence | E2E + unit | `intelligence.e2e-spec.ts`, mapper/aggregates specs |
| Health/metrics | E2E | `phase-b-observability.e2e-spec.ts` |
| Idempotency/reliability | E2E | `phase-a-reliability.e2e-spec.ts` |
| Roles guard | unit | `roles.guard.spec.ts` |
| Flutter flows | widget | `widget_flow_test.dart`, visit_form, import, auth, session |
| Flutter API client | unit | `api_client_test.dart`, `integration_api_test.dart` |

**CURRENTLY NOT VERIFIED BY AUTOMATED TEST (examples, not auto-bugs):** Flutter OWNER end-to-end on Windows against live API; CORS; Redis/MinIO unused; campaign features (n/a); zero-amount `POST /transactions`; JWT after role change without re-login (principal uses DB role on next request; token `role` claim is not re-read); worker consume side effects (none). MANAGER cannot create OWNER is **unit-tested** in `salon-user-policy.spec.ts`.

---

## 39. Business rule inventory

**BR-001** Last active OWNER cannot be demoted/disabled. Condition: `wouldLeaveSalonWithoutOwner`. Actor: OWNER (role), OWNER+MANAGER (status). Forbidden: leave zero active owners. API: PATCH role/status. UI: none. DB: none. Audit: on success. Test: salon-user.e2e.

**BR-002** Tenant isolation via JWT `tid` + repository `salonId`. Client tenant ignored.

**BR-003** Email unique globally; normalized lowercase.

**BR-004** Password 8–128; Argon2id; never returned.

**BR-005** Login failure indistinguishable; dummy hash timing.

**BR-006** Suspended salon or disabled user cannot authenticate.

**BR-007** Customer phone unique per salon; format `09` + 9 digits.

**BR-008** STAFF cannot update/delete customers.

**BR-009** STAFF cannot complete-with-sale, create/void transactions, delete visits.

**BR-010** Only OWNER patches salon and writes services.

**BR-011** Visit `visitedAt` not more than 2 minutes in the future.

**BR-012** Visit is historical fact, not a booking.

**BR-013** Complete-with-sale amount > 0, currency IRR, service ACTIVE in tenant.

**BR-014** Transaction item totals must equal header amount.

**BR-015** Idempotency required for complete-with-sale and POST /transactions.

**BR-016** Same idempotency key + different hash → 409.

**BR-017** Inactive services cannot be used on new paid visits; history retains names.

**BR-018** Service names unique per salon.

**BR-019** Transaction amounts not editable; void only.

**BR-020** Intelligence uses COMPLETED transactions only.

**BR-021** Customer NEW/ACTIVE/RETURNING/AT_RISK/INACTIVE thresholds 35 / 2× / frequent 6 & 28.

**BR-022** Opportunities are recommendations, not campaigns.

**BR-023** Customer delete blocked if any transactions exist (including VOIDED).

**BR-024** Visit delete blocked if transactions reference it.

**BR-025** Customer delete cascades visits when no financial rows.

**BR-026** Starter Hair/Nail on real registration; skip `@example.test`.

**BR-027** Import existing phone → ALREADY_EXISTS, no update.

**BR-028** Import file discarded; zip/xlsx guards; 2MB / 5000 rows.

**BR-029** Visit export max 5000; Persian RTL sheet.

**BR-030** Intelligence scan cap 5000 customers (`hasMore`).

**BR-031** Reporting months are UTC, not salon-local.

**BR-032** Revenue decline opportunity requires previous UTC month transaction.

**BR-033** IDs are UUID v7.

**BR-034** Outbox known events consumed as no-op; unknown → dead letter.

**BR-035** Register throttle 5/min; login 10/min; global 60/min.

**BR-036** Hair/Nail are not privileged types — tenant-owned names.

**BR-037** GET /services hides INACTIVE except OWNER includeInactive.

**BR-038** Cross-tenant resource ids return 404.

**BR-039** JWT revalidated against ACTIVE user+salon on each request.

**BR-040** No refresh tokens; expiry 8h default.

**BR-041** MANAGER cannot PATCH /services (backend). Flutter hides management.

**BR-042** STAFF may import customers and export visits (backend).

**BR-043** Average money uses half-up bigint division.

**BR-044** Future visit skew 120 seconds.

**BR-045** Currency must be IRR (`assertCurrencyIrr`).

**BR-046** Transaction max 50 line items.

**BR-047** Void of already VOIDED is success without duplicate event.

**BR-048** Search customers is case-insensitive on names.

**BR-049** Date filter `YYYY-MM-DD` is UTC day, not salon local (API `date=`).

**BR-050** Flutter visit list uses local day `from`/`to` (client convention).

**BR-051** MANAGER may create STAFF only (`canAssignRole`). MANAGER may change status of STAFF only (`canChangeUserStatus`).

**BR-052** `GET /auth/me` returns `{ userId, tenantId, role }` only; Flutter display name/email come from local session storage.

**Business rules identified: 52.**

---

## 40. User-to-database traces (13)

### 1. Registration
RegisterScreen → AuthController.register → `POST /auth/register` → RegisterSalonOwnerDto → RegisterSalonOwnerUseCase → argon2 → Prisma TX salon+user+outbox+starter services+audit → JWT → SessionStore → `/`.

### 2. Login
LoginScreen → `POST /auth/login` → LoginUseCase → argon2.verify → JWT → SessionStore → `/`.

### 3. Create customer
CustomerForm → CustomerRepository.create → `POST /customers` → CreateCustomerUseCase → unique phone → Customer + audit + outbox.

### 4. Import
CustomerImportScreen → multipart `POST /customers/import` → zip/xlsx parse → TX createMany + outbox + audit → discard buffer.

### 5. Record visit
RecordVisit (no amount) → `POST /visits` → parseCompletedVisitedAt → Visit + VISIT_CREATED + VisitCompleted.

### 6. Record visit + sale
RecordVisit → `POST /visits/complete-with-sale` + Idempotency-Key → CompleteVisitWithSaleUseCase → Visit + Transaction + Item + dual audit/outbox.

### 7. Deactivate service
ServiceManagement → PATCH status INACTIVE → historical FKs remain; GET /services default omits it.

### 8. Customer intelligence
Detail → `GET /intelligence/customers/:id` → visit aggregates + revenue SQL + RuleBasedRetentionAnalyzer + revenueSignals.

### 9. Opportunities
OpportunitiesScreen → `GET /intelligence/opportunities` → scan ≤5000 + revenue map → sort → page.

### 10. Global visits
VisitsScreen → `GET /visits?from&to` → tenant SQL + lag previous visit.

### 11. Visit export
VisitsScreen export → `GET /visits/export` → ExcelJS RTL → audit → FilePicker save.

### 12. Delete customer
Detail delete → `DELETE /customers/:id` → count txs → delete visits → delete customer → audit/outbox or 409.

### 13. Void transaction
**API only** (Flutter TransactionRepository.voidTransaction unused by screens) → `POST /transactions/:id/void` → status VOIDED → audit/outbox if newly voided.

---

## 41. ASCII architecture diagrams

### 41.1 System

```text
Flutter  -->  Nest API  -->  PostgreSQL
                 |
                 +--> audit_logs / outbox_events / idempotency_records
Worker   -->  PostgreSQL (claim outbox, retention)
Redis/MinIO: configured, unused by app code
```

### 41.2 User journey

```text
Open -> Register/Login -> Today -> Customers <-> Detail
                              |         |
                              |         +-> Record visit / sale
                              +-> Visits -> Export
                              +-> Opportunities
                              +-> Profile -> Services (OWNER)
```

### 41.3 Domain

```text
Salon 1--* User
Salon 1--* Customer 1--* Visit
Salon 1--* Service
Customer 1--* Transaction 1--* TransactionItem --> Service
Visit 0..1 <-- Transaction
```

### 41.4 Financial flow

```text
Completed visit + amount --> Transaction(COMPLETED, IRR) + Item
Void --> status VOIDED (row kept)
Intelligence SUM amount WHERE COMPLETED
```

### 41.5 Intelligence

```text
Visits (dates) --> behavior --> status/signals/opportunities
COMPLETED txs --> revenue metrics --> trend / REVENUE_DECLINE
On-read, cap 5000 customers for visit scan
```

### 41.6 Outbox

```text
Domain TX COMMIT includes outbox INSERT
Worker SKIP LOCKED -> consume no-op -> PROCESSED or retry/DEAD_LETTER
```

### 41.7 Authentication

```text
Password -> Argon2id hash store
Login/Register -> JWT {sub,tid,role} 8h
Request -> Bearer -> JwtStrategy DB check ACTIVE
```

### 41.8 Tenant isolation

```text
JWT tid == users.salon_id == row.salon_id
Composite FKs prevent cross-tenant edges
Wrong UUID => 404
```

---

## 42. “What happens to a user?” (business narrative)

I open the Windows/Flutter app. I see a brief loading screen while the app checks for a saved login. If I am new, I register my salon name, my name, email, and password. The system creates my salon, makes me the OWNER, and (unless this is an automated test email) adds two ordinary services named Hair Service and Nail Service. It stores a password hash, writes audit and outbox rows, and gives me an 8-hour access token.

I log in later with the same email (any capitalization). If my account or salon is disabled, I only hear “invalid email or password.” After login I land on Today: counts of customers by retention status, UTC revenue totals, and opportunity counts. Those numbers are calculated when I open the page from visits and completed payments — not by AI.

I add a customer with a mobile number starting with 09. That number cannot already exist in **my** salon. I can import an Excel file of names and phones; the file is checked then thrown away. I open the customer, record that they already came in (a past time, not a future booking). If I am OWNER or MANAGER I can also choose a service and type the money received. The system stores a visit, a completed transaction, and a line item together. Staff can record the visit without money.

Revenue on that customer updates the next time intelligence is loaded. If they have not returned for more than about 35 days, they may appear At Risk; after twice that, Inactive, with a reactivation opportunity. If this UTC month’s completed revenue is lower than last UTC month’s, a revenue-decline opportunity appears. Nothing is emailed automatically.

On Visits I see today’s local-calendar visits and can export a Persian Excel file. On Profile I log out (the server is not called). If I am OWNER I manage service names and turn services off; old receipts still show the old service name.

Behind the scenes a worker marks outbox events processed without changing customer data. Money rows are never silently deleted; voiding (available to API clients, not the current Flutter screens) keeps the row and excludes it from intelligence.

---

## 43. Current state vs documented intent

| AREA | CURRENTLY IMPLEMENTED | DOCUMENTED/INTENDED | NOT IMPLEMENTED | AMBIGUOUS |
| --- | --- | --- | --- | --- |
| Authentication | JWT + Argon2id | yes | refresh/logout API | `/auth/me` omits name/email; Flutter uses stored copy |
| RBAC | 3 roles, guards + use cases | yes | — | MANAGER create OWNER |
| Tenancy | JWT + FKs | yes | DB RLS policies | — |
| Customers | CRUD + import | yes | merge/dedup beyond phone | — |
| Visits | completed only | docs say not booking | calendar | `date=` UTC vs Flutter local |
| Services | name catalog OWNER | later than some old docs | prices | — |
| Transactions | ledger + void API | financial-domain.md | Flutter void UI | zero-amount POST /transactions |
| Revenue intelligence | on-read rules | mvp + domain | persisted warehouse | stale comment in thresholds.ts |
| Opportunities | 3 types, list API | yes | campaigns | — |
| Excel import | xlsx | yes | csv | — |
| Excel export | visits | IMPLEMENTED — not all product docs | customer export | — |
| Audit | success writes | yes | failed-attempt audit | — |
| Outbox | write + worker | yes | real consumers | — |
| Worker | poll + retention | yes | HTTP health | — |
| Flutter | Windows MVP shell | yes | user admin, salon edit, segments, void | — |
| Campaigns | — | mvp.md | **not in code** | — |
| Price intelligence | — | mvp.md | **not in code** | — |
| Booking | — | explicitly out of scope | correctly absent | — |
| AI/ML | — | some marketing language | **not in code** | — |
| Redis/MinIO | compose + env | architecture future? | unused by apps | why required at boot |
| Swagger blurb | Phase 5 visits only | outdated vs finance/services | — | description vs API |

---

## 44. Known gaps (relevant to current system; not a generic checklist)

**GAP-001** Outbox consumers are no-ops.  
Current: events processed with no side effect.  
Why it matters: ops may believe async integrations exist.  
Evidence: `apps/worker/src/outbox/outbox.processor.ts`.  
Severity: medium (architecture). Business: none until a consumer is needed. Technical: at-least-once pipeline unused. Blocks MVP? **No.**

**GAP-002** Redis and MinIO required in env / Compose but unused.  
Evidence: `packages/config/src/index.ts`, grep of apps.  
Severity: low-medium (ops/secrets). Blocks MVP? **No.**

**GAP-003** No refresh token; 8h JWT; logout is local.  
Stolen token valid until expiry or user disable. Blocks MVP? **No** for single-operator salon.

**GAP-004** Flutter omits user admin, salon PATCH, transaction void, segments.  
Backend exists; operators cannot use those controls in-app. Severity: medium product. Blocks MVP? **Depends** — void/users undocumented as Flutter MVP.

**GAP-005** `product/mvp.md` campaigns and price intelligence not built.  
Severity: documentation drift. Blocks code MVP? **No.**

**GAP-006** Intelligence visit scan capped at 5000 customers; `hasMore` true understates segments.  
Evidence: `INTELLIGENCE_CUSTOMER_CAP`. Severity: medium at scale. Blocks small-salon MVP? **No.**

**GAP-007** `GET /users` unbounded. Severity: low until large staff lists.

**GAP-008** STAFF can export all visits and import customers.  
May be intended. **AMBIGUOUS — REQUIRES PRODUCT DECISION** if reception should not bulk-export PII.

**GAP-009** Email uniqueness is platform-global, not per salon.  
A person cannot be OWNER of salon A and STAFF of salon B with one email. Severity: product. Blocks single-salon MVP? **No.**

**GAP-010** Swagger description omits services/transactions. Drift only.

**GAP-011** Visit delete and void not in Flutter; financial history hard to correct in UI except customer delete when no txs.  
Severity: operational. Blocks MVP? **Maybe** if mistakes are common.

**GAP-012** Worker has no `/health`. Ops must use process checks. Severity: low.

**GAP-013** CORS absent — fine for Flutter desktop; browser clients would fail. Severity: low today.

**GAP-014** Last-OWNER rule not shown in Flutter (no user admin). Backend still enforces.

**Gaps identified: 14.**

---

## 45. Executive summary

**A. What this product is**  
A tenant-scoped salon system for **customers, completed visits, IRR ledger sales, and rule-based retention/revenue signals**, with a Flutter Windows client.

**B. Who it serves**  
Salon OWNER (buyer/admin), MANAGER, STAFF. Docs target women’s beauty salons; software is salon-tenant generic.

**C. Core user journey**  
Register → login → Today dashboard → customers → record completed visit (optional sale) → opportunities → export visits → manage services (OWNER).

**D. Core business loop**  
Capture history → compute who is slipping → show opportunities → human follow-up (not automated campaigns).

**E. Core data model**  
Salon → Users, Customers, Services, Visits, Transactions/Items, plus Outbox, Audit, Idempotency.

**F. Core financial model**  
Immutable COMPLETED/VOIDED IRR transactions; items explain the total; visits optionally link; intelligence ignores VOIDED.

**G. Core intelligence model**  
On-read visit cadence rules + UTC monthly revenue comparison. Not ML.

**H. Current architecture**  
Modular monolith: Nest API + Nest worker + Postgres/Prisma + Flutter. Transactional outbox without downstream products.

**I. Current security model**  
Argon2id, JWT 8h, RBAC, tenant from token, Helmet, throttle, upload guards, Pino redaction. No RLS.

**J. Current async model**  
Transactional outbox + SKIP LOCKED worker + retention cleanup; consume is ack-only.

**K. Current major limitations**  
No booking, payments, campaigns, AI, price lists, Flutter admin/void; intelligence cap; unused Redis/MinIO; docs ahead of campaigns.

**L. What is production-shaped**  
Auth, tenancy, customer/visit/service/transaction integrity, idempotency, audit, health/metrics, E2E coverage of core APIs, Excel import/export hardening.

**M. What is still MVP-grade**  
Single Flutter surface, no-op outbox, on-read intelligence, no refresh tokens, global email uniqueness, product-doc extras not built, operational worker health.

---

### Implementation / documentation conflicts (explicit)

1. `product/mvp.md` campaigns + price intelligence vs **absent modules**.  
2. `thresholds.ts` “transactions do not exist yet” vs **revenue SQL implemented**.  
3. Swagger “Phase 5 visits” vs **services/transactions/export/catalog**.  
4. Compose Redis/MinIO vs **no runtime clients**.  
5. Architecture may imply future object storage for files vs **import discarded**.  
6. Flutter local visit day vs API `date=` UTC semantics (clients must not mix blindly).  
7. Opportunity copy vs campaign language in older product docs.  
8. Login/register `{ accessToken, user: { id, name, email, … } }` vs `GET /auth/me` `{ userId, tenantId, role }` (Flutter restore merges stored name/email).

**Conflicts found: 8.**

---

*End of current-state specification. No application, schema, or migration files were modified to produce this document.*
