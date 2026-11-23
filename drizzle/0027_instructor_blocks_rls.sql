-- Custom SQL migration file, put your code below! --
-- GRANTs for app_runtime live in scripts/db-setup-roles.sql, not here: same
-- note as 0025_instructor_locations_rls.sql.
ALTER TABLE "app"."instructor_blocks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "app"."instructor_blocks"
  USING (studio_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (studio_id::text = current_setting('app.tenant_id', true));
