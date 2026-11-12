// app/api/v1/studios/[studioId]/branding/route.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing/test-database";
import { users, roles, memberships } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";

// Only session verification is stubbed; everything below it (permission
// checks, RLS, the query itself) runs against real Postgres. A falsy
// sessionUser.userId simulates "no session" so the 401 path can be tested.
const sessionUser = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/dal", () => ({
  verifyApiSession: async () => (sessionUser.userId ? { userId: sessionUser.userId } : null),
  verifySession: async () => (sessionUser.userId ? { userId: sessionUser.userId } : null),
}));

describe("/api/v1/studios/{studioId}/branding", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let GET: typeof import("./route").GET;
  let PATCH: typeof import("./route").PATCH;
  let provisionStudio: typeof import("@/lib/studios/provision").provisionStudio;
  let withTenantContext: typeof import("@/lib/db/with-tenant-context").withTenantContext;
  let appDb: typeof import("@/lib/db/client").db;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    // The route uses the default db client, which reads this at import time.
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ GET, PATCH } = await import("./route"));
    ({ provisionStudio } = await import("@/lib/studios/provision"));
    ({ withTenantContext } = await import("@/lib/db/with-tenant-context"));
    ({ db: appDb } = await import("@/lib/db/client"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await appDb.$client.end();
    await testDb.stop();
  });

  async function provisionWithInstructor(studioName: string) {
    const db = drizzle(pool, { schema });
    const [owner] = await db
      .insert(users)
      .values({ email: `owner-${crypto.randomUUID()}@example.com` })
      .returning();
    const [instructor] = await db
      .insert(users)
      .values({ email: `instructor-${crypto.randomUUID()}@example.com` })
      .returning();

    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName, timezone: "America/Chicago" },
      db
    );

    await withTenantContext(
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
      },
      db
    );

    return { ownerId: owner.id, instructorId: instructor.id, studioId };
  }

  function req(studioId: string, init?: RequestInit) {
    return new Request(`http://localhost/api/v1/studios/${studioId}/branding`, init);
  }

  function params(studioId: string) {
    return { params: Promise.resolve({ studioId }) };
  }

  test("GET with no session returns 401", async () => {
    sessionUser.userId = "";
    const { studioId } = await provisionWithInstructor("No Session Studio");

    const response = await GET(req(studioId), params(studioId));

    expect(response.status).toBe(401);
  });

  test("GET with an invalid studioId path segment returns 400", async () => {
    const { ownerId } = await provisionWithInstructor("Bad Id Studio");
    sessionUser.userId = ownerId;

    const response = await GET(req("not-a-uuid"), params("not-a-uuid"));

    expect(response.status).toBe(400);
  });

  test("GET with a well-formed but unknown studioId returns 404, not 500", async () => {
    const { ownerId } = await provisionWithInstructor("Unknown Studio Reader");
    sessionUser.userId = ownerId;
    const unknownStudioId = crypto.randomUUID();

    const response = await GET(req(unknownStudioId), params(unknownStudioId));

    expect(response.status).toBe(404);
  });

  test("GET as the owner returns 200 with the branding shape", async () => {
    const { ownerId, studioId } = await provisionWithInstructor("Owner Read Studio");
    sessionUser.userId = ownerId;

    const response = await GET(req(studioId), params(studioId));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      studioId,
      studioName: "Owner Read Studio",
      themePreset: "midnight",
      colorMode: "system",
    });
  });

  test("PATCH as an Instructor membership returns 403", async () => {
    const { instructorId, studioId } = await provisionWithInstructor("Forbidden Patch Studio");
    sessionUser.userId = instructorId;

    const response = await PATCH(
      req(studioId, { method: "PATCH", body: JSON.stringify({ themePreset: "noir" }) }),
      params(studioId)
    );

    expect(response.status).toBe(403);
  });

  test("PATCH as the owner updates themePreset, and a follow-up GET reflects it", async () => {
    const { ownerId, studioId } = await provisionWithInstructor("Patch Studio");
    sessionUser.userId = ownerId;

    const patchResponse = await PATCH(
      req(studioId, { method: "PATCH", body: JSON.stringify({ themePreset: "noir" }) }),
      params(studioId)
    );
    expect(patchResponse.status).toBe(200);
    const patchBody = await patchResponse.json();
    expect(patchBody.themePreset).toBe("noir");

    const getResponse = await GET(req(studioId), params(studioId));
    const getBody = await getResponse.json();
    expect(getBody.themePreset).toBe("noir");
  });

  test("PATCH with an invalid body returns 400", async () => {
    const { ownerId, studioId } = await provisionWithInstructor("Invalid Body Studio");
    sessionUser.userId = ownerId;

    const response = await PATCH(
      req(studioId, { method: "PATCH", body: JSON.stringify({ themePreset: "not-a-preset" }) }),
      params(studioId)
    );

    expect(response.status).toBe(400);
  });

  test("PATCH with a slug already used by another studio returns 409", async () => {
    const { ownerId, studioId } = await provisionWithInstructor("Slug Conflict Studio A");
    const other = await provisionWithInstructor("Slug Conflict Studio B");
    sessionUser.userId = ownerId;

    const otherGet = await GET(req(other.studioId), params(other.studioId));
    const otherBody = await otherGet.json();

    const response = await PATCH(
      req(studioId, { method: "PATCH", body: JSON.stringify({ slug: otherBody.slug }) }),
      params(studioId)
    );

    expect(response.status).toBe(409);
  });
});
