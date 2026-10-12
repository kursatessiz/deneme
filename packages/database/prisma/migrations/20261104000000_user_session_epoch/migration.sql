-- Session epoch (access token revocation) and the previous refresh token hash
-- (grace window for parallel refreshes). Expand only: new columns with a
-- default or nullable, so the previous release keeps working. Forward-only.
-- AlterTable
ALTER TABLE "users" ADD COLUMN "session_epoch" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "prev_refresh_token_hash" VARCHAR(255),
ADD COLUMN "refresh_rotated_at" TIMESTAMP(3);
