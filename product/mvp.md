# MVP Specification

**Version:** 0.1
**Status:** Development Specification
**Product:** Beauty Salon Revenue & Customer Intelligence Platform

---

# 1. MVP Objective

The MVP exists to validate one core business hypothesis:

> **Can we help women's beauty salons generate more revenue from their existing customers by turning customer data into actionable retention opportunities?**

The MVP must therefore remain small, focused, and measurable.

The primary product loop is:

```text
Customer Data
    ↓
Customer Behavior
    ↓
Insight
    ↓
Revenue Opportunity
    ↓
Salon Action
    ↓
Customer Response
    ↓
Revenue Outcome
```

Anything that does not materially support this loop should be questioned before implementation.

---

# 2. Target User

The MVP is built exclusively for:

> **Women's beauty salons**

Primary user:

- Salon owner
- Salon manager

Secondary user:

- Receptionist or authorized salon employee

The MVP is not intended for:

- Barbershops
- General businesses
- Restaurants
- Medical clinics
- Generic CRM users
- Individual beauty professionals operating without a salon context

The product domain should remain explicitly salon-oriented.

---

# 3. MVP Scope

The MVP contains five primary capabilities:

```text
1. Salon & User Management
2. Customer Management
3. Customer Activity & Transaction History
4. Customer Intelligence & Retention Opportunities
5. Basic Campaign Actions

Secondary capability:

6. Beauty Product Price Intelligence
```

---

# 4. Module 1 — Salon Management

Each salon is a separate tenant.

The MVP must support:

- Salon registration
- Salon profile
- Salon users
- Basic roles
- Authentication
- Tenant isolation

Minimum roles:

```text
OWNER
MANAGER
STAFF
```

The MVP does not need complex permission management.

However, authorization must be designed so that users cannot access another salon's data.

---

# 5. Module 2 — Customer Management

The salon must be able to manage customers.

### Customer creation

Minimum fields:

```text
id
salonId
firstName
lastName
phoneNumber
createdAt
updatedAt
```

Customer phone numbers must be exactly 11 digits and start with `09`.

Example:

```text
09121111111
```

The same rule applies to Excel import. Alternative formats such as `+98`, `0098`, spaces, hyphens, or numbers missing the leading zero are rejected and are not converted.

Additional fields may be added only when there is a clear product reason.

Do not create a large customer profile unnecessarily.

OWNER and MANAGER may delete a customer. STAFF may not. Deletion is a hard delete of that customer and their completed visit records only, in one tenant-scoped transaction. Audit logs and outbox history are not deleted. There is no booking or appointment to cancel.

---

## Customer List

The salon should be able to:

- View customers
- Search customers
- Filter customers
- Open customer details

Useful filters may include:

- Recently active
- Inactive
- High value
- Frequent visitors
- At-risk
- Reactivation opportunity

---

## Customer Detail

The customer detail page should show:

```text
Customer Profile
        ↓
Visit History
        ↓
Services
        ↓
Transactions
        ↓
Behavior Summary
        ↓
Relevant Opportunities
```

Example:

```text
Sara Ahmadi

Last Visit:
42 days ago

Total Visits:
8

Total Spend:
€1,240

Average Transaction:
€155

Most Used Service:
Hair Color

Status:
At Risk

Opportunity:
Reactivation
```

---

# 6. Module 3 — Activity & Transactions

The MVP needs historical behavior data.

The minimum activity model should support:

### Visit

```text
id
salonId
customerId
visitDate
notes
createdAt
```

Completed visits can be listed for one customer (`GET /customers/:customerId/visits`) or for the salon (`GET /visits`, newest first, max 200). Filters: `customerId`, `date=YYYY-MM-DD` (UTC day), or `from`/`to` ISO instants. OWNER/MANAGER may delete a completed visit (`DELETE /visits/:id`). This is not cancelling a booking.

### Service

```text
id
salonId
name
category
active
```

### Transaction

```text
id
salonId
customerId
visitId
amount
transactionDate
createdAt
```

A transaction may contain one or more service items.

The exact financial model should remain simple in MVP.

Money values must never use floating-point types.

Use an appropriate monetary representation such as:

```text
BigDecimal
```

or minor-unit integer representation where appropriate.

---

# 7. Historical Data Import

Customer acquisition will often depend on existing salon data.

The current MVP supports **customer Excel import only** (not visits, services, or transactions).

- Endpoint: `POST /customers/import` (`multipart/form-data`, field `file`)
- Template: `GET /customers/import/template`
- Format: `.xlsx` with columns **Name** and **Phone** (case-insensitive headers)
- Phone values must be the canonical 11-digit `09` format (example: `09121111111`). The import does not convert `+98`, `0098`, spaced, hyphenated, or numeric cells that lost a leading zero.
- Limits: 2 MB, 5,000 data rows
- Duplicate policy: unique `(salonId, phoneNumber)`. Existing customers are never overwritten. Duplicates in the file are skipped.
- Authorization: same as customer create (`OWNER`, `MANAGER`, `STAFF`)
- Tenant is taken from the JWT, never from the file
- Result statuses: `IMPORTED`, `ALREADY_EXISTS`, `DUPLICATE_IN_FILE`, `INVALID`

Visit and transaction import are out of scope for this MVP.

---

# 8. Module 4 — Customer Intelligence

This is the **core MVP capability**.

The system should analyze customer history and produce actionable segments.

Initial intelligence should be rule-based.

Do not introduce machine learning unless explicitly required.

---

## 8.1 Customer Status

Each customer can have a derived status such as:

```text
NEW
ACTIVE
RETURNING
AT_RISK
INACTIVE
```

These statuses are derived from behavioral data.

They are not the primary source of truth.

The underlying customer/activity/transaction data remains authoritative.

---

# 9. Retention Intelligence

The system should identify customers who may be ready for reactivation.

Example logic:

```text
Customer's historical average return interval:
35 days

Days since last visit:
52 days

Result:
Customer is overdue
```

The exact thresholds should be configurable later.

For MVP, simple deterministic rules are acceptable.

---

# 10. Revenue Segments

The MVP should expose useful customer segments.

### High Value

Customers with relatively high historical spend.

### Frequent

Customers with high visit frequency.

### At Risk

Previously active customers whose expected return period has passed.

### Inactive

Customers who have not returned for a longer period.

### Reactivation Opportunity

Customers who:

- Previously visited
- Have meaningful historical activity
- Have not returned within their expected period

These segments should be understandable to salon owners.

Avoid technical terminology such as:

> "RFM score = 0.73"

Prefer:

> "Customers who are likely overdue for their next visit."

---

# 11. Dashboard

The MVP dashboard should focus on business outcomes rather than technical metrics.

Example:

```text
Good Morning

Your Salon

Customers
1,842

Active Customers
726

At-Risk Customers
143

Reactivation Opportunities
87

Revenue This Month
€42,500
```

Then:

```text
Recommended Actions

87 customers may be ready for reactivation

32 high-value customers have not returned recently

18 customers may be suitable for a cross-service campaign
```

The dashboard should answer:

> **"What should I do today?"**

not merely:

> **"How much data do I have?"**

---

# 12. Module 5 — Campaigns

The MVP should allow the salon to act on customer intelligence.

Initial campaign types:

```text
REACTIVATION
CUSTOMER_RETURN
CROSS_SELL
GENERAL_PROMOTION
```

However, reactivation is the primary use case.

---

## Campaign Flow

```text
Select Opportunity
        ↓
Review Customers
        ↓
Create Campaign
        ↓
Write Message
        ↓
Review
        ↓
Send
        ↓
Track Result
```

The salon should always be able to review the recipients before sending.

---

# 13. Messaging

Messaging should be abstracted behind a provider interface.

Example conceptual architecture:

```text
CampaignService
      ↓
MessagingService
      ↓
MessagingProvider
      ↓
SMS Provider
```

The business logic must not depend directly on a specific SMS provider.

The system should support:

- Message creation
- Recipient selection
- Send status
- Delivery status where available
- Campaign history

Consent and opt-out requirements must be respected.

---

# 14. Campaign Measurement

The MVP should attempt to connect campaigns to outcomes.

Example:

```text
Campaign sent
    ↓
Customer receives message
    ↓
Customer returns
    ↓
Transaction recorded
    ↓
Revenue attributed to campaign
```

The attribution model can initially be simple and transparent.

Do not build the employee attribution/incentive system here.

This is **campaign-to-customer outcome measurement**, not employee revenue sharing.

---

# 15. Cross-Sell

Basic cross-sell intelligence may exist in MVP, but it should remain simple.

Example:

```text
Customer frequently uses Hair Services

but has never purchased Nail Services.

Potential opportunity:
Cross-service promotion
```

This should be based on simple service/category relationships.

Do not build an advanced recommendation engine.

---

# 16. Product Price Intelligence

This is the only part of Wedge 2 included in MVP.

The MVP should allow salons to search for beauty products and view relevant market price information.

Example:

```text
Search:
L'Oréal Majirel 7.1

Result:

Latest Market Price
€12.50

Previous Price
€11.80

Price Updated
2 days ago
```

The primary user question is:

> **"How much does this product currently cost in the market?"**

---

# 17. Product Model

Minimum product structure:

```text
Product
- id
- name
- category
- brand
- active
```

Price structure:

```text
ProductPrice
- id
- productId
- price
- observedAt
- source
```

The system should retain price history.

---

# 18. Supplier Model

Supplier functionality is **not a customer-facing marketplace feature in MVP**.

However, the backend/domain should be capable of storing supplier information.

Possible future structure:

```text
Supplier
    ↓
SupplierProduct
    ↓
ProductPrice
```

For MVP:

- Supplier data may exist internally
- Supplier management may be admin-only
- Supplier profiles should not be prominently exposed to salon users
- No supplier marketplace
- No ordering
- No checkout
- No supplier payment
- No supplier rating system

The MVP exposes **price intelligence**, not a marketplace.

---

# 19. MVP Pages

The initial application should contain approximately these screens:

```text
Authentication
├── Login
└── Register

Salon
├── Dashboard
└── Settings

Customers
├── Customer List
├── Customer Detail
└── Customer Import

Intelligence
├── Opportunities
├── At-Risk Customers
└── Reactivation Opportunities

Campaigns
├── Campaign List
├── Create Campaign
├── Campaign Detail
└── Campaign Results

Products
├── Product Search
└── Product Price Detail
```

Do not create unnecessary screens.

---

# 20. MVP API Areas

The backend should expose APIs around business capabilities.

Conceptually:

```text
/auth
/salon
/users

/customers
/customers/{id}
/customers/import

/services
/visits
/transactions

/intelligence
/intelligence/opportunities
/intelligence/segments

/campaigns
/campaigns/{id}
/campaigns/{id}/send

/products
/products/{id}
/products/{id}/prices
```

Exact REST paths may evolve with implementation.

The API structure should represent business capabilities rather than database tables.

---

# 21. Core Business Events

The MVP should establish an event-oriented foundation where useful.

Initial events may include:

```text
CustomerCreated
CustomerImported
VisitCompleted
TransactionCompleted
CustomerReturned
CampaignCreated
CampaignSent
MessageDelivered
```

Events should only be introduced where they provide real value.

Do not build a complex event-driven architecture merely for theoretical scalability.

---

# 22. MVP Domain Boundaries

The codebase should have clear modules.

Recommended conceptual structure:

```text
customer
├── Customer
├── CustomerService
├── CustomerRepository
└── CustomerController

transaction
├── Transaction
├── TransactionService
└── TransactionRepository

intelligence
├── CustomerSegment
├── RetentionRule
├── Opportunity
└── IntelligenceService

campaign
├── Campaign
├── CampaignRecipient
├── CampaignService
└── MessagingProvider

product
├── Product
├── ProductPrice
└── ProductPriceService
```

The exact package structure may depend on the selected framework.

---

# 23. Multi-Tenancy

This is a mandatory MVP requirement.

Every salon's data must be isolated.

Tenant isolation must apply to:

- API requests
- Database queries
- Background jobs
- Cache
- Events
- Analytics

A user belonging to Salon A must never access Salon B's customers or transactions.

Tenant isolation must be tested explicitly.

---

# 24. Security

Minimum MVP security:

- Authentication
- Authorization
- Password security
- Role-based access
- Tenant isolation
- Input validation
- Secure session/token handling
- Audit logging for sensitive operations

Never trust `salonId` supplied by the client as the sole authorization mechanism.

The backend must derive tenant context from the authenticated user/session.

---

# 25. Background Jobs

The following operations may run asynchronously:

- Customer intelligence calculation
- Large imports
- Campaign sending
- Message status updates
- Analytics aggregation

Do not introduce distributed infrastructure unless necessary.

A simple job/queue mechanism is sufficient initially.

---

# 26. What Must NOT Be Built

The following are explicitly outside MVP:

```text
Booking
Reservations
Calendar
Appointment Scheduling

Employee Attribution
Employee Commission
Rewards
Revenue Sharing
Incentive Rules

Supplier Marketplace
Supplier Discovery
Supplier Checkout
Supplier Payments
Supplier Ratings
Ordering
Delivery

Accounting
Payroll
Full Inventory Management

Advanced Machine Learning
LLM-based Recommendations
AI Agents

Microservices
Complex Event Bus
Multi-region Architecture
```

If a feature from this list appears during development, stop and verify product scope before implementing it.

---

# 27. MVP Definition of Done

The MVP is not complete when all screens exist.

It is complete when the following flow works end-to-end:

```text
Salon Created
      ↓
Customer Data Imported
      ↓
Customer History Available
      ↓
Customer Intelligence Calculated
      ↓
At-Risk Customers Identified
      ↓
Salon Reviews Opportunity
      ↓
Campaign Created
      ↓
Campaign Sent
      ↓
Customer Returns
      ↓
Transaction Recorded
      ↓
Outcome Measured
```

And:

```text
Salon searches for a beauty product
      ↓
Product found
      ↓
Latest market price displayed
      ↓
Price history available
```

---

# 28. MVP Quality Requirements

Before declaring MVP complete:

### Business

- Core retention workflow works
- Revenue opportunity is understandable
- Salon can take action

### Data

- Customer data is reliable
- Transactions are consistent
- Derived intelligence does not replace source-of-truth data

### Security

- Tenant isolation verified
- Authorization verified

### Reliability

- Failed imports are recoverable
- Failed campaigns are visible
- Background jobs are observable

### Testing

Test at minimum:

- Customer creation
- Customer import
- Transaction creation
- Retention calculation
- Opportunity generation
- Campaign creation
- Campaign sending
- Campaign outcome
- Product price retrieval
- Tenant isolation

---

# 29. MVP Success Condition

The strongest validation signal is not:

> "Salons like the dashboard."

The strongest validation signal is:

> **"Salons use the system to identify customers, take retention actions, and generate measurable additional revenue."**

If the MVP proves this, the product has a strong foundation for expansion.

If it does not, adding more features should not be the first response.

---

# 30. Product Expansion After MVP

Only after the core MVP demonstrates real value should the product consider expanding into:

```text
MVP
 ↓
Advanced Retention Intelligence
 ↓
Revenue Automation
 ↓
More Messaging Channels
 ↓
Beauty Supply Marketplace
 ↓
Supplier Network
 ↓
Attribution & Incentives
 ↓
Multi-Branch / Enterprise
```

Expansion must be driven by validated customer demand and measurable business value.

---

# Final MVP Principle

> **Build the smallest product that can prove salons will use customer intelligence to generate more revenue.**

Do not build a complete salon management system.

Do not build a marketplace.

Do not build an incentive platform.

Do not build an AI platform.

Build the **Revenue Intelligence Core** first.
