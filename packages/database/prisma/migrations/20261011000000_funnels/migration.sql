-- G5d-1: conversion funnels. Additive and forward-only: one new table, one
-- new index for the per-type funnel scan, and the default permission.

-- CreateTable
CREATE TABLE "funnels" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "steps" JSONB NOT NULL,
    "window_days" INTEGER,
    "created_by_membership_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funnels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "funnels_studio_id_created_at_idx" ON "funnels"("studio_id", "created_at");

-- CreateIndex
CREATE INDEX "conversion_events_studio_id_type_contact_id_occurred_at_idx" ON "conversion_events"("studio_id", "type", "contact_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "funnels" ADD CONSTRAINT "funnels_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The owner role of every existing studio gets funnels.manage (new studios
-- receive it because owners hold every permission). Viewing funnels reuses
-- reports.view. Idempotent.
INSERT INTO "role_template_permissions" ("role_template_id", "permission_key")
SELECT rt."id", 'funnels.manage'
FROM "role_templates" rt
WHERE rt."key" = 'owner' OR rt."is_owner" = true
ON CONFLICT DO NOTHING;
