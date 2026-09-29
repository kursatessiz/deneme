-- G5c-1: trial and activation for new businesses, business-to-business
-- referrals (docs/DENEME_VE_ETKINLESTIRME.md). Expand only: new nullable or
-- defaulted columns and new tables, nothing is dropped or renamed.
--
-- Backfill: every existing studio keeps working exactly as before. The
-- billing_status column defaults to 'ACTIVE' (so all existing rows become
-- ACTIVE when the column is added) and activated_at is set to created_at,
-- since those tenants were live before trials existed. New studios get
-- TRIALING from the API, never from this default.
--
-- plans.currency: existing plans take the platform tenant's currency when
-- a platform tenant exists; the column default only covers databases
-- without one.

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "currency" VARCHAR(3) NOT NULL DEFAULT 'TRY',
ADD COLUMN     "trial_days" INTEGER NOT NULL DEFAULT 14;

-- AlterTable
ALTER TABLE "studios" ADD COLUMN     "activated_at" TIMESTAMP(3),
ADD COLUMN     "billing_status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "billing_status_changed_at" TIMESTAMP(3),
ADD COLUMN     "platform_referral_code" VARCHAR(16),
ADD COLUMN     "trial_ends_at" TIMESTAMP(3),
ADD COLUMN     "trial_reminder_sent_days" INTEGER,
ADD COLUMN     "trial_started_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "touchpoints" ADD COLUMN     "ref_code" VARCHAR(16);

-- CreateTable
CREATE TABLE "platform_billing_payments" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "list_amount" DECIMAL(10,2) NOT NULL,
    "credit_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "credit_months" INTEGER NOT NULL DEFAULT 0,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "period_months" INTEGER NOT NULL DEFAULT 1,
    "provider" "PaymentProvider",
    "provider_reference" VARCHAR(200),
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMP(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_billing_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_referrals" (
    "id" UUID NOT NULL,
    "referrer_studio_id" UUID NOT NULL,
    "referred_studio_id" UUID NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "touchpoint_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'SIGNED_UP',
    "reject_reason" VARCHAR(40),
    "rewarded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studio_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_credit_ledger" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "amount" DECIMAL(10,2),
    "currency" VARCHAR(3),
    "months" INTEGER,
    "referral_id" UUID,
    "billing_payment_id" UUID,
    "idempotency_key" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_credit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_billing_settings" (
    "id" VARCHAR(20) NOT NULL DEFAULT 'platform',
    "referral_reward_kind" VARCHAR(20) NOT NULL DEFAULT 'FREE_MONTHS',
    "referral_reward_amount" DECIMAL(10,2),
    "referral_reward_currency" VARCHAR(3),
    "referral_reward_months" INTEGER DEFAULT 1,
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_billing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_billing_payments_studio_id_created_at_idx" ON "platform_billing_payments"("studio_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "platform_billing_payments_provider_provider_reference_key" ON "platform_billing_payments"("provider", "provider_reference");

-- CreateIndex
CREATE UNIQUE INDEX "studio_referrals_referred_studio_id_key" ON "studio_referrals"("referred_studio_id");

-- CreateIndex
CREATE INDEX "studio_referrals_referrer_studio_id_created_at_idx" ON "studio_referrals"("referrer_studio_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "platform_credit_ledger_idempotency_key_key" ON "platform_credit_ledger"("idempotency_key");

-- CreateIndex
CREATE INDEX "platform_credit_ledger_studio_id_created_at_idx" ON "platform_credit_ledger"("studio_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "studios_platform_referral_code_key" ON "studios"("platform_referral_code");

-- AddForeignKey
ALTER TABLE "platform_billing_payments" ADD CONSTRAINT "platform_billing_payments_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_billing_payments" ADD CONSTRAINT "platform_billing_payments_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_referrals" ADD CONSTRAINT "studio_referrals_referrer_studio_id_fkey" FOREIGN KEY ("referrer_studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_referrals" ADD CONSTRAINT "studio_referrals_referred_studio_id_fkey" FOREIGN KEY ("referred_studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_referrals" ADD CONSTRAINT "studio_referrals_touchpoint_id_fkey" FOREIGN KEY ("touchpoint_id") REFERENCES "touchpoints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_credit_ledger" ADD CONSTRAINT "platform_credit_ledger_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_credit_ledger" ADD CONSTRAINT "platform_credit_ledger_referral_id_fkey" FOREIGN KEY ("referral_id") REFERENCES "studio_referrals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_credit_ledger" ADD CONSTRAINT "platform_credit_ledger_billing_payment_id_fkey" FOREIGN KEY ("billing_payment_id") REFERENCES "platform_billing_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: existing tenants are ACTIVE (column default) and count as activated.
UPDATE "studios" SET "activated_at" = "created_at", "billing_status_changed_at" = CURRENT_TIMESTAMP WHERE "activated_at" IS NULL;

-- Backfill: existing plans are priced in the platform tenant's currency.
UPDATE "plans" SET "currency" = p."currency"
FROM (SELECT "currency" FROM "studios" WHERE "is_platform" = true LIMIT 1) AS p;

-- Guard rails the application also enforces.
ALTER TABLE "studios" ADD CONSTRAINT "studios_billing_status_check"
  CHECK ("billing_status" IN ('TRIALING', 'ACTIVE', 'PAST_DUE', 'RESTRICTED', 'CANCELLED'));
ALTER TABLE "platform_credit_ledger" ADD CONSTRAINT "platform_credit_ledger_value_check"
  CHECK ("amount" IS NOT NULL OR "months" IS NOT NULL);
ALTER TABLE "platform_credit_ledger" ADD CONSTRAINT "platform_credit_ledger_currency_check"
  CHECK ("amount" IS NULL OR "currency" IS NOT NULL);
ALTER TABLE "plans" ADD CONSTRAINT "plans_trial_days_check" CHECK ("trial_days" >= 0 AND "trial_days" <= 365);
