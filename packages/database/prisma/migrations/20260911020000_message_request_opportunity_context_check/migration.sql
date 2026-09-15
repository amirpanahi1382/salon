-- Opportunity context on MessageRequest is all-or-nothing.
-- Both NULL = manual outreach. Both set = opportunity message.
-- Mixed states are invalid. This ADD CONSTRAINT fails if any mixed rows exist;
-- it does not rewrite or delete historical requests.

ALTER TABLE "message_requests"
ADD CONSTRAINT "message_requests_opportunity_context_consistent"
CHECK (("action_id" IS NULL) = ("opportunity_type" IS NULL));
