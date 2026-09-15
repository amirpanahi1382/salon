# Security

**Status:** Implemented model (MVP-hardening, not a GRC program)

Principles that are actually enforced:

1. Authenticate when a route is not public.
2. Authorize via role guards + use-case checks.
3. Tenant from authenticated salon user; platform admin has **no** salon tenant.
4. Never trust client `salonId`.
5. Fail closed on missing/disabled user or suspended salon.
6. Audit sensitive mutations (without message bodies / secrets).
7. Secrets only in env; Pino redact paths from `@salon/shared`.

---

## Authentication

| Actor | Mechanism |
| --- | --- |
| Salon user | `POST /auth/register`, `POST /auth/login`; Argon2id; JWT `sub`,`tid`,`role` |
| Platform admin | `POST /admin/auth/login`; JWT `scp=platform` |
| Public | register, login, `/health`, `/health/ready`, `/metrics` |

No refresh tokens. Logout is discarding the token. JWT secret ≥ 32 characters (`JWT_SECRET`).

Passwords never logged. Failed login uses a generic message.

---

## Authorization

Salon roles: `OWNER`, `MANAGER`, `STAFF`.

Typical splits (see current-state for the full matrix):

- STAFF+: customers, visits read/create, intelligence read, queue messages, VIP salon routes (if entitled)
- OWNER/MANAGER: sales, void, delete customer/visit, complete-with-sale
- OWNER: service write, user administration (MANAGER: STAFF only)
- Platform admin: message queue dispatch, VIP lists/entitlements/export/dispatch

`GET /auth/owner` is an OWNER-only probe, not a product feature.

---

## Tenant isolation

Application filters + composite FKs. **No RLS.** Background jobs use `outbox.tenantId`. VIP target contacts are platform data; dispatched messages still belong to the requesting salon.

Excel imports take tenant from JWT, never from the file.

---

## Input and abuse

- class-validator DTOs; UUID params
- Phone regex `09[0-9]{9}`
- Excel ZIP/size/row limits (customers 5k/2MB; VIP lists 100 data rows)
- VIP images: magic-byte + size cap
- Global throttle 60/min/process; tighter on login/register
- Helmet on API

Consent/opt-out for messaging is **not implemented**.

---

## Data in logs and audit

Do not log: passwords, JWT, Authorization, bodies, phone numbers, message text, MinIO/DB secrets.

Audit `metadata` must follow the same rule.

---

## Out of security scope today

IdP, ABAC, marketplace payments, field-level encryption, RLS, WAF productization. See `docs/technical-debt.md` for hardening backlog (audit retention, multi-instance throttle, creator FKs).
