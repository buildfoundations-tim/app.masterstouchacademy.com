-- Make the account type a thing of its own.
--
-- Running the school was previously expressed as `isOwner` plus a tier of 4,
-- which made the owner indistinguishable from a Crew Leader subscriber in every
-- list, label and report. Tier says what a member *pays for*; role says what
-- someone *is*. Staff carry no tier.
--
-- `owner` is a superset of `instructor` — whoever runs the school can also
-- teach — so one value replaces two booleans that could disagree.

-- The rename comes FIRST. The profile field called `role` was a job title all
-- along, and the name has to be free before the account type can take it.
ALTER TABLE "User" RENAME COLUMN "role" TO "jobTitle";

CREATE TYPE "UserRole" AS ENUM ('member', 'instructor', 'owner');

ALTER TABLE "User" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'member';

-- Backfill before the booleans go. Owner wins where both were set.
UPDATE "User" SET "role" = 'owner'      WHERE "isOwner" = true;
UPDATE "User" SET "role" = 'instructor' WHERE "isOwner" = false AND "isInstructor" = true;

-- Staff are not subscribers. Drop them to the baseline tier so nothing reads
-- them as paying for a plan they never bought. Their access comes from their
-- role now; see isStaff() in src/lib/access.ts.
UPDATE "User" SET "tier" = 1 WHERE "role" <> 'member';

ALTER TABLE "User" DROP COLUMN "isOwner";
ALTER TABLE "User" DROP COLUMN "isInstructor";
