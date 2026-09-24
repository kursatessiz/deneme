-- CreateEnum
CREATE TYPE "ChurnRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- AlterTable
ALTER TABLE "studios" ADD COLUMN     "churn_weights" JSONB;

-- CreateTable
CREATE TABLE "member_risk_snapshots" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "previous_score" INTEGER,
    "level" "ChurnRiskLevel" NOT NULL,
    "onboarding" BOOLEAN NOT NULL DEFAULT false,
    "reasons" JSONB NOT NULL,
    "last_attended_at" TIMESTAMP(3),
    "active_package_end_date" TIMESTAMP(3),
    "contacted_at" TIMESTAMP(3),
    "contacted_by_user_id" UUID,
    "contact_note" TEXT,
    "snoozed_until" TIMESTAMP(3),
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_risk_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_risk_history" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "level" "ChurnRiskLevel" NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_risk_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "member_risk_snapshots_member_id_key" ON "member_risk_snapshots"("member_id");

-- CreateIndex
CREATE INDEX "member_risk_snapshots_studio_id_level_score_idx" ON "member_risk_snapshots"("studio_id", "level", "score");

-- CreateIndex
CREATE INDEX "member_risk_history_studio_id_member_id_computed_at_idx" ON "member_risk_history"("studio_id", "member_id", "computed_at");

-- CreateIndex
CREATE INDEX "member_risk_history_studio_id_computed_at_idx" ON "member_risk_history"("studio_id", "computed_at");

-- AddForeignKey
ALTER TABLE "member_risk_snapshots" ADD CONSTRAINT "member_risk_snapshots_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_risk_snapshots" ADD CONSTRAINT "member_risk_snapshots_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_risk_snapshots" ADD CONSTRAINT "member_risk_snapshots_contacted_by_user_id_fkey" FOREIGN KEY ("contacted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_risk_history" ADD CONSTRAINT "member_risk_history_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_risk_history" ADD CONSTRAINT "member_risk_history_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

