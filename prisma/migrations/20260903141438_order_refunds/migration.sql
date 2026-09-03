-- Refund tracking on orders.
--
-- Three columns rather than one status flip: a partial refund must be
-- distinguishable from a full one, because only a full refund withdraws access,
-- and revokedAt makes withdrawal idempotent against a redelivered webhook.

ALTER TABLE "Order" ADD COLUMN "refundedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "refundedCents" INTEGER;
ALTER TABLE "Order" ADD COLUMN "revokedAt" TIMESTAMP(3);
