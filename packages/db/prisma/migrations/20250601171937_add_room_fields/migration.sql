-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "maxPlayers" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "name" TEXT NOT NULL DEFAULT 'Untitled Room',
ADD COLUMN     "password" TEXT;
