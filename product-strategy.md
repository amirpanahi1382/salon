# Product Strategy

**Version:** 0.1
**Status:** MVP Definition
**Product:** Beauty Salon Revenue & Customer Intelligence Platform

---

## 1. Product Definition

The product is a specialized software platform for **women's beauty salons**.

The initial product is **not a booking/reservation system** and should not attempt to become a general salon management suite.

The MVP focuses on:

1. Centralizing customer data
2. Understanding customer behavior
3. Identifying retention and revenue opportunities
4. Helping salons take simple actions based on those opportunities
5. Showing relevant beauty-product market prices as an early procurement capability

The initial product should be intentionally lightweight.

---

# 2. Product North Star

> **Help beauty salons generate more revenue from the customers they already have.**

The product should turn salon data into:

**Customer Data → Insight → Opportunity → Action → Revenue**

Every major MVP feature should support this loop.

The salon records a **completed visit** as the primary customer event. When amount was received, that same workflow also records the financial transaction. Visit and Transaction stay separate records. Revenue still comes only from COMPLETED transactions.

---

# 3. Strategic Wedges

## Wedge 1 — Retention & Revenue Intelligence

This is the **primary MVP wedge**.

The product should help salons understand:

- Who their customers are
- Who is returning
- Who has stopped returning
- What services customers use
- How frequently customers visit
- When a customer is likely to return
- Which customers may be suitable for reactivation
- Which customers may have cross-sell or upsell opportunities

The goal is not to build a complicated AI system.

The goal is to make customer data useful.

---

## Wedge 2 — Beauty Supply Price Intelligence

This is a **secondary and lightweight MVP capability**.

The initial version should:

- Allow the system to store beauty-product information
- Store product categories
- Store market prices
- Show relevant/latest prices to salons
- Provide a foundation for future supplier relationships

The MVP should **not expose a full supplier marketplace to salons**.

The architecture should support future suppliers and marketplace functionality, but the user-facing MVP should primarily provide **price visibility**.

Future capabilities may include:

- Supplier discovery
- Supplier profiles
- Product availability
- Direct supplier contact
- Ordering
- Transactions
- Supplier subscriptions
- Marketplace commissions

These are **out of scope for the MVP**.

---

## Wedge 3 — Attribution & Incentive Engine

**Completely out of scope for MVP.**

Do not implement:

- Employee customer attribution
- Cross-department attribution
- Revenue sharing
- Employee commissions
- Reward calculation
- Incentive rules
- Employee acquisition ownership

However, the architecture should avoid making future attribution impossible.

The future feature should be introduced as a separate domain/module rather than contaminating the MVP's core customer and transaction models.

---

# 4. Explicit Product Boundaries

The MVP is **not**:

- A booking system
- A reservation platform
- A calendar management system
- A POS replacement
- An accounting system
- A payroll system
- An employee incentive system
- A supplier marketplace
- An e-commerce platform
- A generic CRM
- An AI chatbot
- A social media management platform

The product may integrate with some of these systems in the future, but they are not MVP responsibilities.

---

# 5. MVP Core Modules

## 5.1 Salon Account

Basic salon-level account and configuration.

The system must understand that each salon is an independent tenant.

Minimum capabilities:

- Salon profile
- User accounts
- Basic roles/permissions
- Tenant isolation

---

## 5.2 Customer Management

The salon must be able to create and manage customer records.

Minimum customer information may include:

- Name
- Phone number
- Basic profile information
- Customer creation date
- Last visit
- Visit count
- Total spend
- Average transaction value
- Services purchased
- Customer status

The system should prioritize **useful business information over excessive profile fields**.

---

## 5.3 Customer Activity & Transaction Data

The product needs enough historical data to understand customer behavior.

Initial data should support:

- Customer
- Visit/service
- Service category
- Transaction amount
- Transaction date
- Optional notes

The data model should support importing historical customer/transaction data later.

---

## 5.4 Customer Intelligence

The MVP should provide simple, understandable customer insights.

Examples:

### Returning Customers

Customers who regularly return to the salon.

### At-Risk Customers

Customers whose expected return window has passed.

### Reactivation Opportunities

Customers who were previously active but have not returned recently.

### High-Value Customers

Customers with high historical revenue or high visit frequency.

### Cross-Sell Opportunities

Customers who use one service category but may reasonably be interested in another.

The first implementation should prefer **transparent rules and explainable logic** over black-box machine learning.

---

# 6. Retention Actions

The MVP should not only show analytics.

It should help the salon **act**.

A customer insight should ideally lead to an action.

Example:

> Customer has historically visited every 30–40 days and has now passed the expected return window.

Possible action:

> Add customer to a reactivation campaign.

The initial action layer can remain simple.

The system should support:

- Selecting customer segments
- Creating a campaign
- Preparing a message
- Sending through a messaging provider when available
- Tracking delivery/status where supported
- Recording campaign activity

Messaging infrastructure should be implemented behind an abstraction so providers can change later.

---

# 7. MVP Intelligence Philosophy

Do not build an overly sophisticated AI platform.

Initial intelligence should use:

- Rules
- Aggregations
- Customer history
- Recency
- Frequency
- Monetary value
- Service history
- Simple behavioral patterns

Example:

```text
Customer visits every ~35 days
↓
Last visit was 52 days ago
↓
Customer is likely overdue
↓
Retention opportunity
↓
Recommended action: reactivation campaign
```

The system should be designed so future predictive models can replace or augment these rules without redesigning the entire product.

---

# 8. Product Price Intelligence

The second wedge should enter the MVP in a deliberately lightweight form.

The system should maintain:

```text
Product
→ Category
→ Current / Latest Market Price
→ Price History
```

Example categories:

- Hair color
- Nail products
- Hair care
- Skin care
- Salon consumables

The MVP user experience should primarily answer:

> **"What is the current market price of this product?"**

The system should be able to maintain supplier information internally, but suppliers should not initially become a prominent customer-facing marketplace.

---

# 9. Supplier Architecture

Even though suppliers are not a major MVP user-facing feature, the domain should allow future expansion.

Potential future structure:

```text
Supplier
├── Products
├── Prices
├── Availability
├── Contact Information
└── Transactions
```

For MVP, the application may maintain this data internally while exposing only the relevant **product price information** to salons.

This allows the marketplace to evolve later without requiring a fundamental rewrite.

---

# 10. MVP Data Model — Conceptual

The initial domain should remain small.

Core entities:

```text
Salon
User
Customer
Service
Visit
Transaction
Campaign
CampaignRecipient
Product
ProductPrice
```

Future domains should remain separate:

```text
Supplier
Order
MarketplaceTransaction

EmployeeAttribution
Reward
IncentiveRule
```

Do not introduce future entities into the MVP simply because they may eventually exist.

---

# 11. MVP User Journey

The primary user journey should be extremely simple.

```text
Salon joins
    ↓
Imports / enters customer data
    ↓
Customer history becomes visible
    ↓
System identifies customer opportunities
    ↓
Salon sees actionable segments
    ↓
Salon launches a simple retention action
    ↓
Customer returns
    ↓
Outcome is measured
```

Secondary journey:

```text
Salon needs a beauty product
    ↓
Searches product
    ↓
Sees latest market price
```

That's enough for the MVP.

---

# 12. MVP Success Criteria

The MVP should prove three things.

## Hypothesis 1 — Customer Data Has Value

Salons are willing to centralize/import their customer data because the system provides useful insights.

## Hypothesis 2 — Insights Change Behavior

Salon owners/managers actually act on retention opportunities.

## Hypothesis 3 — Actions Can Influence Revenue

The platform can demonstrate measurable customer reactivation, repeat visits, or additional revenue.

The product is not validated merely because customers use the dashboard.

The important question is:

> **Does the platform help the salon make more money?**

---

# 13. MVP Metrics

### Product Activation

- Customer data imported
- Number of customers with usable history
- First insight generated
- First campaign created
- First action taken

### Engagement

- Weekly active salons
- Active users per salon
- Customer insights viewed
- Campaigns created
- Campaign recipients

### Business Outcome

- Reactivated customers
- Repeat visits
- Revenue from reactivated customers
- Incremental revenue influenced by campaigns
- Customer retention rate

### Price Intelligence

- Product searches
- Price views
- Frequently searched products
- Price coverage

---

# 14. MVP Non-Goals

Do not build these unless a later product decision explicitly brings them into scope:

### Operations

- Appointment booking
- Calendar
- Staff scheduling
- Payroll
- Accounting
- Inventory management

### Marketplace

- Supplier marketplace UI
- Supplier discovery
- Supplier ratings
- Online ordering
- Payments
- Marketplace checkout
- Delivery management

### Incentives

- Employee attribution
- Employee commissions
- Rewards
- Revenue sharing

### Advanced AI

- Complex ML pipelines
- Autonomous AI agents
- LLM-based customer decision making
- Black-box predictive models

### Enterprise Complexity

- Microservices
- Complex workflow engines
- Multi-region infrastructure
- Over-engineered analytics infrastructure

---

# 15. Technical Product Principle

The MVP should be built as a **modular monolith** unless real requirements prove otherwise.

The architecture should have clear boundaries around:

```text
Customer
Customer Intelligence
Retention
Campaigns
Transactions
Product Pricing
```

Future domains such as:

```text
Marketplace
Attribution
Incentives
```

should have clean extension points but should not add unnecessary MVP complexity.

---

# 16. Product Prioritization Rule

When deciding whether a feature belongs in MVP, ask:

1. Does it help us understand the customer?
2. Does it identify a revenue/retention opportunity?
3. Does it help the salon take action?
4. Can we measure the resulting outcome?

If the answer is no to all four, the feature probably does not belong in MVP.

For the marketplace wedge, the separate question is:

> Does this feature improve our ability to provide useful beauty-product price intelligence?

If not, defer it.

---

# 17. MVP Principle

> **Start narrow. Prove value. Then expand.**

The first product should be good at one thing:

> **Turning salon customer data into revenue opportunities.**

The product should earn the right to expand into procurement, marketplace functionality, and eventually attribution/incentives.

---

# 18. Product Evolution

The intended long-term evolution is:

```text
Customer Data
      ↓
Customer Intelligence
      ↓
Retention Intelligence
      ↓
Revenue Automation
      ↓
Beauty Supply Price Intelligence
      ↓
Beauty Supply Marketplace
      ↓
Attribution & Incentives
      ↓
Beauty Business Operating System
```

The MVP should implement only the **first meaningful part of this journey**, while preserving architectural room for the rest.
