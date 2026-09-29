-- M3d: weekly marketing insights, email warm-up plan, campaign pause reason.
-- Expand-only: one enum value, two nullable columns and one new table.

-- AlterEnum
ALTER TYPE "AiTask" ADD VALUE IF NOT EXISTS 'MARKETING_WEEKLY_SUMMARY';

-- AlterTable
ALTER TABLE "marketing_settings" ADD COLUMN "email_warmup_plan" JSONB;

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN "pause_reason" VARCHAR(40);

-- CreateTable
CREATE TABLE "marketing_insights" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "kpis" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "actions" JSONB NOT NULL DEFAULT '[]',
    "ai_usage_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_insights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketing_insights_studio_id_created_at_idx" ON "marketing_insights"("studio_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_insights_studio_id_period_start_key" ON "marketing_insights"("studio_id", "period_start");

-- AddForeignKey
ALTER TABLE "marketing_insights" ADD CONSTRAINT "marketing_insights_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
