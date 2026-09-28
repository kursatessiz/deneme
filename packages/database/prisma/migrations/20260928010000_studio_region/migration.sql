-- G1a: region settings on Studio (country, currency, tax regime, tax-inclusive pricing).
-- Forward-only, backward-compatible defaults: every existing row backfills to
-- Turkey / TRY / TR_KDV / tax-inclusive, which is what the platform already
-- assumed everywhere before this column existed.
ALTER TABLE "studios"
  ADD COLUMN "country_code" VARCHAR(2) NOT NULL DEFAULT 'TR',
  ADD COLUMN "currency" VARCHAR(3) NOT NULL DEFAULT 'TRY',
  ADD COLUMN "tax_regime" VARCHAR(20) NOT NULL DEFAULT 'TR_KDV',
  ADD COLUMN "prices_include_tax" BOOLEAN NOT NULL DEFAULT true;

-- Explicit backfill for existing rows (a no-op given the column defaults
-- above, kept so this migration documents the backfill and stays correct
-- even if the column defaults are ever changed later).
UPDATE "studios"
SET "country_code" = 'TR', "currency" = 'TRY', "tax_regime" = 'TR_KDV', "prices_include_tax" = true
WHERE "country_code" IS NULL OR "currency" IS NULL OR "tax_regime" IS NULL;
