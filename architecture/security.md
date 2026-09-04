# Security Architecture

## 1. Purpose

This document defines the security model for the beauty salon revenue and customer intelligence platform.

The goal is to protect:

- Salon data
- Customer personal information
- Authentication credentials
- Business and revenue data
- Campaign and messaging operations
- Product price intelligence
- Administrative capabilities
- Tenant boundaries

Security must be implemented as part of the domain and application architecture, not added as a final technical layer.

The MVP should be secure by default while remaining simple enough to develop, test, operate, and maintain.

---

# 2. Security Principles

The system follows these principles:

1. Every request must be authenticated when authentication is required.
2. Every authenticated request must be authorized.
3. A user can only access data belonging to their salon unless explicitly authorized as a platform administrator.
4. The server must never trust a client-provided `salonId` for authorization.
5. Authentication and authorization are separate concerns.
6. Business rules must not be bypassed by calling lower-level APIs directly.
7. Sensitive operations must be auditable.
8. Secrets must never be stored in source code or logs.
9. Customer personal information must be minimized in logs and responses.
10. Security failures must fail closed.
11. Background jobs must preserve tenant context.
12. Security-sensitive business operations must be tested explicitly.
13. Security architecture must remain simple enough for the MVP.
14. Future security capabilities must be extendable without rewriting the core domain.

---

# 3. Security Scope

The MVP security scope includes:

- Authentication
- Authorization
- Role-based access
- Tenant isolation
- Password security
- Session/token security
- API security
- Input validation
- Sensitive-data protection
- Messaging consent and opt-out
- Import security
- Audit logging
- Rate limiting for sensitive endpoints
- Secure error handling
- Background-job isolation
- Administrative access control
- Security testing

The MVP does not include:

- A standalone identity provider
- Complex policy engines
- Fine-grained attribute-based access control
- Employee commission security
- Incentive/reward security workflows
- Marketplace payment security
- Supplier ordering security
- Distributed authorization services
- Multi-region security infrastructure

Those may be introduced later if the product requires them.

---

# 4. Threat Model

The system should primarily defend against:

## 4.1 Cross-Tenant Access

A user from Salon A must never be able to access:

- Customers of Salon B
- Visits of Salon B
- Transactions of Salon B
- Campaigns of Salon B
- Salon B users
- Salon B operational data

This is one of the highest-priority security requirements.

---

## 4.2 Unauthorized Business Operations

A user must not perform operations beyond their role.

Examples:

- Staff must not manage salon users.
- Staff must not change owner-level settings.
- Unauthorized users must not send campaigns.
- Unauthorized users must not modify product prices.
- A normal salon user must never modify platform-level product data.

---

## 4.3 Credential Attacks

The system must protect against:

- Password guessing
- Credential stuffing
- Brute-force login attempts
- Password leakage
- Session/token theft

---

## 4.4 Customer Data Exposure

Customer names and phone numbers are personal information.

The system must prevent unnecessary exposure through:

- Logs
- Error messages
- Debug output
- URLs where avoidable
- Unauthorized APIs
- Client-side storage where avoidable

---

## 4.5 Malicious Imports

Customer import functionality accepts files from salon users.

Potential threats include:

- Oversized files
- Unexpected file formats
- Malformed data
- Formula injection in exported spreadsheets
- Unexpected values
- Duplicate records
- Resource exhaustion

Imports must therefore be validated before data is committed.

---

## 4.6 Messaging Abuse

Campaign functionality can trigger external communication.

The system must prevent:

- Unauthorized campaign sending
- Sending to opted-out customers
- Accidental mass sending
- Repeated campaign execution
- Unauthorized modification of campaign recipients

---

# 5. Authentication

Authentication establishes who the user is.

The authentication implementation must be isolated behind an application-level abstraction so that the domain does not depend directly on a specific authentication technology.

The application may initially use a standard email/password authentication flow or another simple credential-based mechanism selected during implementation.

The exact authentication mechanism is an implementation decision and must not leak into domain objects.

Conceptually:

```text
Authentication
      |
      v
Authenticated Principal
      |
      +-- userId
      +-- salonId
      +-- role
      |
      v
Authorization
```

Authentication must establish the user's identity and tenant context.

---

# 6. Password Security

Passwords must never be stored in plaintext.

Passwords must be hashed using a modern password hashing algorithm supported by the chosen security framework.

Recommended approach:

- Argon2id when operationally practical
- BCrypt as a simple and mature alternative

The system must never:

- Log passwords
- Return password hashes through APIs
- Store plaintext passwords
- Include passwords in exceptions
- Include passwords in audit events

Password reset tokens must be:

- Random
- Short-lived
- Single-use
- Stored securely
- Invalidated after successful use

---

# 7. Authentication Session / Token Security

The implementation may use secure server-side sessions or secure tokens depending on the final frontend architecture.

The security requirements remain the same.

Authentication credentials must:

- Have an expiration policy
- Be revocable where practical
- Be transmitted only over HTTPS
- Never appear in logs
- Never be exposed in normal API responses
- Not be stored in unsafe browser storage when a safer mechanism is available

For a browser-based application, secure HTTP-only cookies are preferred when compatible with the selected architecture.

If token-based authentication is used:

- Access tokens should be short-lived.
- Token signing keys must be stored securely.
- Token validation must verify signature, expiration, issuer, and relevant claims.
- Refresh-token handling must be explicitly secured.
- Tokens must not contain unnecessary personal information.

---

# 8. Authenticated Principal

After authentication, the application should work with a trusted authenticated principal.

Conceptually:

```java
AuthenticatedUser {
    UserId userId;
    SalonId salonId;
    Role role;
}
```

The principal is created by the security layer.

Application services should receive trusted identity information from the authenticated context rather than accepting arbitrary tenant information from request payloads.

---

# 9. Tenant Isolation

Tenant isolation is a mandatory security boundary.

A salon represents a tenant.

Every salon-owned resource must be associated with a salon.

Examples:

```text
Customer -> Salon
Visit -> Salon
Transaction -> Salon
Campaign -> Salon
CampaignRecipient -> Salon
User -> Salon
```

The server must derive the current salon from the authenticated principal.

The client must not be trusted to define the active tenant.

Bad:

```http
GET /customers?salonId=123
```

where `123` is treated as authorization.

Correct conceptual flow:

```text
Request
   |
   v
Authentication
   |
   v
AuthenticatedUser.salonId
   |
   v
Application Service
   |
   v
Tenant-scoped repository query
```

---

# 10. Tenant Isolation at Repository Level

Tenant filtering must happen consistently at the data-access boundary.

For example, customer lookup should conceptually behave like:

```text
findCustomer(customerId, currentSalonId)
```

rather than:

```text
findCustomer(customerId)
```

This prevents an object identifier from becoming a cross-tenant access vulnerability.

Repositories must never silently return another tenant's record.

If a requested resource does not belong to the current salon, the application should normally behave as though the resource does not exist rather than revealing that another tenant owns it.

---

# 11. Cross-Tenant Relationship Validation

Tenant isolation must also apply to relationships.

Example:

A transaction belonging to Salon A must not reference a customer belonging to Salon B.

Before creating or modifying relationships, the application must verify ownership.

Examples:

```text
Transaction.salonId == Customer.salonId
Visit.salonId == Customer.salonId
Campaign.salonId == Customer.salonId
CampaignRecipient.salonId == Customer.salonId
```

Database constraints and application-level validation should work together.

---

# 12. Roles

The MVP uses three salon roles:

- `OWNER`
- `MANAGER`
- `STAFF`

Roles should remain simple.

The system should not introduce a complex permission framework until the product demonstrates a real need for it.

---

# 13. Owner

The owner has full control over the salon.

Typical capabilities:

- Manage salon profile
- Manage users
- Manage roles
- Manage customers
- Import customers
- Manage services
- Record visits
- Record transactions
- View intelligence
- Manage campaigns
- Send campaigns
- View campaign outcomes
- View product price intelligence
- Perform owner-level configuration

Owner-only actions should be explicitly protected.

---

# 14. Manager

The manager can perform operational and analytical work required to run the salon.

Typical capabilities:

- Manage customers
- Import customer data
- View customer history
- Record visits
- Record transactions
- View intelligence
- Review opportunities
- Create campaigns
- Send campaigns when permitted by product policy
- View campaign results
- View product price intelligence

Manager access to user administration should be explicitly defined and should not automatically equal owner access.

---

# 15. Staff

Staff access should follow least privilege.

Typical capabilities:

- View authorized customers
- Add customer records
- Record completed visits
- Record transactions
- View relevant customer history
- Use permitted operational features

Staff should not automatically be allowed to:

- Manage users
- Change owner-level settings
- Access another salon
- Change security configuration
- Access platform administration
- Modify global product price data
- Perform administrative operations

The exact staff permission set may evolve as real salon workflows are validated.

---

# 16. Authorization Model

Authorization occurs after authentication.

Every protected use case should answer:

1. Who is the user?
2. Which salon does the user belong to?
3. What role does the user have?
4. What business operation are they attempting?
5. Are they allowed to perform that operation?
6. Does the target resource belong to their salon?

Authorization should be enforced at the application/use-case boundary.

Example:

```text
Controller
   |
   v
Application Service
   |
   +-- authenticated user
   +-- salon context
   +-- role/permission check
   +-- resource ownership check
   |
   v
Domain operation
```

Controllers should not be the only place where authorization exists.

---

# 17. Resource Ownership

Every salon-owned resource must be checked against the authenticated salon.

For example:

```text
GET /customers/{id}
```

must not simply check whether the customer exists.

It must check:

```text
customer.salonId == authenticatedUser.salonId
```

The same rule applies to:

- Customers
- Visits
- Transactions
- Campaigns
- Campaign recipients
- Salon users
- Other tenant-owned resources

---

# 18. Platform-Level Data

Product price intelligence may contain platform-wide product data.

This is different from salon-owned data.

For example:

```text
Product
    |
    +-- platform-level catalog

ProductPrice
    |
    +-- platform-level price observation
```

Normal salon users may read permitted product price information.

Only authorized platform administrators or trusted internal processes may modify global product catalog or price data.

Salon users must never be able to create or modify platform-wide prices simply by manipulating an API request.

---

# 19. API Security

All protected APIs must require authentication.

APIs must:

- Validate authentication
- Validate authorization
- Validate request input
- Enforce tenant isolation
- Validate resource ownership
- Return appropriate HTTP status codes
- Avoid leaking internal implementation details
- Avoid exposing persistence entities directly

Business capability APIs are preferred over generic unrestricted CRUD APIs.

---

# 20. Input Validation

All external input must be validated.

Examples include:

- Names
- Phone numbers
- Amounts
- Dates
- Service identifiers
- Customer identifiers
- Campaign content
- Product identifiers
- Import files

Validation must happen at the API boundary and important business invariants must also be protected inside the application/domain layer.

Never assume that frontend validation is sufficient.

---

# 21. Output Security

API responses must contain only information the authenticated user is allowed to see.

Avoid returning:

- Password hashes
- Internal security information
- Secrets
- Internal stack traces
- Database implementation details
- Unnecessary customer information
- Internal administrative metadata

DTOs should define the public API contract.

Persistence entities must not be returned directly from controllers.

---

# 22. Error Handling

Security-sensitive errors should not reveal unnecessary information.

For example, authentication failures should not disclose whether a specific account exists when doing so would enable account enumeration.

Production errors should not expose:

- Stack traces
- SQL statements
- Internal class names
- Database credentials
- Tokens
- Password information
- Internal infrastructure details

Errors should use a consistent API error format.

---

# 23. Customer Personal Data

Customer information is sensitive business data.

The MVP currently stores information such as:

- Name
- Phone number
- Visit history
- Transaction history
- Service history
- Campaign interaction

Access should be limited to authorized salon users.

The system should follow data minimization:

Store what is necessary to provide the product.

Do not collect personal information simply because it might be useful later.

---

# 24. Logging

Logs must support troubleshooting without becoming a source of data leakage.

Never log:

- Passwords
- Authentication tokens
- Session identifiers
- API secrets
- Database credentials
- Full sensitive customer information unnecessarily

Phone numbers and other customer identifiers should be masked or omitted where possible.

Example:

```text
Good:
Customer imported successfully
customerId=...
salonId=...

Avoid:
Imported customer Amir Haghverdi, phone=...
```

Structured logging should be preferred over concatenated free-form strings.

---

# 25. Audit Logging

Audit logs should capture security-sensitive and business-sensitive actions.

Examples:

- User created
- User role changed
- Customer imported
- Large customer import completed
- Campaign created
- Campaign sent
- Campaign sending failed
- Sensitive salon settings changed
- Product price updated by an authorized administrator

Audit records should contain enough context to answer:

```text
Who?
What?
When?
Which salon?
Which resource?
What happened?
```

Audit logs should be append-oriented and protected from normal user modification.

---

# 26. Messaging Consent

Campaign functionality must respect customer communication preferences.

The system must support an opt-out concept before sending messages.

Before sending a campaign:

```text
Campaign Audience
        |
        v
Consent / Opt-out Check
        |
        +---- opted out ---> exclude
        |
        +---- allowed -----> send
```

A customer who has opted out must not receive marketing communication through the corresponding channel.

Consent and opt-out status must be treated as business rules, not merely frontend filters.

---

# 27. Campaign Authorization

Sending a campaign is a high-impact action because it can:

- Contact many customers
- Generate external costs
- Affect salon reputation
- Trigger customer complaints

Therefore campaign sending must require explicit authorization.

The application should verify:

- User is authenticated
- User belongs to the campaign's salon
- User has permission to send campaigns
- Campaign belongs to the same salon
- Recipients belong to the same salon
- Recipients are eligible
- Opt-outs are respected
- Campaign has not already been sent when duplicate sending is not allowed

---

# 28. Campaign Idempotency

Campaign sending must protect against accidental duplicate execution.

For example, a double-click or retry must not unintentionally send the same campaign twice.

The sending operation should have an idempotency strategy.

Possible mechanisms include:

- Campaign status transitions
- Unique send operation identifiers
- Recipient-level send state
- Provider message identifiers

The simplest valid mechanism should be used for the MVP.

---

# 29. Import Security

Customer import files must be treated as untrusted input.

The import system must:

- Restrict accepted file types
- Enforce maximum file size
- Validate file structure
- Validate row values
- Reject malformed records safely
- Prevent excessive memory consumption
- Detect duplicates
- Validate phone numbers
- Validate required fields
- Produce a safe import report

Import data should be validated before committing large amounts of data.

Large imports may be processed asynchronously.

---

# 30. Spreadsheet Formula Injection

If imported customer data is later exported to CSV or spreadsheet formats, user-controlled values must be handled carefully.

Values beginning with spreadsheet formula characters must not be allowed to become executable formulas when opened in spreadsheet software.

Exports should treat user-controlled values as data.

---

# 31. Rate Limiting

Rate limiting should be applied to security-sensitive operations.

At minimum:

- Login
- Password reset requests
- Campaign sending where appropriate
- Large imports
- Other expensive public endpoints

The MVP does not require a distributed rate-limiting platform.

A simple application or infrastructure-level mechanism is sufficient initially.

The implementation should remain replaceable.

---

# 32. HTTPS

Production traffic must use HTTPS.

Sensitive data must never be transmitted over unencrypted HTTP in production.

HTTP should either be disabled or redirected securely at the infrastructure layer.

---

# 33. Secrets Management

Secrets must never be committed to source control.

Examples:

- Database passwords
- JWT signing keys
- Session secrets
- SMS provider credentials
- Email provider credentials
- External API keys

Secrets should be supplied through secure environment configuration or an appropriate secret-management mechanism.

Local development may use environment variables or ignored configuration files.

---

# 34. Database Security

The application database user should have only the permissions required by the application.

The application should not run using a database superuser.

Database credentials must not be exposed to frontend applications.

Production databases should not be publicly accessible unless required by infrastructure design.

Database backups must be protected because they contain tenant and customer data.

---

# 35. Background Jobs

Background jobs must preserve security context.

Examples:

- Customer import processing
- Intelligence calculation
- Campaign sending
- Message delivery processing
- Product price updates

A background job must never accidentally execute without knowing which tenant or authorized system process owns the work.

Jobs should carry explicit context such as:

```text
jobId
salonId
operation
requestedBy
```

Platform-wide jobs, such as product price synchronization, are different from salon-owned jobs and must have explicit authorization boundaries.

---

# 36. Intelligence Security

Customer intelligence is derived from salon-owned data.

Examples:

- Customer status
- At-risk classification
- Total spend
- Visit frequency
- Reactivation opportunity

Intelligence must never cross tenant boundaries.

For example:

```text
Salon A intelligence
        X
Salon B customer data
```

The intelligence engine must receive tenant-scoped data.

Derived data must not become a backdoor into another tenant's source data.

---

# 37. Product Price Intelligence Security

Product price data may be platform-wide.

Salon users may read permitted price information.

Administrative price updates must be protected.

A salon user must not be able to:

- Modify a global product
- Modify historical prices
- Create fake market prices
- Delete platform price history

The system should preserve price history rather than allowing users to overwrite historical observations.

---

# 38. Frontend Security

The frontend must never be considered a trusted security boundary.

Frontend checks are for user experience.

Backend checks are authoritative.

For example:

```text
Frontend:
"Hide Send Campaign button for STAFF"

Backend:
"STAFF cannot execute SendCampaign"
```

Both are useful, but only the backend protects the system.

---

# 39. Authorization Must Follow Business Capabilities

Security should be attached to business operations rather than only database operations.

Examples:

```text
CreateCustomer
ImportCustomers
RecordVisit
RecordTransaction
CreateCampaign
SendCampaign
GetCustomerIntelligence
UpdateProductPrice
```

Each use case should have a clear authorization policy.

This makes the system easier to reason about than a collection of unrestricted CRUD endpoints.

---

# 40. Security Testing

Security-critical behavior must have automated tests.

At minimum, tests must verify:

## Authentication

- Invalid credentials are rejected.
- Expired authentication is rejected.
- Unauthenticated users cannot access protected APIs.

## Authorization

- STAFF cannot execute owner-only operations.
- Unauthorized users cannot send campaigns.
- Unauthorized users cannot modify global product prices.

## Tenant Isolation

A user from Salon A must not be able to:

- Read Salon B customers
- Read Salon B transactions
- Modify Salon B customers
- Read Salon B campaigns
- Send Salon B campaigns
- Access Salon B users

These tests are mandatory.

## Campaign Security

Tests must verify:

- Opted-out customers are excluded.
- Unauthorized users cannot send.
- Duplicate sending is prevented according to campaign state.
- Campaign recipients belong to the correct salon.

## Import Security

Tests must verify:

- Oversized files are rejected.
- Invalid formats are rejected.
- Invalid rows do not corrupt valid data.
- Malformed input cannot bypass tenant boundaries.

---

# 41. Security and Transactions

Security-sensitive operations should use appropriate database transactions.

For example:

```text
Create Campaign
    |
    +-- validate authorization
    +-- validate salon ownership
    +-- create campaign
    +-- create recipient records
    |
    v
Commit
```

Slow external calls such as SMS delivery should not hold database transactions open unnecessarily.

The application should separate:

```text
Database state transition
```

from:

```text
External provider communication
```

---

# 42. Security and Events

Events must not leak sensitive information unnecessarily.

Prefer:

```text
TransactionCompleted {
    transactionId
    salonId
    customerId
}
```

over publishing complete customer profiles.

Consumers should retrieve additional data through authorized application boundaries when necessary.

Events must preserve tenant context.

---

# 43. Security Boundaries Between Modules

Modules should not bypass each other's security rules.

For example:

```text
Campaign
   |
   X
direct database access to Customer tables
```

Instead:

```text
Campaign
   |
   v
Customer application/domain capability
```

or an explicitly defined module contract.

This keeps authorization and business ownership understandable.

---

# 44. Future Marketplace Security

The marketplace is not part of the MVP.

When introduced, it will require additional security boundaries around:

- Suppliers
- Supplier users
- Orders
- Payments
- Supplier permissions
- Marketplace administration
- Commercial data
- Transaction integrity

Those concerns must not be introduced into the MVP merely because the architecture may support them later.

The MVP only needs a clean boundary around platform-level product and price data.

---

# 45. Future Attribution and Incentive Security

Employee attribution, commissions, rewards, and revenue sharing are explicitly outside the MVP.

The architecture should leave room for a future module but must not implement:

- EmployeeAttribution
- Reward
- Commission
- IncentiveRule
- RevenueSharing

No current authorization model should depend on these concepts.

When introduced, they should become their own security-sensitive domain because they involve financial and employee-related decisions.

---

# 46. Security Configuration

Security configuration should be centralized and explicit.

Avoid scattered security rules across controllers.

The system should have a clear security layer responsible for:

- Authentication
- Principal creation
- Request security
- Token/session validation
- Role extraction
- Security context
- Global security policies

Business authorization should remain close to the corresponding application use case.

---

# 47. Security Observability

The application should provide enough information to detect security problems.

Useful signals include:

- Failed login attempts
- Authentication failures
- Authorization failures
- Suspicious repeated requests
- Import failures
- Campaign sending failures
- Unexpected provider failures
- Administrative changes

Security logs must not contain secrets or unnecessary customer PII.

---

# 48. Security Quality Gate

A feature is not complete if it only works functionally.

Before considering a security-sensitive feature complete, verify:

```text
Authentication
      +
Authorization
      +
Tenant Isolation
      +
Input Validation
      +
Secure Output
      +
Auditability
      +
Error Handling
      +
Tests
```

For tenant-owned functionality:

```text
Authenticated User
       |
       v
Authenticated Salon
       |
       v
Authorized Operation
       |
       v
Tenant-Owned Resource
       |
       v
Business Operation
```

Every step must be enforced by the backend.

---

# 49. MVP Security Philosophy

The product should not attempt to solve every possible future security problem today.

The correct MVP approach is:

```text
Strong fundamentals
        +
Strict tenant isolation
        +
Simple role-based authorization
        +
Secure authentication
        +
Safe handling of customer data
        +
Protected messaging operations
        +
Automated security tests
```

Avoid:

```text
Complex IAM platform
Advanced policy engine
Distributed authorization
Microservice security mesh
Custom cryptography
Premature zero-trust infrastructure
```

The system should be secure because its boundaries are clear, not because it contains unnecessary security infrastructure.

---

# 50. Final Principle

Security is part of the product architecture.

The most important security property of this platform is trust:

A salon must trust that its customer data belongs only to its salon.

A salon owner must trust that staff can only perform permitted operations.

A customer must trust that marketing communication respects consent.

The business must trust that revenue and transaction data cannot be silently altered.

Therefore:

> **Authenticate the user, derive the tenant, authorize the business operation, verify resource ownership, protect sensitive data, and audit important actions.**

Keep the MVP simple, but never compromise the fundamental security boundaries.
