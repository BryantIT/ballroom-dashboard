-- Seeds the branding.manage catalog row. Must mirror PERMISSION_DESCRIPTIONS
-- in lib/auth/permissions.ts (enforced by lib/auth/permissions.test.ts).
-- Same pattern as 0005_permissions_seed.sql; no GRANT here (see
-- scripts/db-setup-roles.sql).
INSERT INTO "app"."permissions" (code, description) VALUES
  ('branding.manage', 'Manage studio theme, logo, and subdomain slug');
