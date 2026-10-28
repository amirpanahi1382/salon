#!/bin/bash
# Identity is verified before Prisma opens a migration.
# Ledger cleanup then runs whether that deploy succeeds or fails.
# A failed identity check exits before Prisma and before any cleanup.
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm --filter @salon/database exec node "$(pwd)/scripts/canonical-migrate-guard.cjs"

set +e
pnpm --filter @salon/database migrate:deploy
prisma_status=$?
set -e

set +e
pnpm --filter @salon/database exec node "$(pwd)/scripts/canonical-migrate-guard.cjs" --revoke-ledger
cleanup_status=$?
set -e

if [[ "$cleanup_status" -eq 2 ]]; then
  printf '%s\n' 'CANONICAL_MIGRATE_LEDGER_CLEANUP_FAILED' >&2
fi

if [[ "$prisma_status" -ne 0 ]]; then
  exit "$prisma_status"
fi
exit "$cleanup_status"
