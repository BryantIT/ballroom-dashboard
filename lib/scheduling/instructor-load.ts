// lib/scheduling/instructor-load.ts
import "server-only";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { withTenantContext } from "../db/with-tenant-context";
import { memberships, rolePermissions, studentAssignments, users } from "../db/schema";
import * as schema from "../db/schema";

type Db = NodePgDatabase<typeof schema>;

// Same codes that gate appointment booking (appointments.ts): every staff
// member holding either one can be booked as an instructor.
const INSTRUCTOR_PERMISSIONS = ["appointments.manage_self", "appointments.manage_all"];

export type InstructorLoad = {
  instructorUserId: string;
  name: string | null;
  activeStudentCount: number;
};

// How many students each bookable instructor currently has: counts only
// not-ended studentAssignments (endedAt IS NULL). Read-only, no caller
// userId in the signature — same shape as listInstructorLocations, for the
// same reason (tenant_isolation keys only on studio_id).
export async function getInstructorLoad(studioId: string, database?: Db): Promise<InstructorLoad[]> {
  return withTenantContext(
    { userId: "", tenantId: studioId },
    async (tx) => {
      // Active members whose role carries an instructor-capable permission.
      // selectDistinct because a role holding both codes yields two rows.
      const instructors = await tx
        .selectDistinct({ instructorUserId: memberships.userId, name: users.name })
        .from(memberships)
        .innerJoin(
          rolePermissions,
          and(
            eq(rolePermissions.roleId, memberships.roleId),
            eq(rolePermissions.studioId, studioId),
            inArray(rolePermissions.permissionCode, INSTRUCTOR_PERMISSIONS)
          )
        )
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.studioId, studioId), eq(memberships.status, "active")));

      const loadRows = await tx
        .select({
          instructorUserId: studentAssignments.instructorUserId,
          activeStudentCount: count(),
        })
        .from(studentAssignments)
        .where(and(eq(studentAssignments.studioId, studioId), isNull(studentAssignments.endedAt)))
        .groupBy(studentAssignments.instructorUserId);

      const countByInstructor = new Map(loadRows.map((row) => [row.instructorUserId, row.activeStudentCount]));

      return instructors.map((instructor) => ({
        instructorUserId: instructor.instructorUserId,
        name: instructor.name,
        activeStudentCount: countByInstructor.get(instructor.instructorUserId) ?? 0,
      }));
    },
    database
  );
}
