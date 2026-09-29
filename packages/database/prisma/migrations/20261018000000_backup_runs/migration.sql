-- D2: database backups managed from the super admin panel (docs/YEDEKLER.md).
-- Forward-only and expand-only: two new enums and two new tables, nothing
-- existing is altered, dropped or renamed.
--
-- backup_settings is a platform singleton (id 'platform'): the schedule and
-- retention the super admin edits, and the run lock (lock_run_id, taken with
-- a conditional update so only one backup runs at a time). The application
-- creates the row on first use, so no backfill is needed.
--
-- backup_runs records every backup the API makes (manual or scheduled). The
-- host cron's backups are not recorded here; the panel sees them through
-- the files they write. Platform data: no studio_id, super admin only.

-- CreateEnum
CREATE TYPE "BackupRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "BackupTrigger" AS ENUM ('MANUAL', 'SCHEDULED');

-- CreateTable
CREATE TABLE "backup_settings" (
    "id" VARCHAR(20) NOT NULL DEFAULT 'platform',
    "schedule_enabled" BOOLEAN NOT NULL DEFAULT true,
    "schedule_time_utc" VARCHAR(5) NOT NULL DEFAULT '01:00',
    "retention_days" INTEGER NOT NULL DEFAULT 35,
    "lock_run_id" UUID,
    "locked_at" TIMESTAMP(3),
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backup_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_runs" (
    "id" UUID NOT NULL,
    "status" "BackupRunStatus" NOT NULL DEFAULT 'RUNNING',
    "trigger" "BackupTrigger" NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "size_bytes" BIGINT,
    "object_key" VARCHAR(512),
    "sha256" VARCHAR(64),
    "verified_at" TIMESTAMP(3),
    "error" VARCHAR(1000),
    "requested_by_user_id" UUID,

    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backup_runs_started_at_idx" ON "backup_runs"("started_at");

-- CreateIndex
CREATE INDEX "backup_runs_trigger_started_at_idx" ON "backup_runs"("trigger", "started_at");
