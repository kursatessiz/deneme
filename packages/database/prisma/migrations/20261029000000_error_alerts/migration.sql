-- H3: error reporting completion (docs/HATA_RAPORLAMA.md).
-- Expand-only and forward-only: new tables and new nullable columns. Nothing
-- existing is changed or dropped.

-- AlterTable
ALTER TABLE "error_groups" ADD COLUMN "merged_into_id" UUID;
ALTER TABLE "error_events" ADD COLUMN "symbolicated_context" JSONB;
ALTER TABLE "error_events" ADD COLUMN "feedback" VARCHAR(500);
ALTER TABLE "error_group_studios" ADD COLUMN "owner_notified_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "error_group_aliases" (
    "fingerprint_hash" VARCHAR(64) NOT NULL,
    "group_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "error_group_aliases_pkey" PRIMARY KEY ("fingerprint_hash")
);

-- CreateTable
CREATE TABLE "error_group_buckets" (
    "group_id" UUID NOT NULL,
    "bucket_start" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "error_group_buckets_pkey" PRIMARY KEY ("group_id","bucket_start")
);

-- CreateTable
CREATE TABLE "error_alerts" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "kind" VARCHAR(12) NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "window_count" INTEGER NOT NULL,
    "baseline_total" INTEGER NOT NULL DEFAULT 0,
    "baseline_mean" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "threshold" INTEGER NOT NULL DEFAULT 0,
    "notified_at" TIMESTAMP(3),
    "acknowledged_at" TIMESTAMP(3),
    "acknowledged_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "error_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_alert_deliveries" (
    "id" UUID NOT NULL,
    "alert_id" UUID NOT NULL,
    "sink" VARCHAR(10) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "last_status_code" INTEGER,
    "last_error" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "error_alert_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_settings" (
    "id" VARCHAR(20) NOT NULL DEFAULT 'platform',
    "spike" JSONB NOT NULL DEFAULT '{}',
    "cooldown_minutes" INTEGER NOT NULL DEFAULT 60,
    "webhook_url_encrypted" TEXT,
    "webhook_url_host" VARCHAR(255),
    "webhook_secret_encrypted" TEXT,
    "webhook_secret_last4" VARCHAR(4),
    "webhook_enabled" BOOLEAN NOT NULL DEFAULT true,
    "slack_url_encrypted" TEXT,
    "slack_enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "error_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_studio_settings" (
    "studio_id" UUID NOT NULL,
    "owner_notify" BOOLEAN NOT NULL DEFAULT false,
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "error_studio_settings_pkey" PRIMARY KEY ("studio_id")
);

-- CreateIndex
CREATE INDEX "error_groups_merged_into_id_idx" ON "error_groups"("merged_into_id");
CREATE INDEX "error_group_aliases_group_id_idx" ON "error_group_aliases"("group_id");
CREATE INDEX "error_group_buckets_bucket_start_idx" ON "error_group_buckets"("bucket_start");
CREATE UNIQUE INDEX "error_alerts_group_id_kind_window_start_key" ON "error_alerts"("group_id", "kind", "window_start");
CREATE INDEX "error_alerts_group_id_created_at_idx" ON "error_alerts"("group_id", "created_at");
CREATE INDEX "error_alerts_created_at_idx" ON "error_alerts"("created_at");
CREATE INDEX "error_alert_deliveries_status_next_attempt_at_idx" ON "error_alert_deliveries"("status", "next_attempt_at");
CREATE INDEX "error_alert_deliveries_alert_id_idx" ON "error_alert_deliveries"("alert_id");

-- AddForeignKey
ALTER TABLE "error_groups" ADD CONSTRAINT "error_groups_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "error_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "error_group_aliases" ADD CONSTRAINT "error_group_aliases_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "error_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "error_group_buckets" ADD CONSTRAINT "error_group_buckets_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "error_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "error_alerts" ADD CONSTRAINT "error_alerts_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "error_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "error_alert_deliveries" ADD CONSTRAINT "error_alert_deliveries_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "error_alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "error_studio_settings" ADD CONSTRAINT "error_studio_settings_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
