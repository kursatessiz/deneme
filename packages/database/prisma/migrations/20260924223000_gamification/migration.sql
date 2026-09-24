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


-- Global default badges (studio_id NULL) so every environment, including
-- production where the dev seed never runs, offers them. NULL studio_id is
-- not covered by the (studio_id, key) unique index, hence NOT EXISTS.
INSERT INTO "badge_definitions" ("id", "studio_id", "key", "name", "description", "kind", "threshold", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), NULL, v.key, v.name, v.description, v.kind, v.threshold, true, now(), now()
FROM (VALUES
  ('first-session', 'İlk adım', 'İlk seansına katıldın.', 'FIRST_SESSION'::"BadgeKind", '{"kind": "FIRST_SESSION"}'::jsonb),
  ('milestone-1', '1. seans', 'Toplam 1 seansa katıldın.', 'MILESTONE_SESSIONS'::"BadgeKind", '{"kind": "MILESTONE_SESSIONS", "sessions": 1}'::jsonb),
  ('milestone-10', '10. seans', 'Toplam 10 seansa katıldın.', 'MILESTONE_SESSIONS'::"BadgeKind", '{"kind": "MILESTONE_SESSIONS", "sessions": 10}'::jsonb),
  ('milestone-25', '25. seans', 'Toplam 25 seansa katıldın.', 'MILESTONE_SESSIONS'::"BadgeKind", '{"kind": "MILESTONE_SESSIONS", "sessions": 25}'::jsonb),
  ('milestone-50', '50. seans', 'Toplam 50 seansa katıldın.', 'MILESTONE_SESSIONS'::"BadgeKind", '{"kind": "MILESTONE_SESSIONS", "sessions": 50}'::jsonb),
  ('milestone-100', '100. seans', 'Toplam 100 seansa katıldın.', 'MILESTONE_SESSIONS'::"BadgeKind", '{"kind": "MILESTONE_SESSIONS", "sessions": 100}'::jsonb),
  ('milestone-250', '250. seans', 'Toplam 250 seansa katıldın.', 'MILESTONE_SESSIONS'::"BadgeKind", '{"kind": "MILESTONE_SESSIONS", "sessions": 250}'::jsonb),
  ('streak-4-weeks', '4 haftalık seri', '4 hafta üst üste en az bir seansa katıldın.', 'STREAK_WEEKS'::"BadgeKind", '{"kind": "STREAK_WEEKS", "weeks": 4, "minSessionsPerWeek": 1}'::jsonb),
  ('streak-8-weeks', '8 haftalık seri', '8 hafta üst üste en az bir seansa katıldın.', 'STREAK_WEEKS'::"BadgeKind", '{"kind": "STREAK_WEEKS", "weeks": 8, "minSessionsPerWeek": 1}'::jsonb),
  ('streak-12-weeks', '12 haftalık seri', '12 hafta üst üste en az bir seansa katıldın.', 'STREAK_WEEKS'::"BadgeKind", '{"kind": "STREAK_WEEKS", "weeks": 12, "minSessionsPerWeek": 1}'::jsonb),
  ('variety-3', 'Çok yönlü', '3 farklı hizmet türünde seansa katıldın.', 'VARIETY'::"BadgeKind", '{"kind": "VARIETY", "distinctServiceTypes": 3}'::jsonb),
  ('early-bird', 'Erken kuş', 'Saat 08:00''den önce başlayan bir seansa katıldın.', 'EARLY_BIRD'::"BadgeKind", '{"kind": "EARLY_BIRD", "beforeHour": 8}'::jsonb),
  ('monthly-goal-met', 'Hedefini tuttur', 'Bir ayın hedefini tamamladın.', 'MONTHLY_GOAL_MET'::"BadgeKind", '{"kind": "MONTHLY_GOAL_MET"}'::jsonb)
) AS v(key, name, description, kind, threshold)
WHERE NOT EXISTS (SELECT 1 FROM "badge_definitions" b WHERE b.studio_id IS NULL AND b.key = v.key);
