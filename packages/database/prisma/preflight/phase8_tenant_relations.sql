-- Read-only operator preflight. Run against the intended database before migration
-- and again before any later VALIDATE CONSTRAINT. Outputs only internal IDs.
BEGIN READ ONLY;

WITH violations AS (
  SELECT 'opportunity_actions.created_by' AS relation, a.id AS child_id,
    a.salon_id AS child_salon_id, a.created_by AS parent_id, u.salon_id AS parent_salon_id
  FROM opportunity_actions a JOIN users u ON u.id = a.created_by
  WHERE a.salon_id <> u.salon_id
  UNION ALL
  SELECT 'message_requests.created_by_user_id', r.id, r.salon_id,
    r.created_by_user_id, u.salon_id
  FROM message_requests r JOIN users u ON u.id = r.created_by_user_id
  WHERE r.salon_id <> u.salon_id
  UNION ALL
  SELECT 'message_deliveries.created_by', d.id, d.salon_id,
    d.created_by, u.salon_id
  FROM message_deliveries d JOIN users u ON u.id = d.created_by
  WHERE d.salon_id <> u.salon_id
  UNION ALL
  SELECT 'vip_requests.created_by_user_id', v.id, v.salon_id,
    v.created_by_user_id, u.salon_id
  FROM vip_requests v JOIN users u ON u.id = v.created_by_user_id
  WHERE v.salon_id <> u.salon_id
  UNION ALL
  SELECT 'vip_request_recipients.message_request_id', v.id, v.salon_id,
    v.message_request_id, r.salon_id
  FROM vip_request_recipients v JOIN message_requests r ON r.id = v.message_request_id
  WHERE v.salon_id <> r.salon_id
)
SELECT relation, count(*) AS violation_count FROM violations GROUP BY relation ORDER BY relation;

WITH violations AS (
  SELECT 'opportunity_actions.created_by' AS relation, a.id AS child_id,
    a.salon_id AS child_salon_id, a.created_by AS parent_id, u.salon_id AS parent_salon_id
  FROM opportunity_actions a JOIN users u ON u.id = a.created_by
  WHERE a.salon_id <> u.salon_id
  UNION ALL
  SELECT 'message_requests.created_by_user_id', r.id, r.salon_id,
    r.created_by_user_id, u.salon_id
  FROM message_requests r JOIN users u ON u.id = r.created_by_user_id
  WHERE r.salon_id <> u.salon_id
  UNION ALL
  SELECT 'message_deliveries.created_by', d.id, d.salon_id,
    d.created_by, u.salon_id
  FROM message_deliveries d JOIN users u ON u.id = d.created_by
  WHERE d.salon_id <> u.salon_id
  UNION ALL
  SELECT 'vip_requests.created_by_user_id', v.id, v.salon_id,
    v.created_by_user_id, u.salon_id
  FROM vip_requests v JOIN users u ON u.id = v.created_by_user_id
  WHERE v.salon_id <> u.salon_id
  UNION ALL
  SELECT 'vip_request_recipients.message_request_id', v.id, v.salon_id,
    v.message_request_id, r.salon_id
  FROM vip_request_recipients v JOIN message_requests r ON r.id = v.message_request_id
  WHERE v.salon_id <> r.salon_id
)
SELECT relation, child_id, child_salon_id, parent_id, parent_salon_id
FROM violations ORDER BY relation, child_id;

COMMIT;
