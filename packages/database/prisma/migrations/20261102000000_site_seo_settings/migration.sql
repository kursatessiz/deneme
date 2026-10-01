-- S3: per-site search and crawler settings (docs/SEO.md). Expand-only: one new column with a default on an
-- existing table, nothing is dropped or rewritten; code from before this release never reads it.

-- AlterTable
ALTER TABLE "sites" ADD COLUMN "seo_settings" JSONB NOT NULL DEFAULT '{}';
