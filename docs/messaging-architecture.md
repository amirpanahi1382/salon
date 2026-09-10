# Messaging architecture

```text
Salon user (JWT tenant)
  → POST .../messages
  → MessageRequest QUEUED + Outbox MessageRequested + audit MESSAGE_REQUESTED
  → 201 { status: QUEUED }

Platform admin (JWT scp=platform)
  → select-bale | select-manual
  → MessageDelivery PENDING + request DISPATCHED + audit MESSAGE_DELIVERY_MODE_SELECTED
  → BALE + credentials: Outbox MessageDeliveryActivated
  → Worker (SKIP LOCKED / lease / retry / same providerRequestId) → BaleSafirMessageSender
  → SENT | FAILED

  → MANUAL: human sends outside the app → mark-manual-sent CAS PENDING→SENT
```

## Safety preserved

Tenant isolation, JWT tenant authority, actor identity, idempotency, SHA256 fingerprint, transactional outbox, FOR UPDATE SKIP LOCKED (outbox claim), leases, jittered retry, bounded attempts, provider request ID reuse, abortable HTTP timeout, CAS state transitions, atomic dead-letter reconciliation, Pino redaction, audit without message bodies, cursor pagination, existing Safir error mapping.

## Indexes

- Partial unique `(salon_id, customer_id, message_business_date) WHERE counts_toward_daily_limit` for the daily rule. Historical backfill rows are `counts_toward_daily_limit = false` and are not in that set.
- Admin queue: `(status, requested_at, id)`, `(salon_id, requested_at, id)`.
- Delivery: unique `message_request_id`, `(mode, status, created_at)`, existing salon+status indexes.

## Worker

The worker executes **BALE** deliveries only. MANUAL rows are ignored. Legacy `MessageSendRequested` events remain consumable after migration. `MessageRequested` / `MessageSent` / `MessageFailed` are facts; unknown handling stays no-op for known types other than Bale activation.

## Credentials

`BALE_SAFIR_API_ACCESS_KEY` and `BALE_SAFIR_BOT_ID` stay platform env. Never stored in DB, Flutter, audit, or logs.

Platform admin bootstrap (optional): `PLATFORM_ADMIN_EMAIL` + `PLATFORM_ADMIN_PASSWORD` (both or neither). Password is argon2id hashed into `platform_admins`.
