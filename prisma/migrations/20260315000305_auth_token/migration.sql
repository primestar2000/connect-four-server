/*
  Warnings:

  - A unique constraint covering the columns `[email]` on the table `players` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "players" ADD COLUMN     "avatar" TEXT,
ADD COLUMN     "avatarType" TEXT DEFAULT 'emoji',
ALTER COLUMN "token" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "players_email_key" ON "players"("email");
