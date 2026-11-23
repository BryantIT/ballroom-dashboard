// app/api/v1/studios/[studioId]/students/[studentId]/relationships/route.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing/test-database";
import { users, students, roles, memberships } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";

// Only session verification is stubbed; everything below it (permission
// checks, RLS, the query itself) runs against real Postgres.
const sessionUser = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/dal", () => ({
  verifyApiSession: async () => (sessionUser.userId ? { userId: sessionUser.userId } : null),
  verifySession: async () => (sessionUser.userId ? { userId: sessionUser.userId } : null),
}));

describe("/api/v1/studios/{studioId}/students/{studentId}/relationships", () => {
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

  function makeGetRequest(studioId: string, studentId: string) {
    return new Request(
      `http://localhost/api/v1/studios/${studioId}/students/${studentId}/relationships`
    );
  }

  function makePostRequest(studioId: string, studentId: string, body: unknown) {
    return new Request(
      `http://localhost/api/v1/studios/${studioId}/students/${studentId}/relationships`,
      { method: "POST", body: JSON.stringify(body) }
    );
  }

  async function createOwnerAndStudents(emailSuffix: string) {
    const db = drizzle(pool, { schema });
    const [owner] = await db
      .insert(users)
      .values({ email: `owner-rel-${emailSuffix}@example.com` })
      .returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const { studentA, studentB } = await withTenantContext(
      { userId: owner.id, tenantId: studioId },
      async (tx) => {
        const [studentA] = await tx
          .insert(students)
          .values({ studioId, displayName: "Alex" })
          .returning();
        const [studentB] = await tx
          .insert(students)
          .values({ studioId, displayName: "Blair" })
          .returning();
        return { studentA, studentB };
      },
      db
    );
    return { db, owner, studioId, studentA, studentB };
  }

  describe("GET", () => {
    test("returns 401 when there is no session", async () => {
      const { studioId, studentA } = await createOwnerAndStudents("get-401");
      sessionUser.userId = "";

      const response = await GET(makeGetRequest(studioId, studentA.id), {
        params: Promise.resolve({ studioId, studentId: studentA.id }),
      });

      expect(response.status).toBe(401);
    });

    test("returns 400 for an invalid studentId", async () => {
      const { studioId, owner } = await createOwnerAndStudents("get-400");
      sessionUser.userId = owner.id;

      const response = await GET(makeGetRequest(studioId, "not-a-uuid"), {
        params: Promise.resolve({ studioId, studentId: "not-a-uuid" }),
      });

      expect(response.status).toBe(400);
    });

    test("returns 403 when the caller lacks students.read", async () => {
      const { db, studioId, studentA } = await createOwnerAndStudents("get-403");
      const [outsider] = await db
        .insert(users)
        .values({ email: "outsider-rel-get@example.com" })
        .returning();
      sessionUser.userId = outsider.id;

      const response = await GET(makeGetRequest(studioId, studentA.id), {
        params: Promise.resolve({ studioId, studentId: studentA.id }),
      });

      expect(response.status).toBe(403);
    });

    test("returns the linked student's display info", async () => {
      const { db, owner, studioId, studentA, studentB } = await createOwnerAndStudents("get-ok");
      sessionUser.userId = owner.id;
      await withTenantContext(
        { userId: owner.id, tenantId: studioId },
        (tx) =>
          tx.insert(schema.studentRelationships).values({
            studioId,
            studentAId: studentA.id,
            studentBId: studentB.id,
          }),
        db
      );

      const response = await GET(makeGetRequest(studioId, studentA.id), {
        params: Promise.resolve({ studioId, studentId: studentA.id }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        relationships: { id: string; displayName: string }[];
      };
      expect(body.relationships).toHaveLength(1);
      expect(body.relationships[0].id).toBe(studentB.id);
      expect(body.relationships[0].displayName).toBe("Blair");
    });
  });

  describe("POST", () => {
    test("returns 401 when there is no session", async () => {
      const { studioId, studentA, studentB } = await createOwnerAndStudents("post-401");
      sessionUser.userId = "";

      const response = await POST(
        makePostRequest(studioId, studentA.id, { studentBId: studentB.id }),
        { params: Promise.resolve({ studioId, studentId: studentA.id }) }
      );

      expect(response.status).toBe(401);
    });

    test("returns 400 for an invalid studentId path param", async () => {
      const { studioId, owner, studentB } = await createOwnerAndStudents("post-400-path");
      sessionUser.userId = owner.id;

      const response = await POST(
        makePostRequest(studioId, "not-a-uuid", { studentBId: studentB.id }),
        { params: Promise.resolve({ studioId, studentId: "not-a-uuid" }) }
      );

      expect(response.status).toBe(400);
    });

    test("returns 400 for an invalid body", async () => {
      const { studioId, owner, studentA } = await createOwnerAndStudents("post-400-body");
      sessionUser.userId = owner.id;

      const response = await POST(makePostRequest(studioId, studentA.id, {}), {
        params: Promise.resolve({ studioId, studentId: studentA.id }),
      });

      expect(response.status).toBe(400);
    });

    test("returns 403 when the caller lacks students.update_all", async () => {
      const { db, owner, studioId, studentA, studentB } = await createOwnerAndStudents(
        "post-403"
      );
      const [instructor] = await db
        .insert(users)
        .values({ email: "instructor-rel-post@example.com" })
        .returning();
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
      sessionUser.userId = instructor.id;

      const response = await POST(
        makePostRequest(studioId, studentA.id, { studentBId: studentB.id }),
        { params: Promise.resolve({ studioId, studentId: studentA.id }) }
      );

      expect(response.status).toBe(403);
    });

    test("returns 400 when linking a student to themselves", async () => {
      const { studioId, owner, studentA } = await createOwnerAndStudents("post-self");
      sessionUser.userId = owner.id;

      const response = await POST(
        makePostRequest(studioId, studentA.id, { studentBId: studentA.id }),
        { params: Promise.resolve({ studioId, studentId: studentA.id }) }
      );

      expect(response.status).toBe(400);
    });

    test("returns 409 when the pair is already linked", async () => {
      const { studioId, owner, studentA, studentB } = await createOwnerAndStudents("post-dup");
      sessionUser.userId = owner.id;

      const first = await POST(
        makePostRequest(studioId, studentA.id, { studentBId: studentB.id }),
        { params: Promise.resolve({ studioId, studentId: studentA.id }) }
      );
      expect(first.status).toBe(201);

      const second = await POST(
        makePostRequest(studioId, studentB.id, { studentBId: studentA.id }),
        { params: Promise.resolve({ studioId, studentId: studentB.id }) }
      );

      expect(second.status).toBe(409);
    });

    test("an Owner can link two students", async () => {
      const { studioId, owner, studentA, studentB } = await createOwnerAndStudents("post-ok");
      sessionUser.userId = owner.id;

      const response = await POST(
        makePostRequest(studioId, studentA.id, { studentBId: studentB.id }),
        { params: Promise.resolve({ studioId, studentId: studentA.id }) }
      );

      expect(response.status).toBe(201);
      const body = (await response.json()) as { id: string };
      expect(body.id).toBeTruthy();
    });
  });
});
