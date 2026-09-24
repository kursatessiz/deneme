-- CreateEnum
CREATE TYPE "AutomationRuleType" AS ENUM ('WIN_BACK', 'PACKAGE_EXPIRING', 'BIRTHDAY', 'FIRST_CLASS_FOLLOW_UP', 'BOOKING_REMINDER', 'NO_SHOW_FOLLOW_UP');

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('SENT', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "automation_rules" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "type" "AutomationRuleType" NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "params" JSONB NOT NULL,
    "template_key" VARCHAR(60) NOT NULL,
    "channel" "NotificationChannel",
    "is_transactional" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "target_ref" VARCHAR(80) NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "status" "AutomationRunStatus" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_rules_studio_id_type_idx" ON "automation_rules"("studio_id", "type");

-- CreateIndex
CREATE INDEX "automation_rules_studio_id_is_active_idx" ON "automation_rules"("studio_id", "is_active");

-- CreateIndex
CREATE INDEX "automation_runs_studio_id_rule_id_created_at_idx" ON "automation_runs"("studio_id", "rule_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "automation_runs_rule_id_user_id_target_ref_key" ON "automation_runs"("rule_id", "user_id", "target_ref");

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "automation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

