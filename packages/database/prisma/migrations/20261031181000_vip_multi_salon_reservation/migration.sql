-- Several salons may hold live requests for one list.
-- Same-salon reuse stays blocked by vip_requests_one_active_per_salon_list.
DROP INDEX IF EXISTS "vip_requests_one_open_reservation_per_list";
