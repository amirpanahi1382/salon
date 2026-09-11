-- Repair unsafe 20260911140000 backfill for databases that already applied it:
-- 1. current last visit was assigned to every historical Action
-- 2. colliding rows used the Action id as a fake visit id
-- 3. a unique index on NULL source_visit_id forbade legitimate historical multiples
--
-- Idempotent. New Actions keep a fingerprint only when reconstruction matches a
-- visit that existed at created_at.

DROP INDEX IF EXISTS "opportunity_actions_one_per_null_source_visit";
DROP INDEX IF EXISTS "opportunity_actions_one_per_source_visit";

UPDATE "opportunity_actions"
SET "source_visit_id" = NULL;

UPDATE "opportunity_actions" AS a
SET "source_visit_id" = lv.visit_id
FROM (
  SELECT DISTINCT ON (a2.id)
    a2.id AS action_id,
    v.id AS visit_id
  FROM "opportunity_actions" AS a2
  INNER JOIN "visits" AS v
    ON v."salon_id" = a2."salon_id"
   AND v."customer_id" = a2."customer_id"
   AND v."created_at" <= a2."created_at"
  ORDER BY a2.id, v."visited_at" DESC, v."created_at" DESC, v.id DESC
) AS lv
WHERE a.id = lv.action_id;

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "salon_id", "customer_id", "opportunity_type", "source_visit_id"
      ORDER BY "created_at" ASC, "id" ASC
    ) AS rn
  FROM "opportunity_actions"
  WHERE "source_visit_id" IS NOT NULL
)
UPDATE "opportunity_actions" AS a
SET "source_visit_id" = NULL
FROM ranked AS r
WHERE a."id" = r."id"
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "opportunity_actions_one_per_source_visit"
  ON "opportunity_actions" ("salon_id", "customer_id", "opportunity_type", "source_visit_id")
  WHERE "source_visit_id" IS NOT NULL;
