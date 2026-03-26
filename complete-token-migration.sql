-- Complete Token Authentication Migration
-- Run this in Supabase SQL Editor

-- Step 1: Check current schema
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'players' 
ORDER BY ordinal_position;

-- Step 2: Add missing columns if they don't exist
DO $$ 
BEGIN
    -- Add token column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'players' AND column_name = 'token') THEN
        ALTER TABLE "players" ADD COLUMN "token" TEXT;
    END IF;

    -- Add email column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'players' AND column_name = 'email') THEN
        ALTER TABLE "players" ADD COLUMN "email" TEXT;
    END IF;

    -- Add password column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'players' AND column_name = 'password') THEN
        ALTER TABLE "players" ADD COLUMN "password" TEXT;
    END IF;

    -- Add isAnonymous column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'players' AND column_name = 'isAnonymous') THEN
        ALTER TABLE "players" ADD COLUMN "isAnonymous" BOOLEAN DEFAULT true;
    END IF;

    -- Add avatar column if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'players' AND column_name = 'avatar') THEN
        ALTER TABLE "players" ADD COLUMN "avatar" TEXT;
    END IF;

    -- Add avatarType column if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'players' AND column_name = 'avatarType') THEN
        ALTER TABLE "players" ADD COLUMN "avatarType" TEXT DEFAULT 'emoji';
    END IF;
END $$;

-- Step 3: Generate tokens for existing players
UPDATE "players" 
SET "token" = gen_random_uuid()::text 
WHERE "token" IS NULL;

-- Step 4: Set default values for new columns
UPDATE "players" 
SET "isAnonymous" = true 
WHERE "isAnonymous" IS NULL;

UPDATE "players" 
SET "avatarType" = 'emoji' 
WHERE "avatarType" IS NULL;

-- Step 5: Make token NOT NULL and add constraints
ALTER TABLE "players" ALTER COLUMN "token" SET NOT NULL;
ALTER TABLE "players" ALTER COLUMN "token" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "players" ALTER COLUMN "isAnonymous" SET NOT NULL;
ALTER TABLE "players" ALTER COLUMN "isAnonymous" SET DEFAULT true;

-- Step 6: Add unique constraints
DO $$ 
BEGIN
    -- Add unique constraint on token
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'players_token_key') THEN
        CREATE UNIQUE INDEX "players_token_key" ON "players"("token");
    END IF;

    -- Add unique constraint on email (partial index for non-null values)
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'players_email_key') THEN
        CREATE UNIQUE INDEX "players_email_key" ON "players"("email") WHERE "email" IS NOT NULL;
    END IF;
END $$;

-- Step 7: Drop unique constraint from username if it exists
DROP INDEX IF EXISTS "players_username_key";

-- Step 8: Verify the final schema
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'players'
ORDER BY ordinal_position;

-- Step 9: Show sample data
SELECT id, token, username, email, "isAnonymous", avatar, "avatarType"
FROM "players"
LIMIT 5;
