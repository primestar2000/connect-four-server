-- Add moveTimeoutSeconds column to Tournament table
-- Run this in Supabase SQL Editor

ALTER TABLE "tournaments" 
ADD COLUMN IF NOT EXISTS "moveTimeoutSeconds" INTEGER NOT NULL DEFAULT 30;

-- Add check constraint to ensure timeout is within valid range (10-120 seconds)
ALTER TABLE "tournaments"
ADD CONSTRAINT "tournaments_moveTimeoutSeconds_check" 
CHECK ("moveTimeoutSeconds" >= 10 AND "moveTimeoutSeconds" <= 120);

-- Update existing tournaments to have default timeout
UPDATE "tournaments" 
SET "moveTimeoutSeconds" = 30 
WHERE "moveTimeoutSeconds" IS NULL;

-- Verify the change
SELECT id, name, "moveTimeoutSeconds" FROM "tournaments" LIMIT 5;
