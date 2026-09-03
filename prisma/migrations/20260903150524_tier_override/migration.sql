-- A tier the owner set by hand, which wins over what the member pays for.
--
-- User.tier is derived from subscriptions by recalcUserTier(). Without a place
-- to record a deliberate override, an owner comping someone would be reverted
-- by the next subscription webhook.

ALTER TABLE "User" ADD COLUMN "tierOverride" INTEGER;
ALTER TABLE "User" ADD COLUMN "tierOverrideAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "tierOverrideReason" TEXT;
