-- Manual salon outreach is not an intelligence Opportunity.
-- MessageRequest remains the durable intent; Action/opportunity context is optional.
-- Existing opportunity-message rows keep their action_id and opportunity_type.

ALTER TABLE "message_requests" ALTER COLUMN "action_id" DROP NOT NULL;
ALTER TABLE "message_requests" ALTER COLUMN "opportunity_type" DROP NOT NULL;

ALTER TABLE "message_deliveries" ALTER COLUMN "action_id" DROP NOT NULL;
