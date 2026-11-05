-- RLS and the policy below were hand-written (not generated from
-- schema.ts's own RLS/policy API), so drizzle-kit's snapshot does not
-- know about them. Never run `drizzle-kit push` against this schema —
-- it would try to disable RLS and drop this policy. Always use
-- `drizzle-kit generate` + hand-reviewed custom migrations for anything
-- touching RLS.
ALTER TABLE "app"."tenant_probe" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "app"."tenant_probe"
  USING (studio_id::text = current_setting('app.tenant_id', true));
