#!/usr/bin/env python3
"""Rehearse canonical migration cleanup on one disposable cluster.

Expected identity is an argument. This script refuses the canonical and
historical system identifiers and deletes its temporary migration afterward.
"""
from __future__ import annotations

import argparse
import os
import stat
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROBE = "stage3_migrate_probe"
ABSENT = "stage3_ledger_absent"
MISMATCH = "stage3_mismatch"
COMMENT = "stage3-migrate-probe:20261027"
MIGRATION = ROOT / "packages/database/prisma/migrations/20261027193000_stage3_failure_probe"
REFUSED = {"7700113693112733735", "7683163620851879970"}


def run(command: list[str], env: dict[str, str] | None = None, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, text=True, capture_output=True, env=env, cwd=ROOT)
    if check and result.returncode != 0:
        tail = "\n".join((result.stderr + result.stdout).splitlines()[-20:])
        raise SystemExit(f"command failed: {command[0]} {command[-1]}\n{tail}")
    return result


def psql(container: str, database: str, sql: str) -> str:
    completed = subprocess.run(
        ["docker", "exec", "-i", container, "psql", "-U", "salon", "-d", database, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
        input=sql,
        text=True,
        capture_output=True,
    )
    if completed.returncode != 0:
        raise SystemExit("probe query failed")
    return completed.stdout.strip()


def privileges(container: str, database: str) -> str:
    return psql(
        container,
        database,
        """
        SELECT coalesce(string_agg(grantee || ':' || privilege_type, ',' ORDER BY grantee, privilege_type), '<none>')
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = '_prisma_migrations'
          AND grantee IN ('salon_app', 'PUBLIC')
        """,
    )


def audit_privileges(container: str, database: str) -> str:
    return psql(
        container,
        database,
        """
        SELECT coalesce(string_agg(privilege_type, ',' ORDER BY privilege_type), '<absent>')
        FROM (
          SELECT privilege_type
          FROM information_schema.role_table_grants
          WHERE table_schema = 'public'
            AND table_name = 'audit_logs'
            AND grantee = 'salon_app'
          UNION
          SELECT privilege_type || ':column'
          FROM information_schema.column_privileges
          WHERE table_schema = 'public'
            AND table_name = 'audit_logs'
            AND grantee IN ('salon_app', 'PUBLIC')
            AND privilege_type IN ('UPDATE', 'DELETE')
        ) granted
        """,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--container", required=True)
    parser.add_argument("--port", required=True)
    parser.add_argument("--expected-system-identifier", required=True)
    args = parser.parse_args()
    if args.expected_system_identifier in REFUSED:
        raise SystemExit("refusing a canonical or historical system identifier")
    if args.container in {"salon-platform-postgres-1", "salon-phone-first-empty-pg-20261024T061347Z"}:
        raise SystemExit("refusing a protected container")
    live = psql(args.container, "postgres", "SELECT system_identifier::text FROM pg_control_system()")
    if live != args.expected_system_identifier:
        raise SystemExit("probe identity mismatch")
    for database in (PROBE, ABSENT, MISMATCH):
        exists = psql(args.container, "postgres", f"SELECT count(*)::text FROM pg_database WHERE datname = '{database}'")
        if exists == "0":
            subprocess.run(
                ["docker", "exec", "-i", args.container, "psql", "-U", "salon", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", f"CREATE DATABASE {database}"],
                check=True,
                text=True,
            )
        psql(args.container, database, f"COMMENT ON DATABASE {database} IS '{COMMENT}'")
    secrets = tempfile.NamedTemporaryFile("w", delete=False)
    try:
        os.chmod(secrets.name, stat.S_IRUSR | stat.S_IWUSR)
        secrets.write("APP_PASSWORD=stage3-app-probe\nMIGRATOR_PASSWORD=stage3-migrator-probe\n")
        secrets.close()
        for database in (PROBE, ABSENT, MISMATCH):
            applied = subprocess.run(
                [
                    "python3",
                    str(ROOT / "scripts/apply-canonical-database-access.py"),
                    "--container",
                    args.container,
                    "--database",
                    database,
                    "--secrets-file",
                    secrets.name,
                    "--expected-database",
                    database,
                    "--expected-system-identifier",
                    args.expected_system_identifier,
                    "--expected-comment",
                    COMMENT,
                ],
                text=True,
                capture_output=True,
                cwd=ROOT,
            )
            if applied.returncode != 0 or "ROLE_APPLY_OK" not in applied.stdout:
                raise SystemExit("role apply failed on the disposable probe")
    finally:
        os.unlink(secrets.name)

    MIGRATION.mkdir(parents=True)
    (MIGRATION / "migration.sql").write_text(
        "CREATE TABLE \"stage3_failure_probe\" (\"id\" integer PRIMARY KEY);\n"
        "INSERT INTO \"stage3_failure_probe\" (\"id\") VALUES (1);\n"
        "INSERT INTO \"stage3_failure_probe\" (\"id\") VALUES (1);\n"
    )
    env = os.environ.copy()
    env.update(
        {
            "DATABASE_URL": f"postgresql://salon_migrator@127.0.0.1:{args.port}/{PROBE}",
            "CANONICAL_DATABASE_NAME": PROBE,
            "CANONICAL_SYSTEM_IDENTIFIER": args.expected_system_identifier,
            "CANONICAL_DATABASE_COMMENT": COMMENT,
        }
    )
    try:
        direct = run(["pnpm", "--filter", "@salon/database", "migrate:deploy"], env=env, check=False)
        if direct.returncode == 0:
            raise SystemExit("the probe migration was expected to fail")
        before = privileges(args.container, PROBE)
        if "salon_app:" not in before:
            raise SystemExit("failed deploy did not leave runtime ledger privileges")
        shell = run(["bash", str(ROOT / "scripts/canonical-migrate.sh")], env=env, check=False)
        after = privileges(args.container, PROBE)
        if shell.returncode == 0:
            raise SystemExit("canonical migrate returned success after a failed migration")
        if "CANONICAL_MIGRATE_LEDGER_LOCKED" not in shell.stdout:
            raise SystemExit("failed deploy did not lock the ledger")
        if after != "<none>":
            raise SystemExit("salon_app retained ledger privileges after cleanup")
        audit_after = audit_privileges(args.container, PROBE)
        if audit_after != "INSERT,SELECT":
            raise SystemExit("failed deploy did not leave select/insert-only audit access")
        if str(direct.returncode) != str(shell.returncode):
            raise SystemExit("prisma failure status was not preserved")

        absent_env = env.copy()
        absent_env["DATABASE_URL"] = f"postgresql://salon_migrator@127.0.0.1:{args.port}/{ABSENT}"
        absent_env["CANONICAL_DATABASE_NAME"] = ABSENT
        absent = run(
            ["pnpm", "--filter", "@salon/database", "exec", "node", str(ROOT / "scripts/canonical-migrate-guard.cjs"), "--revoke-ledger"],
            env=absent_env,
            check=False,
        )
        if absent.returncode != 0 or "CANONICAL_MIGRATE_LEDGER_ABSENT" not in absent.stdout:
            raise SystemExit("absent ledger was not handled")

        psql(
            args.container,
            MISMATCH,
            """
            SET ROLE salon_migrator;
            CREATE TABLE public."_prisma_migrations" (id varchar PRIMARY KEY);
            RESET ROLE;
            """,
        )
        mismatch_before = privileges(args.container, MISMATCH)
        if "salon_app:" not in mismatch_before:
            raise SystemExit("mismatch fixture did not grant runtime ledger privileges")
        mismatch_env = env.copy()
        mismatch_env["DATABASE_URL"] = f"postgresql://salon_migrator@127.0.0.1:{args.port}/{MISMATCH}"
        mismatch_env["CANONICAL_DATABASE_NAME"] = MISMATCH
        mismatch_env["CANONICAL_SYSTEM_IDENTIFIER"] = "1"
        mismatch = run(["bash", str(ROOT / "scripts/canonical-migrate.sh")], env=mismatch_env, check=False)
        mismatch_after = privileges(args.container, MISMATCH)
        if mismatch.returncode == 0 or "CANONICAL_MIGRATE_LEDGER_LOCKED" in mismatch.stdout:
            raise SystemExit("identity mismatch reached ledger cleanup")
        if mismatch_after != mismatch_before:
            raise SystemExit("identity mismatch changed ledger privileges")
        print("MIGRATE_FAILURE_REHEARSAL_OK")
        print(f"probe_exit={shell.returncode}")
        print("ledger_privileges_after_failed_deploy=<none>")
        print("absent_ledger=CANONICAL_MIGRATE_LEDGER_ABSENT")
        print("mismatch_privileges_unchanged=true")
    finally:
        if MIGRATION.exists():
            for child in MIGRATION.iterdir():
                child.unlink()
            MIGRATION.rmdir()


if __name__ == "__main__":
    main()
