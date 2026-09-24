-- Super-admin panel (backlog 4.1-4.3). No new tables or columns are
-- needed: Plan, Subscription, FeatureFlag, BusinessTypeTemplate,
-- SmsPackage, SmsWallet, SmsTransaction, DocumentVersion, MessageTemplate
-- and AuditLog already exist on `schema.prisma` from earlier work.
-- `prisma migrate diff --from-url ... --to-schema-datamodel schema.prisma`
-- against a freshly-deployed database produces an empty script, confirming
-- zero drift; this migration only closes a data-integrity gap the init
-- migration already fixed for feature_flags and document_versions but
-- missed for message_templates.
--
-- Postgres treats NULLs as distinct in a unique index, which would allow
-- duplicate GLOBAL message templates (studio_id IS NULL) for the same key/
-- channel/locale - the same gap `feature_flags_..._key` and
-- `document_versions_..._key` were closed for in the init migration
-- (20260924155220_init, see its NULLS NOT DISTINCT comment). This closes
-- it for message_templates too (PostgreSQL 15+).
DROP INDEX IF EXISTS "message_templates_studio_id_key_channel_locale_key";
CREATE UNIQUE INDEX "message_templates_studio_id_key_channel_locale_key"
  ON "message_templates" ("studio_id", "key", "channel", "locale") NULLS NOT DISTINCT;
