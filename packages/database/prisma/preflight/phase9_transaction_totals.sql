-- Read-only Phase 9 deployment preflight. Run against the target database
-- through an approved read-only connection; do not mutate financial history.
WITH item_totals AS (
  SELECT transaction_id, salon_id, count(*) AS item_count,
    sum(total_amount) AS item_sum,
    count(*) FILTER (WHERE total_amount <> unit_price * quantity) AS bad_item_math
  FROM transaction_items GROUP BY transaction_id, salon_id
)
SELECT t.id, t.salon_id, t.status, t.amount,
  coalesce(i.item_count, 0) AS item_count,
  coalesce(i.item_sum, 0) AS item_sum,
  coalesce(i.bad_item_math, 0) AS bad_item_math
FROM transactions t
LEFT JOIN item_totals i ON i.transaction_id = t.id AND i.salon_id = t.salon_id
WHERE coalesce(i.item_count, 0) = 0
   OR t.amount <> coalesce(i.item_sum, 0)
   OR coalesce(i.bad_item_math, 0) > 0
ORDER BY t.salon_id, t.id;

-- Composite FKs normally reject these anomalies. Report them explicitly so
-- deployment review also catches any historical disabled-constraint imports.
SELECT i.id, i.salon_id, i.transaction_id, i.service_id
FROM transaction_items i
LEFT JOIN transactions t ON t.id = i.transaction_id AND t.salon_id = i.salon_id
LEFT JOIN services s ON s.id = i.service_id AND s.salon_id = i.salon_id
WHERE t.id IS NULL OR s.id IS NULL
ORDER BY i.salon_id, i.id;
