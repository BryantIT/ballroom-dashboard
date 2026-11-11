-- drizzle/0012_support_sessions_rls.sql
-- GRANTs for app_runtime live in scripts/db-setup-roles.sql, not here: this
-- migration runs before app_runtime exists (see that script's header).
-- platform_admins gets a grant only (in that script), no RLS: it's a
-- global staff flag, not tenant-owned (see lib/db/schema.ts).
ALTER TABLE "app"."support_sessions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "app"."support_sessions"
  USING (studio_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (studio_id::text = current_setting('app.tenant_id', true));
