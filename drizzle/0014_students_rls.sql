-- drizzle/0014_students_rls.sql
-- GRANTs for app_runtime live in scripts/db-setup-roles.sql, not here: this
-- migration runs before app_runtime exists (see that script's header).
ALTER TABLE "app"."students" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "app"."students"
  USING (studio_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (studio_id::text = current_setting('app.tenant_id', true));

ALTER TABLE "app"."student_assignments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "app"."student_assignments"
  USING (studio_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (studio_id::text = current_setting('app.tenant_id', true));

-- BR-02: "the same studio may have multiple concurrent instructor
-- assignments; at most one current primary assignment is enforced in
-- v0.3." A student can have only one row that is both is_primary and
-- not yet ended.
CREATE UNIQUE INDEX student_assignments_one_current_primary
  ON "app"."student_assignments" (student_id)
  WHERE is_primary AND ended_at IS NULL;
