import importlib.util
import os
import stat
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("apply-canonical-database-access.py")
spec = importlib.util.spec_from_file_location("canonical_access", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
assert_secret_file = module.assert_secret_file
load_secrets = module.load_secrets
redact = module.redact
sql = module.sql
sql_literal = module.sql_literal


class AccessScriptTests(unittest.TestCase):
    def test_sql_literal_escapes_apostrophes(self) -> None:
        self.assertEqual(sql_literal("a'b"), "'a''b'")

    def test_secret_file_rejects_group_access(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "secrets.env"
            path.write_text("APP_PASSWORD=secret\n")
            os.chmod(path, 0o640)
            with self.assertRaises(SystemExit):
                assert_secret_file(path)

    def test_secret_file_accepts_owner_only_mode(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "secrets.env"
            path.write_text("APP_PASSWORD=p'w\nMIGRATOR_PASSWORD=m\n")
            os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
            values = load_secrets(path)
            self.assertEqual(values["APP_PASSWORD"], "p'w")

    def test_wrong_identity_is_before_role_changes_and_sql_is_atomic(self) -> None:
        statement = sql(
            "phone_first_product",
            "app'pass",
            "migrator",
            None,
            "phone_first_product",
            "7700113693112733735",
            "phone-first-empty:20261024T061347Z",
        )
        identity_at = statement.index("identity mismatch")
        role_at = statement.index("CREATE ROLE salon_app")
        grant_at = statement.index("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES")
        revoke_at = statement.index('REVOKE ALL PRIVILEGES ON TABLE public."_prisma_migrations" FROM salon_app')
        audit_at = statement.index(
            "REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.audit_logs FROM salon_app"
        )
        self.assertIn("to_regclass('public._prisma_migrations')", statement)
        self.assertIn("to_regclass('public.audit_logs')", statement)
        self.assertIn("GRANT SELECT, INSERT ON TABLE public.audit_logs TO salon_app", statement)
        self.assertTrue(statement.strip().startswith("BEGIN;"))
        self.assertTrue(statement.strip().endswith("COMMIT;"))
        self.assertLess(identity_at, role_at)
        self.assertLess(grant_at, revoke_at)
        self.assertLess(revoke_at, audit_at)
        self.assertLess(audit_at, statement.rindex("COMMIT;"))
        self.assertIn("'app''pass'", statement)

    def test_database_argument_must_match_expected_name(self) -> None:
        with self.assertRaises(SystemExit):
            sql("other_db", "a", "b", None, "phone_first_product", "1", "comment")

    def test_redact_removes_password_and_sql(self) -> None:
        secret = "s'ecret"
        text = f"ERROR: identity mismatch\nALTER ROLE salon_app PASSWORD '{secret}';\n"
        cleaned = redact(text, [secret])
        self.assertNotIn(secret, cleaned)
        self.assertNotIn("ALTER ROLE", cleaned)
        self.assertIn("identity mismatch", cleaned)


if __name__ == "__main__":
    unittest.main()
