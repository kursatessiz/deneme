-- G3c-3: accounting export. No schema change, only the default permission:
-- the owner role of every existing studio gets accounting.export (new
-- studios receive it from DEFAULT_ROLE_TEMPLATES in packages/shared). Other
-- roles are left to the tenant. Forward-only and idempotent.
INSERT INTO "role_template_permissions" ("role_template_id", "permission_key")
SELECT rt."id", 'accounting.export'
FROM "role_templates" rt
WHERE rt."key" = 'owner' OR rt."is_owner" = true
ON CONFLICT DO NOTHING;
