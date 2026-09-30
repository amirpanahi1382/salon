-- Existing financial rows are not rewritten or implicitly validated. Run the
-- Phase 9 preflight before deployment and resolve historical provenance first.
-- NOT VALID protects new/updated items without scanning old financial history.
ALTER TABLE "transaction_items"
  ADD CONSTRAINT "transaction_items_total_matches_quantity_price"
  CHECK ("total_amount" = "unit_price" * "quantity") NOT VALID;

-- PostgreSQL cannot express this aggregate as a table CHECK. Constraint
-- triggers defer the check until the transaction boundary, so a header can be
-- inserted before its items. Only inserts and financial-column changes are
-- checked; status-only VOID and unrelated updates to historical rows remain
-- possible even if a pre-existing discrepancy is awaiting provenance review.
CREATE FUNCTION "phase9_check_transaction_item_total"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_ids uuid[];
  parent_id uuid;
  header_amount numeric;
  item_count bigint;
  item_sum numeric;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'transactions_items_read_committed_required',
      MESSAGE = 'financial writes require read committed isolation';
  END IF;

  IF TG_TABLE_NAME = 'transactions' THEN
    parent_ids := ARRAY[NEW.id];
  ELSIF TG_OP = 'INSERT' THEN
    parent_ids := ARRAY[NEW.transaction_id];
  ELSIF TG_OP = 'DELETE' THEN
    parent_ids := ARRAY[OLD.transaction_id];
  ELSE
    parent_ids := ARRAY[OLD.transaction_id, NEW.transaction_id];
  END IF;

  -- Serialize competing writers through the parent, in UUID order. The item
  -- sum is a separate statement after each lock: at READ COMMITTED it sees
  -- the latest committed competing item writes plus this transaction's writes.
  FOR parent_id IN SELECT DISTINCT candidate FROM unnest(parent_ids) AS candidate ORDER BY candidate LOOP
    SELECT "amount" INTO header_amount
      FROM "transactions" WHERE "id" = parent_id FOR NO KEY UPDATE;
    IF NOT FOUND THEN
      CONTINUE; -- Parent deletion remains subject to its existing FK rules.
    END IF;
    SELECT count(*), coalesce(sum("total_amount"), 0)
      INTO item_count, item_sum
      FROM "transaction_items" WHERE "transaction_id" = parent_id;
    IF item_count = 0 OR item_sum <> header_amount THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        CONSTRAINT = 'transactions_items_total_matches_amount',
        MESSAGE = 'transaction total must equal its nonempty item total';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "transactions_items_total_check"
  AFTER INSERT OR UPDATE OF "amount", "salon_id" ON "transactions"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION "phase9_check_transaction_item_total"();

CREATE CONSTRAINT TRIGGER "transaction_items_parent_total_check"
  AFTER INSERT OR UPDATE OF "transaction_id", "salon_id", "quantity", "unit_price", "total_amount"
    OR DELETE ON "transaction_items"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION "phase9_check_transaction_item_total"();
