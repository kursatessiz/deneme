-- M3e: consent legal basis, double opt-in and the TR merchant exemption
-- (docs/PAZARLAMA_MODULU.md 6.4, 7.4). Expand only and forward-only: one new
-- enum, nullable contact_consents columns (existing rows keep NULL and are
-- read as CONSENT, already confirmed), a contacts flag with a default, two
-- marketing_settings columns with defaults (EU and UK need double opt-in,
-- exemption off) and one new table for the confirmation links. Nothing
-- existing is altered or dropped.

-- CreateEnum
CREATE TYPE "ConsentLegalBasis" AS ENUM ('CONSENT', 'TR_MERCHANT_EXEMPTION', 'EXISTING_CUSTOMER');

-- AlterTable
ALTER TABLE "contact_consents" ADD COLUMN     "confirmation_requested_at" TIMESTAMP(3),
ADD COLUMN     "confirmed_at" TIMESTAMP(3),
ADD COLUMN     "form_version" VARCHAR(60),
ADD COLUMN     "legal_basis" "ConsentLegalBasis";

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "is_business" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "marketing_settings" ADD COLUMN     "double_opt_in_regions" JSONB NOT NULL DEFAULT '["EU", "UK"]',
ADD COLUMN     "tr_merchant_exemption_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "contact_consent_confirmations" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "contact_consent_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_consent_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contact_consent_confirmations_token_hash_key" ON "contact_consent_confirmations"("token_hash");

-- CreateIndex
CREATE INDEX "contact_consent_confirmations_contact_consent_id_created_at_idx" ON "contact_consent_confirmations"("contact_consent_id", "created_at");

-- CreateIndex
CREATE INDEX "contact_consent_confirmations_studio_id_created_at_idx" ON "contact_consent_confirmations"("studio_id", "created_at");

-- AddForeignKey
ALTER TABLE "contact_consent_confirmations" ADD CONSTRAINT "contact_consent_confirmations_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_consent_confirmations" ADD CONSTRAINT "contact_consent_confirmations_contact_consent_id_fkey" FOREIGN KEY ("contact_consent_id") REFERENCES "contact_consents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

