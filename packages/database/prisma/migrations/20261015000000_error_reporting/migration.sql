-- H1: platform-wide error capture and reporting (docs/HATA_RAPORLAMA.md).
-- Additive and forward-only: three new tables and the errors.view
-- permission for existing owner roles. Nothing existing is changed.

-- CreateTable
CREATE TABLE "error_groups" (
    "id" UUID NOT NULL,
    "fingerprint_hash" VARCHAR(64) NOT NULL,
    "fingerprint" VARCHAR(1000) NOT NULL,
    "source" VARCHAR(10) NOT NULL,
    "type" VARCHAR(120) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "top_frame" VARCHAR(300),
    "status" VARCHAR(10) NOT NULL DEFAULT 'OPEN',
    "count" INTEGER NOT NULL DEFAULT 0,
    "affected_studio_count" INTEGER NOT NULL DEFAULT 0,
    "affected_user_count" INTEGER NOT NULL DEFAULT 0,
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "last_release" VARCHAR(64),
    "resolved_in_release" VARCHAR(64),
    "resolved_at" TIMESTAMP(3),
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "last_code" VARCHAR(8),
    "note" TEXT,
    "last_alert_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "error_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_events" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "code" VARCHAR(8) NOT NULL,
    "source" VARCHAR(10) NOT NULL,
    "severity" VARCHAR(10) NOT NULL,
    "release" VARCHAR(64) NOT NULL,
    "environment" VARCHAR(20) NOT NULL,
    "route" VARCHAR(300),
    "request_id" VARCHAR(64),
    "studio_id" UUID,
    "user_id_hash" VARCHAR(64),
    "type" VARCHAR(120) NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "breadcrumbs" JSONB,
    "status_code" INTEGER,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "error_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_group_studios" (
    "group_id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "last_code" VARCHAR(8),

    CONSTRAINT "error_group_studios_pkey" PRIMARY KEY ("group_id","studio_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "error_groups_fingerprint_hash_key" ON "error_groups"("fingerprint_hash");

-- CreateIndex
CREATE INDEX "error_groups_last_seen_at_idx" ON "error_groups"("last_seen_at");

-- CreateIndex
CREATE INDEX "error_groups_status_last_seen_at_idx" ON "error_groups"("status", "last_seen_at");

-- CreateIndex
CREATE INDEX "error_events_group_id_occurred_at_idx" ON "error_events"("group_id", "occurred_at");

-- CreateIndex
CREATE INDEX "error_events_code_idx" ON "error_events"("code");

-- CreateIndex
CREATE INDEX "error_events_occurred_at_idx" ON "error_events"("occurred_at");

-- CreateIndex
CREATE INDEX "error_group_studios_studio_id_last_seen_at_idx" ON "error_group_studios"("studio_id", "last_seen_at");

-- AddForeignKey
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "error_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "error_group_studios" ADD CONSTRAINT "error_group_studios_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "error_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "error_group_studios" ADD CONSTRAINT "error_group_studios_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The owner role of every existing studio gets errors.view (new studios
-- receive it because owners hold every permission). Idempotent.
INSERT INTO "role_template_permissions" ("role_template_id", "permission_key")
SELECT rt."id", 'errors.view'
FROM "role_templates" rt
WHERE rt."key" = 'owner' OR rt."is_owner" = true
ON CONFLICT DO NOTHING;
