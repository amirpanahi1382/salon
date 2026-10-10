-- At most one unfinished VIP sample-work draft per salon.
-- SUBMITTED, MANUAL_QUEUED, and BALE_NOT_IMPLEMENTED rows are not included.
-- This statement does not update or delete historical rows.
-- Read-only preflight before applying:
--   SELECT salon_id
--   FROM vip_requests
--   WHERE status = 'AWAITING_SAMPLE_WORK'
--   GROUP BY salon_id
--   HAVING count(*) > 1;
-- CREATE UNIQUE INDEX fails if that preflight returns any salon.
CREATE UNIQUE INDEX "vip_requests_one_awaiting_draft_per_salon"
  ON "vip_requests" ("salon_id")
  WHERE "status" = 'AWAITING_SAMPLE_WORK';
