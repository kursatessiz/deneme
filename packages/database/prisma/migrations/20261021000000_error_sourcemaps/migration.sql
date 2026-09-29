-- H2 error reporting: stack resolved with uploaded source maps (docs/HATA_RAPORLAMA.md).
-- Expand-only: a nullable column; the raw stack stays in "stack".
ALTER TABLE "error_events" ADD COLUMN "symbolicated_stack" TEXT;
