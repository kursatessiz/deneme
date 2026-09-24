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
    "open_phone" VARCHAR(20),
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
CREATE UNIQUE INDEX "leads_studio_id_open_phone_key" ON "leads"("studio_id", "open_phone");

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

