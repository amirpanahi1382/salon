# Bale Safir messaging (current state)

**Product problem:** a salon user looking at a revenue-decline (or other existing) opportunity can manually send one text message to that customer through Bale Safir, then see whether our system successfully submitted it.

This is not a campaign engine, bot, booking CTA, or attribution product.

## Provider contract

Source of truth for the HTTP contract: official docs at [https://docs.bale.ai/safir](https://docs.bale.ai/safir) (retrieved 2026-09-09). Third-party clients are not treated as guarantees.

### VERIFIED (official docs)

| Topic | Value |
| --- | --- |
| Base URL | `https://safir.bale.ai/api/v3` |
| Send | `POST /send_message`, JSON |
| Auth | Header `api-access-key` (organization API Access Key from Bale business panel after creating Safir) |
| `bot_id` | Required integer; numeric id of the sending bot |
| Destination | `phone_number`; national numbers as `98` + 10 digits, no separators. `/start` / chat_id not required by this API |
| Text | `message_data.message.text` |
| `request_id` | Optional; docs state repeating the same `request_id` does not send a duplicate |
| Success body | `{ "message_id": "<id>", "error_data": null }` |
| Documented codes | 2 internal, 3 rate limit, 4 invalid input, 8 invalid phone, 17 not a Bale user, 20 payment required, 21 contact limit |

### UNVERIFIED / ASSUMED

| Topic | Status |
| --- | --- |
| HTTP status codes for those business errors | UNVERIFIED (we still map 401/403/429/5xx if they occur) |
| `Retry-After` | UNVERIFIED (honored when present) |
| `request_id` TTL, payload mismatch behavior, response on replay | UNVERIFIED; we send `message_deliveries.id` as `request_id` |
| Delivery/read webhooks | NOT SUPPORTED in MVP (marketing site mentions tracking; Safir send docs do not specify callbacks) |
| Max text length | UNVERIFIED; application max 4096 |
| Per-salon Bale organization | NOT implemented. Credentials are **platform env**, not encrypted tenant secrets |
| Live send against production Safir | NOT run in CI |

Official phone examples include both `989196111003` and `+98919611003` (the latter looks truncated). We send `98` + 10 digits from stored `09XXXXXXXXX`.

## Architecture

```text
Flutter (Persian composer)
  -> POST /intelligence/opportunities/:type/customers/:id/messages
  -> DB transaction: MessageDelivery PENDING + Outbox MessageSendRequested + audit
  -> Worker claims outbox -> BaleSafirMessageSender -> SENT | FAILED
```

Domain modules do not import Safir DTOs. `OpportunityService` / `ActionService` do not call Bale.

## Message lifecycle

`PENDING` → worker `PROCESSING` → `SENT` (provider returned `message_id`) or `FAILED`.

`SENT` means **provider accepted the send request**, not delivered or read.

Timeout after a possible accept: retry with the same `request_id` (at-least-once internally; duplicate customer message depends on unverified provider idempotency).

## Credential model

Environment:

- `BALE_SAFIR_API_ACCESS_KEY`
- `BALE_SAFIR_BOT_ID`
- optional `BALE_SAFIR_BASE_URL`, `BALE_SAFIR_TIMEOUT_MS`

If either required value is missing, the API returns `503` `Bale messaging is not configured` and no delivery row is created.

## Customer deletion

If any transaction exists (including VOIDED): still 409.

If none: message deliveries are deleted with other non-financial operational children (before actions, because of Restrict FKs), then visits, then the customer.

## Failure matrix (internal)

| Failure | Delivery | Retry outbox? | User-visible (after poll / Flutter map) | Log |
| --- | --- | --- | --- | --- |
| Network / DNS / TLS / timeout | stay PROCESSING then retry | yes | ارسال پیام انجام نشد… | warn |
| HTTP 5xx / Safir code 2 | retry | yes | same | warn |
| HTTP 429 / code 3 | retry; Retry-After if present | yes | ارسال پیام موقتاً محدود شده… | warn |
| HTTP 401/403 | FAILED PROVIDER_AUTH | no | اتصال پیام‌رسان بله… | error |
| Code 8 / 17 | FAILED PROVIDER_RECIPIENT_UNAVAILABLE | no | ارسال پیام به این شماره امکان‌پذیر نیست | warn |
| Code 4 / 20 / 21 / HTTP 400 | FAILED PROVIDER_INVALID_REQUEST | no | generic retry copy | warn |
| Malformed 2xx body | retry (same request_id) | yes | temporary | warn |
| Missing env | no row (API 503) or FAILED NOT_CONFIGURED in worker | no | اتصال… | error |
| Worker crash before HTTP | PROCESSING, lease reclaim, resend same request_id | yes | queued | info |
| Crash after HTTP before DB | retry same request_id | yes | queued then SENT | warn |
| Duplicate Idempotency-Key + same body | replay row | n/a | same delivery | — |
| Same key + different body | 409 | n/a | conflict | — |

No exactly-once claim.

## Manual smoke test (do not put credentials in Git)

1. Set real `BALE_SAFIR_API_ACCESS_KEY` and `BALE_SAFIR_BOT_ID` in local `.env`.
2. Run API + worker.
3. Create/use a customer with a phone that has a Bale account.
4. Open a current `REVENUE_DECLINE` opportunity in Flutter.
5. Send a short text. Confirm `PENDING` then `SENT` and a `message_id` in DB.
6. Confirm Action is still `OPEN` until you mark it done.

Do not run this from Jest.
