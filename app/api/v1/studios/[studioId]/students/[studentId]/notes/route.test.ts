// app/api/v1/studios/[studioId]/students/[studentId]/notes/route.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing/test-database";
import { users, students, studentAssignments, roles, memberships } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";

// Only session verification is stubbed; everything below it (permission
// checks, RLS, the query itself) runs against real Postgres.
const sessionUser = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/dal", () => ({
  verifyApiSession: async () => (sessionUser.userId ? { userId: sessionUser.userId } : null),
  verifySession: async () => (sessionUser.userId ? { userId: sessionUser.userId } : null),
}));

describe("/api/v1/studios/{studioId}/students/{studentId}/notes", () => {
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
      `http://localhost/api/v1/studios/${studioId}/students/${studentId}/notes`
    );
  }

  function makePostRequest(studioId: string, studentId: string, body: unknown) {
    return new Request(
      `http://localhost/api/v1/studios/${studioId}/students/${studentId}/notes`,
      { method: "POST", body: JSON.stringify(body) }
    );
  }

  async function createOwnerAndStudent(emailSuffix: string) {
    const db = drizzle(pool, { schema });
    const [owner] = await db
      .insert(users)
      .values({ email: `owner-notes-route-${emailSuffix}@example.com` })
      .returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const [student] = await withTenantContext(
      { userId: owner.id, tenantId: studioId },
      (tx) => tx.insert(students).values({ studioId, displayName: "Alex" }).returning(),
      db
    );
    return { db, owner, studioId, student };
  }

  async function addInstructor(
    db: ReturnType<typeof drizzle<typeof schema>>,
    ownerId: string,
    studioId: string,
    emailSuffix: string
  ) {
    const [instructor] = await db
      .insert(users)
      .values({ email: `instructor-notes-route-${emailSuffix}@example.com` })
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

  async function assignInstructor(
    db: ReturnType<typeof drizzle<typeof schema>>,
    ownerId: string,
    studioId: string,
    studentId: string,
    instructorUserId: string,
    options: { isPrimary?: boolean } = {}
  ) {
    // student_assignments has a partial unique index allowing at most one
    // current (is_primary AND ended_at IS NULL) row per student, so a
    // second active assignment on the same student must pass
    // isPrimary: false.
    await withTenantContext(
      { userId: ownerId, tenantId: studioId },
      (tx) =>
        tx.insert(studentAssignments).values({
          studentId,
          studioId,
          instructorUserId,
          isPrimary: options.isPrimary ?? true,
        }),
      db
    );
  }

  describe("GET", () => {
    test("returns 401 when there is no session", async () => {
      const { studioId, student } = await createOwnerAndStudent("get-401");
      sessionUser.userId = "";

      const response = await GET(makeGetRequest(studioId, student.id), {
        params: Promise.resolve({ studioId, studentId: student.id }),
      });

      expect(response.status).toBe(401);
    });

    test("returns 400 for an invalid studentId", async () => {
      const { studioId, owner } = await createOwnerAndStudent("get-400");
      sessionUser.userId = owner.id;

      const response = await GET(makeGetRequest(studioId, "not-a-uuid"), {
        params: Promise.resolve({ studioId, studentId: "not-a-uuid" }),
      });

      expect(response.status).toBe(400);
    });

    test("returns 400 for an invalid studioId", async () => {
      const { student } = await createOwnerAndStudent("get-400-studio");
      sessionUser.userId = "someone";

      const response = await GET(makeGetRequest("not-a-uuid", student.id), {
        params: Promise.resolve({ studioId: "not-a-uuid", studentId: student.id }),
      });

      expect(response.status).toBe(400);
    });

    test("filters out a restricted note for an assigned instructor who didn't write it", async () => {
      const { db, owner, studioId, student } = await createOwnerAndStudent("get-filter");
      const author = await addInstructor(db, owner.id, studioId, "get-filter-author");
      const reader = await addInstructor(db, owner.id, studioId, "get-filter-reader");
      await assignInstructor(db, owner.id, studioId, student.id, author.id);
      await assignInstructor(db, owner.id, studioId, student.id, reader.id, {
        isPrimary: false,
      });

      sessionUser.userId = author.id;
      const createResponse = await POST(
        makePostRequest(studioId, student.id, { body: "Restricted note", restricted: true }),
        { params: Promise.resolve({ studioId, studentId: student.id }) }
      );
      expect(createResponse.status).toBe(201);

      sessionUser.userId = reader.id;
      const response = await GET(makeGetRequest(studioId, student.id), {
        params: Promise.resolve({ studioId, studentId: student.id }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { notes: { body: string }[] };
      expect(body.notes).toHaveLength(0);
    });

    test("an Owner sees every note, restricted or not", async () => {
      const { db, owner, studioId, student } = await createOwnerAndStudent("get-owner");
      const author = await addInstructor(db, owner.id, studioId, "get-owner-author");
      await assignInstructor(db, owner.id, studioId, student.id, author.id);

      sessionUser.userId = author.id;
      await POST(
        makePostRequest(studioId, student.id, { body: "Restricted note", restricted: true }),
        { params: Promise.resolve({ studioId, studentId: student.id }) }
      );

      sessionUser.userId = owner.id;
      const response = await GET(makeGetRequest(studioId, student.id), {
        params: Promise.resolve({ studioId, studentId: student.id }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { notes: { body: string }[] };
      expect(body.notes).toHaveLength(1);
    });
  });

  describe("POST", () => {
    test("returns 401 when there is no session", async () => {
      const { studioId, student } = await createOwnerAndStudent("post-401");
      sessionUser.userId = "";

      const response = await POST(
        makePostRequest(studioId, student.id, { body: "Hi" }),
        { params: Promise.resolve({ studioId, studentId: student.id }) }
      );

      expect(response.status).toBe(401);
    });

    test("returns 400 for an invalid studentId path param", async () => {
      const { studioId, owner } = await createOwnerAndStudent("post-400-path");
      sessionUser.userId = owner.id;

      const response = await POST(
        makePostRequest(studioId, "not-a-uuid", { body: "Hi" }),
        { params: Promise.resolve({ studioId, studentId: "not-a-uuid" }) }
      );

      expect(response.status).toBe(400);
    });

    test("returns 400 for an invalid body", async () => {
      const { studioId, owner, student } = await createOwnerAndStudent("post-400-body");
      sessionUser.userId = owner.id;

      const response = await POST(makePostRequest(studioId, student.id, {}), {
        params: Promise.resolve({ studioId, studentId: student.id }),
      });

      expect(response.status).toBe(400);
    });

    test("returns 403 when an unassigned instructor tries to write a note", async () => {
      const { db, owner, studioId, student } = await createOwnerAndStudent("post-403");
      const instructor = await addInstructor(db, owner.id, studioId, "post-403");
      sessionUser.userId = instructor.id;

      const response = await POST(
        makePostRequest(studioId, student.id, { body: "Hi" }),
        { params: Promise.resolve({ studioId, studentId: student.id }) }
      );

      expect(response.status).toBe(403);
    });

    test("an assigned instructor can create a note", async () => {
      const { db, owner, studioId, student } = await createOwnerAndStudent("post-ok");
      const instructor = await addInstructor(db, owner.id, studioId, "post-ok");
      await assignInstructor(db, owner.id, studioId, student.id, instructor.id);
      sessionUser.userId = instructor.id;

      const response = await POST(
        makePostRequest(studioId, student.id, { body: "Great lesson today", restricted: false }),
        { params: Promise.resolve({ studioId, studentId: student.id }) }
      );

      expect(response.status).toBe(201);
      const body = (await response.json()) as { id: string; body: string };
      expect(body.id).toBeTruthy();
      expect(body.body).toBe("Great lesson today");
    });
  });
});
