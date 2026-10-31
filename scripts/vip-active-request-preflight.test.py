#!/usr/bin/env python3
"""Connection doubles and disposable checks for the VIP preflight.

These tests do not start or connect to canonical salon-db. Disposable rows
keep their own comments and system identifier. Canonical expected values are
injected into the script, not copied onto the cluster.
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("vip-active-request-preflight.py")
spec = importlib.util.spec_from_file_location("vip_preflight", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
sys.modules["vip_preflight"] = module
spec.loader.exec_module(module)

Options = module.Options
QueryFailed = module.QueryFailed
build_sql = module.build_sql
run_preflight = module.run_preflight

DISPOSABLE_CONTAINER = "salon-metric-oracle-pg-20261030"
DISPOSABLE_SYSID = "7702523359876800547"
FINAL_DATABASE = "salon_metric_final_gate20261031"
FINAL_COMMENT = "metric-final-disposable:gate20261031"
FAIL_DATABASE = "salon_vip_upgrade_fail_gate20261031"
FAIL_COMMENT = "vip-upgrade-fail-disposable:gate20261031"
CANONICAL_CONTAINER = module.CANONICAL_CONTAINER
FORBIDDEN = (
    "INSERT",
    "UPDATE",
    "DELETE",
    "ALTER",
    "DROP",
    "CREATE",
    "GRANT",
    "REVOKE",
    "TRUNCATE",
    "VACUUM",
    "FOR UPDATE",
    "FOR SHARE",
    "READ WRITE",
    "next_reservation_open",
)


def options(**overrides: object) -> Options:
    values: dict[str, object] = {
        "container": DISPOSABLE_CONTAINER,
        "database": FINAL_DATABASE,
        "expected_comment": FINAL_COMMENT,
        "expected_system_identifier": DISPOSABLE_SYSID,
        "canonical_read_only": False,
        "user": "salon",
        "identifier_limit": 20,
    }
    values.update(overrides)
    return Options(**values)


def response(
    *,
    database: str,
    system_identifier: str,
    comment: str,
    schema: str,
    duplicate_count: int = 0,
    quantity_count: int = 0,
    duplicates: list[str] | None = None,
) -> str:
    rows = [
        "BEGIN",
        "DO",
        f"database_name|{database}",
        f"system_identifier|{system_identifier}",
        f"database_comment|{comment}",
        f"schema|{schema}",
        f"duplicate_count|{duplicate_count}",
        f"quantity_count|{quantity_count}",
    ]
    for row in duplicates or []:
        rows.append(f"duplicate|{row}")
    rows.append("ROLLBACK")
    return "\n".join(rows)


def snapshot(database: str) -> str:
    completed = subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            DISPOSABLE_CONTAINER,
            "psql",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            "salon",
            "-d",
            database,
            "-tA",
            "-c",
            """
            SELECT COUNT(*)::text FROM vip_requests
            UNION ALL
            SELECT COALESCE(md5(string_agg(
              id::text || status::text || requested_count::text,
              ',' ORDER BY id
            )), '')
            FROM vip_requests
            UNION ALL
            SELECT COUNT(*) FILTER (
              WHERE finished_at IS NULL AND rolled_back_at IS NULL
            )::text
            FROM _prisma_migrations
            """,
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise AssertionError(completed.stderr[-300:])
    return completed.stdout.strip()


class SqlShapeTests(unittest.TestCase):
    def test_sql_is_one_read_only_transaction_and_matches_the_index(self) -> None:
        statement = build_sql(options())
        self.assertEqual(statement.count("BEGIN READ ONLY"), 1)
        self.assertEqual(statement.count("ROLLBACK"), 1)
        self.assertNotIn("COMMIT", statement)
        for token in FORBIDDEN:
            self.assertNotIn(token, statement.upper() if token.isupper() else statement)
        for status in module.ACTIVE_STATUSES:
            self.assertEqual(statement.count(status), 3)
        self.assertIn("requested_count < 1 OR requested_count > 500", statement)
        self.assertNotIn("reserved_until <", statement)
        self.assertNotIn("reserved_until >=", statement)
        duplicate_sql = statement.split("SELECT 'duplicate_count|'", 1)[1]
        self.assertNotIn("reserved_until", duplicate_sql)

    def test_canonical_sql_carries_expected_values_without_a_connection(self) -> None:
        statement = build_sql(
            options(
                container=CANONICAL_CONTAINER,
                database=module.CANONICAL_DATABASE_NAME,
                expected_system_identifier=module.CANONICAL_SYSTEM_IDENTIFIER,
                expected_comment=module.CANONICAL_DATABASE_COMMENT,
                canonical_read_only=True,
            )
        )
        self.assertIn("'salon-db'", statement)
        self.assertIn(f"'{module.CANONICAL_SYSTEM_IDENTIFIER}'", statement)
        self.assertIn(f"'{module.CANONICAL_DATABASE_COMMENT}'", statement)
        self.assertIn("canonical_database_identity()", statement)
        self.assertNotIn("postgresql://", statement)


class DoubleTests(unittest.TestCase):
    def test_clean_predecessor_double(self) -> None:
        seen: list[str] = []

        def query(sql: str) -> str:
            seen.append(sql)
            return response(
                database=FINAL_DATABASE,
                system_identifier=DISPOSABLE_SYSID,
                comment=FINAL_COMMENT,
                schema="predecessor",
            )

        with self.assertLogs_from(0) as output:
            code = run_preflight(options(), query)
        self.assertEqual(code, 0)
        self.assertEqual(len(seen), 1)
        self.assertIn("schema=predecessor", output)
        self.assertIn("preflight=clear", output)
        self.assertIn("duplicate_active_salon_list_groups=0", output)

    def test_conflicting_predecessor_is_bounded(self) -> None:
        duplicates = [
            f"11111111-1111-4111-8111-1111111111{index:02d} "
            f"44444444-4444-4444-8444-4444444444{index:02d} 2"
            for index in range(25)
        ]

        def query(sql: str) -> str:
            self.assertIn("BEGIN READ ONLY", sql)
            return response(
                database=FAIL_DATABASE,
                system_identifier=DISPOSABLE_SYSID,
                comment=FAIL_COMMENT,
                schema="predecessor",
                duplicate_count=25,
                duplicates=duplicates,
            )

        with self.assertLogs_from(2) as output:
            code = run_preflight(
                options(database=FAIL_DATABASE, expected_comment=FAIL_COMMENT),
                query,
            )
        self.assertEqual(code, 2)
        self.assertIn("schema=predecessor", output)
        self.assertIn("duplicate_active_salon_list_groups=25", output)
        self.assertIn("duplicate_groups_shown=20", output)
        self.assertIn("duplicate_groups_omitted=5", output)
        self.assertNotIn(duplicates[20], output)
        self.assertIn(duplicates[19], output)

    def test_out_of_range_quantities_are_conflicts(self) -> None:
        code = run_preflight(
            options(),
            lambda sql: response(
                database=FINAL_DATABASE,
                system_identifier=DISPOSABLE_SYSID,
                comment=FINAL_COMMENT,
                schema="final",
                quantity_count=2,
            ),
        )
        self.assertEqual(code, 2)

    def test_final_schema_double_is_clear(self) -> None:
        code = run_preflight(
            options(),
            lambda sql: response(
                database=FINAL_DATABASE,
                system_identifier=DISPOSABLE_SYSID,
                comment=FINAL_COMMENT,
                schema="final",
            ),
        )
        self.assertEqual(code, 0)

    def test_default_mode_refuses_canonical_identity_without_querying(self) -> None:
        def query(sql: str) -> str:
            raise AssertionError("default mode connected")

        cases = [
            options(database="salon-db"),
            options(expected_system_identifier=module.CANONICAL_SYSTEM_IDENTIFIER),
            options(expected_system_identifier=module.PERSISTENT_SYSTEM_IDENTIFIER),
            options(expected_comment=module.CANONICAL_DATABASE_COMMENT),
            options(container=CANONICAL_CONTAINER),
            options(database="salon"),
            options(database="phone_first_product"),
        ]
        for case in cases:
            with self.subTest(database=case.database, comment=case.expected_comment):
                code = run_preflight(case, query)
                self.assertEqual(code, 1)

    def test_canonical_mode_rejects_a_partial_expected_identity(self) -> None:
        def query(sql: str) -> str:
            raise AssertionError("partial canonical identity connected")

        mismatches = [
            options(
                canonical_read_only=True,
                database="salon-db",
                expected_system_identifier=DISPOSABLE_SYSID,
                expected_comment=module.CANONICAL_DATABASE_COMMENT,
            ),
            options(
                canonical_read_only=True,
                database="salon-db",
                expected_system_identifier=module.CANONICAL_SYSTEM_IDENTIFIER,
                expected_comment=FINAL_COMMENT,
            ),
            options(
                canonical_read_only=True,
                database=FINAL_DATABASE,
                expected_system_identifier=module.CANONICAL_SYSTEM_IDENTIFIER,
                expected_comment=module.CANONICAL_DATABASE_COMMENT,
            ),
            options(
                canonical_read_only=True,
                database="salon-db",
                expected_system_identifier=module.CANONICAL_SYSTEM_IDENTIFIER,
                expected_comment="",
            ),
        ]
        for case in mismatches:
            with self.subTest(database=case.database, sysid=case.expected_system_identifier):
                self.assertEqual(run_preflight(case, query), 1)

    def test_canonical_mode_accepts_only_a_verified_injected_identity(self) -> None:
        case = options(
            container=CANONICAL_CONTAINER,
            database=module.CANONICAL_DATABASE_NAME,
            expected_system_identifier=module.CANONICAL_SYSTEM_IDENTIFIER,
            expected_comment=module.CANONICAL_DATABASE_COMMENT,
            canonical_read_only=True,
            user="salon_app",
        )

        def query(sql: str) -> str:
            self.assertIn("BEGIN READ ONLY", sql)
            self.assertNotIn("GRANT", sql.upper())
            return response(
                database=module.CANONICAL_DATABASE_NAME,
                system_identifier=module.CANONICAL_SYSTEM_IDENTIFIER,
                comment=module.CANONICAL_DATABASE_COMMENT,
                schema="final",
            )

        code = run_preflight(case, query)
        self.assertEqual(code, 0)

    def test_connected_name_system_identifier_and_comment_mismatches(self) -> None:
        case = options()
        echoes = [
            response(
                database="other-db",
                system_identifier=DISPOSABLE_SYSID,
                comment=FINAL_COMMENT,
                schema="final",
            ),
            response(
                database=FINAL_DATABASE,
                system_identifier="1",
                comment=FINAL_COMMENT,
                schema="final",
            ),
            response(
                database=FINAL_DATABASE,
                system_identifier=DISPOSABLE_SYSID,
                comment="other-comment",
                schema="final",
            ),
        ]
        for echo in echoes:
            with self.subTest(echo=echo.splitlines()[2]):
                code = run_preflight(case, lambda sql, echo=echo: echo)
                self.assertEqual(code, 1)

    def test_server_identity_mismatch_and_ambiguous_identity(self) -> None:
        self.assertEqual(
            run_preflight(options(), lambda sql: (_ for _ in ()).throw(
                QueryFailed("identity mismatch", "identity")
            )),
            1,
        )
        self.assertEqual(
            run_preflight(options(), lambda sql: (_ for _ in ()).throw(
                QueryFailed("ambiguous database identity", "identity")
            )),
            1,
        )

    def test_missing_privilege_reports_the_requirement(self) -> None:
        def query(sql: str) -> str:
            raise QueryFailed("permission denied", "privilege")

        with self.assertLogs_from(1) as output:
            code = run_preflight(options(user="salon_app"), query)
        self.assertEqual(code, 1)
        self.assertIn("SELECT on public.vip_requests", output)
        self.assertIn("canonical_database_identity()", output)
        self.assertIn("does not grant privileges", output)
        self.assertNotIn("postgresql://", output)

    def test_unrecognized_schema_is_an_operational_failure(self) -> None:
        code = run_preflight(
            options(),
            lambda sql: response(
                database=FINAL_DATABASE,
                system_identifier=DISPOSABLE_SYSID,
                comment=FINAL_COMMENT,
                schema="unrecognized",
                quantity_count=3,
            ),
        )
        self.assertEqual(code, 1)

    def assertLogs_from(self, expected: int):
        return _CapturedExit(self, expected)


class _CapturedExit:
    def __init__(self, test: unittest.TestCase, expected: int) -> None:
        self.test = test
        self.expected = expected
        self.stdout = ""
        self.stderr = ""

    def __enter__(self) -> str:
        self._out = sys.stdout
        self._err = sys.stderr
        sys.stdout = self._stdout = _Buffer()
        sys.stderr = self._stderr = _Buffer()
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        sys.stdout = self._out
        sys.stderr = self._err
        self.stdout = self._stdout.getvalue()
        self.stderr = self._stderr.getvalue()
        return False

    def __contains__(self, item: str) -> bool:
        return item in self.stdout or item in self.stderr


class _Buffer:
    def __init__(self) -> None:
        self.parts: list[str] = []

    def write(self, text: str) -> int:
        self.parts.append(text)
        return len(text)

    def flush(self) -> None:
        return None

    def getvalue(self) -> str:
        return "".join(self.parts)


class DisposableTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        completed = subprocess.run(
            [
                "docker",
                "exec",
                "-i",
                DISPOSABLE_CONTAINER,
                "psql",
                "-U",
                "salon",
                "-d",
                "postgres",
                "-tA",
                "-c",
                "SELECT system_identifier::text FROM pg_control_system()",
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        if completed.returncode != 0:
            raise AssertionError("disposable cluster is not available")
        sysid = completed.stdout.strip()
        if sysid != DISPOSABLE_SYSID or sysid == module.CANONICAL_SYSTEM_IDENTIFIER:
            raise AssertionError("refusing a non-disposable system identifier")
        cls.before = {
            FINAL_DATABASE: snapshot(FINAL_DATABASE),
            FAIL_DATABASE: snapshot(FAIL_DATABASE),
        }

    def run_cli(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(MODULE_PATH), *args],
            check=False,
            capture_output=True,
            text=True,
        )

    def test_final_schema_is_clean_and_unchanged(self) -> None:
        result = self.run_cli(
            "--container",
            DISPOSABLE_CONTAINER,
            "--database",
            FINAL_DATABASE,
            "--expected-system-identifier",
            DISPOSABLE_SYSID,
            "--expected-comment",
            FINAL_COMMENT,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("schema=final", result.stdout)
        self.assertIn("duplicate_active_salon_list_groups=0", result.stdout)
        self.assertIn("requested_count_outside_1_500=0", result.stdout)
        self.assertIn("preflight=clear", result.stdout)
        self.assertNotIn("postgresql://", result.stdout + result.stderr)
        self.assertEqual(snapshot(FINAL_DATABASE), self.before[FINAL_DATABASE])

    def test_conflicting_predecessor_reports_one_group_and_does_not_mutate(self) -> None:
        result = self.run_cli(
            "--container",
            DISPOSABLE_CONTAINER,
            "--database",
            FAIL_DATABASE,
            "--expected-system-identifier",
            DISPOSABLE_SYSID,
            "--expected-comment",
            FAIL_COMMENT,
        )
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("schema=predecessor", result.stdout)
        self.assertIn("duplicate_active_salon_list_groups=1", result.stdout)
        self.assertIn(
            "11111111-1111-4111-8111-111111111111 44444444-4444-4444-8444-444444444444 2",
            result.stdout,
        )
        self.assertIn("duplicate_groups_shown=1", result.stdout)
        self.assertIn("duplicate_groups_omitted=0", result.stdout)
        self.assertEqual(snapshot(FAIL_DATABASE), self.before[FAIL_DATABASE])

    def test_live_mismatches_and_read_only_failure_leave_rows_unchanged(self) -> None:
        comment = self.run_cli(
            "--container",
            DISPOSABLE_CONTAINER,
            "--database",
            FINAL_DATABASE,
            "--expected-system-identifier",
            DISPOSABLE_SYSID,
            "--expected-comment",
            "not-the-disposable-comment",
        )
        self.assertEqual(comment.returncode, 1)
        self.assertIn("database identity does not match", comment.stderr)

        sysid = self.run_cli(
            "--container",
            DISPOSABLE_CONTAINER,
            "--database",
            FINAL_DATABASE,
            "--expected-system-identifier",
            "1",
            "--expected-comment",
            FINAL_COMMENT,
        )
        self.assertEqual(sysid.returncode, 1)
        self.assertIn("database identity does not match", sysid.stderr)

        name = self.run_cli(
            "--container",
            DISPOSABLE_CONTAINER,
            "--database",
            FAIL_DATABASE,
            "--expected-system-identifier",
            DISPOSABLE_SYSID,
            "--expected-comment",
            FINAL_COMMENT,
        )
        self.assertEqual(name.returncode, 1)
        self.assertIn("database identity does not match", name.stderr)
        self.assertEqual(snapshot(FINAL_DATABASE), self.before[FINAL_DATABASE])
        self.assertEqual(snapshot(FAIL_DATABASE), self.before[FAIL_DATABASE])

        readonly = subprocess.run(
            [
                "docker",
                "exec",
                "-i",
                DISPOSABLE_CONTAINER,
                "psql",
                "-v",
                "ON_ERROR_STOP=1",
                "-U",
                "salon",
                "-d",
                FINAL_DATABASE,
                "-c",
                "BEGIN READ ONLY; INSERT INTO vip_requests DEFAULT VALUES; ROLLBACK;",
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(readonly.returncode, 0)
        self.assertIn("read-only", readonly.stderr.lower())
        self.assertEqual(snapshot(FINAL_DATABASE), self.before[FINAL_DATABASE])

    def test_default_cli_refuses_canonical_arguments_without_starting_it(self) -> None:
        before = subprocess.run(
            ["docker", "inspect", "-f", "{{.State.Status}}", CANONICAL_CONTAINER],
            check=False,
            capture_output=True,
            text=True,
        )
        result = self.run_cli(
            "--container",
            CANONICAL_CONTAINER,
            "--database",
            "salon-db",
            "--expected-system-identifier",
            module.CANONICAL_SYSTEM_IDENTIFIER,
            "--expected-comment",
            module.CANONICAL_DATABASE_COMMENT,
        )
        after = subprocess.run(
            ["docker", "inspect", "-f", "{{.State.Status}}", CANONICAL_CONTAINER],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("refusing canonical or persistent database identity", result.stderr)
        self.assertEqual(before.stdout.strip(), "exited")
        self.assertEqual(after.stdout.strip(), "exited")

    def test_canonical_flag_on_the_disposable_cluster_does_not_prove_identity(self) -> None:
        result = self.run_cli(
            "--canonical-read-only",
            "--container",
            DISPOSABLE_CONTAINER,
            "--database",
            module.CANONICAL_DATABASE_NAME,
            "--expected-system-identifier",
            module.CANONICAL_SYSTEM_IDENTIFIER,
            "--expected-comment",
            module.CANONICAL_DATABASE_COMMENT,
        )
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("preflight=clear", result.stdout)
        self.assertNotIn("identity=verified", result.stdout)
        after = subprocess.run(
            ["docker", "inspect", "-f", "{{.State.Status}}", CANONICAL_CONTAINER],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(after.stdout.strip(), "exited")


if __name__ == "__main__":
    unittest.main()
