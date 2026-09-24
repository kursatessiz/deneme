-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "penalty_units" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "waitlist" ADD COLUMN     "failure_reason" VARCHAR(200),
ADD COLUMN     "member_package_id" UUID,
ADD COLUMN     "resolved_at" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_member_package_id_fkey" FOREIGN KEY ("member_package_id") REFERENCES "member_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written: a penalty can never exceed what the booking charged.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_penalty_units_range" CHECK ("penalty_units" >= 0 AND "penalty_units" <= "units_charged");
