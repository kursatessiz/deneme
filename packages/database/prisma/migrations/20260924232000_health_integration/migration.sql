-- CreateEnum
CREATE TYPE "HealthActivityType" AS ENUM ('STRENGTH', 'FLEXIBILITY', 'YOGA', 'PILATES', 'DANCE', 'MARTIAL_ARTS', 'SWIMMING', 'CYCLING', 'RUNNING', 'WALKING', 'TENNIS', 'OTHER');

-- CreateEnum
CREATE TYPE "HealthPlatform" AS ENUM ('APPLE_HEALTH', 'HEALTH_CONNECT');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'HEALTH_DATA';

-- AlterTable
ALTER TABLE "service_types" ADD COLUMN     "health_activity_type" "HealthActivityType" NOT NULL DEFAULT 'OTHER';

-- CreateTable
CREATE TABLE "member_health_settings" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "write_workouts" BOOLEAN NOT NULL DEFAULT false,
    "read_aggregates" BOOLEAN NOT NULL DEFAULT false,
    "share_with_studio" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_health_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_sync_records" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "platform" "HealthPlatform" NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_sync_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_daily_summaries" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "steps" INTEGER,
    "active_energy_kcal" DECIMAL(6,1),
    "resting_heart_rate" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_daily_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "member_health_settings_member_id_key" ON "member_health_settings"("member_id");

-- CreateIndex
CREATE INDEX "health_sync_records_studio_id_member_id_idx" ON "health_sync_records"("studio_id", "member_id");

-- CreateIndex
CREATE UNIQUE INDEX "health_sync_records_member_id_booking_id_platform_key" ON "health_sync_records"("member_id", "booking_id", "platform");

-- CreateIndex
CREATE INDEX "health_daily_summaries_studio_id_member_id_date_idx" ON "health_daily_summaries"("studio_id", "member_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "health_daily_summaries_member_id_date_key" ON "health_daily_summaries"("member_id", "date");

-- AddForeignKey
ALTER TABLE "member_health_settings" ADD CONSTRAINT "member_health_settings_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_health_settings" ADD CONSTRAINT "member_health_settings_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_sync_records" ADD CONSTRAINT "health_sync_records_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_sync_records" ADD CONSTRAINT "health_sync_records_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_sync_records" ADD CONSTRAINT "health_sync_records_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_daily_summaries" ADD CONSTRAINT "health_daily_summaries_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_daily_summaries" ADD CONSTRAINT "health_daily_summaries_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

