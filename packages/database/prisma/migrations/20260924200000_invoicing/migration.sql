-- CreateEnum
CREATE TYPE "EInvoiceMode" AS ENUM ('NONE', 'EARSIV', 'EFATURA');

-- CreateEnum
CREATE TYPE "EInvoiceProvider" AS ENUM ('MOCK', 'PARASUT', 'ELOGO', 'FORIBA', 'UYUMSOFT');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "BillingProfileKind" AS ENUM ('INDIVIDUAL', 'COMPANY');

-- CreateTable
CREATE TABLE "invoice_settings" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "legal_name" VARCHAR(200) NOT NULL,
    "tax_office" VARCHAR(100),
    "tax_number" VARCHAR(11),
    "address" TEXT,
    "e_invoice_mode" "EInvoiceMode" NOT NULL DEFAULT 'NONE',
    "provider" "EInvoiceProvider" NOT NULL DEFAULT 'MOCK',
    "default_vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 20,
    "series_prefix" VARCHAR(10) NOT NULL DEFAULT 'A',
    "auto_issue_on_payment" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_counters" (
    "studio_id" UUID NOT NULL,
    "series_prefix" VARCHAR(10) NOT NULL,
    "year" INTEGER NOT NULL,
    "last_sequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("studio_id","series_prefix","year")
);

-- CreateTable
CREATE TABLE "billing_profiles" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "kind" "BillingProfileKind" NOT NULL DEFAULT 'INDIVIDUAL',
    "full_name" VARCHAR(150),
    "tckn" VARCHAR(11),
    "company_title" VARCHAR(200),
    "tax_office" VARCHAR(100),
    "vkn" VARCHAR(10),
    "address" TEXT,
    "email" VARCHAR(120),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "branch_id" UUID,
    "payment_id" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "issue_date" TIMESTAMP(3) NOT NULL,
    "buyer_snapshot" JSONB NOT NULL,
    "lines" JSONB NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "vat_amount" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'TRY',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "provider" "EInvoiceProvider" NOT NULL,
    "provider_uuid" VARCHAR(120),
    "provider_status" VARCHAR(60),
    "pdf_url" TEXT,
    "failure_reason" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_settings_studio_id_key" ON "invoice_settings"("studio_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_profiles_member_id_key" ON "billing_profiles"("member_id");

-- CreateIndex
CREATE INDEX "billing_profiles_studio_id_idx" ON "billing_profiles"("studio_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_payment_id_key" ON "invoices"("payment_id");

-- CreateIndex
CREATE INDEX "invoices_studio_id_issue_date_idx" ON "invoices"("studio_id", "issue_date");

-- CreateIndex
CREATE INDEX "invoices_branch_id_idx" ON "invoices"("branch_id");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_studio_id_number_key" ON "invoices"("studio_id", "number");

-- AddForeignKey
ALTER TABLE "invoice_settings" ADD CONSTRAINT "invoice_settings_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_counters" ADD CONSTRAINT "invoice_counters_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_profiles" ADD CONSTRAINT "billing_profiles_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_profiles" ADD CONSTRAINT "billing_profiles_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

