#!/usr/bin/env python3
"""Provision a guarded Gate-3 disposable DB with the runtime ACL contract."""
import argparse, re, subprocess

NAME = re.compile(r"^salon_activation_[a-z0-9_]+$")

def run(container: str, database: str, sql: str) -> str:
    result = subprocess.run(
        ["docker", "exec", "-i", container, "psql", "-U", "salon_migrator", "-d", database,
         "-v", "ON_ERROR_STOP=1", "-Atq"], input=sql, text=True, capture_output=True)
    if result.returncode:
        raise SystemExit("disposable ACL provisioning failed: " + result.stderr.splitlines()[-1][:160])
    return result.stdout.strip()

def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--container", required=True)
    p.add_argument("--database", required=True)
    p.add_argument("--expected-comment", required=True)
    args = p.parse_args()
    if not NAME.fullmatch(args.database): raise SystemExit("refusing non-disposable database")
    identity = run(args.container, args.database, "SELECT current_database() || '|' || coalesce(shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()), 'pg_database'),'');")
    if identity != f"{args.database}|{args.expected_comment}": raise SystemExit("disposable identity mismatch")
    run(args.container, args.database, """
GRANT USAGE ON SCHEMA public TO salon_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO salon_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO salon_app;
REVOKE ALL PRIVILEGES ON TABLE audit_logs FROM salon_app;
DO $$ DECLARE c text; BEGIN
 FOR c IN SELECT attname FROM pg_attribute WHERE attrelid='audit_logs'::regclass AND attnum > 0 AND NOT attisdropped LOOP
  EXECUTE format('REVOKE UPDATE (%I) ON TABLE audit_logs FROM salon_app', c);
 END LOOP;
END $$;
REVOKE ALL PRIVILEGES ON TABLE _prisma_migrations FROM salon_app;
GRANT SELECT, INSERT ON TABLE audit_logs TO salon_app;
REVOKE CREATE ON SCHEMA public FROM salon_app;
""")
    rows = run(args.container, args.database, """
SELECT current_database(),current_user,session_user;
SELECT 'users','SELECT',true,has_table_privilege('salon_app','users','SELECT') UNION ALL
SELECT 'activation_receipts','INSERT',true,has_table_privilege('salon_app','activation_receipts','INSERT') UNION ALL
SELECT 'audit_logs','SELECT',true,has_table_privilege('salon_app','audit_logs','SELECT') UNION ALL
SELECT 'audit_logs','INSERT',true,has_table_privilege('salon_app','audit_logs','INSERT') UNION ALL
SELECT 'audit_logs','UPDATE',false,has_table_privilege('salon_app','audit_logs','UPDATE') UNION ALL
SELECT 'audit_logs','DELETE',false,has_table_privilege('salon_app','audit_logs','DELETE') UNION ALL
SELECT 'audit_logs','TRUNCATE',false,has_table_privilege('salon_app','audit_logs','TRUNCATE') UNION ALL
SELECT 'audit_logs','column UPDATE',false,EXISTS(SELECT 1 FROM information_schema.column_privileges WHERE grantee='salon_app' AND table_name='audit_logs' AND privilege_type='UPDATE') UNION ALL
SELECT '_prisma_migrations','SELECT',false,has_table_privilege('salon_app','_prisma_migrations','SELECT') UNION ALL
SELECT 'public','CREATE',false,has_schema_privilege('salon_app','public','CREATE') UNION ALL
SELECT 'salon_app','superuser/createdb/createrole',false,(SELECT rolsuper OR rolcreatedb OR rolcreaterole FROM pg_roles WHERE rolname='salon_app');
""").splitlines()
    identity_row, *assertions = rows
    failures = []
    for row in assertions:
        obj, privilege, expected, actual = row.split('|')
        if expected != actual:
            failures.append(f"assertion failed object={obj} privilege={privilege} expected={expected} actual={actual}")
    if failures:
        raise SystemExit("disposable ACL assertions failed\nidentity=" + identity_row + "\n" + "\n".join(failures))
    print("disposable activation ACL ready")

if __name__ == '__main__': main()
