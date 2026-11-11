-- drizzle/0009_memberships_rls.sql
-- GRANTs for app_runtime live in scripts/db-setup-roles.sql, not here: this
-- migration runs before app_runtime exists (see that script's header).
ALTER TABLE "app"."memberships" ENABLE ROW LEVEL SECURITY;

-- Read access: your own rows (any studio) OR any row in the studio
-- currently in context (so studio staff can list other members).
CREATE POLICY self_or_tenant_select ON "app"."memberships" FOR SELECT
  USING (
    user_id = current_setting('app.user_id', true)
    OR studio_id::text = current_setting('app.tenant_id', true)
  );

-- Write access: tenant-scoped only. A user can never insert/update/
-- delete a membership row outside the studio currently in context, even
-- their own.
CREATE POLICY tenant_write ON "app"."memberships" FOR ALL
  USING (studio_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (studio_id::text = current_setting('app.tenant_id', true));
