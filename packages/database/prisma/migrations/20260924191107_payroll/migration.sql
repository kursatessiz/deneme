-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID');

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "branch_id" UUID,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "total_gross" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_adjustments" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_net" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_by_user_id" UUID NOT NULL,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_lines" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "trainer_profile_id" UUID NOT NULL,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "attendees" INTEGER NOT NULL DEFAULT 0,
    "gross_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "adjustments" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "lines" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_runs_studio_id_branch_id_period_start_period_end_idx" ON "payroll_runs"("studio_id", "branch_id", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "payroll_runs_studio_id_status_idx" ON "payroll_runs"("studio_id", "status");

-- CreateIndex
CREATE INDEX "payroll_lines_studio_id_trainer_profile_id_idx" ON "payroll_lines"("studio_id", "trainer_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_lines_run_id_trainer_profile_id_key" ON "payroll_lines"("run_id", "trainer_profile_id");

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_trainer_profile_id_fkey" FOREIGN KEY ("trainer_profile_id") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

