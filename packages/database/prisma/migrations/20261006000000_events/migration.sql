-- G3c-1 events, workshops and multi-session courses (docs/ETKINLIKLER.md):
-- events with dated occurrences, ticket types (price with currency, quantity
-- limit, sales window, member-only, optional payment with package units)
-- and registrations (member or CRM contact, seat-holding statuses, waitlist
-- position, amounts with currency, payment link and check-in time).
--
-- Forward-only and additive: four new tables, no change to existing
-- columns, so the previous release keeps working against this schema.

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "branch_id" UUID,
    "title" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "kind" VARCHAR(10) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
    "capacity" INTEGER NOT NULL,
    "seats_taken" INTEGER NOT NULL DEFAULT 0,
    "waitlist_enabled" BOOLEAN NOT NULL DEFAULT false,
    "visibility" VARCHAR(15) NOT NULL DEFAULT 'MEMBERS_ONLY',
    "cover_image_url" TEXT,
    "registration_opens_at" TIMESTAMP(3),
    "registration_closes_at" TIMESTAMP(3),
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "full_refund_hours_before" INTEGER NOT NULL DEFAULT 24,
    "published_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_by_membership_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_occurrences" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "resource_id" UUID,
    "trainer_id" UUID,
    "reminder_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_ticket_types" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "price_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL,
    "quantity_limit" INTEGER,
    "sold_count" INTEGER NOT NULL DEFAULT 0,
    "sales_start_at" TIMESTAMP(3),
    "sales_end_at" TIMESTAMP(3),
    "members_only" BOOLEAN NOT NULL DEFAULT false,
    "allow_multiple" BOOLEAN NOT NULL DEFAULT false,
    "credit_service_type_id" UUID,
    "credit_units" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_ticket_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_registrations" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "ticket_type_id" UUID NOT NULL,
    "member_id" UUID,
    "contact_id" UUID,
    "status" VARCHAR(20) NOT NULL,
    "source" VARCHAR(10) NOT NULL,
    "dedupe_key" VARCHAR(80),
    "waitlist_position" INTEGER,
    "amount_due" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "amount_paid" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "refunded_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL,
    "payment_id" UUID,
    "payment_method" VARCHAR(20),
    "payment_link" TEXT,
    "payment_due_at" TIMESTAMP(3),
    "member_package_id" UUID,
    "units_charged" INTEGER NOT NULL DEFAULT 0,
    "refunded_units" INTEGER NOT NULL DEFAULT 0,
    "checked_in_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "notes" TEXT,
    "created_by_membership_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "events_studio_id_status_starts_at_idx" ON "events"("studio_id", "status", "starts_at");

-- CreateIndex
CREATE INDEX "events_status_ends_at_idx" ON "events"("status", "ends_at");

-- CreateIndex
CREATE INDEX "event_occurrences_event_id_starts_at_idx" ON "event_occurrences"("event_id", "starts_at");

-- CreateIndex
CREATE INDEX "event_occurrences_studio_id_starts_at_idx" ON "event_occurrences"("studio_id", "starts_at");

-- CreateIndex
CREATE INDEX "event_occurrences_starts_at_reminder_sent_at_idx" ON "event_occurrences"("starts_at", "reminder_sent_at");

-- CreateIndex
CREATE INDEX "event_ticket_types_event_id_sort_order_idx" ON "event_ticket_types"("event_id", "sort_order");

-- CreateIndex
CREATE INDEX "event_ticket_types_studio_id_idx" ON "event_ticket_types"("studio_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_registrations_payment_id_key" ON "event_registrations"("payment_id");

-- CreateIndex
CREATE INDEX "event_registrations_studio_id_event_id_status_idx" ON "event_registrations"("studio_id", "event_id", "status");

-- CreateIndex
CREATE INDEX "event_registrations_event_id_status_waitlist_position_idx" ON "event_registrations"("event_id", "status", "waitlist_position");

-- CreateIndex
CREATE INDEX "event_registrations_studio_id_status_payment_due_at_idx" ON "event_registrations"("studio_id", "status", "payment_due_at");

-- CreateIndex
CREATE INDEX "event_registrations_member_id_idx" ON "event_registrations"("member_id");

-- CreateIndex
CREATE INDEX "event_registrations_contact_id_idx" ON "event_registrations"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_registrations_event_id_dedupe_key_key" ON "event_registrations"("event_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_occurrences" ADD CONSTRAINT "event_occurrences_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_occurrences" ADD CONSTRAINT "event_occurrences_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_occurrences" ADD CONSTRAINT "event_occurrences_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_occurrences" ADD CONSTRAINT "event_occurrences_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "trainer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_ticket_types" ADD CONSTRAINT "event_ticket_types_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_ticket_types" ADD CONSTRAINT "event_ticket_types_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_ticket_types" ADD CONSTRAINT "event_ticket_types_credit_service_type_id_fkey" FOREIGN KEY ("credit_service_type_id") REFERENCES "service_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_ticket_type_id_fkey" FOREIGN KEY ("ticket_type_id") REFERENCES "event_ticket_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_member_package_id_fkey" FOREIGN KEY ("member_package_id") REFERENCES "member_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Keys from the shared catalogues (packages/shared/src/events.ts).
ALTER TABLE "events" ADD CONSTRAINT "events_kind_check" CHECK ("kind" IN ('SINGLE', 'SERIES'));
ALTER TABLE "events" ADD CONSTRAINT "events_status_check" CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED'));
ALTER TABLE "events" ADD CONSTRAINT "events_visibility_check" CHECK ("visibility" IN ('PUBLIC', 'MEMBERS_ONLY'));
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_status_check"
  CHECK ("status" IN ('PENDING_PAYMENT', 'CONFIRMED', 'WAITLIST', 'CANCELLED', 'ATTENDED', 'NO_SHOW'));
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_source_check" CHECK ("source" IN ('STAFF', 'MEMBER', 'PUBLIC'));

-- Capacity and counters never go out of range, whatever a caller does.
ALTER TABLE "events" ADD CONSTRAINT "events_capacity_positive" CHECK ("capacity" > 0);
ALTER TABLE "events" ADD CONSTRAINT "events_seats_in_range" CHECK ("seats_taken" >= 0 AND "seats_taken" <= "capacity");
ALTER TABLE "event_ticket_types" ADD CONSTRAINT "event_ticket_types_sold_in_range"
  CHECK ("sold_count" >= 0 AND ("quantity_limit" IS NULL OR "sold_count" <= "quantity_limit"));
ALTER TABLE "event_ticket_types" ADD CONSTRAINT "event_ticket_types_price_non_negative" CHECK ("price_amount" >= 0);
ALTER TABLE "event_occurrences" ADD CONSTRAINT "event_occurrences_ends_after_start" CHECK ("ends_at" > "starts_at");
-- A registration belongs to exactly one person: a member or a CRM contact.
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_person_check"
  CHECK (("member_id" IS NOT NULL) OR ("contact_id" IS NOT NULL));

-- ---------------------------------------------------------------------------
-- Permissions: owners resolve every key in code already; the rows keep the
-- stored lists complete. Reception gets events.view and events.checkin by
-- default (registration list at the door); events.manage stays with the
-- owner unless granted.
-- ---------------------------------------------------------------------------

INSERT INTO "role_template_permissions" ("role_template_id", "permission_key")
SELECT rt."id", p."key"
FROM "role_templates" rt
CROSS JOIN (VALUES ('events.view'), ('events.manage'), ('events.checkin')) AS p("key")
WHERE rt."key" = 'owner' OR rt."is_owner" = true
ON CONFLICT DO NOTHING;

INSERT INTO "role_template_permissions" ("role_template_id", "permission_key")
SELECT rt."id", p."key"
FROM "role_templates" rt
CROSS JOIN (VALUES ('events.view'), ('events.checkin')) AS p("key")
WHERE rt."key" = 'reception' AND rt."is_owner" = false
ON CONFLICT DO NOTHING;
