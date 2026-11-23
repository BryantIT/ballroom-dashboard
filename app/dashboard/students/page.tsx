// app/dashboard/students/page.tsx
import { and, asc, eq } from "drizzle-orm";
import { verifySession } from "@/lib/dal";
import { withTenantContext } from "@/lib/db/with-tenant-context";
import { memberships, students } from "@/lib/db/schema";
import { hasPermission } from "@/lib/auth/authorization";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StudentList } from "@/components/student-list";

export default async function StudentsPage() {
  const { userId } = await verifySession();

  // Same "first active membership, ordered by createdAt" resolution the
  // dashboard layout (Task 9) and the branding settings page use — see
  // app/dashboard/layout.tsx for why this query shape and tenant context
  // (tenantId: null, relying on memberships' self_or_tenant_select RLS
  // policy) are correct.
  const [membership] = await withTenantContext({ userId, tenantId: null }, (tx) =>
    tx
      .select({ studioId: memberships.studioId })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")))
      .orderBy(asc(memberships.createdAt))
      .limit(1)
  );

  if (!membership) {
    // The dashboard layout already renders its own "No studio yet" state
    // and does not render this page's children in that case, but this is
    // a cheap, harmless guard against the same real, reachable state.
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>No studio yet</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          You&apos;re not a member of a studio yet.
        </CardContent>
      </Card>
    );
  }

  const studioId = membership.studioId;

  // students.read is granted to all three built-in roles today (and
  // dashboard-nav's "Students" link assumes that too), but roles/
  // rolePermissions are DB-driven — a future custom role could omit it.
  // Resolve it server-side like every API route does, rather than
  // relying on tenant RLS alone to decide what this page renders.
  const canReadStudents = await hasPermission(userId, studioId, "students.read");

  if (!canReadStudents) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Students</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          You don&apos;t have access to this page.
        </CardContent>
      </Card>
    );
  }

  const canCreateStudent = await hasPermission(userId, studioId, "students.create");

  const rows = await withTenantContext({ userId, tenantId: studioId }, (tx) =>
    tx.select().from(students).orderBy(asc(students.displayName))
  );

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Students</CardTitle>
      </CardHeader>
      <CardContent>
        <StudentList studioId={studioId} students={rows} canCreateStudent={canCreateStudent} />
      </CardContent>
    </Card>
  );
}
