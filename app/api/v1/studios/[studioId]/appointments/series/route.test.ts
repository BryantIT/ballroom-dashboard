// app/api/v1/studios/[studioId]/appointments/series/route.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing/test-database";
import { users, locations, rooms, roles, memberships, students } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";

const sessionUser = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/dal", () => ({
  verifyApiSession: async () => (sessionUser.userId ? { userId: sessionUser.userId } : null),
  verifySession: async () => (sessionUser.userId ? { userId: sessionUser.userId } : null),
}));

describe("/api/v1/studios/{studioId}/appointments/series", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let POST: typeof import("./route").POST;
  let provisionStudio: typeof import("@/lib/studios/provision").provisionStudio;
  let withTenantContext: typeof import("@/lib/db/with-tenant-context").withTenantContext;
  let appDb: typeof import("@/lib/db/client").db;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ POST } = await import("./route"));
    ({ provisionStudio } = await import("@/lib/studios/provision"));
    ({ withTenantContext } = await import("@/lib/db/with-tenant-context"));
    ({ db: appDb } = await import("@/lib/db/client"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await appDb.$client.end();
    await testDb.stop();
  });

  function makePostRequest(studioId: string, body: unknown) {
    return new Request(`http://localhost/api/v1/studios/${studioId}/appointments/series`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async function createFixture(emailSuffix: string) {
    const db = drizzle(pool, { schema });
    const [owner] = await db
      .insert(users)
      .values({ email: `owner-appt-series-${emailSuffix}@example.com` })
      .returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const [instructor1] = await db
      .insert(users)
      .values({ email: `instructor1-appt-series-${emailSuffix}@example.com` })
      .returning();
    const [instructor2] = await db
      .insert(users)
      .values({ email: `instructor2-appt-series-${emailSuffix}@example.com` })
      .returning();

    const { locationA, roomA } = await withTenantContext(
      { userId: owner.id, tenantId: studioId },
      async (tx) => {
        const [instructorRole] = await tx
          .select()
          .from(roles)
          .where(and(eq(roles.studioId, studioId), eq(roles.code, "instructor")));
        await tx.insert(memberships).values([
          { studioId, userId: instructor1.id, roleId: instructorRole.id, status: "active" },
          { studioId, userId: instructor2.id, roleId: instructorRole.id, status: "active" },
        ]);

        const [locationA] = await tx
          .insert(locations)
          .values({ studioId, name: "Location A", timezone: "America/Chicago" })
          .returning();
        const [roomA] = await tx
          .insert(rooms)
          .values({ studioId, locationId: locationA.id, name: "Room A" })
          .returning();

        return { locationA, roomA };
      },
      db
    );

    return { db, owner, instructor1, instructor2, studioId, locationA, roomA };
  }

  async function insertStudent(
    db: ReturnType<typeof drizzle<typeof schema>>,
    studioId: string,
    ownerId: string,
    displayName: string
  ) {
    const [student] = await withTenantContext(
      { userId: ownerId, tenantId: studioId },
      (tx) => tx.insert(students).values({ studioId, displayName }).returning(),
      db
    );
    return student;
  }

  test("returns 401 when there is no session", async () => {
    const { studioId, instructor1, locationA, roomA } = await createFixture("401");
    sessionUser.userId = "";

    const response = await POST(
      makePostRequest(studioId, {
        instructorUserId: instructor1.id,
        locationId: locationA.id,
        roomId: roomA.id,
        attendeeStudentIds: ["00000000-0000-0000-0000-000000000000"],
        dayOfWeek: 1,
        startTime: "09:00",
        endTime: "10:00",
        seriesStartDate: "2024-03-04T06:00:00.000Z",
      }),
      { params: Promise.resolve({ studioId }) }
    );

    expect(response.status).toBe(401);
  });

  test("returns 400 for an invalid studioId", async () => {
    const { owner, instructor1, locationA, roomA } = await createFixture("400-studio");
    sessionUser.userId = owner.id;

    const response = await POST(
      makePostRequest("not-a-uuid", {
        instructorUserId: instructor1.id,
        locationId: locationA.id,
        roomId: roomA.id,
        attendeeStudentIds: ["00000000-0000-0000-0000-000000000000"],
        dayOfWeek: 1,
        startTime: "09:00",
        endTime: "10:00",
        seriesStartDate: "2024-03-04T06:00:00.000Z",
      }),
      { params: Promise.resolve({ studioId: "not-a-uuid" }) }
    );

    expect(response.status).toBe(400);
  });

  test("returns 400 for an invalid body", async () => {
    const { studioId, owner } = await createFixture("400-body");
    sessionUser.userId = owner.id;

    const response = await POST(makePostRequest(studioId, { nonsense: true }), {
      params: Promise.resolve({ studioId }),
    });

    expect(response.status).toBe(400);
  });

  test("returns 403 when the caller lacks permission to book for another instructor", async () => {
    const { studioId, instructor1, instructor2, locationA, roomA } = await createFixture("403");
    const db = drizzle(pool, { schema });
    const student1 = await insertStudent(db, studioId, instructor1.id, "Student One");
    sessionUser.userId = instructor2.id;

    const response = await POST(
      makePostRequest(studioId, {
        instructorUserId: instructor1.id,
        locationId: locationA.id,
        roomId: roomA.id,
        attendeeStudentIds: [student1.id],
        dayOfWeek: 1,
        startTime: "09:00",
        endTime: "10:00",
        seriesStartDate: "2024-03-04T06:00:00.000Z",
      }),
      { params: Promise.resolve({ studioId }) }
    );

    expect(response.status).toBe(403);
  });

  test("returns 422 when a cross-instructor reason is required but missing", async () => {
    const { studioId, owner, instructor1, instructor2, locationA, roomA } = await createFixture("422");
    const db = drizzle(pool, { schema });
    const student1 = await insertStudent(db, studioId, owner.id, "Student One");
    const { studentAssignments } = schema;
    await withTenantContext(
      { userId: owner.id, tenantId: studioId },
      (tx) =>
        tx.insert(studentAssignments).values({
          studentId: student1.id,
          studioId,
          instructorUserId: instructor2.id,
          isPrimary: true,
        }),
      db
    );
    sessionUser.userId = owner.id;

    const response = await POST(
      makePostRequest(studioId, {
        instructorUserId: instructor1.id,
        locationId: locationA.id,
        roomId: roomA.id,
        attendeeStudentIds: [student1.id],
        dayOfWeek: 1,
        startTime: "09:00",
        endTime: "10:00",
        seriesStartDate: "2024-03-04T06:00:00.000Z",
      }),
      { params: Promise.resolve({ studioId }) }
    );

    expect(response.status).toBe(422);
  });

  test("returns 201 and materializes the series", async () => {
    const { studioId, owner, instructor1, locationA, roomA } = await createFixture("201");
    const db = drizzle(pool, { schema });
    const student1 = await insertStudent(db, studioId, owner.id, "Student One");
    sessionUser.userId = owner.id;

    const response = await POST(
      makePostRequest(studioId, {
        instructorUserId: instructor1.id,
        locationId: locationA.id,
        roomId: roomA.id,
        attendeeStudentIds: [student1.id],
        dayOfWeek: 1,
        startTime: "09:00",
        endTime: "10:00",
        seriesStartDate: "2024-03-04T06:00:00.000Z",
      }),
      { params: Promise.resolve({ studioId }) }
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { seriesId: string; created: unknown[]; skipped: unknown[] };
    expect(body.seriesId).toBeTruthy();
    expect(body.created).toHaveLength(12);
    expect(body.skipped).toHaveLength(0);
  });
});
