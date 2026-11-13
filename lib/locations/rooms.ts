// lib/locations/rooms.ts
import "server-only";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { withTenantContext } from "../db/with-tenant-context";
import { rooms, locations } from "../db/schema";
import * as schema from "../db/schema";
import { requirePermission } from "../auth/authorization";

type Db = NodePgDatabase<typeof schema>;

export type Room = typeof rooms.$inferSelect;

export class LocationNotFoundError extends Error {
  constructor(locationId: string) {
    super(`No location found with id ${locationId}`);
    this.name = "LocationNotFoundError";
  }
}

// Owner-only (locations.manage), same rationale as locations/instructor
// assignments themselves (see lib/db/schema.ts's comment on `rooms`).
//
// Security-critical: studioId for the inserted room is taken ONLY from the
// location row resolved below — never from the caller's studioId argument
// directly, and never from any other source. The lookup itself runs inside
// studioId's own tenant context, so RLS on `locations` already scopes it to
// that studio: a locationId that exists but belongs to a different studio
// is structurally invisible here, resolving to the same "not found" as a
// locationId that doesn't exist at all. That ambiguity is intentional — it
// never reveals which case occurred.
export async function createRoom(
  userId: string,
  studioId: string,
  locationId: string,
  name: string,
  database?: Db
): Promise<Room> {
  await requirePermission(userId, studioId, "locations.manage", database);

  const location = await withTenantContext(
    { userId, tenantId: studioId },
    async (tx) => {
      const [row] = await tx.select().from(locations).where(eq(locations.id, locationId));
      return row ?? null;
    },
    database
  );

  if (!location) {
    throw new LocationNotFoundError(locationId);
  }

  return withTenantContext(
    { userId, tenantId: studioId },
    async (tx) => {
      const [created] = await tx
        .insert(rooms)
        .values({ studioId: location.studioId, locationId: location.id, name })
        .returning();
      return created;
    },
    database
  );
}

// Read-only lookup with no caller userId in its signature (brief's
// interface) — same shape as lib/students/relationships.ts's
// listRelatedStudents and lib/scheduling/instructor-locations.ts's
// listLocationInstructors, for the same reason: tenant_isolation keys only
// on studio_id, never app.user_id.
export async function listRoomsForLocation(
  studioId: string,
  locationId: string,
  database?: Db
): Promise<Room[]> {
  return withTenantContext(
    { userId: "", tenantId: studioId },
    (tx) => tx.select().from(rooms).where(eq(rooms.locationId, locationId)),
    database
  );
}
