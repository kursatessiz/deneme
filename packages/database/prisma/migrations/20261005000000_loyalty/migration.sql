-- G3a loyalty points (docs/SADAKAT.md): per-tenant program settings, earn
-- rules and a rewards catalogue (tenant data), an append-only points ledger
-- with a cached balance per membership, and redemptions with their effect
-- (a single-use promotion code restricted to the member, units on a member
-- package, or a gift). Promotion codes learn an optional user restriction.
--
-- Forward-only and additive: new tables, and one nullable column on
-- promo_codes, so the previous release keeps working against this schema.

-- CreateEnum
CREATE TYPE "LoyaltyExpiryMode" AS ENUM ('NONE', 'MONTHS_AFTER_EARN');

-- AlterTable
ALTER TABLE "promo_codes" ADD COLUMN     "restricted_to_user_id" UUID;

-- CreateTable
CREATE TABLE "loyalty_settings" (
    "studio_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "expiry_mode" "LoyaltyExpiryMode" NOT NULL DEFAULT 'NONE',
    "expiry_months" INTEGER,
    "expiry_notice_days" INTEGER NOT NULL DEFAULT 14,
    "member_redeem_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_settings_pkey" PRIMARY KEY ("studio_id")
);

-- CreateTable
CREATE TABLE "loyalty_rules" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "points" INTEGER NOT NULL,
    "per_amount" DECIMAL(10,2),
    "currency" VARCHAR(3),
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_rewards" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "type" VARCHAR(30) NOT NULL,
    "cost_points" INTEGER NOT NULL,
    "value" DECIMAL(10,2),
    "currency" VARCHAR(3),
    "validity_days" INTEGER NOT NULL DEFAULT 90,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "member_redeemable" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_accounts" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "lifetime_earned" INTEGER NOT NULL DEFAULT 0,
    "lifetime_redeemed" INTEGER NOT NULL DEFAULT 0,
    "next_expiry_at" TIMESTAMP(3),
    "expiry_notice_for" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_ledger" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "contact_id" UUID,
    "delta" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "reason" VARCHAR(30) NOT NULL,
    "source_type" VARCHAR(30) NOT NULL,
    "source_id" VARCHAR(120) NOT NULL,
    "rule_id" UUID,
    "expires_at" TIMESTAMP(3),
    "created_by_membership_id" UUID,
    "note" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_redemptions" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "reward_id" UUID NOT NULL,
    "ledger_id" UUID NOT NULL,
    "reward_name" VARCHAR(120) NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "points_spent" INTEGER NOT NULL,
    "value" DECIMAL(10,2),
    "currency" VARCHAR(3),
    "promo_code_id" UUID,
    "member_package_id" UUID,
    "created_by_membership_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "loyalty_rules_studio_id_kind_is_active_idx" ON "loyalty_rules"("studio_id", "kind", "is_active");

-- CreateIndex
CREATE INDEX "loyalty_rewards_studio_id_is_active_idx" ON "loyalty_rewards"("studio_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_accounts_membership_id_key" ON "loyalty_accounts"("membership_id");

-- CreateIndex
CREATE INDEX "loyalty_accounts_studio_id_balance_idx" ON "loyalty_accounts"("studio_id", "balance");

-- CreateIndex
CREATE INDEX "loyalty_accounts_next_expiry_at_idx" ON "loyalty_accounts"("next_expiry_at");

-- CreateIndex
CREATE INDEX "loyalty_ledger_studio_id_membership_id_created_at_idx" ON "loyalty_ledger"("studio_id", "membership_id", "created_at");

-- CreateIndex
CREATE INDEX "loyalty_ledger_studio_id_expires_at_idx" ON "loyalty_ledger"("studio_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_ledger_studio_id_source_type_source_id_reason_key" ON "loyalty_ledger"("studio_id", "source_type", "source_id", "reason");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_redemptions_ledger_id_key" ON "loyalty_redemptions"("ledger_id");

-- CreateIndex
CREATE INDEX "loyalty_redemptions_studio_id_membership_id_created_at_idx" ON "loyalty_redemptions"("studio_id", "membership_id", "created_at");

-- AddForeignKey
ALTER TABLE "loyalty_settings" ADD CONSTRAINT "loyalty_settings_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_rules" ADD CONSTRAINT "loyalty_rules_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_rewards" ADD CONSTRAINT "loyalty_rewards_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_redemptions" ADD CONSTRAINT "loyalty_redemptions_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_redemptions" ADD CONSTRAINT "loyalty_redemptions_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_redemptions" ADD CONSTRAINT "loyalty_redemptions_reward_id_fkey" FOREIGN KEY ("reward_id") REFERENCES "loyalty_rewards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_redemptions" ADD CONSTRAINT "loyalty_redemptions_ledger_id_fkey" FOREIGN KEY ("ledger_id") REFERENCES "loyalty_ledger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_redemptions" ADD CONSTRAINT "loyalty_redemptions_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A balance never goes below zero and a ledger row always moves points.
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_balance_non_negative" CHECK ("balance" >= 0);
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_delta_non_zero" CHECK ("delta" <> 0);
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_balance_after_non_negative" CHECK ("balance_after" >= 0);

-- ---------------------------------------------------------------------------
-- Permissions: owners resolve every key in code already; the rows keep the
-- stored lists complete. Reception gets loyalty.view and loyalty.redeem by
-- default (show a balance, hand out a reward at the desk); loyalty.manage
-- (rules, rewards, manual adjustments) stays with the owner unless granted.
-- ---------------------------------------------------------------------------

INSERT INTO "role_template_permissions" ("role_template_id", "permission_key")
SELECT rt."id", p."key"
FROM "role_templates" rt
CROSS JOIN (VALUES ('loyalty.view'), ('loyalty.manage'), ('loyalty.redeem')) AS p("key")
WHERE rt."key" = 'owner' OR rt."is_owner" = true
ON CONFLICT DO NOTHING;

INSERT INTO "role_template_permissions" ("role_template_id", "permission_key")
SELECT rt."id", p."key"
FROM "role_templates" rt
CROSS JOIN (VALUES ('loyalty.view'), ('loyalty.redeem')) AS p("key")
WHERE rt."key" = 'reception' AND rt."is_owner" = false
ON CONFLICT DO NOTHING;
