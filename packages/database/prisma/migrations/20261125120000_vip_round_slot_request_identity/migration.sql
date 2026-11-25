-- Reject mismatched historical slots before changing any constraint.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM vip_list_round_slots slot
    JOIN vip_requests request ON request.id = slot.vip_request_id
    WHERE slot.salon_id IS DISTINCT FROM request.salon_id
       OR slot.list_id IS DISTINCT FROM request.list_id
       OR slot.reservation_round IS DISTINCT FROM request.reservation_round
  ) THEN
    RAISE EXCEPTION 'vip_round_slot_request_identity_mismatch';
  END IF;
END $$;

ALTER TABLE vip_requests
  ADD CONSTRAINT vip_requests_id_salon_list_round_key
  UNIQUE (id, salon_id, list_id, reservation_round);

ALTER TABLE vip_list_round_slots
  DROP CONSTRAINT vip_list_round_slots_request_salon_fkey;

ALTER TABLE vip_list_round_slots
  ADD CONSTRAINT vip_list_round_slots_request_identity_key
  UNIQUE (vip_request_id, salon_id, list_id, reservation_round);

ALTER TABLE vip_list_round_slots
  ADD CONSTRAINT vip_list_round_slots_request_identity_fkey
  FOREIGN KEY (vip_request_id, salon_id, list_id, reservation_round)
  REFERENCES vip_requests (id, salon_id, list_id, reservation_round)
  ON UPDATE RESTRICT ON DELETE RESTRICT;

COMMIT;
