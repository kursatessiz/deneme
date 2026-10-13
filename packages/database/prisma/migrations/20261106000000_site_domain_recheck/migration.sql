-- Expand-only: columns for the daily re-verification of custom domains.
ALTER TABLE "site_domains" ADD COLUMN "last_checked_at" TIMESTAMP(3);
ALTER TABLE "site_domains" ADD COLUMN "last_failure_at" TIMESTAMP(3);
ALTER TABLE "site_domains" ADD COLUMN "consecutive_failures" INTEGER NOT NULL DEFAULT 0;
