-- G5b: community feed and access tiers (docs/TOPLULUK.md). Additive and
-- forward-only: six new tables, two CHECK constraints and the default
-- permissions. Nothing existing is altered.

-- CreateTable
CREATE TABLE "access_tiers" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_tier_rules" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "tier_id" UUID NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "package_definition_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_tier_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_posts" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
    "title" VARCHAR(160) NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "video_content_id" UUID,
    "attachment_url" TEXT,
    "attachment_name" VARCHAR(200),
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "comments_enabled" BOOLEAN NOT NULL DEFAULT true,
    "author_membership_id" UUID,
    "share_token" VARCHAR(64),
    "published_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_post_tiers" (
    "post_id" UUID NOT NULL,
    "tier_id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,

    CONSTRAINT "community_post_tiers_pkey" PRIMARY KEY ("post_id","tier_id")
);

-- CreateTable
CREATE TABLE "community_comments" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "author_membership_id" UUID,
    "body" VARCHAR(1000) NOT NULL,
    "hidden_at" TIMESTAMP(3),
    "hidden_by_membership_id" UUID,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_reactions" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_tiers_studio_id_name_idx" ON "access_tiers"("studio_id", "name");

-- CreateIndex
CREATE INDEX "access_tier_rules_tier_id_idx" ON "access_tier_rules"("tier_id");

-- CreateIndex
CREATE INDEX "access_tier_rules_studio_id_package_definition_id_idx" ON "access_tier_rules"("studio_id", "package_definition_id");

-- CreateIndex
CREATE UNIQUE INDEX "community_posts_share_token_key" ON "community_posts"("share_token");

-- CreateIndex
CREATE INDEX "community_posts_studio_id_status_pinned_published_at_idx" ON "community_posts"("studio_id", "status", "pinned", "published_at");

-- CreateIndex
CREATE INDEX "community_post_tiers_tier_id_idx" ON "community_post_tiers"("tier_id");

-- CreateIndex
CREATE INDEX "community_comments_post_id_created_at_idx" ON "community_comments"("post_id", "created_at");

-- CreateIndex
CREATE INDEX "community_comments_studio_id_created_at_idx" ON "community_comments"("studio_id", "created_at");

-- CreateIndex
CREATE INDEX "community_reactions_studio_id_idx" ON "community_reactions"("studio_id");

-- CreateIndex
CREATE UNIQUE INDEX "community_reactions_post_id_membership_id_key" ON "community_reactions"("post_id", "membership_id");

-- AddForeignKey
ALTER TABLE "access_tiers" ADD CONSTRAINT "access_tiers_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_tier_rules" ADD CONSTRAINT "access_tier_rules_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "access_tiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_tier_rules" ADD CONSTRAINT "access_tier_rules_package_definition_id_fkey" FOREIGN KEY ("package_definition_id") REFERENCES "package_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_video_content_id_fkey" FOREIGN KEY ("video_content_id") REFERENCES "video_contents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_author_membership_id_fkey" FOREIGN KEY ("author_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post_tiers" ADD CONSTRAINT "community_post_tiers_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post_tiers" ADD CONSTRAINT "community_post_tiers_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "access_tiers"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_author_membership_id_fkey" FOREIGN KEY ("author_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_reactions" ADD CONSTRAINT "community_reactions_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_reactions" ADD CONSTRAINT "community_reactions_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_reactions" ADD CONSTRAINT "community_reactions_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Integrity checks the Prisma schema cannot express.
-- ---------------------------------------------------------------------------

-- A package rule names its package definition; the other kinds never do.
ALTER TABLE "access_tier_rules" ADD CONSTRAINT "access_tier_rules_kind_check"
  CHECK (
    ("kind" = 'PACKAGE_DEFINITION' AND "package_definition_id" IS NOT NULL)
    OR ("kind" IN ('ACTIVE_MEMBER', 'ACTIVE_PACKAGE') AND "package_definition_id" IS NULL)
  );

ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_status_check"
  CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'ARCHIVED'));

-- ---------------------------------------------------------------------------
-- Permissions: owners resolve every key in code already; the rows keep the
-- stored lists complete. Reception gets community.view and
-- community.moderate, trainers community.view by default; writing posts and
-- tiers (community.manage) stays with the owner unless granted. Idempotent.
-- ---------------------------------------------------------------------------

INSERT INTO "role_template_permissions" ("role_template_id", "permission_key")
SELECT rt."id", p."key"
FROM "role_templates" rt
CROSS JOIN (VALUES ('community.view'), ('community.manage'), ('community.moderate')) AS p("key")
WHERE rt."key" = 'owner' OR rt."is_owner" = true
ON CONFLICT DO NOTHING;

INSERT INTO "role_template_permissions" ("role_template_id", "permission_key")
SELECT rt."id", p."key"
FROM "role_templates" rt
CROSS JOIN (VALUES ('community.view'), ('community.moderate')) AS p("key")
WHERE rt."key" = 'reception' AND rt."is_owner" = false
ON CONFLICT DO NOTHING;

INSERT INTO "role_template_permissions" ("role_template_id", "permission_key")
SELECT rt."id", 'community.view'
FROM "role_templates" rt
WHERE rt."key" = 'trainer' AND rt."is_owner" = false
ON CONFLICT DO NOTHING;
