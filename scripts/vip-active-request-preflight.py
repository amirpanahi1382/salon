#!/usr/bin/env python3
"""Read-only preflight for the VIP quantity and reopen migrations.

The script reports duplicate active (salon_id, list_id) groups and
requested quantities outside 1..500. Those predicates match
20261031180000_vip_package_quantity_and_reopen: the four stored statuses
AWAITING_SAMPLE_WORK, SUBMITTED, MANUAL_QUEUED, and BALE_NOT_IMPLEMENTED,
including overdue drafts still stored in those statuses. It does not use
reserved_until, and it does not read next_reservation_open.

It expires, cancels, merges, deletes, or rewrites nothing. It grants nothing.
Identity and data checks run in one BEGIN READ ONLY transaction. Exit 0 is a
clean predecessor or final schema. Exit 2 is conflicts. Exit 1 is an identity,
privilege, or operational failure.

Default mode refuses canonical and persistent targets before connecting.
Canonical mode is opt-in and still verifies the live database. The expected
name, system identifier, and comment are checks, not proof that a connection
is canonical. Starting the canonical database, running this preflight against
it, and applying the migration are a later authorized operational step.

Disposable:

    python3 scripts/vip-active-request-preflight.py \\
      --container <disposable-container> \\
      --database <disposable-database> \\
      --expected-system-identifier <system-identifier> \\
      --expected-comment <comment>

Canonical, only after that database has been started by a separate decision:

    python3 scripts/vip-active-request-preflight.py \\
      --canonical-read-only \\
      --container salon-phone-first-empty-pg-20261024T061347Z \\
      --user salon \\
      --database salon-db \\
      --expected-system-identifier 7700113693112733735 \\
      --expected-comment phone-first-empty:20261024T061347Z

Conflicts print the full aggregate counts and at most 20 salon_id/list_id
pairs. The script does not repair them. Pass --user when the selected role is
not salon. A missing privilege is reported and is not granted.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass

DATABASE_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_-]{0,62}$")
CONTAINER_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
ROLE_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")
SYSTEM_IDENTIFIER = re.compile(r"^\d{1,30}$")
COMMENT = re.compile(r"^[\x20-\x7e]{1,200}$")

CANONICAL_DATABASE_NAME = "salon-db"
CANONICAL_SYSTEM_IDENTIFIER = "7700113693112733735"
CANONICAL_DATABASE_COMMENT = "phone-first-empty:20261024T061347Z"
CANONICAL_CONTAINER = "salon-phone-first-empty-pg-20261024T061347Z"
PERSISTENT_SYSTEM_IDENTIFIER = "7683163620851879970"

REFUSED_SYSTEM_IDS = {
    CANONICAL_SYSTEM_IDENTIFIER,
    PERSISTENT_SYSTEM_IDENTIFIER,
}
REFUSED_DATABASES = {
    "salon",
    "salon-db",
    "salon_preview",
    "salon_opp_integrity_20261024",
    "phone_first_product",
    "postgres",
}
ACTIVE_STATUSES = (
    "AWAITING_SAMPLE_WORK",
    "SUBMITTED",
    "MANUAL_QUEUED",
    "BALE_NOT_IMPLEMENTED",
)
IDENTIFIER_LIMIT_DEFAULT = 20
COMMAND_TAGS = {"BEGIN", "COMMIT", "ROLLBACK", "DO"}

Query = Callable[[str], str]


class QueryFailed(Exception):
    def __init__(self, message: str, kind: str = "") -> None:
        super().__init__(message)
        self.kind = kind


@dataclass(frozen=True)
class Options:
    container: str
    database: str
    expected_comment: str
    expected_system_identifier: str
    canonical_read_only: bool = False
    user: str = "salon"
    identifier_limit: int = IDENTIFIER_LIMIT_DEFAULT


def sql_literal(value: str) -> str:
    if "\x00" in value or "\n" in value or "\r" in value:
        raise QueryFailed("refusing an unsafe SQL literal", "identity")
    return "'" + value.replace("'", "''") + "'"


def public_error(stderr: str) -> str:
    kept: list[str] = []
    for line in stderr.splitlines():
        lower = line.lower()
        if "://" in line or "password" in lower or "secret" in lower:
            continue
        cleaned = line.strip()
        if cleaned:
            kept.append(cleaned[:200])
    return kept[-1] if kept else "preflight query failed"


def classify_psql_error(stderr: str) -> QueryFailed:
    lower = stderr.lower()
    if "42501" in stderr or "permission denied" in lower:
        return QueryFailed("permission denied", "privilege")
    if "ambiguous database identity" in lower:
        return QueryFailed("ambiguous database identity", "identity")
    if "identity mismatch" in lower:
        return QueryFailed("identity mismatch", "identity")
    return QueryFailed(public_error(stderr), "operational")


def validate_target(options: Options) -> str | None:
    if (
        not CONTAINER_NAME.fullmatch(options.container)
        or "--" in options.container
        or not DATABASE_NAME.fullmatch(options.database)
        or "--" in options.database
        or not ROLE_NAME.fullmatch(options.user)
        or not SYSTEM_IDENTIFIER.fullmatch(options.expected_system_identifier)
        or not COMMENT.fullmatch(options.expected_comment)
        or "|" in options.expected_comment
    ):
        return "refusing an incomplete or unsafe target identity"
    if not 1 <= options.identifier_limit <= 100:
        return "refusing an identifier limit outside 1..100"
    canonical_triple = (
        options.database == CANONICAL_DATABASE_NAME
        and options.expected_system_identifier == CANONICAL_SYSTEM_IDENTIFIER
        and options.expected_comment == CANONICAL_DATABASE_COMMENT
    )
    if options.canonical_read_only:
        if not canonical_triple:
            return "canonical read-only mode requires the expected canonical identity"
        return None
    if (
        options.database in REFUSED_DATABASES
        or options.expected_system_identifier in REFUSED_SYSTEM_IDS
        or options.container == CANONICAL_CONTAINER
        or options.expected_comment == CANONICAL_DATABASE_COMMENT
    ):
        return "refusing canonical or persistent database identity"
    return None


def build_sql(options: Options) -> str:
    name_sql = sql_literal(options.database)
    id_sql = sql_literal(options.expected_system_identifier)
    comment_sql = sql_literal(options.expected_comment)
    statuses = ", ".join(sql_literal(status) for status in ACTIVE_STATUSES)
    limit = str(options.identifier_limit)
    return f"""
BEGIN READ ONLY;
DO $preflight$
DECLARE
  got_name text;
  got_id text;
  got_comment text;
BEGIN
  IF to_regprocedure('public.canonical_database_identity()') IS NOT NULL THEN
    EXECUTE $identity$
      SELECT database_name, system_identifier, COALESCE(database_comment, '')
      FROM public.canonical_database_identity()
    $identity$
      INTO got_name, got_id, got_comment;
    IF got_name IS DISTINCT FROM current_database() THEN
      RAISE EXCEPTION 'ambiguous database identity';
    END IF;
  ELSE
    EXECUTE $catalog$
      SELECT current_database(),
             (SELECT s.system_identifier::text FROM pg_catalog.pg_control_system() AS s),
             COALESCE(pg_catalog.shobj_description(d.oid, 'pg_database'), '')
      FROM pg_catalog.pg_database AS d
      WHERE d.datname = current_database()
    $catalog$
      INTO got_name, got_id, got_comment;
  END IF;
  IF got_name IS NULL OR got_id IS NULL OR got_comment IS NULL
     OR got_id = '' OR position(E'\\n' in got_comment) > 0
     OR position('|' in got_comment) > 0 THEN
    RAISE EXCEPTION 'ambiguous database identity';
  END IF;
  IF got_name IS DISTINCT FROM {name_sql}
     OR got_id IS DISTINCT FROM {id_sql}
     OR got_comment IS DISTINCT FROM {comment_sql}
     OR got_name IS DISTINCT FROM current_database() THEN
    RAISE EXCEPTION 'identity mismatch';
  END IF;
  PERFORM set_config('preflight.database_name', got_name, true);
  PERFORM set_config('preflight.system_identifier', got_id, true);
  PERFORM set_config('preflight.database_comment', got_comment, true);
END
$preflight$;
SELECT 'database_name|' || current_setting('preflight.database_name');
SELECT 'system_identifier|' || current_setting('preflight.system_identifier');
SELECT 'database_comment|' || current_setting('preflight.database_comment');
SELECT 'schema|' || (
  WITH flags AS (
    SELECT
      EXISTS (
        SELECT 1
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'vip_requests_one_active_per_salon_list'
          AND c.relkind = 'i'
      ) AS new_index,
      EXISTS (
        SELECT 1
        FROM pg_constraint AS c
        JOIN pg_class AS rel ON rel.oid = c.conrelid
        JOIN pg_namespace AS n ON n.oid = rel.relnamespace
        WHERE n.nspname = 'public'
          AND rel.relname = 'vip_requests'
          AND c.conname = 'vip_requests_count_positive'
          AND pg_get_constraintdef(c.oid) LIKE '%requested_count >= 1%'
          AND pg_get_constraintdef(c.oid) LIKE '%requested_count <= 500%'
      ) AS new_check,
      EXISTS (
        SELECT 1
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'vip_requests_one_open_reservation_per_list'
          AND c.relkind = 'i'
      ) AS old_index,
      EXISTS (
        SELECT 1
        FROM pg_constraint AS c
        JOIN pg_class AS rel ON rel.oid = c.conrelid
        JOIN pg_namespace AS n ON n.oid = rel.relnamespace
        WHERE n.nspname = 'public'
          AND rel.relname = 'vip_requests'
          AND c.conname = 'vip_requests_count_allowed'
      ) AS old_check,
      COALESCE((
        SELECT pg_get_indexdef(c.oid)
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'vip_requests_one_active_per_salon_list'
      ), '') AS indexdef
  )
  SELECT CASE
    WHEN new_index AND new_check AND NOT old_index AND NOT old_check
         AND indexdef LIKE '%AWAITING_SAMPLE_WORK%'
         AND indexdef LIKE '%SUBMITTED%'
         AND indexdef LIKE '%MANUAL_QUEUED%'
         AND indexdef LIKE '%BALE_NOT_IMPLEMENTED%'
         AND position('reserved_until' in indexdef) = 0
      THEN 'final'
    WHEN NOT new_index AND NOT new_check AND (old_index OR old_check)
      THEN 'predecessor'
    ELSE 'unrecognized'
  END
  FROM flags
);
SELECT 'duplicate_count|' || COUNT(*)::text
FROM (
  SELECT salon_id, list_id
  FROM vip_requests
  WHERE status IN ({statuses})
  GROUP BY salon_id, list_id
  HAVING COUNT(*) > 1
) AS duplicates;
SELECT 'quantity_count|' || COUNT(*)::text
FROM vip_requests
WHERE requested_count < 1 OR requested_count > 500;
SELECT 'duplicate|' || salon_id::text || ' ' || list_id::text || ' ' || COUNT(*)::text
FROM vip_requests
WHERE status IN ({statuses})
GROUP BY salon_id, list_id
HAVING COUNT(*) > 1
ORDER BY salon_id::text, list_id::text
LIMIT {limit};
ROLLBACK;
"""


def docker_query(options: Options, sql: str) -> str:
    completed = subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            options.container,
            "psql",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            options.user,
            "-d",
            options.database,
            "-tA",
            "-f",
            "-",
        ],
        input=sql,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise classify_psql_error(completed.stderr)
    return completed.stdout


def result_lines(stdout: str) -> list[str]:
    return [
        line
        for line in stdout.splitlines()
        if line and line not in COMMAND_TAGS
    ]


def privilege_message() -> str:
    return (
        "preflight role lacks a required privilege\n"
        "required: SELECT on public.vip_requests\n"
        "required: EXECUTE on public.canonical_database_identity() when that function exists; "
        "otherwise SELECT from pg_catalog.pg_control_system() and the database comment\n"
        "this preflight does not grant privileges"
    )


def emit_report(
    options: Options,
    schema: str,
    duplicate_count: int,
    quantity_count: int,
    duplicate_rows: list[str],
) -> None:
    shown = duplicate_rows[: options.identifier_limit]
    omitted = duplicate_count - len(shown)
    mode = "canonical-read-only" if options.canonical_read_only else "default"
    print(f"mode={mode}")
    print("identity=verified")
    print(f"database={options.database}")
    print(f"schema={schema}")
    print(f"duplicate_active_salon_list_groups={duplicate_count}")
    print(f"requested_count_outside_1_500={quantity_count}")
    print(f"duplicate_groups_shown={len(shown)}")
    print(f"duplicate_groups_omitted={omitted}")
    if shown:
        print("duplicate_salon_list_counts:")
        print("\n".join(shown))


def run_preflight(options: Options, query: Query) -> int:
    refusal = validate_target(options)
    if refusal:
        print(refusal, file=sys.stderr)
        return 1
    try:
        stdout = query(build_sql(options))
    except QueryFailed as error:
        if error.kind == "privilege":
            print(privilege_message(), file=sys.stderr)
        elif error.kind == "identity" and error.args[0] == "identity mismatch":
            print("database identity does not match", file=sys.stderr)
        elif error.kind == "identity":
            print("database identity is ambiguous", file=sys.stderr)
        else:
            print(str(error), file=sys.stderr)
        return 1

    values: dict[str, str] = {}
    duplicate_rows: list[str] = []
    for line in result_lines(stdout):
        if line.startswith("duplicate|"):
            duplicate_rows.append(line.removeprefix("duplicate|"))
            continue
        if "|" not in line:
            print("database identity could not be read", file=sys.stderr)
            return 1
        key, value = line.split("|", 1)
        if key in values:
            print("database identity is ambiguous", file=sys.stderr)
            return 1
        values[key] = value

    required = (
        "database_name",
        "system_identifier",
        "database_comment",
        "schema",
        "duplicate_count",
        "quantity_count",
    )
    if any(key not in values or values[key] == "" for key in required):
        print("database identity could not be read", file=sys.stderr)
        return 1
    if (
        values["database_name"] != options.database
        or values["system_identifier"] != options.expected_system_identifier
        or values["database_comment"] != options.expected_comment
    ):
        print("database identity does not match", file=sys.stderr)
        return 1
    if (
        not options.canonical_read_only
        and values["system_identifier"] in REFUSED_SYSTEM_IDS
    ):
        print("refusing canonical or persistent database identity", file=sys.stderr)
        return 1
    if values["schema"] not in {"predecessor", "final", "unrecognized"}:
        print("database identity is ambiguous", file=sys.stderr)
        return 1
    try:
        duplicate_count = int(values["duplicate_count"])
        quantity_count = int(values["quantity_count"])
    except ValueError:
        print("preflight query failed", file=sys.stderr)
        return 1
    if duplicate_count < 0 or quantity_count < 0 or len(duplicate_rows) > duplicate_count:
        print("database identity is ambiguous", file=sys.stderr)
        return 1
    if len(duplicate_rows) > options.identifier_limit:
        duplicate_rows = duplicate_rows[: options.identifier_limit]

    emit_report(options, values["schema"], duplicate_count, quantity_count, duplicate_rows)
    if values["schema"] == "unrecognized":
        print("schema is not the predecessor or the final migration shape", file=sys.stderr)
        return 1
    if duplicate_count or quantity_count:
        print("preflight=conflicts", file=sys.stderr)
        return 2
    print("preflight=clear")
    return 0


def parse_args(argv: list[str]) -> Options:
    parser = argparse.ArgumentParser(description="Read-only VIP migration preflight")
    parser.add_argument("--container", required=True)
    parser.add_argument("--database", required=True)
    parser.add_argument("--expected-comment", required=True)
    parser.add_argument("--expected-system-identifier", required=True)
    parser.add_argument("--canonical-read-only", action="store_true")
    parser.add_argument("--user", default="salon")
    parser.add_argument("--identifier-limit", type=int, default=IDENTIFIER_LIMIT_DEFAULT)
    args = parser.parse_args(argv)
    return Options(
        container=args.container,
        database=args.database,
        expected_comment=args.expected_comment,
        expected_system_identifier=args.expected_system_identifier,
        canonical_read_only=args.canonical_read_only,
        user=args.user,
        identifier_limit=args.identifier_limit,
    )


def main(argv: list[str] | None = None) -> int:
    options = parse_args(sys.argv[1:] if argv is None else argv)
    return run_preflight(options, lambda sql: docker_query(options, sql))


if __name__ == "__main__":
    sys.exit(main())
