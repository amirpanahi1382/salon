\set ON_ERROR_STOP on
-- Run only on an empty, task-owned phase8b_clean database after migrate deploy.
DO $$ BEGIN
  IF current_database() <> 'phase8b_clean' THEN RAISE EXCEPTION 'Wrong disposable database'; END IF;
  IF (SELECT count(*) FROM salons) <> 0 THEN RAISE EXCEPTION 'Clean validation database is not empty'; END IF;
END $$;
ALTER TABLE opportunity_actions VALIDATE CONSTRAINT opportunity_actions_created_by_salon_id_fkey;
ALTER TABLE message_requests VALIDATE CONSTRAINT message_requests_created_by_user_id_salon_id_fkey;
ALTER TABLE message_deliveries VALIDATE CONSTRAINT message_deliveries_created_by_salon_id_fkey;
ALTER TABLE vip_requests VALIDATE CONSTRAINT vip_requests_created_by_user_id_salon_id_fkey;
ALTER TABLE vip_request_recipients VALIDATE CONSTRAINT vip_request_recipients_message_request_id_salon_id_fkey;
DO $$ BEGIN
  IF (SELECT count(*) FROM pg_constraint WHERE conname = ANY(ARRAY[
    'opportunity_actions_created_by_salon_id_fkey',
    'message_requests_created_by_user_id_salon_id_fkey',
    'message_deliveries_created_by_salon_id_fkey',
    'vip_requests_created_by_user_id_salon_id_fkey',
    'vip_request_recipients_message_request_id_salon_id_fkey']) AND convalidated) <> 5 THEN
    RAISE EXCEPTION 'Not all tenant-composite FKs validated';
  END IF;
END $$;
