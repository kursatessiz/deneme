-- M3c: campaign A/B test and send time modes (docs/PAZARLAMA_MODULU.md 4.3, 7.4).
-- Expand only and forward-only: one new enum, three nullable/defaulted columns
-- on campaigns, one nullable column on campaign_recipients and one new table.
-- Existing rows keep working: sendTimeMode defaults to FIXED, everything else
-- is null.

-- CreateEnum
CREATE TYPE "CampaignSendTimeMode" AS ENUM ('FIXED', 'RECIPIENT_LOCAL', 'BEST_TIME');

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "ab_test" JSONB,
ADD COLUMN     "send_time_local" VARCHAR(5),
ADD COLUMN     "send_time_mode" "CampaignSendTimeMode" NOT NULL DEFAULT 'FIXED';

-- AlterTable
ALTER TABLE "campaign_recipients" ADD COLUMN     "variant_key" VARCHAR(2);

-- CreateTable
CREATE TABLE "campaign_variants" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "key" VARCHAR(2) NOT NULL,
    "template_key" VARCHAR(60),
    "template_overrides" JSONB,
    "ai_draft_id" UUID,
    "is_winner" BOOLEAN NOT NULL DEFAULT false,
    "stats" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_variants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_variants_studio_id_idx" ON "campaign_variants"("studio_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_variants_campaign_id_key_key" ON "campaign_variants"("campaign_id", "key");

-- AddForeignKey
ALTER TABLE "campaign_variants" ADD CONSTRAINT "campaign_variants_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_variants" ADD CONSTRAINT "campaign_variants_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
