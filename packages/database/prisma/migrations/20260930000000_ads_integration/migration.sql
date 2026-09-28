-- AlterTable
ALTER TABLE "studios" ADD COLUMN     "attribution_window_days" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "touchpoints" ADD COLUMN     "advertising_consent" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ad_connections" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "platform" VARCHAR(10) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DISCONNECTED',
    "external_account_id" VARCHAR(80) NOT NULL,
    "pixel_or_dataset_id" VARCHAR(80),
    "encrypted_credentials" TEXT NOT NULL,
    "credential_last4" VARCHAR(4) NOT NULL,
    "conversion_action_ids" JSONB NOT NULL DEFAULT '{}',
    "is_test_mode" BOOLEAN NOT NULL DEFAULT false,
    "last_sync_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_entities" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "platform" VARCHAR(10) NOT NULL,
    "level" VARCHAR(10) NOT NULL,
    "external_id" VARCHAR(80) NOT NULL,
    "name" VARCHAR(250) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "parent_external_id" VARCHAR(80),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_spend_daily" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "platform" VARCHAR(10) NOT NULL,
    "level" VARCHAR(10) NOT NULL,
    "external_id" VARCHAR(80) NOT NULL,
    "date" DATE NOT NULL,
    "spend_amount" DECIMAL(14,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_spend_daily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ad_connections_studio_id_status_idx" ON "ad_connections"("studio_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ad_connections_studio_id_platform_label_key" ON "ad_connections"("studio_id", "platform", "label");

-- CreateIndex
CREATE INDEX "ad_entities_studio_id_platform_parent_external_id_idx" ON "ad_entities"("studio_id", "platform", "parent_external_id");

-- CreateIndex
CREATE UNIQUE INDEX "ad_entities_studio_id_platform_level_external_id_key" ON "ad_entities"("studio_id", "platform", "level", "external_id");

-- CreateIndex
CREATE INDEX "ad_spend_daily_studio_id_platform_date_idx" ON "ad_spend_daily"("studio_id", "platform", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ad_spend_daily_studio_id_platform_level_external_id_date_key" ON "ad_spend_daily"("studio_id", "platform", "level", "external_id", "date");

-- AddForeignKey
ALTER TABLE "ad_connections" ADD CONSTRAINT "ad_connections_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_entities" ADD CONSTRAINT "ad_entities_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_spend_daily" ADD CONSTRAINT "ad_spend_daily_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

