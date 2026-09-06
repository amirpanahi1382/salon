# Beauty Salon Revenue Intelligence Platform

Vertical SaaS for women's beauty salons. The product is **not** a booking system.

North star: help salons generate more revenue from customers they already have.

## Current phase

Phase 5 intelligence plus financial source-of-truth (services, transactions) and Phase C scale work (`architecture/performance.md`, `domain/financial-domain.md`).

Product, domain, and architecture specifications live in:

- `agents.md`
- `business-model.md`
- `product-strategy.md`
- `product/mvp.md`
- `domain/domain-model.md`
- `architecture/architecture.md`
- `architecture/data-model.md`
- `architecture/security.md`
- `architecture/operations.md`
- `architecture/performance.md`

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

OpenAPI UI: `http://localhost:3000/docs` (disabled in production unless `SWAGGER_ENABLED=true`)

Health:

- `GET /health` — process liveness (no dependency checks)
- `GET /health/ready` — PostgreSQL only; HTTP 503 if down or shutting down
- `GET /metrics` — Prometheus text (low-cardinality HTTP + outbox gauges)

Operational detail: `architecture/operations.md`.

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
DELETE /customers/:id

GET /visits
GET /visits/:id
POST /visits
POST /visits/complete-with-sale
DELETE /visits/:id
GET /customers/:customerId/visits

GET /intelligence/summary
GET /intelligence/opportunities
GET /intelligence/segments
GET /intelligence/customers/:customerId
```

A **Visit** is a completed historical salon interaction. It is not a booking, appointment, or calendar event.

**Intelligence** is derived from customer + completed visit history. It is not stored as a competing source of truth. Statuses: `NEW`, `ACTIVE`, `RETURNING`, `AT_RISK`, `INACTIVE`. Opportunities in this phase are `REACTIVATION` (repeat visitors who are overdue) and `CUSTOMER_RETURN` (single-visit overdue). Spend-based and cross-sell signals wait for transactions and services.

`DELETE /customers/:id` (OWNER/MANAGER) hard-deletes the customer and that customer's completed visits in one transaction. Audit logs are kept. `DELETE /visits/:id` (OWNER/MANAGER) removes one completed visit. `GET /visits` lists salon visits newest first (limit 200) and accepts `customerId`, `date=YYYY-MM-DD` (UTC day), or `from`/`to` ISO instants. STAFF can create and read visits but cannot delete customers or visits.

Tenant identity is always taken from the authenticated user. `salonId` in a request body is ignored and rejected when unexpected.
