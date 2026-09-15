# Business Model

**Status:** Intent (hypotheses unless labeled otherwise)  
**Not:** implementation inventory — see `docs/current-state-system-spec.md`

## 1. Overview

We are building a vertical SaaS platform for **women's beauty salons**.

The commercial promise is not “another salon management system.” It is:

> Help beauty salons make more money from the customers they already have.

The product should become the **operating intelligence layer** of a salon: customer history, explainable retention signals, recommended actions, and human-operated outreach.

Long-term the company may add procurement/marketplace and optional employee attribution. Those are **future wedges**, not the current business.

---

## 2. Target customer

**Primary:** women's beauty salons (small to medium: recurring clients, multiple services, existing customer lists).

**Economic buyer:** salon owner, founder, or manager. They care about revenue, retention, and LTV — not software features.

**Operators:** owner, manager, receptionist/staff.

**Not the customer:** barbershops, restaurants, clinics, generic SMB, independent stylists without a salon tenant.

Schema does not encode “women’s salon”; the restriction is a **product** decision.

---

## 3. Problem

Salons already have customers, visits, and (often) informal lists in notebooks or Excel. That data is:

- fragmented
- operational rather than actionable
- disconnected from follow-up

Generic CRM and booking tools optimize calendars. They do not tell the owner **who is overdue, why that matters, and what to do today**.

---

## 4. Value proposition

```text
Customer history
→ behavioral understanding
→ opportunity
→ recommended action
→ human outreach
→ customer returns
→ measured revenue
```

Value mechanisms we intend to sell:

1. **Revenue expansion** — repeat visits, reactivation, later cross-sell.
2. **Focus** — a daily “what should I do?” list instead of a vanity dashboard.
3. **Trustworthy history** — completed visits and money as facts, not overwritten bookings.

VIP outreach (platform-managed external contact lists for entitled salons) is an additional **acquisition-adjacent** capability. It is not the core retention thesis and is not a billing/subscription product by itself. Entitlement is an admin grant, not payment verification.

---

## 5. Why a salon would pay

Hypothesis (not yet a measured fact):

- The salon will pay recurring SaaS fees if the product produces **incremental revenue** from customers they already have.
- Retention intelligence is a stronger first wedge than procurement.
- Owners will trust the platform with customer phones if actions are reviewable and human-controlled.

Candidate north-star metric:

> **Incremental revenue influenced by the platform**

(reactivation, return visits, and later campaign-attributed spend). This is a direction, not an implemented analytics product.

---

## 6. Revenue logic (intended)

Possible future streams — **none are implemented as billing**:

| Stream | Idea | Current status |
| --- | --- | --- |
| SaaS subscription | Recurring salon seats/locations/feature tiers | Not built |
| Messaging usage | Credits / markup on provider send | Not built (Bale is platform-credentialed) |
| VIP access | Premium outreach entitlement | Entitlement row only; no invoices |
| Marketplace | Supplier commissions | Out of scope |
| Attribution module | Optional premium | Out of scope |

Do not pretend `VipSalonEntitlement` is a payment.

---

## 7. Strategic wedges

### Wedge 1 — Retention & Revenue Intelligence (primary, current)

Prove that customer + visit + transaction data can drive actions that bring people back.

### Wedge 2 — B2B beauty supply marketplace (future)

Procurement flywheel. **Not** current product. Do not monetize or build marketplace UX.

### Wedge 3 — Attribution & incentives (future, optional)

Employee rewards. Must remain optional and must not contaminate Customer/Visit/Transaction.

---

## 8. What we deliberately do not monetize or build yet

- Booking / calendar as the product
- Replacing the cash register
- Accounting, payroll, commissions
- Supplier checkout
- Autonomous AI that messages customers without a human

---

## 9. Validation

Do not confuse **feature built** with **business validated**.

```text
Customer problem → adoption → behavior → measurable outcome → willingness to pay
```

Assumptions in this file remain hypotheses until pilots produce evidence.
