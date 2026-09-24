-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'QUALIFIED', 'REWARDED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ReferralRewardType" AS ENUM ('EXTRA_UNITS');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "rating_prompt_sent_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "studios" ADD COLUMN     "google_review_url" TEXT,
ADD COLUMN     "referral_reward_units" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "session_ratings" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "trainer_profile_id" UUID NOT NULL,
    "service_type_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" VARCHAR(1000),
    "is_anonymous_to_trainer" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_codes" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "code" VARCHAR(24) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "referrer_member_id" UUID NOT NULL,
    "referred_user_id" UUID NOT NULL,
    "referred_phone" VARCHAR(20) NOT NULL,
    "referral_code_id" UUID,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "qualified_at" TIMESTAMP(3),
    "rewarded_at" TIMESTAMP(3),
    "reward_type" "ReferralRewardType",
    "reward_units" INTEGER,
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "session_ratings_booking_id_key" ON "session_ratings"("booking_id");

-- CreateIndex
CREATE INDEX "session_ratings_studio_id_trainer_profile_id_idx" ON "session_ratings"("studio_id", "trainer_profile_id");

-- CreateIndex
CREATE INDEX "session_ratings_studio_id_service_type_id_idx" ON "session_ratings"("studio_id", "service_type_id");

-- CreateIndex
CREATE INDEX "session_ratings_studio_id_created_at_idx" ON "session_ratings"("studio_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "referral_codes_member_id_key" ON "referral_codes"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "referral_codes_code_key" ON "referral_codes"("code");

-- CreateIndex
CREATE INDEX "referrals_studio_id_status_idx" ON "referrals"("studio_id", "status");

-- CreateIndex
CREATE INDEX "referrals_studio_id_referrer_member_id_idx" ON "referrals"("studio_id", "referrer_member_id");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_studio_id_referred_user_id_key" ON "referrals"("studio_id", "referred_user_id");

-- AddForeignKey
ALTER TABLE "session_ratings" ADD CONSTRAINT "session_ratings_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_ratings" ADD CONSTRAINT "session_ratings_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_ratings" ADD CONSTRAINT "session_ratings_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_ratings" ADD CONSTRAINT "session_ratings_trainer_profile_id_fkey" FOREIGN KEY ("trainer_profile_id") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_ratings" ADD CONSTRAINT "session_ratings_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "service_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_member_id_fkey" FOREIGN KEY ("referrer_member_id") REFERENCES "member_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_user_id_fkey" FOREIGN KEY ("referred_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referral_code_id_fkey" FOREIGN KEY ("referral_code_id") REFERENCES "referral_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "referral_code" VARCHAR(24);

