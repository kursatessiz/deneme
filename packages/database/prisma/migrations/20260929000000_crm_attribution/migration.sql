-- CreateEnum
CREATE TYPE "ContactLifecycleStage" AS ENUM ('LEAD', 'TRIAL', 'MEMBER', 'LAPSED', 'LOST');

-- CreateEnum
CREATE TYPE "PipelineStageKind" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "ContactTaskStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- AlterTable
ALTER TABLE "studios" ADD COLUMN     "is_platform" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "pipeline_stages" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80),
    "kind" "PipelineStageKind" NOT NULL DEFAULT 'OPEN',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "first_name" VARCHAR(60) NOT NULL,
    "last_name" VARCHAR(60) NOT NULL DEFAULT '',
    "phone" VARCHAR(20),
    "email" VARCHAR(120),
    "locale" VARCHAR(10),
    "country_code" VARCHAR(2),
    "timezone" VARCHAR(60),
    "lifecycle_stage" "ContactLifecycleStage" NOT NULL DEFAULT 'LEAD',
    "pipeline_stage_id" UUID,
    "owner_membership_id" UUID,
    "branch_id" UUID,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "membership_id" UUID,
    "first_touchpoint_id" UUID,
    "last_touchpoint_id" UUID,
    "first_source" VARCHAR(250),
    "first_medium" VARCHAR(250),
    "first_campaign_name" VARCHAR(250),
    "first_campaign_id" VARCHAR(250),
    "first_adset_id" VARCHAR(250),
    "first_ad_id" VARCHAR(250),
    "last_source" VARCHAR(250),
    "last_medium" VARCHAR(250),
    "last_campaign_name" VARCHAR(250),
    "last_campaign_id" VARCHAR(250),
    "last_adset_id" VARCHAR(250),
    "last_ad_id" VARCHAR(250),
    "source_channel" VARCHAR(30),
    "source_detail" VARCHAR(200),
    "interest_service_type_id" UUID,
    "lost_reason" TEXT,
    "next_follow_up_at" TIMESTAMP(3),
    "referral_code" VARCHAR(24),
    "notes" TEXT,
    "is_test" BOOLEAN NOT NULL DEFAULT false,
    "merged_into_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_activities" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "body" TEXT NOT NULL,
    "actor_membership_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_field_definitions" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "label" JSONB NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_tasks" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "notes" TEXT,
    "due_at" TIMESTAMP(3),
    "assignee_membership_id" UUID,
    "status" "ContactTaskStatus" NOT NULL DEFAULT 'OPEN',
    "completed_at" TIMESTAMP(3),
    "created_by_membership_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visitors" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contact_id" UUID,

    CONSTRAINT "visitors_pkey" PRIMARY KEY ("studio_id","id")
);

-- CreateTable
CREATE TABLE "touchpoints" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "visitor_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "landing_host" VARCHAR(255),
    "landing_path" VARCHAR(2000) NOT NULL,
    "referrer_host" VARCHAR(255),
    "utm_source" VARCHAR(250),
    "utm_medium" VARCHAR(250),
    "utm_campaign" VARCHAR(250),
    "utm_id" VARCHAR(250),
    "utm_term" VARCHAR(250),
    "utm_content" VARCHAR(250),
    "ad_platform" VARCHAR(20),
    "pw_cid" VARCHAR(250),
    "pw_asid" VARCHAR(250),
    "pw_adid" VARCHAR(250),
    "pw_plc" VARCHAR(250),
    "fbclid" VARCHAR(250),
    "gclid" VARCHAR(250),
    "gbraid" VARCHAR(250),
    "wbraid" VARCHAR(250),
    "ttclid" VARCHAR(250),
    "li_fat_id" VARCHAR(250),
    "msclkid" VARCHAR(250),
    "fbp" VARCHAR(250),
    "fbc" VARCHAR(250),
    "locale" VARCHAR(10),
    "country_code" VARCHAR(2),
    "device_type" VARCHAR(10),
    "page_variant" VARCHAR(40),
    "is_paid_untagged" BOOLEAN NOT NULL DEFAULT false,
    "contact_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touchpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversion_events" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "event_id" VARCHAR(100) NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "contact_id" UUID NOT NULL,
    "value_amount" DECIMAL(14,4),
    "currency" VARCHAR(3),
    "source_kind" VARCHAR(40) NOT NULL,
    "source_id" VARCHAR(100) NOT NULL,
    "is_test" BOOLEAN NOT NULL DEFAULT false,
    "attributed_touchpoint_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversion_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversion_deliveries" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "conversion_event_id" UUID NOT NULL,
    "target" VARCHAR(20) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "last_error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversion_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pipeline_stages_studio_id_sort_order_idx" ON "pipeline_stages"("studio_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_studio_id_key_key" ON "pipeline_stages"("studio_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_membership_id_key" ON "contacts"("membership_id");

-- CreateIndex
CREATE INDEX "contacts_studio_id_lifecycle_stage_idx" ON "contacts"("studio_id", "lifecycle_stage");

-- CreateIndex
CREATE INDEX "contacts_studio_id_pipeline_stage_id_idx" ON "contacts"("studio_id", "pipeline_stage_id");

-- CreateIndex
CREATE INDEX "contacts_studio_id_owner_membership_id_idx" ON "contacts"("studio_id", "owner_membership_id");

-- CreateIndex
CREATE INDEX "contacts_studio_id_phone_idx" ON "contacts"("studio_id", "phone");

-- CreateIndex
CREATE INDEX "contacts_studio_id_next_follow_up_at_idx" ON "contacts"("studio_id", "next_follow_up_at");

-- CreateIndex
CREATE INDEX "contacts_studio_id_first_source_idx" ON "contacts"("studio_id", "first_source");

-- CreateIndex
CREATE INDEX "contacts_studio_id_last_source_idx" ON "contacts"("studio_id", "last_source");

-- CreateIndex
CREATE INDEX "contacts_tags_idx" ON "contacts" USING GIN ("tags");

-- CreateIndex
CREATE INDEX "contact_activities_contact_id_created_at_idx" ON "contact_activities"("contact_id", "created_at");

-- CreateIndex
CREATE INDEX "contact_activities_studio_id_created_at_idx" ON "contact_activities"("studio_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "contact_field_definitions_studio_id_key_key" ON "contact_field_definitions"("studio_id", "key");

-- CreateIndex
CREATE INDEX "contact_tasks_studio_id_status_due_at_idx" ON "contact_tasks"("studio_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "contact_tasks_contact_id_idx" ON "contact_tasks"("contact_id");

-- CreateIndex
CREATE INDEX "contact_tasks_assignee_membership_id_status_idx" ON "contact_tasks"("assignee_membership_id", "status");

-- CreateIndex
CREATE INDEX "visitors_studio_id_contact_id_idx" ON "visitors"("studio_id", "contact_id");

-- CreateIndex
CREATE INDEX "touchpoints_studio_id_visitor_id_occurred_at_idx" ON "touchpoints"("studio_id", "visitor_id", "occurred_at");

-- CreateIndex
CREATE INDEX "touchpoints_studio_id_contact_id_occurred_at_idx" ON "touchpoints"("studio_id", "contact_id", "occurred_at");

-- CreateIndex
CREATE INDEX "touchpoints_studio_id_occurred_at_idx" ON "touchpoints"("studio_id", "occurred_at");

-- CreateIndex
CREATE INDEX "touchpoints_studio_id_session_id_idx" ON "touchpoints"("studio_id", "session_id");

-- CreateIndex
CREATE INDEX "conversion_events_studio_id_type_occurred_at_idx" ON "conversion_events"("studio_id", "type", "occurred_at");

-- CreateIndex
CREATE INDEX "conversion_events_contact_id_idx" ON "conversion_events"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversion_events_studio_id_event_id_key" ON "conversion_events"("studio_id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversion_events_studio_id_source_kind_source_id_key" ON "conversion_events"("studio_id", "source_kind", "source_id");

-- CreateIndex
CREATE INDEX "conversion_deliveries_status_next_attempt_at_idx" ON "conversion_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "conversion_deliveries_studio_id_idx" ON "conversion_deliveries"("studio_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversion_deliveries_conversion_event_id_target_key" ON "conversion_deliveries"("conversion_event_id", "target");

-- AddForeignKey
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_pipeline_stage_id_fkey" FOREIGN KEY ("pipeline_stage_id") REFERENCES "pipeline_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_owner_membership_id_fkey" FOREIGN KEY ("owner_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_interest_service_type_id_fkey" FOREIGN KEY ("interest_service_type_id") REFERENCES "service_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_first_touchpoint_id_fkey" FOREIGN KEY ("first_touchpoint_id") REFERENCES "touchpoints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_last_touchpoint_id_fkey" FOREIGN KEY ("last_touchpoint_id") REFERENCES "touchpoints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_activities" ADD CONSTRAINT "contact_activities_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_activities" ADD CONSTRAINT "contact_activities_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_activities" ADD CONSTRAINT "contact_activities_actor_membership_id_fkey" FOREIGN KEY ("actor_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_field_definitions" ADD CONSTRAINT "contact_field_definitions_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tasks" ADD CONSTRAINT "contact_tasks_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tasks" ADD CONSTRAINT "contact_tasks_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tasks" ADD CONSTRAINT "contact_tasks_assignee_membership_id_fkey" FOREIGN KEY ("assignee_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tasks" ADD CONSTRAINT "contact_tasks_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touchpoints" ADD CONSTRAINT "touchpoints_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touchpoints" ADD CONSTRAINT "touchpoints_studio_id_visitor_id_fkey" FOREIGN KEY ("studio_id", "visitor_id") REFERENCES "visitors"("studio_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touchpoints" ADD CONSTRAINT "touchpoints_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_attributed_touchpoint_id_fkey" FOREIGN KEY ("attributed_touchpoint_id") REFERENCES "touchpoints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_deliveries" ADD CONSTRAINT "conversion_deliveries_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_deliveries" ADD CONSTRAINT "conversion_deliveries_conversion_event_id_fkey" FOREIGN KEY ("conversion_event_id") REFERENCES "conversion_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Indexes Prisma cannot express (kept out of schema.prisma on purpose; the
-- drift check ignores partial and expression indexes).
-- ---------------------------------------------------------------------------

-- One unmerged contact per phone and per (case-insensitive) email per studio.
CREATE UNIQUE INDEX "contacts_studio_phone_active_key"
  ON "contacts" ("studio_id", "phone")
  WHERE "merged_into_id" IS NULL AND "phone" IS NOT NULL;

CREATE UNIQUE INDEX "contacts_studio_email_active_key"
  ON "contacts" ("studio_id", lower("email"))
  WHERE "merged_into_id" IS NULL AND "email" IS NOT NULL;

-- At most one platform tenant.
CREATE UNIQUE INDEX "studios_single_platform_key"
  ON "studios" ("is_platform")
  WHERE "is_platform";

-- ---------------------------------------------------------------------------
-- Permissions: role templates that could manage leads get the matching CRM
-- keys. leads.* stay valid for the deprecated /leads wrappers.
-- ---------------------------------------------------------------------------

INSERT INTO "role_template_permissions" ("role_template_id", "permission_key")
SELECT "role_template_id", 'crm.view' FROM "role_template_permissions" WHERE "permission_key" = 'leads.view'
ON CONFLICT DO NOTHING;

INSERT INTO "role_template_permissions" ("role_template_id", "permission_key")
SELECT "role_template_id", 'crm.manage' FROM "role_template_permissions" WHERE "permission_key" = 'leads.manage'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Platform tenant: the platform's own marketing CRM (slug `platform`).
-- Skipped when a tenant already uses the slug; see docs/CRM_VE_ATIF.md.
-- ---------------------------------------------------------------------------

INSERT INTO "studios" ("id", "name", "slug", "is_platform", "created_at", "updated_at")
SELECT gen_random_uuid(), 'Platform', 'platform', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "studios" WHERE "slug" = 'platform' OR "is_platform");

-- ---------------------------------------------------------------------------
-- Data migration. Kept as an idempotent function so the seed (and the e2e
-- suite) run exactly the same SQL on fresh data. Dropped together with the
-- leads tables in the contract release.
--   1. default pipeline stages for every studio
--   2. leads -> contacts (one per studio + phone; the open lead wins, the
--      others fold in as activities), lead_activities -> contact_activities
--   3. memberships with a member profile -> contacts (linked by phone when a
--      lead contact already exists), lifecycle MEMBER, or LAPSED when every
--      package they ever had is no longer active
-- Partner-guest memberships are left out until they onboard for real.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION crm_backfill_contacts() RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  -- 1. Default pipeline stages.
  INSERT INTO "pipeline_stages" ("id", "studio_id", "key", "kind", "sort_order", "is_system", "created_at", "updated_at")
  SELECT gen_random_uuid(), s."id", d.key, d.kind::"PipelineStageKind", d.sort_order, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "studios" s
  CROSS JOIN (VALUES
    ('NEW', 'OPEN', 0),
    ('CONTACTED', 'OPEN', 1),
    ('TRIAL_BOOKED', 'OPEN', 2),
    ('TRIAL_DONE', 'OPEN', 3),
    ('WON', 'WON', 4),
    ('LOST', 'LOST', 5)
  ) AS d(key, kind, sort_order)
  ON CONFLICT ("studio_id", "key") DO NOTHING;

  -- 2a. Leads -> contacts. The contact keeps the primary lead's id so old
  -- links (web drawer, mobile deep links) keep resolving.
  WITH ranked AS (
    SELECT l.*,
      row_number() OVER (
        PARTITION BY l."studio_id", l."phone"
        ORDER BY (l."open_phone" IS NOT NULL) DESC, l."updated_at" DESC, l."id"
      ) AS rn
    FROM "leads" l
  ),
  primary_leads AS (
    SELECT r.* FROM ranked r
    WHERE r.rn = 1
      AND NOT EXISTS (SELECT 1 FROM "contacts" c WHERE c."id" = r."id")
      AND NOT EXISTS (
        SELECT 1 FROM "contacts" c
        WHERE c."studio_id" = r."studio_id" AND c."phone" = r."phone" AND c."merged_into_id" IS NULL
      )
  ),
  prepared AS (
    SELECT p.*,
      btrim(regexp_replace(p."full_name", '\s+', ' ', 'g')) AS clean_name,
      CASE
        WHEN p."email" IS NULL OR btrim(p."email") = '' THEN NULL
        WHEN EXISTS (
          SELECT 1 FROM "contacts" c
          WHERE c."studio_id" = p."studio_id" AND lower(c."email") = lower(p."email") AND c."merged_into_id" IS NULL
        ) THEN NULL
        WHEN row_number() OVER (PARTITION BY p."studio_id", lower(p."email") ORDER BY p."created_at", p."id") > 1 THEN NULL
        ELSE p."email"
      END AS contact_email,
      CASE
        WHEN p."converted_membership_id" IS NULL THEN NULL
        WHEN EXISTS (SELECT 1 FROM "contacts" c WHERE c."membership_id" = p."converted_membership_id") THEN NULL
        WHEN row_number() OVER (PARTITION BY p."converted_membership_id" ORDER BY p."updated_at" DESC, p."id") > 1 THEN NULL
        ELSE p."converted_membership_id"
      END AS contact_membership_id
    FROM primary_leads p
  )
  INSERT INTO "contacts" (
    "id", "studio_id", "first_name", "last_name", "phone", "email", "lifecycle_stage", "pipeline_stage_id",
    "owner_membership_id", "branch_id", "membership_id",
    "first_source", "first_medium", "first_campaign_name", "last_source", "last_medium", "last_campaign_name",
    "source_channel", "source_detail", "interest_service_type_id", "lost_reason", "next_follow_up_at",
    "referral_code", "notes", "created_at", "updated_at"
  )
  SELECT
    p."id",
    p."studio_id",
    left(CASE WHEN position(' ' IN p.clean_name) > 0 THEN regexp_replace(p.clean_name, ' \S+$', '') ELSE p.clean_name END, 60),
    left(CASE WHEN position(' ' IN p.clean_name) > 0 THEN substring(p.clean_name FROM '\S+$') ELSE '' END, 60),
    p."phone",
    p.contact_email,
    (CASE p."stage"::text
      WHEN 'WON' THEN 'MEMBER'
      WHEN 'LOST' THEN 'LOST'
      WHEN 'TRIAL_BOOKED' THEN 'TRIAL'
      WHEN 'TRIAL_DONE' THEN 'TRIAL'
      ELSE 'LEAD'
    END)::"ContactLifecycleStage",
    ps."id",
    p."owner_membership_id",
    p."branch_id",
    p.contact_membership_id,
    p."utm_source", p."utm_medium", p."utm_campaign",
    p."utm_source", p."utm_medium", p."utm_campaign",
    p."source"::text,
    p."source_detail",
    p."interest_service_type_id",
    p."lost_reason",
    p."next_follow_up_at",
    p."referral_code",
    p."notes",
    p."created_at",
    p."updated_at"
  FROM prepared p
  LEFT JOIN "pipeline_stages" ps ON ps."studio_id" = p."studio_id" AND ps."key" = p."stage"::text;

  -- 2b. Every other lead with the same phone becomes a note on that contact
  -- (id = the lead id, so a re-run inserts nothing twice).
  INSERT INTO "contact_activities" ("id", "studio_id", "contact_id", "type", "body", "metadata", "created_at")
  SELECT l."id", l."studio_id", c."id", 'MERGE',
    'Legacy lead merged: ' || l."stage"::text || ' / ' || l."source"::text,
    jsonb_build_object('legacyLeadId', l."id", 'stage', l."stage"::text, 'source', l."source"::text, 'fullName', l."full_name"),
    l."created_at"
  FROM "leads" l
  JOIN "contacts" c ON c."studio_id" = l."studio_id" AND c."phone" = l."phone" AND c."merged_into_id" IS NULL
  WHERE c."id" <> l."id"
    AND NOT EXISTS (SELECT 1 FROM "contacts" c2 WHERE c2."id" = l."id")
  ON CONFLICT ("id") DO NOTHING;

  -- 2c. Lead activities, re-pointed to the contact holding the lead's phone.
  INSERT INTO "contact_activities" ("id", "studio_id", "contact_id", "type", "body", "actor_membership_id", "created_at")
  SELECT a."id", a."studio_id", c."id", a."type"::text, a."body", a."actor_membership_id", a."created_at"
  FROM "lead_activities" a
  JOIN "leads" l ON l."id" = a."lead_id"
  JOIN "contacts" c ON c."studio_id" = l."studio_id" AND c."phone" = l."phone" AND c."merged_into_id" IS NULL
  ON CONFLICT ("id") DO NOTHING;

  -- 3a. Members whose phone already has a contact: link and promote.
  WITH m AS (
    SELECT ms."id" AS membership_id, ms."studio_id", u."phone",
      EXISTS (
        SELECT 1 FROM "member_packages" mp
        WHERE mp."member_id" = mpf."id" AND mp."status" = 'ACTIVE' AND mp."end_date" > CURRENT_TIMESTAMP
      ) AS has_active,
      EXISTS (SELECT 1 FROM "member_packages" mp WHERE mp."member_id" = mpf."id") AS has_any
    FROM "memberships" ms
    JOIN "member_profiles" mpf ON mpf."membership_id" = ms."id"
    JOIN "users" u ON u."id" = ms."user_id"
    WHERE NOT ms."is_partner_guest"
      AND NOT EXISTS (SELECT 1 FROM "contacts" c WHERE c."membership_id" = ms."id")
  )
  UPDATE "contacts" c
  SET "membership_id" = m.membership_id,
      "lifecycle_stage" = (CASE WHEN m.has_active OR NOT m.has_any THEN 'MEMBER' ELSE 'LAPSED' END)::"ContactLifecycleStage",
      "updated_at" = CURRENT_TIMESTAMP
  FROM m
  WHERE c."studio_id" = m."studio_id" AND c."phone" = m."phone"
    AND c."merged_into_id" IS NULL AND c."membership_id" IS NULL;

  -- 3b. Remaining members get a new contact.
  WITH m AS (
    SELECT ms."id" AS membership_id, ms."studio_id", ms."created_at", ms."joined_at",
      u."first_name", u."last_name", u."phone", u."email", u."locale",
      EXISTS (
        SELECT 1 FROM "member_packages" mp
        WHERE mp."member_id" = mpf."id" AND mp."status" = 'ACTIVE' AND mp."end_date" > CURRENT_TIMESTAMP
      ) AS has_active,
      EXISTS (SELECT 1 FROM "member_packages" mp WHERE mp."member_id" = mpf."id") AS has_any
    FROM "memberships" ms
    JOIN "member_profiles" mpf ON mpf."membership_id" = ms."id"
    JOIN "users" u ON u."id" = ms."user_id"
    WHERE NOT ms."is_partner_guest"
      AND NOT EXISTS (SELECT 1 FROM "contacts" c WHERE c."membership_id" = ms."id")
      AND NOT EXISTS (
        SELECT 1 FROM "contacts" c
        WHERE c."studio_id" = ms."studio_id" AND c."phone" = u."phone" AND c."merged_into_id" IS NULL
      )
  ),
  prepared AS (
    SELECT m.*,
      CASE
        WHEN m."email" IS NULL OR btrim(m."email") = '' THEN NULL
        WHEN EXISTS (
          SELECT 1 FROM "contacts" c
          WHERE c."studio_id" = m."studio_id" AND lower(c."email") = lower(m."email") AND c."merged_into_id" IS NULL
        ) THEN NULL
        WHEN row_number() OVER (PARTITION BY m."studio_id", lower(m."email") ORDER BY m."created_at", m.membership_id) > 1 THEN NULL
        ELSE m."email"
      END AS contact_email
    FROM m
  )
  INSERT INTO "contacts" (
    "id", "studio_id", "first_name", "last_name", "phone", "email", "locale", "lifecycle_stage",
    "membership_id", "created_at", "updated_at"
  )
  SELECT gen_random_uuid(), p."studio_id", left(p."first_name", 60), left(p."last_name", 60), p."phone",
    p.contact_email, p."locale",
    (CASE WHEN p.has_active OR NOT p.has_any THEN 'MEMBER' ELSE 'LAPSED' END)::"ContactLifecycleStage",
    p.membership_id, COALESCE(p."joined_at", p."created_at"), CURRENT_TIMESTAMP
  FROM prepared p;
END;
$fn$;

SELECT crm_backfill_contacts();
