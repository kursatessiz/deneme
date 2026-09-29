-- M4c: Meta Lead Ads intake, public write API idempotency and platform
-- integration settings (docs/PAZARLAMA_MODULU.md 5.2, 8). Expand only and
-- forward-only: two nullable ad_connections columns (existing rows keep NULL)
-- and four new tables. Nothing existing is altered or dropped.

-- AlterTable
ALTER TABLE "ad_connections" ADD COLUMN     "lead_ads_page_id" VARCHAR(40),
ADD COLUMN     "lead_ads_subscribed_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "lead_ad_events" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "connection_id" UUID,
    "leadgen_id" VARCHAR(40) NOT NULL,
    "form_id" VARCHAR(40) NOT NULL,
    "page_id" VARCHAR(40) NOT NULL,
    "ad_ids" JSONB NOT NULL DEFAULT '{}',
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "created_time" TIMESTAMP(3),
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "contact_id" UUID,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "last_error" TEXT,

    CONSTRAINT "lead_ad_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_ad_form_mappings" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "form_id" VARCHAR(40) NOT NULL,
    "form_name" VARCHAR(120),
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "consent_question_key" VARCHAR(120),
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_ad_form_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_api_idempotency_keys" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "api_key_id" UUID NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'IN_PROGRESS',
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_api_idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_integration_settings" (
    "id" VARCHAR(20) NOT NULL DEFAULT 'platform',
    "leadgen_verify_token_hash" VARCHAR(64),
    "leadgen_verify_token_last4" VARCHAR(4),
    "leadgen_verify_token_set_at" TIMESTAMP(3),
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_integration_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ad_connections_lead_ads_page_id_key" ON "ad_connections"("lead_ads_page_id");

-- CreateIndex
CREATE INDEX "lead_ad_events_studio_id_status_next_attempt_at_idx" ON "lead_ad_events"("studio_id", "status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "lead_ad_events_studio_id_received_at_idx" ON "lead_ad_events"("studio_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "lead_ad_events_studio_id_leadgen_id_key" ON "lead_ad_events"("studio_id", "leadgen_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_ad_form_mappings_studio_id_form_id_key" ON "lead_ad_form_mappings"("studio_id", "form_id");

-- CreateIndex
CREATE INDEX "public_api_idempotency_keys_expires_at_idx" ON "public_api_idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "public_api_idempotency_keys_studio_id_key_key" ON "public_api_idempotency_keys"("studio_id", "key");
