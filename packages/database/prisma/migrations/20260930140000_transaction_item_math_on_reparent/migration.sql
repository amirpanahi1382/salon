-- Reparenting a historically malformed item is a financial write too.
-- Recreate only this task's trigger; the function and old financial rows stay.
DROP TRIGGER "transaction_items_math_check" ON "transaction_items";
CREATE TRIGGER "transaction_items_math_check"
  BEFORE INSERT OR UPDATE OF "transaction_id", "salon_id", "quantity", "unit_price", "total_amount"
  ON "transaction_items" FOR EACH ROW
  EXECUTE FUNCTION "phase9_check_transaction_item_math"();
