-- G3c-2 retail and stock (docs/PERAKENDE.md): product catalogue with
-- categories (tenant data), stock levels per product and branch, an
-- append-only stock ledger, desk sales with lines, refunds and a gapless
-- receipt sequence per studio, and per-studio retail settings.
--
-- Forward-only and additive: new enums and tables only. Existing tables are
-- untouched (the relations to payments, member_profiles and contacts live on
-- the new sales table), so the previous release keeps working against this
-- schema.

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('RECEIVE', 'SALE', 'RETURN', 'ADJUSTMENT', 'TRANSFER');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOID');

-- CreateTable
CREATE TABLE "retail_settings" (
    "studio_id" UUID NOT NULL,
    "allow_backorder" BOOLEAN NOT NULL DEFAULT false,
    "receipt_prefix" VARCHAR(10) NOT NULL DEFAULT 'S',
    "last_receipt_seq" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retail_settings_pkey" PRIMARY KEY ("studio_id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "category_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "sku" VARCHAR(60),
    "barcode" VARCHAR(64),
    "description" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "tax_rate" DECIMAL(5,2),
    "cost_price" DECIMAL(12,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "track_stock" BOOLEAN NOT NULL DEFAULT true,
    "low_stock_threshold" INTEGER,
    "image_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_levels" (
    "studio_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("product_id","branch_id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "quantity_after" INTEGER NOT NULL,
    "reason" VARCHAR(300),
    "reference" VARCHAR(120),
    "unit_cost" DECIMAL(12,2),
    "sale_id" UUID,
    "sale_refund_id" UUID,
    "actor_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "receipt_seq" INTEGER NOT NULL,
    "receipt_number" VARCHAR(30) NOT NULL,
    "status" "SaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "member_id" UUID,
    "contact_id" UUID,
    "customer_name" VARCHAR(150),
    "currency" VARCHAR(3) NOT NULL,
    "prices_include_tax" BOOLEAN NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_total" DECIMAL(12,2) NOT NULL,
    "tax_total" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "refunded_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "payment_method" "PaymentMethod" NOT NULL,
    "payment_id" UUID,
    "promo_code" VARCHAR(40),
    "promo_discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "idempotency_key" VARCHAR(64),
    "sold_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_lines" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "product_name" VARCHAR(120) NOT NULL,
    "sku" VARCHAR(60),
    "stock_tracked" BOOLEAN NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "unit_cost" DECIMAL(12,2),
    "line_discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "order_discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax_rate" DECIMAL(5,2) NOT NULL,
    "net_amount" DECIMAL(12,2) NOT NULL,
    "tax_amount" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "refunded_quantity" INTEGER NOT NULL DEFAULT 0,
    "refunded_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "sale_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_refunds" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "reason" VARCHAR(300) NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_refund_lines" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "refund_id" UUID NOT NULL,
    "sale_line_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "restocked" BOOLEAN NOT NULL,

    CONSTRAINT "sale_refund_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_studio_id_name_key" ON "product_categories"("studio_id", "name");

-- CreateIndex
CREATE INDEX "products_studio_id_is_active_name_idx" ON "products"("studio_id", "is_active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "products_studio_id_sku_key" ON "products"("studio_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_studio_id_barcode_key" ON "products"("studio_id", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "products_id_studio_id_key" ON "products"("id", "studio_id");

-- CreateIndex
CREATE INDEX "stock_levels_studio_id_branch_id_idx" ON "stock_levels"("studio_id", "branch_id");

-- CreateIndex
CREATE INDEX "stock_movements_studio_id_created_at_idx" ON "stock_movements"("studio_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_product_id_branch_id_created_at_idx" ON "stock_movements"("product_id", "branch_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_sale_id_idx" ON "stock_movements"("sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_payment_id_key" ON "sales"("payment_id");

-- CreateIndex
CREATE INDEX "sales_studio_id_created_at_idx" ON "sales"("studio_id", "created_at");

-- CreateIndex
CREATE INDEX "sales_branch_id_created_at_idx" ON "sales"("branch_id", "created_at");

-- CreateIndex
CREATE INDEX "sales_member_id_idx" ON "sales"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_studio_id_receipt_seq_key" ON "sales"("studio_id", "receipt_seq");

-- CreateIndex
CREATE UNIQUE INDEX "sales_studio_id_receipt_number_key" ON "sales"("studio_id", "receipt_number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_studio_id_idempotency_key_key" ON "sales"("studio_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "sales_id_studio_id_key" ON "sales"("id", "studio_id");

-- CreateIndex
CREATE INDEX "sale_lines_sale_id_idx" ON "sale_lines"("sale_id");

-- CreateIndex
CREATE INDEX "sale_lines_studio_id_product_id_idx" ON "sale_lines"("studio_id", "product_id");

-- CreateIndex
CREATE INDEX "sale_refunds_sale_id_idx" ON "sale_refunds"("sale_id");

-- CreateIndex
CREATE INDEX "sale_refunds_studio_id_created_at_idx" ON "sale_refunds"("studio_id", "created_at");

-- CreateIndex
CREATE INDEX "sale_refund_lines_refund_id_idx" ON "sale_refund_lines"("refund_id");

-- CreateIndex
CREATE INDEX "sale_refund_lines_sale_line_id_idx" ON "sale_refund_lines"("sale_line_id");

-- AddForeignKey
ALTER TABLE "retail_settings" ADD CONSTRAINT "retail_settings_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_product_id_studio_id_fkey" FOREIGN KEY ("product_id", "studio_id") REFERENCES "products"("id", "studio_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_branch_id_studio_id_fkey" FOREIGN KEY ("branch_id", "studio_id") REFERENCES "branches"("id", "studio_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_studio_id_fkey" FOREIGN KEY ("product_id", "studio_id") REFERENCES "products"("id", "studio_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_branch_id_studio_id_fkey" FOREIGN KEY ("branch_id", "studio_id") REFERENCES "branches"("id", "studio_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_branch_id_studio_id_fkey" FOREIGN KEY ("branch_id", "studio_id") REFERENCES "branches"("id", "studio_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_id_studio_id_fkey" FOREIGN KEY ("sale_id", "studio_id") REFERENCES "sales"("id", "studio_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_product_id_studio_id_fkey" FOREIGN KEY ("product_id", "studio_id") REFERENCES "products"("id", "studio_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_refunds" ADD CONSTRAINT "sale_refunds_sale_id_studio_id_fkey" FOREIGN KEY ("sale_id", "studio_id") REFERENCES "sales"("id", "studio_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_refund_lines" ADD CONSTRAINT "sale_refund_lines_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "sale_refunds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_refund_lines" ADD CONSTRAINT "sale_refund_lines_sale_line_id_fkey" FOREIGN KEY ("sale_line_id") REFERENCES "sale_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Integrity rules the ORM schema cannot express.
ALTER TABLE "products" ADD CONSTRAINT "products_price_non_negative" CHECK ("price" >= 0);
ALTER TABLE "products" ADD CONSTRAINT "products_cost_price_non_negative" CHECK ("cost_price" IS NULL OR "cost_price" >= 0);
ALTER TABLE "products" ADD CONSTRAINT "products_tax_rate_range" CHECK ("tax_rate" IS NULL OR ("tax_rate" >= 0 AND "tax_rate" <= 100));
ALTER TABLE "products" ADD CONSTRAINT "products_low_stock_threshold_non_negative" CHECK ("low_stock_threshold" IS NULL OR "low_stock_threshold" >= 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_quantity_non_zero" CHECK ("quantity" <> 0);
ALTER TABLE "sales" ADD CONSTRAINT "sales_total_non_negative" CHECK ("total" >= 0);
ALTER TABLE "sales" ADD CONSTRAINT "sales_refunded_amount_range" CHECK ("refunded_amount" >= 0 AND "refunded_amount" <= "total");
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_refunded_quantity_range" CHECK ("refunded_quantity" >= 0 AND "refunded_quantity" <= "quantity");
ALTER TABLE "sale_refunds" ADD CONSTRAINT "sale_refunds_amount_non_negative" CHECK ("amount" >= 0);
ALTER TABLE "sale_refund_lines" ADD CONSTRAINT "sale_refund_lines_quantity_positive" CHECK ("quantity" > 0);

-- Default permissions (packages/shared/src/permissions.ts): owners get every
-- retail key, reception roles get view + sell. Other roles are left to the
-- tenant.
INSERT INTO "role_template_permissions" ("role_template_id", "permission_key")
SELECT rt."id", p."key"
FROM "role_templates" rt
CROSS JOIN (VALUES ('retail.view'), ('retail.sell'), ('retail.manage'), ('retail.refund')) AS p("key")
WHERE rt."key" = 'owner' OR rt."is_owner" = true
ON CONFLICT DO NOTHING;

INSERT INTO "role_template_permissions" ("role_template_id", "permission_key")
SELECT rt."id", p."key"
FROM "role_templates" rt
CROSS JOIN (VALUES ('retail.view'), ('retail.sell')) AS p("key")
WHERE rt."key" = 'reception' AND rt."is_owner" = false
ON CONFLICT DO NOTHING;
