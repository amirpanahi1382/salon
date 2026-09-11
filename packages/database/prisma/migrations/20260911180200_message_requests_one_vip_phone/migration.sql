-- One queued VIP MessageRequest per target phone on a VIP request.
-- Prevents retry/partial-dispatch duplicates without weakening customer XOR.
CREATE UNIQUE INDEX "message_requests_one_per_vip_recipient_phone"
  ON "message_requests" ("vip_request_id", "recipient_phone_number")
  WHERE "vip_request_id" IS NOT NULL;
