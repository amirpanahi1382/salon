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
                              ↓ transactional outbox
                         NestJS worker  →  Bale Safir (BALE deliveries only)
                              ↓
                         MinIO (VIP sample-work images)
```

Redis is required by env/Compose and is **not used by application code**. MinIO **is** used for VIP sample work.

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

Optional development platform admin (never production; never commit a real password):

```bash
# Set PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD in .env (both or neither)
pnpm db:bootstrap-admin
```

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
| `pnpm db:bootstrap-admin` | Dev platform admin upsert |
| `pnpm build:packages` / `pnpm build` | Packages, then API + worker |
| `pnpm dev:api` / `pnpm dev:worker` | Watch mode |
| `pnpm start:api` / `pnpm start:worker` | Compiled start |
| `pnpm test` | Recursive unit tests |
| `pnpm test:e2e` | API Jest E2E |
| `pnpm typecheck` | Recursive typecheck |
| `pnpm perf:bench` / `pnpm perf:load` | Scale benches (`RUN_LOAD=true` for load) |

## Authentication

Tenant JWT: `POST /auth/register`, `POST /auth/login`, `GET /auth/me`. Claims include `sub`, `tid`, `role`. Expiry `JWT_EXPIRES_IN` (default `8h`). No refresh token. Logout is client-side.

Platform admin JWT: `POST /admin/auth/login`, `GET /admin/auth/me`. Claim `scp=platform`. No `tid`.

Tenant is always taken from the authenticated user. A body `salonId` is ignored/rejected.

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
