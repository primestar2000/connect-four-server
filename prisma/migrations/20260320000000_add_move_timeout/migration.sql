/*
  Adds the per-move time limit to tournaments.

  This column was previously only ever applied by hand through the Supabase SQL
  editor (add-move-timeout.sql), so any database built from migrations alone was
  missing it and every tournament query failed against it.
*/
-- AlterTable
ALTER TABLE "tournaments"
ADD COLUMN IF NOT EXISTS "moveTimeoutSeconds" INTEGER NOT NULL DEFAULT 30;

-- Keep the stored value inside the range the application accepts.
ALTER TABLE "tournaments"
DROP CONSTRAINT IF EXISTS "tournaments_moveTimeoutSeconds_check";

ALTER TABLE "tournaments"
ADD CONSTRAINT "tournaments_moveTimeoutSeconds_check"
CHECK ("moveTimeoutSeconds" >= 10 AND "moveTimeoutSeconds" <= 120);
