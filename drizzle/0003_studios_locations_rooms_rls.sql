-- drizzle/0003_studios_locations_rooms_rls.sql
ALTER TABLE "app"."studios" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "app"."studios"
  USING (id::text = current_setting('app.tenant_id', true))
  WITH CHECK (id::text = current_setting('app.tenant_id', true));

ALTER TABLE "app"."locations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "app"."locations"
  USING (studio_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (studio_id::text = current_setting('app.tenant_id', true));

ALTER TABLE "app"."rooms" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "app"."rooms"
  USING (studio_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (studio_id::text = current_setting('app.tenant_id', true));
