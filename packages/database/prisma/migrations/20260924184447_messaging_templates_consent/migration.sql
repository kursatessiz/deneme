-- CreateEnum
CREATE TYPE "ConsentChannel" AS ENUM ('SMS', 'WHATSAPP', 'EMAIL', 'CALL');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('GRANTED', 'REVOKED');

-- CreateTable
CREATE TABLE "message_templates" (
    "id" UUID NOT NULL,
    "studio_id" UUID,
    "key" VARCHAR(60) NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "locale" VARCHAR(5) NOT NULL DEFAULT 'tr',
    "body" TEXT NOT NULL,
    "whatsapp_template_name" VARCHAR(120),
    "is_transactional" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_consents" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "ConsentChannel" NOT NULL,
    "status" "ConsentStatus" NOT NULL DEFAULT 'GRANTED',
    "source" VARCHAR(60) NOT NULL,
    "granted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "iys_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communication_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_templates_key_idx" ON "message_templates"("key");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_studio_id_key_channel_locale_key" ON "message_templates"("studio_id", "key", "channel", "locale");

-- CreateIndex
CREATE INDEX "communication_consents_studio_id_status_idx" ON "communication_consents"("studio_id", "status");

-- CreateIndex
CREATE INDEX "communication_consents_iys_synced_at_idx" ON "communication_consents"("iys_synced_at");

-- CreateIndex
CREATE UNIQUE INDEX "communication_consents_studio_id_user_id_channel_key" ON "communication_consents"("studio_id", "user_id", "channel");

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_consents" ADD CONSTRAINT "communication_consents_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_consents" ADD CONSTRAINT "communication_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

