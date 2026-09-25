# Domain model

**Status:** Current domain (reconciled with schema and use-cases)  
**Physical tables:** `architecture/data-model.md`  
**Money:** `domain/financial-domain.md`  
**Messaging:** `docs/messaging-domain.md`

Do not treat Campaign, Product, ProductPrice, Supplier, or Appointment as current entities. They are not in the schema.

---

## 1. Loop

```text
Salon (tenant)
  User (operator)
  Customer (salon client)
    Visit          ← business fact
    Transaction    ← financial fact
        TransactionItem + Service
  Intelligence     ← derived on read
  OpportunityAction ← durable human response
  MessageRequest   ← durable send intent
  MessageDelivery  ← execution
```

VIP lives on the tenant but **not** on Customer:

```text
PlatformAdmin
  VipTargetList / VipTargetContact
VipSalonEntitlement
  VipRequest / VipRequestRecipient / VipSampleWork
    → MessageRequest (customerId null, vipRequestId set)
```

---

## 2. Fact vs derived vs execution

| Layer | Concepts | Source of truth? |
| --- | --- | --- |
| Business facts | Salon, User, PlatformAdmin, Customer, Visit, Service | Yes |
| Financial facts | LedgerTransaction (`transactions`), TransactionItem | Yes (amount header) |
| Derived intelligence | status, signals, opportunities, segments, revenue metrics | No — computed |
| Human/operational facts | OpportunityAction | Yes (the salon responded) |
| Recovery fact | ReturnCommitment | Yes (agreed return after SENT outreach; salon user or platform admin actor). Not a Visit or appointment |
| Intent | MessageRequest, VipRequest | Yes (requested) |
| Execution | MessageDelivery, VipSampleWork object storage | Yes (how it was fulfilled) |
| Infrastructure | OutboxEvent, AuditLog, IdempotencyRecord | Yes (ops), not business meaning |

---

## 3. Aggregates

### Salon

Tenant. Owns users, customers, services, visits, transactions, actions, messages, VIP requests. Status `ACTIVE` | `SUSPENDED`. Duplicate names allowed.

### User

Salon operator. One salon. Roles `OWNER` | `MANAGER` | `STAFF`. Status `ACTIVE` | `DISABLED`. Email globally unique. Last active OWNER cannot be removed/demoted. MANAGER may create/disable STAFF only. OWNER assigns any role.

`createdBy` on actions/messages/VIP requests points at `users.id` **without** a composite tenant FK (known debt TD-03). `ReturnCommitment` creator/updater is XOR: composite salon `(userId, salonId)` **or** `platform_admins.id`, never both, never neither.

### PlatformAdmin

Not a salon user. No tenant. JWT `scp=platform`. Owns VIP lists and entitlements; dispatches the message queue.

### Customer

Salon client. Identity: `firstName`, `lastName`, `phoneNumber`. Unique `(salonId, phoneNumber)`. Hard delete only with **no** transactions (including voided) and **no** message history; then visits/actions for that customer may be removed in the same tenant transaction. Audit/outbox rows remain.

### Visit

Completed interaction: `visitedAt` (timestamptz, not in the future beyond small skew). **Not** a booking. No notes column. Optional link from transactions. Multiple visits at the same instant are allowed; duplicates are prevented by idempotency keys, not by unique visitedAt.

### Service

Named offering for line items. Unique `(salonId, name)`. `ACTIVE`/`INACTIVE`. Not inventory, not a price list. Amount is entered per sale.

### LedgerTransaction / TransactionItem

See `domain/financial-domain.md`. Visit link optional. Items RESTRICT-bound to services.

### Opportunity (not a table)

Read-time interpretation: this customer currently qualifies for `REACTIVATION` | `CUSTOMER_RETURN` | `REVENUE_DECLINE`. Must not be stored as the ledger.

### OpportunityAction

Durable record that staff responded to a derived opportunity. Status `OPEN` | `COMPLETED` | `DISMISSED`. Sending a message does not complete it.

`sourceVisitId` snapshots the customer's last visit at open time. It is **not** an FK. It identifies the episode so a new visit can open a new action of the same type. Unique protection: one OPEN per (salon, customer, type); one row per (salon, customer, type, sourceVisitId) via insert `ON CONFLICT DO NOTHING`.

### MessageRequest / MessageDelivery

See `docs/messaging-domain.md`. Intent vs fulfillment. Origins: opportunity (both `actionId` and `opportunityType` set), manual (both null), VIP (`vipRequestId` + recipient snapshot).

### ReturnCommitment

Salon- or platform-admin-recorded fact that a customer agreed to return after an eligible SENT customer (non-VIP) `MessageRequest`/`MessageDelivery`. Stores `expectedAt` (UTC). Not a Visit, appointment, booking, or slot. At most one row per source request and per source delivery. Admin is an actor/provenance source; the row stays tenant-bound to the source message’s salon and customer. `actualVisitId` is **explicit attribution**: set only by arrival (`POST .../arrive`) or correction (`POST .../link-visit`). Independent Visit writes (`POST /visits`, complete-with-sale) do **not** infer a link and do **not** become COMMITMENT_BACKED. `/arrive` refuses to create another Visit (409 `RETURN_COMMITMENT_VISIT_REVIEW_REQUIRED`) when `actualVisitId` is still null and a qualifying later Visit already exists; it does not pick or link that Visit. **Operational openness** is a derived read: `actualVisitId` IS NULL **and** there is no same-salon same-customer Visit with `visitedAt` > source `MessageDelivery.submittedAt` (strict `>`; `createdAt`/`expectedAt` are not the chronology bound). A later Visit can settle follow-up without writing `actualVisitId`. Visit delete unlinks in application code (must not rely on `ON DELETE SET NULL` of composite `(actual_visit_id, salon_id)`). Flutter records/edits `expectedAt` and arrives through the commitment command; it does not invent MISSED/NO_SHOW. Open operational list (`GET /return-commitments/open`) uses that derived predicate, including overdue expected times (overdue ≠ no-show). COMMITMENT_BACKED evidence (explicit `actualVisitId` Visit + associated ledger revenue) outranks OBSERVED last-touch association for the same Visit; an unlinked later Visit remains OBSERVED-eligible.

Owner recovery outcomes (`GET /recovery/outcomes/summary`) are **derived on read** for one Asia/Tehran Saturday business week. Headline money is COMPLETED ledger amounts on chronology-eligible COMMITMENT_BACKED Visits only. OBSERVED remains a separate count. Live derivation; voids and unlinks change later reads. Not a campaign, booking, or incremental-revenue ledger.

Return evidence is selected across the full tenant/customer history before a reporting week or cursor is applied. For example, a customer message submitted September 9 and Visits on September 10 and 15 select the September 10 Visit as that delivery's **first** OBSERVED return. If the September 10 Visit is explicitly linked to a valid ReturnCommitment, it is shown as COMMITMENT_BACKED in effective evidence; the delivery is not reassigned to September 15. A different eligible message submitted September 14 can select the September 15 Visit. Each Visit first chooses its last-touch eligible SENT non-VIP delivery by `submittedAt` (strictly before `visitedAt`), then delivery `createdAt` and id; visits compete for that delivery by `visitedAt`, then Visit `createdAt` and id. An unlinked later Visit is still a candidate, but cannot reuse a delivery already claimed by an earlier Visit. Effective evidence validates same-salon request/delivery/commitment/Visit customer provenance; an inconsistent historical link remains a stored fact without creating COMMITMENT_BACKED evidence or suppressing another customer's OBSERVED evidence. A provenance-valid explicit link whose Visit predates its own source submission is not COMMITMENT_BACKED, but still suppresses OBSERVED classification of that same Visit under the existing visit-level precedence rule. A later unlinked Visit can settle operational follow-up, but does not fill `actualVisitId`. Completed Visit transactions supply associated revenue once per selected Visit; VOIDED transactions do not. This is association, not causation, and does not rewrite Visit, Transaction, MessageRequest, or MessageDelivery history.

### VIP

- **VipTargetList** — platform list; `PENDING` → `ACTIVE`/`INACTIVE`; `IN_USE` while reserved. Optional canonical `regionCode` (`01`–`14`); null means not regional inventory.
- **VipTargetContact** — phone on a list (optional display name); not a Customer. Phone is the identity.
- **VipSalonEntitlement** — admin-granted product flag; revoke is a timestamp, not a delete of history.
- **VipRequest** — salon request: count 30/50/100, geographic range **text** (template only), statuses `AWAITING_SAMPLE_WORK` | `SUBMITTED` | `MANUAL_QUEUED` | `BALE_NOT_IMPLEMENTED` | `CANCELLED`. Reservation TTL 30 minutes. Admin outreach folders group existing VipRequests by `salonId` on read; they are not a new persisted entity.
- **VipRequestRecipient** — immutable snapshot including generated Persian template.
- **VipSampleWork** — metadata; bytes in MinIO.

Quota: 500 contacts per salon per rolling 7 days (temporary product limit), excluding `CANCELLED`.

### OutboxEvent / AuditLog / IdempotencyRecord

Infrastructure. Outbox is at-least-once transport. Most event types have **no side-effect consumer** (no-op, then PROCESSED). Worker executes Bale for `MessageDeliveryActivated` / legacy `MessageSendRequested`. Audit must not store message bodies or secrets.

---

## 4. Intelligence rules (derived)

Defined in `@salon/shared` (`thresholds.ts`, `retention.ts`, `revenue.ts`):

- Default expected return: 35 days (or measured average positive whole-day gaps).
- `AT_RISK` if days since last visit > expected; `INACTIVE` if > 2× expected.
- `REACTIVATION` if overdue and visitCount ≥ 2; `CUSTOMER_RETURN` if overdue and one visit.
- `FREQUENT` signal: ≥ 6 visits and average interval ≤ 28 days.
- Revenue from `COMPLETED` transactions only; `REVENUE_DECLINE` when UTC-month trend is `DECREASING` (previous month must have ≥ 1 completed tx).
- `HIGH_VALUE` not implemented.

Salon-wide intelligence summary covers every tenant Customer through bounded internal batches. Derived segment and opportunity lists globally rank the eligible tenant population before returning cursor pages; an older customer remains eligible regardless of creation order. Results are live derivations, not stored Customer attributes or a snapshot across concurrent writes.

---

## 5. Tenant boundary

Everything salon-owned is keyed by `salon_id`. Platform tables (`platform_admins`, `vip_target_lists`, `vip_target_contacts`) are **not** salon CRM. VIP contacts must not leak into another salon's Customer list. MessageRequest for VIP still has `salon_id` of the requesting salon.

---

## 6. Invariants (selected)

- No future visits (booking).
- Phone canonical `09XXXXXXXXX`.
- Opportunity context on MessageRequest is all-or-nothing (`action_id` null iff `opportunity_type` null).
- Recipient origin XOR: salon customer **or** VIP snapshot, not both, not neither.
- One daily-limit MessageRequest per salon+customer+Tehran date when `counts_toward_daily_limit`.
- One MessageDelivery per MessageRequest.
- Financial rows never cascade-deleted.
- Intelligence must be recomputable from visits + completed transactions.
