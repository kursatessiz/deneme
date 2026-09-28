-- G2c: page engine (Site -> Page -> PageLocale -> Block, with immutable
-- PageVersion snapshots for rollback) and the platform's CompanyInfo
-- singleton. Forward-only, additive: no existing table is touched. See
-- docs/SAYFA_MOTORU.md.

-- CreateEnum
CREATE TYPE "SiteKind" AS ENUM ('PLATFORM', 'TENANT');

-- CreateEnum
CREATE TYPE "PageKind" AS ENUM ('HOME', 'LANDING', 'CORPORATE', 'LEGAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PageStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "DomainVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED');

-- CreateTable
CREATE TABLE "sites" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "kind" "SiteKind" NOT NULL,
    "primary_domain" VARCHAR(190),
    "default_locale" VARCHAR(10) NOT NULL DEFAULT 'tr',
    "enabled_locales" TEXT[] DEFAULT ARRAY['tr']::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_domains" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "domain" VARCHAR(190) NOT NULL,
    "status" "DomainVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verification_token" VARCHAR(64) NOT NULL,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pages" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "kind" "PageKind" NOT NULL,
    "sector_key" VARCHAR(60),
    "offer_key" VARCHAR(60),
    "internal_label" VARCHAR(150) NOT NULL,
    "status" "PageStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_locales" (
    "id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "locale" VARCHAR(10) NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "seo_title" VARCHAR(200),
    "seo_description" VARCHAR(400),
    "og_image_url" TEXT,
    "legal_approved" BOOLEAN NOT NULL DEFAULT false,
    "legal_approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "page_locales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocks" (
    "id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "position" INTEGER NOT NULL,
    "ab_variant_key" VARCHAR(40),
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_versions" (
    "id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by_user_id" UUID,

    CONSTRAINT "page_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_info" (
    "id" TEXT NOT NULL,
    "legal_name" VARCHAR(200) NOT NULL,
    "address" TEXT,
    "trade_registry_no" VARCHAR(60),
    "mersis_no" VARCHAR(60),
    "tax_office" VARCHAR(100),
    "tax_number" VARCHAR(30),
    "email" VARCHAR(120),
    "phone" VARCHAR(30),
    "social_links" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_info_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sites_studio_id_key" ON "sites"("studio_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_domains_domain_key" ON "site_domains"("domain");

-- CreateIndex
CREATE INDEX "site_domains_site_id_idx" ON "site_domains"("site_id");

-- CreateIndex
CREATE INDEX "pages_site_id_status_idx" ON "pages"("site_id", "status");

-- CreateIndex
CREATE INDEX "pages_site_id_sector_key_offer_key_idx" ON "pages"("site_id", "sector_key", "offer_key");

-- CreateIndex
CREATE UNIQUE INDEX "page_locales_page_id_locale_key" ON "page_locales"("page_id", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "page_locales_site_id_locale_slug_key" ON "page_locales"("site_id", "locale", "slug");

-- CreateIndex
CREATE INDEX "blocks_page_id_position_idx" ON "blocks"("page_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "page_versions_page_id_version_key" ON "page_versions"("page_id", "version");

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_domains" ADD CONSTRAINT "site_domains_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_locales" ADD CONSTRAINT "page_locales_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_published_by_user_id_fkey" FOREIGN KEY ("published_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
