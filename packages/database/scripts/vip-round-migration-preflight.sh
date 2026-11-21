#!/usr/bin/env bash
# Apply 20261121120000 against representative occupancy on a disposable cluster.
# Refuse canonical hosts. Leave the source database untouched.
set -euo pipefail

CONTAINER="${VIP_ROUND_PREFLIGHT_CONTAINER:-salon-vip-round-pg-20261121}"
EXPECTED_SYSID="${VIP_ROUND_PREFLIGHT_SYSID:-7710596024172785704}"
MIGRATIONS="${VIP_ROUND_PREFLIGHT_MIGRATIONS:-$(cd "$(dirname "$0")/../prisma/migrations" && pwd)}"
FAIL_DB="salon_vip_round_preflight_fail_20261121"
OK_DB="salon_vip_round_preflight_ok_20261121"
CLEAN_DB="salon_vip_round_preflight_clean_20261121"

identity="$(docker exec "$CONTAINER" psql -U salon -d postgres -At -c "SELECT system_identifier::text FROM pg_control_system();")"
if [[ "$identity" != "$EXPECTED_SYSID" ]]; then
  echo "refusing preflight on unexpected sysid $identity" >&2
  exit 1
fi
if [[ "$identity" == "7700113693112733735" || "$identity" == "7683163620851879970" ]]; then
  echo "refusing canonical" >&2
  exit 1
fi

apply_until_round() {
  local db="$1"
  local dir
  local dir
  for dir in $(find "$MIGRATIONS" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort); do
    if [[ "$dir" == 20261121120000_vip_list_round_slots || "$dir" == 20261121133000_vip_round_resolved_reuse ]]; then
      continue
    fi
    docker exec -i "$CONTAINER" psql -U salon -d "$db" -v ON_ERROR_STOP=1 -q -f - < "$MIGRATIONS/$dir/migration.sql"
  done
}

seed_occupying() {
  local db="$1"
  local count="$2"
  docker exec -i "$CONTAINER" psql -U salon -d "$db" -v ON_ERROR_STOP=1 <<SQL
INSERT INTO platform_admins (id, phone, password_hash, name, updated_at)
VALUES ('00000000-0000-0000-0000-000000000001', '09120000001', 'hash', 'Admin', CURRENT_TIMESTAMP);
INSERT INTO vip_target_lists (
  id, name, status, contact_count, region_code, catalog_membership, created_by_admin_id, updated_at
) VALUES (
  '00000000-0000-0000-0000-0000000000aa',
  'preflight',
  'ACTIVE',
  30,
  '03',
  'ORIGINAL_TEHRAN',
  '00000000-0000-0000-0000-000000000001',
  CURRENT_TIMESTAMP
);
INSERT INTO vip_target_contacts (id, list_id, sort_order, display_name, phone_number)
VALUES (
  '00000000-0000-0000-0000-0000000000cc',
  '00000000-0000-0000-0000-0000000000aa',
  1,
  'مخاطب پیش‌پرواز',
  '09139990000'
);
SQL
  local i
  for i in $(seq 1 "$count"); do
    docker exec -i "$CONTAINER" psql -U salon -d "$db" -v ON_ERROR_STOP=1 <<SQL
INSERT INTO salons (id, name, updated_at)
VALUES ('00000000-0000-0000-0000-0000000000$(printf '%02d' "$i")', 'S$i', CURRENT_TIMESTAMP);
INSERT INTO users (id, salon_id, name, phone, password_hash, role, updated_at)
VALUES (
  '00000000-0000-0000-0000-0000000001$(printf '%02d' "$i")',
  '00000000-0000-0000-0000-0000000000$(printf '%02d' "$i")',
  'U$i',
  '0913$(printf '%07d' "$i")',
  'hash',
  'OWNER',
  CURRENT_TIMESTAMP
);
INSERT INTO vip_requests (
  id, salon_id, list_id, created_by_user_id, requested_count, geographic_range,
  status, reserved_until, submitted_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-0000000002$(printf '%02d' "$i")',
  '00000000-0000-0000-0000-0000000000$(printf '%02d' "$i")',
  '00000000-0000-0000-0000-0000000000aa',
  '00000000-0000-0000-0000-0000000001$(printf '%02d' "$i")',
  30,
  'ونک',
  'SUBMITTED',
  CURRENT_TIMESTAMP + interval '1 hour',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);
INSERT INTO vip_request_recipients (
  id, vip_request_id, salon_id, sort_order, source_contact_id, display_name, phone_number, message_text
) VALUES (
  '00000000-0000-0000-0000-0000000003$(printf '%02d' "$i")',
  '00000000-0000-0000-0000-0000000002$(printf '%02d' "$i")',
  '00000000-0000-0000-0000-0000000000$(printf '%02d' "$i")',
  1,
  '00000000-0000-0000-0000-0000000000cc',
  'مخاطب پیش‌پرواز',
  '09139990000',
  'سلام مخاطب پیش‌پرواز عزیز'
);
SQL
  done
}

docker exec "$CONTAINER" psql -U salon -d postgres -c "DROP DATABASE IF EXISTS $FAIL_DB;"
docker exec "$CONTAINER" psql -U salon -d postgres -c "DROP DATABASE IF EXISTS $OK_DB;"
docker exec "$CONTAINER" psql -U salon -d postgres -c "DROP DATABASE IF EXISTS $CLEAN_DB;"
docker exec "$CONTAINER" psql -U salon -d postgres -c "CREATE DATABASE $FAIL_DB OWNER salon;"
docker exec "$CONTAINER" psql -U salon -d postgres -c "CREATE DATABASE $OK_DB OWNER salon;"

apply_until_round "$FAIL_DB"
seed_occupying "$FAIL_DB" 6
seeded="$(docker exec "$CONTAINER" psql -U salon -d "$FAIL_DB" -At -c "SELECT COUNT(*) FROM vip_requests;")"
echo "fail-db occupying rows=$seeded"
if [[ "$seeded" != "6" ]]; then
  echo "seed failed" >&2
  exit 1
fi
set +e
fail_out="$(docker exec -i "$CONTAINER" psql -U salon -d "$FAIL_DB" -v ON_ERROR_STOP=1 -f - < "$MIGRATIONS/20261121120000_vip_list_round_slots/migration.sql" 2>&1)"
fail_status=$?
set -e
echo "$fail_out"
if [[ $fail_status -eq 0 || "$fail_out" != *vip_round_refuses_more_than_five_occupying_salons* ]]; then
  echo "expected fail-closed >5 occupying" >&2
  exit 1
fi

apply_until_round "$OK_DB"
seed_occupying "$OK_DB" 1
before_fp="$(docker exec "$CONTAINER" psql -U salon -d "$OK_DB" -At -c "SELECT md5(string_agg(id::text || status || requested_count::text, ',' ORDER BY id)) FROM vip_requests; SELECT md5(string_agg(id::text || phone_number || message_text, ',' ORDER BY id)) FROM vip_request_recipients;")"
docker exec -i "$CONTAINER" psql -U salon -d "$OK_DB" -v ON_ERROR_STOP=1 -f - < "$MIGRATIONS/20261121120000_vip_list_round_slots/migration.sql"
docker exec -i "$CONTAINER" psql -U salon -d "$OK_DB" -v ON_ERROR_STOP=1 -f - < "$MIGRATIONS/20261121133000_vip_round_resolved_reuse/migration.sql"
after_fp="$(docker exec "$CONTAINER" psql -U salon -d "$OK_DB" -At -c "SELECT md5(string_agg(id::text || status || requested_count::text, ',' ORDER BY id)) FROM vip_requests; SELECT md5(string_agg(id::text || phone_number || message_text, ',' ORDER BY id)) FROM vip_request_recipients;")"
if [[ "$before_fp" != "$after_fp" ]]; then
  echo "historical request/recipient rewrite detected" >&2
  echo "before=$before_fp after=$after_fp" >&2
  exit 1
fi
slots="$(docker exec "$CONTAINER" psql -U salon -d "$OK_DB" -At -c "SELECT COUNT(*) FROM vip_list_round_slots;")"
if [[ "$slots" != "1" ]]; then
  echo "expected one backfilled slot, got $slots" >&2
  exit 1
fi
idx="$(docker exec "$CONTAINER" psql -U salon -d "$OK_DB" -At -c "SELECT COUNT(*) FROM pg_indexes WHERE indexname = 'vip_list_round_slots_salon_round_key'; SELECT COUNT(*) FROM pg_indexes WHERE indexname = 'vip_requests_one_occupying_per_salon_list_round';")"
if [[ "$idx" != $'1\n0' ]]; then
  echo "unexpected round indexes: $idx" >&2
  exit 1
fi

docker exec "$CONTAINER" psql -U salon -d postgres -c "DROP DATABASE IF EXISTS $CLEAN_DB;"
docker exec "$CONTAINER" psql -U salon -d postgres -c "CREATE DATABASE $CLEAN_DB OWNER salon;"
docker exec "$CONTAINER" psql -U salon -d postgres -c "COMMENT ON DATABASE $CLEAN_DB IS 'vip-round-preflight-clean:20261121';"

docker exec "$CONTAINER" psql -U salon -d postgres -c "DROP DATABASE IF EXISTS $FAIL_DB;"
docker exec "$CONTAINER" psql -U salon -d postgres -c "DROP DATABASE IF EXISTS $OK_DB;"
echo "vip-round-migration-preflight occupancy ok"
