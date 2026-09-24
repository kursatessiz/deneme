-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "is_partner_guest" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "memberships_studio_id_is_partner_guest_idx" ON "memberships"("studio_id", "is_partner_guest");

