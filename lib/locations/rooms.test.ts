// lib/locations/rooms.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "../db/testing/test-database";
import { users, locations, roles, memberships } from "../db/schema";
import * as schema from "../db/schema";

describe("rooms", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let provisionStudio: typeof import("../studios/provision").provisionStudio;
  let createRoom: typeof import("./rooms").createRoom;
  let listRoomsForLocation: typeof import("./rooms").listRoomsForLocation;
  let LocationNotFoundError: typeof import("./rooms").LocationNotFoundError;
  let PermissionDeniedError: typeof import("../auth/authorization").PermissionDeniedError;
  let withTenantContext: typeof import("../db/with-tenant-context").withTenantContext;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ provisionStudio } = await import("../studios/provision"));
    ({ createRoom, listRoomsForLocation, LocationNotFoundError } = await import("./rooms"));
    ({ withTenantContext } = await import("../db/with-tenant-context"));
    ({ PermissionDeniedError } = await import("../auth/authorization"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  async function createOwnerAndLocation(emailSuffix: string) {
    const db = drizzle(pool, { schema });
    const [owner] = await db
      .insert(users)
      .values({ email: `owner-rooms-${emailSuffix}@example.com` })
      .returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const { location } = await withTenantContext(
      { userId: owner.id, tenantId: studioId },
      async (tx) => {
        const [location] = await tx
          .insert(locations)
          .values({ studioId, name: "Main Studio", timezone: "America/Chicago" })
          .returning();
        return { location };
      },
      db
    );
    return { db, owner, studioId, location };
  }

  // Mirrors lib/scheduling/instructor-locations.test.ts's
  // createOwnerInstructorAndLocation helper: an active membership with the
  // Instructor role, not just "no membership at all" — this exercises
  // requirePermission's hasPermission(..., "locations.manage") role-check
  // path, rather than short-circuiting on getActiveMembership returning
  // null. roles/memberships are RLS-protected, so this runs inside the
  // owner's own tenant context, same as createOwnerAndLocation above.
  async function addInstructorMembership(
    db: ReturnType<typeof drizzle<typeof schema>>,
    ownerId: string,
    studioId: string,
    emailSuffix: string
  ) {
    const [instructor] = await db
      .insert(users)
      .values({ email: `instructor-rooms-${emailSuffix}@example.com` })
      .returning();
    await withTenantContext(
      { userId: ownerId, tenantId: studioId },
      async (tx) => {
        const [instructorRole] = await tx
          .select()
          .from(roles)
          .where(and(eq(roles.studioId, studioId), eq(roles.code, "instructor")));
        await tx.insert(memberships).values({
          studioId,
          userId: instructor.id,
          roleId: instructorRole.id,
          status: "active",
        });
      },
      db
    );
    return instructor;
  }

  test("creates a room under a location, deriving studioId from the location", async () => {
    const { db, owner, studioId, location } = await createOwnerAndLocation("create");

    const room = await createRoom(owner.id, studioId, location.id, "Room A", db);

    expect(room.studioId).toBe(studioId);
    expect(room.locationId).toBe(location.id);
    expect(room.name).toBe("Room A");
  });

  test("rejects a locationId that belongs to a different studio", async () => {
    const { db, owner, studioId } = await createOwnerAndLocation("cross-a");
    const { location: foreignLocation } = await createOwnerAndLocation("cross-b");

    await expect(
      createRoom(owner.id, studioId, foreignLocation.id, "Room A", db)
    ).rejects.toThrow(LocationNotFoundError);
  });

  test("a non-Owner cannot create a room", async () => {
    const { db, studioId, location } = await createOwnerAndLocation("perm");
    const [outsider] = await db
      .insert(users)
      .values({ email: "outsider-rooms@example.com" })
      .returning();

    await expect(
      createRoom(outsider.id, studioId, location.id, "Room A", db)
    ).rejects.toThrow(PermissionDeniedError);
  });

  test("an active Instructor-role member cannot create a room", async () => {
    const { db, owner, studioId, location } = await createOwnerAndLocation("perm-instructor");
    const instructor = await addInstructorMembership(db, owner.id, studioId, "perm");

    await expect(
      createRoom(instructor.id, studioId, location.id, "Room A", db)
    ).rejects.toThrow(PermissionDeniedError);
  });

  test("lists rooms for a location", async () => {
    const { db, owner, studioId, location } = await createOwnerAndLocation("list");

    await createRoom(owner.id, studioId, location.id, "Room A", db);
    await createRoom(owner.id, studioId, location.id, "Room B", db);

    const rooms = await listRoomsForLocation(studioId, location.id, db);

    expect(rooms.map((room) => room.name).sort()).toEqual(["Room A", "Room B"]);
  });
});
