-- Session epoch (access token revocation). Expand only: one new column with a
-- default, so the previous release keeps working. Forward-only.
-- AlterTable
ALTER TABLE "users" ADD COLUMN "session_epoch" INTEGER NOT NULL DEFAULT 0;
