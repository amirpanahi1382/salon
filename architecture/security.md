# Security

**Status:** Implemented model (MVP-hardening, not a GRC program)

Principles that are actually enforced:

1. Authenticate when a route is not public.
2. Authorize via role guards + use-case checks.
3. Tenant from authenticated salon user; platform admin has **no** salon tenant.
4. Never trust client `salonId`.
5. Fail closed on missing/disabled user, suspended salon, or a product token whose salon access is no longer `PRODUCT`.
6. Audit sensitive mutations (without message bodies / secrets). `salon_app` can insert and read `audit_logs` inside the domain transaction. It cannot update, delete, or truncate that history. The table owner and `salon_migrator` still can. This is an application-role restriction, not separate timestamping or protection from the database operator.
7. Secrets only in env; Pino redact paths from `@salon/shared`.
8. The canonical API connects as `salon_app`, not as the database superuser. Table ownership and migrations belong to `salon_migrator`. Identity is read through `canonical_database_identity()` only. Ledger cleanup runs after a failed canonical deploy as well as a successful one, and only after that identity matches. The VIP inventory transfer writes as `salon_app`. See `architecture/operations.md`.

---

## Authentication

| Actor | Mechanism |
| --- | --- |
| Salon user | Phone signup when `PHONE_SIGNUP_ENABLED`; `POST /auth/login/phone`; Argon2id; product JWT `sub`,`tid`,`role`. Email is optional contact and is not a login |
| Phone login | `POST /auth/login/phone` always. The server returns either a salon session or `scp=platform`. The request has no role. OTP signup completion only when `PHONE_SIGNUP_ENABLED` and registration mode `phone`. Pending access gets JWT `scp=onboarding`. Password verified is not product access |
| Platform admin | The same `POST /auth/login/phone` screen issues `scp=platform` when the phone belongs to the admin. Public signup cannot create an admin. The first admin is an operator command on a new empty database, after a phone verification, and only when no admin exists |
| Public | phone signup when enabled; phone login; `/health`, `/health/ready`, `/metrics`. `POST /auth/register`, `POST /auth/login`, and `POST /admin/auth/login` are closed |
| Phone signup challenge | `POST /auth/signup/phone/start` and `/verify`, off unless `PHONE_SIGNUP_ENABLED`. Possession proof only; no salon, user, or session. Phone and OTP are not stored. The local code deadline is at most 60 seconds and never later than OTPy's reported TTL. Deadline acceptance uses the database clock at the write. The marketing stop does not apply. Completion consumes that proof in the account transaction. The flag stays false. A live send also needs a private `OTPY_API_KEY` and is not authorized by publishing this slice |

Email and password login is not a fallback. A canonical phone is required and unique across salon users and platform admins. Flutter has one «ورود» screen and does not ask for an email.

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

`GET /auth/owner` is an OWNER-only probe, not a product feature. It is not available to an onboarding session.

`JwtAuthGuard` is the product-access boundary. An onboarding session (`scp=onboarding`) is forbidden on every JWT route except those marked `AllowOnboardingSession`. Today those are `GET /auth/account`, `GET /auth/me`, `POST /auth/session/product`, the agreement read, presentation, acceptance, receipt, and download routes, and the activation status, upload, preview, and submit routes. Product modules do not add a second check. The salon access state is loaded on every request. `AWAITING_AGREEMENT` and `AWAITING_PAYMENT` both stay onboarding. VIP entitlement is not that state. `SUSPENDED` is not the onboarding state. A product token is rejected when access is no longer `PRODUCT`. An onboarding token is not rewritten when access becomes `PRODUCT`. `POST /auth/session/product` issues a separate product token only after the database access state is already `PRODUCT`.

---

## Agreement evidence

`CONTRACT_V1` is identified by that key and the SHA-256 of its UTF-8 bytes. Acceptance stores the rendered-document digest, a snapshot digest, the server time from `clock_timestamp()`, the login `jti`, and technical context. The API listens directly; Compose has no reverse proxy and Express trust-proxy is off. `TRUSTED_PROXY_HOPS` defaults to 0, so the recorded client IP is the socket address and `X-Forwarded-For` is ignored. A nonzero hop count is rejected unless `TRUSTED_PROXY_IPS` lists the proxy addresses, and the socket peer must be one of those addresses before any forwarded hop is used. The evidence export keeps `observedSocketIp` separate from client-reported user agent, app version, and app build. `AGREEMENT_ACCEPTANCE_ENABLED` closes publish, presentation, and new acceptance. It does not hide an authenticated owner's receipt or accepted document, or a platform admin's audited evidence export. Those reads stay authenticated, tenant-scoped, and dependent on the evidence key for ciphertext. Audit metadata for presentation, acceptance, and evidence export keeps ids and digests only.

Database triggers reject UPDATE and DELETE of versions, presentations, and acceptances. A table owner can disable those triggers, and the tables are not WORM storage. MinIO is not used for this evidence and is not an independent timestamp or retention lock. The export says so. There is no certified signature and no claim of court admissibility.

Launch gates that this slice does not close: Article 1 names party one only as the owner of the application; the text is not a lawyer-certified instrument; the 500 counted-send rule is not an implemented counter; recipient-consent evidence is not implemented.

## Activation receipt evidence

`MANUAL_TRANSFER_ENABLED` closes new card instructions, uploads, submissions, and approval or rejection. It does not close an authenticated owner’s payment status, including `PAYMENT_UNAVAILABLE` when no receipt exists and `UNDER_REVIEW` after one was submitted. It does not close a platform admin’s pending list, review detail, or image read. Image reads still check the caller, the tenant embedded in the object key, and the stored digest. The admin view audit is `ACTIVATION_RECEIPT_VIEWED` and does not claim the transfer was verified. Approval requires the request body to repeat «واریز را در حساب بانکی بررسی و با این فیش تطبیق داده‌ام». The database stores that sentence with the admin id, server `decided_at`, receipt id, and digest. A boolean or other wording cannot activate the salon. This is a manual attestation by that platform admin, not a result from a bank or payment provider.

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

Consent to be contacted is **not implemented** and is not claimed. A Platform Admin can register or lift a platform-wide stop for one canonical phone (`platform_message_stops`, append-only `platform_message_stop_events`, reason `RECIPIENT_REQUEST`). Salon roles cannot list or change it. The salon-facing 409 does not include the phone or any other tenant. Admin audit metadata stores the reason code and blocked/skipped counts, not the phone or message text. Admin search/register responses echo the phone the admin submitted.

---

## Data in logs and audit

Do not log: passwords, JWT, Authorization, bodies, phone numbers, national IDs, agreement document bodies, receipt image bytes, card numbers, message text, MinIO/DB secrets, or agreement evidence keys.

Unexpected exception messages, stacks, causes, connector text, and provider/storage responses are not safe diagnostic fields. API and worker error logs retain request/event IDs, operation, outcome, status, and stable codes/categories instead. Pino field-name redaction remains defense in depth; it cannot sanitize an arbitrary string. Known 4xx client contracts remain unchanged. Unexpected 5xx responses use fixed messages, including `INFRASTRUCTURE_ERROR` responses.

Audit `metadata` must follow the same rule.

---

## Out of security scope today

IdP, ABAC, marketplace payments, general field-level encryption, RLS, WAF productization. Agreement snapshots are the exception: national ID and the filled contract are encrypted with AES-256-GCM and a key id. That key is an environment secret, not an HSM, and rotation is manual. See `docs/technical-debt.md` for hardening backlog (audit retention, multi-instance throttle, creator FKs).
