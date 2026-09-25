-- Durable queue-removal fact. Does not delete MessageRequest, MessageDelivery,
-- audit, or VIP/customer provenance. Worker must not claim CANCELLED requests.
ALTER TYPE "MessageRequestStatus" ADD VALUE 'CANCELLED';
