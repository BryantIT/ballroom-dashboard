// app/api/v1/studios/[studioId]/students/route.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing/test-database";
import { users } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";

// Only session verification is stubbed; everything below it (permission
// checks, RLS, the query itself) runs against real Postgres.
const sessionUser = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/dal", () => ({
  verifyApiSession: async () => (sessionUser.userId ? { userId: sessionUser.userId } : null),
  verifySession: async () => (sessionUser.userId ? { userId: sessionUser.userId } : null),
}));

describe("POST /api/v1/studios/{studioId}/students", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let POST: typeof import("./route").POST;
  let provisionStudio: typeof import("@/lib/studios/provision").provisionStudio;
  let appDb: typeof import("@/lib/db/client").db;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    // The route uses the default db client, which reads this at import time.
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ POST } = await import("./route"));
    ({ provisionStudio } = await import("@/lib/studios/provision"));
    ({ db: appDb } = await import("@/lib/db/client"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await appDb.$client.end();
    await testDb.stop();
  });

  function makeRequest(studioId: string, body: unknown) {
    return new Request(`http://localhost/api/v1/studios/${studioId}/students`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  test("returns 401 when there is no session", async () => {
    sessionUser.userId = "";
    const db = drizzle(pool, { schema });
    const [owner] = await db.insert(users).values({ email: "no-session@example.com" }).returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );

    const response = await POST(makeRequest(studioId, { displayName: "Alex" }), {
      params: Promise.resolve({ studioId }),
    });

    expect(response.status).toBe(401);
  });

  test("returns 400 for an invalid studioId", async () => {
    sessionUser.userId = "irrelevant";
    const response = await POST(makeRequest("not-a-uuid", { displayName: "Alex" }), {
      params: Promise.resolve({ studioId: "not-a-uuid" }),
    });

    expect(response.status).toBe(400);
  });

  test("returns 400 for an invalid body", async () => {
    const db = drizzle(pool, { schema });
    const [owner] = await db.insert(users).values({ email: "bad-body@example.com" }).returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    sessionUser.userId = owner.id;

    const response = await POST(makeRequest(studioId, { displayName: "" }), {
      params: Promise.resolve({ studioId }),
    });

    expect(response.status).toBe(400);
  });

  test("returns 403 when the caller lacks students.create", async () => {
    const db = drizzle(pool, { schema });
    const [owner] = await db.insert(users).values({ email: "owner-403@example.com" }).returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const [outsider] = await db.insert(users).values({ email: "outsider@example.com" }).returning();
    sessionUser.userId = outsider.id;

    const response = await POST(makeRequest(studioId, { displayName: "Alex" }), {
      params: Promise.resolve({ studioId }),
    });

    expect(response.status).toBe(403);
  });

  test("an Owner can create a student, with the path's studioId, not the body's", async () => {
    const db = drizzle(pool, { schema });
    const [owner] = await db.insert(users).values({ email: "owner-create@example.com" }).returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const { studioId: otherStudioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Other Studio", timezone: "America/Chicago" },
      db
    );
    sessionUser.userId = owner.id;

    const response = await POST(
      makeRequest(studioId, {
        displayName: "Alex Example",
        email: "alex@example.com",
        phone: "555-0100",
        // Not a field on createStudentSchema — must be ignored, not used
        // to redirect the insert to another tenant.
        studioId: otherStudioId,
      }),
      { params: Promise.resolve({ studioId }) }
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      studioId: string;
      displayName: string;
      email: string | null;
      phone: string | null;
    };
    expect(body.studioId).toBe(studioId);
    expect(body.displayName).toBe("Alex Example");
    expect(body.email).toBe("alex@example.com");
    expect(body.phone).toBe("555-0100");
  });
});
