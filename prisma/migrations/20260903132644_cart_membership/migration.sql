-- Cart lines gain a membership kind and a plan key.
--
-- Written by hand rather than generated: the `kind` column changes enum type,
-- and the generated migration would have dropped and recreated it, discarding
-- live cart rows. The USING cast below converts in place — 'course' and
-- 'class_seat' exist in both enums, so every existing row survives.

CREATE TYPE "CartItemKind" AS ENUM ('course', 'class_seat', 'membership');

ALTER TABLE "CartItem"
  ALTER COLUMN "kind" TYPE "CartItemKind"
  USING "kind"::text::"CartItemKind";

ALTER TABLE "CartItem" ADD COLUMN "planKey" TEXT;

-- At most one membership line per member; choosing another replaces it.
CREATE UNIQUE INDEX "CartItem_userId_kind_planKey_key"
  ON "CartItem"("userId", "kind", "planKey");
