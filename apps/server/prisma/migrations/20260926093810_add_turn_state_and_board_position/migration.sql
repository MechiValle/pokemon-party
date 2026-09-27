-- AlterTable
ALTER TABLE "Player" ALTER COLUMN "boardPosition" SET DEFAULT 'node-a',
ALTER COLUMN "boardPosition" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "currentTurnIndex" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "round" INTEGER NOT NULL DEFAULT 1;
