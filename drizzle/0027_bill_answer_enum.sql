-- Migration: Replace integer score with enum answer in user_bill_answer
-- This prevents data inconsistency where a user has both
-- a direct answer and an active delegation for the same bill.

-- Step 1: Create the enum type
CREATE TYPE "bill_answer_value" AS ENUM ('yes', 'no', 'skip', 'delegated');

-- Step 2: Add the new column (nullable temporarily)
ALTER TABLE "user_bill_answer" ADD COLUMN "answer" "bill_answer_value";

-- Step 3: Migrate existing score data
UPDATE "user_bill_answer" SET "answer" =
  CASE
    WHEN "score" = 1 THEN 'yes'::"bill_answer_value"
    WHEN "score" = -1 THEN 'no'::"bill_answer_value"
    ELSE 'skip'::"bill_answer_value"
  END;

-- Step 4: For any user who has an active (non-rejected) outgoing delegation
--         but still has a direct answer row, mark that row as 'delegated'.
--         This fixes the exact inconsistency the migration is designed to prevent.
UPDATE "user_bill_answer" uba
SET "answer" = 'delegated'::"bill_answer_value"
FROM "vote_delegation" vd
WHERE uba."user_id" = vd."delegator_id"
  AND uba."bill_id" = vd."bill_id"
  AND vd."status" != 'rejected';

-- Step 5: For delegations where the delegator has NO answer row, insert one as 'delegated'
-- Note: Must provide a dummy score value since the old column is still present and NOT NULL.
-- The score column will be dropped in step 7.
INSERT INTO "user_bill_answer" ("user_id", "bill_id", "answer", "score", "created_at", "updated_at")
SELECT DISTINCT vd."delegator_id", vd."bill_id", 'delegated'::"bill_answer_value", 0, NOW(), NOW()
FROM "vote_delegation" vd
WHERE vd."status" != 'rejected'
  AND NOT EXISTS (
    SELECT 1 FROM "user_bill_answer" uba
    WHERE uba."user_id" = vd."delegator_id"
      AND uba."bill_id" = vd."bill_id"
  );

-- Step 6: Make the new column NOT NULL
ALTER TABLE "user_bill_answer" ALTER COLUMN "answer" SET NOT NULL;

-- Step 7: Drop the old score column
ALTER TABLE "user_bill_answer" DROP COLUMN "score";
