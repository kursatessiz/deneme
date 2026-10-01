-- S2b: blog articles on the page engine (docs/SAYFA_MOTORU.md "Yazilar / blog").
-- Expand-only: one new enum and four new tables, nothing existing is altered.

-- CreateEnum
CREATE TYPE "ArticleStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "articles" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "status" "ArticleStatus" NOT NULL DEFAULT 'DRAFT',
    "author_name" VARCHAR(120) NOT NULL,
    "author_user_id" UUID,
    "cover_image_url" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_locales" (
    "id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "locale" VARCHAR(10) NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "excerpt" VARCHAR(500),
    "body" TEXT NOT NULL,
    "seo_title" VARCHAR(200),
    "seo_description" VARCHAR(400),
    "og_image_url" TEXT,
    "reading_minutes" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "article_locales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_tags" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "labels" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "article_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_tag_links" (
    "article_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "article_tag_links_pkey" PRIMARY KEY ("article_id","tag_id")
);

-- CreateIndex
CREATE INDEX "articles_site_id_status_published_at_idx" ON "articles"("site_id", "status", "published_at");

-- CreateIndex
CREATE INDEX "articles_studio_id_idx" ON "articles"("studio_id");

-- CreateIndex
CREATE UNIQUE INDEX "article_locales_article_id_locale_key" ON "article_locales"("article_id", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "article_locales_site_id_locale_slug_key" ON "article_locales"("site_id", "locale", "slug");

-- CreateIndex
CREATE INDEX "article_tags_studio_id_idx" ON "article_tags"("studio_id");

-- CreateIndex
CREATE UNIQUE INDEX "article_tags_site_id_slug_key" ON "article_tags"("site_id", "slug");

-- CreateIndex
CREATE INDEX "article_tag_links_tag_id_idx" ON "article_tag_links"("tag_id");

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_locales" ADD CONSTRAINT "article_locales_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_tags" ADD CONSTRAINT "article_tags_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_tags" ADD CONSTRAINT "article_tags_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_tag_links" ADD CONSTRAINT "article_tag_links_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_tag_links" ADD CONSTRAINT "article_tag_links_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "article_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

