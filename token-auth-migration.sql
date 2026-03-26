-- Token Authentication Migration
-- Run this in Supabase SQL Editor

-- Step 1: Add new columns (nullable first)
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "token" TEXT;
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "password" TEXT;
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "isAnonymous" BOOLEAN DEFAULT true;

-- Step 2: Generate tokens for existing players (using gen_random_uuid)
UPDATE "players" 
SET "token" = gen_random_uuid()::text 
WHERE "token" IS NULL;

-- Step 3: Make token NOT NULL and add default
ALTER TABLE "players" ALTER COLUMN "token" SET NOT NULL;
ALTER TABLE "players" ALTER COLUMN "token" SET DEFAULT gen_random_uuid()::text;

-- Step 4: Add unique constraint on token
CREATE UNIQUE INDEX IF NOT EXISTS "players_token_key" ON "players"("token");

-- Step 5: Add unique constraint on email (partial index for non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS "players_email_key" ON "players"("email") WHERE "email" IS NOT NULL;

-- Step 6: Drop unique constraint from username (allow duplicate usernames for anonymous users)
DROP INDEX IF EXISTS "players_username_key";

-- Step 7: Set isAnonymous to NOT NULL with default
ALTER TABLE "players" ALTER COLUMN "isAnonymous" SET NOT NULL;
ALTER TABLE "players" ALTER COLUMN "isAnonymous" SET DEFAULT true;

-- Verify the changes
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'players'
ORDER BY ordinal_position;
