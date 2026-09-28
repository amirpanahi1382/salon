\set ON_ERROR_STOP on
-- Every dirty synthetic relationship must fail explicit validation without
-- changing its row or flipping pg_constraint.convalidated.
DO $$
DECLARE
  children text[] := ARRAY['opportunity_actions','message_requests','message_deliveries','vip_requests','vip_request_recipients'];
  constraints text[] := ARRAY[
    'opportunity_actions_created_by_salon_id_fkey',
    'message_requests_created_by_user_id_salon_id_fkey',
    'message_deliveries_created_by_salon_id_fkey',
    'vip_requests_created_by_user_id_salon_id_fkey',
    'vip_request_recipients_message_request_id_salon_id_fkey'];
  fixture_ids text[] := ARRAY['p8-action-cross','p8-msg-cross','p8-delivery-cross','p8-vip-cross','p8-recipient-cross'];
  n integer;
  failed boolean;
  row_count bigint;
BEGIN
  IF current_database() <> 'phase8_relations' THEN RAISE EXCEPTION 'Wrong disposable database'; END IF;
  FOR n IN 1..5 LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE id = md5($1)::uuid',children[n]) INTO row_count USING fixture_ids[n];
    IF row_count <> 1 THEN RAISE EXCEPTION 'Missing historical fixture %',fixture_ids[n]; END IF;
    failed := false;
    BEGIN
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I',children[n],constraints[n]);
    EXCEPTION WHEN foreign_key_violation THEN
      failed := true;
    END;
    IF NOT failed THEN RAISE EXCEPTION 'Dirty constraint unexpectedly validated: %',constraints[n]; END IF;
    IF (SELECT convalidated FROM pg_constraint WHERE conname = constraints[n]) IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'Dirty constraint state changed: %',constraints[n];
    END IF;
    EXECUTE format('SELECT count(*) FROM %I WHERE id = md5($1)::uuid',children[n]) INTO row_count USING fixture_ids[n];
    IF row_count <> 1 THEN RAISE EXCEPTION 'Historical row was changed: %',fixture_ids[n]; END IF;
  END LOOP;
END $$;
