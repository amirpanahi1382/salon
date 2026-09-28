# Technical debt and hardening backlog

**Status:** Verified against schema, API, worker, and tests (2026-09-15)  
**Not:** a product roadmap. Do not implement from this list unless explicitly asked.

Severity: **P1** blocks trustworthy production at modest scale or integrity. **P2** hardening. **P3** cleanup.

| ID | Severity | Area | Finding | Direction (do not treat as committed work) |
| --- | --- | --- | --- | --- |
| TD-01 | P2 | Intelligence scale | Phase 7 measurements justified limiting the visit-gap window to each selected 500-candidate batch. Global last-visit ranking and sparse filtered scans still repeat across batches and live cursor pages; 50,000-customer synthetic full opportunity traversal remained about 5.8s locally. | Measure representative production distributions and query plans before considering a serving index or derived model; preserve live-read semantics and never make a snapshot the ledger. |
| TD-02 | P2 | Tenancy | No PostgreSQL RLS. Isolation is application filters + composite FKs. | Optional RLS later; do not weaken composite FKs |
| TD-03 | P2 | Integrity | Phase 8 tenant-composite creator FKs enforce new key writes, but remain `NOT VALID` for history. Phase 8B preserves validated global-ID parent FKs for historical parent existence. ReturnCommitment creator/updater FKs were already composite. | Run target-database preflight; resolve historical mismatches by explicit provenance decisions, then validate each composite FK. Synthetic verification does not establish target historical integrity. |
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
| TD-19 | P2 | VIP | Phase 8 installs the optional `(message_request_id, salon_id)` FK as `NOT VALID`; Phase 8B restores the validated ID-only FK so an inconsistent historical link still prevents parent deletion. New links are tenant-safe; existing links await composite validation. | Preflight linked historical rows and validate only after any mismatch receives a provenance decision. Null links remain legitimate. |
| TD-16 | P3 | Auth | JWT has no refresh rotation; role claim can lag until next request (DB role wins) | Accept for MVP or add refresh later |
| TD-17 | P3 | Health | MinIO not in readiness; VIP uploads fail independently | Optional storage probe if VIP is production-critical |
| TD-20 | P2 | Recovery | Synchronous `/arrive` now 409 `RETURN_COMMITMENT_VISIT_REVIEW_REQUIRED` when `actualVisitId` is null and a same-salon Visit already has `visitedAt` > source `submittedAt`. No auto-link. Remaining race: if `/arrive` commits a new linked Visit first, a concurrent or later `POST /visits` can still insert a second Visit (two write APIs; no per-customer/day uniqueness). Customer `FOR UPDATE` serializes the in-flight check vs Visit insert so both cannot observe an empty set and insert. | Do not add one-Visit-per-day uniqueness. Explicit `/link-visit` remains the attribution correction. |

Do not start microservices, sharding, or event sourcing to address TD-01.
