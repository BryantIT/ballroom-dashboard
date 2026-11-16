// app/dashboard/students/[studentId]/page.tsx
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { withTenantContext } from "@/lib/db/with-tenant-context";
import { memberships, students, studentAssignments, users } from "@/lib/db/schema";
import { canEditStudent } from "@/lib/students/authorization";
import { canWriteNote, listVisibleNotes } from "@/lib/students/notes";
import { listRelatedStudents } from "@/lib/students/relationships";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StudentForm } from "@/components/student-form";
import { NotesList } from "@/components/notes-list";

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  if (!z.uuid().safeParse(studentId).success) {
    notFound();
  }

  const { userId } = await verifySession();

  // Same "first active membership, ordered by createdAt" resolution the
  // dashboard layout (Task 9) and the students list page use.
  const [membership] = await withTenantContext({ userId, tenantId: null }, (tx) =>
    tx
      .select({ studioId: memberships.studioId })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")))
      .orderBy(asc(memberships.createdAt))
      .limit(1)
  );

  if (!membership) {
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

  const [student] = await withTenantContext({ userId, tenantId: studioId }, (tx) =>
    tx.select().from(students).where(eq(students.id, studentId)).limit(1)
  );

  if (!student) {
    notFound();
  }

  // Authorization for the edit/add-note controls is resolved here,
  // server-side, before anything is rendered — canEditStudent/
  // canWriteNote decide whether those controls exist at all, not
  // whether they're merely hidden-via-CSS on the client.
  const [canEdit, canAddNote, visibleNotes, relatedIds] = await Promise.all([
    canEditStudent({ userId, studioId }, studentId),
    canWriteNote({ userId, studioId }, studentId),
    listVisibleNotes({ userId, studioId }, studentId),
    listRelatedStudents(studioId, studentId),
  ]);

  const relatedStudents =
    relatedIds.length > 0
      ? await withTenantContext({ userId, tenantId: studioId }, (tx) =>
          tx
            .select({ id: students.id, displayName: students.displayName })
            .from(students)
            .where(inArray(students.id, relatedIds))
        )
      : [];

  const assignments = await withTenantContext({ userId, tenantId: studioId }, (tx) =>
    tx
      .select({
        id: studentAssignments.id,
        instructorName: users.name,
        instructorEmail: users.email,
        isPrimary: studentAssignments.isPrimary,
        effectiveAt: studentAssignments.effectiveAt,
        endedAt: studentAssignments.endedAt,
      })
      .from(studentAssignments)
      .innerJoin(users, eq(users.id, studentAssignments.instructorUserId))
      .where(eq(studentAssignments.studentId, studentId))
      .orderBy(desc(studentAssignments.effectiveAt))
  );

  return (
    <div className="flex w-full max-w-2xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{student.displayName}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            {student.email ? <p>{student.email}</p> : null}
            {student.phone ? <p>{student.phone}</p> : null}
          </div>
          {canEdit ? (
            <StudentForm
              studioId={studioId}
              student={{
                id: student.id,
                displayName: student.displayName,
                email: student.email,
                phone: student.phone,
              }}
            />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <NotesList
            studioId={studioId}
            studentId={studentId}
            notes={visibleNotes}
            canWriteNote={canAddNote}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Relationships</CardTitle>
        </CardHeader>
        <CardContent>
          {relatedStudents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No linked students.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {relatedStudents.map((related) => (
                <li key={related.id}>
                  <Link
                    href={`/dashboard/students/${related.id}`}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {related.displayName}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assignment history</CardTitle>
        </CardHeader>
        <CardContent>
          {assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No instructor assignments yet.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {assignments.map((assignment) => (
                <li key={assignment.id}>
                  {assignment.instructorName ?? assignment.instructorEmail}
                  {assignment.isPrimary ? " (primary)" : ""} —{" "}
                  {assignment.effectiveAt.toLocaleDateString()}
                  {assignment.endedAt
                    ? ` to ${assignment.endedAt.toLocaleDateString()}`
                    : " – present"}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
