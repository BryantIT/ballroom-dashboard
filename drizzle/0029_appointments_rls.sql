-- Custom SQL migration file, put your code below! --
-- GRANTs for app_runtime live in scripts/db-setup-roles.sql, not here: same
-- note as 0025_instructor_locations_rls.sql.
ALTER TABLE "app"."appointment_series" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "app"."appointment_series"
  USING (studio_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (studio_id::text = current_setting('app.tenant_id', true));

ALTER TABLE "app"."appointments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "app"."appointments"
  USING (studio_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (studio_id::text = current_setting('app.tenant_id', true));

ALTER TABLE "app"."appointment_attendees" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "app"."appointment_attendees"
  USING (studio_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (studio_id::text = current_setting('app.tenant_id', true));
