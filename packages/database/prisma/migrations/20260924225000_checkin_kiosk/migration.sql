-- AlterTable
ALTER TABLE "studios" ADD COLUMN     "check_in_window_after_minutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "check_in_window_before_minutes" INTEGER NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "check_in_points" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "check_in_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kiosk_devices" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "pairing_code_hash" VARCHAR(64),
    "pairing_code_expires_at" TIMESTAMP(3),
    "paired_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kiosk_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "check_in_points_token_hash_key" ON "check_in_points"("token_hash");

-- CreateIndex
CREATE INDEX "check_in_points_studio_id_idx" ON "check_in_points"("studio_id");

-- CreateIndex
CREATE INDEX "check_in_points_branch_id_idx" ON "check_in_points"("branch_id");

-- CreateIndex
CREATE INDEX "kiosk_devices_studio_id_idx" ON "kiosk_devices"("studio_id");

-- CreateIndex
CREATE INDEX "kiosk_devices_branch_id_idx" ON "kiosk_devices"("branch_id");

-- AddForeignKey
ALTER TABLE "check_in_points" ADD CONSTRAINT "check_in_points_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_in_points" ADD CONSTRAINT "check_in_points_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiosk_devices" ADD CONSTRAINT "kiosk_devices_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiosk_devices" ADD CONSTRAINT "kiosk_devices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiosk_devices" ADD CONSTRAINT "kiosk_devices_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

