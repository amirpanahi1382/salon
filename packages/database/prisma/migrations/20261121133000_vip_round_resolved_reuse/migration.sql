-- Occupying is unresolved work only. A fully terminal request must not keep a
-- same-salon unique lock on vip_requests. Round capacity stays on
-- vip_list_round_slots (list_id, reservation_round, salon_id) and slot_no 1–5.
-- Do not rewrite historical request rows.

DROP INDEX IF EXISTS "vip_requests_one_occupying_per_salon_list_round";
