// app/api/v1/studios/[studioId]/appointments/[appointmentId]/status/route.test.ts
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

describe("/api/v1/studios/{studioId}/appointments/{appointmentId}/status", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let PATCH: typeof import("./route").PATCH;
  let provisionStudio: typeof import("@/lib/studios/provision").provisionStudio;
  let withTenantContext: typeof import("@/lib/db/with-tenant-context").withTenantContext;
  let createAppointment: typeof import("@/lib/scheduling/appointments").createAppointment;
  let appDb: typeof import("@/lib/db/client").db;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ PATCH } = await import("./route"));
    ({ provisionStudio } = await import("@/lib/studios/provision"));
    ({ withTenantContext } = await import("@/lib/db/with-tenant-context"));
    ({ createAppointment } = await import("@/lib/scheduling/appointments"));
    ({ db: appDb } = await import("@/lib/db/client"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await appDb.$client.end();
    await testDb.stop();
  });

  function makePatchRequest(studioId: string, appointmentId: string, body: unknown) {
    return new Request(
      `http://localhost/api/v1/studios/${studioId}/appointments/${appointmentId}/status`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      }
    );
  }

  async function createFixture(emailSuffix: string) {
    const db = drizzle(pool, { schema });
    const [owner] = await db
      .insert(users)
      .values({ email: `owner-appt-status-route-${emailSuffix}@example.com` })
      .returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const [instructor1] = await db
      .insert(users)
      .values({ email: `instructor1-appt-status-route-${emailSuffix}@example.com` })
      .returning();
    const [instructor2] = await db
      .insert(users)
      .values({ email: `instructor2-appt-status-route-${emailSuffix}@example.com` })
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

  async function createTestAppointment(
    db: ReturnType<typeof drizzle<typeof schema>>,
    ownerId: string,
    studioId: string,
    instructorUserId: string,
    locationId: string,
    roomId: string,
    studentId: string
  ) {
    return createAppointment(
      ownerId,
      studioId,
      {
        instructorUserId,
        locationId,
        roomId,
        startAt: new Date("2024-03-04T15:00:00Z"),
        endAt: new Date("2024-03-04T16:00:00Z"),
        attendeeStudentIds: [studentId],
      },
      db
    );
  }

  test("returns 401 when there is no session", async () => {
    const { studioId } = await createFixture("401");
    sessionUser.userId = "";

    const response = await PATCH(
      makePatchRequest(studioId, "00000000-0000-0000-0000-000000000000", { status: "checked_in" }),
      { params: Promise.resolve({ studioId, appointmentId: "00000000-0000-0000-0000-000000000000" }) }
    );

    expect(response.status).toBe(401);
  });

  test("returns 400 for an invalid studioId", async () => {
    const { owner } = await createFixture("400-studio");
    sessionUser.userId = owner.id;

    const response = await PATCH(
      makePatchRequest("not-a-uuid", "00000000-0000-0000-0000-000000000000", { status: "checked_in" }),
      { params: Promise.resolve({ studioId: "not-a-uuid", appointmentId: "00000000-0000-0000-0000-000000000000" }) }
    );

    expect(response.status).toBe(400);
  });

  test("returns 400 for an invalid appointmentId", async () => {
    const { studioId, owner } = await createFixture("400-appointment");
    sessionUser.userId = owner.id;

    const response = await PATCH(makePatchRequest(studioId, "not-a-uuid", { status: "checked_in" }), {
      params: Promise.resolve({ studioId, appointmentId: "not-a-uuid" }),
    });

    expect(response.status).toBe(400);
  });

  test("returns 400 for an invalid body", async () => {
    const { studioId, owner } = await createFixture("400-body");
    sessionUser.userId = owner.id;

    const response = await PATCH(
      makePatchRequest(studioId, "00000000-0000-0000-0000-000000000000", { status: "not-a-status" }),
      { params: Promise.resolve({ studioId, appointmentId: "00000000-0000-0000-0000-000000000000" }) }
    );

    expect(response.status).toBe(400);
  });

  test("returns 403 when the caller lacks permission over the target appointment", async () => {
    const { db, studioId, owner, instructor1, instructor2, locationA, roomA } = await createFixture(
      "403"
    );
    const student1 = await insertStudent(db, studioId, owner.id, "Student One");
    const appointment = await createTestAppointment(
      db,
      owner.id,
      studioId,
      instructor1.id,
      locationA.id,
      roomA.id,
      student1.id
    );
    sessionUser.userId = instructor2.id;

    const response = await PATCH(makePatchRequest(studioId, appointment.id, { status: "checked_in" }), {
      params: Promise.resolve({ studioId, appointmentId: appointment.id }),
    });

    expect(response.status).toBe(403);
  });

  test("returns 404 for a nonexistent appointmentId", async () => {
    const { studioId, owner } = await createFixture("404");
    sessionUser.userId = owner.id;

    const response = await PATCH(
      makePatchRequest(studioId, "00000000-0000-0000-0000-000000000000", { status: "checked_in" }),
      { params: Promise.resolve({ studioId, appointmentId: "00000000-0000-0000-0000-000000000000" }) }
    );

    expect(response.status).toBe(404);
  });

  test("returns 409 for an illegal status transition", async () => {
    const { db, studioId, owner, instructor1, locationA, roomA } = await createFixture("409");
    const student1 = await insertStudent(db, studioId, owner.id, "Student One");
    const appointment = await createTestAppointment(
      db,
      owner.id,
      studioId,
      instructor1.id,
      locationA.id,
      roomA.id,
      student1.id
    );
    sessionUser.userId = owner.id;

    const completeResponse = await PATCH(
      makePatchRequest(studioId, appointment.id, { status: "completed" }),
      { params: Promise.resolve({ studioId, appointmentId: appointment.id }) }
    );
    expect(completeResponse.status).toBe(200);

    // completed is terminal — cannot transition again.
    const response = await PATCH(
      makePatchRequest(studioId, appointment.id, { status: "checked_in" }),
      { params: Promise.resolve({ studioId, appointmentId: appointment.id }) }
    );

    expect(response.status).toBe(409);
  });

  test("returns 200 and the updated appointment on a legal transition", async () => {
    const { db, studioId, owner, instructor1, locationA, roomA } = await createFixture("200");
    const student1 = await insertStudent(db, studioId, owner.id, "Student One");
    const appointment = await createTestAppointment(
      db,
      owner.id,
      studioId,
      instructor1.id,
      locationA.id,
      roomA.id,
      student1.id
    );
    sessionUser.userId = owner.id;

    const response = await PATCH(
      makePatchRequest(studioId, appointment.id, { status: "checked_in" }),
      { params: Promise.resolve({ studioId, appointmentId: appointment.id }) }
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe("checked_in");
  });
});
