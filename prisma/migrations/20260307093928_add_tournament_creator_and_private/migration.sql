/*
  Warnings:

  - A unique constraint covering the columns `[inviteCode]` on the table `tournaments` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "tournaments" ADD COLUMN     "creatorId" TEXT,
ADD COLUMN     "inviteCode" TEXT,
ADD COLUMN     "isPrivate" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "tournaments_inviteCode_key" ON "tournaments"("inviteCode");
