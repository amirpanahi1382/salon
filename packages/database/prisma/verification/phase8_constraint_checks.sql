\set ON_ERROR_STOP on
-- Run after Phase 8 Prisma migrate deploy on the disposable fixture database.
-- All writes in this file roll back. Never run on application/preview data.
DO $$ BEGIN
  IF current_database() <> 'phase8_relations' THEN
    RAISE EXCEPTION 'Phase 8 verification requires disposable phase8_relations database';
  END IF;
END $$;
BEGIN;
CREATE FUNCTION pg_temp.expect_fk(label text, statement text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  actual_constraint text;
  expected_constraint text;
BEGIN
  expected_constraint := CASE
    WHEN label IN ('action insert', 'action actor update', 'action tenant move')
      THEN 'opportunity_actions_created_by_salon_id_fkey'
    WHEN label IN ('request insert', 'request actor update', 'request tenant move')
      THEN 'message_requests_created_by_user_id_salon_id_fkey'
    WHEN label IN ('delivery insert', 'delivery actor update', 'delivery tenant move')
      THEN 'message_deliveries_created_by_salon_id_fkey'
    WHEN label IN ('vip request insert', 'vip actor update', 'vip tenant move')
      THEN 'vip_requests_created_by_user_id_salon_id_fkey'
    WHEN label IN ('recipient insert', 'recipient link update', 'recipient tenant move')
      THEN 'vip_request_recipients_message_request_id_salon_id_fkey'
    ELSE NULL
  END;
  EXECUTE statement;
  RAISE EXCEPTION 'Expected FK failure did not occur: %', label;
EXCEPTION WHEN foreign_key_violation THEN
  GET STACKED DIAGNOSTICS actual_constraint = CONSTRAINT_NAME;
  IF expected_constraint IS NOT NULL AND actual_constraint <> expected_constraint THEN
    RAISE EXCEPTION 'Wrong FK rejected %: %', label, actual_constraint;
  END IF;
  RAISE NOTICE 'FK rejected: %', label;
END $$;

-- All five same-salon inserts must succeed, including a linked and null VIP recipient.
INSERT INTO opportunity_actions(id,salon_id,customer_id,opportunity_type,status,created_by,updated_at)
VALUES(md5('p8-new-action')::uuid,md5('p8-salon-a')::uuid,md5('p8-customer-a')::uuid,'REVENUE_DECLINE','OPEN',md5('p8-user-a')::uuid,now());
INSERT INTO vip_requests(id,salon_id,list_id,created_by_user_id,requested_count,geographic_range,status,reserved_until,updated_at)
VALUES(md5('p8-new-vip')::uuid,md5('p8-salon-a')::uuid,md5('p8-list')::uuid,md5('p8-user-a')::uuid,30,'Synthetic','SUBMITTED',now()+interval '1 day',now());
INSERT INTO vip_requests(id,salon_id,list_id,created_by_user_id,requested_count,geographic_range,status,reserved_until,updated_at)
VALUES(md5('p8-new-vip-b')::uuid,md5('p8-salon-b')::uuid,md5('p8-list')::uuid,md5('p8-user-b')::uuid,30,'Synthetic','SUBMITTED',now()+interval '1 day',now());
INSERT INTO vip_requests(id,salon_id,list_id,created_by_user_id,requested_count,geographic_range,status,reserved_until,updated_at)
VALUES(md5('p8-new-vip-unlinked')::uuid,md5('p8-salon-a')::uuid,md5('p8-list')::uuid,md5('p8-user-a')::uuid,30,'Synthetic','SUBMITTED',now()+interval '1 day',now());
INSERT INTO message_requests(id,salon_id,customer_id,created_by_user_id,message_text,message_business_date,counts_toward_daily_limit,status,recipient_phone_number,updated_at)
VALUES(md5('p8-new-msg')::uuid,md5('p8-salon-a')::uuid,md5('p8-customer-a')::uuid,md5('p8-user-a')::uuid,'Synthetic',current_date,false,'QUEUED','09120000001',now());
INSERT INTO message_requests(id,salon_id,customer_id,created_by_user_id,message_text,message_business_date,counts_toward_daily_limit,status,recipient_phone_number,updated_at)
VALUES(md5('p8-new-msg-unlinked')::uuid,md5('p8-salon-a')::uuid,md5('p8-customer-a')::uuid,md5('p8-user-a')::uuid,'Synthetic',current_date,false,'QUEUED','09120000001',now());
INSERT INTO message_deliveries(id,salon_id,message_request_id,customer_id,mode,channel,status,provider_request_id,created_by,updated_at)
VALUES(md5('p8-new-delivery')::uuid,md5('p8-salon-a')::uuid,md5('p8-new-msg')::uuid,md5('p8-customer-a')::uuid,'MANUAL','TEXT','PENDING','p8-new',md5('p8-user-a')::uuid,now());
INSERT INTO message_requests(id,salon_id,vip_request_id,created_by_user_id,message_text,message_business_date,counts_toward_daily_limit,status,recipient_phone_number,updated_at)
VALUES(md5('p8-new-vip-msg')::uuid,md5('p8-salon-a')::uuid,md5('p8-new-vip')::uuid,md5('p8-user-a')::uuid,'Synthetic',current_date,false,'QUEUED','09120000013',now());
INSERT INTO vip_request_recipients(id,vip_request_id,salon_id,sort_order,source_contact_id,phone_number,message_text,message_request_id)
VALUES(md5('p8-new-recipient')::uuid,md5('p8-new-vip')::uuid,md5('p8-salon-a')::uuid,1,md5('p8-contact-3')::uuid,'09120000013','Synthetic',md5('p8-new-vip-msg')::uuid);
INSERT INTO vip_request_recipients(id,vip_request_id,salon_id,sort_order,source_contact_id,phone_number,message_text,message_request_id)
VALUES(md5('p8-new-null-recipient')::uuid,md5('p8-new-vip')::uuid,md5('p8-salon-a')::uuid,2,md5('p8-contact-2')::uuid,'09120000012','Synthetic',NULL);

SELECT pg_temp.expect_fk('action insert', $$INSERT INTO opportunity_actions(id,salon_id,customer_id,opportunity_type,status,created_by,completed_at,updated_at) VALUES(md5('p8-bad-action')::uuid,md5('p8-salon-a')::uuid,md5('p8-customer-a')::uuid,'REVENUE_DECLINE','COMPLETED',md5('p8-user-b')::uuid,now(),now())$$);
SELECT pg_temp.expect_fk('request insert', $$INSERT INTO message_requests(id,salon_id,customer_id,created_by_user_id,message_text,message_business_date,counts_toward_daily_limit,status,recipient_phone_number,updated_at) VALUES(md5('p8-bad-msg')::uuid,md5('p8-salon-a')::uuid,md5('p8-customer-a')::uuid,md5('p8-user-b')::uuid,'Synthetic',current_date,false,'QUEUED','09120000001',now())$$);
SELECT pg_temp.expect_fk('delivery insert', $$INSERT INTO message_deliveries(id,salon_id,message_request_id,customer_id,mode,channel,status,provider_request_id,created_by,updated_at) VALUES(md5('p8-bad-delivery')::uuid,md5('p8-salon-a')::uuid,md5('p8-msg-cross')::uuid,md5('p8-customer-a')::uuid,'MANUAL','TEXT','PENDING','p8-bad',md5('p8-user-b')::uuid,now())$$);
SELECT pg_temp.expect_fk('vip request insert', $$INSERT INTO vip_requests(id,salon_id,list_id,created_by_user_id,requested_count,geographic_range,status,reserved_until,updated_at) VALUES(md5('p8-bad-vip')::uuid,md5('p8-salon-a')::uuid,md5('p8-list')::uuid,md5('p8-user-b')::uuid,30,'Synthetic','SUBMITTED',now()+interval '1 day',now())$$);

INSERT INTO message_requests(id,salon_id,vip_request_id,created_by_user_id,message_text,message_business_date,counts_toward_daily_limit,status,recipient_phone_number,updated_at)
VALUES(md5('p8-extra-vip-msg-b')::uuid,md5('p8-salon-b')::uuid,md5('p8-vip-b')::uuid,md5('p8-user-b')::uuid,'Synthetic',current_date,false,'QUEUED','09120000013',now());
SELECT pg_temp.expect_fk('recipient insert', $$INSERT INTO vip_request_recipients(id,vip_request_id,salon_id,sort_order,source_contact_id,phone_number,message_text,message_request_id) VALUES(md5('p8-bad-recipient')::uuid,md5('p8-new-vip')::uuid,md5('p8-salon-a')::uuid,3,md5('p8-contact-3')::uuid,'09120000013','Synthetic',md5('p8-extra-vip-msg-b')::uuid)$$);

SELECT pg_temp.expect_fk('action actor update', $$UPDATE opportunity_actions SET created_by=md5('p8-user-b')::uuid WHERE id=md5('p8-new-action')::uuid$$);
SELECT pg_temp.expect_fk('request actor update', $$UPDATE message_requests SET created_by_user_id=md5('p8-user-b')::uuid WHERE id=md5('p8-new-msg')::uuid$$);
SELECT pg_temp.expect_fk('delivery actor update', $$UPDATE message_deliveries SET created_by=md5('p8-user-b')::uuid WHERE id=md5('p8-new-delivery')::uuid$$);
SELECT pg_temp.expect_fk('vip actor update', $$UPDATE vip_requests SET created_by_user_id=md5('p8-user-b')::uuid WHERE id=md5('p8-new-vip')::uuid$$);
SELECT pg_temp.expect_fk('recipient link update', $$UPDATE vip_request_recipients SET message_request_id=md5('p8-extra-vip-msg-b')::uuid WHERE id=md5('p8-new-recipient')::uuid$$);

SELECT pg_temp.expect_fk('action tenant move', $$UPDATE opportunity_actions SET salon_id=md5('p8-salon-b')::uuid,customer_id=md5('p8-customer-b')::uuid WHERE id=md5('p8-new-action')::uuid$$);
SELECT pg_temp.expect_fk('request tenant move', $$UPDATE message_requests SET salon_id=md5('p8-salon-b')::uuid,customer_id=md5('p8-customer-b')::uuid WHERE id=md5('p8-new-msg-unlinked')::uuid$$);
SELECT pg_temp.expect_fk('delivery tenant move', $$UPDATE message_deliveries SET salon_id=md5('p8-salon-b')::uuid,message_request_id=md5('p8-extra-vip-msg-b')::uuid,customer_id=NULL WHERE id=md5('p8-new-delivery')::uuid$$);
SELECT pg_temp.expect_fk('vip tenant move', $$UPDATE vip_requests SET salon_id=md5('p8-salon-b')::uuid WHERE id=md5('p8-new-vip-unlinked')::uuid$$);
SELECT pg_temp.expect_fk('recipient tenant move', $$UPDATE vip_request_recipients SET salon_id=md5('p8-salon-b')::uuid,vip_request_id=md5('p8-vip-b')::uuid WHERE id=md5('p8-new-recipient')::uuid$$);

-- The nullable link remains a usable nullable link; parent deletion is restricted.
UPDATE vip_request_recipients SET message_text='Still null' WHERE id=md5('p8-new-null-recipient')::uuid AND message_request_id IS NULL;
SELECT pg_temp.expect_fk('delete referenced user', $$DELETE FROM users WHERE id=md5('p8-user-a')::uuid$$);
SELECT pg_temp.expect_fk('update referenced user tenant', $$UPDATE users SET salon_id=md5('p8-salon-b')::uuid WHERE id=md5('p8-user-a')::uuid$$);
SELECT pg_temp.expect_fk('delete linked request', $$DELETE FROM message_requests WHERE id=md5('p8-new-vip-msg')::uuid$$);
SELECT pg_temp.expect_fk('update linked request tenant', $$UPDATE message_requests SET salon_id=md5('p8-salon-b')::uuid,vip_request_id=md5('p8-new-vip-b')::uuid,created_by_user_id=md5('p8-user-b')::uuid WHERE id=md5('p8-new-vip-msg')::uuid$$);

SELECT 'same-salon and null writes passed; all expected rejections observed' AS result;
ROLLBACK;
