-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'PASSIVE');

-- CreateEnum
CREATE TYPE "InviteChannel" AS ENUM ('SHOWN', 'WHATSAPP', 'SMS');

-- CreateEnum
CREATE TYPE "EntitlementKind" AS ENUM ('SESSION_COUNT', 'TIME_UNLIMITED', 'CREDIT');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'ATTENDED', 'CANCELLED_EARLY', 'CANCELLED_LATE', 'NO_SHOW', 'WAITLIST');

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'OFFERED', 'PROMOTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PackageStatus" AS ENUM ('ACTIVE', 'FROZEN', 'EXPIRED', 'DEPLETED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CREDIT_CARD_POS', 'BANK_TRANSFER', 'ONLINE_IYZICO', 'ONLINE_PAYTR');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'REFUNDED', 'FAILED');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('PER_SESSION_FIXED', 'PERCENTAGE', 'MONTHLY_SALARY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FeatureFlagScope" AS ENUM ('GLOBAL', 'BUSINESS_TYPE', 'TENANT');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('MEMBERSHIP_CONTRACT', 'KVKK_NOTICE', 'EXPLICIT_CONSENT', 'HEALTH_WAIVER');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('WHATSAPP', 'SMS', 'PUSH', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "SmsTransactionType" AS ENUM ('PURCHASE', 'USAGE', 'ADJUSTMENT', 'REFUND');

-- CreateTable
CREATE TABLE "business_type_templates" (
    "id" UUID NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "vocabulary" JSONB NOT NULL DEFAULT '{}',
    "defaults" JSONB NOT NULL DEFAULT '{}',
    "enabled_modules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_type_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "price_monthly" DECIMAL(10,2) NOT NULL,
    "limits" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "current_period_start" TIMESTAMP(3) NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" UUID NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "scope" "FeatureFlagScope" NOT NULL,
    "business_type_template_id" UUID,
    "studio_id" UUID,
    "enabled" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_packages" (
    "id" UUID NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "credits" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studios" (
    "id" UUID NOT NULL,
    "business_type_template_id" UUID,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "phone" VARCHAR(30),
    "email" VARCHAR(120),
    "address" TEXT,
    "timezone" VARCHAR(60) NOT NULL DEFAULT 'Europe/Istanbul',
    "logo_url" TEXT,
    "theme_primary" VARCHAR(7) NOT NULL DEFAULT '#3f6b52',
    "gradient_preset_key" VARCHAR(40) NOT NULL DEFAULT 'sage',
    "reminder_hours_before" INTEGER NOT NULL DEFAULT 2,
    "max_advance_booking_days" INTEGER NOT NULL DEFAULT 14,
    "notification_settings" JSONB NOT NULL DEFAULT '{"order":["WHATSAPP","SMS"]}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "address" TEXT,
    "phone" VARCHAR(30),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "email" VARCHAR(120),
    "first_name" VARCHAR(60) NOT NULL,
    "last_name" VARCHAR(60) NOT NULL,
    "pin_hash" VARCHAR(255),
    "password_hash" VARCHAR(255),
    "phone_verified_at" TIMESTAMP(3),
    "is_super_admin" BOOLEAN NOT NULL DEFAULT false,
    "avatar_url" TEXT,
    "refresh_token_hash" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "role_template_id" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'INVITED',
    "joined_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_templates" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "is_owner" BOOLEAN NOT NULL DEFAULT false,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_template_permissions" (
    "role_template_id" UUID NOT NULL,
    "permission_key" VARCHAR(80) NOT NULL,

    CONSTRAINT "role_template_permissions_pkey" PRIMARY KEY ("role_template_id","permission_key")
);

-- CreateTable
CREATE TABLE "invite_tokens" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "role_template_id" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "full_name" VARCHAR(120) NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "channel" "InviteChannel" NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" UUID NOT NULL,
    "studio_id" UUID,
    "type" "DocumentType" NOT NULL,
    "version" INTEGER NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" TEXT NOT NULL,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "document_version_id" UUID NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device" VARCHAR(200),
    "ip" VARCHAR(45),

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_profiles" (
    "id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "family_group_id" UUID,
    "birth_date" DATE,
    "emergency_contact_name" VARCHAR(100),
    "emergency_contact_phone" VARCHAR(20),
    "medical_conditions" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainer_profiles" (
    "id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "bio" TEXT,
    "commission_rule_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trainer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainer_qualifications" (
    "trainer_profile_id" UUID NOT NULL,
    "service_type_id" UUID NOT NULL,

    CONSTRAINT "trainer_qualifications_pkey" PRIMARY KEY ("trainer_profile_id","service_type_id")
);

-- CreateTable
CREATE TABLE "resource_types" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "selectable_by_member" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "branch_id" UUID,
    "resource_type_id" UUID NOT NULL,
    "parent_resource_id" UUID,
    "name" VARCHAR(100) NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "serial_number" VARCHAR(100),
    "is_maintenance" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancellation_policies" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "free_cancel_hours" INTEGER NOT NULL,
    "late_cancel_charge_units" INTEGER NOT NULL DEFAULT 1,
    "no_show_charge_units" INTEGER NOT NULL DEFAULT 1,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cancellation_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_rules" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "type" "CommissionType" NOT NULL,
    "value" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_types" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "duration_min" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "min_repeat_interval_days" INTEGER,
    "prerequisite_form_id" UUID,
    "allowed_entitlement_kinds" "EntitlementKind"[],
    "cancellation_policy_id" UUID,
    "commission_rule_id" UUID,
    "requires_qualification" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_type_resource_types" (
    "service_type_id" UUID NOT NULL,
    "resource_type_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "service_type_resource_types_pkey" PRIMARY KEY ("service_type_id","resource_type_id")
);

-- CreateTable
CREATE TABLE "package_definitions" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "entitlement_kind" "EntitlementKind" NOT NULL,
    "total_units" INTEGER,
    "validity_days" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "freeze_days_allowed" INTEGER NOT NULL DEFAULT 0,
    "is_transferable" BOOLEAN NOT NULL DEFAULT false,
    "max_family_members" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_definition_services" (
    "package_definition_id" UUID NOT NULL,
    "service_type_id" UUID NOT NULL,
    "unit_cost" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "package_definition_services_pkey" PRIMARY KEY ("package_definition_id","service_type_id")
);

-- CreateTable
CREATE TABLE "member_packages" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "package_definition_id" UUID NOT NULL,
    "entitlement_kind" "EntitlementKind" NOT NULL,
    "total_units" INTEGER,
    "used_units" INTEGER NOT NULL DEFAULT 0,
    "remaining_units" INTEGER,
    "status" "PackageStatus" NOT NULL DEFAULT 'ACTIVE',
    "start_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "end_date" TIMESTAMP(3) NOT NULL,
    "frozen_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_freeze_history" (
    "id" UUID NOT NULL,
    "member_package_id" UUID NOT NULL,
    "freeze_start_date" TIMESTAMP(3) NOT NULL,
    "freeze_end_date" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_freeze_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_transfers" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "member_package_id" UUID NOT NULL,
    "from_member_id" UUID NOT NULL,
    "to_member_id" UUID NOT NULL,
    "units" INTEGER NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_groups" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_schedules" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "branch_id" UUID,
    "service_type_id" UUID NOT NULL,
    "resource_id" UUID,
    "trainer_id" UUID,
    "original_trainer_id" UUID,
    "title" VARCHAR(120) NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "booked_count" INTEGER NOT NULL DEFAULT 0,
    "is_cancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancellation_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "member_package_id" UUID,
    "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "units_charged" INTEGER NOT NULL DEFAULT 0,
    "check_in_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "is_late_cancellation" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_resources" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "exclusive" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "booking_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "offered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurement_form_templates" (
    "id" UUID NOT NULL,
    "studio_id" UUID,
    "business_type_template_id" UUID,
    "name" VARCHAR(100) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "fields" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "measurement_form_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurement_entries" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "form_template_id" UUID NOT NULL,
    "values" JSONB NOT NULL,
    "recorded_by_user_id" UUID NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "measurement_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "member_package_id" UUID,
    "amount" DECIMAL(10,2) NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'COMPLETED',
    "receipt_number" VARCHAR(60),
    "provider_reference" VARCHAR(120),
    "notes" TEXT,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "branch_id" UUID,
    "category" VARCHAR(60) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "spent_at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_wallets" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "low_balance_threshold" INTEGER NOT NULL DEFAULT 100,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_transactions" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "type" "SmsTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "sms_package_id" UUID,
    "notification_log_id" UUID,
    "created_by_user_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "recipient_phone" VARCHAR(20) NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "content" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "provider_message_id" VARCHAR(120),
    "fallback_of_id" UUID,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "studio_id" UUID,
    "user_id" UUID,
    "action" VARCHAR(60) NOT NULL,
    "entity_type" VARCHAR(60) NOT NULL,
    "entity_id" VARCHAR(60),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_type_templates_key_key" ON "business_type_templates"("key");

-- CreateIndex
CREATE UNIQUE INDEX "plans_key_key" ON "plans"("key");

-- CreateIndex
CREATE INDEX "subscriptions_studio_id_status_idx" ON "subscriptions"("studio_id", "status");

-- CreateIndex
CREATE INDEX "feature_flags_studio_id_idx" ON "feature_flags"("studio_id");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_key_scope_business_type_template_id_studio_id_key" ON "feature_flags"("key", "scope", "business_type_template_id", "studio_id");

-- CreateIndex
CREATE UNIQUE INDEX "sms_packages_key_key" ON "sms_packages"("key");

-- CreateIndex
CREATE UNIQUE INDEX "studios_slug_key" ON "studios"("slug");

-- CreateIndex
CREATE INDEX "branches_studio_id_idx" ON "branches"("studio_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "memberships_studio_id_status_idx" ON "memberships"("studio_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_studio_id_key" ON "memberships"("user_id", "studio_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_templates_studio_id_key_key" ON "role_templates"("studio_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "invite_tokens_token_hash_key" ON "invite_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "invite_tokens_studio_id_phone_idx" ON "invite_tokens"("studio_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_studio_id_type_version_key" ON "document_versions"("studio_id", "type", "version");

-- CreateIndex
CREATE UNIQUE INDEX "consents_membership_id_document_version_id_key" ON "consents"("membership_id", "document_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "member_profiles_membership_id_key" ON "member_profiles"("membership_id");

-- CreateIndex
CREATE INDEX "member_profiles_studio_id_idx" ON "member_profiles"("studio_id");

-- CreateIndex
CREATE UNIQUE INDEX "trainer_profiles_membership_id_key" ON "trainer_profiles"("membership_id");

-- CreateIndex
CREATE INDEX "trainer_profiles_studio_id_idx" ON "trainer_profiles"("studio_id");

-- CreateIndex
CREATE UNIQUE INDEX "resource_types_studio_id_name_key" ON "resource_types"("studio_id", "name");

-- CreateIndex
CREATE INDEX "resources_studio_id_resource_type_id_idx" ON "resources"("studio_id", "resource_type_id");

-- CreateIndex
CREATE INDEX "cancellation_policies_studio_id_idx" ON "cancellation_policies"("studio_id");

-- CreateIndex
CREATE INDEX "commission_rules_studio_id_idx" ON "commission_rules"("studio_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_types_studio_id_name_key" ON "service_types"("studio_id", "name");

-- CreateIndex
CREATE INDEX "package_definitions_studio_id_is_active_idx" ON "package_definitions"("studio_id", "is_active");

-- CreateIndex
CREATE INDEX "member_packages_studio_id_member_id_status_idx" ON "member_packages"("studio_id", "member_id", "status");

-- CreateIndex
CREATE INDEX "package_freeze_history_member_package_id_idx" ON "package_freeze_history"("member_package_id");

-- CreateIndex
CREATE INDEX "package_transfers_studio_id_created_at_idx" ON "package_transfers"("studio_id", "created_at");

-- CreateIndex
CREATE INDEX "family_groups_studio_id_idx" ON "family_groups"("studio_id");

-- CreateIndex
CREATE INDEX "session_schedules_studio_id_start_time_end_time_idx" ON "session_schedules"("studio_id", "start_time", "end_time");

-- CreateIndex
CREATE INDEX "session_schedules_trainer_id_start_time_end_time_idx" ON "session_schedules"("trainer_id", "start_time", "end_time");

-- CreateIndex
CREATE INDEX "session_schedules_resource_id_start_time_end_time_idx" ON "session_schedules"("resource_id", "start_time", "end_time");

-- CreateIndex
CREATE INDEX "bookings_studio_id_status_idx" ON "bookings"("studio_id", "status");

-- CreateIndex
CREATE INDEX "bookings_member_id_idx" ON "bookings"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_schedule_id_member_id_key" ON "bookings"("schedule_id", "member_id");

-- CreateIndex
CREATE INDEX "booking_resources_resource_id_start_time_end_time_idx" ON "booking_resources"("resource_id", "start_time", "end_time");

-- CreateIndex
CREATE UNIQUE INDEX "booking_resources_booking_id_resource_id_key" ON "booking_resources"("booking_id", "resource_id");

-- CreateIndex
CREATE INDEX "waitlist_schedule_id_status_position_idx" ON "waitlist"("schedule_id", "status", "position");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_schedule_id_member_id_key" ON "waitlist"("schedule_id", "member_id");

-- CreateIndex
CREATE INDEX "measurement_form_templates_studio_id_idx" ON "measurement_form_templates"("studio_id");

-- CreateIndex
CREATE INDEX "measurement_entries_studio_id_member_id_recorded_at_idx" ON "measurement_entries"("studio_id", "member_id", "recorded_at");

-- CreateIndex
CREATE INDEX "payments_studio_id_paid_at_idx" ON "payments"("studio_id", "paid_at");

-- CreateIndex
CREATE INDEX "expenses_studio_id_spent_at_idx" ON "expenses"("studio_id", "spent_at");

-- CreateIndex
CREATE UNIQUE INDEX "sms_wallets_studio_id_key" ON "sms_wallets"("studio_id");

-- CreateIndex
CREATE UNIQUE INDEX "sms_transactions_notification_log_id_key" ON "sms_transactions"("notification_log_id");

-- CreateIndex
CREATE INDEX "sms_transactions_studio_id_created_at_idx" ON "sms_transactions"("studio_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_logs_studio_id_created_at_idx" ON "notification_logs"("studio_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_studio_id_created_at_idx" ON "audit_logs"("studio_id", "created_at");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_business_type_template_id_fkey" FOREIGN KEY ("business_type_template_id") REFERENCES "business_type_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studios" ADD CONSTRAINT "studios_business_type_template_id_fkey" FOREIGN KEY ("business_type_template_id") REFERENCES "business_type_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_template_id_fkey" FOREIGN KEY ("role_template_id") REFERENCES "role_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_templates" ADD CONSTRAINT "role_templates_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_template_permissions" ADD CONSTRAINT "role_template_permissions_role_template_id_fkey" FOREIGN KEY ("role_template_id") REFERENCES "role_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_tokens" ADD CONSTRAINT "invite_tokens_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_tokens" ADD CONSTRAINT "invite_tokens_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_tokens" ADD CONSTRAINT "invite_tokens_role_template_id_fkey" FOREIGN KEY ("role_template_id") REFERENCES "role_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_family_group_id_fkey" FOREIGN KEY ("family_group_id") REFERENCES "family_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_profiles" ADD CONSTRAINT "trainer_profiles_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_profiles" ADD CONSTRAINT "trainer_profiles_commission_rule_id_fkey" FOREIGN KEY ("commission_rule_id") REFERENCES "commission_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_qualifications" ADD CONSTRAINT "trainer_qualifications_trainer_profile_id_fkey" FOREIGN KEY ("trainer_profile_id") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_qualifications" ADD CONSTRAINT "trainer_qualifications_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "service_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_types" ADD CONSTRAINT "resource_types_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_resource_type_id_fkey" FOREIGN KEY ("resource_type_id") REFERENCES "resource_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_parent_resource_id_fkey" FOREIGN KEY ("parent_resource_id") REFERENCES "resources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellation_policies" ADD CONSTRAINT "cancellation_policies_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_types" ADD CONSTRAINT "service_types_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_types" ADD CONSTRAINT "service_types_prerequisite_form_id_fkey" FOREIGN KEY ("prerequisite_form_id") REFERENCES "measurement_form_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_types" ADD CONSTRAINT "service_types_cancellation_policy_id_fkey" FOREIGN KEY ("cancellation_policy_id") REFERENCES "cancellation_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_types" ADD CONSTRAINT "service_types_commission_rule_id_fkey" FOREIGN KEY ("commission_rule_id") REFERENCES "commission_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_type_resource_types" ADD CONSTRAINT "service_type_resource_types_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "service_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_type_resource_types" ADD CONSTRAINT "service_type_resource_types_resource_type_id_fkey" FOREIGN KEY ("resource_type_id") REFERENCES "resource_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_definitions" ADD CONSTRAINT "package_definitions_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_definition_services" ADD CONSTRAINT "package_definition_services_package_definition_id_fkey" FOREIGN KEY ("package_definition_id") REFERENCES "package_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_definition_services" ADD CONSTRAINT "package_definition_services_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "service_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_packages" ADD CONSTRAINT "member_packages_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_packages" ADD CONSTRAINT "member_packages_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_packages" ADD CONSTRAINT "member_packages_package_definition_id_fkey" FOREIGN KEY ("package_definition_id") REFERENCES "package_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_freeze_history" ADD CONSTRAINT "package_freeze_history_member_package_id_fkey" FOREIGN KEY ("member_package_id") REFERENCES "member_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_transfers" ADD CONSTRAINT "package_transfers_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_transfers" ADD CONSTRAINT "package_transfers_member_package_id_fkey" FOREIGN KEY ("member_package_id") REFERENCES "member_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_transfers" ADD CONSTRAINT "package_transfers_from_member_id_fkey" FOREIGN KEY ("from_member_id") REFERENCES "member_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_transfers" ADD CONSTRAINT "package_transfers_to_member_id_fkey" FOREIGN KEY ("to_member_id") REFERENCES "member_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_transfers" ADD CONSTRAINT "package_transfers_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_groups" ADD CONSTRAINT "family_groups_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_schedules" ADD CONSTRAINT "session_schedules_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_schedules" ADD CONSTRAINT "session_schedules_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_schedules" ADD CONSTRAINT "session_schedules_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "service_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_schedules" ADD CONSTRAINT "session_schedules_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_schedules" ADD CONSTRAINT "session_schedules_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "trainer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_schedules" ADD CONSTRAINT "session_schedules_original_trainer_id_fkey" FOREIGN KEY ("original_trainer_id") REFERENCES "trainer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "session_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_member_package_id_fkey" FOREIGN KEY ("member_package_id") REFERENCES "member_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_resources" ADD CONSTRAINT "booking_resources_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_resources" ADD CONSTRAINT "booking_resources_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_resources" ADD CONSTRAINT "booking_resources_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "session_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_form_templates" ADD CONSTRAINT "measurement_form_templates_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_form_templates" ADD CONSTRAINT "measurement_form_templates_business_type_template_id_fkey" FOREIGN KEY ("business_type_template_id") REFERENCES "business_type_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_entries" ADD CONSTRAINT "measurement_entries_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_entries" ADD CONSTRAINT "measurement_entries_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_entries" ADD CONSTRAINT "measurement_entries_form_template_id_fkey" FOREIGN KEY ("form_template_id") REFERENCES "measurement_form_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_entries" ADD CONSTRAINT "measurement_entries_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_member_package_id_fkey" FOREIGN KEY ("member_package_id") REFERENCES "member_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_wallets" ADD CONSTRAINT "sms_wallets_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_transactions" ADD CONSTRAINT "sms_transactions_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_transactions" ADD CONSTRAINT "sms_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "sms_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_transactions" ADD CONSTRAINT "sms_transactions_sms_package_id_fkey" FOREIGN KEY ("sms_package_id") REFERENCES "sms_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_transactions" ADD CONSTRAINT "sms_transactions_notification_log_id_fkey" FOREIGN KEY ("notification_log_id") REFERENCES "notification_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_transactions" ADD CONSTRAINT "sms_transactions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_fallback_of_id_fkey" FOREIGN KEY ("fallback_of_id") REFERENCES "notification_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints Prisma cannot express
-- ---------------------------------------------------------------------------

-- A single-capacity resource (EMS device, private reformer, court) cannot be
-- held by two active bookings whose times overlap. Enforced in the database
-- so concurrent requests cannot race past the application check.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "booking_resources"
  ADD CONSTRAINT "booking_resources_no_overlap"
  EXCLUDE USING gist (
    "resource_id" WITH =,
    tsrange("start_time", "end_time", '[)') WITH &&
  ) WHERE ("is_active" AND "exclusive");

ALTER TABLE "booking_resources"
  ADD CONSTRAINT "booking_resources_valid_range" CHECK ("end_time" > "start_time");

ALTER TABLE "session_schedules"
  ADD CONSTRAINT "session_schedules_valid_range" CHECK ("end_time" > "start_time"),
  ADD CONSTRAINT "session_schedules_capacity_positive" CHECK ("capacity" > 0),
  ADD CONSTRAINT "session_schedules_booked_within_capacity" CHECK ("booked_count" >= 0 AND "booked_count" <= "capacity");

ALTER TABLE "member_packages"
  ADD CONSTRAINT "member_packages_units_non_negative" CHECK ("remaining_units" IS NULL OR "remaining_units" >= 0);

ALTER TABLE "sms_wallets"
  ADD CONSTRAINT "sms_wallets_balance_non_negative" CHECK ("balance" >= 0);

-- Postgres treats NULLs as distinct in unique indexes, which would allow
-- duplicate GLOBAL flags and duplicate platform documents. NULLS NOT DISTINCT
-- closes that gap (PostgreSQL 15+).
DROP INDEX IF EXISTS "feature_flags_key_scope_business_type_template_id_studio_id_key";
CREATE UNIQUE INDEX "feature_flags_key_scope_business_type_template_id_studio_id_key"
  ON "feature_flags" ("key", "scope", "business_type_template_id", "studio_id") NULLS NOT DISTINCT;

DROP INDEX IF EXISTS "document_versions_studio_id_type_version_key";
CREATE UNIQUE INDEX "document_versions_studio_id_type_version_key"
  ON "document_versions" ("studio_id", "type", "version") NULLS NOT DISTINCT;

-- At most one owner role template per studio.
CREATE UNIQUE INDEX "role_templates_one_owner_per_studio"
  ON "role_templates" ("studio_id") WHERE "is_owner";

-- At most one live subscription per studio.
CREATE UNIQUE INDEX "subscriptions_one_live_per_studio"
  ON "subscriptions" ("studio_id") WHERE "status" IN ('TRIALING', 'ACTIVE', 'PAST_DUE');
