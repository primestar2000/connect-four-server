-- AlterTable: Add token-based authentication fields
ALTER TABLE "players" ADD COLUMN "token" TEXT;
ALTER TABLE "players" ADD COLUMN "email" TEXT;
ALTER TABLE "players" ADD COLUMN "password" TEXT;
ALTER TABLE "players" ADD COLUMN "isAnonymous" BOOLEAN NOT NULL DEFAULT true;

-- Generate tokens for existing players
UPDATE "players" SET "token" = gen_random_uuid()::text WHERE "token" IS NULL;

-- Make token required and unique
ALTER TABLE "players" ALTER COLUMN "token" SET NOT NULL;
ALTER TABLE "players" ALTER COLUMN "token" SET DEFAULT gen_random_uuid()::text;
CREATE UNIQUE INDEX "players_token_key" ON "players"("token");

-- Make email unique (but nullable)
CREATE UNIQUE INDEX "players_email_key" ON "players"("email") WHERE "email" IS NOT NULL;

-- Remove unique constraint from username (allow duplicate usernames for anonymous users)
DROP INDEX IF EXISTS "players_username_key";
