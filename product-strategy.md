# Product Strategy

**Status:** Current product direction  
**Product:** Beauty Salon Revenue & Customer Intelligence Platform

Implementation status lives in `product/mvp.md` and `docs/current-state-system-spec.md`. This file is **intent and sequencing**.

---

## 1. Thesis

> **Help beauty salons generate more revenue from the customers they already have.**

The salon records **completed visits** (and, when money was received, **transactions**). The product derives who is overdue or declining, recommends an action, and lets staff execute human-controlled outreach.

This is a **vertical** product for women's beauty salons. It is not generic SMB SaaS.

---

## 2. Primary wedge

**Retention & Revenue Intelligence.**

The loop:

```text
Customer
  → completed Visit
  → Transaction / economic behavior
  → derived Intelligence (status, signals, opportunity)
  → OpportunityAction (human response)
  → MessageRequest (intent) → MessageDelivery (execution)
  → (later) return visit / revenue outcome
```

Differentiation: explainable rules, financial integrity, and an action layer — not a prettier appointment book.

VIP outreach sits **beside** this loop. Same messaging execution pipeline; different recipient origin (platform lists, not salon CRM).

---

## 3. Current priorities

1. Keep visit/transaction facts trustworthy (tenant isolation, void-not-rewrite, idempotency).
2. Keep intelligence **derived** and explainable (visits + completed money).
3. Make the action loop usable: opportunities → complete/dismiss → queue message → admin fulfill.
4. Operate VIP as a constrained, entitled, human-reviewed outreach path (manual dispatch; VIP Bale deferred).
5. Harden scale of intelligence serving before inventing new product surfaces.

---

## 4. Sequencing

```text
CRM facts (customers, visits, services, transactions)
  → Customer intelligence
  → Durable actions + human messaging
  → VIP list outreach (manual)
  → (later) outcome measurement / influenced revenue
  → (later) price intelligence / marketplace
  → (later, optional) attribution & incentives
```

Do not skip to marketplace or commissions because they appear in older long-term diagrams.

---

## 5. Explicit exclusions

The product is **not**:

- A booking / reservation / calendar system
- A POS replacement
- Accounting, payroll, or employee commission software
- Inventory ERP
- A generic CRM
- A supplier marketplace or e-commerce store
- An AI chatbot or autonomous outreach agent
- A social media suite

Future integration with some of those systems is possible. Building them **as this product** is not.

---

## 6. Intelligence philosophy

Prefer:

```text
Signal → Insight → Recommendation → Action → Outcome
```

Initial intelligence is **rule-based** (`RuleBasedRetentionAnalyzer` in `@salon/shared`). Thresholds are explicit. ML may replace the analyzer interface later; it must not become a second ledger.

Cross-sell and HIGH_VALUE spend segments wait for a deliberate salon-specific rule. `REVENUE_DECLINE` exists when completed-transaction UTC-month trend is `DECREASING`.

---

## 7. Messaging philosophy

Messaging is **human-initiated, one-to-one, queued**. It is not a campaign engine.

- Salon creates **MessageRequest** (intent).
- Platform admin chooses **BALE** or **MANUAL**.
- Bale/Safir is a provider adapter.

Consent/opt-out is **not implemented**. Do not pretend it is.

---

## 8. Future expansion principles

- Beauty salons only until a written decision says otherwise.
- Marketplace and attribution stay independent domains.
- Do not hard-code “this customer belongs to one employee forever.”
- Do not split the modular monolith without evidence.
- Earn expansion by proving the retention loop changes revenue.

---

## 9. Lightweight price intelligence (strategy only)

Older MVP drafts included beauty-product market prices as a thin wedge-2 foothold. That capability is **deferred**. Architecture should not pretend Product/ProductPrice tables exist.
