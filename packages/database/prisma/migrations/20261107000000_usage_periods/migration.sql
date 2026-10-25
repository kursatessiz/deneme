-- Usage periods (docs/KULLANIM_DONEMLERI.md). Expand-only: new nullable and defaulted columns plus one new table.
ALTER TABLE "studios" ADD COLUMN "usage_periods_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "package_definitions" ADD COLUMN "usage_rule" JSONB;
ALTER TABLE "member_packages" ADD COLUMN "usage_rule" JSONB;

-- CreateTable
CREATE TABLE "package_unit_expiries" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "member_package_id" UUID NOT NULL,
    "tier_unit" VARCHAR(10) NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "units" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_unit_expiries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "package_unit_expiries_member_package_id_tier_unit_period_st_key" ON "package_unit_expiries"("member_package_id", "tier_unit", "period_start");

-- CreateIndex
CREATE INDEX "package_unit_expiries_studio_id_member_package_id_idx" ON "package_unit_expiries"("studio_id", "member_package_id");

-- AddForeignKey
ALTER TABLE "package_unit_expiries" ADD CONSTRAINT "package_unit_expiries_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_unit_expiries" ADD CONSTRAINT "package_unit_expiries_member_package_id_fkey" FOREIGN KEY ("member_package_id") REFERENCES "member_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
