# Messaging architecture

**Domain:** `docs/messaging-domain.md`  
**Safir HTTP contract:** `architecture/messaging-bale-safir.md`

```text
Salon user (JWT tenant; OWNER / MANAGER / STAFF)
  → POST /intelligence/opportunities/:type/customers/:id/messages
       MessageRequest with actionId + opportunityType both set (OpportunityAction created or reused)
     or POST /customers/:id/messages
       MessageRequest with actionId + opportunityType both null (no OpportunityAction)
  → MessageRequest QUEUED + Outbox MessageRequested + audit MESSAGE_REQUESTED
  → 201 { status: QUEUED }

Salon read projections (same MessageRequest / MessageDelivery facts; no new queue):
  → GET /messages/manual-outreach  (Tehran-day manual requests; request status including DISPATCHED)
  → GET /customers/:id/activity    (business activity feed; one MANUAL_MESSAGE row per request)

Platform admin (JWT scp=platform)
  → GET /admin/messages/normal/salons | /salons/:salonId  (ordinary customer folders; not VIP)
  → GET /admin/vip/outreach/salons | /salons/:salonId | /requests/:id
  → select-bale | select-manual  (same endpoints for opportunity and manual; VIP select-bale rejected)
  → mark-manual-sent (QUEUED may create MANUAL SENT in one transaction; already SENT replays)
  → cancel (QUEUED or MANUAL PENDING → MessageRequest CANCELLED; worker does not claim CANCELLED)
  → retry (Bale PENDING/FAILED)
  → MessageDelivery PENDING (actionId copied from the request; null for manual/VIP)
    + request DISPATCHED + audit MESSAGE_DELIVERY_MODE_SELECTED
  → BALE + credentials: Outbox MessageDeliveryActivated
  → Worker (SKIP LOCKED / fenced claim generation / retry / same providerRequestId) → BaleSafirMessageSender
  → SENT | FAILED

  → MANUAL: human sends outside the app → mark-manual-sent CAS PENDING→SENT

VIP (salon JWT entitled):
  → POST /vip/requests … sample works (MinIO) … submit
  → Admin POST /admin/vip/requests/:id/dispatch-manual
       MessageRequest per recipient (vipRequestId set, countsTowardDailyLimit false)
  → Same admin queue; MANUAL only
```

MessageRequest is created before admin dispatch. MessageDelivery is created only when an admin selects a mode (VIP manual dispatch creates requests then follows MANUAL). There is one queue; origins differ by Opportunity context and VIP vs customer recipient (CHECKs in `architecture/data-model.md`).

The existing `message_requests.recipient_phone_number` is the sole execution destination. Customer message creation locks the Customer row for shared reading inside the intent transaction, validates its phone, and inserts that value. A concurrent phone update takes the row update lock: whichever transaction obtains its lock first determines the committed phone captured by the intent. VIP dispatch copies the immutable request-recipient snapshot. Worker execution reads only MessageRequest destination and retains Phase 2 `providerRequestId`; admin manual detail shows the same destination. The salon response remains a masked hint. No phone enters audit, outbox payloads, or worker logs.

Historical ordinary destinations with no original snapshot remain null. The Phase 3 migration changes the recipient-origin CHECK and adds an insert/update guard: every new destination must be canonical, and any later edit is rejected. No Customer-phone backfill is performed. Its linked-recipient VIP UPDATE is defensive: the actual predecessor recipient-origin CHECK already required a non-null VIP destination, so supported predecessor rows cannot need that backfill. The constraint replacement scans `message_requests` and takes an ALTER TABLE lock; the defensive UPDATE would lock any matching rows. There is no new index or table rewrite.

Rollout requires a coordinated cutover: stop old API writers, drain old workers and account for in-flight provider calls, apply the migration while allowing for the CHECK scan/lock, then start the compatible API and worker. Mixed old writers cannot create requests after the guard. An old worker must never be rolled back into service because it can address a send from mutable `Customer.phone_number`. Existing undelivered ordinary rows without a verifiable snapshot cannot be auto-sent or manually confirmed; they require a new intent or an explicit future reconciliation policy. `SENT` remains provider acceptance or human confirmation, not proof of reading or caused return.

The disposable PostgreSQL upgrade test applies the predecessor migrations, seeds ordinary unknown and VIP known history, then applies Phase 3 and checks preservation and safe rejection. It does not establish production row counts or remove the need to assess migration lock duration on production-sized data before rollout.

Modules: `apps/api/src/messaging`, `apps/api/src/vip`, `apps/worker/src/messaging`. Domain modules do not import Safir DTOs.

Outbox claims increment `claim_generation`; processed, retry, and dead-letter writes require the generation returned to that worker. Claimed batches run concurrently up to configured batch size, avoiding sequential lease ageing. Bale deliveries have a logical `execution_generation` (incremented by an admin retry) and a short execution token/lease. A reclaimed outbox event may take over only an expired delivery execution; terminal writes lock and verify the live outbox claim as well as the delivery token. Provider calls remain outside transactions and reuse the delivery's stable `providerRequestId`. If Safir accepted a call but the response or subsequent database write was lost, delivery is retried under that same provider request ID; provider-side deduplication remains necessary for that ambiguous window.

Worker terminal transitions lock `OutboxEvent → MessageRequest → MessageDelivery`; dead-letter reconciliation uses that same order. Admin retry and manual fulfilment lock `MessageRequest → MessageDelivery`, then insert any new outbox event. VIP dispatch locks `VipRequest` before recipient/message/outbox/audit writes. No transaction spans provider HTTP. VIP dispatch allows `SUBMITTED → BALE_NOT_IMPLEMENTED → MANUAL_QUEUED`; Bale placeholder only claims `SUBMITTED`, while manual dispatch claims `SUBMITTED` or `BALE_NOT_IMPLEMENTED` atomically with recipient effects.

The processor acknowledges only an explicit handler outcome: owned completion, authoritative terminal failure, or an obsolete activation (manual/cancelled request or superseded logical generation). Lost ownership returns `stale`; it writes no acknowledgement or terminal evidence and leaves the claim for lease reclamation. Retryable provider errors retain the existing retry/dead-letter path. Concurrent handlers are bounded by `OUTBOX_BATCH_SIZE` per worker. The next poll and shutdown wait for all started handlers, even when a sibling rejects. On timeout the worker aborts and drains the handler before settling the batch; a provider that ignores cancellation stalls that worker rather than allowing overlapping batches. Other workers can reclaim expired leases. This bounds local concurrency without increasing lease duration; provider request ID reuse remains required across reclaim.

Migration defaults preserve historical rows as generation zero with null execution ownership and null activation dedupe keys; they do not invent active owners. Drain old workers before deploying the new ownership protocol: old binaries do not enforce fencing. The unique activation-key index and partial processing-lease index add write/index-build cost; migration locks, constraint scans and query plans require isolated PostgreSQL validation before rollout.

## Safety preserved

Tenant isolation, JWT tenant authority, actor identity, idempotency, SHA256 fingerprint, transactional outbox, FOR UPDATE SKIP LOCKED (outbox claim), leases, jittered retry, bounded attempts, provider request ID reuse, abortable HTTP timeout, CAS state transitions, atomic dead-letter reconciliation, Pino redaction, audit without message bodies, cursor pagination, existing Safir error mapping.

## Indexes

- Partial unique `(salon_id, customer_id, message_business_date) WHERE counts_toward_daily_limit` for the daily rule. Opportunity and manual outreach share this set. Historical backfill and VIP rows are `counts_toward_daily_limit = false`.
- CHECK `message_requests_opportunity_context_consistent`: `(action_id IS NULL) = (opportunity_type IS NULL)`.
- Recipient XOR CHECK + partial unique one MessageRequest per VIP recipient phone.
- Admin queue: `(status, requested_at, id)`, `(salon_id, requested_at, id)`.
- Delivery: unique `message_request_id`, `(mode, status, created_at)`, existing salon+status indexes.

## Worker

The worker executes **BALE** deliveries only. MANUAL rows are ignored. Legacy `MessageSendRequested` events remain consumable after migration. `MessageRequested` / `MessageSent` / `MessageFailed` are facts; unknown handling stays no-op for known types other than Bale activation.

`SENT` means the provider **accepted** the send request, not delivered or read. No webhooks.

## Credentials

`BALE_SAFIR_API_ACCESS_KEY` and `BALE_SAFIR_BOT_ID` stay platform env. Never stored in DB, Flutter, audit, or logs.

Platform admin bootstrap (optional, development only): `PLATFORM_ADMIN_EMAIL` + `PLATFORM_ADMIN_PASSWORD` (both or neither). Password is argon2id hashed into `platform_admins`. API startup never bootstraps when `NODE_ENV=production`. Local command: `pnpm db:bootstrap-admin` (prints the email, never the password).
