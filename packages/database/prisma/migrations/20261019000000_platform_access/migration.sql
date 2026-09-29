-- M1: platform access (docs/PAZARLAMA_MODULU.md 2, 5.1, 6.3, 7.1-7.2).
-- Expand only and forward-only: five new tables, three nullable columns on
-- users, one nullable column on invite_tokens, and the seeded
-- "marketing_admin" platform role template plus the default access policy.
-- Nothing existing is altered or dropped.

-- AlterTable
ALTER TABLE "invite_tokens" ADD COLUMN     "platform_role_template_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mfa_enabled_at" TIMESTAMP(3),
ADD COLUMN     "totp_last_used_step" INTEGER,
ADD COLUMN     "totp_secret_encrypted" TEXT;

-- CreateTable
CREATE TABLE "platform_role_templates" (
    "id" UUID NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_role_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_role_template_permissions" (
    "role_template_id" UUID NOT NULL,
    "permission_key" VARCHAR(80) NOT NULL,

    CONSTRAINT "platform_role_template_permissions_pkey" PRIMARY KEY ("role_template_id","permission_key")
);

-- CreateTable
CREATE TABLE "platform_memberships" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_template_id" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'INVITED',
    "invited_by_user_id" UUID,
    "activated_at" TIMESTAMP(3),
    "deactivated_at" TIMESTAMP(3),
    "platform_studio_membership_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_mfa_recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" VARCHAR(128) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_access_settings" (
    "id" VARCHAR(20) NOT NULL DEFAULT 'platform',
    "require_2fa_for_platform_roles" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_access_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_sender_domains" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "domain" VARCHAR(253) NOT NULL,
    "purpose" VARCHAR(20) NOT NULL DEFAULT 'MARKETING',
    "mail_from_domain" VARCHAR(253),
    "dkim_tokens" JSONB NOT NULL DEFAULT '[]',
    "spf_status" VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    "dkim_status" VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    "dmarc_status" VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    "dmarc_policy" VARCHAR(20),
    "last_checked_at" TIMESTAMP(3),
    "last_error" VARCHAR(500),
    "warmup_started_at" TIMESTAMP(3),
    "daily_cap" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_sender_domains_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_role_templates_key_key" ON "platform_role_templates"("key");

-- CreateIndex
CREATE UNIQUE INDEX "platform_memberships_user_id_key" ON "platform_memberships"("user_id");

-- CreateIndex
CREATE INDEX "platform_memberships_status_idx" ON "platform_memberships"("status");

-- CreateIndex
CREATE INDEX "user_mfa_recovery_codes_user_id_idx" ON "user_mfa_recovery_codes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_sender_domains_studio_id_domain_key" ON "email_sender_domains"("studio_id", "domain");

-- AddForeignKey
ALTER TABLE "invite_tokens" ADD CONSTRAINT "invite_tokens_platform_role_template_id_fkey" FOREIGN KEY ("platform_role_template_id") REFERENCES "platform_role_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_role_template_permissions" ADD CONSTRAINT "platform_role_template_permissions_role_template_id_fkey" FOREIGN KEY ("role_template_id") REFERENCES "platform_role_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_memberships" ADD CONSTRAINT "platform_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_memberships" ADD CONSTRAINT "platform_memberships_role_template_id_fkey" FOREIGN KEY ("role_template_id") REFERENCES "platform_role_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_mfa_recovery_codes" ADD CONSTRAINT "user_mfa_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_sender_domains" ADD CONSTRAINT "email_sender_domains_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Seed: the system "Pazarlama yöneticisi" platform role template
-- (DEFAULT_PLATFORM_ROLE_TEMPLATES in @platform/shared) and the access
-- policy row. Idempotent; PlatformAccessService re-ensures both at runtime.
INSERT INTO "platform_role_templates" ("id", "key", "name", "is_system", "updated_at")
VALUES (gen_random_uuid(), 'marketing_admin', 'Pazarlama yöneticisi', true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "platform_role_template_permissions" ("role_template_id", "permission_key")
SELECT t."id", p."key"
FROM "platform_role_templates" t
CROSS JOIN (VALUES
  ('platform.marketing.view'),
  ('platform.marketing.manage'),
  ('platform.marketing.send'),
  ('platform.inbox.reply'),
  ('platform.ads.view'),
  ('platform.ads.manage'),
  ('platform.ads.spend'),
  ('platform.social.publish'),
  ('platform.integrations.manage'),
  ('platform.ai.use'),
  ('platform.brand.manage'),
  ('platform.referrals.view')
) AS p("key")
WHERE t."key" = 'marketing_admin'
ON CONFLICT DO NOTHING;

INSERT INTO "platform_access_settings" ("id", "require_2fa_for_platform_roles", "updated_at")
VALUES ('platform', true, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
