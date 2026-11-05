ALTER TABLE "app"."tenant_probe" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "app"."tenant_probe"
  USING (studio_id::text = current_setting('app.tenant_id', true));
