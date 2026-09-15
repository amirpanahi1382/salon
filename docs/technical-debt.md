# Technical debt and hardening backlog

**Status:** Verified against schema, API, worker, and tests (2026-09-15)  
**Not:** a product roadmap. Do not implement from this list unless explicitly asked.

Severity: **P1** blocks trustworthy production at modest scale or integrity. **P2** hardening. **P3** cleanup.

| ID | Severity | Area | Finding | Direction (do not treat as committed work) |
| --- | --- | --- | --- | --- |
| TD-01 | P1 | Intelligence | Salon intelligence/opportunity/segment serving scans at most 5,000 newest customers; `hasMore` understates the rest. SQL is better than loading every visit into Node, but this is still the main **scale** risk. | Serving model / indexes / possibly persisted snapshots **without** making snapshots the ledger |
| TD-02 | P2 | Tenancy | No PostgreSQL RLS. Isolation is application filters + composite FKs. | Optional RLS later; do not weaken composite FKs |
| TD-03 | P2 | Integrity | `users.id` creator FKs (`opportunity_actions.created_by`, `message_requests.created_by_user_id`, `message_deliveries.created_by`, `vip_requests.created_by_user_id`) are not tenant-composite | Composite creator relations if we can do it without breaking history |
| TD-04 | P2 | Money | Header `transactions.amount` vs `SUM(transaction_items)` is application-enforced only | DB CHECK or constraint trigger |
| TD-05 | P2 | Money | `transaction_items` have no `@@unique([id, salonId])` unlike sibling tables | Add composite unique if needed for FKs |
| TD-06 | P2 | Idempotency | Duplicate-key guarantee is only `IDEMPOTENCY_RETENTION_DAYS` (7). After that, the same client key can insert again | Documented window; longer retention or hashed durable keys if required |
| TD-07 | P2 | Ops | `audit_logs` unbounded; `DEAD_LETTER` outbox unbounded; message PII unbounded | Retention/archive policy (messages: review ~24 months) |
| TD-08 | P2 | Outbox | Most `DOMAIN_EVENT_TYPES` have no side-effect consumer (no-op PROCESSED) | Keep as extension points; do not add Kafka to “use” them |
| TD-09 | P3 | Search | Customer search is `ILIKE` substring. Fine at ~3k; `pg_trgm` / prefix deferred | Re-bench before adding extension |
| TD-10 | P3 | Indexes | Scale migration added indexes that may overlap later messaging/VIP indexes | Measure before dropping |
| TD-11 | P2 | Config | `REDIS_URL` required; Redis unused. Throttle is in-memory per API process | Do not put Redis on the auth path until multi-instance is real; then fail closed |
| TD-12 | P2 | Messaging | No consent/opt-out | Product + legal before send-at-scale |
| TD-13 | P3 | API | `GET /users` is an unbounded list; `GET /auth/owner` leftover | Cursor page; consider deleting owner probe |
| TD-14 | P3 | Flutter | User admin, salon PATCH, void, segments, standalone transactions are API-only | Add screens only with a workflow reason |
| TD-15 | P2 | VIP | VIP Bale is an explicit non-feature (`BALE_NOT_IMPLEMENTED`) | Do not enable Safir for VIP accidentally |
| TD-19 | P2 | VIP | `VipRequestRecipient.messageRequestId` FKs `message_requests(id)` only, not composite `(id, salonId)` | Tenant-composite FK if we can add it without rewriting history |
| TD-16 | P3 | Auth | JWT has no refresh rotation; role claim can lag until next request (DB role wins) | Accept for MVP or add refresh later |
| TD-17 | P3 | Health | MinIO not in readiness; VIP uploads fail independently | Optional storage probe if VIP is production-critical |
| TD-18 | P3 | Docs/ops | Compose still ships Redis for an unused dependency | Keep until throttle work, or stop requiring the var (code change) |

Do not start microservices, sharding, or event sourcing to address TD-01.
