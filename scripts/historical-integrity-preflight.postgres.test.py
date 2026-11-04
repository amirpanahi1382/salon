#!/usr/bin/env python3
"""Real PostgreSQL coverage for the read-only historical integrity preflight.

This test deliberately builds a new, named database in the task-owned Docker
cluster.  The bad rows use ``session_replication_role = replica`` only in the
fixture's privileged setup transaction: that is the explicit historical-data
fixture mechanism, not a production constraint bypass.  The preflight itself
runs as the ordinary ``salon`` role and is checked for read-only behaviour.
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import subprocess
import sys
import unittest
import uuid


ROOT = Path(__file__).resolve().parents[1]
PREFLIGHT = ROOT / "scripts" / "historical-integrity-preflight.py"
CONTAINER = os.environ.get("HISTORICAL_PREFLIGHT_TEST_CONTAINER", "salon-task-receipt-pg-20261102")
DATABASE = os.environ.get("HISTORICAL_PREFLIGHT_TEST_DB", f"salon_integrity_gate1_{os.getpid()}")
COMMENT = "historical-integrity-gate1:20261102"


def run(args: list[str], *, input: str | None = None, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, input=input, text=True, capture_output=True)
    if check and result.returncode:
        raise AssertionError(f"command failed ({result.returncode}): {' '.join(args)}\n{result.stderr}")
    return result


def psql(sql: str, *, database: str = DATABASE, user: str = "postgres", check: bool = True) -> subprocess.CompletedProcess[str]:
    return run([
        "docker", "exec", "-i", CONTAINER, "psql", "-X", "-v", "ON_ERROR_STOP=1",
        "-U", user, "-d", database, "-tA", "-f", "-",
    ], input=sql, check=check)


def uuid_at(n: int) -> str:
    return f"00000000-0000-0000-0000-{n:012d}"


class HistoricalIntegrityPreflightPostgresTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if not CONTAINER.startswith("salon-task-"):
            raise unittest.SkipTest("refusing a non-task-owned PostgreSQL container")
        state = run(["docker", "inspect", "-f", "{{.State.Running}}", CONTAINER], check=False)
        if state.returncode or state.stdout.strip() != "true":
            raise unittest.SkipTest("task-owned PostgreSQL container is unavailable")
        exists = run([
            "docker", "exec", CONTAINER, "psql", "-X", "-U", "postgres", "-d", "postgres",
            "-tAc", f"SELECT 1 FROM pg_database WHERE datname = '{DATABASE}'",
        ])
        if exists.stdout.strip():
            raise RuntimeError(f"refusing to reuse existing test database {DATABASE}")
        run(["docker", "exec", CONTAINER, "createdb", "-U", "postgres", DATABASE])
        for migration in sorted((ROOT / "packages/database/prisma/migrations").glob("*/migration.sql")):
            psql(migration.read_text(), check=True)
        psql(f"COMMENT ON DATABASE \"{DATABASE}\" IS '{COMMENT}';")
        cls.system_identifier = psql("SELECT system_identifier::text FROM pg_control_system();").stdout.strip()
        # The test uses a normal local role for the successful read-only run and
        # a CONNECT-only role to prove the operational/privilege failure path.
        psql("""
            DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'salon_gate1_limited') THEN
                CREATE ROLE salon_gate1_limited LOGIN;
              END IF;
            END $$;
        """)

    @classmethod
    def preflight(cls, *, user: str = "salon", system_id: str | None = None, comment: str | None = None, limit: int = 1) -> subprocess.CompletedProcess[str]:
        return run([
            sys.executable, str(PREFLIGHT), "--container", CONTAINER, "--database", DATABASE,
            "--expected-system-identifier", system_id or cls.system_identifier,
            "--expected-comment", comment or COMMENT, "--user", user, "--sample-limit", str(limit),
        ], check=False)

    @staticmethod
    def fingerprint() -> str:
        # A schema + data fingerprint deliberately excludes post-fixture setup
        # such as PostgreSQL statistics.  The preflight must not alter any of it.
        result = psql("""
          SELECT coalesce(string_agg(relname || ':' || n_live_tup, ',' ORDER BY relname), '')
          FROM pg_stat_user_tables;
          SELECT coalesce(string_agg(conrelid::regclass::text || ':' || conname || ':' || convalidated, ',' ORDER BY conrelid::regclass::text, conname), '')
          FROM pg_constraint WHERE connamespace = 'public'::regnamespace;
          SELECT has_database_privilege('salon_gate1_limited', current_database(), 'CONNECT');
        """).stdout
        return hashlib.sha256(result.encode()).hexdigest()

    def test_01_clean_history_is_clear_and_read_only(self) -> None:
        before = self.fingerprint()
        result = self.preflight()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"identity|{DATABASE}", result.stdout)
        self.assertIn("preflight=clear", result.stdout)
        self.assertEqual(before, self.fingerprint())

    def test_02_identity_and_privilege_fail_closed(self) -> None:
        wrong_identity = self.preflight(comment="wrong-task-comment")
        self.assertEqual(wrong_identity.returncode, 1)
        self.assertIn("database identity does not match", wrong_identity.stderr)
        before = self.fingerprint()
        limited = self.preflight(user="salon_gate1_limited")
        self.assertEqual(limited.returncode, 1)
        self.assertIn("preflight operational failure", limited.stderr)
        self.assertEqual(before, self.fingerprint())

    def test_03_detects_historical_conflicts_without_exposing_fixture_data(self) -> None:
        s1, s2, u1, u2 = (uuid_at(n) for n in range(1, 5))
        missing_user, missing_request, customer, service = (uuid_at(n) for n in range(5, 9))
        # All values are synthetic. The production checks and FKs are not
        # modified; replica mode is scoped to this isolated fixture session.
        psql(f"""
          SET session_replication_role = replica;
          INSERT INTO salons (id,name,updated_at) VALUES
            ('{s1}','fixture salon one',clock_timestamp()), ('{s2}','fixture salon two',clock_timestamp());
          INSERT INTO users (id,salon_id,name,password_hash,role,phone,updated_at) VALUES
            ('{u1}','{s1}','fixture owner one','fixture-hash','OWNER','09111111111',clock_timestamp()),
            ('{u2}','{s2}','fixture owner two','fixture-hash','OWNER','09222222222',clock_timestamp());
          INSERT INTO opportunity_actions (id,salon_id,customer_id,opportunity_type,status,created_by,updated_at) VALUES
            ('{uuid_at(11)}','{s1}','{customer}','CUSTOMER_RETURN','OPEN','{u2}',clock_timestamp()),
            ('{uuid_at(12)}','{s1}','{customer}','REVENUE_DECLINE','OPEN','{missing_user}',clock_timestamp());
          INSERT INTO message_requests (id,salon_id,customer_id,created_by_user_id,message_text,message_business_date,counts_toward_daily_limit,status,updated_at) VALUES
            ('{uuid_at(21)}','{s1}','{customer}','{u2}','fixture message one',CURRENT_DATE,false,'QUEUED',clock_timestamp()),
            ('{uuid_at(22)}','{s1}','{customer}','{missing_user}','fixture message two',CURRENT_DATE,false,'QUEUED',clock_timestamp()),
            ('{uuid_at(23)}','{s2}','{customer}','{u2}','fixture message three',CURRENT_DATE,false,'QUEUED',clock_timestamp());
          INSERT INTO message_deliveries (id,salon_id,channel,status,provider_request_id,created_by,updated_at,message_request_id,mode) VALUES
            ('{uuid_at(31)}','{s1}','TEXT','PENDING','fixture-delivery-one','{u2}',clock_timestamp(),'{uuid_at(21)}','MANUAL'),
            ('{uuid_at(32)}','{s1}','TEXT','PENDING','fixture-delivery-two','{missing_user}',clock_timestamp(),'{uuid_at(22)}','MANUAL');
          INSERT INTO vip_requests (id,salon_id,list_id,created_by_user_id,requested_count,geographic_range,status,reserved_until,cancelled_at,updated_at) VALUES
            ('{uuid_at(41)}','{s1}','{uuid_at(101)}','{u2}',30,'fixture','CANCELLED',clock_timestamp(),clock_timestamp(),clock_timestamp()),
            ('{uuid_at(42)}','{s1}','{uuid_at(102)}','{missing_user}',30,'fixture','CANCELLED',clock_timestamp(),clock_timestamp(),clock_timestamp()),
            ('{uuid_at(43)}','{s1}','{uuid_at(103)}','{u1}',30,'fixture','CANCELLED',clock_timestamp(),clock_timestamp(),clock_timestamp());
          INSERT INTO vip_request_recipients (id,vip_request_id,salon_id,sort_order,source_contact_id,display_name,phone_number,message_text,message_request_id) VALUES
            ('{uuid_at(51)}','{uuid_at(41)}','{s1}',1,'{uuid_at(111)}','fixture','09333333333','fixture recipient','{uuid_at(23)}'),
            ('{uuid_at(52)}','{uuid_at(42)}','{s1}',1,'{uuid_at(112)}','fixture','09444444444','fixture recipient','{missing_request}'),
            ('{uuid_at(53)}','{uuid_at(43)}','{s1}',1,'{uuid_at(113)}','fixture','09555555555','fixture recipient',NULL);
          INSERT INTO transactions (id,salon_id,customer_id,occurred_at,amount,updated_at) VALUES
            ('{uuid_at(61)}','{s1}','{customer}',clock_timestamp(),10.00,clock_timestamp()),
            ('{uuid_at(62)}','{s1}','{customer}',clock_timestamp(),9.00,clock_timestamp()),
            ('{uuid_at(63)}','{s1}','{customer}',clock_timestamp(),0.00,clock_timestamp()),
            ('{uuid_at(64)}','{s1}','{customer}',clock_timestamp(),1.50,clock_timestamp());
          INSERT INTO transaction_items (id,salon_id,transaction_id,service_id,quantity,unit_price,total_amount) VALUES
            ('{uuid_at(71)}','{s1}','{uuid_at(61)}','{service}',1,9.00,9.00),
            ('{uuid_at(72)}','{s1}','{uuid_at(62)}','{service}',1,9.00,8.00),
            ('{uuid_at(73)}','{s1}','{uuid_at(63)}','{service}',1,0.00,0.00),
            ('{uuid_at(74)}','{s1}','{uuid_at(64)}','{service}',3,0.50,1.50),
            ('{uuid_at(75)}','{s1}','{uuid_at(999)}','{service}',1,1.00,1.00);
          SET session_replication_role = origin;
        """)
        before = self.fingerprint()
        result = self.preflight(limit=1)
        self.assertEqual(result.returncode, 2, result.stderr)
        expected = {
            "opportunity_actions.created_by": 2,
            "message_requests.created_by_user_id": 2,
            "message_deliveries.created_by": 2,
            "vip_requests.created_by_user_id": 2,
            "vip_request_recipients.message_request_id": 2,
            "missing_items": 0,
            "header_sum_mismatch": 2,
            "item_math_mismatch": 1,
            "orphan_item_relation": 1,
        }
        observed = {}
        for line in result.stdout.splitlines():
            if line.startswith(("relation|", "financial|")):
                _, kind, count, sample = line.split("|", 3)
                observed[kind] = int(count)
                self.assertLessEqual(len([v for v in sample.split(",") if v]), 1, line)
        self.assertEqual(observed, expected)
        self.assertIn("preflight=conflicts", result.stdout)
        for forbidden in ("09111111111", "09222222222", "fixture message", "fixture-hash", "fixture-delivery"):
            self.assertNotIn(forbidden, result.stdout + result.stderr)
        self.assertEqual(before, self.fingerprint())


if __name__ == "__main__":
    unittest.main(verbosity=2)
