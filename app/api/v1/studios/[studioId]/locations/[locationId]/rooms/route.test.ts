// app/api/v1/studios/[studioId]/locations/[locationId]/rooms/route.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing/test-database";
import { users, locations } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";

// Only session verification is stubbed; everything below it (permission
// checks, RLS, the query itself) runs against real Postgres.
const sessionUser = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/dal", () => ({
  verifyApiSession: async () => (sessionUser.userId ? { userId: sessionUser.userId } : null),
  verifySession: async () => (sessionUser.userId ? { userId: sessionUser.userId } : null),
}));

describe("/api/v1/studios/{studioId}/locations/{locationId}/rooms", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let GET: typeof import("./route").GET;
  let POST: typeof import("./route").POST;
  let provisionStudio: typeof import("@/lib/studios/provision").provisionStudio;
  let withTenantContext: typeof import("@/lib/db/with-tenant-context").withTenantContext;
  let appDb: typeof import("@/lib/db/client").db;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ GET, POST } = await import("./route"));
    ({ provisionStudio } = await import("@/lib/studios/provision"));
    ({ withTenantContext } = await import("@/lib/db/with-tenant-context"));
    ({ db: appDb } = await import("@/lib/db/client"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await appDb.$client.end();
    await testDb.stop();
  });

  function makeGetRequest(studioId: string, locationId: string) {
    return new Request(
      `http://localhost/api/v1/studios/${studioId}/locations/${locationId}/rooms`
    );
  }

  function makePostRequest(studioId: string, locationId: string, body: unknown) {
    return new Request(
      `http://localhost/api/v1/studios/${studioId}/locations/${locationId}/rooms`,
      { method: "POST", body: JSON.stringify(body) }
    );
  }

  async function createOwnerAndLocation(emailSuffix: string) {
    const db = drizzle(pool, { schema });
    const [owner] = await db
      .insert(users)
      .values({ email: `owner-rooms-route-${emailSuffix}@example.com` })
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

  describe("POST", () => {
    test("returns 401 when there is no session", async () => {
      const { studioId, location } = await createOwnerAndLocation("post-401");
      sessionUser.userId = "";

      const response = await POST(makePostRequest(studioId, location.id, { name: "Room A" }), {
        params: Promise.resolve({ studioId, locationId: location.id }),
      });

      expect(response.status).toBe(401);
    });

    test("returns 400 for an invalid body", async () => {
      const { owner, studioId, location } = await createOwnerAndLocation("post-400");
      sessionUser.userId = owner.id;

      const response = await POST(makePostRequest(studioId, location.id, {}), {
        params: Promise.resolve({ studioId, locationId: location.id }),
      });

      expect(response.status).toBe(400);
    });

    test("returns 403 when the caller lacks locations.manage", async () => {
      const { db, studioId, location } = await createOwnerAndLocation("post-403");
      const [outsider] = await db
        .insert(users)
        .values({ email: "outsider-rooms-post@example.com" })
        .returning();
      sessionUser.userId = outsider.id;

      const response = await POST(makePostRequest(studioId, location.id, { name: "Room A" }), {
        params: Promise.resolve({ studioId, locationId: location.id }),
      });

      expect(response.status).toBe(403);
    });

    test("returns 404 for a locationId belonging to a different studio", async () => {
      const { owner, studioId } = await createOwnerAndLocation("post-404-a");
      const { location: foreignLocation } = await createOwnerAndLocation("post-404-b");
      sessionUser.userId = owner.id;

      const response = await POST(
        makePostRequest(studioId, foreignLocation.id, { name: "Room A" }),
        { params: Promise.resolve({ studioId, locationId: foreignLocation.id }) }
      );

      expect(response.status).toBe(404);
    });

    test("an Owner can create a room under a location", async () => {
      const { owner, studioId, location } = await createOwnerAndLocation("post-ok");
      sessionUser.userId = owner.id;

      const response = await POST(makePostRequest(studioId, location.id, { name: "Room A" }), {
        params: Promise.resolve({ studioId, locationId: location.id }),
      });

      expect(response.status).toBe(201);
      const body = (await response.json()) as { name: string; studioId: string };
      expect(body.name).toBe("Room A");
      expect(body.studioId).toBe(studioId);
    });
  });

  describe("GET", () => {
    test("returns 401 when there is no session", async () => {
      const { studioId, location } = await createOwnerAndLocation("get-401");
      sessionUser.userId = "";

      const response = await GET(makeGetRequest(studioId, location.id), {
        params: Promise.resolve({ studioId, locationId: location.id }),
      });

      expect(response.status).toBe(401);
    });

    test("returns 403 for a user with no membership in the studio", async () => {
      const { db, studioId, location } = await createOwnerAndLocation("get-403");
      const [outsider] = await db
        .insert(users)
        .values({ email: "outsider-rooms-get@example.com" })
        .returning();
      sessionUser.userId = outsider.id;

      const response = await GET(makeGetRequest(studioId, location.id), {
        params: Promise.resolve({ studioId, locationId: location.id }),
      });

      expect(response.status).toBe(403);
    });

    test("lists rooms for a location", async () => {
      const { owner, studioId, location } = await createOwnerAndLocation("get-list");
      sessionUser.userId = owner.id;
      await POST(makePostRequest(studioId, location.id, { name: "Room A" }), {
        params: Promise.resolve({ studioId, locationId: location.id }),
      });

      const response = await GET(makeGetRequest(studioId, location.id), {
        params: Promise.resolve({ studioId, locationId: location.id }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as Array<{ name: string }>;
      expect(body.map((room) => room.name)).toEqual(["Room A"]);
    });
  });
});
