-- Guest and walk-in payments go into finance (docs/MUHASEBE.md,
-- docs/ETKINLIKLER.md, docs/PERAKENDE.md). Expand only: member_id becomes
-- nullable and a nullable contact_id names the CRM contact who paid when
-- there is no member. Nothing is backfilled here: guest registrations and
-- walk-in sales recorded before this release keep having no payment row
-- (a one-off money backfill is an owner decision, not a schema change).
-- No CHECK that one of member_id / contact_id is set: an anonymous walk-in
-- sale has neither. The contact belongs to the same studio; like
-- sales.contact_id this is enforced by the services that write it.

ALTER TABLE "payments" ALTER COLUMN "member_id" DROP NOT NULL;

ALTER TABLE "payments" ADD COLUMN "contact_id" UUID;

CREATE INDEX "payments_contact_id_idx" ON "payments"("contact_id");

ALTER TABLE "payments" ADD CONSTRAINT "payments_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
