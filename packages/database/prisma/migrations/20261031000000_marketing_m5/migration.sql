-- M5 (marketing, later): ad spend cap auto-pause and SES identity automation.
-- Expand-only: new defaulted or nullable columns and one new table.

ALTER TABLE "marketing_settings" ADD COLUMN "ad_cap_auto_pause" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "email_sender_domains" ADD COLUMN "ses_provisioned_at" TIMESTAMP(3);
ALTER TABLE "email_sender_domains" ADD COLUMN "ses_verification_status" VARCHAR(20);

CREATE TABLE "ad_cap_pauses" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "platform" VARCHAR(10) NOT NULL,
    "campaign_external_id" VARCHAR(80) NOT NULL,
    "campaign_name" VARCHAR(250) NOT NULL,
    "month_key" VARCHAR(7) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "spent_amount" DECIMAL(14,4) NOT NULL,
    "cap_amount" DECIMAL(14,4) NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "last_error" VARCHAR(500),
    "paused_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_cap_pauses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ad_cap_pauses_studio_id_month_key_idx" ON "ad_cap_pauses"("studio_id", "month_key");

CREATE UNIQUE INDEX "ad_cap_pauses_studio_id_platform_campaign_external_id_month_key_key" ON "ad_cap_pauses"("studio_id", "platform", "campaign_external_id", "month_key");

ALTER TABLE "ad_cap_pauses" ADD CONSTRAINT "ad_cap_pauses_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
