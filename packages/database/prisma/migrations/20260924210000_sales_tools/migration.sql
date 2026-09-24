-- CreateEnum
CREATE TYPE "PromoCodeKind" AS ENUM ('PERCENT', 'FIXED_AMOUNT', 'FREE_UNITS');

-- CreateEnum
CREATE TYPE "GiftCardStatus" AS ENUM ('ACTIVE', 'REDEEMED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GiftCardTransactionType" AS ENUM ('ISSUE', 'REDEEM', 'REFUND', 'ADJUST');

-- CreateEnum
CREATE TYPE "RedemptionCounterSubject" AS ENUM ('TRIAL_PACKAGE', 'PROMO_CODE');

-- AlterTable
ALTER TABLE "package_definitions" ADD COLUMN     "is_trial" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "trial_limit_per_user" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "discount_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "gift_card_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "gift_card_id" UUID,
ADD COLUMN     "gift_card_refunded" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "promo_code_id" UUID;

-- CreateTable
CREATE TABLE "trial_redemptions" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "package_definition_id" UUID NOT NULL,
    "member_package_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trial_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redemption_counters" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "subject" "RedemptionCounterSubject" NOT NULL,
    "subject_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "redemption_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "kind" "PromoCodeKind" NOT NULL,
    "value" DECIMAL(10,2) NOT NULL,
    "valid_from" TIMESTAMP(3),
    "valid_to" TIMESTAMP(3),
    "max_redemptions" INTEGER,
    "redeemed_count" INTEGER NOT NULL DEFAULT 0,
    "per_user_limit" INTEGER NOT NULL DEFAULT 1,
    "min_amount" DECIMAL(10,2),
    "applicable_package_definition_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "new_members_only" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_redemptions" (
    "id" UUID NOT NULL,
    "promo_code_id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "discount_amount" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_cards" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "code_hash" VARCHAR(64) NOT NULL,
    "last4" VARCHAR(4) NOT NULL,
    "initial_amount" DECIMAL(10,2) NOT NULL,
    "balance" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'TRY',
    "purchaser_user_id" UUID,
    "recipient_name" VARCHAR(120),
    "recipient_phone" VARCHAR(20),
    "message" TEXT,
    "expires_at" TIMESTAMP(3),
    "status" "GiftCardStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gift_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_card_transactions" (
    "id" UUID NOT NULL,
    "gift_card_id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "type" "GiftCardTransactionType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "payment_id" UUID,
    "actor_user_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_card_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trial_redemptions_studio_id_user_id_package_definition_id_idx" ON "trial_redemptions"("studio_id", "user_id", "package_definition_id");

-- CreateIndex
CREATE UNIQUE INDEX "redemption_counters_studio_id_subject_subject_id_user_id_key" ON "redemption_counters"("studio_id", "subject", "subject_id", "user_id");

-- CreateIndex
CREATE INDEX "promo_codes_studio_id_is_active_idx" ON "promo_codes"("studio_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_studio_id_code_key" ON "promo_codes"("studio_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "promo_redemptions_payment_id_key" ON "promo_redemptions"("payment_id");

-- CreateIndex
CREATE INDEX "promo_redemptions_promo_code_id_user_id_idx" ON "promo_redemptions"("promo_code_id", "user_id");

-- CreateIndex
CREATE INDEX "promo_redemptions_studio_id_user_id_idx" ON "promo_redemptions"("studio_id", "user_id");

-- CreateIndex
CREATE INDEX "gift_cards_studio_id_status_idx" ON "gift_cards"("studio_id", "status");

-- CreateIndex
CREATE INDEX "gift_cards_purchaser_user_id_idx" ON "gift_cards"("purchaser_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "gift_cards_studio_id_code_hash_key" ON "gift_cards"("studio_id", "code_hash");

-- CreateIndex
CREATE INDEX "gift_card_transactions_gift_card_id_created_at_idx" ON "gift_card_transactions"("gift_card_id", "created_at");

-- CreateIndex
CREATE INDEX "package_definitions_studio_id_is_trial_idx" ON "package_definitions"("studio_id", "is_trial");

-- CreateIndex
CREATE INDEX "payments_promo_code_id_idx" ON "payments"("promo_code_id");

-- CreateIndex
CREATE INDEX "payments_gift_card_id_idx" ON "payments"("gift_card_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_gift_card_id_fkey" FOREIGN KEY ("gift_card_id") REFERENCES "gift_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_redemptions" ADD CONSTRAINT "trial_redemptions_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_redemptions" ADD CONSTRAINT "trial_redemptions_package_definition_id_fkey" FOREIGN KEY ("package_definition_id") REFERENCES "package_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_redemptions" ADD CONSTRAINT "trial_redemptions_member_package_id_fkey" FOREIGN KEY ("member_package_id") REFERENCES "member_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_redemptions" ADD CONSTRAINT "trial_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redemption_counters" ADD CONSTRAINT "redemption_counters_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_purchaser_user_id_fkey" FOREIGN KEY ("purchaser_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_card_transactions" ADD CONSTRAINT "gift_card_transactions_gift_card_id_fkey" FOREIGN KEY ("gift_card_id") REFERENCES "gift_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_card_transactions" ADD CONSTRAINT "gift_card_transactions_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_card_transactions" ADD CONSTRAINT "gift_card_transactions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_card_transactions" ADD CONSTRAINT "gift_card_transactions_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

