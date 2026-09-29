-- M3b: marketing approvals (docs/PAZARLAMA_MODULU.md 6.1, 6.2, 7.4): approval
-- requests for outgoing actions, the marketing settings of a tenant, two new
-- campaign states and two nullable campaign columns.
-- Expand only and forward-only: two enum values, two new enums, two nullable
-- columns and two new tables that reference studios. Nothing existing is
-- altered or dropped. The new CampaignStatus values are not used in this
-- migration, so ADD VALUE is safe inside its transaction (PostgreSQL 12+).

-- CreateEnum
CREATE TYPE "ApprovalTargetType" AS ENUM ('CAMPAIGN', 'JOURNEY', 'SOCIAL_POST', 'PAGE_PUBLISH', 'AD_BUDGET', 'AD_ACTIVATE', 'EXPORT');

-- CreateEnum
CREATE TYPE "ApprovalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'SELF_APPROVED');

-- AlterEnum
ALTER TYPE "CampaignStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';
ALTER TYPE "CampaignStatus" ADD VALUE IF NOT EXISTS 'PAUSED';

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "approval_request_id" UUID,
ADD COLUMN     "created_by_user_id" UUID;

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "target_type" "ApprovalTargetType" NOT NULL,
    "target_id" UUID NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_user_id" UUID NOT NULL,
    "decided_by_user_id" UUID,
    "decision_note" VARCHAR(1000),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_settings" (
    "studio_id" UUID NOT NULL,
    "self_approve_email_max" INTEGER NOT NULL DEFAULT 1000,
    "self_approve_sms_max" INTEGER NOT NULL DEFAULT 100,
    "self_approve_sms_credits" INTEGER NOT NULL DEFAULT 100,
    "require_approval_for_social" BOOLEAN NOT NULL DEFAULT false,
    "daily_email_cap" INTEGER,
    "daily_sms_credit_cap" INTEGER,
    "monthly_ad_spend_caps" JSONB NOT NULL DEFAULT '{}',
    "ai_daily_cap_cents" INTEGER,
    "bounce_auto_pause_pct" DECIMAL(6,3) NOT NULL DEFAULT 2,
    "complaint_auto_pause_pct" DECIMAL(6,3) NOT NULL DEFAULT 0.08,
    "mql_rule" JSONB,
    "sql_rule" JSONB,
    "weekly_summary_enabled" BOOLEAN NOT NULL DEFAULT false,
    "weekly_summary_recipients" JSONB NOT NULL DEFAULT '[]',
    "approval_ttl_hours" INTEGER NOT NULL DEFAULT 72,
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_settings_pkey" PRIMARY KEY ("studio_id")
);

-- CreateIndex
CREATE INDEX "approval_requests_studio_id_status_created_at_idx" ON "approval_requests"("studio_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "approval_requests_studio_id_target_type_target_id_idx" ON "approval_requests"("studio_id", "target_type", "target_id");

-- CreateIndex
CREATE INDEX "approval_requests_status_expires_at_idx" ON "approval_requests"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_settings" ADD CONSTRAINT "marketing_settings_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

