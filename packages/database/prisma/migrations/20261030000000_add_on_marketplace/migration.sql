-- G5c-2 add-on marketplace (docs/UYGULAMA_PAZARI.md). Expand-only: three new
-- tables, one nullable column on platform_billing_payments and the relaxing
-- of plan_id to nullable (an add-on payment has no plan). Nothing is dropped
-- or renamed, so the previous release keeps working against this schema for
-- plan payments.

-- CreateTable
CREATE TABLE "add_ons" (
    "id" UUID NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "name" JSONB NOT NULL,
    "description" JSONB NOT NULL,
    "promo_video_url" VARCHAR(500),
    "screenshot_urls" JSONB NOT NULL DEFAULT '[]',
    "feature_flag_key" VARCHAR(80) NOT NULL,
    "trial_days" INTEGER NOT NULL DEFAULT 14,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "add_ons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "add_on_prices" (
    "id" UUID NOT NULL,
    "add_on_id" UUID NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "price_monthly" DECIMAL(10,2) NOT NULL,
    "price_yearly" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "add_on_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_add_ons" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "add_on_id" UUID NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'TRIALING',
    "billing_interval" VARCHAR(5),
    "trial_started_at" TIMESTAMP(3),
    "trial_ends_at" TIMESTAMP(3),
    "activated_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "price_snapshot" JSONB,
    "trial_reminder_sent_at" TIMESTAMP(3),
    "renewal_failures" INTEGER NOT NULL DEFAULT 0,
    "next_renewal_attempt_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studio_add_ons_pkey" PRIMARY KEY ("id")
);

-- AlterTable: an add-on payment has no plan; it points at the add-on subscription instead.
ALTER TABLE "platform_billing_payments" ALTER COLUMN "plan_id" DROP NOT NULL;
ALTER TABLE "platform_billing_payments" ADD COLUMN "studio_add_on_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "add_ons_key_key" ON "add_ons"("key");
CREATE INDEX "add_ons_is_published_sort_order_idx" ON "add_ons"("is_published", "sort_order");
CREATE UNIQUE INDEX "add_on_prices_add_on_id_currency_key" ON "add_on_prices"("add_on_id", "currency");
CREATE UNIQUE INDEX "studio_add_ons_studio_id_add_on_id_key" ON "studio_add_ons"("studio_id", "add_on_id");
CREATE INDEX "studio_add_ons_status_current_period_end_idx" ON "studio_add_ons"("status", "current_period_end");
CREATE INDEX "studio_add_ons_add_on_id_status_idx" ON "studio_add_ons"("add_on_id", "status");
CREATE INDEX "platform_billing_payments_studio_add_on_id_idx" ON "platform_billing_payments"("studio_add_on_id");

-- AddForeignKey
ALTER TABLE "add_on_prices" ADD CONSTRAINT "add_on_prices_add_on_id_fkey" FOREIGN KEY ("add_on_id") REFERENCES "add_ons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "studio_add_ons" ADD CONSTRAINT "studio_add_ons_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "studio_add_ons" ADD CONSTRAINT "studio_add_ons_add_on_id_fkey" FOREIGN KEY ("add_on_id") REFERENCES "add_ons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "platform_billing_payments" ADD CONSTRAINT "platform_billing_payments_studio_add_on_id_fkey" FOREIGN KEY ("studio_add_on_id") REFERENCES "studio_add_ons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Value checks (the application validates the same rules with Zod in @platform/shared).
ALTER TABLE "add_ons" ADD CONSTRAINT "add_ons_trial_days_check" CHECK ("trial_days" >= 0 AND "trial_days" <= 90);
ALTER TABLE "add_on_prices" ADD CONSTRAINT "add_on_prices_currency_check" CHECK ("currency" IN ('TRY', 'USD', 'EUR', 'GBP'));
ALTER TABLE "add_on_prices" ADD CONSTRAINT "add_on_prices_amount_check" CHECK ("price_monthly" > 0 AND "price_yearly" > 0);
ALTER TABLE "studio_add_ons" ADD CONSTRAINT "studio_add_ons_status_check" CHECK ("status" IN ('TRIALING', 'ACTIVE', 'CANCELLED', 'EXPIRED'));
ALTER TABLE "studio_add_ons" ADD CONSTRAINT "studio_add_ons_interval_check" CHECK ("billing_interval" IS NULL OR "billing_interval" IN ('MONTH', 'YEAR'));
-- A payment is either for a plan or for an add-on subscription.
ALTER TABLE "platform_billing_payments" ADD CONSTRAINT "platform_billing_payments_target_check" CHECK ("plan_id" IS NOT NULL OR "studio_add_on_id" IS NOT NULL);
