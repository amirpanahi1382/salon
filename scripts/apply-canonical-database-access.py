#!/usr/bin/env python3
"""Apply canonical runtime and migration roles inside one database.

Expected identity is an argument. It is compared with the live cluster before
any change. Passwords come from a mode 0600 file owned by the current user.
They are sent on psql stdin and are not printed.
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
SYSID = re.compile(r"^\d{1,30}$")


def assert_secret_file(path: Path) -> None:
    if not path.is_file():
        raise SystemExit("secrets file is missing")
    stat = path.stat()
    if stat.st_uid != os.getuid():
        raise SystemExit("secrets file owner mismatch")
    if stat.st_mode & 0o077:
        raise SystemExit("secrets file permissions are too broad")


def load_secrets(path: Path) -> dict[str, str]:
    assert_secret_file(path)
    values: dict[str, str] = {}
    for line in path.read_text().splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value
    return values


def sql_literal(value: str) -> str:
    if value is None or "\x00" in value or "\n" in value or "\r" in value:
        raise SystemExit("refusing an unsafe SQL literal")
    return "'" + value.replace("'", "''") + "'"


def redact(text: str, secrets: list[str]) -> str:
    redacted = text
    for secret in secrets:
        if secret:
            redacted = redacted.replace(secret, "[redacted]")
    kept: list[str] = []
    for line in redacted.splitlines():
        upper = line.upper()
        if "PASSWORD" in upper or "ALTER ROLE" in upper or "GRANT " in upper:
            continue
        if line.startswith("ERROR:") or line.startswith("SQLSTATE") or "identity mismatch" in line:
            kept.append(line[:200])
    return "\n".join(kept)


def sql(
    database: str,
    app_password: str,
    migrator_password: str,
    operator_password: str | None,
    expected_database: str,
    expected_system_identifier: str,
    expected_comment: str,
    fail_after_identity: bool = False,
) -> str:
    if not IDENTIFIER.fullmatch(database) or not IDENTIFIER.fullmatch(expected_database):
        raise SystemExit("refusing database name")
    if not SYSID.fullmatch(expected_system_identifier):
        raise SystemExit("refusing system identifier")
    if database != expected_database:
        raise SystemExit("database argument does not match the expected database name")
    app_sql = sql_literal(app_password)
    migrator_sql = sql_literal(migrator_password)
    operator_sql = ""
    if operator_password is not None:
        operator_sql = f"ALTER ROLE salon PASSWORD {sql_literal(operator_password)};\n"
    rollback = ""
    if fail_after_identity:
        rollback = "DO $$ BEGIN RAISE EXCEPTION 'forced rollback'; END $$;\n"
    expected_name_sql = sql_literal(expected_database)
    expected_id_sql = sql_literal(expected_system_identifier)
    expected_comment_sql = sql_literal(expected_comment)
    return f"""
BEGIN;
DO $$
DECLARE
  got_name text;
  got_id text;
  got_comment text;
BEGIN
  SELECT current_database(),
         (SELECT s.system_identifier::text FROM pg_catalog.pg_control_system() AS s),
         pg_catalog.shobj_description(
           (SELECT d.oid FROM pg_catalog.pg_database AS d WHERE d.datname = current_database()),
           'pg_database'
         )
    INTO got_name, got_id, got_comment;
  IF got_name IS DISTINCT FROM {expected_name_sql}
     OR got_id IS DISTINCT FROM {expected_id_sql}
     OR got_comment IS DISTINCT FROM {expected_comment_sql} THEN
    RAISE EXCEPTION 'identity mismatch';
  END IF;
END
$$;
{rollback}
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'salon_app') THEN
    CREATE ROLE salon_app LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'salon_migrator') THEN
    CREATE ROLE salon_migrator LOGIN;
  END IF;
END
$$;

ALTER ROLE salon_app WITH
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT LOGIN
  CONNECTION LIMIT 20
  PASSWORD {app_sql};
ALTER ROLE salon_migrator WITH
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT LOGIN
  CONNECTION LIMIT 5
  PASSWORD {migrator_sql};
ALTER ROLE salon_app SET statement_timeout = '30s';
ALTER ROLE salon_app SET lock_timeout = '5s';
ALTER ROLE salon_app SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE salon_migrator RESET statement_timeout;
ALTER ROLE salon_migrator RESET lock_timeout;
ALTER ROLE salon_migrator RESET idle_in_transaction_session_timeout;

REVOKE salon FROM salon_app;
REVOKE salon FROM salon_migrator;
REVOKE salon_migrator FROM salon_app;
REVOKE salon_app FROM salon_migrator;

GRANT CONNECT ON DATABASE {database} TO salon_app, salon_migrator;
REVOKE CONNECT ON DATABASE {database} FROM PUBLIC;
GRANT CONNECT ON DATABASE {database} TO salon;

DO $$
DECLARE
  rel record;
  fn record;
  typ record;
BEGIN
  FOR rel IN
    SELECT n.nspname, c.relname, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = 'salon')
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
  LOOP
    EXECUTE format(
      'ALTER %s %I.%I OWNER TO salon_migrator',
      CASE rel.relkind
        WHEN 'r' THEN 'TABLE'
        WHEN 'p' THEN 'TABLE'
        WHEN 'v' THEN 'VIEW'
        WHEN 'm' THEN 'MATERIALIZED VIEW'
        WHEN 'S' THEN 'SEQUENCE'
        WHEN 'f' THEN 'FOREIGN TABLE'
      END,
      rel.nspname,
      rel.relname
    );
  END LOOP;
  FOR fn IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proowner = (SELECT oid FROM pg_roles WHERE rolname = 'salon')
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) OWNER TO salon_migrator',
      fn.nspname, fn.proname, fn.args
    );
  END LOOP;
  FOR typ IN
    SELECT n.nspname, t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typowner = (SELECT oid FROM pg_roles WHERE rolname = 'salon')
      AND t.typtype IN ('e', 'd')
  LOOP
    EXECUTE format('ALTER TYPE %I.%I OWNER TO salon_migrator', typ.nspname, typ.typname);
  END LOOP;
END
$$;
ALTER SCHEMA public OWNER TO salon_migrator;
GRANT USAGE ON SCHEMA public TO salon_app;
GRANT USAGE, CREATE ON SCHEMA public TO salon_migrator;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO salon_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO salon_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO salon_app;
ALTER DEFAULT PRIVILEGES FOR ROLE salon_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO salon_app;
ALTER DEFAULT PRIVILEGES FOR ROLE salon_migrator IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO salon_app;
ALTER DEFAULT PRIVILEGES FOR ROLE salon_migrator IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO salon_app;

CREATE OR REPLACE FUNCTION public.canonical_database_identity()
RETURNS TABLE(database_name text, system_identifier text, database_comment text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT current_database(),
         (SELECT s.system_identifier::text FROM pg_catalog.pg_control_system() AS s),
         pg_catalog.shobj_description(
           (SELECT d.oid FROM pg_catalog.pg_database AS d WHERE d.datname = current_database()),
           'pg_database'
         );
$$;
ALTER FUNCTION public.canonical_database_identity() OWNER TO salon;
REVOKE ALL ON FUNCTION public.canonical_database_identity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.canonical_database_identity() TO salon_app, salon_migrator;
REVOKE ALL ON FUNCTION pg_catalog.pg_control_system() FROM PUBLIC;
REVOKE ALL ON FUNCTION pg_catalog.pg_control_system() FROM salon_app;
REVOKE ALL ON FUNCTION pg_catalog.pg_control_system() FROM salon_migrator;

DO $$
DECLARE
  col text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_database WHERE datname = 'salon_opp_integrity_20261024') THEN
    EXECUTE 'REVOKE CONNECT ON DATABASE salon_opp_integrity_20261024 FROM PUBLIC';
    EXECUTE 'GRANT CONNECT ON DATABASE salon_opp_integrity_20261024 TO salon';
    EXECUTE 'REVOKE CONNECT ON DATABASE salon_opp_integrity_20261024 FROM salon_app';
    EXECUTE 'REVOKE CONNECT ON DATABASE salon_opp_integrity_20261024 FROM salon_migrator';
  END IF;
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public."_prisma_migrations" FROM salon_app';
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public."_prisma_migrations" FROM PUBLIC';
  END IF;
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.audit_logs FROM salon_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.audit_logs FROM PUBLIC;
    GRANT SELECT, INSERT ON TABLE public.audit_logs TO salon_app;
    FOR col IN
      SELECT attname::text
      FROM pg_attribute
      WHERE attrelid = 'public.audit_logs'::regclass
        AND attnum > 0
        AND NOT attisdropped
    LOOP
      EXECUTE format('REVOKE UPDATE (%I) ON TABLE public.audit_logs FROM salon_app, PUBLIC', col);
    END LOOP;
  END IF;
END
$$;

{operator_sql}
COMMIT;
"""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--container", required=True)
    parser.add_argument("--database", required=True)
    parser.add_argument("--secrets-file", required=True, type=Path)
    parser.add_argument("--expected-database", required=True)
    parser.add_argument("--expected-system-identifier", required=True)
    parser.add_argument("--expected-comment", required=True)
    parser.add_argument("--rotate-operator", action="store_true")
    parser.add_argument("--fail-after-identity", action="store_true")
    args = parser.parse_args()
    secrets = load_secrets(args.secrets_file)
    operator = secrets.get("OPERATOR_PASSWORD") if args.rotate_operator else None
    hidden = [secrets.get("APP_PASSWORD", ""), secrets.get("MIGRATOR_PASSWORD", ""), operator or ""]
    statement = sql(
        args.database,
        secrets["APP_PASSWORD"],
        secrets["MIGRATOR_PASSWORD"],
        operator,
        args.expected_database,
        args.expected_system_identifier,
        args.expected_comment,
        args.fail_after_identity,
    )
    result = subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            args.container,
            "psql",
            "-U",
            "salon",
            "-d",
            args.database,
            "-v",
            "ON_ERROR_STOP=1",
            "-q",
        ],
        input=statement,
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        safe = redact(result.stderr + "\n" + result.stdout, hidden)
        if "identity mismatch" in (result.stderr + result.stdout):
            sys.stderr.write("identity mismatch\n")
            raise SystemExit(2)
        if "forced rollback" in (result.stderr + result.stdout):
            sys.stderr.write("forced rollback\n")
            raise SystemExit(3)
        sys.stderr.write("role apply failed\n")
        if safe:
            sys.stderr.write(safe + "\n")
        raise SystemExit(result.returncode)
    print("ROLE_APPLY_OK")


if __name__ == "__main__":
    main()
