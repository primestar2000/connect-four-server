/*
  Adds avatar fields to players and replaces the partial unique index on email
  with the plain unique index the schema expects.
*/
-- AlterTable
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "avatar" TEXT,
ADD COLUMN IF NOT EXISTS "avatarType" TEXT DEFAULT 'emoji';

ALTER TABLE "players" ALTER COLUMN "token" DROP DEFAULT;

-- The previous migration already created an index of this name, as a partial
-- index. Creating it again unconditionally made this migration fail on any fresh
-- database, which stopped the whole chain from ever being applied. A unique index
-- on a nullable column already permits multiple NULLs, so the partial form was
-- never needed.
DROP INDEX IF EXISTS "players_email_key";

-- CreateIndex
CREATE UNIQUE INDEX "players_email_key" ON "players"("email");
