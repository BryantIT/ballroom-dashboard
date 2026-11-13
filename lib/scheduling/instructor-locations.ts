// lib/scheduling/instructor-locations.ts
import "server-only";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { withTenantContext } from "../db/with-tenant-context";
import { instructorLocations } from "../db/schema";
import * as schema from "../db/schema";
import { requirePermission } from "../auth/authorization";

type Db = NodePgDatabase<typeof schema>;

// Explicit, assignable data — which locations each instructor works at —
// never inferred from appointments or anything else. Owner-only
// (locations.manage), same rationale as locations/rooms themselves.
export async function assignInstructorToLocation(
  userId: string,
  studioId: string,
  instructorUserId: string,
  locationId: string,
  database?: Db
): Promise<void> {
  await requirePermission(userId, studioId, "locations.manage", database);

  await withTenantContext(
    { userId, tenantId: studioId },
    (tx) =>
      tx
        .insert(instructorLocations)
        .values({ studioId, instructorUserId, locationId })
        // Re-assigning the same pair is a no-op, not an error — the unique
        // index on (studio_id, instructor_user_id, location_id) backs this.
        .onConflictDoNothing(),
    database
  );
}

// Location ids a given instructor is assigned to.
export async function listInstructorLocations(
  studioId: string,
  instructorUserId: string,
  database?: Db
): Promise<string[]> {
  // Read-only lookup with no caller userId in its signature (brief's
  // interface) — same shape as lib/students/relationships.ts's
  // listRelatedStudents, for the same reason: tenant_isolation keys only
  // on studio_id, never app.user_id.
  const rows = await withTenantContext(
    { userId: "", tenantId: studioId },
    (tx) =>
      tx
        .select({ locationId: instructorLocations.locationId })
        .from(instructorLocations)
        .where(
          and(
            eq(instructorLocations.studioId, studioId),
            eq(instructorLocations.instructorUserId, instructorUserId)
          )
        ),
    database
  );

  return rows.map((row) => row.locationId);
}

// Instructor user ids assigned to a given location — consumed by the
// calendar's location filter (Task 14).
export async function listLocationInstructors(
  studioId: string,
  locationId: string,
  database?: Db
): Promise<string[]> {
  const rows = await withTenantContext(
    { userId: "", tenantId: studioId },
    (tx) =>
      tx
        .select({ instructorUserId: instructorLocations.instructorUserId })
        .from(instructorLocations)
        .where(
          and(
            eq(instructorLocations.studioId, studioId),
            eq(instructorLocations.locationId, locationId)
          )
        ),
    database
  );

  return rows.map((row) => row.instructorUserId);
}
