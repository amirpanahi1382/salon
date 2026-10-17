-- Phone-first login identity for a new empty product database.
-- Email stays as optional contact. It is not a login identity.
-- This file does not copy, invent, or delete historical rows.
-- Before any schema change, every ordinary table in public is checked.
-- A row in any of them refuses the migration. Prisma's migration ledger
-- is the only excluded table. Do not apply this file to salon or salon_preview.

DO $$
DECLARE
  rel record;
  ident text;
  nonempty boolean;
BEGIN
  FOR rel IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname <> '_prisma_migrations'
    ORDER BY c.relname
  LOOP
    ident := format('%I.%I', rel.schema_name, rel.table_name);
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s)', ident) INTO nonempty;
    IF nonempty THEN
      RAISE EXCEPTION 'phone_first_refuses_nonempty_database'
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END $$;

ALTER TABLE "users" DROP CONSTRAINT "users_login_identity_chk";

ALTER TABLE "users" ALTER COLUMN "phone" SET NOT NULL;

ALTER TABLE "users" DROP CONSTRAINT "users_phone_format_chk";

ALTER TABLE "users"
  ADD CONSTRAINT "users_phone_format_chk"
  CHECK ("phone" ~ '^09[0-9]{9}$');

ALTER TABLE "platform_admins" ALTER COLUMN "email" DROP NOT NULL;

ALTER TABLE "platform_admins" ADD COLUMN "phone" TEXT NOT NULL;

CREATE UNIQUE INDEX "platform_admins_phone_key" ON "platform_admins"("phone");

ALTER TABLE "platform_admins"
  ADD CONSTRAINT "platform_admins_phone_format_chk"
  CHECK ("phone" ~ '^09[0-9]{9}$');

CREATE FUNCTION "reject_cross_role_phone"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('phone-identity:' || NEW."phone")::bigint);

  IF TG_TABLE_NAME = 'users' THEN
    IF EXISTS (SELECT 1 FROM "platform_admins" WHERE "phone" = NEW."phone") THEN
      RAISE EXCEPTION 'phone_identity_cross_role'
        USING ERRCODE = '23514', CONSTRAINT = 'phone_identity_cross_role';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM "users" WHERE "phone" = NEW."phone") THEN
    RAISE EXCEPTION 'phone_identity_cross_role'
      USING ERRCODE = '23514', CONSTRAINT = 'phone_identity_cross_role';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "users_phone_identity_cross_role"
  BEFORE INSERT OR UPDATE OF "phone" ON "users"
  FOR EACH ROW EXECUTE FUNCTION "reject_cross_role_phone"();

CREATE TRIGGER "platform_admins_phone_identity_cross_role"
  BEFORE INSERT OR UPDATE OF "phone" ON "platform_admins"
  FOR EACH ROW EXECUTE FUNCTION "reject_cross_role_phone"();
