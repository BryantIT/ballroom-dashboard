-- drizzle/0007_roles_rls.sql
-- GRANTs for app_runtime live in scripts/db-setup-roles.sql, not here: this
-- migration runs before app_runtime exists (see that script's header).
ALTER TABLE "app"."roles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "app"."roles"
  USING (studio_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (studio_id::text = current_setting('app.tenant_id', true));

ALTER TABLE "app"."role_permissions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "app"."role_permissions"
  USING (studio_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (studio_id::text = current_setting('app.tenant_id', true));
