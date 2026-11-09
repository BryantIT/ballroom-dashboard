// lib/students/authorization.ts
import "server-only";
import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { withTenantContext } from "../db/with-tenant-context";
import { studentAssignments } from "../db/schema";
import * as schema from "../db/schema";
import { hasPermission } from "../auth/authorization";

type Db = NodePgDatabase<typeof schema>;

// studentId's studio isn't known here, so withTenantContext can't be
// called without it. Callers (canEditStudent, and Task 10's routes)
// always know studioId from the request path — this function takes it
// as an explicit third argument.
export async function isAssignedInstructor(
  instructorUserId: string,
  studentId: string,
  studioId: string,
  database?: Db
): Promise<boolean> {
  return withTenantContext(
    { userId: instructorUserId, tenantId: studioId },
    async (tx) => {
      const now = new Date();
      const [row] = await tx
        .select()
        .from(studentAssignments)
        .where(
          and(
            eq(studentAssignments.instructorUserId, instructorUserId),
            eq(studentAssignments.studentId, studentId),
            lte(studentAssignments.effectiveAt, now),
            or(isNull(studentAssignments.endedAt), gt(studentAssignments.endedAt, now))
          )
        )
        .limit(1);
      return row !== undefined;
    },
    database
  );
}

export async function canEditStudent(
  context: { userId: string; studioId: string },
  studentId: string,
  database?: Db
): Promise<boolean> {
  if (await hasPermission(context.userId, context.studioId, "students.update_all", database)) {
    return true;
  }
  if (
    (await hasPermission(context.userId, context.studioId, "students.update_assigned", database)) &&
    (await isAssignedInstructor(context.userId, studentId, context.studioId, database))
  ) {
    return true;
  }
  return false;
}
