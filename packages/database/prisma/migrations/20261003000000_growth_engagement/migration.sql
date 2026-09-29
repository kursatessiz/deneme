-- G2a growth engagement (docs/KAMPANYA_VE_AKISLAR.md): segments and their
-- materialised members, contact-level commercial consent, campaigns with a
-- per-contact recipient snapshot, and the journey engine (journeys,
-- per-contact enrollments, executed steps) that replaces the W10
-- automation rules.
--
-- Forward-only and additive (expand then contract): automation_rules and
-- automation_runs stay readable and writable. Each legacy rule is converted
-- into a journey by the API backfill (LegacyAutomationMigrator, run on the
-- scheduler heartbeat and before the deprecated /automation-rules wrapper
-- answers), which sets automation_rules.migrated_journey_id in the same
-- transaction that creates the journey. A migrated rule is never evaluated
-- again, and the journey checks automation_runs before enrolling anyone,
-- so a message the old runner already sent is not sent twice.

-- Rows written by G1c before these tables existed cannot reference them.
UPDATE "notification_logs" SET "campaign_id" = NULL WHERE "campaign_id" IS NOT NULL;
UPDATE "notification_logs" SET "journey_run_id" = NULL WHERE "journey_run_id" IS NOT NULL;

-- CreateEnum
CREATE TYPE "SegmentKind" AS ENUM ('DYNAMIC', 'STATIC');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CampaignRecipientStatus" AS ENUM ('PENDING', 'SENT', 'SKIPPED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JourneyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "JourneyEnrollmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'EXITED_GOAL', 'EXITED', 'CANCELLED', 'FAILED');

-- AlterTable
ALTER TABLE "automation_rules" ADD COLUMN     "migrated_at" TIMESTAMP(3),
ADD COLUMN     "migrated_journey_id" UUID;

-- CreateTable
CREATE TABLE "segments" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "kind" "SegmentKind" NOT NULL DEFAULT 'DYNAMIC',
    "rules" JSONB,
    "cached_count" INTEGER NOT NULL DEFAULT 0,
    "refreshed_at" TIMESTAMP(3),
    "created_by_membership_id" UUID,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segment_members" (
    "segment_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "entered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "added_manually" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "segment_members_pkey" PRIMARY KEY ("segment_id","contact_id")
);

-- CreateTable
CREATE TABLE "contact_consents" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "channel" "ConsentChannel" NOT NULL,
    "status" "ConsentStatus" NOT NULL,
    "source" VARCHAR(60) NOT NULL,
    "evidence" VARCHAR(300),
    "granted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "iys_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "segment_id" UUID NOT NULL,
    "channel" "NotificationChannel",
    "template_key" VARCHAR(60) NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduled_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "audience_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_membership_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_recipients" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "status" "CampaignRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "reason_code" VARCHAR(40),
    "channel" "NotificationChannel",
    "notification_log_id" UUID,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journeys" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "status" "JourneyStatus" NOT NULL DEFAULT 'DRAFT',
    "definition" JSONB NOT NULL,
    "template_key" VARCHAR(40),
    "legacy_rule_id" UUID,
    "legacy_rule_type" "AutomationRuleType",
    "activated_at" TIMESTAMP(3),
    "created_by_membership_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journey_enrollments" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "journey_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "status" "JourneyEnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "trigger_ref" VARCHAR(120) NOT NULL,
    "lock_key" VARCHAR(10),
    "current_step_id" VARCHAR(40),
    "step_entered_at" TIMESTAMP(3) NOT NULL,
    "next_run_at" TIMESTAMP(3),
    "locked_until" TIMESTAMP(3),
    "context" JSONB NOT NULL DEFAULT '{}',
    "entered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "exit_reason" VARCHAR(60),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journey_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journey_step_runs" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "journey_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "step_id" VARCHAR(40) NOT NULL,
    "step_type" VARCHAR(20) NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "reason_code" VARCHAR(40),
    "notification_log_id" UUID,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journey_step_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "segments_studio_id_archived_at_idx" ON "segments"("studio_id", "archived_at");

-- CreateIndex
CREATE INDEX "segment_members_studio_id_contact_id_idx" ON "segment_members"("studio_id", "contact_id");

-- CreateIndex
CREATE INDEX "segment_members_segment_id_entered_at_idx" ON "segment_members"("segment_id", "entered_at");

-- CreateIndex
CREATE INDEX "contact_consents_studio_id_status_idx" ON "contact_consents"("studio_id", "status");

-- CreateIndex
CREATE INDEX "contact_consents_iys_synced_at_idx" ON "contact_consents"("iys_synced_at");

-- CreateIndex
CREATE UNIQUE INDEX "contact_consents_contact_id_channel_key" ON "contact_consents"("contact_id", "channel");

-- CreateIndex
CREATE INDEX "campaigns_studio_id_status_idx" ON "campaigns"("studio_id", "status");

-- CreateIndex
CREATE INDEX "campaigns_status_scheduled_at_idx" ON "campaigns"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "campaign_recipients_campaign_id_status_next_attempt_at_idx" ON "campaign_recipients"("campaign_id", "status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipients_campaign_id_contact_id_key" ON "campaign_recipients"("campaign_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "journeys_legacy_rule_id_key" ON "journeys"("legacy_rule_id");

-- CreateIndex
CREATE INDEX "journeys_studio_id_status_idx" ON "journeys"("studio_id", "status");

-- CreateIndex
CREATE INDEX "journeys_status_idx" ON "journeys"("status");

-- CreateIndex
CREATE INDEX "journey_enrollments_status_next_run_at_idx" ON "journey_enrollments"("status", "next_run_at");

-- CreateIndex
CREATE INDEX "journey_enrollments_studio_id_journey_id_status_idx" ON "journey_enrollments"("studio_id", "journey_id", "status");

-- CreateIndex
CREATE INDEX "journey_enrollments_contact_id_idx" ON "journey_enrollments"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "journey_enrollments_journey_id_contact_id_trigger_ref_key" ON "journey_enrollments"("journey_id", "contact_id", "trigger_ref");

-- CreateIndex
CREATE UNIQUE INDEX "journey_enrollments_journey_id_contact_id_lock_key_key" ON "journey_enrollments"("journey_id", "contact_id", "lock_key");

-- CreateIndex
CREATE INDEX "journey_step_runs_journey_id_step_id_status_idx" ON "journey_step_runs"("journey_id", "step_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "journey_step_runs_enrollment_id_step_id_key" ON "journey_step_runs"("enrollment_id", "step_id");

-- CreateIndex
CREATE UNIQUE INDEX "automation_rules_migrated_journey_id_key" ON "automation_rules"("migrated_journey_id");

-- CreateIndex
CREATE INDEX "notification_logs_campaign_id_idx" ON "notification_logs"("campaign_id");

-- CreateIndex
CREATE INDEX "notification_logs_journey_run_id_idx" ON "notification_logs"("journey_run_id");

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_journey_run_id_fkey" FOREIGN KEY ("journey_run_id") REFERENCES "journey_enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_migrated_journey_id_fkey" FOREIGN KEY ("migrated_journey_id") REFERENCES "journeys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segments" ADD CONSTRAINT "segments_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_members" ADD CONSTRAINT "segment_members_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_members" ADD CONSTRAINT "segment_members_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_members" ADD CONSTRAINT "segment_members_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_consents" ADD CONSTRAINT "contact_consents_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_consents" ADD CONSTRAINT "contact_consents_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "segments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_enrollments" ADD CONSTRAINT "journey_enrollments_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_enrollments" ADD CONSTRAINT "journey_enrollments_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_enrollments" ADD CONSTRAINT "journey_enrollments_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_step_runs" ADD CONSTRAINT "journey_step_runs_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_step_runs" ADD CONSTRAINT "journey_step_runs_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_step_runs" ADD CONSTRAINT "journey_step_runs_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "journey_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Permissions: marketing keys for the default owner templates. Owners
-- resolve to every permission anyway; the rows keep the stored list
-- complete. Other roles get them only when a tenant grants them.
-- ---------------------------------------------------------------------------

INSERT INTO "role_template_permissions" ("role_template_id", "permission_key")
SELECT rt."id", p."key"
FROM "role_templates" rt
CROSS JOIN (
  VALUES ('segments.view'), ('segments.manage'), ('campaigns.view'), ('campaigns.manage'), ('journeys.view'), ('journeys.manage')
) AS p("key")
WHERE rt."key" = 'owner' OR rt."is_owner" = true
ON CONFLICT DO NOTHING;
