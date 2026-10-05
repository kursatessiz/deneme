-- Overview card board (docs/WEB_PANEL.md, "Genel bakis kartlari"). Expand
-- only: one new table, no change to existing columns. Forward-only.
-- CreateTable
CREATE TABLE "dashboard_layouts" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "layout" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_layouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dashboard_layouts_studio_id_idx" ON "dashboard_layouts"("studio_id");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_layouts_membership_id_key" ON "dashboard_layouts"("membership_id");

-- AddForeignKey
ALTER TABLE "dashboard_layouts" ADD CONSTRAINT "dashboard_layouts_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_layouts" ADD CONSTRAINT "dashboard_layouts_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The new dashboard.view permission (packages/shared PERMISSIONS): every
-- existing staff role keeps seeing its overview page. Owner roles resolve to
-- every permission anyway; the row keeps the stored set complete. Member
-- roles carry no staff permission and stay as they are. Idempotent.
INSERT INTO "role_template_permissions" ("role_template_id", "permission_key")
SELECT rt."id", 'dashboard.view'
FROM "role_templates" rt
WHERE rt."key" <> 'member'
ON CONFLICT DO NOTHING;
