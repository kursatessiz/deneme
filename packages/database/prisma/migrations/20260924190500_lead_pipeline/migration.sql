-- W11: lead pipeline (leads, lead_activities).
--
-- The partial unique index below (leads_open_phone_key) is hand-written:
-- Prisma's schema language cannot express a partial unique index (a unique
-- constraint with a WHERE clause), so it is not declared in schema.prisma
-- and `prisma migrate diff` against the current schema will keep reporting
-- it as drift. That is expected; do not "fix" the drift by dropping this
-- index or by adding a full @@unique([studioId, phone]) to the Lead model,
-- which would incorrectly block re-adding a WON/LOST phone as a new lead.

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('WEB_FORM', 'INSTAGRAM', 'WALK_IN', 'REFERRAL', 'PHONE', 'OTHER');

-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('NEW', 'CONTACTED', 'TRIAL_BOOKED', 'TRIAL_DONE', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "LeadActivityType" AS ENUM ('NOTE', 'CALL', 'MESSAGE', 'STAGE_CHANGE', 'TRIAL_BOOKED');

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "branch_id" UUID,
    "full_name" VARCHAR(150) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "email" VARCHAR(120),
    "source" "LeadSource" NOT NULL DEFAULT 'OTHER',
    "source_detail" VARCHAR(200),
    "interest_service_type_id" UUID,
    "stage" "LeadStage" NOT NULL DEFAULT 'NEW',
    "lost_reason" TEXT,
    "owner_membership_id" UUID,
    "next_follow_up_at" TIMESTAMP(3),
    "converted_membership_id" UUID,
    "utm_source" VARCHAR(100),
    "utm_medium" VARCHAR(100),
    "utm_campaign" VARCHAR(100),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_activities" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "type" "LeadActivityType" NOT NULL,
    "body" TEXT NOT NULL,
    "actor_membership_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leads_studio_id_stage_idx" ON "leads"("studio_id", "stage");

-- CreateIndex
CREATE INDEX "leads_studio_id_phone_idx" ON "leads"("studio_id", "phone");

-- CreateIndex
CREATE INDEX "leads_studio_id_next_follow_up_at_idx" ON "leads"("studio_id", "next_follow_up_at");

-- CreateIndex
CREATE INDEX "lead_activities_lead_id_created_at_idx" ON "lead_activities"("lead_id", "created_at");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_interest_service_type_id_fkey" FOREIGN KEY ("interest_service_type_id") REFERENCES "service_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_membership_id_fkey" FOREIGN KEY ("owner_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_membership_id_fkey" FOREIGN KEY ("converted_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_actor_membership_id_fkey" FOREIGN KEY ("actor_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One open (not WON, not LOST) lead per phone per studio. A duplicate
-- submission while a lead is open is folded into an activity instead of a
-- new row (see LeadsService.upsertFromPublicForm); once a lead is WON or
-- LOST, the same phone may start a fresh lead.
CREATE UNIQUE INDEX "leads_open_phone_key" ON "leads" ("studio_id", "phone") WHERE "stage" NOT IN ('WON', 'LOST');
