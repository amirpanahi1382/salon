-- The existing VIP recipient_phone_number becomes the one execution destination
-- for all new MessageRequests. Historical customer rows stay NULL: current
-- Customer.phone_number cannot prove their original intended destination.

ALTER TABLE "message_requests"
  DROP CONSTRAINT "message_requests_recipient_origin_consistent";

ALTER TABLE "message_requests"
  ADD CONSTRAINT "message_requests_recipient_origin_consistent"
  CHECK (
    (
      "customer_id" IS NOT NULL
      AND "vip_request_id" IS NULL
      AND "recipient_display_name" IS NULL
    )
    OR (
      "customer_id" IS NULL
      AND "vip_request_id" IS NOT NULL
      AND "recipient_phone_number" IS NOT NULL
      AND "action_id" IS NULL
      AND "opportunity_type" IS NULL
      AND "counts_toward_daily_limit" = false
    )
  );

-- A linked VIP recipient is an exact historical source. This only fills a
-- missing destination; it never replaces a recorded destination.
UPDATE "message_requests" AS mr
SET "recipient_phone_number" = vrr."phone_number"
FROM "vip_request_recipients" AS vrr
WHERE mr."id" = vrr."message_request_id"
  AND mr."salon_id" = vrr."salon_id"
  AND mr."vip_request_id" = vrr."vip_request_id"
  AND mr."recipient_phone_number" IS NULL;

CREATE FUNCTION "message_request_destination_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."recipient_phone_number" IS NULL
      OR NEW."recipient_phone_number" !~ '^09[0-9]{9}$' THEN
      RAISE EXCEPTION 'Message destination snapshot is required'
        USING ERRCODE = '23514', CONSTRAINT = 'message_requests_destination_required';
    END IF;
  ELSIF NEW."recipient_phone_number" IS DISTINCT FROM OLD."recipient_phone_number" THEN
    RAISE EXCEPTION 'Message destination snapshot is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'message_requests_destination_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "message_request_destination_guard"
  BEFORE INSERT OR UPDATE ON "message_requests"
  FOR EACH ROW EXECUTE FUNCTION "message_request_destination_guard"();
