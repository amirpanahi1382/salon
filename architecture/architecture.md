# Architecture

**Version:** 0.1
**Status:** MVP Architecture Definition
**Product:** Beauty Salon Revenue & Customer Intelligence Platform

---

# 1. Architecture Goal

The architecture must support the MVP without creating unnecessary technical complexity.

The primary goals are:

- Clear business boundaries
- Strict tenant isolation
- Maintainable code
- Testable business logic
- Reliable transactional data
- Replaceable intelligence algorithms
- Replaceable messaging providers
- Easy future expansion

The architecture should optimize for:

> **Business clarity and development speed first, scalability second.**

---

# 2. Architectural Style

The MVP should be implemented as a:

> **Modular Monolith**

The application is one deployable backend application, but internally organized into clear business modules.

Conceptually:

```text
                         BACKEND APPLICATION
                                │
        ┌───────────────────────┼────────────────────────┐
        │                       │                        │
        ▼                       ▼                        ▼
   Salon Module           Customer Module         Transaction Module
        │                       │                        │
        └───────────────────────┼────────────────────────┘
                                │
                                ▼
                      Intelligence Module
                                │
                                ▼
                         Campaign Module
                                │
                                ▼
                     Messaging Integration

                         Product Module
                                │
                                ▼
                      Price Intelligence
```

Do not split these modules into microservices during MVP.

---

# 3. Why Modular Monolith

The MVP has strong relationships between:

- Customers
- Visits
- Transactions
- Intelligence
- Campaigns

Splitting these into independent services too early would introduce unnecessary complexity:

- Network calls
- Distributed transactions
- Service discovery
- Deployment complexity
- Observability complexity
- Message consistency problems
- More infrastructure

The product has not yet proven that this complexity is necessary.

Therefore:

> **Modular boundaries first. Physical service boundaries later, if justified.**

---

# 4. High-Level Architecture

The backend should conceptually follow:

```text
                    CLIENT
                      │
                      ▼
                 API Layer
                      │
                      ▼
              Application Layer
                      │
                      ▼
                Domain Layer
                      │
                      ▼
             Infrastructure Layer
                      │
                      ▼
                  Database
```

External integrations should enter through explicit boundaries.

---

# 5. Layer Responsibilities

## API Layer

Responsible for:

- HTTP
- Request parsing
- Authentication integration
- Input validation
- Response mapping
- Error mapping

The API layer should not contain business rules.

Bad:

```text
Controller
    ↓
calculate retention
    ↓
decide customer status
    ↓
send SMS
```

Prefer:

```text
Controller
    ↓
Application Service
    ↓
Domain Logic
    ↓
Infrastructure
```

---

# 6. Application Layer

The Application Layer coordinates business use cases.

Examples:

```text
CreateCustomer
ImportCustomers
RecordVisit
RecordTransaction
CalculateCustomerOpportunities
CreateCampaign
SendCampaign
GetLatestProductPrice
```

Application services should orchestrate.

They should not become giant business-rule containers.

---

# 7. Domain Layer

The Domain Layer contains business concepts and rules.

Examples:

```text
Customer
Visit
Transaction
Campaign
Opportunity
RetentionRule
Product
ProductPrice
```

Business rules that define the product's behavior should live here whenever practical.

The domain should not depend directly on:

- HTTP
- Controllers
- Database frameworks
- Specific SMS vendors
- Specific UI frameworks

---

# 8. Infrastructure Layer

Infrastructure implements technical capabilities.

Examples:

```text
Database repositories
Messaging providers
Authentication persistence
File storage
Background job infrastructure
External APIs
```

Infrastructure should implement interfaces required by the application/domain layers.

---

# 9. Module Structure

Recommended conceptual backend modules:

```text
modules/
├── salon
├── user
├── customer
├── service
├── visit
├── transaction
├── intelligence
├── campaign
├── product
└── shared
```

The exact package naming may differ depending on the selected framework.

---

# 10. Customer Module

Responsibilities:

- Customer creation
- Customer update
- Customer lookup
- Customer search
- Customer import coordination
- Customer history retrieval

It owns customer identity.

It does not own:

- Retention algorithms
- Campaign sending
- Employee rewards

---

# 11. Transaction Module

Responsibilities:

- Record transactions
- Retrieve transaction history
- Validate transaction relationships
- Provide financial data to other modules

Transaction data is historical source data.

The Transaction module must not depend on the Intelligence module.

Instead:

```text
Transaction
     ↓
Business Event
     ↓
Intelligence
```

---

# 12. Intelligence Module

This is the primary product intelligence module.

Responsibilities:

- Customer behavior analysis
- Retention analysis
- Customer segmentation
- Opportunity detection
- Recommended actions

Conceptual structure:

```text
intelligence/
├── behavior
├── retention
├── segmentation
├── opportunity
└── application
```

The module should consume customer/visit/transaction information without owning those source records.

---

# 13. Intelligence Architecture

Use a pipeline:

```text
Source Data
    ↓
Behavior Calculation
    ↓
Retention Analysis
    ↓
Opportunity Detection
    ↓
Recommended Action
```

Example:

```text
Transaction History
       ↓
Customer Behavior
       ↓
Expected Return Interval
       ↓
Customer Overdue
       ↓
Reactivation Opportunity
```

---

# 14. Retention Abstraction

Retention logic must be replaceable.

Conceptually:

```text
RetentionAnalyzer
```

Possible implementations:

```text
RuleBasedRetentionAnalyzer
FuturePredictiveRetentionAnalyzer
```

The MVP should use:

> `RuleBasedRetentionAnalyzer`

The rest of the application should not depend on the algorithm's implementation details.

---

# 15. Campaign Module

Responsibilities:

- Campaign creation
- Audience selection
- Campaign lifecycle
- Recipient management
- Sending coordination
- Campaign result tracking

The Campaign module should consume opportunities.

Example:

```text
Opportunity
     ↓
Campaign
```

The Campaign module should not calculate whether a customer is at risk.

---

# 16. Messaging Boundary

Messaging is an external capability.

Define an abstraction such as:

```text
MessagingProvider
```

Example:

```text
interface MessagingProvider {
    send(message);
}
```

Possible future implementations:

```text
SmsMessagingProvider
WhatsAppMessagingProvider
EmailMessagingProvider
```

The Campaign module should depend on the abstraction.

It should not contain provider-specific HTTP logic.

---

# 17. Product Module

The Product module manages the platform's beauty-product catalog.

Responsibilities:

- Product lookup
- Product search
- Product categories
- Product status

The initial catalog may be platform-wide.

It does not represent salon services.

Important distinction:

```text
Service
→ Something the salon sells to customers

Product
→ Something the salon may purchase/use
```

---

# 18. Price Intelligence Module

Responsibilities:

- Store price observations
- Retrieve latest price
- Retrieve price history
- Search product prices

Conceptually:

```text
Product
    ↓
Price Observations
    ↓
Latest Market Price
```

The module should not become a marketplace module in MVP.

---

# 19. Future Marketplace Boundary

Future marketplace capabilities should be isolated:

```text
marketplace/
├── supplier
├── supplier-product
├── ordering
└── marketplace-transaction
```

This module does not exist as a primary MVP capability.

The current Product/Price Intelligence module should not depend on it.

---

# 20. Future Attribution Boundary

Attribution and incentives are future domains.

When eventually introduced:

```text
attribution/
├── customer-acquisition
├── attribution
└── revenue-attribution

incentive/
├── incentive-rule
├── reward
└── payout
```

The MVP architecture must not depend on these modules.

---

# 21. Dependency Direction

Dependencies should generally point inward toward business logic.

Conceptually:

```text
API
 ↓
Application
 ↓
Domain
 ↑
Infrastructure
```

Infrastructure implements interfaces required by inner layers.

Avoid:

```text
Domain
 ↓
HTTP Client
 ↓
SMS Vendor
```

The domain should remain independent from technical providers.

---

# 22. Module Communication

Prefer explicit application-level contracts.

Example:

```text
Transaction Module
        ↓
TransactionCompleted
        ↓
Intelligence Module
```

and:

```text
Intelligence Module
        ↓
Opportunity
        ↓
Campaign Module
```

Avoid direct access to another module's repositories.

Bad:

```text
CampaignService
    ↓
CustomerRepository
```

when the Customer module owns that repository.

Prefer a customer-facing application/query interface.

---

# 23. Module Ownership

Each module owns its business data and rules.

Example:

```text
Customer Module
→ Customer

Transaction Module
→ Transaction

Intelligence Module
→ Opportunity

Campaign Module
→ Campaign

Product Module
→ Product

Price Intelligence
→ ProductPrice
```

No module should casually modify another module's entities.

---

# 24. Shared Module

A small `shared` module may contain genuinely cross-cutting concepts.

Examples:

```text
Money
Currency
DomainEvent
TenantContext
PageRequest
PageResult
Common exceptions
```

Do not turn `shared` into a dumping ground.

If a class belongs to one business domain, keep it in that domain.

---

# 25. Tenant Context

Tenant context should be established early in the request lifecycle.

Conceptually:

```text
Authentication
      ↓
Authenticated User
      ↓
User.salonId
      ↓
TenantContext
      ↓
Application Service
      ↓
Repository
```

Every salon-owned operation must operate within this context.

---

# 26. Tenant Isolation Architecture

Tenant isolation must exist at multiple levels:

```text
HTTP
 ↓
Authentication
 ↓
Authorization
 ↓
Tenant Context
 ↓
Application Layer
 ↓
Repository
 ↓
Database
```

Do not rely exclusively on frontend filtering.

Do not rely exclusively on a developer remembering to add `salon_id` to every query.

The architecture should make tenant isolation systematic.

---

# 27. Authentication

Authentication is responsible for answering:

> Who is this user?

Authorization answers:

> What is this user allowed to do?

Tenant isolation answers:

> Which salon's data may this user access?

These are related but distinct concerns.

Conceptually:

```text
Authentication
    ↓
User Identity
    ↓
Role
    ↓
Salon/Tenant
    ↓
Authorization
```

---

# 28. API Design

APIs should represent business capabilities.

Prefer:

```text
GET /customers/{id}
GET /customers/{id}/history
GET /intelligence/opportunities
POST /campaigns
POST /campaigns/{id}/send
GET /products/{id}/prices
```

Avoid designing the entire API around database CRUD merely because tables exist.

---

# 29. API Rules

Every API should consider:

- Authentication
- Authorization
- Tenant isolation
- Input validation
- Consistent error responses
- Idempotency where appropriate
- Pagination
- Filtering
- Sorting
- Rate limiting where necessary

Do not expose internal database models directly as API contracts.

---

# 30. DTO Boundary

Use API-specific request/response models.

Avoid exposing persistence entities directly through controllers.

Conceptually:

```text
HTTP Request
    ↓
Request DTO
    ↓
Application Command
    ↓
Domain
    ↓
Result
    ↓
Response DTO
    ↓
HTTP Response
```

This protects the domain from API coupling.

---

# 31. Database Access

Repositories belong close to the module that owns the data.

Example:

```text
customer/
    CustomerRepository

transaction/
    TransactionRepository

campaign/
    CampaignRepository
```

Do not create one giant:

```text
DatabaseService
```

that all modules use.

---

# 32. Transactions

Database transactions should be used around business operations that require atomicity.

Example:

```text
Record Transaction
    ↓
Validate
    ↓
Persist Transaction
    ↓
Commit
```

If related operations must succeed or fail together, they should participate in the same transaction where appropriate.

Do not hold database transactions open during slow external network calls.

---

# 33. External Calls

External providers should be isolated.

Examples:

```text
Messaging Provider
Price Data Provider
Future Supplier APIs
```

Use interfaces/adapters.

Conceptually:

```text
Application
    ↓
Port / Interface
    ↓
Adapter
    ↓
External System
```

This makes testing easier and vendor changes safer.

---

# 34. Background Processing

Use asynchronous processing for operations that should not block normal API requests.

Examples:

```text
Large Customer Import
Intelligence Recalculation
Campaign Sending
Message Status Processing
Price Data Updates
```

Conceptually:

```text
API
 ↓
Create Job
 ↓
Queue
 ↓
Worker
 ↓
Business Operation
```

The MVP can use a simple reliable job mechanism.

Do not introduce Kafka merely because the long-term architecture may eventually use event streaming.

---

# 35. Event Strategy

Events should be introduced when they solve a real decoupling or processing problem.

Useful events:

```text
CustomerCreated
CustomerImported
VisitCompleted
TransactionCompleted
CampaignSent
MessageDelivered
CustomerReturned
ProductPriceUpdated
```

Events represent facts.

They should not be used as an excuse to turn every method call into asynchronous processing.

---

# 36. Intelligence Processing

Intelligence can initially run synchronously for small operations or asynchronously for larger calculations.

Example:

```text
TransactionCompleted
       ↓
Mark customer behavior as affected
       ↓
Background intelligence calculation
       ↓
Opportunity updated
```

The system should prioritize correctness over immediate recalculation.

---

# 37. Caching

Caching is not a primary MVP requirement.

Do not introduce caching everywhere.

Potential future cache candidates:

```text
Product catalog
Latest product prices
Dashboard aggregates
Frequently requested customer segments
```

Only add caching after measuring an actual performance need.

---

# 38. Observability

The MVP should provide enough visibility to diagnose failures.

Minimum:

- Structured logs
- Request correlation ID
- Error logging
- Background job status
- External provider failure logging
- Basic application metrics

Important business operations should be traceable.

Examples:

```text
CustomerImportStarted
CustomerImportCompleted
CampaignSendStarted
CampaignSendCompleted
IntelligenceCalculationFailed
```

---

# 39. Auditability

Audit sensitive business operations.

Examples:

```text
Customer data import
Campaign creation
Campaign sending
Transaction modification
User/role changes
```

Audit records should answer:

```text
Who?
What?
When?
Which salon?
```

Do not build a complex compliance platform during MVP.

---

# 40. Error Handling

Errors should be categorized.

Examples:

```text
Validation Error
Authentication Error
Authorization Error
Tenant Access Error
Business Rule Error
Not Found
External Provider Error
Internal Error
```

API responses should not expose internal stack traces or implementation details.

---

# 41. Idempotency

Operations that may be retried must be designed carefully.

Important examples:

```text
Customer Import
Transaction Creation
Campaign Sending
Message Delivery Processing
```

For example, retrying a message job must not accidentally send the same message multiple times when the provider supports idempotency.

---

# 42. Import Architecture

Customer import should follow:

```text
Upload
  ↓
Parse
  ↓
Validate
  ↓
Preview / Report Errors
  ↓
Persist
  ↓
Recalculate Relevant Intelligence
```

Do not import thousands of rows inside a single long-running HTTP request if the data size makes that unreliable.

---

# 43. Frontend Architecture

The frontend should be organized around business workflows.

Primary areas:

```text
Dashboard
Customers
Intelligence
Campaigns
Products
Settings
```

The UI should not be designed as a direct representation of database tables.

Example:

Bad:

```text
Transaction CRUD Screen
```

Better:

```text
Customer Revenue History
```

The interface should help the salon accomplish business tasks.

---

# 44. Dashboard Architecture

The dashboard should consume business-oriented read models or queries.

Example:

```text
Dashboard
├── Revenue Summary
├── Customer Summary
├── At-Risk Customers
├── Reactivation Opportunities
└── Recommended Actions
```

The dashboard should not perform complex business calculations inside frontend code.

Business calculations belong to the backend/domain.

---

# 45. Security Boundary

Never trust:

- Client-provided salon IDs
- Client-provided user roles
- Client-provided permissions
- Client-provided ownership claims

The backend is authoritative.

Example:

```text
Request
 ↓
Authenticated User
 ↓
Backend determines salon
 ↓
Authorization
 ↓
Business operation
```

---

# 46. Data Flow — Core Product

The main product flow should look like:

```text
                 CUSTOMER DATA
                      │
                      ▼
                Customer Module
                      │
                      ▼
             Visits / Transactions
                      │
                      ▼
             Intelligence Module
                      │
             ┌────────┴────────┐
             ▼                 ▼
        Customer Status    Opportunity
                               │
                               ▼
                         Campaign Module
                               │
                               ▼
                       Messaging Provider
                               │
                               ▼
                       Customer Response
                               │
                               ▼
                         New Transaction
                               │
                               └──────→ Intelligence
```

This creates the product feedback loop.

---

# 47. Data Flow — Price Intelligence

```text
Product Catalog
      ↓
Price Observations
      ↓
Price Intelligence
      ↓
Latest Price
      ↓
Salon User
```

Future:

```text
Supplier
   ↓
Supplier Product
   ↓
Market Price
   ↓
Marketplace
```

But this future flow is not part of MVP.

---

# 48. Deployment Architecture

MVP deployment should remain simple.

Conceptually:

```text
                    Internet
                       │
                       ▼
                Load Balancer /
                Reverse Proxy
                       │
                       ▼
                Backend Application
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
         PostgreSQL          Job Worker
                                 │
                                 ▼
                         External Providers
```

The exact infrastructure provider is not part of this document.

---

# 49. Scaling Strategy

Scale only when evidence requires it.

Initial scaling options:

```text
Vertical scaling
       ↓
Application replicas
       ↓
Background workers
       ↓
Database optimization
       ↓
Caching
       ↓
Read models
```

Only later consider:

```text
Service extraction
Database partitioning
Sharding
Distributed event streaming
```

---

# 50. When to Extract a Microservice

A module should become a separate service only when there is a concrete reason.

Possible reasons:

- Independent scaling requirement
- Independent deployment requirement
- Strong organizational ownership
- Infrastructure isolation requirement
- Significant workload difference
- Clear domain boundary
- Operational benefit

Do not extract a service because:

> "This could theoretically be a microservice."

---

# 51. Future Architecture Evolution

The intended path is:

```text
Phase 1
Modular Monolith
        ↓
Phase 2
Stronger Module Boundaries
        ↓
Phase 3
Independent Workers / Async Processing
        ↓
Phase 4
Selective Service Extraction
```

The architecture should evolve based on real system behavior.

---

# 52. Technology Independence

Business logic should not become tightly coupled to a particular:

- Database
- Messaging provider
- Cloud provider
- AI provider
- Analytics provider

Technology choices should be replaceable where the cost/benefit justifies abstraction.

Do not abstract everything.

Abstract things that are:

- External
- Volatile
- Expensive to replace
- Business-critical

---

# 53. Avoid Premature Abstraction

Do not create abstractions merely because two classes look similar.

Avoid:

```text
GenericBusinessService<T>
GenericRepository<T>
AbstractBaseManager
UniversalProcessor
```

unless there is a real repeated business concept.

Prefer explicit business code over artificial generic frameworks.

---

# 54. Testing Architecture

Testing should follow the business boundaries.

### Domain Tests

Test:

- Retention rules
- Customer segmentation
- Opportunity detection
- Campaign state transitions
- Money rules

### Application Tests

Test:

- Use cases
- Authorization
- Tenant context
- Transaction boundaries

### Integration Tests

Test:

- Database
- Messaging adapters
- Imports
- External integrations

### End-to-End Tests

Test critical business flows:

```text
Import Customers
     ↓
Generate Opportunity
     ↓
Create Campaign
     ↓
Send Campaign
     ↓
Record Customer Return
```

---

# 55. Architecture Quality Gates

Before implementing a new feature, verify:

1. Which module owns it?
2. What business capability does it represent?
3. Which data is authoritative?
4. Does it cross a module boundary?
5. Does it require an interface?
6. Does it require an event?
7. Does it require asynchronous processing?
8. Does it affect tenant isolation?
9. Does it affect authorization?
10. Can it be implemented more simply?

---

# 56. MVP Architecture Rules

The following are mandatory principles:

```text
1. Modular Monolith
2. Strict Tenant Isolation
3. Business Logic outside Controllers
4. Domain ownership must be explicit
5. Source data remains authoritative
6. Derived intelligence remains replaceable
7. External providers behind adapters
8. No premature microservices
9. No premature AI infrastructure
10. No unnecessary distributed systems
```

---

# 57. Architecture Anti-Patterns

Avoid:

```text
God Service
God Controller
God Entity
Generic Everything
Database-driven architecture
Frontend business logic
Cross-module repository access
Hidden tenant assumptions
Direct vendor coupling
Premature microservices
Premature Kafka
Premature ML infrastructure
```

---

# 58. Final Architecture Principle

> **The architecture exists to protect the business model, not to demonstrate technical sophistication.**

For MVP:

```text
Business Clarity
      ↓
Domain Boundaries
      ↓
Modular Architecture
      ↓
Reliable Data
      ↓
Simple Infrastructure
      ↓
Measured Outcomes
```

Build the simplest architecture that can reliably support the Revenue Intelligence Core.

When real product usage proves that more complexity is necessary, evolve the architecture deliberately.
