-- M4a: OAuth connect (docs/PAZARLAMA_MODULU.md 5.2, 8). Expand only and
-- forward-only: one enum value, nullable or defaulted columns on
-- ad_connections, social_connections and platform_integration_settings
-- (existing rows become PASTED with no OAuth data, so pasted-token
-- connections keep working unchanged) and the new oauth_states table.
-- Nothing existing is altered in type, renamed or dropped. The new enum
-- value is not used inside this migration (ALTER TYPE ... ADD VALUE).

-- AlterEnum
ALTER TYPE "SocialConnectionStatus" ADD VALUE 'REAUTH_REQUIRED';

-- AlterTable
ALTER TABLE "ad_connections" ADD COLUMN     "auth_method" VARCHAR(10) NOT NULL DEFAULT 'PASTED',
ADD COLUMN     "connected_by_user_id" UUID,
ADD COLUMN     "encrypted_refresh_token" TEXT,
ADD COLUMN     "next_refresh_at" TIMESTAMP(3),
ADD COLUMN     "oauth_provider" VARCHAR(16),
ADD COLUMN     "refresh_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "token_expires_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "platform_integration_settings" ADD COLUMN     "oauth_clients" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "social_connections" ADD COLUMN     "auth_method" VARCHAR(10) NOT NULL DEFAULT 'PASTED',
ADD COLUMN     "encrypted_refresh_token" TEXT,
ADD COLUMN     "next_refresh_at" TIMESTAMP(3),
ADD COLUMN     "oauth_provider" VARCHAR(16),
ADD COLUMN     "refresh_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "token_expires_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "oauth_states" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" VARCHAR(16) NOT NULL,
    "state_hash" VARCHAR(64) NOT NULL,
    "encrypted_code_verifier" TEXT,
    "target_kind" VARCHAR(32) NOT NULL,
    "target_id" UUID,
    "target_params" JSONB NOT NULL DEFAULT '{}',
    "return_to" VARCHAR(16) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oauth_states_state_hash_key" ON "oauth_states"("state_hash");

-- CreateIndex
CREATE INDEX "oauth_states_expires_at_idx" ON "oauth_states"("expires_at");

-- CreateIndex
CREATE INDEX "oauth_states_studio_id_created_at_idx" ON "oauth_states"("studio_id", "created_at");

-- CreateIndex
CREATE INDEX "ad_connections_auth_method_next_refresh_at_idx" ON "ad_connections"("auth_method", "next_refresh_at");

-- CreateIndex
CREATE INDEX "social_connections_auth_method_next_refresh_at_idx" ON "social_connections"("auth_method", "next_refresh_at");

