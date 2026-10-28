#!/bin/bash
# Canonical phone-first API. Does not read the repository root .env.
# API_BIND_HOST is exported first so an empty shell value cannot widen the listen address.
set -euo pipefail
cd "$(dirname "$0")/.."
export API_BIND_HOST=127.0.0.1
export CANONICAL_DATABASE_REQUIRED=true
exec pnpm exec dotenv -e .env.phone-first-product -- pnpm --filter @salon/api start
