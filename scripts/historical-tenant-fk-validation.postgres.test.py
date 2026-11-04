#!/usr/bin/env python3
"""Disposable PostgreSQL rehearsal for the tenant-composite FK validation migration.

The fixture first deploys the real predecessor migration set, then invokes
Prisma's migration runner against a workspace that symlinks the actual
repository migrations.  No candidate SQL is copied or rewritten.
"""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import unittest
import uuid


ROOT = Path(__file__).resolve().parents[1]
CONTAINER = os.environ.get("HISTORICAL_FK_TEST_CONTAINER", "salon-task-receipt-pg-20261102")
PORT = os.environ.get("HISTORICAL_FK_TEST_PORT", "15530")
CANDIDATE = "20261102100000_validate_historical_tenant_composite_fks"
CONSTRAINTS = (
    ("opportunity_actions", "opportunity_actions_created_by_salon_id_fkey"),
    ("message_requests", "message_requests_created_by_user_id_salon_id_fkey"),
    ("message_deliveries", "message_deliveries_created_by_salon_id_fkey"),
    ("vip_requests", "vip_requests_created_by_user_id_salon_id_fkey"),
    ("vip_request_recipients", "vip_request_recipients_message_request_id_salon_id_fkey"),
)


def run(command: list[str], *, env: dict[str, str] | None = None, input: str | None = None, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, cwd=ROOT, env=env, input=input, text=True, capture_output=True)
    if check and result.returncode:
        output = "\n".join((result.stdout + result.stderr).splitlines()[-16:])
        raise AssertionError(f"command failed ({result.returncode}): {' '.join(command)}\n{output}")
    return result


def q(database: str, statement: str, *, user: str = "salon", check: bool = True) -> subprocess.CompletedProcess[str]:
    return run([
        "docker", "exec", "-i", CONTAINER, "psql", "-X", "-v", "ON_ERROR_STOP=1",
        "-U", user, "-d", database, "-tA", "-f", "-",
    ], input=statement, check=check)


def value(database: str, statement: str, *, user: str = "salon") -> str:
    return q(database, statement, user=user).stdout.strip()


def uid(number: int) -> str:
    return f"10000000-0000-0000-0000-{number:012d}"


class TenantCompositeFkValidationPostgresTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if not CONTAINER.startswith("salon-task-"):
            raise unittest.SkipTest("refusing a non-task-owned container")
        running = run(["docker", "inspect", "-f", "{{.State.Running}}", CONTAINER], check=False)
        if running.returncode or running.stdout.strip() != "true":
            raise unittest.SkipTest("task-owned PostgreSQL container is unavailable")
        cls.system_identifier = value("postgres", "SELECT system_identifier::text FROM pg_control_system();")
        if not cls.system_identifier.isdigit():
            raise unittest.SkipTest("task cluster identity is unavailable")
        cls.created: list[tuple[str, str]] = []

    @classmethod
    def new_database(cls, label: str) -> tuple[str, str]:
        name = f"salon_fk_gate2_{label}_{uuid.uuid4().hex[:10]}"
        comment = f"tenant-fk-gate2:20261103:{label}"
        run(["docker", "exec", CONTAINER, "createdb", "-U", "salon", name])
        q("postgres", f"COMMENT ON DATABASE \"{name}\" IS '{comment}';")
        actual_comment = value("postgres", f"SELECT coalesce(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname='{name}';")
        if actual_comment != comment:
            raise AssertionError("disposable database comment guard failed")
        cls.created.append((name, comment))
        return name, comment

    @staticmethod
    def migration_workspace(include_candidate: bool) -> tempfile.TemporaryDirectory[str]:
        workspace = tempfile.TemporaryDirectory(prefix="salon-fk-gate2-")
        root = Path(workspace.name)
        shutil.copy2(ROOT / "packages/database/prisma/schema.prisma", root / "schema.prisma")
        migrations = root / "migrations"
        migrations.mkdir()
        # Prisma intentionally does not discover symlinked migration directories.
        # Hard links preserve the exact candidate bytes and checksum without
        # producing a rewritten SQL copy.
        os.link(
            ROOT / "packages/database/prisma/migrations/migration_lock.toml",
            migrations / "migration_lock.toml",
        )
        for source in sorted((ROOT / "packages/database/prisma/migrations").iterdir()):
            if not source.is_dir():
                continue
            if source.name == CANDIDATE and not include_candidate:
                continue
            target = migrations / source.name
            target.mkdir()
            os.link(source / "migration.sql", target / "migration.sql")
        return workspace

    @classmethod
    def prisma_deploy(cls, database: str, *, include_candidate: bool) -> subprocess.CompletedProcess[str]:
        with cls.migration_workspace(include_candidate) as tmp:
            environment = os.environ.copy()
            environment["DATABASE_URL"] = f"postgresql://salon_migrator@127.0.0.1:{PORT}/{database}"
            return run([
                "pnpm", "--filter", "@salon/database", "exec", "prisma", "migrate", "deploy",
                "--schema", str(Path(tmp) / "schema.prisma"),
            ], env=environment, check=False)

    @classmethod
    def provision_roles(cls, database: str, comment: str) -> None:
        with tempfile.NamedTemporaryFile("w", delete=False) as secrets:
            secrets.write("APP_PASSWORD=gate2-app-local\nMIGRATOR_PASSWORD=gate2-migrator-local\n")
            secret_path = Path(secrets.name)
        try:
            secret_path.chmod(stat.S_IRUSR | stat.S_IWUSR)
            result = run([
                sys.executable, str(ROOT / "scripts/apply-canonical-database-access.py"),
                "--container", CONTAINER, "--database", database, "--secrets-file", str(secret_path),
                "--expected-database", database, "--expected-system-identifier", cls.system_identifier,
                "--expected-comment", comment,
            ], check=False)
            if result.returncode or "ROLE_APPLY_OK" not in result.stdout:
                raise AssertionError("disposable role provisioning failed")
        finally:
            secret_path.unlink(missing_ok=True)

    @classmethod
    def predecessor(cls, label: str) -> tuple[str, str]:
        database, comment = cls.new_database(label)
        cls.provision_roles(database, comment)
        result = cls.prisma_deploy(database, include_candidate=False)
        if result.returncode:
            raise AssertionError("predecessor migration deployment failed")
        # Reapply after Prisma creates the ledger so the runtime role cannot see it.
        cls.provision_roles(database, comment)
        unfinished = value(database, "SELECT count(*) FROM \"_prisma_migrations\" WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;")
        applied = value(database, "SELECT count(*) FROM \"_prisma_migrations\";")
        if unfinished != "0" or applied != "45":
            raise AssertionError("predecessor ledger is not clean")
        return database, comment

    @staticmethod
    def row_fingerprint(database: str) -> str:
        return value(database, """
          SELECT concat_ws('|',
            (SELECT count(*)::text || ':' || coalesce(string_agg(id::text, ',' ORDER BY id::text), '') FROM salons),
            (SELECT count(*)::text || ':' || coalesce(string_agg(id::text, ',' ORDER BY id::text), '') FROM users),
            (SELECT count(*)::text || ':' || coalesce(string_agg(id::text, ',' ORDER BY id::text), '') FROM opportunity_actions),
            (SELECT count(*)::text || ':' || coalesce(string_agg(id::text, ',' ORDER BY id::text), '') FROM message_requests),
            (SELECT count(*)::text || ':' || coalesce(string_agg(id::text, ',' ORDER BY id::text), '') FROM message_deliveries),
            (SELECT count(*)::text || ':' || coalesce(string_agg(id::text, ',' ORDER BY id::text), '') FROM vip_requests),
            (SELECT count(*)::text || ':' || coalesce(string_agg(id::text, ',' ORDER BY id::text), '') FROM vip_request_recipients),
            (SELECT count(*)::text || ':' || coalesce(string_agg(id::text, ',' ORDER BY id::text), '') FROM transactions),
            (SELECT count(*)::text || ':' || coalesce(string_agg(id::text, ',' ORDER BY id::text), '') FROM transaction_items)
          );
        """)

    @staticmethod
    def validation_state(database: str) -> dict[str, str]:
        rows = q(database, """
          SELECT conrelid::regclass::text || '|' || conname || '|' || convalidated
          FROM pg_constraint
          WHERE conname IN (
            'opportunity_actions_created_by_salon_id_fkey',
            'message_requests_created_by_user_id_salon_id_fkey',
            'message_deliveries_created_by_salon_id_fkey',
            'vip_requests_created_by_user_id_salon_id_fkey',
            'vip_request_recipients_message_request_id_salon_id_fkey'
          ) ORDER BY conname;
        """).stdout.splitlines()
        return {line.split("|")[1]: line.split("|")[2] for line in rows if line}

    def test_01_clean_predecessor_applies_actual_candidate_as_migrator(self) -> None:
        database, _ = self.predecessor("clean")
        before = self.row_fingerprint(database)
        result = self.prisma_deploy(database, include_candidate=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(before, self.row_fingerprint(database))
        self.assertEqual(set(self.validation_state(database)), {constraint for _, constraint in CONSTRAINTS})
        self.assertTrue(all(state == "true" for state in self.validation_state(database).values()))
        ledger = value(database, f"""
          SELECT CASE WHEN count(*)=1 AND bool_and(finished_at IS NOT NULL) AND bool_and(rolled_back_at IS NULL)
            THEN 'successful' ELSE 'unexpected' END
          FROM \"_prisma_migrations\" WHERE migration_name='{CANDIDATE}';
        """)
        self.assertEqual(ledger, "successful")

    def test_02_dirty_predecessor_fails_on_first_actual_constraint_and_keeps_history(self) -> None:
        database, _ = self.predecessor("dirty")
        q(database, f"""
          SET session_replication_role = replica;
          INSERT INTO salons (id,name,updated_at) VALUES
            ('{uid(1)}','fixture salon one',clock_timestamp()), ('{uid(2)}','fixture salon two',clock_timestamp());
          INSERT INTO users (id,salon_id,name,password_hash,role,phone,updated_at) VALUES
            ('{uid(3)}','{uid(1)}','fixture one','fixture','OWNER','09111111111',clock_timestamp()),
            ('{uid(4)}','{uid(2)}','fixture two','fixture','OWNER','09222222222',clock_timestamp());
          INSERT INTO opportunity_actions (id,salon_id,customer_id,opportunity_type,status,created_by,updated_at) VALUES
            ('{uid(5)}','{uid(1)}','{uid(6)}','CUSTOMER_RETURN','OPEN','{uid(4)}',clock_timestamp());
          SET session_replication_role = origin;
        """)
        before = self.row_fingerprint(database)
        result = self.prisma_deploy(database, include_candidate=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("opportunity_actions_created_by_salon_id_fkey", result.stdout + result.stderr)
        self.assertEqual(before, self.row_fingerprint(database))
        self.assertTrue(all(state == "false" for state in self.validation_state(database).values()))
        ledger = value(database, f"""
          SELECT CASE WHEN count(*)=1 AND bool_and(finished_at IS NULL) AND bool_and(rolled_back_at IS NULL)
            THEN 'failed-unresolved' ELSE 'unexpected' END
          FROM \"_prisma_migrations\" WHERE migration_name='{CANDIDATE}';
        """)
        self.assertEqual(ledger, "failed-unresolved")

    def test_03_nullable_recipient_link_is_valid_history(self) -> None:
        database, _ = self.predecessor("nullable")
        q(database, f"""
          SET session_replication_role = replica;
          INSERT INTO salons (id,name,updated_at) VALUES ('{uid(21)}','fixture salon',clock_timestamp());
          INSERT INTO users (id,salon_id,name,password_hash,role,phone,updated_at) VALUES
            ('{uid(22)}','{uid(21)}','fixture owner','fixture','OWNER','09333333333',clock_timestamp());
          INSERT INTO platform_admins (id,email,password_hash,name,phone,updated_at) VALUES
            ('{uid(23)}','fixture-admin@example.invalid','fixture','fixture admin','09444444444',clock_timestamp());
          INSERT INTO vip_target_lists (id,name,status,contact_count,created_by_admin_id,updated_at) VALUES
            ('{uid(24)}','fixture list','PENDING',1,'{uid(23)}',clock_timestamp());
          INSERT INTO vip_target_contacts (id,list_id,sort_order,display_name,phone_number) VALUES
            ('{uid(25)}','{uid(24)}',1,'fixture contact','09444444444');
          INSERT INTO vip_requests (id,salon_id,list_id,created_by_user_id,requested_count,geographic_range,status,reserved_until,cancelled_at,updated_at) VALUES
            ('{uid(26)}','{uid(21)}','{uid(24)}','{uid(22)}',30,'fixture','CANCELLED',clock_timestamp(),clock_timestamp(),clock_timestamp());
          INSERT INTO vip_request_recipients (id,vip_request_id,salon_id,sort_order,source_contact_id,display_name,phone_number,message_text,message_request_id) VALUES
            ('{uid(27)}','{uid(26)}','{uid(21)}',1,'{uid(25)}','fixture','09555555555','fixture',NULL);
          SET session_replication_role = origin;
        """)
        result = self.prisma_deploy(database, include_candidate=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(all(state == "true" for state in self.validation_state(database).values()))

    def test_04_lock_timeout_fails_bounded_then_a_clean_fixture_succeeds(self) -> None:
        blocked, _ = self.predecessor("locked")
        holder = subprocess.Popen([
            "docker", "exec", "-i", CONTAINER, "psql", "-X", "-U", "salon", "-d", blocked,
            "-v", "ON_ERROR_STOP=1", "-c", "BEGIN; LOCK TABLE opportunity_actions IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(7); COMMIT;",
        ], text=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        time.sleep(0.5)
        started = time.monotonic()
        blocked_result = self.prisma_deploy(blocked, include_candidate=True)
        elapsed = time.monotonic() - started
        _, holder_stderr = holder.communicate(timeout=12)
        self.assertNotEqual(blocked_result.returncode, 0)
        self.assertGreaterEqual(elapsed, 4.5)
        self.assertLess(elapsed, 6.8)
        self.assertIn("lock timeout", (blocked_result.stdout + blocked_result.stderr).lower())
        self.assertEqual(holder.returncode, 0, holder_stderr)
        self.assertTrue(all(state == "false" for state in self.validation_state(blocked).values()))
        released, _ = self.predecessor("released")
        released_result = self.prisma_deploy(released, include_candidate=True)
        self.assertEqual(released_result.returncode, 0, released_result.stderr)
        self.assertTrue(all(state == "true" for state in self.validation_state(released).values()))

    def test_05_runtime_role_cannot_rewrite_audit_or_read_ledger(self) -> None:
        database, _ = self.predecessor("roles")
        grants = value(database, """
          SELECT concat_ws('|',
            has_table_privilege('salon_app','public.audit_logs','SELECT'),
            has_table_privilege('salon_app','public.audit_logs','INSERT'),
            has_table_privilege('salon_app','public.audit_logs','UPDATE'),
            has_table_privilege('salon_app','public.audit_logs','DELETE'),
            has_table_privilege('salon_app','public.audit_logs','TRUNCATE'),
            has_schema_privilege('salon_app','public','CREATE'),
            has_table_privilege('salon_app','public._prisma_migrations','SELECT'),
            has_table_privilege('salon_app','public._prisma_migrations','INSERT'),
            (SELECT rolsuper::text || ':' || rolcreatedb::text || ':' || rolcreaterole::text || ':' || rolinherit::text FROM pg_roles WHERE rolname='salon_app'),
            (SELECT count(*)::text FROM pg_auth_members m JOIN pg_roles member ON member.oid=m.member JOIN pg_roles parent ON parent.oid=m.roleid WHERE member.rolname='salon_app' AND parent.rolname IN ('salon','salon_migrator'))
          );
        """)
        self.assertEqual(grants, "t|t|f|f|f|f|f|f|false:false:false:false|0")


if __name__ == "__main__":
    unittest.main(verbosity=2)
