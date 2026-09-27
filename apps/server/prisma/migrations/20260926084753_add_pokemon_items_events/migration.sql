-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "medals" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PlayerPokemon" (
    "id" TEXT NOT NULL,
    "species" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "bp" DOUBLE PRECISION NOT NULL,
    "isAce" BOOLEAN NOT NULL DEFAULT false,
    "isFainted" BOOLEAN NOT NULL DEFAULT false,
    "playerId" TEXT NOT NULL,
    "heldItemId" TEXT,

    CONSTRAINT "PlayerPokemon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "boardPosition" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "expiresAtRound" INTEGER NOT NULL,
    "roomId" TEXT NOT NULL,

    CONSTRAINT "BoardEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "round" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "roomId" TEXT NOT NULL,

    CONSTRAINT "GameEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlayerPokemon_heldItemId_key" ON "PlayerPokemon"("heldItemId");

-- AddForeignKey
ALTER TABLE "PlayerPokemon" ADD CONSTRAINT "PlayerPokemon_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerPokemon" ADD CONSTRAINT "PlayerPokemon_heldItemId_fkey" FOREIGN KEY ("heldItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardEvent" ADD CONSTRAINT "BoardEvent_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameEvent" ADD CONSTRAINT "GameEvent_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
