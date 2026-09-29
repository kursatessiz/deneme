-- G5d-2: bank payouts and reconciliation. Additive and forward-only: four
-- enums, three new tables (payouts, payout_items, payout_connections) and
-- the default permissions. No existing table or column changes.

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'IN_TRANSIT', 'PAID', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PayoutItemType" AS ENUM ('CHARGE', 'REFUND', 'FEE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PayoutReconciliationStatus" AS ENUM ('MATCHED', 'PARTIAL', 'UNMATCHED');

-- CreateEnum
CREATE TYPE "PayoutMatchSource" AS ENUM ('AUTO', 'MANUAL', 'UNMATCHED_MANUAL');

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "provider_payout_id" VARCHAR(120) NOT NULL,
    "status" "PayoutStatus" NOT NULL,
    "arrival_date" TIMESTAMP(3) NOT NULL,
    "gross_amount" DECIMAL(12,2) NOT NULL,
    "fee_amount" DECIMAL(12,2) NOT NULL,
    "refund_amount" DECIMAL(12,2) NOT NULL,
    "net_amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "matched_item_count" INTEGER NOT NULL DEFAULT 0,
    "matchable_item_count" INTEGER NOT NULL DEFAULT 0,
    "reconciliation_status" "PayoutReconciliationStatus" NOT NULL DEFAULT 'UNMATCHED',
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_items" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "payout_id" UUID NOT NULL,
    "provider_item_id" VARCHAR(120) NOT NULL,
    "type" "PayoutItemType" NOT NULL,
    "provider_reference" VARCHAR(120),
    "related_reference" VARCHAR(120),
    "amount" DECIMAL(12,2) NOT NULL,
    "fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "description" VARCHAR(200),
    "payment_id" UUID,
    "match_source" "PayoutMatchSource",

    CONSTRAINT "payout_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_connections" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "provider_account_id" VARCHAR(120),
    "last_synced_at" TIMESTAMP(3),
    "last_error" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payouts_studio_id_arrival_date_idx" ON "payouts"("studio_id", "arrival_date");

-- CreateIndex
CREATE INDEX "payouts_studio_id_reconciliation_status_idx" ON "payouts"("studio_id", "reconciliation_status");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_studio_id_provider_provider_payout_id_key" ON "payouts"("studio_id", "provider", "provider_payout_id");

-- CreateIndex
CREATE INDEX "payout_items_studio_id_payment_id_idx" ON "payout_items"("studio_id", "payment_id");

-- CreateIndex
CREATE INDEX "payout_items_studio_id_provider_reference_idx" ON "payout_items"("studio_id", "provider_reference");

-- CreateIndex
CREATE UNIQUE INDEX "payout_items_payout_id_provider_item_id_key" ON "payout_items"("payout_id", "provider_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "payout_connections_studio_id_provider_key" ON "payout_connections"("studio_id", "provider");

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_connections" ADD CONSTRAINT "payout_connections_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The owner role of every existing studio gets payouts.view and
-- payouts.manage (new studios receive them because owners hold every
-- permission). Other roles are left to the tenant. Idempotent.
INSERT INTO "role_template_permissions" ("role_template_id", "permission_key")
SELECT rt."id", k.key
FROM "role_templates" rt
CROSS JOIN (VALUES ('payouts.view'), ('payouts.manage')) AS k(key)
WHERE rt."key" = 'owner' OR rt."is_owner" = true
ON CONFLICT DO NOTHING;
