-- AlterTable
ALTER TABLE "BoardEvent" ALTER COLUMN "boardPosition" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "PlayerPokemon" ADD COLUMN     "eggStepsRemaining" INTEGER,
ADD COLUMN     "isEgg" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "pendingEggNodeId" TEXT;
