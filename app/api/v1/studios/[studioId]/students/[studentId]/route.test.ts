// app/api/v1/studios/[studioId]/students/[studentId]/route.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing/test-database";
import { users, students } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";

// Only session verification is stubbed; everything below it (permission
// checks, RLS, the query itself) runs against real Postgres.
const sessionUser = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/dal", () => ({
  verifyApiSession: async () => (sessionUser.userId ? { userId: sessionUser.userId } : null),
  verifySession: async () => (sessionUser.userId ? { userId: sessionUser.userId } : null),
}));

describe("PATCH /api/v1/studios/{studioId}/students/{studentId}", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let PATCH: typeof import("./route").PATCH;
  let provisionStudio: typeof import("@/lib/studios/provision").provisionStudio;
  let withTenantContext: typeof import("@/lib/db/with-tenant-context").withTenantContext;
  let appDb: typeof import("@/lib/db/client").db;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    // The route uses the default db client, which reads this at import time.
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ PATCH } = await import("./route"));
    ({ provisionStudio } = await import("@/lib/studios/provision"));
    ({ withTenantContext } = await import("@/lib/db/with-tenant-context"));
    ({ db: appDb } = await import("@/lib/db/client"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await appDb.$client.end();
    await testDb.stop();
  });

  function makeRequest(studioId: string, studentId: string, body: unknown) {
    return new Request(`http://localhost/api/v1/studios/${studioId}/students/${studentId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  async function createOwnerAndStudent(emailSuffix: string) {
    const db = drizzle(pool, { schema });
    const [owner] = await db
      .insert(users)
      .values({ email: `owner-${emailSuffix}@example.com` })
      .returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const [student] = await withTenantContext(
      { userId: owner.id, tenantId: studioId },
      (tx) =>
        tx
          .insert(students)
          .values({ studioId, displayName: "Original Name" })
          .returning(),
      db
    );
    return { db, owner, studioId, student };
  }

  test("returns 401 when there is no session", async () => {
    const { studioId, student } = await createOwnerAndStudent("401");
    sessionUser.userId = "";

    const response = await PATCH(makeRequest(studioId, student.id, { displayName: "New" }), {
      params: Promise.resolve({ studioId, studentId: student.id }),
    });

    expect(response.status).toBe(401);
  });

  test("returns 400 for an invalid studentId", async () => {
    const { studioId, owner } = await createOwnerAndStudent("400");
    sessionUser.userId = owner.id;

    const response = await PATCH(makeRequest(studioId, "not-a-uuid", { displayName: "New" }), {
      params: Promise.resolve({ studioId, studentId: "not-a-uuid" }),
    });

    expect(response.status).toBe(400);
  });

  test("returns 400 for an invalid body", async () => {
    const { studioId, owner, student } = await createOwnerAndStudent("400-body");
    sessionUser.userId = owner.id;

    const response = await PATCH(makeRequest(studioId, student.id, { email: "not-an-email" }), {
      params: Promise.resolve({ studioId, studentId: student.id }),
    });

    expect(response.status).toBe(400);
  });

  test("returns 400 for an empty body instead of throwing", async () => {
    const { studioId, owner, student } = await createOwnerAndStudent("400-empty");
    sessionUser.userId = owner.id;

    const response = await PATCH(makeRequest(studioId, student.id, {}), {
      params: Promise.resolve({ studioId, studentId: student.id }),
    });

    expect(response.status).toBe(400);
  });

  test("returns 403 when the caller cannot edit the student", async () => {
    const { studioId, student } = await createOwnerAndStudent("403");
    const db = drizzle(pool, { schema });
    const [outsider] = await db.insert(users).values({ email: "outsider-patch@example.com" }).returning();
    sessionUser.userId = outsider.id;

    const response = await PATCH(makeRequest(studioId, student.id, { displayName: "New" }), {
      params: Promise.resolve({ studioId, studentId: student.id }),
    });

    expect(response.status).toBe(403);
  });

  test("a partial update with only email leaves displayName unchanged", async () => {
    const { studioId, owner, student } = await createOwnerAndStudent("partial");
    sessionUser.userId = owner.id;

    const response = await PATCH(
      makeRequest(studioId, student.id, { email: "a@b.com" }),
      { params: Promise.resolve({ studioId, studentId: student.id }) }
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { displayName: string; email: string | null };
    expect(body.displayName).toBe("Original Name");
    expect(body.email).toBe("a@b.com");
  });

  test("updates displayName, email, and phone together", async () => {
    const { studioId, owner, student } = await createOwnerAndStudent("full");
    sessionUser.userId = owner.id;

    const response = await PATCH(
      makeRequest(studioId, student.id, {
        displayName: "Updated Name",
        email: "updated@example.com",
        phone: "555-0199",
      }),
      { params: Promise.resolve({ studioId, studentId: student.id }) }
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      displayName: string;
      email: string | null;
      phone: string | null;
    };
    expect(body.displayName).toBe("Updated Name");
    expect(body.email).toBe("updated@example.com");
    expect(body.phone).toBe("555-0199");
  });
});
