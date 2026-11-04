-- Run only through the Gate-3 disposable harness. All fixture writes roll back.
BEGIN;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
SET LOCAL session_replication_role = replica;
WITH fixture AS (
  SELECT i, md5('receipt-' || i)::uuid AS receipt_id, md5('salon-' || i)::uuid AS salon_id,
         md5('user-' || i)::uuid AS user_id, md5('acceptance-' || i)::uuid AS acceptance_id
  FROM generate_series(1,250) AS i
)
INSERT INTO activation_receipts
  (id,salon_id,user_id,agreement_acceptance_id,object_key,content_type,byte_size,sha256,phase,stored_at,
   created_at,updated_at,upload_generation,upload_owner_token,upload_locked_until)
SELECT receipt_id,salon_id,user_id,acceptance_id,
       'activation-receipts/' || salon_id || '/' || receipt_id,
       'image/jpeg',1,repeat('a',64),
       CASE WHEN i <= 200 THEN 'STORED'::"ActivationReceiptPhase" ELSE 'UPLOADING'::"ActivationReceiptPhase" END,
       CASE WHEN i <= 200 THEN clock_timestamp() END,
       clock_timestamp(),clock_timestamp(),1,
       CASE WHEN i BETWEEN 201 AND 220 THEN md5('owner-' || i)::uuid END,
       CASE WHEN i BETWEEN 201 AND 220 THEN clock_timestamp()-interval '1 minute' END
FROM fixture;

-- Actual processor candidate query (batch limit configured as 2 in Gate 3).
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, object_key AS "objectKey", upload_generation AS generation
FROM activation_receipts
WHERE phase = 'UPLOADING'::"ActivationReceiptPhase"
  AND upload_owner_token IS NOT NULL
  AND upload_locked_until IS NOT NULL
  AND upload_locked_until <= clock_timestamp()
ORDER BY upload_locked_until, id
LIMIT 2
FOR UPDATE SKIP LOCKED;
ROLLBACK;
