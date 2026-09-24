-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "email" VARCHAR(120),
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "timezone" VARCHAR(60),
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "member_profiles" ADD COLUMN     "home_branch_id" UUID;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "branch_id" UUID;

-- CreateTable
CREATE TABLE "membership_branches" (
    "membership_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_branches_pkey" PRIMARY KEY ("membership_id","branch_id")
);

-- CreateIndex
CREATE INDEX "membership_branches_studio_id_idx" ON "membership_branches"("studio_id");

-- CreateIndex
CREATE UNIQUE INDEX "branches_studio_id_name_key" ON "branches"("studio_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "branches_id_studio_id_key" ON "branches"("id", "studio_id");

-- CreateIndex
CREATE INDEX "payments_branch_id_paid_at_idx" ON "payments"("branch_id", "paid_at");

-- AddForeignKey
ALTER TABLE "membership_branches" ADD CONSTRAINT "membership_branches_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_branches" ADD CONSTRAINT "membership_branches_branch_id_studio_id_fkey" FOREIGN KEY ("branch_id", "studio_id") REFERENCES "branches"("id", "studio_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_home_branch_id_fkey" FOREIGN KEY ("home_branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

