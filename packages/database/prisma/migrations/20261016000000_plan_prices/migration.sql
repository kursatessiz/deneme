-- G5c-1b: platform plan prices per billing currency and the studio's
-- billing currency (docs/DENEME_VE_ETKINLESTIRME.md). Forward-only and
-- expand-only: a new table and new nullable columns, nothing is dropped or
-- renamed.
--
-- Backfill: every existing plan gets one plan_prices row from its current
-- plans.price_monthly and plans.currency, so every plan stays offered in the
-- currency it was priced in. plans.price_monthly and plans.currency stay for
-- one release (the application still writes a mirror of one price) and will
-- be dropped by a later contract migration; the application no longer reads
-- them to choose a price.
--
-- plans.currency loses its 'TRY' default (rule 8: no hard-coded currency).
-- Dropping a default is backward compatible: the application always writes
-- the column explicitly.
--
-- studios.billing_currency is a super-admin override; null (every existing
-- row) derives the billing currency from studios.country_code.
--
-- platform_referral_reward_amounts replaces the single AMOUNT reward
-- (platform_billing_settings.referral_reward_amount + currency) with one
-- amount per billing currency; an existing AMOUNT setting is copied into it.
-- The old columns stay for one release.

-- AlterTable
ALTER TABLE "plans" ALTER COLUMN "currency" DROP DEFAULT;

-- AlterTable
ALTER TABLE "studios" ADD COLUMN     "billing_currency" VARCHAR(3);

-- CreateTable
CREATE TABLE "plan_prices" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "price_monthly" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_prices_plan_id_currency_key" ON "plan_prices"("plan_id", "currency");

-- CreateTable
CREATE TABLE "platform_referral_reward_amounts" (
    "currency" VARCHAR(3) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_referral_reward_amounts_pkey" PRIMARY KEY ("currency")
);

-- AddForeignKey
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one price per existing plan from its current price and currency.
INSERT INTO "plan_prices" ("id", "plan_id", "currency", "price_monthly", "created_at", "updated_at")
SELECT gen_random_uuid(), "id", "currency", "price_monthly", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "plans"
ON CONFLICT ("plan_id", "currency") DO NOTHING;

-- Backfill: an existing single-currency AMOUNT reward becomes its one row.
INSERT INTO "platform_referral_reward_amounts" ("currency", "amount", "updated_at")
SELECT "referral_reward_currency", "referral_reward_amount", CURRENT_TIMESTAMP
FROM "platform_billing_settings"
WHERE "referral_reward_kind" = 'AMOUNT'
  AND "referral_reward_amount" IS NOT NULL
  AND "referral_reward_currency" IS NOT NULL
ON CONFLICT ("currency") DO NOTHING;
