-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('MOCK', 'IYZICO', 'PAYTR');

-- CreateEnum
CREATE TYPE "MemberSubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELLED', 'PAUSED');

-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('SUCCEEDED', 'FAILED', 'PENDING');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "currency" VARCHAR(3) NOT NULL DEFAULT 'TRY',
ADD COLUMN     "installment_count" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "member_subscription_id" UUID,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "provider" "PaymentProvider",
ADD COLUMN     "refunded_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "stored_card_id" UUID;

-- CreateTable
CREATE TABLE "stored_cards" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'MOCK',
    "provider_card_token" VARCHAR(200) NOT NULL,
    "last4" VARCHAR(4) NOT NULL,
    "brand" VARCHAR(20) NOT NULL,
    "exp_month" INTEGER NOT NULL,
    "exp_year" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_subscriptions" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "package_definition_id" UUID NOT NULL,
    "stored_card_id" UUID,
    "status" "MemberSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "current_period_start" TIMESTAMP(3) NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "next_charge_at" TIMESTAMP(3) NOT NULL,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "installment_count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "member_subscription_id" UUID NOT NULL,
    "payment_id" UUID,
    "attempt_number" INTEGER NOT NULL,
    "status" "PaymentAttemptStatus" NOT NULL,
    "failure_code" VARCHAR(60),
    "next_retry_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stored_cards_studio_id_member_id_idx" ON "stored_cards"("studio_id", "member_id");

-- CreateIndex
CREATE INDEX "member_subscriptions_studio_id_member_id_idx" ON "member_subscriptions"("studio_id", "member_id");

-- CreateIndex
CREATE INDEX "member_subscriptions_status_next_charge_at_idx" ON "member_subscriptions"("status", "next_charge_at");

-- CreateIndex
CREATE INDEX "payment_attempts_member_subscription_id_idx" ON "payment_attempts"("member_subscription_id");

-- CreateIndex
CREATE INDEX "payments_provider_provider_reference_idx" ON "payments"("provider", "provider_reference");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_member_subscription_id_fkey" FOREIGN KEY ("member_subscription_id") REFERENCES "member_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_stored_card_id_fkey" FOREIGN KEY ("stored_card_id") REFERENCES "stored_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_cards" ADD CONSTRAINT "stored_cards_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_cards" ADD CONSTRAINT "stored_cards_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_subscriptions" ADD CONSTRAINT "member_subscriptions_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_subscriptions" ADD CONSTRAINT "member_subscriptions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_subscriptions" ADD CONSTRAINT "member_subscriptions_package_definition_id_fkey" FOREIGN KEY ("package_definition_id") REFERENCES "package_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_subscriptions" ADD CONSTRAINT "member_subscriptions_stored_card_id_fkey" FOREIGN KEY ("stored_card_id") REFERENCES "stored_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_member_subscription_id_fkey" FOREIGN KEY ("member_subscription_id") REFERENCES "member_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

