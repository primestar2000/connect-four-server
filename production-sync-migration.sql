-- Complete Production Database Sync Migration
-- Run this on your production database (Render/Supabase)

-- Step 1: Add token authentication fields to Player table
ALTER TABLE "players" 
ADD COLUMN IF NOT EXISTS "token" TEXT,
ADD COLUMN IF NOT EXISTS "email" TEXT,
ADD COLUMN IF NOT EXISTS "password" TEXT,
ADD COLUMN IF NOT EXISTS "isAnonymous" BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS "avatar" TEXT,
ADD COLUMN IF NOT EXISTS "avatarType" TEXT DEFAULT 'emoji';

-- Step 2: Generate tokens for existing players
UPDATE "players" 
SET "token" = gen_random_uuid()::text 
WHERE "token" IS NULL;

-- Step 3: Make token NOT NULL and UNIQUE
ALTER TABLE "players" 
ALTER COLUMN "token" SET NOT NULL,
ALTER COLUMN "token" SET DEFAULT gen_random_uuid()::text;

CREATE UNIQUE INDEX IF NOT EXISTS "players_token_key" ON "players"("token");
CREATE UNIQUE INDEX IF NOT EXISTS "players_email_key" ON "players"("email") WHERE "email" IS NOT NULL;

-- Step 4: Add moveTimeoutSeconds to Tournament table
ALTER TABLE "tournaments" 
ADD COLUMN IF NOT EXISTS "moveTimeoutSeconds" INTEGER NOT NULL DEFAULT 30;

-- Step 5: Add constraint for timeout range
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'tournaments_moveTimeoutSeconds_check'
    ) THEN
        ALTER TABLE "tournaments"
        ADD CONSTRAINT "tournaments_moveTimeoutSeconds_check" 
        CHECK ("moveTimeoutSeconds" >= 10 AND "moveTimeoutSeconds" <= 120);
    END IF;
END $$;

-- Step 6: Verify the changes
SELECT 
    'players' as table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'players'
AND column_name IN ('token', 'email', 'password', 'isAnonymous', 'avatar', 'avatarType')
ORDER BY column_name;

SELECT 
    'tournaments' as table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'tournaments'
AND column_name = 'moveTimeoutSeconds';

-- Success message
SELECT 'Production database migration completed successfully!' as status;
