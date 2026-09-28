-- G1c messaging engine (docs/MESAJLASMA.md): email/in-app channels, delivery
-- tracking on notification_logs, suppression list, click links, inbox
-- conversations and saved replies, template locale variants for email.
-- Forward-only and additive: every existing column is kept.

-- CreateEnum
CREATE TYPE "MessagePurpose" AS ENUM ('TRANSACTIONAL', 'COMMERCIAL');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "MessageTrackingEventType" AS ENUM ('DELIVERY', 'OPEN', 'CLICK', 'BOUNCE', 'COMPLAINT', 'UNSUBSCRIBE');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('UNSUBSCRIBED', 'STOP_KEYWORD', 'BOUNCED', 'COMPLAINED');

-- AlterEnum
ALTER TYPE "NotificationChannel" ADD VALUE 'IN_APP';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationStatus" ADD VALUE 'DELIVERED';
ALTER TYPE "NotificationStatus" ADD VALUE 'BOUNCED';
ALTER TYPE "NotificationStatus" ADD VALUE 'COMPLAINED';

-- AlterTable
ALTER TABLE "message_templates" ADD COLUMN     "blocks" JSONB,
ADD COLUMN     "subject" VARCHAR(200),
ADD COLUMN     "whatsapp_status" VARCHAR(20) NOT NULL DEFAULT 'APPROVED';

-- AlterTable
ALTER TABLE "notification_logs" ADD COLUMN     "bounced_at" TIMESTAMP(3),
ADD COLUMN     "campaign_id" UUID,
ADD COLUMN     "clicked_at" TIMESTAMP(3),
ADD COLUMN     "complained_at" TIMESTAMP(3),
ADD COLUMN     "contact_id" UUID,
ADD COLUMN     "delivered_at" TIMESTAMP(3),
ADD COLUMN     "idempotency_key" VARCHAR(200),
ADD COLUMN     "journey_run_id" UUID,
ADD COLUMN     "locale" VARCHAR(10),
ADD COLUMN     "machine_opened_at" TIMESTAMP(3),
ADD COLUMN     "opened_at" TIMESTAMP(3),
ADD COLUMN     "provider" VARCHAR(30),
ADD COLUMN     "purpose" "MessagePurpose" NOT NULL DEFAULT 'TRANSACTIONAL',
ADD COLUMN     "read_at" TIMESTAMP(3),
ADD COLUMN     "recipient_email" VARCHAR(254),
ADD COLUMN     "subject" VARCHAR(200),
ADD COLUMN     "template_id" UUID,
ADD COLUMN     "user_id" UUID,
ALTER COLUMN "recipient_phone" DROP NOT NULL;

-- AlterTable
ALTER TABLE "studios" ADD COLUMN     "messaging_settings" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "message_links" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "notification_log_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_tracking_events" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "notification_log_id" UUID NOT NULL,
    "type" "MessageTrackingEventType" NOT NULL,
    "is_machine" BOOLEAN NOT NULL DEFAULT false,
    "link_id" UUID,
    "detail" VARCHAR(80),
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_tracking_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_suppressions" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "address" VARCHAR(254) NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "contact_id" UUID,
    "notification_log_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "assigned_membership_id" UUID,
    "external_address" VARCHAR(254),
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_inbound_at" TIMESTAMP(3),
    "last_message_preview" VARCHAR(200) NOT NULL DEFAULT '',
    "unread_count" INTEGER NOT NULL DEFAULT 0,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "body" TEXT NOT NULL,
    "provider" VARCHAR(30),
    "provider_message_id" VARCHAR(120),
    "status" VARCHAR(20) NOT NULL DEFAULT 'RECEIVED',
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "author_membership_id" UUID,
    "notification_log_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_replies" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "body" TEXT NOT NULL,
    "created_by_membership_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_links_notification_log_id_idx" ON "message_links"("notification_log_id");

-- CreateIndex
CREATE INDEX "message_tracking_events_notification_log_id_idx" ON "message_tracking_events"("notification_log_id");

-- CreateIndex
CREATE INDEX "message_tracking_events_studio_id_type_occurred_at_idx" ON "message_tracking_events"("studio_id", "type", "occurred_at");

-- CreateIndex
CREATE INDEX "message_suppressions_studio_id_contact_id_idx" ON "message_suppressions"("studio_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_suppressions_studio_id_channel_address_key" ON "message_suppressions"("studio_id", "channel", "address");

-- CreateIndex
CREATE INDEX "conversations_studio_id_status_last_message_at_idx" ON "conversations"("studio_id", "status", "last_message_at");

-- CreateIndex
CREATE INDEX "conversations_studio_id_assigned_membership_id_idx" ON "conversations"("studio_id", "assigned_membership_id");

-- CreateIndex
CREATE INDEX "conversations_studio_id_contact_id_idx" ON "conversations"("studio_id", "contact_id");

-- CreateIndex
CREATE INDEX "conversation_messages_conversation_id_created_at_idx" ON "conversation_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "conversation_messages_provider_message_id_idx" ON "conversation_messages"("provider_message_id");

-- CreateIndex
CREATE INDEX "saved_replies_studio_id_idx" ON "saved_replies"("studio_id");

-- CreateIndex
CREATE INDEX "notification_logs_provider_message_id_idx" ON "notification_logs"("provider_message_id");

-- CreateIndex
CREATE INDEX "notification_logs_studio_id_contact_id_purpose_created_at_idx" ON "notification_logs"("studio_id", "contact_id", "purpose", "created_at");

-- CreateIndex
CREATE INDEX "notification_logs_studio_id_user_id_created_at_idx" ON "notification_logs"("studio_id", "user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_logs_studio_id_idempotency_key_key" ON "notification_logs"("studio_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_links" ADD CONSTRAINT "message_links_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_links" ADD CONSTRAINT "message_links_notification_log_id_fkey" FOREIGN KEY ("notification_log_id") REFERENCES "notification_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_tracking_events" ADD CONSTRAINT "message_tracking_events_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_tracking_events" ADD CONSTRAINT "message_tracking_events_notification_log_id_fkey" FOREIGN KEY ("notification_log_id") REFERENCES "notification_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_tracking_events" ADD CONSTRAINT "message_tracking_events_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "message_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_suppressions" ADD CONSTRAINT "message_suppressions_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_suppressions" ADD CONSTRAINT "message_suppressions_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_membership_id_fkey" FOREIGN KEY ("assigned_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_author_membership_id_fkey" FOREIGN KEY ("author_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_replies" ADD CONSTRAINT "saved_replies_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Constraints Prisma cannot express (partial indexes; the drift check
-- ignores them, see docs/CRM_VE_ATIF.md section 2).
-- ---------------------------------------------------------------------------

-- At most one OPEN conversation per contact and channel.
CREATE UNIQUE INDEX "conversations_one_open_per_contact_channel"
  ON "conversations" ("studio_id", "contact_id", "channel")
  WHERE "status" = 'OPEN';

-- Inbound webhook retries never store the same provider message twice.
CREATE UNIQUE INDEX "conversation_messages_inbound_provider_id_key"
  ON "conversation_messages" ("studio_id", "provider_message_id")
  WHERE "direction" = 'IN' AND "provider_message_id" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Permissions: inbox access for the default owner and reception templates.
-- Owners resolve to every permission anyway; the rows keep the stored list
-- complete. Tenant-edited copies of these templates are matched by key.
-- ---------------------------------------------------------------------------

INSERT INTO "role_template_permissions" ("role_template_id", "permission_key")
SELECT rt."id", p."key"
FROM "role_templates" rt
CROSS JOIN (VALUES ('inbox.view'), ('inbox.reply'), ('inbox.manage')) AS p("key")
WHERE rt."key" IN ('owner', 'reception')
ON CONFLICT DO NOTHING;

