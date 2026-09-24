-- CreateEnum
CREATE TYPE "PartnerProvider" AS ENUM ('MOCK', 'CLASSPASS', 'URBAN_SPORTS', 'WELLHUB', 'OTHER');

-- CreateEnum
CREATE TYPE "PartnerConnectionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "external_reservation_id" VARCHAR(120),
ADD COLUMN     "partner_cancelled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "partner_connection_id" UUID,
ADD COLUMN     "partner_guest_id" UUID;

-- CreateTable
CREATE TABLE "partner_connections" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "provider" "PartnerProvider" NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "status" "PartnerConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "encrypted_credentials" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "last_sync_at" TIMESTAMP(3),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_guests" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "external_guest_id" VARCHAR(120),
    "phone" VARCHAR(20),
    "full_name" VARCHAR(120) NOT NULL,
    "is_placeholder" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_guests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_spot_allocations" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "reserved_spots" INTEGER NOT NULL DEFAULT 0,
    "used_spots" INTEGER NOT NULL DEFAULT 0,
    "release_at" TIMESTAMP(3) NOT NULL,
    "is_released" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_spot_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_webhook_events" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "event_id" VARCHAR(120) NOT NULL,
    "event_type" VARCHAR(40) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partner_connections_studio_id_status_idx" ON "partner_connections"("studio_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "partner_connections_studio_id_provider_label_key" ON "partner_connections"("studio_id", "provider", "label");

-- CreateIndex
CREATE INDEX "partner_guests_studio_id_connection_id_idx" ON "partner_guests"("studio_id", "connection_id");

-- CreateIndex
CREATE INDEX "partner_guests_connection_id_external_guest_id_idx" ON "partner_guests"("connection_id", "external_guest_id");

-- CreateIndex
CREATE INDEX "partner_spot_allocations_studio_id_release_at_is_released_idx" ON "partner_spot_allocations"("studio_id", "release_at", "is_released");

-- CreateIndex
CREATE UNIQUE INDEX "partner_spot_allocations_connection_id_schedule_id_key" ON "partner_spot_allocations"("connection_id", "schedule_id");

-- CreateIndex
CREATE UNIQUE INDEX "partner_webhook_events_connection_id_event_id_key" ON "partner_webhook_events"("connection_id", "event_id");

-- CreateIndex
CREATE INDEX "bookings_partner_connection_id_idx" ON "bookings"("partner_connection_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_partner_connection_id_external_reservation_id_key" ON "bookings"("partner_connection_id", "external_reservation_id");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_partner_connection_id_fkey" FOREIGN KEY ("partner_connection_id") REFERENCES "partner_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_partner_guest_id_fkey" FOREIGN KEY ("partner_guest_id") REFERENCES "partner_guests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_connections" ADD CONSTRAINT "partner_connections_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_guests" ADD CONSTRAINT "partner_guests_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_guests" ADD CONSTRAINT "partner_guests_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "partner_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_guests" ADD CONSTRAINT "partner_guests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_spot_allocations" ADD CONSTRAINT "partner_spot_allocations_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_spot_allocations" ADD CONSTRAINT "partner_spot_allocations_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "partner_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_spot_allocations" ADD CONSTRAINT "partner_spot_allocations_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "session_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_webhook_events" ADD CONSTRAINT "partner_webhook_events_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_webhook_events" ADD CONSTRAINT "partner_webhook_events_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "partner_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

