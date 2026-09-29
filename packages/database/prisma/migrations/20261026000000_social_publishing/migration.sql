-- M4b organic social publishing (docs/PAZARLAMA_MODULU.md 5.2, 7.2).
-- Expand only and forward-only: three new enums and two new tables; nothing
-- existing changes.
-- CreateEnum
CREATE TYPE "SocialProvider" AS ENUM ('META_PAGE', 'INSTAGRAM', 'LINKEDIN_ORG');

-- CreateEnum
CREATE TYPE "SocialConnectionStatus" AS ENUM ('CONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "SocialPostStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "social_connections" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "provider" "SocialProvider" NOT NULL,
    "external_id" VARCHAR(80) NOT NULL,
    "display_name" VARCHAR(160) NOT NULL,
    "encrypted_credentials" TEXT NOT NULL,
    "credential_last4" VARCHAR(4) NOT NULL,
    "status" "SocialConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "last_error" TEXT,
    "connected_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_posts" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "status" "SocialPostStatus" NOT NULL DEFAULT 'DRAFT',
    "locale" VARCHAR(10) NOT NULL DEFAULT 'tr',
    "text" TEXT NOT NULL,
    "media_urls" JSONB NOT NULL DEFAULT '[]',
    "link" VARCHAR(2000),
    "scheduled_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "external_post_id" VARCHAR(160),
    "last_error" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "ai_draft_id" UUID,
    "calendar_item_id" UUID,
    "approval_request_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "brand_check" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_connections_studio_id_status_idx" ON "social_connections"("studio_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "social_connections_studio_id_provider_external_id_key" ON "social_connections"("studio_id", "provider", "external_id");

-- CreateIndex
CREATE INDEX "social_posts_studio_id_status_scheduled_at_idx" ON "social_posts"("studio_id", "status", "scheduled_at");

-- CreateIndex
CREATE INDEX "social_posts_status_scheduled_at_idx" ON "social_posts"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "social_posts_studio_id_calendar_item_id_idx" ON "social_posts"("studio_id", "calendar_item_id");

-- AddForeignKey
ALTER TABLE "social_connections" ADD CONSTRAINT "social_connections_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "social_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

