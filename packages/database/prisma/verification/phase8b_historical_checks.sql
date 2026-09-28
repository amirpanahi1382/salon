\set ON_ERROR_STOP on
-- Historical-row behavior assertions. Run only after the Phase 8 and 8B
-- migrations on the disposable phase8_relations fixture database.
DO $$ BEGIN
  IF current_database() <> 'phase8_relations' THEN
    RAISE EXCEPTION 'Phase 8B verification requires disposable phase8_relations database';
  END IF;
END $$;
BEGIN;

-- Fail if either family of constraints is missing or has an unexpected state.
DO $$
DECLARE
  composite text[] := ARRAY[
    'opportunity_actions_created_by_salon_id_fkey',
    'message_requests_created_by_user_id_salon_id_fkey',
    'message_deliveries_created_by_salon_id_fkey',
    'vip_requests_created_by_user_id_salon_id_fkey',
    'vip_request_recipients_message_request_id_salon_id_fkey'];
  historical text[] := ARRAY[
    'opportunity_actions_created_by_fkey',
    'message_requests_created_by_user_id_fkey',
    'message_deliveries_created_by_fkey',
    'vip_requests_created_by_user_id_fkey',
    'vip_request_recipients_message_request_id_fkey'];
BEGIN
  IF (SELECT count(*) FROM pg_constraint WHERE conname = ANY(composite) AND contype = 'f' AND NOT convalidated) <> 5 THEN
    RAISE EXCEPTION 'Expected five installed, unvalidated tenant-composite FKs';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conname = ANY(historical) AND contype = 'f' AND convalidated) <> 5 THEN
    RAISE EXCEPTION 'Expected five validated historical parent-existence FKs';
  END IF;
END $$;

INSERT INTO salons(id,name,updated_at) VALUES (md5('p8-salon-c')::uuid,'Synthetic C',now());
INSERT INTO users(id,salon_id,name,email,password_hash,role,updated_at) VALUES
  (md5('p8-user-c')::uuid,md5('p8-salon-c')::uuid,'Synthetic C','p8-c@example.test','synthetic','OWNER',now()),
  (md5('p8-user-b2')::uuid,md5('p8-salon-b')::uuid,'Synthetic B2','p8-b2@example.test','synthetic','OWNER',now());
INSERT INTO customers(id,salon_id,first_name,last_name,phone_number,updated_at)
VALUES(md5('p8-customer-c')::uuid,md5('p8-salon-c')::uuid,'Synthetic','C','09120000003',now());
INSERT INTO vip_requests(id,salon_id,list_id,created_by_user_id,requested_count,geographic_range,status,reserved_until,updated_at)
VALUES(md5('p8-vip-c')::uuid,md5('p8-salon-c')::uuid,md5('p8-list')::uuid,md5('p8-user-c')::uuid,30,'Synthetic','SUBMITTED',now()+interval '1 day',now());
INSERT INTO message_requests(id,salon_id,customer_id,created_by_user_id,message_text,message_business_date,counts_toward_daily_limit,status,recipient_phone_number,updated_at)
VALUES(md5('p8-msg-c')::uuid,md5('p8-salon-c')::uuid,md5('p8-customer-c')::uuid,md5('p8-user-c')::uuid,'Synthetic',current_date,false,'QUEUED','09120000003',now());
INSERT INTO message_requests(id,salon_id,vip_request_id,created_by_user_id,message_text,message_business_date,counts_toward_daily_limit,status,recipient_phone_number,updated_at)
VALUES(md5('p8-vip-msg-b2')::uuid,md5('p8-salon-b')::uuid,md5('p8-vip-b')::uuid,md5('p8-user-b')::uuid,'Synthetic',current_date,false,'QUEUED','09120000013',now());

CREATE FUNCTION pg_temp.expect_operation(label text, statement text, expected_state text, expected_constraint text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual_state text; actual_constraint text; affected bigint; failed boolean := false;
BEGIN
  BEGIN
    EXECUTE statement;
    GET DIAGNOSTICS affected = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    failed := true;
    GET STACKED DIAGNOSTICS actual_state = RETURNED_SQLSTATE, actual_constraint = CONSTRAINT_NAME;
  END;
  IF expected_state = 'OK' THEN
    IF failed OR affected <> 1 THEN
      RAISE EXCEPTION '% expected one successful row, got SQLSTATE %, constraint %, count %', label, actual_state, actual_constraint, affected;
    END IF;
  ELSIF NOT failed OR actual_state <> expected_state OR
        (expected_constraint IS NOT NULL AND actual_constraint IS DISTINCT FROM expected_constraint) THEN
    RAISE EXCEPTION '% expected % / %, got % / %', label, expected_state, expected_constraint, actual_state, actual_constraint;
  END IF;
END $$;

-- A: unrelated mutable updates succeed; B: explicit unchanged key assignments
-- recheck the composite FK; C/D: invalid reference/tenant changes fail.
SELECT pg_temp.expect_operation('action A', $$UPDATE opportunity_actions SET updated_at=now()+interval '1 second' WHERE id=md5('p8-action-cross')::uuid$$, 'OK');
SELECT pg_temp.expect_operation('action B', $$UPDATE opportunity_actions SET created_by=created_by WHERE id=md5('p8-action-cross')::uuid$$, '23503', 'opportunity_actions_created_by_salon_id_fkey');
SELECT pg_temp.expect_operation('action C', $$UPDATE opportunity_actions SET created_by=md5('p8-user-b2')::uuid WHERE id=md5('p8-action-cross')::uuid$$, '23503', 'opportunity_actions_created_by_salon_id_fkey');
SELECT pg_temp.expect_operation('action D', $$UPDATE opportunity_actions SET salon_id=md5('p8-salon-c')::uuid,customer_id=md5('p8-customer-c')::uuid WHERE id=md5('p8-action-cross')::uuid$$, '23503', 'opportunity_actions_created_by_salon_id_fkey');
SELECT pg_temp.expect_operation('request A', $$UPDATE message_requests SET status='DISPATCHED',updated_at=now() WHERE id=md5('p8-msg-cross')::uuid$$, 'OK');
SELECT pg_temp.expect_operation('request B', $$UPDATE message_requests SET created_by_user_id=created_by_user_id WHERE id=md5('p8-msg-cross')::uuid$$, '23503', 'message_requests_created_by_user_id_salon_id_fkey');
SELECT pg_temp.expect_operation('request C', $$UPDATE message_requests SET created_by_user_id=md5('p8-user-b2')::uuid WHERE id=md5('p8-msg-cross')::uuid$$, '23503', 'message_requests_created_by_user_id_salon_id_fkey');
SELECT pg_temp.expect_operation('request D', $$UPDATE message_requests SET salon_id=md5('p8-salon-c')::uuid,customer_id=md5('p8-customer-c')::uuid WHERE id=md5('p8-msg-cross')::uuid$$, '23503', 'message_requests_created_by_user_id_salon_id_fkey');
SELECT pg_temp.expect_operation('delivery A', $$UPDATE message_deliveries SET attempts=attempts+1,updated_at=now() WHERE id=md5('p8-delivery-cross')::uuid$$, 'OK');
SELECT pg_temp.expect_operation('delivery B', $$UPDATE message_deliveries SET created_by=created_by WHERE id=md5('p8-delivery-cross')::uuid$$, '23503', 'message_deliveries_created_by_salon_id_fkey');
SELECT pg_temp.expect_operation('delivery C', $$UPDATE message_deliveries SET created_by=md5('p8-user-b2')::uuid WHERE id=md5('p8-delivery-cross')::uuid$$, '23503', 'message_deliveries_created_by_salon_id_fkey');
SELECT pg_temp.expect_operation('delivery D', $$UPDATE message_deliveries SET salon_id=md5('p8-salon-c')::uuid,customer_id=md5('p8-customer-c')::uuid,message_request_id=md5('p8-msg-c')::uuid WHERE id=md5('p8-delivery-cross')::uuid$$, '23503', 'message_deliveries_created_by_salon_id_fkey');
SELECT pg_temp.expect_operation('vip A', $$UPDATE vip_requests SET status='BALE_NOT_IMPLEMENTED',updated_at=now() WHERE id=md5('p8-vip-cross')::uuid$$, 'OK');
SELECT pg_temp.expect_operation('vip B', $$UPDATE vip_requests SET created_by_user_id=created_by_user_id WHERE id=md5('p8-vip-cross')::uuid$$, '23503', 'vip_requests_created_by_user_id_salon_id_fkey');
SELECT pg_temp.expect_operation('vip C', $$UPDATE vip_requests SET created_by_user_id=md5('p8-user-b2')::uuid WHERE id=md5('p8-vip-cross')::uuid$$, '23503', 'vip_requests_created_by_user_id_salon_id_fkey');
SELECT pg_temp.expect_operation('vip D', $$UPDATE vip_requests SET salon_id=md5('p8-salon-c')::uuid WHERE id=md5('p8-vip-cross')::uuid$$, '23503', 'vip_requests_created_by_user_id_salon_id_fkey');
SELECT pg_temp.expect_operation('recipient A', $$UPDATE vip_request_recipients SET message_text='Still synthetic' WHERE id=md5('p8-recipient-cross')::uuid$$, 'OK');
SELECT pg_temp.expect_operation('recipient B', $$UPDATE vip_request_recipients SET message_request_id=message_request_id WHERE id=md5('p8-recipient-cross')::uuid$$, '23503', 'vip_request_recipients_message_request_id_salon_id_fkey');
SELECT pg_temp.expect_operation('recipient C', $$UPDATE vip_request_recipients SET message_request_id=md5('p8-vip-msg-b2')::uuid WHERE id=md5('p8-recipient-cross')::uuid$$, '23503', 'vip_request_recipients_message_request_id_salon_id_fkey');
SELECT pg_temp.expect_operation('recipient D', $$UPDATE vip_request_recipients SET salon_id=md5('p8-salon-c')::uuid,vip_request_id=md5('p8-vip-c')::uuid WHERE id=md5('p8-recipient-cross')::uuid$$, '23503', 'vip_request_recipients_message_request_id_salon_id_fkey');

-- E: parent metadata edits remain legal. Global-ID parents cannot disappear.
SELECT pg_temp.expect_operation('parent user metadata', $$UPDATE users SET name='Still synthetic' WHERE id=md5('p8-user-b')::uuid$$, 'OK');
SELECT pg_temp.expect_operation('parent user tenant', $$UPDATE users SET salon_id=md5('p8-salon-c')::uuid WHERE id=md5('p8-user-b')::uuid$$, '23503');
SELECT pg_temp.expect_operation('parent user delete', $$DELETE FROM users WHERE id=md5('p8-user-b')::uuid$$, '23503');
SELECT pg_temp.expect_operation('parent message metadata', $$UPDATE message_requests SET updated_at=now() WHERE id=md5('p8-vip-msg-b')::uuid$$, 'OK');
SELECT pg_temp.expect_operation('parent message tenant', $$UPDATE message_requests SET salon_id=md5('p8-salon-c')::uuid,vip_request_id=md5('p8-vip-c')::uuid,created_by_user_id=md5('p8-user-c')::uuid WHERE id=md5('p8-vip-msg-b')::uuid$$, 'OK');
SELECT pg_temp.expect_operation('parent message delete', $$DELETE FROM message_requests WHERE id=md5('p8-vip-msg-b')::uuid$$, '23503', 'vip_request_recipients_message_request_id_fkey');

-- Probe mutations never escape this transaction.
ROLLBACK;
