-- Historical 30/50/100 quantities stay valid. New requests store the actual recipient count.
ALTER TABLE "vip_requests" DROP CONSTRAINT "vip_requests_count_allowed";
ALTER TABLE "vip_requests"
  ADD CONSTRAINT "vip_requests_count_positive"
  CHECK ("requested_count" >= 1 AND "requested_count" <= 500);

-- One opening admits one later reservation. It does not cancel existing requests.
ALTER TABLE "vip_target_lists"
  ADD COLUMN "next_reservation_open" BOOLEAN NOT NULL DEFAULT false;

-- Several salons may hold the list. One salon cannot hold two active requests for it.
-- An expired draft remains in this index until expiry cancels it.
CREATE UNIQUE INDEX "vip_requests_one_active_per_salon_list"
  ON "vip_requests" ("salon_id", "list_id")
  WHERE "status" IN (
    'AWAITING_SAMPLE_WORK',
    'SUBMITTED',
    'MANUAL_QUEUED',
    'BALE_NOT_IMPLEMENTED'
  );
