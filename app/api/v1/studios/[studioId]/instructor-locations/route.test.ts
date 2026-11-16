// app/api/v1/studios/[studioId]/instructor-locations/route.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing/test-database";
import { users, locations, roles, memberships } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";

// Only session verification is stubbed; everything below it (permission
// checks, RLS, the query itself) runs against real Postgres.
const sessionUser = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/dal", () => ({
  verifyApiSession: async () => (sessionUser.userId ? { userId: sessionUser.userId } : null),
  verifySession: async () => (sessionUser.userId ? { userId: sessionUser.userId } : null),
}));

describe("/api/v1/studios/{studioId}/instructor-locations", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let GET: typeof import("./route").GET;
  let POST: typeof import("./route").POST;
  let provisionStudio: typeof import("@/lib/studios/provision").provisionStudio;
  let withTenantContext: typeof import("@/lib/db/with-tenant-context").withTenantContext;
  let appDb: typeof import("@/lib/db/client").db;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    // The route uses the default db client, which reads this at import time.
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

  function makeGetRequest(studioId: string, query: string) {
    return new Request(`http://localhost/api/v1/studios/${studioId}/instructor-locations${query}`);
  }

  function makePostRequest(studioId: string, body: unknown) {
    return new Request(`http://localhost/api/v1/studios/${studioId}/instructor-locations`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async function createOwnerInstructorAndLocation(emailSuffix: string) {
    const db = drizzle(pool, { schema });
    const [owner] = await db
      .insert(users)
      .values({ email: `owner-il-route-${emailSuffix}@example.com` })
      .returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const [instructor] = await db
      .insert(users)
      .values({ email: `instructor-il-route-${emailSuffix}@example.com` })
      .returning();
    const { location } = await withTenantContext(
      { userId: owner.id, tenantId: studioId },
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
        const [location] = await tx
          .insert(locations)
          .values({ studioId, name: "Main Studio", timezone: "America/Chicago" })
          .returning();
        return { location };
      },
      db
    );
    return { db, owner, instructor, studioId, location };
  }

  describe("GET", () => {
    test("returns 401 when there is no session", async () => {
      const { studioId, location } = await createOwnerInstructorAndLocation("get-401");
      sessionUser.userId = "";

      const response = await GET(makeGetRequest(studioId, `?locationId=${location.id}`), {
        params: Promise.resolve({ studioId }),
      });

      expect(response.status).toBe(401);
    });

    test("returns 400 for an invalid studioId", async () => {
      const { owner, location } = await createOwnerInstructorAndLocation("get-400-studio");
      sessionUser.userId = owner.id;

      const response = await GET(makeGetRequest("not-a-uuid", `?locationId=${location.id}`), {
        params: Promise.resolve({ studioId: "not-a-uuid" }),
      });

      expect(response.status).toBe(400);
    });

    test("returns 400 when neither locationId nor instructorUserId is given", async () => {
      const { studioId, owner } = await createOwnerInstructorAndLocation("get-400-none");
      sessionUser.userId = owner.id;

      const response = await GET(makeGetRequest(studioId, ""), {
        params: Promise.resolve({ studioId }),
      });

      expect(response.status).toBe(400);
    });

    test("returns 400 when both locationId and instructorUserId are given", async () => {
      const { studioId, owner, instructor, location } =
        await createOwnerInstructorAndLocation("get-400-both");
      sessionUser.userId = owner.id;

      const response = await GET(
        makeGetRequest(studioId, `?locationId=${location.id}&instructorUserId=${instructor.id}`),
        { params: Promise.resolve({ studioId }) }
      );

      expect(response.status).toBe(400);
    });

    test("returns 400 for a malformed locationId", async () => {
      const { studioId, owner } = await createOwnerInstructorAndLocation("get-400-malformed");
      sessionUser.userId = owner.id;

      const response = await GET(makeGetRequest(studioId, "?locationId=not-a-uuid"), {
        params: Promise.resolve({ studioId }),
      });

      expect(response.status).toBe(400);
    });

    test("returns 403 when the caller lacks appointments.read_all", async () => {
      const { studioId, location, db } = await createOwnerInstructorAndLocation("get-403");
      const [outsider] = await db
        .insert(users)
        .values({ email: "outsider-il-get@example.com" })
        .returning();
      sessionUser.userId = outsider.id;

      const response = await GET(makeGetRequest(studioId, `?locationId=${location.id}`), {
        params: Promise.resolve({ studioId }),
      });

      expect(response.status).toBe(403);
    });

    test("lists instructors for a location", async () => {
      const { studioId, owner, instructor, location } =
        await createOwnerInstructorAndLocation("get-by-location");
      sessionUser.userId = owner.id;
      await POST(makePostRequest(studioId, { instructorUserId: instructor.id, locationId: location.id }), {
        params: Promise.resolve({ studioId }),
      });

      const response = await GET(makeGetRequest(studioId, `?locationId=${location.id}`), {
        params: Promise.resolve({ studioId }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { instructorUserIds: string[] };
      expect(body.instructorUserIds).toEqual([instructor.id]);
    });

    test("lists locations for an instructor", async () => {
      const { studioId, owner, instructor, location } =
        await createOwnerInstructorAndLocation("get-by-instructor");
      sessionUser.userId = owner.id;
      await POST(makePostRequest(studioId, { instructorUserId: instructor.id, locationId: location.id }), {
        params: Promise.resolve({ studioId }),
      });

      const response = await GET(makeGetRequest(studioId, `?instructorUserId=${instructor.id}`), {
        params: Promise.resolve({ studioId }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { locationIds: string[] };
      expect(body.locationIds).toEqual([location.id]);
    });
  });

  describe("POST", () => {
    test("returns 401 when there is no session", async () => {
      const { studioId, instructor, location } = await createOwnerInstructorAndLocation(
        "post-401"
      );
      sessionUser.userId = "";

      const response = await POST(
        makePostRequest(studioId, { instructorUserId: instructor.id, locationId: location.id }),
        { params: Promise.resolve({ studioId }) }
      );

      expect(response.status).toBe(401);
    });

    test("returns 400 for an invalid body", async () => {
      const { studioId, owner } = await createOwnerInstructorAndLocation("post-400-body");
      sessionUser.userId = owner.id;

      const response = await POST(makePostRequest(studioId, {}), {
        params: Promise.resolve({ studioId }),
      });

      expect(response.status).toBe(400);
    });

    test("returns 403 when the caller lacks locations.manage", async () => {
      const { studioId, instructor, location } = await createOwnerInstructorAndLocation(
        "post-403"
      );
      sessionUser.userId = instructor.id;

      const response = await POST(
        makePostRequest(studioId, { instructorUserId: instructor.id, locationId: location.id }),
        { params: Promise.resolve({ studioId }) }
      );

      expect(response.status).toBe(403);
    });

    test("an Owner can assign an instructor to a location", async () => {
      const { studioId, owner, instructor, location } =
        await createOwnerInstructorAndLocation("post-ok");
      sessionUser.userId = owner.id;

      const response = await POST(
        makePostRequest(studioId, { instructorUserId: instructor.id, locationId: location.id }),
        { params: Promise.resolve({ studioId }) }
      );

      expect(response.status).toBe(201);
    });

    test("returns 404 for a locationId or instructor belonging to a different studio", async () => {
      const victim = await createOwnerInstructorAndLocation("post-404-victim");
      const attacker = await createOwnerInstructorAndLocation("post-404-attacker");
      sessionUser.userId = attacker.owner.id;

      const crossLocation = await POST(
        makePostRequest(attacker.studioId, {
          instructorUserId: attacker.instructor.id,
          locationId: victim.location.id,
        }),
        { params: Promise.resolve({ studioId: attacker.studioId }) }
      );
      expect(crossLocation.status).toBe(404);

      const crossInstructor = await POST(
        makePostRequest(attacker.studioId, {
          instructorUserId: victim.instructor.id,
          locationId: attacker.location.id,
        }),
        { params: Promise.resolve({ studioId: attacker.studioId }) }
      );
      expect(crossInstructor.status).toBe(404);
    });

    test("assigning the same pair twice is still a success, not an error", async () => {
      const { studioId, owner, instructor, location } =
        await createOwnerInstructorAndLocation("post-dup");
      sessionUser.userId = owner.id;

      const first = await POST(
        makePostRequest(studioId, { instructorUserId: instructor.id, locationId: location.id }),
        { params: Promise.resolve({ studioId }) }
      );
      expect(first.status).toBe(201);

      const second = await POST(
        makePostRequest(studioId, { instructorUserId: instructor.id, locationId: location.id }),
        { params: Promise.resolve({ studioId }) }
      );
      expect(second.status).toBe(201);
    });
  });
});
