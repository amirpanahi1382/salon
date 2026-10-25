# Current-state system specification

**Product:** Beauty Salon Revenue Intelligence (salon-facing name in Flutter: توجه سالن / Salon Attention)  
**As of:** repository HEAD reviewed for the phone-first journey on 2026-10-20 (uncommitted UX work is not part of HEAD)
**Authority:** executable code, Prisma schema, SQL migrations, tests, Flutter client, then `.env.example` names, then other docs.

This document answers **what exists today**. It is not a roadmap.

Authority is **current repository HEAD**. Do not treat this as a statement about `origin/main` unless that remote has been verified.

Legend: **Implemented** · **Partial** · **Deferred** · **Out of scope** · **Known debt**

---

## 1. Product identity

**Implemented:** Vertical SaaS for a single-salon tenant. Thesis: more revenue from customers the salon already has. Visits are completed history, not bookings.

**Not encoded in schema:** “women’s salon” (product decision only).

**Out of scope (verified absent):** booking/calendar, POS hardware or payment gateway, accounting, payroll, commissions, inventory, supplier marketplace, product price catalog, campaign aggregates, ML/LLM. Manual card-transfer instructions, receipt upload, and platform-admin activation review are implemented onboarding evidence, not a payment processor or a financial ledger.

---

## 2. Repository layout

| Path | Used? |
| --- | --- |
| `apps/api` | Yes — NestJS HTTP |
| `apps/worker` | Yes — outbox + retention, no HTTP |
| `apps/mobile` | Yes — Flutter; not in pnpm workspace |
| `packages/{database,config,shared,object-storage}` | Yes |
| `infra/docker` | Postgres used; Redis unused by code; MinIO used for VIP sample works and private activation receipts |
| `packages/database/prisma/migrations` | Yes (foundation through VIP, including MessageRequest opportunity-context CHECK) |

```text
Flutter → NestJS API → PostgreSQL/Prisma
                   │       → outbox → Worker → Bale Safir (BALE only)
                   ▼
                 MinIO (VIP sample works + private activation receipts)
```

---

## 3. Auth

| Item | Status |
| --- | --- |
| `POST /auth/register` | **Closed.** Email is not a signup identity. The route is absent in every `PUBLIC_REGISTRATION_MODE`. Public salon creation is `POST /auth/signup/phone/complete` |
| `POST /auth/login` | **Closed.** Email and password are not a login. Salon users and platform admins sign in with `POST /auth/login/phone` |
| `POST /auth/signup/phone/start` and `POST /auth/signup/phone/verify` | **Implemented, disabled by default** (`PHONE_SIGNUP_ENABLED=false`). Phone-possession challenge for a future owner signup. Does not create a salon, user, password, session, payment, or terms acceptance. Not a marketing or VIP message, and it does not consult the global marketing stop. One open challenge per phone hash. Resend invalidates the previous local challenge. Cooldown 60s, 3 sends / 15 minutes, 5 verification attempts, local TTL cap 60s and never later than OTPy's reported TTL, proof lifetime 600s. Idempotency-Key required. An unconfirmed send or verify is not retried silently. Successful verify returns a one-time signup proof only if the local deadline is still in the future at the verification write. That check, and the checks for attempt reservation, proof consumption, and send confirmation, use PostgreSQL `clock_timestamp()` in the write itself so a lock wait cannot reuse an earlier timestamp. Only the proof hash is stored. The response does not reveal whether the phone already has an account. Internal proof consumption requires that same phone and is not an HTTP route. A send whose local deadline has already passed commits `EXPIRED` and its audit event before the error is returned |
| `POST /auth/signup/phone/complete` | **Implemented, disabled by default.** Consumes the proof for that normalized phone in the same transaction as the salon, the single phone-owning OWNER, starter services, audit, and outbox rows. The two password fields must match. Access begins at `AWAITING_AGREEMENT` with `additionalUsersAllowed=false`. No email is invented. No product session is returned. Idempotency-Key required; the same key and body replay the committed account. The phone is globally unique and cannot also belong to a platform admin. Public completion never creates a platform admin |
| `POST /auth/login/phone` | **Implemented.** Always available. One phone and password. The server chooses a salon session or a platform-admin session from the account that owns the phone. The client does not send a role. Argon2id. Unknown phone, wrong password, and a cross-role collision share one failure. Session scope follows current salon access, including when `PHONE_SIGNUP_ENABLED` is false. Throttle 10/min |
| Public registration | Email registration is closed in every mode. `PUBLIC_REGISTRATION_MODE` remains so an older environment file still loads; it does not open `POST /auth/register`. `PHONE_SIGNUP_ENABLED` controls OTP start, verify, and completion only and stays false. It may be true only with `PUBLIC_REGISTRATION_MODE=phone` and `PHONE_SIGNUP_HASH_SECRET`. Live OTP also requires a privately configured `OTPY_API_KEY`. Publishing this slice does not authorize a live send |
| `GET /auth/account` | **Implemented** — current `accessState` and `sessionScope`. Allowed for an onboarding session. Product routes are not |
| Agreement acceptance | **Implemented, disabled by default** (`AGREEMENT_ACCEPTANCE_ENABLED=false`). Operator `POST /admin/agreements/versions/publish` inserts source-controlled `CONTRACT_V1` once; startup does not. `GET /agreement/current` and `POST /agreement/presentations` show that version. `POST /agreement/acceptance` requires an `AWAITING_AGREEMENT` phone OWNER, the verified phone, the same presentation, explicit `accepted: true`, and `Idempotency-Key`. It stores one immutable acceptance and sets that salon to `AWAITING_PAYMENT` in the same transaction. Receipt and document downloads are allowed for the accepting owner, and the platform-admin evidence export stays available, after `AGREEMENT_ACCEPTANCE_ENABLED` is turned off. That flag still closes publish, `GET /agreement/current`, presentation, and new acceptance. Document and evidence reads still require the evidence key and are not public. The recorded client IP is the socket address unless the socket peer is a configured `TRUSTED_PROXY_IPS` entry for a nonzero `TRUSTED_PROXY_HOPS`. A client-supplied `X-Forwarded-For` is not verified evidence. Acceptance does not publish card details or activate the product. Name, national ID, salon name, and authority to contract are user-declared |
| Manual card transfer | **Implemented, disabled by default** (`MANUAL_TRANSFER_ENABLED=false`). There is no payment gateway. While the flag is off, new card instructions are not served, and upload, submit, approve, and reject return 404. An onboarding owner with no receipt gets `GET /activation/status` phase `PAYMENT_UNAVAILABLE` and no card fields. An owner who already submitted still receives that review status, including a rejection reason with no new card details. A platform admin can still list receipt history across pending, approved, and rejected phases (server-side phase filter and cursor pages), read review details, and read the audited image. Those reads stay authenticated and tenant-scoped, and image reads re-verify the object. When the flag is on, an onboarding OWNER of an `AWAITING_PAYMENT` phone salon reads payment instructions from the accepted `CONTRACT_V1` snapshot (`50000000.00` IRR, shown as `۵۰٬۰۰۰٬۰۰۰ ریال`). The card number and cardholder are server constants. An upload is fully decoded before it can become `STORED`; the stored bytes and SHA-256 remain the original file, and a truncated, corrupt, or oversized image is rejected. The admin checkbox and «فعال‌سازی» stay disabled until that image renders. `POST /activation/receipts` keeps an existing `STORED` receipt until the replacement object is stored and verified, then sets the old row to `SUPERSEDED`, the new row to `STORED`, and writes `ACTIVATION_RECEIPT_STORED` in one database transaction. A failed, timed-out, or unverified replacement leaves the previous receipt ready, keeps its object, and writes no success audit. PostgreSQL and object storage are not one transaction: a crash after PUT and before that commit, or a failed success-audit insert, can leave the new object orphaned on an `UPLOADING` row while the previous `STORED` row remains submittable and no success audit is visible. That audit failure is not retried and does not delete the object. `POST /activation/receipts/:id/submit` moves `STORED` to `UNDER_REVIEW` and snapshots the instructions. That is not confirmed payment. Platform Admin «فیش واریز» shows the image and requires the unchecked attestation «واریز را در حساب بانکی بررسی و با این فیش تطبیق داده‌ام» before «فعال‌سازی». `POST .../approve` independently requires that exact wording. It stores the wording, admin, server time, receipt id, digest, and decision. A client flag is not a bank check, and opening the image only audits `ACTIVATION_RECEIPT_VIEWED`. `POST .../reject` still requires a reason and leaves `AWAITING_PAYMENT` so a later upload can replace the receipt when the flag is on. `POST /auth/session/product` issues a new product JWT only after access is already `PRODUCT`; the onboarding token is not promoted |
| `GET /auth/me` | **Implemented** — identity for product and onboarding sessions. The phone number is not included |
| `GET /auth/owner` | **Implemented** leftover OWNER probe. Denied for an onboarding session |
| JWT salon | Product session: `sub`, `tid`, `role`, and `jti`. Onboarding session adds `scp=onboarding`. `JWT_EXPIRES_IN` default 8h; no refresh. `JwtAuthGuard` reloads access and denies product routes for `scp=onboarding`. A product token is rejected when access is no longer `PRODUCT`. An onboarding token stays onboarding after approval until `POST /auth/session/product` or a new login. Tokens issued before `jti` still authenticate; agreement acceptance requires `jti` |
| Passwords | Argon2id |
| `POST /admin/auth/login` `GET /admin/auth/me` | **Email login is closed.** `GET /admin/auth/me` is `scp=platform`, no tid. A platform admin signs in with `POST /auth/login/phone` |
| Phone binding | **Removed from this unpublished slice.** Historical accounts are not migrated. There is no bind route and no `phoneVerified` gate |
| `pnpm db:bootstrap-admin` | **Implemented for a new empty database.** Before any verification message or insert, the operator-supplied database name, PostgreSQL system identifier, and database comment must match values read from the live connection. A missing or mismatched proof stops the command. It also refuses database names `salon` and `salon_preview`. The operator supplies `PLATFORM_ADMIN_PHONE` and `PLATFORM_ADMIN_PASSWORD`. The first successful proof run sends a verification code and inserts nothing. The second run, with `PLATFORM_ADMIN_OTP_CODE`, verifies that code and creates one admin. A failed code inserts nothing. A second admin is refused, so the command cannot reset a password. API startup does not run it. Public signup cannot create an admin |
| Logout | Client token clear |
| Suspended salon / DISABLED user | Login and subsequent JWT checks fail closed |

Principal is re-loaded from DB (role, status, salon status, and salon access).

---

## 4. Salon users and RBAC

Roles: `OWNER` | `MANAGER` | `STAFF`. User status `ACTIVE` | `DISABLED`. Salon `ACTIVE` | `SUSPENDED`. Salon access `PRODUCT` | `AWAITING_AGREEMENT` | `AWAITING_PAYMENT` (not suspension, not VIP entitlement). `AWAITING_PAYMENT` is still onboarding: an ACTIVE user and a fresh login stay out of product routes. Login identity is a required canonical phone (`09` + 9 digits), unique across salon users and platform admins. Email, when stored, is optional contact and is not a login. Historical accounts are not migrated, and the phone-first migration has not been applied to the persistent databases `salon` and `salon_preview`. Phone-owned salons reject additional users in `POST /users` and by a database insert trigger. Receipt phase is separate: `STORED`, then `UNDER_REVIEW`, then `APPROVED` (`PRODUCT`) or `REJECTED` with another upload allowed when manual transfer is on. Replacing a `STORED` image does not supersede it until the new object verifies. `UPLOADING` and `FAILED` are not reviewable. A receipt image is not a verified transfer; approval stores the platform admin’s manual bank attestation. Campaign start is not implemented.

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

**Implemented:** `LedgerTransaction` + items; create; list; get; void (repeat void no-op); customer transactions list. Amount decimal strings. IRR. Complete-with-sale writes visit+tx+item atomically. Phase 9 database triggers now enforce item arithmetic and a nonempty exact item sum equal to the header at commit for new/financially changed rows, including VOIDED; existing historical discrepancies remain unvalidated until the read-only preflight and provenance review described in `domain/financial-domain.md`.

Revenue metrics on intelligence summary/customer: completed only; UTC months; `REVENUE_DECLINE` when trend `DECREASING`. Details: `domain/financial-domain.md`.

Flutter sale path: complete-with-sale, not void UI (**Partial**).

---

## 9. Intelligence

**Implemented (derived on read):** `@salon/shared` `RuleBasedRetentionAnalyzer`. Statuses `NEW ACTIVE RETURNING AT_RISK INACTIVE`. Opportunities `REACTIVATION CUSTOMER_RETURN REVENUE_DECLINE`. Signals `NEW_CUSTOMER OVERDUE FREQUENT REVENUE_DECLINING`.

APIs: `GET /intelligence/summary|opportunities|segments|customers/:id`.

`GET /intelligence/summary` covers every customer in the authenticated salon, with complete derived status, signal, and unsuppressed opportunity counts and completed-transaction IRR totals. It scans customer/visit metrics in bounded 500-customer internal batches; the retained `hasMore` response field is always false because the summary is complete. `GET /intelligence/segments` and `/intelligence/opportunities` return up to 200 eligible results per page, globally ordered by days since last Visit descending, customer UUID descending, then opportunity type descending where applicable. Segment customers without Visits rank at −1; opportunity rows without Visits rank at 0. Filters are applied to qualifying outputs across the full tenant population. `hasMore=true` means another eligible result was found and always includes a usable `nextCursor`.

New list cursors retain the evaluation instant, active status/type filter, and result sort tuple. A continued read uses the same retention and UTC revenue reporting instant; pre-existing two-part segment and three-part opportunity cursors remain accepted and use the current instant. These are live reads, not database snapshots: concurrent customer, visit, action, or transaction changes can affect later pages or a multi-query summary. Refresh to reconcile. Flutter **Today** and **Opportunities** use their newer serving paths; customer detail still uses `GET /intelligence/customers/:id`; there is no segments screen.

**Opportunities (Flutter «فرصت‌ها»)** **Implemented** as three domain sections composed in Flutter. Tenant from JWT on every read. No combined «همه» view. Live reads (not a multi-query snapshot); refresh to reconcile concurrent updates. Cursor pagination is bounded.

1. **«افت درآمد»** `GET /intelligence/revenue-drops` — monetary ledger read. Customers whose **COMPLETED** (non-`VOIDED`) transaction revenue in the previous comparable Jalali calendar month (Asia/Tehran), measured only through the comparable elapsed point of that month, exceeds revenue from the start of the current Jalali month through the report instant (`asOf`). Amounts are decimal strings in IRR from `transactions.amount`. Visit counts are not used. Equal elapsed time; when the previous Jalali month is shorter, the previous window end clamps to the last instant of that month. The list cursor carries a validated fixed `asOf` so every page in one browsing session reuses the same Jalali windows; refresh omits the cursor and starts a new evaluation. That fixed `asOf` is **not** a database snapshot—voids or new COMPLETED rows that commit while paging can still change later pages (`consistency: LIVE_READ`). Response includes previous comparable amount, current amount, difference, window bounds, and a Persian explanation. Qualifying customers can be multi-selected (max 30) into the existing `POST /customers/:id/messages` composer. This endpoint is **not** the visit-lapse `REVENUE_DROP` filter on `GET /opportunities/workspace`.

2. **«پیام‌های VIP»** `GET /vip/requests` (list route registered before `:id`) — **read-only** paginated history of **every** `VipRequest` for this salon (not the bounded recent summary on `GET /vip/capability`). Does **not** call `expireStaleReservations` or otherwise write; overdue `AWAITING_SAMPLE_WORK` drafts keep their stored status and the salon headline derives from `reservedUntil` vs evaluation time. Each item is identified by `VipRequest.id` and includes list name, requested quantity, request timestamps/state, live progress facts for that request/list snapshot, recorded-send counts (manual vs all recorded; **not** confirmed delivery), still queued/in-progress counts, and distinct VIP recipients with a visit intention / linked Visit for that request (joined to `vip_request_recipients` under the same salon/request). Intention ≠ Visit; messaging never creates Visit or Transaction. Target-list phones are never returned. Revoked entitlement sets `entitled: false` and blocks new VIP actions, but historical requests for this salon remain listed. Cancelled drafts without a recipient snapshot report intention/visit metrics as `UNAVAILABLE` rather than inventing zeros.

3. **«ارسال پیام عادی»** `GET /messages/history` (registered before `messages/:id`) — paginated ordinary (non-VIP) `MessageRequest` history for this salon, including older requests (not only today’s manual outreach or latest-per-customer). Display buckets: `QUEUED` / `PROCESSING` (includes `DISPATCHED`) / `SENT` / `FAILED` / `CANCELLED` from request + delivery facts. `SENT` means recorded send (manual mark or provider acceptance path), not delivery or read. Message bodies are omitted. Opening a row navigates to the customer; admin queue behavior is unchanged.

Legacy `GET /opportunities/workspace` (including visit-lapse `REVENUE_DROP`) remains as an API read model but is no longer the Flutter Opportunities presentation. OpportunityAction history and intelligence summary/opportunity APIs remain.

`GET /salon/overall-performance` **Implemented (API + Flutter Today):** all-time derived-on-read counts for the authenticated salon (`OWNER`/`MANAGER`/`STAFF`): Customer rows, SENT non-VIP customer `MessageDelivery`s, SENT VIP-origin `MessageDelivery`s (`vip_request_id`), all `ReturnCommitment`s, unique customers with COMMITMENT_BACKED and/or OBSERVED visit evidence (same eligible SENT/commitment/observed association SQL, no week filter, one customer once), unique customers with ≥2 Visits. Not causal. Not the intelligence 5,000 scan.

`HIGH_VALUE` / cross-sell: **Deferred**.

---

## 10. Opportunity actions

**Implemented:** `POST .../actions` (required Idempotency-Key), list, customer list, complete, dismiss.

Statuses `OPEN COMPLETED DISMISSED`. `sourceVisitId` episode snapshot. Concurrent create coalesces. Messaging does not complete the action.

---

## 11. Messaging

**Implemented.** See `docs/messaging-domain.md`.

Phase 8 database constraints require the salon user recorded as creator of an OpportunityAction, MessageRequest, MessageDelivery, or VipRequest to belong to the row's salon. A linked VIP recipient must reference a MessageRequest in the same salon; an unlinked recipient is valid. Platform-admin dispatch/fulfillment remains separately attributed, and workers do not become salon users. The composite FKs enforce new key writes but have not validated historical rows. Phase 8B also retains the original validated ID-only FKs so inconsistent historical rows cannot lose their parent. Unrelated updates to those rows remain possible; see `architecture/data-model.md` for rollout and preflight.

Salon: opportunity messages, manual messages, get, customer message list, manual-outreach inbox.

Admin: `GET /admin/message-queue`, get one, `select-bale`, `select-manual`, `mark-manual-sent` (QUEUED may be fulfilled in one step), `cancel` (QUEUED or manual PENDING only; durable `CANCELLED`, not a delete), `retry`. Derived ordinary salon folders: `GET /admin/messages/normal/salons` and `GET /admin/messages/normal/salons/:salonId` (customer-bound, non-VIP only; SQL aggregates; cursor pagination; optional salon-name `q`).

Worker: BALE only. Outbox acknowledgements are fenced by claim generation; each Bale delivery attempt has a token and lease, while admin retries advance the logical activation generation. Stale handler outcomes leave the event reclaimable without terminal evidence. Each bounded concurrent batch drains all started handlers before polling again, including after timeout cancellation. `SENT` = provider accepted.
API and worker error diagnostics retain request/event IDs, operation, outcome, and stable error codes/categories without writing raw unexpected exception text or stack traces to logs. New outbox retry/dead-letter `last_error` values are allowlisted codes; historical values are unchanged. Known 4xx responses remain stable; unexpected 5xx and infrastructure responses use fixed messages. See `architecture/operations.md` for operator lookup and retention limits.
MessageRequest owns the immutable execution destination for new customer and VIP intents. Customer phone edits affect future requests only; admin execution and Bale worker use the request snapshot. Legacy ordinary rows without provable destination remain null and cannot be sent automatically. `SENT` means provider accepted the request destination, not delivery or reading.

Daily limit Tehran calendar, shared opportunity+manual. VIP excluded from daily limit.

`ReturnCommitment` **Implemented (API + Flutter customer/recovery UX):** `POST /messages/:messageRequestId/return-commitments` (Idempotency-Key required), `PATCH /return-commitments/:id` (Idempotency-Key + `updatedAt` CAS), `GET /customers/:id/return-commitments`, `GET /return-commitments/upcoming` (14-day default / 31-day max **query window**, not a booking horizon), `GET /return-commitments/open` (**operationally open** agreed returns: `actualVisitId` IS NULL **and** no same-salon Visit with `visitedAt` > source `MessageDelivery.submittedAt`; not identical to unlinked rows; one row per customer from remaining open commitments by earliest `expectedAt` then id; overdue included and flagged; phone from `Customer`), `POST /return-commitments/:id/arrive` (atomic Visit + link; OWNER/MANAGER optional sale; 409 `RETURN_COMMITMENT_VISIT_REVIEW_REQUIRED` if `actualVisitId` is null but a post-outreach Visit already exists — does not infer `actualVisitId`; replay of a successful linked arrive is unchanged), `POST /return-commitments/:id/link-visit` (API correction; **not** Flutter V1). Platform admin: `POST /admin/message-queue/:messageRequestId/return-commitments` and `PATCH /admin/return-commitments/:id` record the **same** tenant-bound row; actor is XOR salon `User` XOR `PlatformAdmin` (CHECK). Salon reads expose `recordedBySupport`, not admin identity. Customer commitment reads include derived `operationallyOpen`. Message GET/list include `returnCommitment` summary or null. OWNER/MANAGER/STAFF. Not a Visit or appointment. Flutter records agreed return time from SENT customer outreach (salon profile or admin message sheet), edits **operationally open** commitments, arrives via `/arrive` (not generic `POST /visits`), and shows future commitments separately from completed visits. STAFF open «مشتریان نوبت گرفته بازگشتی» from Today. OWNER/MANAGER record and arrive commitments from customer and follow-up surfaces. Composer shows upcoming commitments as send-time context only (failure does not block send). No calendar, booking, or capacity. There is no weekly salon recovery-outcomes screen or `GET /recovery/outcomes/*`. Independent `POST /visits` / complete-with-sale **do not** infer `actualVisitId` (explicit link only). A later authoritative Visit **does** settle operational follow-up without becoming COMMITMENT_BACKED.

`GET /customers/:id/observed-returns` **Implemented (API + Flutter):** derived last-touch SENT message → later Visit. Flutter presents OBSERVED only when the same Visit is not already shown as COMMITMENT_BACKED. Copy is evidence-based (associated recorded revenue), not campaign causality.

`VisitIntention` **Implemented (API + Flutter):** a reported intention to visit, separate from `ReturnCommitment`. Salon `POST /customers/:id/visit-intentions` and Platform Admin `POST /admin/customers/:id/visit-intentions` record a customer intention without a SENT message. Time is `UNKNOWN`, calendar `DATE`, or timezone-qualified `INSTANT`. `PATCH /visit-intentions/:id` corrects that time and keeps the original reporter. `POST /visit-intentions/:id/arrive` reuses the existing Visit writer and links the intention in one transaction; `POST /visit-intentions/:id/link-visit` links a Visit that already exists. Independent `POST /visits` does not link. STAFF still cannot record a sale. Salon `POST /vip/requests/:id/visit-intentions` records an inbound VIP intention and requires the name or phone the prospect gave the salon. Admin `POST /admin/vip-requests/:id/recipients/:recipientId/visit-intentions` accepts a previously deployed body that contains only the agreed time as `WITHHELD`, with the original time-only idempotency hash. A body that supplies any contact field must include both name and phone and `prospectAuthorizedSharingWithSalon: true`, creating `ADMIN_AUTHORIZED`; partial details or a missing or false attestation are rejected. Historical inbound rows with no contact stay `WITHHELD`. Existing Admin rows stay `WITHHELD` and are not backfilled. A later Admin contact correction requires `prospectAuthorizedSharingWithSalon: true` again. Salon follow-ups and `GET /vip/requests/:id/visit-intentions` show disclosed contact only for `SALON_SUPPLIED` or `ADMIN_AUTHORIZED`, with the Platform Admin source labeled separately, and omit target-list phone, name, and recipient id. That request list is cursor-paged by `createdAt DESC, id DESC` (default 20, maximum 50), returns `hasMore` from one extra row, and rejects a cursor that belongs to another request. Contact correction appends a revision and does not change the original reporter. These writes do not create a Customer, Visit, delivery, or transaction. `GET /follow-ups/customers` unions operationally open ReturnCommitments with open customer intentions. `GET /follow-ups/vip` lists open VIP intentions only. The salon VIP request intention history uses that same backend `operationallyOpen` flag: an open row keeps the intention wording and «مراجعه کرد»; a linked row hides that action and shows one of «مراجعهٔ ثبت‌شده بدون فروش»، «مراجعهٔ ثبت‌شده با فروش»، «بازگشت با مراجعهٔ جدید»، or «جذب ثبت‌شده با مراجعه». Acquisition is only a first Visit explicitly linked to that VIP intention. A prior Visit makes the same link a return. Those two labels are a current classification of the linked Visit against the customer's Visits, ordered by `visitedAt`, then Visit `createdAt` and id. Recording an earlier Visit later leaves the link in place and recalculates the label; it does not store an immutable acquisition claim. Sale is a separate completed transaction on the Visit. This does not mark a VIP message delivered, does not attribute revenue, and does not change an independent Visit into acquisition. `POST /visit-intentions/:id/arrive` can include `newCustomer` for a VIP intention and then creates that Customer, the Visit, the optional sale, and the link in one transaction. That Customer insert is the same Customer-module operation used by `POST /customers`: validation, the salon phone lock, the row, `CustomerCreated`, and `CUSTOMER_CREATED`. It does not open a second transaction. Ordinary create still returns `CONFLICT` for a duplicate phone; VIP arrival still returns `CUSTOMER_PHONE_EXISTS`. `customerId` together with `newCustomer` is rejected. An existing phone returns `CUSTOMER_PHONE_EXISTS` and does not merge. Published arrive calls that only send `customerId` keep the previous hash and behavior. Unknown and date-only rows are not overdue. Today shows **پیگیری‌ها** with **مشتریان قبلی** and **مراجعه‌های VIP**. Flutter links an arrival only from a specific open intention row; a generic «ثبت مراجعه» stays an independent Visit. Pending intention saves reuse one idempotency key until success or the payload changes. VIP arrival chooses an existing customer by search and later pages, or opens Record Visit to supply the customer details. The Customer is not created until that form is saved. Disclosed name or phone is shown only under the existing disclosure policy and is not copied from the target list. A withheld identity starts with empty customer fields. Ordinary Admin message detail can record a customer intention told to support, including without a SENT delivery, beside the existing SENT ReturnCommitment action.

Platform message stop **Implemented (API + Admin Flutter):** `GET /admin/message-stops?phone=`, `POST /admin/message-stops`, and `POST /admin/message-stops/lift` are Platform Admin only. The phone must already be canonical `09` plus 9 digits. Confirmation is required. One current row per phone; register and lift events are append-only. The stop applies to ordinary manual and opportunity sends, VIP selection, VIP manual dispatch, export, admin mode selection, manual mark-sent, Bale retry, and the worker immediately before the provider call. Unsent work becomes `CANCELLED` plus `message_global_stop_outcomes` (`GLOBALLY_STOPPED` in VIP execution counts). That outcome keeps the original VIP recipient out of later dispatch and out of a newly generated Excel file after the stop is lifted. `SENT` evidence is not rewritten. Manual mark-sent takes the phone lock before the request row lock. A same-day cancelled ordinary request still occupies the daily-limit key, so a new same-day send after a lift can return `MESSAGE_DAILY_LIMIT_REACHED` without reopening the blocked request. Salon lists expose `sendableContactCount` for the 30/50/100 gate. New VIP exports omit stopped phones. Files already outside the app are not recalled. A null historical destination has no stop action.

The weekly owner recovery-outcomes report (`GET /recovery/outcomes/summary` and `GET /recovery/outcomes/returns`, Flutter «نتیجه ارسال پیام‌ها») is **removed**. SENT, ReturnCommitment, Visit, Transaction, COMMITMENT_BACKED, and OBSERVED facts remain. Customer-detail, open agreed returns, overall performance, and the opportunities workspace still derive association on read.

Flutter pages COMMITMENT_BACKED, OBSERVED, operationally open commitments, and customer-detail messages/commitments/observed returns separately through their existing cursors. A failed later page keeps loaded rows and offers retry; changing the customer resets the page state and ignores an old response. Visible row counts mean **loaded rows**. Customer-detail OBSERVED cards wait for all commitment pages before applying commitment precedence. API evidence selection uses full tenant history before cursor filtering; each endpoint's existing keyset order and maximum page size remain unchanged. Keyset pages are live reads, not a snapshot: concurrent inserts, deletes, or edits can change later results, so refresh to reconcile.

Return-evidence selection is all-history and tenant/customer-ID based before cursor filtering: eligible SENT non-VIP delivery with non-null `submittedAt`, strict `submittedAt < visitedAt`, last touch per Visit (`submittedAt`, delivery `createdAt`, id descending), then first Visit per delivery (`visitedAt`, Visit `createdAt`, id ascending). The raw customer observed-return endpoint keeps that OBSERVED association even for a commitment-linked Visit; customer presentation and overall/workspace views give a valid explicit COMMITMENT_BACKED link precedence **after** first-return selection. Thus a September 9 send claimed by a September 10 linked Visit cannot be counted again as OBSERVED on September 15; a second send on September 14 can select September 15. An unlinked later Visit may settle operational follow-up without creating explicit fulfillment. COMMITMENT_BACKED requires matching salon, customer, request, delivery, SENT submission, and strict Visit chronology; inconsistent legacy links remain stored but do not create return evidence. An otherwise provenance-valid explicit link to a Visit at/before its own source submission is not COMMITMENT_BACKED, but the existing visit-level precedence rule still suppresses OBSERVED for that same Visit. Associated money uses COMPLETED Visit transactions only and distinguishes no recorded sale from a recorded zero sale. These reads do not rewrite historical Visit, Transaction, MessageRequest, or MessageDelivery rows.

---

## 11A. Support conversations

**Implemented.** One text conversation per salon user with Platform Admin, opened from «حساب من» → «ارتباط با پشتیبانی». It is not attached to a MessageRequest or VipRequest.

`support_conversations` is unique on `user_id` and tenant-bound with `(user_id, salon_id)`. `support_messages` are immutable. The author is exactly one salon user or one Platform Admin. Body length is 1–2000. Pages are 30 rows, newest first, cursor `(createdAt, id)`.

Salon: `GET /support/conversation`, `POST /support/conversation/messages` (`Idempotency-Key`). Identity comes from the JWT. OWNER, MANAGER, and STAFF each see only their own thread.

Platform Admin: `GET /admin/support/conversations`, `GET /admin/support/conversations/:id`, `POST /admin/support/conversations/:id/messages`. Flutter lists them under «ارتباط با کاربران», separate from ordinary and VIP delivery queues.

A message and its conversation timestamp/reply flag commit in one transaction. After the conversation row lock is held, the new message timestamp is the later of the database clock truncated to milliseconds and the previous `lastMessageAt` plus one millisecond. That keeps `(createdAt, id)` strictly after the stored conversation time when two commits share a millisecond. `lastMessageAt` and `awaitingSupportReply` follow that latest row. Replaying an idempotency key returns the original message and does not move either field. Audit metadata is `conversationId`, `messageId`, and `authorKind` only. No outbox, provider, edit, delete, attachment, or realtime channel.

## 12. VIP

**Implemented** (API + Flutter in current repository HEAD).

Admin: import template/import (phone required, name optional; import creates `PENDING` with null `regionCode` and null `catalogMembership`), list CRUD-ish (patch/delete), entitlements grant/revoke, list salons, salon profile, export request Excel, sample download, `dispatch-manual`, `dispatch-bale` (placeholder). Flutter admin VIP is three surfaces: outreach folders (`/admin/vip/outreach`) with actions «لیست‌های VIP» and «فعال‌سازی سالن»; inventory (`/admin/vip`) of every list; salon access (`/admin/vip/salons`) of **all** salons. `GET /admin/vip/lists` lists every list when `catalogMembership` is omitted, ordered by `createdAt DESC, id DESC`, 50 rows per page. Admin inventory uses that unfiltered page. `catalogMembership=ORIGINAL_TEHRAN` remains an API filter and a 3-part cursor so an all-lists cursor cannot continue the collection page. `PATCH /admin/vip/lists/:id` with `availability=ACTIVE` is the activation action: it requires a canonical Tehran `regionCode` `01`–`14` (body, or the list’s existing valid region) and atomically writes `status=ACTIVE`, that `regionCode`, and `catalogMembership=ORIGINAL_TEHRAN`. There is no later operator catalog approval in this workflow. An already `ACTIVE` unclassified list is completed by the same PATCH (region required if missing) without deactivate/reactivate. `IN_USE` lists return 409. Activation does not grant `VipSalonEntitlement` and does not infer region from phone numbers. Deactivate writes `INACTIVE` and leaves region/catalog in place. «فعال» in Admin UI means the unreserved list is actually requestable. Pending, inactive, missing-region, and in-use lists show an explicit reason. Salon browse/reserve and Admin `requestableBySalons` share one predicate: `ACTIVE`, unreserved, `ORIGINAL_TEHRAN`, and a canonical region `01`–`14`. Each inventory item includes `requestableBySalons` (that same predicate), `totalRequestCount` (all `vip_requests` for the list, including CANCELLED), and `openRequestCount` (`AWAITING_SAMPLE_WORK`/`SUBMITTED`/`MANUAL_QUEUED`/`BALE_NOT_IMPLEMENTED`). Admin inventory and list detail show region, contact count, status, and requestability. Historical `ACTIVE` lists without a valid region and `ORIGINAL_TEHRAN` stay unavailable until an explicit admin activation with a region; there is no backfill. `GET /admin/vip/salons/:salonId/profile` is an admin **read model**: entitlement, live `asOf`, distinct VIP lists requested, total VIP requests (including cancelled), open VIP requests, ordinary `message_requests` with `vip_request_id` null, and recorded sends (`MessageDelivery` `SENT` + `submittedAt`) split VIP vs ordinary. One delivery row per request. Queued work is not a send. Target-list phones and message bodies are omitted. Grant/revoke stay `POST /admin/vip/entitlements` and `DELETE /admin/vip/entitlements/:salonId` with Idempotency-Key; revoke blocks new requests and does not hide history. Response `listCount` is the full matching list population; `contactRowCount` is the count of `vip_target_contacts` rows in that population; `recordedContactCount` is the sum of stored `contactCount`. Null membership means the list is not in the collection. New salon region counts, region lists, and list reservation include only that requestable predicate; the reservation update checks it in the same statement as the unreserved guard. Historical requests on other lists stay readable and follow their existing request rules. Admin inventory shows the stored list name and, when `regionCode` is canonical, the shared region label beside it. Admin outreach titles use that same region label; the list name stays a separate line. Salon list cards show the stored list name and the region label, and the geographic-range field remains editable message text. The disposable operator script can still classify an explicit manifest and refuses database salon and host port 5432. Persistent classification is a separate command that requires confirmation `PERSISTENT_SALON`, database name salon, the declared host port, and the connected server system identifier. The migration does not classify rows. Derived **admin VIP outreach workspace** (not a folder table): `GET /admin/vip/outreach/salons` (cursor `latestActivityAt DESC, salonId DESC`, optional `q` salon-name contains) and `GET /admin/vip/outreach/salons/:salonId` / `GET /admin/vip/outreach/requests/:id`. Folder identity is `salonId`. Counts are SQL aggregates from `VipRequest` / `VipRequestRecipient` / `MessageRequest` / `MessageDelivery`. Canonical SENT is delivery `SENT` + `submittedAt`. Salon JWT is 403. `VipTargetContact.displayName` is optional; unnamed targets persist `null` and render as «بدون نام» in admin. Phone `^09[0-9]{9}$` remains required.

Salon: `GET /vip/capability`, `GET /vip/regions` (14 canonical Tehran regions; counts are ACTIVE, unreserved, `ORIGINAL_TEHRAN` lists with a canonical region only), `GET /vip/lists?regionCode=01` (that region’s requestable lists only; pending, inactive, reserved, and historical unclassified/`regionCode` null lists excluded), `GET /vip/requests` (paginated full request history with live metrics; before `:id`), `POST /vip/requests` (the same requestable-list predicate inside the reservation update), get, upload sample, submit, download own sample. Flutter VIP request flow is region-first. `VipRequest.geographicRange` remains message-template copy and may be prefilled from the selected region name.

Quota is `VIP_QUOTA_MAX` (500) recipients per salon over a rolling `VIP_QUOTA_WINDOW_DAYS` (7) × 24 hours, measured from one evaluation instant (`created_at >= now - 7 days`). It is not a calendar week. Each new request is exactly 30, 50, or 100 recipients. Every committed non-`CANCELLED` request in the window counts, including `SUBMITTED`, `MANUAL_QUEUED`, and `BALE_NOT_IMPLEMENTED`, even if a recipient later fails or is cancelled. Expired `AWAITING_SAMPLE_WORK` drafts become `CANCELLED` and stop counting. Idempotent replay does not create a second request. Concurrent creates lock the salon entitlement row and reject `used + requestedCount > 500`. A salon may have many submitted or processing requests. At most one `AWAITING_SAMPLE_WORK` draft may exist per salon; that rule is a partial unique index plus the same locked transaction. `activeDraft` is that draft. `inProgressRequests` is an API response summary of the 10 most recent submitted or processing requests (`createdAt DESC, id DESC`). That bound lives in the capability use case and is not a shared domain constant. `inProgressRequestsHasMore` is true when older rows exist. It does not hide the region form and does not include recipients or message history. The separate read-only `GET /vip/requests` route provides paginated full history, including after entitlement revocation. `currentRequest` is the same value as `activeDraft`. The one-draft rule is the partial unique index `vip_requests_one_awaiting_draft_per_salon`. Prisma cannot model that index; it lives only in migration `20261007140000` and must not be dropped as schema drift. Applying it fails if a salon already has two `AWAITING_SAMPLE_WORK` rows. Read-only preflight: `SELECT salon_id FROM vip_requests WHERE status = 'AWAITING_SAMPLE_WORK' GROUP BY salon_id HAVING count(*) > 1`. A submitted request keeps its reserved list and recipient snapshots; the list is not returned to `ACTIVE` for reuse. Draft expiry still cancels an abandoned draft and restores its list. There is no successful terminal VIP-request status; completing that lifecycle is a separate follow-up. Phone signup completion creates one restricted salon and OWNER when enabled; it does not grant `VipSalonEntitlement`. Email registration is closed. VIP access remains a platform-admin grant or revoke, with no payment check.

Sample uploads now persist intent and reserve capacity before object PUT, use generation/token ownership, and become committed metadata only after read-back digest/type/length verification. The worker releases expired upload positions and deletes only generation-specific objects proven to belong to abandoned uncommitted attempts. Submit and download re-verify bytes. `verifiedAt` is point-in-time evidence; historical rows remain null until an actual read succeeds, and no state promises future storage availability.
The API fixes a storage-enforced, generation-key PUT expiry before committing each upload intent. A paused obsolete attempt cannot refresh that authorization after terminal cleanup; disposable MinIO rejected the stale PUT. The separate lifetime of PUTs accepted before expiry and target-path expiry semantics still require deployment validation; see `architecture/operations.md`.
Legacy upload-key replay can resolve a pre-Phase-10 idempotency record that points directly to a tenant-owned committed sample without creating an upload intent; it verifies the stored bytes before success. Current uploads retain their intent lifecycle. Submission checks `reservedUntil` using a fresh time under the final request lock after object reads; a reservation that expires during verification does not submit.

Statuses and quota: `docs/messaging-domain.md`. Rolling 7-day quota of 500 is a **temporary** product limit; request sizes remain 30/50/100. VIP Bale **not** implemented.

Salon capability and admin outreach attach a read-only `progress` object from the same recipient facts. `deriveVipRequestProgress` takes an audience, `SALON` or `PLATFORM_ADMIN`, and changes only the sentences. `vip` still owns request status, reservation, requested count, recipients, quota, and dispatch commands. `messaging` still owns MessageRequest and MessageDelivery. The global-stop policy still owns the active stop and durable `MessageGlobalStopOutcome` rows. Progress does not write those facts, does not add a status, and does not infer delivery. Flutter shows the server headline, explanation, next-actor sentence, count labels, and the request’s list name plus requested count. It does not derive a business status from list names, phone numbers, or local counters.

The stored request status and the recipient execution buckets stay separate. `AWAITING_SAMPLE_WORK` with a still-valid reservation is the salon headline «در انتظار ارسال نمونه‌کارهای شما» and the admin headline «پیش‌نویس باز است»; no message exists yet. The same status after `reservedUntil`, before lazy cancellation, is the salon headline «دوباره تلاش کنید» and the admin headline «مهلت رزرو این پیش‌نویس گذشته است». That 30-minute clock is the draft reservation, not a delivery deadline. `GET /vip/capability` still runs expiry inside its transaction before reading progress; it is not a read-only GET. `SUBMITTED`, `MANUAL_QUEUED`, and `BALE_NOT_IMPLEMENTED` stay three stored statuses. The salon headline «درخواست شما ثبت شد، به محض تأیید ادمین ارسال می‌شود» is used only while no recipient has a recorded outcome. With work still open and any manual mark, failure, cancellation, durable skip, or other recorded send, the salon headline is «درخواست شما در حال رسیدگی است؛ وضعیت هر گیرنده را پایین ببینید». When recipient work is closed and no send is recorded, it is «رسیدگی پایان یافت؛ ارسالی برای این درخواست ثبت نشد». When work is closed and at least one send is recorded, it is «رسیدگی به این درخواست پایان یافت؛ نتیجهٔ هر گیرنده را پایین ببینید». Those sentences are presentation. They are not a send, a delivery, or a new status. Admin keeps separate headlines: «ثبت شده؛ منتظر شروع رسیدگی», «رسیدگی دستی شروع شده» while recipient work is open, «رسیدگی پیام‌ها تمام شده» when the manual buckets are closed and at least one canonical sent row exists, «کار باز نمانده؛ ارسالی ثبت نشده است» when those buckets are closed and no sent row exists, and «ارسال با بله در دسترس نیست». A manual sent mark is a delivery row with mode `MANUAL`, status `SENT`, and `submittedAt`. It is not proof of provider delivery or of a visit. Failed, cancelled, durably skipped, and manually marked recipients stay in the count lines. `CANCELLED` with `cancelledAt` and no `submittedAt` is a closed expired draft: salon «اتمام مهلت ارسال درخواست», admin «پیش‌نویس به‌خاطر پایان مهلت رزرو بسته شد». Any other `CANCELLED` row is «درخواست لغو شده است» and is not described as expiry or as a failed send. `IN_USE` on a list means the list is reserved for a request, not that messages are sending.

Recipient counts are one exclusive bucket per recipient row: canonical sent, then durable stop, then not yet queued, cancelled, failed, in pipeline, otherwise queued. An active platform stop is a separate note and is not added into the total. Lifting that stop does not reopen a durable skip. Salon copy says that recipient will not get a message for this request even if the stop is lifted. If the buckets do not add up to the recipient rows, the count lines are omitted. A sent row that is not manual is named separately and is not called delivered. The latest action is the newest of a manual sent `submittedAt`, a cancelled request’s `cancelledAt`, `submittedAt`, and `createdAt`. `updatedAt` is not used as a dispatch time. Capability adds at most one `latestCancelledRequest`, the newest cancelled row, not a history page. The salon shows that card even when `inProgressRequests` is empty, next to its list name. Salon progress is tenant-scoped and does not include target-list phone or name, recipient identity, message body, or admin-only recipient detail. Older admin folder and Today labels for canonical `SENT` plus `submittedAt` say the send was recorded. They do not say the message was delivered. A VIP recipient row with delivery mode `MANUAL` is labeled as a manual mark. The Opportunities list keeps `messageState` unchanged and, only for a VIP row whose delivery mode is `MANUAL` and whose state is `SENT`, shows «VIP · ارسال دستی ثبت شده». A non-manual mode stays «ارسال شده».

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
| MinIO | **Implemented** VIP sample works and private activation receipts |
| Redis | env required, **unused** |
| RLS | **Not** present |
| Billing | **Out of scope** |

---

## 14. Flutter

Persian-first, RTL, `fa_IR`, Vazirmatn, **dark** charcoal/champagne theme (`AppTheme.app()`). Jalali used where the visits UX needs a local calendar day.

| Screen | Status |
| --- | --- |
| Shared phone/password login, phone OTP signup, and splash | Implemented; email-login routes are closed. Signup write paths are disabled by default |
| Agreement and manual-transfer onboarding | Implemented: four declared Article 1 fields, server-rendered preview and explicit acceptance; card instructions, receipt upload, review/waiting/rejection states. All three signup, agreement, and transfer write-path flags are disabled by default |
| Platform-admin receipt review | Implemented under «فیش واریز»: phase-filtered receipt history with cursor pagination, authenticated image read, explicit bank-check attestation before approval, and rejection with a reason. Approved and rejected receipts stay read-only as history. Approval alone changes salon access to `PRODUCT` |
| Admin message queue | Implemented as **ارسال پیام عادی** salon folders + detail; queue removal and manual-sent capabilities are server-owned |
| Admin VIP lists/detail | Implemented as a pure inventory (`/admin/vip`). Default page is every list (unfiltered `GET /admin/vip/lists`). Salon entitlement search is not on this screen. Import still leaves membership null. Cards show name, region when known, contact count, status, `requestableBySalons`, and request totals vs open requests. Detail can activate/deactivate via existing list-availability PATCH; `IN_USE` stays blocked. |
| Admin VIP salon access | Implemented as **فعال‌سازی سالن** (`/admin/vip/salons` + `/admin/vip/salons/:salonId`). Lists **all** salons via `GET /admin/vip/salons` (search + cursor). Profile uses `GET /admin/vip/salons/:salonId/profile`. Grant/revoke reuse existing entitlement endpoints with confirmation. Receipt approval does not grant VIP. |
| Admin VIP outreach folders | Implemented as **ارسال پیام VIP** (`/admin/vip/outreach`) with top actions to inventory and salon access |
| Today dashboard | Implemented (overall performance, پیگیری‌ها with مشتریان قبلی / مراجعه‌های VIP, and STAFF operational open-returns entry; no weekly recovery-outcomes screen) |
| Customers list/detail/create/edit/import | Implemented |
| Customer activity on profile | Implemented |
| Record visit / sale | Implemented |
| Manual outreach multi-select + composer | Implemented (upcoming ReturnCommitment context on composer) |
| Customer message history + agreed returns + arrival | Implemented (Customer Detail; not a booking surface) |
| Opportunities three-section page | Implemented: monetary `GET /intelligence/revenue-drops`, VIP history `GET /vip/requests`, ordinary history `GET /messages/history`. Flutter composition; legacy workspace API retained |
| Salon VIP section (from opportunities) | Implemented. Create flow opens from the VIP section when entitled. History uses the same progress facts with intention/visit counts per request |
| Visits list/export/delete | Implemented |
| Profile + OWNER services | Implemented |
| Salon support conversation | Implemented («ارتباط با پشتیبانی» on حساب من for every salon role) |
| Admin user support | Implemented («ارتباط با کاربران»; not the message or VIP queues) |
| User admin / void / segments / salon PATCH | **Absent** (API exists) |

Android emulator API default `http://10.0.2.2:3000`. Physical device: LAN IP via `--dart-define=API_BASE_URL`. Production: HTTPS.

---

## 15. Tests (presence)

API E2E includes phone identity/signup/owner-account, agreement acceptance, activation receipts, auth, salon-user, customer, import, visits/sales, finance, intelligence, action, messaging, return outcomes, VIP, support, observability, and reliability. This is an inventory of test files, not evidence of a live rollout.

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
