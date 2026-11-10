-- Optional confirmed VIP offer. Null kind and amount is no discount.
-- Recipient message snapshots copy the offer at create time.

CREATE TYPE "VipDiscountKind" AS ENUM ('PERCENT', 'RIAL');

ALTER TABLE "vip_requests"
  ADD COLUMN "discount_kind" "VipDiscountKind",
  ADD COLUMN "discount_amount" NUMERIC(19, 2);

ALTER TABLE "vip_requests"
  ADD CONSTRAINT "vip_requests_discount_chk" CHECK (
    (
      "discount_kind" IS NULL
      AND "discount_amount" IS NULL
    )
    OR (
      "discount_kind" = 'PERCENT'
      AND "discount_amount" IS NOT NULL
      AND "discount_amount" = trunc("discount_amount")
      AND "discount_amount" >= 1
      AND "discount_amount" <= 100
    )
    OR (
      "discount_kind" = 'RIAL'
      AND "discount_amount" IS NOT NULL
      AND "discount_amount" > 0
    )
  );
