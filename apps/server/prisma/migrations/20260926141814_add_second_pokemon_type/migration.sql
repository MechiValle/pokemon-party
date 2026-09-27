/*
  Warnings:

  - You are about to drop the column `type` on the `PlayerPokemon` table. All the data in the column will be lost.
  - Added the required column `type1` to the `PlayerPokemon` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PlayerPokemon" DROP COLUMN "type",
ADD COLUMN     "type1" TEXT NOT NULL,
ADD COLUMN     "type2" TEXT;
