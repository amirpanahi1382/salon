-- Synthetic predecessor fixture. Apply only to a new, task-owned disposable
-- database after migrations through 20260930140000_transaction_item_math_on_reparent,
-- then apply 20261001120000_vip_sample_work_recovery through Prisma.
-- The image bytes are [ff d8 ff e0 00 10 4a 46 49 46 00 01]; the request
-- hash uses VIP_SAMPLE_WORK_UPLOAD:<request UUID>:<SHA-256 of those bytes>.
-- PHASE12_LEGACY_REQUEST_ID=c1a7d972-c7db-4fe8-beb9-f4f2ac0aa07d
BEGIN;
INSERT INTO platform_admins (id,email,password_hash,name,updated_at) VALUES ('c3288b5e-a1b6-4739-806b-abd676a426c5','phase12-admin@example.test','synthetic','Phase12',now());
INSERT INTO salons (id,name,updated_at) VALUES ('8dc6cc24-51e3-4ee3-81fe-40c5133fdfbb','Phase12 Synthetic Salon',now());
INSERT INTO users (id,salon_id,name,email,password_hash,role,updated_at) VALUES ('3c477580-9480-4f08-bada-1bfafc7ea8e9','8dc6cc24-51e3-4ee3-81fe-40c5133fdfbb','Phase12 Owner','phase12-owner@example.test','synthetic','OWNER',now());
INSERT INTO vip_target_lists (id,name,status,contact_count,created_by_admin_id,reserved_by_salon_id,reserved_at,updated_at) VALUES ('82245646-c628-4f5d-b523-4ef367e2666b','Phase12 List','IN_USE',30,'c3288b5e-a1b6-4739-806b-abd676a426c5','8dc6cc24-51e3-4ee3-81fe-40c5133fdfbb',now(),now());
INSERT INTO vip_requests (id,salon_id,list_id,created_by_user_id,requested_count,geographic_range,status,reserved_until,updated_at) VALUES ('c1a7d972-c7db-4fe8-beb9-f4f2ac0aa07d','8dc6cc24-51e3-4ee3-81fe-40c5133fdfbb','82245646-c628-4f5d-b523-4ef367e2666b','3c477580-9480-4f08-bada-1bfafc7ea8e9',30,'synthetic','AWAITING_SAMPLE_WORK',now()+interval '1 hour',now());
INSERT INTO vip_sample_works (id,vip_request_id,salon_id,position,object_key,content_type,byte_size,sha256) VALUES ('b7955371-60a3-4e79-8f85-07aaf4e8f1f9','c1a7d972-c7db-4fe8-beb9-f4f2ac0aa07d','8dc6cc24-51e3-4ee3-81fe-40c5133fdfbb',1,'vip/8dc6cc24-51e3-4ee3-81fe-40c5133fdfbb/c1a7d972-c7db-4fe8-beb9-f4f2ac0aa07d/b7955371-60a3-4e79-8f85-07aaf4e8f1f9','image/jpeg',12,'3c4bae649b6c0fade21c149e6ee9773e734d620fda91248a44c58b11c71f3ba9');
INSERT INTO idempotency_records (id,tenant_id,actor_id,operation,key,request_hash,resource_type,resource_id) VALUES ('1f20e863-8a4f-4e2a-a8f9-114c238686c0','8dc6cc24-51e3-4ee3-81fe-40c5133fdfbb','3c477580-9480-4f08-bada-1bfafc7ea8e9','VIP_SAMPLE_WORK_UPLOAD','phase12-legacy-04c40bc4816c','b3528a7d5314eab00a4bc59314deb16c528d98a3beca0192822ce9fb9c2faf4c','vip_sample_work','b7955371-60a3-4e79-8f85-07aaf4e8f1f9');
COMMIT;
