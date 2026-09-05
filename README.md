# Beauty Salon Revenue Intelligence Platform

Vertical SaaS for women's beauty salons. The product is **not** a booking system.

North star: help salons generate more revenue from customers they already have.

## Current phase

Phase 5 — Customer Intelligence (deterministic, visit-based; not transactions or ML).

Product, domain, and architecture specifications live in:

- `agents.md`
- `business-model.md`
- `product-strategy.md`
- `product/mvp.md`
- `domain/domain-model.md`
- `architecture/architecture.md`
- `architecture/data-model.md`
- `architecture/security.md`

## Layout

This directory is the project root. The HTTP API and the async worker are **separate NestJS applications**:

- `apps/api` — REST API on port 3000
- `apps/worker` — outbox worker via `createApplicationContext` (no HTTP server)
- `apps/mobile` — Flutter MVP client
- `packages/database`, `packages/config`, `packages/shared` — shared libraries used by both

## Local development

Requires Node.js 20+, pnpm 9+, and Docker.

```bash
cp .env.example .env
pnpm install
pnpm infra:up
pnpm db:migrate
pnpm build:packages
```

API (port 3000):

```bash
pnpm dev:api
```

Worker (no HTTP port):

```bash
pnpm dev:worker
```

OpenAPI UI: `http://localhost:3000/docs`

Health:

- `GET /health` — process liveness
- `GET /health/ready` — PostgreSQL, Redis, MinIO

## Authentication

Tenant identity is taken from the authenticated user, never from a client-supplied `salonId`.

```http
POST /auth/register
POST /auth/login
GET /auth/me

GET /salon
PATCH /salon

GET /users
POST /users
GET /users/:id
PATCH /users/:id/role
PATCH /users/:id/status

POST /customers
GET /customers
GET /customers/:id
PATCH /customers/:id

POST /visits
GET /visits/:id
GET /customers/:customerId/visits

GET /intelligence/summary
GET /intelligence/opportunities
GET /intelligence/segments
GET /intelligence/customers/:customerId
```

A **Visit** is a completed historical salon interaction. It is not a booking, appointment, or calendar event.

**Intelligence** is derived from customer + completed visit history. It is not stored as a competing source of truth. Statuses: `NEW`, `ACTIVE`, `RETURNING`, `AT_RISK`, `INACTIVE`. Opportunities in this phase are `REACTIVATION` (repeat visitors who are overdue) and `CUSTOMER_RETURN` (single-visit overdue). Spend-based and cross-sell signals wait for transactions and services.

Tenant identity is always taken from the authenticated user. `salonId` in a request body is ignored and rejected when unexpected.
