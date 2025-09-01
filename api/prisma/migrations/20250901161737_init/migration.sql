-- CreateEnum
CREATE TYPE "public"."MembershipRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "password" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."boards" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "snapshot" BYTEA,
    "snapshotAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "boards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."memberships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "role" "public"."MembershipRole" NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."share_links" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "canEdit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."board_events" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_userId_boardId_key" ON "public"."memberships"("userId", "boardId");

-- CreateIndex
CREATE UNIQUE INDEX "share_links_token_key" ON "public"."share_links"("token");

-- CreateIndex
CREATE INDEX "board_events_boardId_createdAt_idx" ON "public"."board_events"("boardId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."boards" ADD CONSTRAINT "boards_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."memberships" ADD CONSTRAINT "memberships_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "public"."boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."share_links" ADD CONSTRAINT "share_links_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "public"."boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."board_events" ADD CONSTRAINT "board_events_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "public"."boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
