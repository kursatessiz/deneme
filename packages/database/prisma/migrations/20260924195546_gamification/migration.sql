-- CreateEnum
CREATE TYPE "BadgeKind" AS ENUM ('MILESTONE_SESSIONS', 'STREAK_WEEKS', 'MONTHLY_GOAL_MET', 'FIRST_SESSION', 'EARLY_BIRD', 'VARIETY');

-- AlterTable
ALTER TABLE "member_profiles" ADD COLUMN     "leaderboard_opt_in" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "studios" ADD COLUMN     "gamification_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "badge_definitions" (
    "id" UUID NOT NULL,
    "studio_id" UUID,
    "key" VARCHAR(60) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "kind" "BadgeKind" NOT NULL,
    "threshold" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "badge_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_badges" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "badge_definition_id" UUID NOT NULL,
    "earned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_ref" VARCHAR(100),

    CONSTRAINT "member_badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_goals" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "target_sessions" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_goals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "badge_definitions_studio_id_is_active_idx" ON "badge_definitions"("studio_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "badge_definitions_studio_id_key_key" ON "badge_definitions"("studio_id", "key");

-- CreateIndex
CREATE INDEX "member_badges_studio_id_member_id_idx" ON "member_badges"("studio_id", "member_id");

-- CreateIndex
CREATE UNIQUE INDEX "member_badges_member_id_badge_definition_id_key" ON "member_badges"("member_id", "badge_definition_id");

-- CreateIndex
CREATE INDEX "member_goals_studio_id_month_idx" ON "member_goals"("studio_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "member_goals_member_id_month_key" ON "member_goals"("member_id", "month");

-- AddForeignKey
ALTER TABLE "badge_definitions" ADD CONSTRAINT "badge_definitions_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_badges" ADD CONSTRAINT "member_badges_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_badges" ADD CONSTRAINT "member_badges_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_badges" ADD CONSTRAINT "member_badges_badge_definition_id_fkey" FOREIGN KEY ("badge_definition_id") REFERENCES "badge_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_goals" ADD CONSTRAINT "member_goals_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_goals" ADD CONSTRAINT "member_goals_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

