// app/api/v1/studios/[studioId]/instructor-blocks/route.test.ts
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

describe("/api/v1/studios/{studioId}/instructor-blocks", () => {
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
    return new Request(`http://localhost/api/v1/studios/${studioId}/instructor-blocks${query}`);
  }

  function makePostRequest(studioId: string, body: unknown) {
    return new Request(`http://localhost/api/v1/studios/${studioId}/instructor-blocks`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async function createOwnerAndInstructor(emailSuffix: string) {
    const db = drizzle(pool, { schema });
    const [owner] = await db
      .insert(users)
      .values({ email: `owner-ib-route-${emailSuffix}@example.com` })
      .returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const [instructor] = await db
      .insert(users)
      .values({ email: `instructor-ib-route-${emailSuffix}@example.com` })
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
      const { studioId } = await createOwnerAndInstructor("get-401");
      sessionUser.userId = "";

      const response = await GET(
        makeGetRequest(studioId, "?startAt=2024-01-01T00:00:00Z&endAt=2024-02-01T00:00:00Z"),
        { params: Promise.resolve({ studioId }) }
      );

      expect(response.status).toBe(401);
    });

    test("returns 400 for an invalid studioId", async () => {
      const { owner } = await createOwnerAndInstructor("get-400-studio");
      sessionUser.userId = owner.id;

      const response = await GET(
        makeGetRequest("not-a-uuid", "?startAt=2024-01-01T00:00:00Z&endAt=2024-02-01T00:00:00Z"),
        { params: Promise.resolve({ studioId: "not-a-uuid" }) }
      );

      expect(response.status).toBe(400);
    });

    test("returns 400 when startAt/endAt are missing or invalid", async () => {
      const { studioId, owner } = await createOwnerAndInstructor("get-400-range");
      sessionUser.userId = owner.id;

      const response = await GET(makeGetRequest(studioId, ""), {
        params: Promise.resolve({ studioId }),
      });

      expect(response.status).toBe(400);
    });

    test("returns 403 when the caller lacks appointments.read_all", async () => {
      const { studioId, db } = await createOwnerAndInstructor("get-403");
      const [outsider] = await db
        .insert(users)
        .values({ email: "outsider-ib-get@example.com" })
        .returning();
      sessionUser.userId = outsider.id;

      const response = await GET(
        makeGetRequest(studioId, "?startAt=2024-01-01T00:00:00Z&endAt=2024-02-01T00:00:00Z"),
        { params: Promise.resolve({ studioId }) }
      );

      expect(response.status).toBe(403);
    });

    test("lists blocks in range, redacting labels for a viewer without appointments.manage_all", async () => {
      const { studioId, owner, instructor } = await createOwnerAndInstructor("get-list");
      sessionUser.userId = instructor.id;
      await POST(
        makePostRequest(studioId, {
          kind: "personal_time_off",
          instructorUserId: instructor.id,
          startAt: "2024-01-10T18:00:00Z",
          endAt: "2024-01-10T20:00:00Z",
          label: "Dentist",
        }),
        { params: Promise.resolve({ studioId }) }
      );

      // A second instructor (with no permission beyond membership) can see
      // the slot is blocked but never the first instructor's label.
      const [otherInstructor] = await (
        await import("@/lib/db/client")
      ).db
        .insert(users)
        .values({ email: "other-instructor-ib-get@example.com" })
        .returning();
      await withTenantContext({ userId: owner.id, tenantId: studioId }, async (tx) => {
        const [instructorRole] = await tx
          .select()
          .from(roles)
          .where(and(eq(roles.studioId, studioId), eq(roles.code, "instructor")));
        await tx.insert(memberships).values({
          studioId,
          userId: otherInstructor.id,
          roleId: instructorRole.id,
          status: "active",
        });
      });
      sessionUser.userId = otherInstructor.id;

      const response = await GET(
        makeGetRequest(studioId, "?startAt=2024-01-01T00:00:00Z&endAt=2024-02-01T00:00:00Z"),
        { params: Promise.resolve({ studioId }) }
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as { blocks: { label: string | null }[] };
      expect(body.blocks).toHaveLength(1);
      expect(body.blocks[0].label).toBeNull();
    });

    test("an Owner (appointments.manage_all) sees every label", async () => {
      const { studioId, owner, instructor } = await createOwnerAndInstructor("get-owner-label");
      sessionUser.userId = instructor.id;
      await POST(
        makePostRequest(studioId, {
          kind: "personal_time_off",
          instructorUserId: instructor.id,
          startAt: "2024-01-10T18:00:00Z",
          endAt: "2024-01-10T20:00:00Z",
          label: "Dentist",
        }),
        { params: Promise.resolve({ studioId }) }
      );
      sessionUser.userId = owner.id;

      const response = await GET(
        makeGetRequest(studioId, "?startAt=2024-01-01T00:00:00Z&endAt=2024-02-01T00:00:00Z"),
        { params: Promise.resolve({ studioId }) }
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as { blocks: { label: string | null }[] };
      expect(body.blocks[0].label).toBe("Dentist");
    });
  });

  describe("POST", () => {
    test("returns 401 when there is no session", async () => {
      const { studioId, instructor } = await createOwnerAndInstructor("post-401");
      sessionUser.userId = "";

      const response = await POST(
        makePostRequest(studioId, {
          kind: "personal_time_off",
          instructorUserId: instructor.id,
          startAt: "2024-01-10T18:00:00Z",
          endAt: "2024-01-10T20:00:00Z",
        }),
        { params: Promise.resolve({ studioId }) }
      );

      expect(response.status).toBe(401);
    });

    test("returns 400 for an invalid body", async () => {
      const { studioId, owner } = await createOwnerAndInstructor("post-400-body");
      sessionUser.userId = owner.id;

      const response = await POST(makePostRequest(studioId, { kind: "nonsense" }), {
        params: Promise.resolve({ studioId }),
      });

      expect(response.status).toBe(400);
    });

    test("returns 400 for a regular_day_off payload that also includes startAt/endAt", async () => {
      const { studioId, instructor } = await createOwnerAndInstructor("post-400-mixed");
      sessionUser.userId = instructor.id;

      const response = await POST(
        makePostRequest(studioId, {
          kind: "regular_day_off",
          instructorUserId: instructor.id,
          dayOfWeek: 1,
          startTime: "09:00",
          endTime: "17:00",
          startAt: "2024-01-10T18:00:00Z",
          endAt: "2024-01-10T20:00:00Z",
        }),
        { params: Promise.resolve({ studioId }) }
      );

      expect(response.status).toBe(400);
    });

    test("returns 403 when an instructor tries to create a studio_holiday", async () => {
      const { studioId, instructor } = await createOwnerAndInstructor("post-403-holiday");
      sessionUser.userId = instructor.id;

      const response = await POST(
        makePostRequest(studioId, {
          kind: "studio_holiday",
          startAt: "2024-12-25T00:00:00Z",
          endAt: "2024-12-26T00:00:00Z",
        }),
        { params: Promise.resolve({ studioId }) }
      );

      expect(response.status).toBe(403);
    });

    test("an instructor can create their own regular_day_off", async () => {
      const { studioId, instructor } = await createOwnerAndInstructor("post-ok-self");
      sessionUser.userId = instructor.id;

      const response = await POST(
        makePostRequest(studioId, {
          kind: "regular_day_off",
          instructorUserId: instructor.id,
          dayOfWeek: 1,
          startTime: "09:00",
          endTime: "17:00",
        }),
        { params: Promise.resolve({ studioId }) }
      );

      expect(response.status).toBe(201);
    });

    test("an Owner can create a studio_holiday", async () => {
      const { studioId, owner } = await createOwnerAndInstructor("post-ok-holiday");
      sessionUser.userId = owner.id;

      const response = await POST(
        makePostRequest(studioId, {
          kind: "studio_holiday",
          startAt: "2024-12-25T00:00:00Z",
          endAt: "2024-12-26T00:00:00Z",
          label: "Christmas",
        }),
        { params: Promise.resolve({ studioId }) }
      );

      expect(response.status).toBe(201);
    });
  });
});
