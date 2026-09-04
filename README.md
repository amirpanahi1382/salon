# Beauty Salon Revenue Intelligence Platform

Vertical SaaS for women's beauty salons. The product is **not** a booking system.

North star: help salons generate more revenue from customers they already have.

## Current phase

Phase 2 — Salon + User (profile, user management, roles, tenant isolation, audit).

Product, domain, and architecture specifications live in:

- `agents.md`
- `business-model.md`
- `product-strategy.md`
- `product/mvp.md`
- `domain/domain-model.md`
- `architecture/architecture.md`
- `architecture/data-model.md`
- `architecture/security.md`

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
```

Tenant identity is always taken from the authenticated user. `salonId` in a request body is ignored and rejected when unexpected.
