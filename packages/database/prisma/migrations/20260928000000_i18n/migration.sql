-- AlterTable
ALTER TABLE "studios" ADD COLUMN     "default_locale" VARCHAR(10) NOT NULL DEFAULT 'tr';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "locale" VARCHAR(10);

-- CreateTable
CREATE TABLE "languages" (
    "code" VARCHAR(10) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "native_name" VARCHAR(60) NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "languages_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "translation_overrides" (
    "id" UUID NOT NULL,
    "locale" VARCHAR(10) NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "value" TEXT NOT NULL,
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "translation_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "translation_overrides_locale_key_key" ON "translation_overrides"("locale", "key");

-- AddForeignKey
ALTER TABLE "translation_overrides" ADD CONSTRAINT "translation_overrides_locale_fkey" FOREIGN KEY ("locale") REFERENCES "languages"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translation_overrides" ADD CONSTRAINT "translation_overrides_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Bundled languages ship enabled so tr/en render without a super-admin
-- step; the API also upserts BUNDLED_LANGUAGES on boot for anything added
-- to the code later, without flipping an existing row's is_enabled.
INSERT INTO "languages" ("code", "name", "native_name", "is_enabled", "created_at", "updated_at")
VALUES
  ('tr', 'Turkish', 'Türkçe', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('en', 'English', 'English', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
