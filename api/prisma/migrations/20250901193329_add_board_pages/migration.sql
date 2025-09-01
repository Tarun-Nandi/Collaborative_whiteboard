-- DropIndex
DROP INDEX "public"."board_events_boardId_createdAt_idx";

-- AlterTable
ALTER TABLE "public"."board_events" ADD COLUMN     "pageId" TEXT;

-- CreateTable
CREATE TABLE "public"."assets" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "pageCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."board_pages" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Page 1',
    "index" INTEGER NOT NULL,
    "width" INTEGER NOT NULL DEFAULT 794,
    "height" INTEGER NOT NULL DEFAULT 1123,
    "backgroundType" TEXT NOT NULL DEFAULT 'blank',
    "gridType" TEXT,
    "gridSize" INTEGER,
    "assetId" TEXT,
    "pdfPage" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_pages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "board_pages_boardId_index_idx" ON "public"."board_pages"("boardId", "index");

-- CreateIndex
CREATE INDEX "board_events_boardId_pageId_createdAt_idx" ON "public"."board_events"("boardId", "pageId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."assets" ADD CONSTRAINT "assets_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."board_pages" ADD CONSTRAINT "board_pages_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "public"."boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."board_pages" ADD CONSTRAINT "board_pages_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "public"."assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."board_events" ADD CONSTRAINT "board_events_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "public"."board_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
