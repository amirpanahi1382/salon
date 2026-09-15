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
  → select-bale | select-manual  (same endpoints for opportunity and manual; VIP select-bale rejected)
  → MessageDelivery PENDING (actionId copied from the request; null for manual/VIP)
    + request DISPATCHED + audit MESSAGE_DELIVERY_MODE_SELECTED
  → BALE + credentials: Outbox MessageDeliveryActivated
  → Worker (SKIP LOCKED / lease / retry / same providerRequestId) → BaleSafirMessageSender
  → SENT | FAILED

  → MANUAL: human sends outside the app → mark-manual-sent CAS PENDING→SENT

VIP (salon JWT entitled):
  → POST /vip/requests … sample works (MinIO) … submit
  → Admin POST /admin/vip/requests/:id/dispatch-manual
       MessageRequest per recipient (vipRequestId set, countsTowardDailyLimit false)
  → Same admin queue; MANUAL only
```

MessageRequest is created before admin dispatch. MessageDelivery is created only when an admin selects a mode (VIP manual dispatch creates requests then follows MANUAL). There is one queue; origins differ by Opportunity context and VIP vs customer recipient (CHECKs in `architecture/data-model.md`).

Modules: `apps/api/src/messaging`, `apps/api/src/vip`, `apps/worker/src/messaging`. Domain modules do not import Safir DTOs.

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
