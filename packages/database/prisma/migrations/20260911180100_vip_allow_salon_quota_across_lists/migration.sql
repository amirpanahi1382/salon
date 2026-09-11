-- A salon may have more than one historical IN_USE list (quota is the limiter).
-- Exclusive reservation remains per list via conditional UPDATE ... WHERE status = 'ACTIVE'.

DROP INDEX IF EXISTS "vip_target_lists_one_in_use_per_salon";
