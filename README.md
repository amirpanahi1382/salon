# Beauty Salon Revenue Intelligence Platform

Vertical SaaS for **women's beauty salons**. North star: help salons generate more revenue from customers they already have.

This is **not** a booking, calendar, POS, accounting, or marketplace product.

Authoritative docs: [`AGENTS.md`](AGENTS.md) (coding-agent contract) · [`product/mvp.md`](product/mvp.md) (scope) · [`docs/current-state-system-spec.md`](docs/current-state-system-spec.md) (what exists today). Full map in `AGENTS.md`.

## Layout

pnpm workspace (`apps/*` except Flutter, plus `packages/*`):

| Path | Role |
| --- | --- |
| `apps/api` | NestJS HTTP API (default port 3000) |
| `apps/worker` | NestJS `createApplicationContext` outbox worker (no HTTP server) |
| `apps/mobile` | Flutter client (excluded from pnpm; needs Flutter SDK) |
| `packages/database` | Prisma schema, migrations, client |
| `packages/config` | Zod env loading |
| `packages/shared` | Money, JWT principal types, intelligence rules, events |
| `infra/docker` | Compose: PostgreSQL 16, Redis 7, MinIO |

API and worker are **two processes**, not one Nest app with a background thread.

```text
Flutter  →  NestJS API  →  PostgreSQL (Prisma)
                    │         ↓ transactional outbox
                    │    NestJS worker  →  Bale Safir (BALE deliveries only)
                    ▼         │ VIP abandoned-upload cleanup
              MinIO / S3-compatible storage
              (VIP sample works + private activation receipts)
```

Redis is required by env/Compose and is **not used by application code**. MinIO stores VIP sample works and private activation receipt images; a PostgreSQL backup does not include those objects.

## Prerequisites

- Node.js 20+
- pnpm 9+ (`packageManager`: `pnpm@9.15.0`)
- Docker
- Flutter SDK (for `apps/mobile`)

## Local setup

```bash
cp .env.example .env
pnpm install
pnpm infra:up
pnpm db:migrate
pnpm build:packages
```

First platform admin, only on a new empty database. `pnpm dev:api` and API startup do not run it, and it does not change an existing admin.

Set `PLATFORM_ADMIN_PHONE`, `PLATFORM_ADMIN_PASSWORD`, `PLATFORM_ADMIN_EXPECTED_DATABASE`, `PLATFORM_ADMIN_EXPECTED_SYSTEM_IDENTIFIER`, and `PLATFORM_ADMIN_EXPECTED_DATABASE_COMMENT`. Those three expected values must match the live database name, PostgreSQL system identifier, and database comment. The command reads them from the connection and stops before any verification message or insert when they do not match. It also refuses databases named `salon` and `salon_preview`.

The first successful proof sends one code and creates no admin. Set `PLATFORM_ADMIN_OTP_CODE` and run `pnpm db:bootstrap-admin` again to create exactly one admin. A wrong code creates nothing. A later run does not overwrite that admin or create another. No email is required.

Starter service catalog for real registrations: Hair Service + Nail Service (skipped for `@example.test`).

API:

```bash
pnpm dev:api
```

Worker (required for Bale execution and outbox/idempotency retention):

```bash
pnpm dev:worker
```

OpenAPI: `http://localhost:3000/docs` (off in production unless `SWAGGER_ENABLED=true`).

Health:

- `GET /health` — process liveness
- `GET /health/ready` — PostgreSQL; 503 if down or draining
- `GET /metrics` — Prometheus text (keep off the public internet)

Flutter: see [`apps/mobile/README.md`](apps/mobile/README.md).

## Commands

| Script | Purpose |
| --- | --- |
| `pnpm infra:up` / `infra:down` / `infra:logs` | Docker Compose |
| `pnpm db:generate` | Prisma client |
| `pnpm db:migrate` | `migrate deploy` |
| `pnpm db:migrate:dev` | `migrate dev` |
| `pnpm db:ensure-dev-catalog` | Dev starter services helper |
| `pnpm db:bootstrap-admin` | First platform admin on a new empty database, after a live identity proof. Not an upsert |
| `pnpm build:packages` / `pnpm build` | Packages, then API + worker |
| `pnpm dev:api` / `pnpm dev:worker` | Watch mode |
| `pnpm start:canonical` | Canonical API only. Loads `.env.phone-first-product`, binds `127.0.0.1`, and requires database `salon-db`. Does not read the root `.env` |
| `pnpm db:migrate:canonical` | Canonical migrations through `salon_migrator`, after an identity check. Not part of API startup |
| `pnpm start:api` / `pnpm start:worker` | Compiled start from the root `.env`. Not the canonical database |
| `pnpm test` | Recursive unit tests |
| `pnpm test:e2e` | API Jest E2E |
| `pnpm typecheck` | Recursive typecheck |
| `pnpm perf:bench` / `pnpm perf:load` | Scale benches (`RUN_LOAD=true` for load) |

## Authentication

Phone and password sign in through `POST /auth/login/phone`. The server chooses a salon user or a platform admin. Salon claims include `sub`, `tid`, and `role`. A platform admin token has `scp=platform` and no `tid`. `GET /auth/me` and `GET /admin/auth/me` return the matching principal. `POST /auth/register`, `POST /auth/login`, and `POST /admin/auth/login` are closed. Expiry `JWT_EXPIRES_IN` (default `8h`). No refresh token. Logout is client-side.

Tenant is always taken from the authenticated user. A body `salonId` is ignored/rejected.

Phone-first onboarding is a separate restricted journey: phone → OTP → password entered twice and one OWNER account → login → published `CONTRACT_V1` presentation and explicit acceptance → card-transfer instructions and receipt upload → `UNDER_REVIEW` → platform-admin bank-check attestation and approval → fresh product session. A pending owner can sign in but cannot use CRM, VIP, messaging, or other product routes. Signup, agreement acceptance, and manual transfer each have separate flags that default off. There is no payment gateway; uploading a receipt does not confirm payment. Contract publication and live rollout are separate operator decisions. See `docs/current-state-system-spec.md` and `architecture/security.md` for the exact gates and evidence limits.

A **Visit** is a completed historical interaction, not a booking.

## Capability map

| Area | Salon API (JWT tenant) | Notes |
| --- | --- | --- |
| Salon | `GET/PATCH /salon` | Flutter profile does not expose PATCH |
| Users | `GET/POST /users`, role/status patches | API only in Flutter |
| Customers | CRUD, Excel import, `GET /customers/:id/activity` | Phone `09` + 9 digits |
| Visits | create, complete-with-sale, list, export, delete | STAFF cannot delete |
| Services | list/create/patch | Create/patch OWNER only |
| Transactions | create, list, void | Create/void OWNER/MANAGER; Flutter uses complete-with-sale |
| Intelligence | summary, opportunities, segments, per-customer | Derived on read |
| Actions | create/complete/dismiss | Durable response to opportunities |
| Messages | opportunity + manual queue, get, list, manual-outreach inbox | Admin dispatches later |
| VIP | `/vip/capability`, lists, requests, sample works, submit | Entitlement required |

Platform admin: `/admin/message-queue`, `/admin/vip/*`.

Details: [`docs/current-state-system-spec.md`](docs/current-state-system-spec.md).
