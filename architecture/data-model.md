# Data Model

**Version:** 0.1
**Status:** MVP Database Specification
**Product:** Beauty Salon Revenue & Customer Intelligence Platform

---

# 1. Purpose

This document defines the initial relational data model for the MVP.

The database must:

- Represent the core salon business domain
- Enforce tenant isolation
- Preserve historical business data
- Support customer intelligence
- Support campaigns and campaign measurement
- Support product price intelligence
- Remain simple enough to evolve quickly

The database is a **source of truth for transactional business data**.

Derived intelligence should not silently become a replacement for historical source data.

---

# 2. Database Philosophy

The MVP should use a relational database.

Prefer:

> Simple relational design + strong constraints + useful indexes

over:

> Complex distributed data architecture

The MVP does not require:

- Multiple databases
- Database-per-service
- Sharding
- Multi-region databases
- Event sourcing
- Full CQRS
- Data warehouse infrastructure

These may be considered later if real scale requires them.

---

# 3. Tenant Model

`Salon` is the tenant.

Almost every business record must belong to exactly one salon.

Conceptually:

```text id="a91s8v"
Salon
  │
  ├── Users
  ├── Customers
  ├── Services
  ├── Visits
  ├── Transactions
  ├── Campaigns
  └── Other salon-owned data
```

The application must never rely only on frontend-provided `salonId`.

The authenticated user's tenant context must determine which salon's data can be accessed.

---

# 4. Core Tables

The MVP database contains approximately:

```text id="u3q6l8"
salons
users

customers
services
visits
transactions
transaction_items

campaigns
campaign_recipients

products
product_prices
```

Additional intelligence tables may be introduced when persistence provides real value.

Do not create tables simply to mirror every domain object.

---

# 5. salons

Represents the tenant.

```text id="c6s2va"
salons
------
id
name
phone
address
status
created_at
updated_at
```

### Constraints

```text id="2m0x8k"
PRIMARY KEY (id)
```

Possible status values:

```text id="4dy2p9"
ACTIVE
SUSPENDED
```

The exact lifecycle may evolve.

---

# 6. users

Represents people who operate the platform for a salon.

```text id="4c9t7k"
users
-----
id
salon_id
name
email
password_hash
role
status
created_at
updated_at
```

Relationship:

```text id="4x2v0d"
salons 1 ─────── * users
```

### Roles

Initial roles:

```text id="j2q5m1"
OWNER
MANAGER
STAFF
```

Do not create a complex permission matrix in MVP.

---

# 7. User Constraints

Email uniqueness should be carefully scoped according to the authentication model.

If email is globally used for login:

```text id="p9c8k2"
UNIQUE(email)
```

If the product intentionally allows the same email across multiple salons:

```text id="k2s1v7"
UNIQUE(salon_id, email)
```

The final choice must follow the authentication/product decision.

Passwords must never be stored in plaintext.

---

# 8. customers

Represents a salon's customer.

```text id="q8m4d1"
customers
---------
id
salon_id
first_name
last_name
phone_number
created_at
updated_at
```

Relationship:

```text id="f1d7q2"
salons 1 ─────── * customers
```

---

# 9. Customer Identity Constraint

Within a salon, phone number should normally identify a customer.

Recommended constraint:

```text id="x7v3n0"
UNIQUE(salon_id, phone_number)
```

This prevents accidental duplicate customers within the same salon.

However, phone number may be:

- Missing
- Invalid
- Shared by family members

Therefore the final product decision should determine whether the field is mandatory.

Do not globally assume that one phone number represents one human across all salons.

---

# 10. Customer Indexes

Recommended indexes:

```text id="d5h7s1"
INDEX customers_salon_id
INDEX customers_salon_id_phone_number
INDEX customers_salon_id_created_at
```

These support:

- Tenant filtering
- Customer search
- Customer listing
- Recent customer queries

Do not add indexes without a query/use-case reason.

---

# 11. services

Represents services provided by a salon.

```text id="b3n8p4"
services
--------
id
salon_id
name
category
active
created_at
updated_at
```

Relationship:

```text id="z6q4w8"
salons 1 ─────── * services
```

Example categories:

```text id="r3k9w1"
HAIR
NAIL
MAKEUP
SKIN
OTHER
```

The category list should remain extensible.

---

# 12. visits

Represents a completed historical salon visit.

```text id="m5v2q8"
visits
------
id
salon_id
customer_id
visited_at
created_at
updated_at
```

Phase 4 stores `visited_at` (UTC). There is no `service_id` until the Service domain exists. Notes are out of scope. Composite foreign key `(customer_id, salon_id)` prevents a visit from referencing another salon's customer.

Relationships:

```text id="s8c1x4"
salons   1 ─────── * visits
customers 1 ────── * visits
```

Important:

> A `visit` is not an appointment.

The MVP does not manage future reservations.

---

# 13. Visit Integrity

A visit must belong to:

- A valid salon
- A valid customer belonging to that salon

The database and application must prevent cross-tenant relationships such as:

```text id="h1n5c7"
Visit.salon_id = Salon A
Visit.customer_id = Customer belonging to Salon B
```

Tenant consistency must be enforced at the application level and, where practical, through database constraints/design.

---

# 14. transactions

Represents money generated by salon activity.

```text id="q2k7d9"
transactions
------------
id
salon_id
customer_id
visit_id
amount
currency
transaction_date
created_at
```

Relationships:

```text id="w4p8s2"
Customer 1 ─────── * Transactions
Visit    1 ─────── * Transactions
Salon    1 ─────── * Transactions
```

---

# 15. Money Representation

Never use:

```text id="x3c6m8"
FLOAT
DOUBLE
```

for monetary amounts.

Preferred:

```text id="q7p2v1"
DECIMAL / NUMERIC
```

For example:

```text id="n4s8d2"
NUMERIC(19,4)
```

The exact precision/scale should follow the selected currency and accounting requirements.

Java should use:

```text id="m8c1q4"
BigDecimal
```

---

# 16. Currency

Even if the MVP initially operates in one market, storing currency explicitly is recommended.

Example:

```text id="v3j7x9"
currency = EUR
```

This prevents the domain from assuming that every future transaction must use one currency.

The application must validate supported currencies.

---

# 17. Transaction Items

If transactions contain multiple services, use:

```text id="r8w2k5"
transaction_items
-----------------
id
transaction_id
service_id
quantity
unit_price
total_price
```

Relationship:

```text id="p5m9c3"
Transaction
    ↓
TransactionItem
    ↓
Service
```

This gives the system enough information for:

- Service analysis
- Cross-sell
- Revenue by service
- Customer service preferences

---

# 18. Transaction Integrity

The following must be true:

```text id="e7q1b5"
Transaction.customer_id
belongs to
Transaction.salon_id
```

and:

```text id="a6v3n9"
Transaction.visit_id
belongs to
Transaction.salon_id
```

Transaction history should be treated as durable business data.

Intelligence calculations must not modify historical transaction amounts.

---

# 19. Transaction Indexes

Recommended:

```text id="n2k6r8"
INDEX transactions_salon_id_transaction_date
INDEX transactions_salon_id_customer_id
INDEX transactions_customer_id_transaction_date
INDEX transactions_visit_id
```

These support:

- Revenue reporting
- Customer history
- Date-range queries
- Intelligence calculations

---

# 20. campaigns

Represents a customer communication campaign.

```text id="d4v8m2"
campaigns
---------
id
salon_id
name
type
message
status
created_by
created_at
updated_at
sent_at
```

Campaign types:

```text id="p7x1c5"
REACTIVATION
CUSTOMER_RETURN
CROSS_SELL
GENERAL_PROMOTION
```

---

# 21. Campaign Status

Initial lifecycle:

```text id="w9s3k6"
DRAFT
READY
SENDING
SENT
COMPLETED
FAILED
```

The exact lifecycle may evolve.

State transitions should be controlled by business logic.

Do not allow arbitrary status manipulation through a generic CRUD endpoint.

---

# 22. campaign_recipients

Represents a customer targeted by a campaign.

```text id="h6q2n8"
campaign_recipients
-------------------
id
campaign_id
customer_id
status
provider_message_id
sent_at
delivered_at
failed_at
created_at
```

Relationship:

```text id="r3v7m1"
Campaign
   ↓
CampaignRecipient
   ↓
Customer
```

---

# 23. Campaign Recipient Constraint

A customer should not accidentally appear multiple times in the same campaign unless explicitly supported.

Recommended:

```text id="t8c4y2"
UNIQUE(campaign_id, customer_id)
```

---

# 24. Campaign Indexes

Recommended:

```text id="m1x7q5"
INDEX campaigns_salon_id_created_at
INDEX campaigns_salon_id_status
INDEX campaign_recipients_campaign_id
INDEX campaign_recipients_customer_id
INDEX campaign_recipients_status
```

---

# 25. products

Represents beauty products tracked by the platform.

```text id="b9w4k1"
products
--------
id
name
brand
category
active
created_at
updated_at
```

Unlike salon services, products may eventually become platform-wide catalog entities.

Therefore `products` does not necessarily need `salon_id`.

This is an intentional distinction.

---

# 26. product_prices

Represents an observed price for a product.

```text id="q5n8v2"
product_prices
--------------
id
product_id
price
currency
source
observed_at
created_at
```

Relationship:

```text id="f8d3m6"
Product
   ↓
ProductPrice
```

---

# 27. Price History

Do not overwrite the previous price.

Incorrect:

```text id="u6r2p9"
Product.current_price = newPrice
```

as the only stored information.

Prefer:

```text id="c4m8x1"
Product
  ↓
Price 10.00
Price 10.50
Price 11.20
Price 12.00
```

This allows future analysis of:

- Price trends
- Market changes
- Supplier comparisons
- Historical procurement intelligence

---

# 28. Latest Price

The latest price is a derived query:

```text id="v2n7s5"
MAX(observed_at)
```

or an optimized read model later.

The historical `product_prices` table remains authoritative.

Do not duplicate `current_price` into `products` unless there is a demonstrated performance requirement.

---

# 29. Supplier Data

Supplier data is not part of the primary MVP customer-facing domain.

If supplier information is required internally, it may later be introduced as:

```text id="p8c5m2"
suppliers
supplier_products
supplier_prices
```

Do not prematurely build the complete marketplace schema.

The MVP requirement is:

> Product → Latest Market Price → Price History

not:

> Product → Marketplace → Supplier → Order → Payment

---

# 30. Intelligence Data

Customer intelligence is primarily derived from transactional data.

Possible derived values:

```text id="x7m3q9"
last_visit
visit_count
total_spend
average_transaction
average_return_interval
customer_status
retention_opportunity
```

These should initially be calculated by the intelligence layer.

Do not immediately persist every calculated value.

---

# 31. When to Persist Derived Data

Persist a derived value only when there is a clear reason, such as:

- Expensive repeated calculation
- Dashboard performance
- Historical snapshot requirement
- Search/filter performance
- Analytics requirement

Otherwise calculate it from source data.

This prevents duplicated sources of truth.

---

# 32. Opportunity Persistence

If the MVP requires opportunities to be displayed and tracked over time, an `opportunities` table may be introduced:

```text id="n6v2k8"
opportunities
-------------
id
salon_id
customer_id
type
reason
status
detected_at
expires_at
created_at
```

Possible types:

```text id="w4p9c1"
REACTIVATION
HIGH_VALUE_RETENTION
CROSS_SELL
CUSTOMER_RETURN
```

Possible statuses:

```text id="j8m3x6"
OPEN
ACTED
DISMISSED
EXPIRED
```

This table should only be introduced if the product needs opportunity lifecycle tracking.

---

# 33. Source of Truth

The source-of-truth hierarchy is:

```text id="s7q1m4"
Customer
Visit
Transaction
Service
Campaign
Product
ProductPrice
```

Derived:

```text id="p3v8n2"
Customer Status
Customer Metrics
Segments
Opportunities
Campaign Outcomes
```

The system must never allow derived data to silently contradict the underlying historical records.

---

# 34. Tenant Isolation Strategy

Every salon-owned table must contain:

```text id="k9x4m7"
salon_id
```

Examples:

```text id="e3w8q2"
customers.salon_id
services.salon_id
visits.salon_id
transactions.salon_id
campaigns.salon_id
opportunities.salon_id
```

Global catalog entities such as:

```text id="r5n1c8"
products
```

may intentionally not contain `salon_id`.

---

# 35. Query Rule

Every query involving salon-owned data must be tenant-aware.

Bad:

```text id="x1m7q4"
SELECT * FROM customers
WHERE id = :customerId;
```

Preferred:

```text id="k6v2n9"
SELECT *
FROM customers
WHERE id = :customerId
  AND salon_id = :salonId;
```

The application architecture should make tenant filtering difficult to forget.

---

# 36. Tenant Context

The backend should derive:

```text id="b8q3m5"
Authenticated User
       ↓
User.salon_id
       ↓
Tenant Context
       ↓
Business Operation
```

Do not trust:

```text id="r2c7v9"
request.salonId
```

as the authoritative tenant identity.

---

# 37. Foreign Keys

Use foreign keys for important relationships.

Examples:

```text id="m4x8q1"
users.salon_id → salons.id

customers.salon_id → salons.id

services.salon_id → salons.id

visits.salon_id → salons.id
visits.customer_id → customers.id

transactions.salon_id → salons.id
transactions.customer_id → customers.id
transactions.visit_id → visits.id

transaction_items.transaction_id → transactions.id
transaction_items.service_id → services.id

campaigns.salon_id → salons.id
campaigns.created_by → users.id

campaign_recipients.campaign_id → campaigns.id
campaign_recipients.customer_id → customers.id

product_prices.product_id → products.id
```

---

# 38. Cross-Tenant Foreign Key Problem

A normal foreign key does not necessarily guarantee that two referenced records belong to the same salon.

For example:

```text id="p1x6c8"
Visit.salon_id = Salon A
Visit.customer_id = Customer B
```

If Customer B belongs to Salon B, a simple foreign key may still technically pass.

The application must therefore enforce tenant consistency.

Where appropriate, composite constraints or database-level techniques may be introduced.

---

# 39. Soft Delete

Do not automatically add:

```text id="y5k8m2"
deleted_at
```

to every table.

For business records where historical integrity matters, prefer explicit lifecycle states or archival strategies.

For example:

```text id="c3v7q9"
Service.active
Product.active
Salon.status
```

Customer deletion should be treated carefully because historical transactions may depend on the customer.

---

# 40. Audit Fields

Business tables should generally include:

```text id="n8m4x2"
created_at
updated_at
```

Where useful, also record:

```text id="q6v1c9"
created_by
```

Sensitive business operations should have audit logging.

Do not build a massive audit framework before the MVP needs it.

---

# 41. IDs

Use a consistent ID strategy across the database.

The final implementation may use:

- UUID
- UUIDv7
- ULID
- Another sortable unique identifier

The important requirement is consistency.

Avoid mixing multiple unrelated ID strategies without a strong reason.

---

# 42. Naming Conventions

Use consistent relational naming.

Recommended:

```text id="v8x3m1"
snake_case
plural table names
singular domain concepts
```

Examples:

```text id="q1m7c5"
customers
transactions
campaign_recipients
product_prices
```

Foreign keys:

```text id="r4n8v2"
customer_id
salon_id
campaign_id
```

---

# 43. Timestamps

Store timestamps consistently.

Recommended fields:

```text id="m5q2x8"
created_at
updated_at
```

Business events may use:

```text id="c7v3n1"
visit_date
transaction_date
observed_at
sent_at
delivered_at
```

The application should define a consistent timezone strategy.

For an international-ready system, prefer storing timestamps in UTC and converting them for presentation.

---

# 44. Database Migrations

All schema changes must be versioned.

Never manually modify production schema without a migration.

Use the migration mechanism supported by the chosen backend stack.

Every migration should be:

- Reproducible
- Reviewable
- Ordered
- Safe to run in deployment

---

# 45. Indexing Principle

Indexes should be driven by real queries.

Common MVP query patterns include:

```text id="g2n6p8"
Customers by salon
Customer by phone within salon
Customer history
Transactions by salon/date
Transactions by customer/date
Campaigns by salon/date
Campaign recipients by campaign
Products by name/category
Product prices by product/date
```

Do not create indexes for every column.

---

# 46. Data Integrity Principle

Prefer enforcing business invariants as close to the data as reasonably possible.

Examples:

```text id="t9x4m6"
NOT NULL
UNIQUE
FOREIGN KEY
CHECK constraints
```

Application validation remains necessary, but the database should not be left completely defenseless.

---

# 47. Recommended MVP Relational Structure

Conceptually:

```text id="a4m8v2"
                         ┌──────────────┐
                         │    SALON     │
                         └──────┬───────┘
                                │
             ┌──────────────────┼──────────────────┐
             │                  │                  │
             ▼                  ▼                  ▼
          USERS             CUSTOMERS          SERVICES
                                │
                         ┌──────┴──────┐
                         │             │
                         ▼             ▼
                       VISITS     TRANSACTIONS
                         │             │
                         └──────┬──────┘
                                ▼
                         CUSTOMER INTELLIGENCE
                                │
                                ▼
                          OPPORTUNITIES
                                │
                                ▼
                           CAMPAIGNS
                                │
                                ▼
                      CAMPAIGN RECIPIENTS


             ┌──────────────┐
             │   PRODUCTS   │
             └──────┬───────┘
                    │
                    ▼
             PRODUCT_PRICES
```

---

# 47a. idempotency_records (Phase A)

Stores client retry keys for selected writes. Currently used by `POST /visits`.

```text
idempotency_records
-------------------
id
tenant_id
actor_id
operation
key
request_hash
resource_type
resource_id
created_at
```

UNIQUE (tenant_id, actor_id, operation, key)

Does not store request bodies, phones, or secrets. See `architecture/adr-001-visit-idempotency.md`.

---

# 48. MVP Database Does Not Need to Mirror the Entire Product Vision

The long-term product may eventually contain:

```text
Marketplace
Suppliers
Orders
Payments
Attribution
Rewards
Incentives
Advanced Analytics
```

The MVP database should not contain all of these.

The database should represent:

> **What the MVP actually needs today.**

Future domains can be introduced through future migrations.

---

# 49. Data Model Quality Gate

Before adding a table, verify:

1. What business concept does it represent?
2. Which domain owns it?
3. Is it source data or derived data?
4. Does it require `salon_id`?
5. What are its invariants?
6. What relationships does it have?
7. What queries will use it?
8. What indexes are actually needed?
9. Can the concept be represented more simply?
10. Is it truly required by MVP?

If these questions cannot be answered, do not add the table yet.

---

# 50. Final Data Model Principle

> **Keep source data trustworthy, derived intelligence replaceable, tenant boundaries strict, and the schema as small as possible.**

The MVP database should be boring, predictable, and reliable.

The intelligence should be where the product becomes valuable.
