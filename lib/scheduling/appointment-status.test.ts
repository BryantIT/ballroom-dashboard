// lib/scheduling/appointment-status.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "../db/testing/test-database";
import { users, locations, rooms, roles, memberships, appointments, students } from "../db/schema";
import * as schema from "../db/schema";

describe("appointment status transitions", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let provisionStudio: typeof import("../studios/provision").provisionStudio;
  let withTenantContext: typeof import("../db/with-tenant-context").withTenantContext;
  let createAppointment: typeof import("./appointments").createAppointment;
  let createAppointmentSeries: typeof import("./appointments").createAppointmentSeries;
  let transitionAppointmentStatus: typeof import("./appointment-status").transitionAppointmentStatus;
  let IllegalStatusTransitionError: typeof import("./appointment-status").IllegalStatusTransitionError;
  let PermissionDeniedError: typeof import("../auth/authorization").PermissionDeniedError;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ provisionStudio } = await import("../studios/provision"));
    ({ withTenantContext } = await import("../db/with-tenant-context"));
    ({ createAppointment, createAppointmentSeries } = await import("./appointments"));
    ({ transitionAppointmentStatus, IllegalStatusTransitionError } = await import("./appointment-status"));
    ({ PermissionDeniedError } = await import("../auth/authorization"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  // Same fixture shape as lib/scheduling/appointments.test.ts: one studio,
  // one location/room, and two instructors with active memberships
  // (instructor1/instructor2 hold only appointments.manage_self; the owner
  // holds appointments.manage_all).
  async function createFixture(emailSuffix: string) {
    const db = drizzle(pool, { schema });
    const [owner] = await db
      .insert(users)
      .values({ email: `owner-status-${emailSuffix}@example.com` })
      .returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const [instructor1] = await db
      .insert(users)
      .values({ email: `instructor1-status-${emailSuffix}@example.com` })
      .returning();
    const [instructor2] = await db
      .insert(users)
      .values({ email: `instructor2-status-${emailSuffix}@example.com` })
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

  async function getAppointmentStatus(
    db: ReturnType<typeof drizzle<typeof schema>>,
    studioId: string,
    ownerId: string,
    appointmentId: string
  ) {
    const [row] = await withTenantContext(
      { userId: ownerId, tenantId: studioId },
      (tx) => tx.select().from(appointments).where(eq(appointments.id, appointmentId)),
      db
    );
    return row.status;
  }

  test("scheduled -> checked_in is legal", async () => {
    const { db, owner, instructor1, studioId, locationA, roomA } = await createFixture("checked-in");
    const student1 = await insertStudent(db, studioId, owner.id, "Student One");

    const appointment = await createAppointment(
      owner.id,
      studioId,
      {
        instructorUserId: instructor1.id,
        locationId: locationA.id,
        roomId: roomA.id,
        startAt: new Date("2024-03-04T15:00:00Z"),
        endAt: new Date("2024-03-04T16:00:00Z"),
        attendeeStudentIds: [student1.id],
      },
      db
    );

    const updated = await transitionAppointmentStatus(owner.id, studioId, appointment.id, "checked_in", db);
    expect(updated.status).toBe("checked_in");
  });

  test("scheduled -> completed is legal (check-in is optional per BR-04)", async () => {
    const { db, owner, instructor1, studioId, locationA, roomA } = await createFixture("direct-complete");
    const student1 = await insertStudent(db, studioId, owner.id, "Student One");

    const appointment = await createAppointment(
      owner.id,
      studioId,
      {
        instructorUserId: instructor1.id,
        locationId: locationA.id,
        roomId: roomA.id,
        startAt: new Date("2024-03-04T15:00:00Z"),
        endAt: new Date("2024-03-04T16:00:00Z"),
        attendeeStudentIds: [student1.id],
      },
      db
    );

    const updated = await transitionAppointmentStatus(owner.id, studioId, appointment.id, "completed", db);
    expect(updated.status).toBe("completed");
  });

  test("checked_in -> completed is legal", async () => {
    const { db, owner, instructor1, studioId, locationA, roomA } = await createFixture("checked-in-complete");
    const student1 = await insertStudent(db, studioId, owner.id, "Student One");

    const appointment = await createAppointment(
      owner.id,
      studioId,
      {
        instructorUserId: instructor1.id,
        locationId: locationA.id,
        roomId: roomA.id,
        startAt: new Date("2024-03-04T15:00:00Z"),
        endAt: new Date("2024-03-04T16:00:00Z"),
        attendeeStudentIds: [student1.id],
      },
      db
    );

    await transitionAppointmentStatus(owner.id, studioId, appointment.id, "checked_in", db);
    const updated = await transitionAppointmentStatus(owner.id, studioId, appointment.id, "completed", db);
    expect(updated.status).toBe("completed");
  });

  test("completed -> scheduled is illegal", async () => {
    const { db, owner, instructor1, studioId, locationA, roomA } = await createFixture("terminal-completed");
    const student1 = await insertStudent(db, studioId, owner.id, "Student One");

    const appointment = await createAppointment(
      owner.id,
      studioId,
      {
        instructorUserId: instructor1.id,
        locationId: locationA.id,
        roomId: roomA.id,
        startAt: new Date("2024-03-04T15:00:00Z"),
        endAt: new Date("2024-03-04T16:00:00Z"),
        attendeeStudentIds: [student1.id],
      },
      db
    );

    await transitionAppointmentStatus(owner.id, studioId, appointment.id, "completed", db);

    // "scheduled" is deliberately outside transitionAppointmentStatus's own
    // newStatus type (you can never transition INTO the initial state) — the
    // cast below only bypasses the compile-time narrowing to confirm the
    // runtime legal-transition map also rejects it from a terminal status.
    await expect(
      transitionAppointmentStatus(owner.id, studioId, appointment.id, "scheduled" as never, db)
    ).rejects.toThrow(IllegalStatusTransitionError);
  });

  test("canceling one occurrence of a series does not change any sibling occurrence's status", async () => {
    const { db, owner, instructor1, studioId, locationA, roomA } = await createFixture("series-cancel");
    const student1 = await insertStudent(db, studioId, owner.id, "Student One");

    // Bounded to exactly 3 weekly occurrences: Mar 4, 11, 18.
    const result = await createAppointmentSeries(
      owner.id,
      studioId,
      {
        instructorUserId: instructor1.id,
        locationId: locationA.id,
        roomId: roomA.id,
        attendeeStudentIds: [student1.id],
        dayOfWeek: 1, // Monday
        startTime: "09:00",
        endTime: "10:00",
        seriesStartDate: new Date("2024-03-04T06:00:00Z"),
        seriesEndDate: new Date("2024-03-19T00:00:00Z"),
      },
      db
    );

    expect(result.created).toHaveLength(3);
    const [week1, week2, week3] = result.created.sort(
      (a, b) => a.startAt.getTime() - b.startAt.getTime()
    );

    const canceled = await transitionAppointmentStatus(owner.id, studioId, week2.id, "canceled", db);
    expect(canceled.status).toBe("canceled");

    expect(await getAppointmentStatus(db, studioId, owner.id, week1.id)).toBe("scheduled");
    expect(await getAppointmentStatus(db, studioId, owner.id, week3.id)).toBe("scheduled");
  });

  test("a staff member without appointments.manage_all cannot transition an appointment that isn't their own", async () => {
    const { db, owner, instructor1, instructor2, studioId, locationA, roomA } = await createFixture(
      "permission-denied"
    );
    const student1 = await insertStudent(db, studioId, owner.id, "Student One");

    const appointment = await createAppointment(
      owner.id,
      studioId,
      {
        instructorUserId: instructor1.id,
        locationId: locationA.id,
        roomId: roomA.id,
        startAt: new Date("2024-03-04T15:00:00Z"),
        endAt: new Date("2024-03-04T16:00:00Z"),
        attendeeStudentIds: [student1.id],
      },
      db
    );

    // instructor2 only holds appointments.manage_self, and the appointment
    // belongs to instructor1 — a different instructor.
    await expect(
      transitionAppointmentStatus(instructor2.id, studioId, appointment.id, "checked_in", db)
    ).rejects.toThrow(PermissionDeniedError);
  });
});
