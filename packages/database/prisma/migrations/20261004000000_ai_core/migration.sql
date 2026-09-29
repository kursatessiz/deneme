-- G3b AI core (docs/YAPAY_ZEKA.md): platform AI settings with the encrypted
-- provider key, per-call usage and cost metering, a per-tenant monthly
-- budget override, per-language glossaries and the background AI
-- translation jobs. Translation overrides learn where their value came
-- from (MANUAL / UPLOAD / AI) and when a person reviewed it.
--
-- Forward-only and additive: every new column is nullable or has a
-- default, so the previous release keeps working against this schema.

-- CreateEnum
CREATE TYPE "TranslationSource" AS ENUM ('MANUAL', 'UPLOAD', 'AI');

-- CreateEnum
CREATE TYPE "AiTask" AS ENUM ('TRANSLATION', 'COPYWRITING', 'REPLY_SUGGESTION');

-- CreateEnum
CREATE TYPE "AiTranslationJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AiTranslationItemStatus" AS ENUM ('PENDING', 'DONE', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "studios" ADD COLUMN     "ai_monthly_budget_cents" INTEGER;

-- AlterTable
ALTER TABLE "translation_overrides" ADD COLUMN     "reviewed_at" TIMESTAMP(3),
ADD COLUMN     "source" "TranslationSource" NOT NULL DEFAULT 'MANUAL';

-- Values that existed before this migration were entered or uploaded by a
-- person, so they count as reviewed.
UPDATE "translation_overrides" SET "reviewed_at" = "updated_at" WHERE "reviewed_at" IS NULL;

-- CreateTable
CREATE TABLE "ai_settings" (
    "id" VARCHAR(20) NOT NULL DEFAULT 'platform',
    "encrypted_api_key" TEXT,
    "api_key_last4" VARCHAR(4),
    "api_key_updated_at" TIMESTAMP(3),
    "api_key_updated_by_user_id" UUID,
    "models" JSONB NOT NULL DEFAULT '{}',
    "price_overrides" JSONB NOT NULL DEFAULT '{}',
    "default_monthly_budget_cents" INTEGER NOT NULL DEFAULT 500,
    "last_test_at" TIMESTAMP(3),
    "last_test_ok" BOOLEAN,
    "last_test_error_code" VARCHAR(40),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" UUID NOT NULL,
    "studio_id" UUID,
    "user_id" UUID,
    "task" "AiTask" NOT NULL,
    "model" VARCHAR(80) NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_creation_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micro_usd" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL,
    "error_code" VARCHAR(40),
    "translation_job_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_glossary_terms" (
    "id" UUID NOT NULL,
    "locale" VARCHAR(10) NOT NULL,
    "term" VARCHAR(120) NOT NULL,
    "translation" VARCHAR(200),
    "note" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_glossary_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_translation_jobs" (
    "id" UUID NOT NULL,
    "locale" VARCHAR(10) NOT NULL,
    "namespaces" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "overwrite" BOOLEAN NOT NULL DEFAULT false,
    "status" "AiTranslationJobStatus" NOT NULL DEFAULT 'QUEUED',
    "total" INTEGER NOT NULL DEFAULT 0,
    "done" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "model" VARCHAR(80),
    "created_by_user_id" UUID,
    "locked_until" TIMESTAMP(3),
    "transient_errors" INTEGER NOT NULL DEFAULT 0,
    "last_error_code" VARCHAR(40),
    "cancel_requested_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_translation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_translation_job_items" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "key" VARCHAR(210) NOT NULL,
    "is_plural" BOOLEAN NOT NULL DEFAULT false,
    "status" "AiTranslationItemStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error_code" VARCHAR(40),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_translation_job_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_usage_studio_id_created_at_idx" ON "ai_usage"("studio_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_created_at_idx" ON "ai_usage"("created_at");

-- CreateIndex
CREATE INDEX "ai_usage_translation_job_id_idx" ON "ai_usage"("translation_job_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_glossary_terms_locale_term_key" ON "ai_glossary_terms"("locale", "term");

-- CreateIndex
CREATE INDEX "ai_translation_jobs_locale_created_at_idx" ON "ai_translation_jobs"("locale", "created_at");

-- CreateIndex
CREATE INDEX "ai_translation_jobs_status_idx" ON "ai_translation_jobs"("status");

-- CreateIndex
CREATE INDEX "ai_translation_job_items_job_id_status_idx" ON "ai_translation_job_items"("job_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_translation_job_items_job_id_key_key" ON "ai_translation_job_items"("job_id", "key");

-- CreateIndex
CREATE INDEX "translation_overrides_locale_source_reviewed_at_idx" ON "translation_overrides"("locale", "source", "reviewed_at");

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_translation_job_id_fkey" FOREIGN KEY ("translation_job_id") REFERENCES "ai_translation_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_glossary_terms" ADD CONSTRAINT "ai_glossary_terms_locale_fkey" FOREIGN KEY ("locale") REFERENCES "languages"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_translation_jobs" ADD CONSTRAINT "ai_translation_jobs_locale_fkey" FOREIGN KEY ("locale") REFERENCES "languages"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_translation_job_items" ADD CONSTRAINT "ai_translation_job_items_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "ai_translation_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

