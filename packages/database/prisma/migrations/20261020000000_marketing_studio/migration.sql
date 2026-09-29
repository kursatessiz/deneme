-- M2: marketing studio (docs/PAZARLAMA_MODULU.md 4, 7.3): brand kit, product
-- facts, AI studio drafts with variants, the content calendar, three new AI
-- task values and the marketing AI monthly budget setting.
-- Expand only and forward-only: three enum values, one column with a default
-- on ai_settings, and seven new tables that reference studios. Nothing
-- existing is altered or dropped. The new AiTask values are not used in this
-- migration, so ADD VALUE is safe inside its transaction.

-- CreateEnum
CREATE TYPE "MarketingDraftStatus" AS ENUM ('DRAFT', 'REVIEWED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContentCalendarStatus" AS ENUM ('PLANNED', 'DRAFTED', 'APPROVED', 'SENT', 'CANCELLED');

-- AlterEnum
ALTER TYPE "AiTask" ADD VALUE IF NOT EXISTS 'MARKETING_DRAFT';
ALTER TYPE "AiTask" ADD VALUE IF NOT EXISTS 'MARKETING_ANALYSIS';
ALTER TYPE "AiTask" ADD VALUE IF NOT EXISTS 'MARKETING_RESEARCH';

-- AlterTable
ALTER TABLE "ai_settings" ADD COLUMN     "marketing_ai_monthly_budget_cents" INTEGER NOT NULL DEFAULT 5000;

-- CreateTable
CREATE TABLE "brand_kits" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "brand_name" VARCHAR(80) NOT NULL,
    "positioning" VARCHAR(400) NOT NULL DEFAULT '',
    "default_locale" VARCHAR(10) NOT NULL,
    "links" JSONB NOT NULL DEFAULT '{}',
    "sender_identities" JSONB NOT NULL DEFAULT '{}',
    "icps" JSONB NOT NULL DEFAULT '[]',
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_kits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_kit_locales" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "brand_kit_id" UUID NOT NULL,
    "locale" VARCHAR(10) NOT NULL,
    "tone_notes" TEXT NOT NULL DEFAULT '',
    "do_list" JSONB NOT NULL DEFAULT '[]',
    "dont_list" JSONB NOT NULL DEFAULT '[]',
    "banned_phrases" JSONB NOT NULL DEFAULT '[]',
    "required_disclaimers" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_kit_locales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_facts" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "category" VARCHAR(40) NOT NULL DEFAULT 'general',
    "statements" JSONB NOT NULL DEFAULT '{}',
    "source_url" VARCHAR(300),
    "valid_until" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_drafts" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "locale" VARCHAR(10) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "status" "MarketingDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "brief" JSONB,
    "notes" TEXT,
    "fact_keys" JSONB NOT NULL DEFAULT '[]',
    "brand_kit_version" INTEGER,
    "ab_test" JSONB,
    "exported_campaign_id" UUID,
    "ai_model" VARCHAR(80),
    "ai_cost_micro_usd" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_draft_variants" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "draft_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "key" VARCHAR(4) NOT NULL,
    "content" JSONB NOT NULL,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "edited_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_draft_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_calendar_items" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "scheduled_date" DATE NOT NULL,
    "status" "ContentCalendarStatus" NOT NULL DEFAULT 'PLANNED',
    "draft_id" UUID,
    "campaign_id" UUID,
    "owner_user_id" UUID,
    "notes" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_calendar_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brand_kits_studio_id_key" ON "brand_kits"("studio_id");

-- CreateIndex
CREATE INDEX "brand_kit_locales_studio_id_idx" ON "brand_kit_locales"("studio_id");

-- CreateIndex
CREATE UNIQUE INDEX "brand_kit_locales_brand_kit_id_locale_key" ON "brand_kit_locales"("brand_kit_id", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "product_facts_studio_id_key_key" ON "product_facts"("studio_id", "key");

-- CreateIndex
CREATE INDEX "marketing_drafts_studio_id_status_created_at_idx" ON "marketing_drafts"("studio_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "marketing_drafts_studio_id_kind_idx" ON "marketing_drafts"("studio_id", "kind");

-- CreateIndex
CREATE INDEX "marketing_draft_variants_studio_id_idx" ON "marketing_draft_variants"("studio_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_draft_variants_draft_id_key_key" ON "marketing_draft_variants"("draft_id", "key");

-- CreateIndex
CREATE INDEX "content_calendar_items_studio_id_scheduled_date_idx" ON "content_calendar_items"("studio_id", "scheduled_date");

-- AddForeignKey
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_kit_locales" ADD CONSTRAINT "brand_kit_locales_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_kit_locales" ADD CONSTRAINT "brand_kit_locales_brand_kit_id_fkey" FOREIGN KEY ("brand_kit_id") REFERENCES "brand_kits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_facts" ADD CONSTRAINT "product_facts_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_drafts" ADD CONSTRAINT "marketing_drafts_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_draft_variants" ADD CONSTRAINT "marketing_draft_variants_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_draft_variants" ADD CONSTRAINT "marketing_draft_variants_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "marketing_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_calendar_items" ADD CONSTRAINT "content_calendar_items_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_calendar_items" ADD CONSTRAINT "content_calendar_items_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "marketing_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

