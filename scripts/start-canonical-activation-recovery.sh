#!/bin/bash
# Canonical quarantine-only receipt recovery. It never loads root .env and
# refuses automatic object deletion before a database connection is used.
set -euo pipefail
cd "$(dirname "$0")/.."
export CANONICAL_DATABASE_REQUIRED=true
export ACTIVATION_RECEIPT_AUTOMATIC_CLEANUP_ENABLED=false
export DATABASE_CONNECTION_LIMIT=2
exec pnpm exec dotenv -e .env.phone-first-product -- pnpm --filter @salon/worker start:activation-recovery
