-- The preceding NOT VALID CHECK protects new rows, but PostgreSQL includes
-- the failing row (and its financial values) in CHECK error detail. Replace it
-- without opening a write gap; existing rows still await read-only preflight.
CREATE FUNCTION "phase9_check_transaction_item_math"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."total_amount" <> NEW."unit_price" * NEW."quantity" THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'transaction_items_total_matches_quantity_price',
      MESSAGE = 'transaction item total must equal quantity times unit price';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "transaction_items_math_check"
  BEFORE INSERT OR UPDATE OF "quantity", "unit_price", "total_amount"
  ON "transaction_items" FOR EACH ROW
  EXECUTE FUNCTION "phase9_check_transaction_item_math"();

ALTER TABLE "transaction_items"
  DROP CONSTRAINT "transaction_items_total_matches_quantity_price";
