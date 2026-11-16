// app/api/v1/studios/[studioId]/appointments/route.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing/test-database";
import { users, locations, rooms, roles, memberships, students } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";

// Only session verification is stubbed; everything below it (permission
// checks, RLS, the conflict checks, the query itself) runs against real
// Postgres.
const sessionUser = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/dal", () => ({
  verifyApiSession: async () => (sessionUser.userId ? { userId: sessionUser.userId } : null),
  verifySession: async () => (sessionUser.userId ? { userId: sessionUser.userId } : null),
}));

describe("/api/v1/studios/{studioId}/appointments", () => {
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
    return new Request(`http://localhost/api/v1/studios/${studioId}/appointments${query}`);
  }

  function makePostRequest(studioId: string, body: unknown) {
    return new Request(`http://localhost/api/v1/studios/${studioId}/appointments`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // One studio, two locations (different timezones), one room per
  // location, two instructors with active memberships (manage_self only),
  // and the owner (manage_all). Mirrors lib/scheduling/appointments.test.ts's
  // fixture.
  async function createFixture(emailSuffix: string) {
    const db = drizzle(pool, { schema });
    const [owner] = await db
      .insert(users)
      .values({ email: `owner-appt-route-${emailSuffix}@example.com` })
      .returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const [instructor1] = await db
      .insert(users)
      .values({ email: `instructor1-appt-route-${emailSuffix}@example.com` })
      .returning();
    const [instructor2] = await db
      .insert(users)
      .values({ email: `instructor2-appt-route-${emailSuffix}@example.com` })
      .returning();

    const { locationA, locationB, roomA, roomB } = await withTenantContext(
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
        const [locationB] = await tx
          .insert(locations)
          .values({ studioId, name: "Location B", timezone: "America/New_York" })
          .returning();
        const [roomA] = await tx
          .insert(rooms)
          .values({ studioId, locationId: locationA.id, name: "Room A" })
          .returning();
        const [roomB] = await tx
          .insert(rooms)
          .values({ studioId, locationId: locationB.id, name: "Room B" })
          .returning();

        return { locationA, locationB, roomA, roomB };
      },
      db
    );

    return { db, owner, instructor1, instructor2, studioId, locationA, locationB, roomA, roomB };
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

  describe("GET", () => {
    test("returns 401 when there is no session", async () => {
      const { studioId } = await createFixture("get-401");
      sessionUser.userId = "";

      const response = await GET(
        makeGetRequest(studioId, "?from=2024-01-01T00:00:00Z&to=2024-02-01T00:00:00Z"),
        { params: Promise.resolve({ studioId }) }
      );

      expect(response.status).toBe(401);
    });

    test("returns 400 for an invalid studioId", async () => {
      const { owner } = await createFixture("get-400-studio");
      sessionUser.userId = owner.id;

      const response = await GET(
        makeGetRequest("not-a-uuid", "?from=2024-01-01T00:00:00Z&to=2024-02-01T00:00:00Z"),
        { params: Promise.resolve({ studioId: "not-a-uuid" }) }
      );

      expect(response.status).toBe(400);
    });

    test("returns 400 when from/to are missing or invalid", async () => {
      const { studioId, owner } = await createFixture("get-400-range");
      sessionUser.userId = owner.id;

      const response = await GET(makeGetRequest(studioId, ""), {
        params: Promise.resolve({ studioId }),
      });

      expect(response.status).toBe(400);
    });

    test("returns 403 when the caller lacks appointments.read_all", async () => {
      const { studioId, db } = await createFixture("get-403");
      const [outsider] = await db
        .insert(users)
        .values({ email: "outsider-appt-get@example.com" })
        .returning();
      sessionUser.userId = outsider.id;

      const response = await GET(
        makeGetRequest(studioId, "?from=2024-01-01T00:00:00Z&to=2024-02-01T00:00:00Z"),
        { params: Promise.resolve({ studioId }) }
      );

      expect(response.status).toBe(403);
    });

    test("returns appointments and blocks in range, redacting labels for a viewer without manage_all", async () => {
      const { studioId, owner, instructor1, instructor2, locationA, roomA } = await createFixture(
        "get-list"
      );
      const student1 = await insertStudent(
        await (async () => drizzle(pool, { schema }))(),
        studioId,
        owner.id,
        "Student One"
      );

      sessionUser.userId = owner.id;
      const createResponse = await POST(
        makePostRequest(studioId, {
          instructorUserId: instructor1.id,
          locationId: locationA.id,
          roomId: roomA.id,
          startAt: "2024-03-04T15:00:00.000Z",
          endAt: "2024-03-04T16:00:00.000Z",
          attendeeStudentIds: [student1.id],
        }),
        { params: Promise.resolve({ studioId }) }
      );
      expect(createResponse.status).toBe(201);

      // instructor1 books a personal_time_off block with a label — only
      // instructor1 or a manage_all holder should see it.
      const { createBlock } = await import("@/lib/scheduling/blocks");
      await createBlock(
        instructor1.id,
        studioId,
        {
          kind: "personal_time_off",
          instructorUserId: instructor1.id,
          startAt: new Date("2024-03-05T18:00:00Z"),
          endAt: new Date("2024-03-05T20:00:00Z"),
          label: "Dentist",
        },
        appDb
      );

      // instructor2 holds only appointments.manage_self/appointments.read_all
      // — can see the appointment and the blocked slot, but never the label.
      sessionUser.userId = instructor2.id;
      const response = await GET(
        makeGetRequest(studioId, "?from=2024-01-01T00:00:00Z&to=2024-04-01T00:00:00Z"),
        { params: Promise.resolve({ studioId }) }
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        appointments: { id: string; instructorUserId: string }[];
        blocks: { label: string | null }[];
      };
      expect(body.appointments).toHaveLength(1);
      expect(body.appointments[0].instructorUserId).toBe(instructor1.id);
      expect(body.blocks).toHaveLength(1);
      expect(body.blocks[0].label).toBeNull();

      // The owner (manage_all) sees the real label.
      sessionUser.userId = owner.id;
      const ownerResponse = await GET(
        makeGetRequest(studioId, "?from=2024-01-01T00:00:00Z&to=2024-04-01T00:00:00Z"),
        { params: Promise.resolve({ studioId }) }
      );
      const ownerBody = (await ownerResponse.json()) as { blocks: { label: string | null }[] };
      expect(ownerBody.blocks[0].label).toBe("Dentist");
    });

    test("filters appointments by locationId when given", async () => {
      const { studioId, owner, instructor1, instructor2, locationA, locationB, roomA, roomB } =
        await createFixture("get-location-filter");
      const db = drizzle(pool, { schema });
      const student1 = await insertStudent(db, studioId, owner.id, "Student One");
      const student2 = await insertStudent(db, studioId, owner.id, "Student Two");

      sessionUser.userId = owner.id;
      await POST(
        makePostRequest(studioId, {
          instructorUserId: instructor1.id,
          locationId: locationA.id,
          roomId: roomA.id,
          startAt: "2024-03-04T15:00:00.000Z",
          endAt: "2024-03-04T16:00:00.000Z",
          attendeeStudentIds: [student1.id],
        }),
        { params: Promise.resolve({ studioId }) }
      );
      await POST(
        makePostRequest(studioId, {
          instructorUserId: instructor2.id,
          locationId: locationB.id,
          roomId: roomB.id,
          startAt: "2024-03-04T15:00:00.000Z",
          endAt: "2024-03-04T16:00:00.000Z",
          attendeeStudentIds: [student2.id],
        }),
        { params: Promise.resolve({ studioId }) }
      );

      const response = await GET(
        makeGetRequest(
          studioId,
          `?from=2024-01-01T00:00:00Z&to=2024-04-01T00:00:00Z&locationId=${locationA.id}`
        ),
        { params: Promise.resolve({ studioId }) }
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as { appointments: { locationId: string }[] };
      expect(body.appointments).toHaveLength(1);
      expect(body.appointments[0].locationId).toBe(locationA.id);
    });
  });

  describe("POST", () => {
    test("returns 401 when there is no session", async () => {
      const { studioId, instructor1, locationA, roomA } = await createFixture("post-401");
      sessionUser.userId = "";

      const response = await POST(
        makePostRequest(studioId, {
          instructorUserId: instructor1.id,
          locationId: locationA.id,
          roomId: roomA.id,
          startAt: "2024-03-04T15:00:00.000Z",
          endAt: "2024-03-04T16:00:00.000Z",
          attendeeStudentIds: ["00000000-0000-0000-0000-000000000000"],
        }),
        { params: Promise.resolve({ studioId }) }
      );

      expect(response.status).toBe(401);
    });

    test("returns 400 for an invalid studioId", async () => {
      const { owner, instructor1, locationA, roomA } = await createFixture("post-400-studio");
      sessionUser.userId = owner.id;

      const response = await POST(
        makePostRequest("not-a-uuid", {
          instructorUserId: instructor1.id,
          locationId: locationA.id,
          roomId: roomA.id,
          startAt: "2024-03-04T15:00:00.000Z",
          endAt: "2024-03-04T16:00:00.000Z",
          attendeeStudentIds: ["00000000-0000-0000-0000-000000000000"],
        }),
        { params: Promise.resolve({ studioId: "not-a-uuid" }) }
      );

      expect(response.status).toBe(400);
    });

    test("returns 400 for an invalid body", async () => {
      const { studioId, owner } = await createFixture("post-400-body");
      sessionUser.userId = owner.id;

      const response = await POST(makePostRequest(studioId, { nonsense: true }), {
        params: Promise.resolve({ studioId }),
      });

      expect(response.status).toBe(400);
    });

    test("returns 403 when the caller lacks permission to book for another instructor", async () => {
      const { studioId, instructor1, instructor2, locationA, roomA } = await createFixture(
        "post-403"
      );
      const db = drizzle(pool, { schema });
      const student1 = await insertStudent(db, studioId, instructor1.id, "Student One");
      sessionUser.userId = instructor2.id;

      const response = await POST(
        makePostRequest(studioId, {
          instructorUserId: instructor1.id,
          locationId: locationA.id,
          roomId: roomA.id,
          startAt: "2024-03-04T15:00:00.000Z",
          endAt: "2024-03-04T16:00:00.000Z",
          attendeeStudentIds: [student1.id],
        }),
        { params: Promise.resolve({ studioId }) }
      );

      expect(response.status).toBe(403);
    });

    test("returns 422 when a cross-instructor reason is required but missing", async () => {
      const { studioId, owner, instructor1, instructor2, locationA, roomA } = await createFixture(
        "post-422"
      );
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
          startAt: "2024-03-04T15:00:00.000Z",
          endAt: "2024-03-04T16:00:00.000Z",
          attendeeStudentIds: [student1.id],
        }),
        { params: Promise.resolve({ studioId }) }
      );

      expect(response.status).toBe(422);
    });

    test("returns 409 on an instructor conflict", async () => {
      const { studioId, owner, instructor1, locationA, locationB, roomA, roomB } = await createFixture(
        "post-409-instructor"
      );
      const db = drizzle(pool, { schema });
      const student1 = await insertStudent(db, studioId, owner.id, "Student One");
      sessionUser.userId = owner.id;

      await POST(
        makePostRequest(studioId, {
          instructorUserId: instructor1.id,
          locationId: locationB.id,
          roomId: roomB.id,
          startAt: "2024-03-04T15:00:00.000Z",
          endAt: "2024-03-04T16:00:00.000Z",
          attendeeStudentIds: [student1.id],
        }),
        { params: Promise.resolve({ studioId }) }
      );

      const response = await POST(
        makePostRequest(studioId, {
          instructorUserId: instructor1.id,
          locationId: locationA.id,
          roomId: roomA.id,
          startAt: "2024-03-04T15:30:00.000Z",
          endAt: "2024-03-04T16:30:00.000Z",
          attendeeStudentIds: [student1.id],
        }),
        { params: Promise.resolve({ studioId }) }
      );

      expect(response.status).toBe(409);
    });

    test("returns 409 on a room conflict", async () => {
      const { studioId, owner, instructor1, instructor2, locationA, roomA } = await createFixture(
        "post-409-room"
      );
      const db = drizzle(pool, { schema });
      const student1 = await insertStudent(db, studioId, owner.id, "Student One");
      sessionUser.userId = owner.id;

      await POST(
        makePostRequest(studioId, {
          instructorUserId: instructor2.id,
          locationId: locationA.id,
          roomId: roomA.id,
          startAt: "2024-03-04T15:00:00.000Z",
          endAt: "2024-03-04T16:00:00.000Z",
          attendeeStudentIds: [student1.id],
        }),
        { params: Promise.resolve({ studioId }) }
      );

      const response = await POST(
        makePostRequest(studioId, {
          instructorUserId: instructor1.id,
          locationId: locationA.id,
          roomId: roomA.id,
          startAt: "2024-03-04T15:30:00.000Z",
          endAt: "2024-03-04T16:30:00.000Z",
          attendeeStudentIds: [student1.id],
        }),
        { params: Promise.resolve({ studioId }) }
      );

      expect(response.status).toBe(409);
    });

    test("returns 409 on a room/location mismatch", async () => {
      const { studioId, owner, instructor1, locationB, roomA } = await createFixture(
        "post-409-room-location"
      );
      const db = drizzle(pool, { schema });
      const student1 = await insertStudent(db, studioId, owner.id, "Student One");
      sessionUser.userId = owner.id;

      const response = await POST(
        makePostRequest(studioId, {
          instructorUserId: instructor1.id,
          locationId: locationB.id, // roomA belongs to locationA, not B
          roomId: roomA.id,
          startAt: "2024-03-04T15:00:00.000Z",
          endAt: "2024-03-04T16:00:00.000Z",
          attendeeStudentIds: [student1.id],
        }),
        { params: Promise.resolve({ studioId }) }
      );

      expect(response.status).toBe(409);
    });

    test("returns 409 when the instructor is unavailable due to an availability block", async () => {
      const { studioId, owner, instructor1, locationA, roomA } = await createFixture(
        "post-409-unavailable"
      );
      const db = drizzle(pool, { schema });
      const student1 = await insertStudent(db, studioId, owner.id, "Student One");

      const { createBlock } = await import("@/lib/scheduling/blocks");
      await createBlock(
        instructor1.id,
        studioId,
        {
          kind: "regular_day_off",
          instructorUserId: instructor1.id,
          dayOfWeek: 1, // Monday
          startTime: "09:00",
          endTime: "17:00",
        },
        db
      );

      sessionUser.userId = owner.id;
      // 2024-03-04 is a Monday; America/Chicago is UTC-6 in March, so
      // 09:00-17:00 CST is 15:00-23:00Z.
      const response = await POST(
        makePostRequest(studioId, {
          instructorUserId: instructor1.id,
          locationId: locationA.id,
          roomId: roomA.id,
          startAt: "2024-03-04T18:00:00.000Z",
          endAt: "2024-03-04T18:30:00.000Z",
          attendeeStudentIds: [student1.id],
        }),
        { params: Promise.resolve({ studioId }) }
      );

      expect(response.status).toBe(409);
    });

    test("returns 201 and creates the appointment", async () => {
      const { studioId, owner, instructor1, locationA, roomA } = await createFixture("post-201");
      const db = drizzle(pool, { schema });
      const student1 = await insertStudent(db, studioId, owner.id, "Student One");
      sessionUser.userId = owner.id;

      const response = await POST(
        makePostRequest(studioId, {
          instructorUserId: instructor1.id,
          locationId: locationA.id,
          roomId: roomA.id,
          startAt: "2024-03-04T15:00:00.000Z",
          endAt: "2024-03-04T16:00:00.000Z",
          attendeeStudentIds: [student1.id],
        }),
        { params: Promise.resolve({ studioId }) }
      );

      expect(response.status).toBe(201);
      const body = (await response.json()) as { id: string; status: string };
      expect(body.status).toBe("scheduled");
    });
  });
});
