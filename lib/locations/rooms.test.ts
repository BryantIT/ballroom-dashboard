// lib/locations/rooms.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "../db/testing/test-database";
import { users, locations } from "../db/schema";
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

  test("lists rooms for a location", async () => {
    const { db, owner, studioId, location } = await createOwnerAndLocation("list");

    await createRoom(owner.id, studioId, location.id, "Room A", db);
    await createRoom(owner.id, studioId, location.id, "Room B", db);

    const rooms = await listRoomsForLocation(studioId, location.id, db);

    expect(rooms.map((room) => room.name).sort()).toEqual(["Room A", "Room B"]);
  });
});
