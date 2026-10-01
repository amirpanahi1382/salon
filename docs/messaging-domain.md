# Messaging domain

**Status:** Implemented semantics  
**Execution:** `docs/messaging-architecture.md`  
**Provider contract:** `architecture/messaging-bale-safir.md`

Customer messaging is a **human-initiated, one-to-one** operational action. It is not a campaign engine, chatbot, bulk aggregate, or automatic outreach. It is not booking, appointment scheduling, or a discount entity. Composer placeholders such as “فردا ساعت n” are message **content only**.

## Concepts

**MessageRequest** is the durable salon intent: which recipient, which immutable text, requested when, by which salon user, and optionally which Opportunity context. It is tenant-scoped. It does not depend on Bale. It is created **before** admin dispatch. There is one queue for all salon-originated requests (including VIP).

`MessageRequest.recipientPhoneNumber` is the immutable intended execution destination. Customer-origin requests copy the current canonical `Customer.phoneNumber` while creating the intent; VIP dispatch copies `VipRequestRecipient.phoneNumber`. A later Customer edit changes future intents only. `Customer.phoneNumber` remains current CRM contact detail, the VIP recipient remains the campaign snapshot, and MessageDelivery records the outcome against the MessageRequest destination. Idempotent replay returns the original request and destination. No phone is copied to audit or outbox payloads.

Historical customer-origin requests made before destination capture have a null destination: current Customer.phone can only suggest a value, not prove what was intended then. Reads show an empty execution destination for these rows, and admin dispatch/manual completion is rejected. A legacy Bale delivery with a missing or malformed snapshot fails as `DESTINATION_UNVERIFIED` without a provider call. Historical VIP requests already carry the recipient snapshot. The migration's defensive linked-recipient VIP backfill has no reachable row under the predecessor CHECK, which already required a VIP destination; it never reads mutable inventory. A new request always requires a canonical `09` plus nine digits, and the database rejects destination edits after insert.

MessageRequest may optionally carry Opportunity context. When present, `actionId` and `opportunityType` are **both** populated. When absent, **both** are NULL and the request is **manual outreach** (or VIP, which uses `vipRequestId` instead of a customer). Manual outreach is a first-class path, not an error, not a degraded Opportunity, and not a fake OpportunityAction.

| Mode | `actionId` / `opportunityType` | `customerId` | `vipRequestId` |
| --- | --- | --- | --- |
| Opportunity message | both set | set | null |
| Manual outreach | both null | set | null |
| VIP outreach | both null | null | set + recipient snapshot |

Mixed opportunity context (only one of the two set) is invalid (`message_requests_opportunity_context_consistent`: `(action_id IS NULL) = (opportunity_type IS NULL)`). Recipient origin is XOR (customer vs VIP snapshot).

**MessageDelivery** is fulfillment: `BALE` (Bale Safir adapter) or `MANUAL` (human operator). It is created when a platform admin selects a delivery mode. Salon users cannot choose the mode.

**Platform admin** is not OWNER/MANAGER/STAFF. Admins live in `platform_admins` and authenticate with JWT claim `scp=platform` (no tenant id). Local development: `pnpm db:bootstrap-admin`.

## Two salon-customer origins, one pipeline

Opportunity and manual outreach share MessageRequest, the Tehran-day limit, idempotency, transactional outbox, the admin queue, MessageDelivery, and the worker/provider infrastructure. They differ only in business origin/context.

```text
Opportunity path:
Customer → intelligence Opportunity → OpportunityAction → MessageRequest → admin queue → Manual / Bale → MessageDelivery → worker / provider

Manual outreach path:
Customer → MessageRequest (no Opportunity, no OpportunityAction) → admin queue → Manual / Bale → MessageDelivery → worker / provider
```

APIs (STAFF+, JWT tenant; required `Idempotency-Key`; body `{ text }`):

- Opportunity: `POST /intelligence/opportunities/:opportunityType/customers/:customerId/messages`
- Manual: `POST /customers/:customerId/messages`

Manual multi-customer selection is Flutter session state (max 30 in the UI) until a MessageRequest exists. After submit, the durable request is the source of truth. `GET /messages/manual-outreach` lists this salon’s Tehran-day manual requests (both NULL opportunity context) in one tenant-scoped page. Flutter may keep unsent session selections and merge them with that list. Submitted items stay visible, are not editable, and show the current `MessageRequest.status`. There is no campaign and no bulk message aggregate.

## Business rules

- Queueing succeeds even when Bale credentials are missing or the provider is down.
- At most one **new** salon MessageRequest per salon + customer + **Asia/Tehran** calendar day (`countsTowardDailyLimit = true`). Historical 1:1 backfill from pre-queue `message_deliveries` is stored with `countsTowardDailyLimit = false` and may share a Tehran day. Stored timestamps remain UTC `timestamptz`.
- Opportunity and manual outreach **share** that daily allowance. An opportunity message and a manual outreach message cannot both consume the same customer’s day. VIP does not count toward it (`countsTowardDailyLimit = false`).
- Idempotency (`Idempotency-Key` + SHA256 payload hash) is separate from the daily limit. Opportunity send uses `OPPORTUNITY_MESSAGE_SEND`; manual uses `MANUAL_OUTREACH_MESSAGE_SEND`.
- Message text is persisted as requested. It is never regenerated from a later template. Stored text is immutable after create.
- Sending a message does not complete an OpportunityAction, create a Visit, or create a Transaction.
- Customer delete is refused while message history exists (same family of protection as financial history).
- Retention: requests and deliveries are kept as operational history. They are not swept by the outbox/idempotency retention job. Recommended review: 24 months, then archive; do not silent-delete to hide history. **Archive job is not implemented.**
- Consent / opt-out is **not implemented**.

## Salon-visible statuses

Existing send/get-one/list-by-customer message DTOs still collapse admin dispatch for backward compatibility:

| Request status | `POST` / `GET /messages/:id` / `GET /customers/:id/messages` | UI (composer confirmation) |
| --- | --- | --- |
| QUEUED, DISPATCHED | QUEUED | پیام در صف ارسال قرار گرفت |
| SENT | SENT | پیام با موفقیت ارسال شد |
| FAILED | FAILED | existing failure copy |
| CANCELLED | CANCELLED | لغو شده |

Manual outreach inbox and customer activity expose the durable `MessageRequest.status` directly (no second status model):

| Request status | `GET /messages/manual-outreach` and activity `MANUAL_MESSAGE` | Salon UI |
| --- | --- | --- |
| QUEUED | QUEUED | در صف ارسال |
| DISPATCHED | DISPATCHED | ارسال به اجرا |
| SENT | SENT | ارسال شد |
| FAILED | FAILED | ارسال ناموفق |
| CANCELLED | CANCELLED | لغو شده |

`ارسال شد` is not shown merely because the salon user queued a request. Customer activity is a read projection of visits, transactions, opportunity actions, and manual MessageRequests (one row per request, current status). It does not include outbox, worker, or audit internals, and it does not return message bodies.

`GET /customers/:customerId/activity` is STAFF+, JWT tenant, 404 if the customer is not in the salon, cursor `{ occurredAt, createdAt, type, id }` descending, page 200. Opportunity activity omits `DISMISSED` Actions (suppression, not completed work).

Daily limit: HTTP 409 `MESSAGE_DAILY_LIMIT_REACHED`.

## VIP outreach

VIP is a separate product capability. It does **not** create salon `Customer` rows and does not use a second queue.

**VipTargetList** is a platform-admin owned list of phone contacts (optional display name; max 100 per import; more than 100 data rows rejects the whole file). Excel must include `شماره تلفن`; `نام` is optional. Empty or absent names persist as null — they are not invented. Optional `regionCode` (`01`–`14`) is canonical Tehran inventory identity; historical test lists stay null and are excluded from `GET /vip/regions` and `GET /vip/lists?regionCode=`. Status: `PENDING` (imported) → `ACTIVE` / `INACTIVE`. A salon confirms a request with an atomic `UPDATE … WHERE status = ACTIVE`, which sets `IN_USE`. Opening a Flutter screen does not reserve. Abandoned `AWAITING_SAMPLE_WORK` reservations expire after 30 minutes and the list returns to `ACTIVE`.

**VipSalonEntitlement** is a **product entitlement placeholder**, not a billing or subscription system. Platform admin grants or revokes VIP access per salon. It does not verify payment, create invoices, or pretend a purchase occurred. Flutter cannot forge it. Server checks the entitlement row (`FOR UPDATE` on mutating VIP salon operations). Non-entitled salons receive 403 on VIP mutations/lists and `entitled: false` on `GET /vip/capability`. Audit: `VIP_ENTITLEMENT_GRANTED` / `VIP_ENTITLEMENT_REVOKED`.

**VipRequest** is the salon request: selected list, requested count (30/50/100), geographic range text (template parameter only, not geospatial), quota, sample-work metadata. Recipients are snapshotted at create time (`VipRequestRecipient`) including the generated Persian template. Later list/name edits do not change history.

Quota: per salon, **temporary** rolling **7 days**, max **500** target contacts (`VIP_QUOTA_MAX` / `VIP_QUOTA_WINDOW_DAYS` in `@salon/shared`). Counted from non-`CANCELLED` requests. Enforced by locking the entitlement row then summing in the same transaction. Allowed request sizes remain 30/50/100. This is a rolling window, not a calendar week.

Sample work: 1–3 images, magic-byte validated, stored in MinIO/S3-compatible object storage. A pending upload durably reserves one of the three positions before PUT. The database intent records digest, media type, size, generation, key, owner token, and lease; no database transaction remains open during storage I/O. The API reads the object back and verifies digest/type/size before it creates committed metadata. An expired attempt releases its position; the client resends the bytes to resume it. The durable per-request SHA uniqueness preserves the duplicate-content contract while the request/history exists. Replay by `Idempotency-Key` is guaranteed only for `IDEMPOTENCY_RETENTION_DAYS` (default 7), not indefinitely.

Abandoned-generation cleanup records a durable settlement horizon. The worker performs an early idempotent DELETE and a required final DELETE after that horizon, so a late PUT is reconciled even if its API process exited. Deployment must configure the horizon above the object store and proxy's maximum accepted PUT lifetime; a client timeout alone is not that bound.

`AVAILABLE` and `verifiedAt` prove that the recorded bytes were readable and matched metadata at that instant. They do not prove continuing MinIO reachability or prevent later external deletion. Submit reads and verifies every committed sample outside the database transaction, then locks the request and confirms the sample set is unchanged before the status compare-and-set. PostgreSQL cannot atomically cover MinIO: an object can disappear after that read and before/after commit. Authenticated download verifies again and refreshes `verifiedAt`; mismatch/unavailability fails without returning bytes. Historical rows migrate with `verifiedAt = NULL` and are not thereby verified.

**Manual dispatch** creates existing `MessageRequest` rows (`customerId` null, `vipRequestId` set, `countsTowardDailyLimit` false) that appear in ارسال پیام VIP (not mixed into ordinary salon folders). Those VIP rows are **manual-only** until VIP Bale is explicitly implemented: `select-bale` / Bale retry on `vipRequestId IS NOT NULL` is rejected and does not create a delivery or call Safir. Campaign-level **Bale for VIP** records `BALE_NOT_IMPLEMENTED` and does not call Safir or create deliveries.

Platform admin messaging has two destinations: **ارسال پیام عادی** (`GET /admin/messages/normal/salons`) and **ارسال پیام VIP** (`GET /admin/vip/outreach/salons`). Both are derived salonId folders. Ordinary folders exclude `vipRequestId`. VIP folders group `VipRequest` by salon. Request display titles are derived (`vipOutreachRequestDisplayTitle`); identity remains `VipRequest.id`. Sent counts use canonical delivery `SENT` + `submittedAt`. Total requested is historical (includes cancelled). `POST /admin/message-queue/:id/cancel` is durable `MessageRequest.status = CANCELLED` for `QUEUED` (no delivery) or manual `PENDING` only — not a hard delete, not allowed for SENT or Bale in-flight. Worker claim excludes `CANCELLED`. Per-recipient «ارسال دستی شد» reuses `mark-manual-sent` (orchestrates select-manual when still `QUEUED`). Capabilities `canCancel` / `canMarkManualSent` are server-owned.

VipRequest dispatch transitions are serialized on the request row: `SUBMITTED → BALE_NOT_IMPLEMENTED`, `SUBMITTED → MANUAL_QUEUED`, or deliberate fallback `BALE_NOT_IMPLEMENTED → MANUAL_QUEUED`. Repeating the Bale placeholder after `BALE_NOT_IMPLEMENTED` is a no-op; Bale can never overwrite `MANUAL_QUEUED`. Manual recipient messages, recipient links, audit, and outbox rows commit in the same transaction as the manual transition. `AWAITING_SAMPLE_WORK` may become `SUBMITTED` or `CANCELLED` under the existing reservation workflow.
