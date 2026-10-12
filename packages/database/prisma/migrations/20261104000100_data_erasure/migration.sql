-- KVKK/GDPR personal data erasure (docs/KVKK_SILME.md). Expand only: one new
-- nullable column and one new table, no change to existing data. Forward-only.

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN "erased_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "data_erasure_requests" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "source" VARCHAR(10) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    "requested_by_user_id" UUID,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" TIMESTAMP(3) NOT NULL,
    "decided_at" TIMESTAMP(3),
    "decided_by_user_id" UUID,
    "decision_note" VARCHAR(500),
    "auto_processed" BOOLEAN NOT NULL DEFAULT false,
    "executed_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(300),
    "summary" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_erasure_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "data_erasure_requests_studio_id_status_requested_at_idx" ON "data_erasure_requests"("studio_id", "status", "requested_at");

-- CreateIndex
CREATE INDEX "data_erasure_requests_status_due_at_idx" ON "data_erasure_requests"("status", "due_at");

-- CreateIndex
CREATE INDEX "data_erasure_requests_membership_id_idx" ON "data_erasure_requests"("membership_id");

-- One open (PENDING or APPROVED) request per membership. Prisma cannot
-- express a partial unique index, so it lives in SQL only.
CREATE UNIQUE INDEX "data_erasure_requests_one_open_per_membership" ON "data_erasure_requests"("membership_id") WHERE "status" IN ('PENDING', 'APPROVED');

-- AddForeignKey
ALTER TABLE "data_erasure_requests" ADD CONSTRAINT "data_erasure_requests_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_erasure_requests" ADD CONSTRAINT "data_erasure_requests_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The new members.erase permission (packages/shared PERMISSIONS): owner roles
-- resolve every key in code already; the row keeps the stored set complete.
-- Other roles do not get it by default. Idempotent.
INSERT INTO "role_template_permissions" ("role_template_id", "permission_key")
SELECT rt."id", 'members.erase'
FROM "role_templates" rt
WHERE rt."key" = 'owner' OR rt."is_owner" = true
ON CONFLICT DO NOTHING;
