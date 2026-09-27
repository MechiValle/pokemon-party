-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "ballShortageActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bidoofTimeActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bigDiceActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "blockedNodeId" TEXT,
ADD COLUMN     "gymsClosedActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pendingItemNodeId" TEXT;
