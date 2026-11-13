-- Custom SQL migration file, put your code below! --
-- GRANTs for app_runtime live in scripts/db-setup-roles.sql, not here: same
-- note as 0014_students_rls.sql.
ALTER TABLE "app"."student_relationships" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "app"."student_relationships"
  USING (studio_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (studio_id::text = current_setting('app.tenant_id', true));
