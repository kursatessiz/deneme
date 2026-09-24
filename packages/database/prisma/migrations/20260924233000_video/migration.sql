-- CreateEnum
CREATE TYPE "SessionDeliveryMode" AS ENUM ('IN_PERSON', 'ONLINE', 'HYBRID');

-- CreateEnum
CREATE TYPE "VideoMeetingProviderKind" AS ENUM ('MANUAL', 'JITSI');

-- CreateEnum
CREATE TYPE "VideoContentProvider" AS ENUM ('EXTERNAL_URL', 'UPLOADED');

-- CreateEnum
CREATE TYPE "VideoContentVisibility" AS ENUM ('MEMBERS_WITH_ACTIVE_PACKAGE', 'ALL_MEMBERS', 'SPECIFIC_PACKAGES');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "join_reminder_sent_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "session_schedules" ADD COLUMN     "delivery_mode" "SessionDeliveryMode" NOT NULL DEFAULT 'IN_PERSON',
ADD COLUMN     "meeting_provider" "VideoMeetingProviderKind",
ADD COLUMN     "meeting_url" TEXT,
ADD COLUMN     "online_capacity" INTEGER;

-- CreateTable
CREATE TABLE "video_contents" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "duration_seconds" INTEGER NOT NULL,
    "provider" "VideoContentProvider" NOT NULL DEFAULT 'EXTERNAL_URL',
    "source_url" TEXT,
    "thumbnail_url" TEXT,
    "service_type_id" UUID,
    "trainer_profile_id" UUID,
    "visibility" "VideoContentVisibility" NOT NULL DEFAULT 'ALL_MEMBERS',
    "credit_cost" INTEGER,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_contents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_content_packages" (
    "video_content_id" UUID NOT NULL,
    "package_definition_id" UUID NOT NULL,

    CONSTRAINT "video_content_packages_pkey" PRIMARY KEY ("video_content_id","package_definition_id")
);

-- CreateTable
CREATE TABLE "video_views" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "video_content_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_position_seconds" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMP(3),
    "credit_charged_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "video_contents_studio_id_is_published_idx" ON "video_contents"("studio_id", "is_published");

-- CreateIndex
CREATE INDEX "video_views_studio_id_video_content_id_idx" ON "video_views"("studio_id", "video_content_id");

-- CreateIndex
CREATE UNIQUE INDEX "video_views_video_content_id_member_id_key" ON "video_views"("video_content_id", "member_id");

-- AddForeignKey
ALTER TABLE "video_contents" ADD CONSTRAINT "video_contents_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_contents" ADD CONSTRAINT "video_contents_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "service_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_contents" ADD CONSTRAINT "video_contents_trainer_profile_id_fkey" FOREIGN KEY ("trainer_profile_id") REFERENCES "trainer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_content_packages" ADD CONSTRAINT "video_content_packages_video_content_id_fkey" FOREIGN KEY ("video_content_id") REFERENCES "video_contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_content_packages" ADD CONSTRAINT "video_content_packages_package_definition_id_fkey" FOREIGN KEY ("package_definition_id") REFERENCES "package_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_views" ADD CONSTRAINT "video_views_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_views" ADD CONSTRAINT "video_views_video_content_id_fkey" FOREIGN KEY ("video_content_id") REFERENCES "video_contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_views" ADD CONSTRAINT "video_views_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

