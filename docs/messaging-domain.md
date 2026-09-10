# Messaging domain

Customer messaging is a **human-initiated, one-to-one** operational action. It is not a campaign engine, chatbot, or automatic outreach.

## Concepts

**MessageRequest** is salon intent: which customer, which immutable text, which opportunity context, requested when, by which salon user. It is tenant-scoped. It does not depend on Bale.

**MessageDelivery** is fulfillment: `BALE` (Bale Safir adapter) or `MANUAL` (human operator). Platform admin chooses the mode. Salon users cannot.

**Platform admin** is not OWNER/MANAGER/STAFF. Admins live in `platform_admins` and authenticate with JWT claim `scp=platform` (no tenant id). Local development: `pnpm db:bootstrap-admin`.

## Business rules

- Queueing succeeds even when Bale credentials are missing or the provider is down.
- At most one **new** salon MessageRequest per salon + customer + **Asia/Tehran** calendar day (`countsTowardDailyLimit = true`). Historical 1:1 backfill from pre-queue `message_deliveries` is stored with `countsTowardDailyLimit = false` and may share a Tehran day. Stored timestamps remain UTC `timestamptz`.
- Idempotency (`Idempotency-Key` + SHA256 payload hash) is separate from the daily limit.
- Message text is persisted as requested. It is never regenerated from a later template.
- Sending a message does not complete an OpportunityAction, create a Visit, or create a Transaction.
- Customer delete is refused while message history exists (same family of protection as financial history).
- Retention: requests and deliveries are kept as operational history. They are not swept by the outbox/idempotency retention job. Recommended review: 24 months, then archive; do not silent-delete to hide history.

## Salon-visible statuses

| Request status | Salon API `status` | UI |
| --- | --- | --- |
| QUEUED, DISPATCHED | QUEUED | پیام در صف ارسال قرار گرفت |
| SENT | SENT | پیام با موفقیت ارسال شد |
| FAILED | FAILED | existing failure copy |

Daily limit: HTTP 409 `MESSAGE_DAILY_LIMIT_REACHED`.
