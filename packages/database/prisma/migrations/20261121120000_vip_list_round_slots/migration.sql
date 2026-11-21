-- Five distinct salons per list reservation round. One-slot next_reservation_open
-- is no longer the capacity grant. Historical occupying rows become round 1 slots.
-- Reads do not write. Slot rows for unsubmitted cancelled drafts are removed by
-- mutating expiry, not by GET.

ALTER TABLE "vip_target_lists"
  ADD COLUMN "reservation_round" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "vip_target_lists"
  ADD CONSTRAINT "vip_target_lists_reservation_round_positive"
  CHECK ("reservation_round" >= 1);

ALTER TABLE "vip_requests"
  ADD COLUMN "reservation_round" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "vip_requests"
  ADD CONSTRAINT "vip_requests_reservation_round_positive"
  CHECK ("reservation_round" >= 1);

CREATE TABLE "vip_list_round_slots" (
  "list_id" UUID NOT NULL,
  "reservation_round" INTEGER NOT NULL,
  "slot_no" INTEGER NOT NULL,
  "salon_id" UUID NOT NULL,
  "vip_request_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "vip_list_round_slots_pkey"
    PRIMARY KEY ("list_id", "reservation_round", "slot_no"),
  CONSTRAINT "vip_list_round_slots_slot_no_range"
    CHECK ("slot_no" >= 1 AND "slot_no" <= 5),
  CONSTRAINT "vip_list_round_slots_round_positive"
    CHECK ("reservation_round" >= 1),
  CONSTRAINT "vip_list_round_slots_salon_round_key"
    UNIQUE ("list_id", "reservation_round", "salon_id"),
  CONSTRAINT "vip_list_round_slots_request_key"
    UNIQUE ("vip_request_id"),
  CONSTRAINT "vip_list_round_slots_request_salon_key"
    UNIQUE ("vip_request_id", "salon_id"),
  CONSTRAINT "vip_list_round_slots_list_fkey"
    FOREIGN KEY ("list_id") REFERENCES "vip_target_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "vip_list_round_slots_salon_fkey"
    FOREIGN KEY ("salon_id") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "vip_list_round_slots_request_salon_fkey"
    FOREIGN KEY ("vip_request_id", "salon_id") REFERENCES "vip_requests"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "vip_list_round_slots_list_round_idx"
  ON "vip_list_round_slots" ("list_id", "reservation_round");

-- Fail closed if one salon already occupies the same list twice among rows that
-- would backfill into round 1. Preserve those rows; do not rewrite them.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "vip_requests"
    WHERE "submitted_at" IS NOT NULL
       OR (
         "status" = 'AWAITING_SAMPLE_WORK'
         AND "reserved_until" >= CURRENT_TIMESTAMP
       )
    GROUP BY "salon_id", "list_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'vip_round_refuses_duplicate_occupying_salon_list';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT "list_id",
             ROW_NUMBER() OVER (PARTITION BY "list_id" ORDER BY "created_at" ASC, "id" ASC) AS rn
      FROM "vip_requests"
      WHERE "submitted_at" IS NOT NULL
         OR (
           "status" = 'AWAITING_SAMPLE_WORK'
           AND "reserved_until" >= CURRENT_TIMESTAMP
         )
    ) ranked
    WHERE rn > 5
  ) THEN
    RAISE EXCEPTION 'vip_round_refuses_more_than_five_occupying_salons';
  END IF;
END $$;

INSERT INTO "vip_list_round_slots" (
  "list_id",
  "reservation_round",
  "slot_no",
  "salon_id",
  "vip_request_id",
  "created_at"
)
SELECT
  ranked."list_id",
  1,
  ranked.rn,
  ranked."salon_id",
  ranked."id",
  ranked."created_at"
FROM (
  SELECT
    r."id",
    r."list_id",
    r."salon_id",
    r."created_at",
    ROW_NUMBER() OVER (PARTITION BY r."list_id" ORDER BY r."created_at" ASC, r."id" ASC) AS rn
  FROM "vip_requests" r
  WHERE r."submitted_at" IS NOT NULL
     OR (
       r."status" = 'AWAITING_SAMPLE_WORK'
       AND r."reserved_until" >= CURRENT_TIMESTAMP
     )
) ranked;

-- Same-salon unresolved reuse is enforced by application SQL plus this occupying
-- unique index (submitted or still-awaiting draft, including overdue drafts until
-- expiry cancels them). Historical status after full recipient completion no longer
-- uses vip_requests_one_active_per_salon_list.
DROP INDEX IF EXISTS "vip_requests_one_active_per_salon_list";

CREATE UNIQUE INDEX "vip_requests_one_occupying_per_salon_list_round"
  ON "vip_requests" ("salon_id", "list_id", "reservation_round")
  WHERE "submitted_at" IS NOT NULL
     OR "status" = 'AWAITING_SAMPLE_WORK';
