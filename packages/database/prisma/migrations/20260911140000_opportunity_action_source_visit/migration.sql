-- Snapshot of the last visit that defined this opportunity episode.
-- Not a foreign key: deleting a visit must not fail because an Action exists.
ALTER TABLE "opportunity_actions" ADD COLUMN "source_visit_id" UUID;

-- Reconstruct the last visit that already existed when the Action was created.
-- Do NOT use the customer's current last visit (that rewrites older episodes).
-- Do NOT invent identifiers to satisfy uniqueness.
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

-- If two historical Actions reconstruct to the same visit episode, keep the
-- earliest reconstruction and leave later rows NULL. History is not deleted
-- or rewritten onto a fabricated visit id.
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

-- Episode uniqueness applies only when a real visit fingerprint exists.
-- Multiple historical NULL fingerprints are allowed; they are not a visit.
CREATE UNIQUE INDEX "opportunity_actions_one_per_source_visit"
  ON "opportunity_actions" ("salon_id", "customer_id", "opportunity_type", "source_visit_id")
  WHERE "source_visit_id" IS NOT NULL;

CREATE INDEX "opportunity_actions_salon_customer_type_source_visit_idx"
  ON "opportunity_actions" ("salon_id", "customer_id", "opportunity_type", "source_visit_id");
