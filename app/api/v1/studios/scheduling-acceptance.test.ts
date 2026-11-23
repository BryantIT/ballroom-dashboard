// app/api/v1/studios/scheduling-acceptance.test.ts
//
// Task 16 (final task of Phase 3): cross-cutting acceptance tests that
// exercise the REAL API route handlers end-to-end — not the underlying
// service functions directly — to prove three acceptance criteria from
// the base spec hold across the whole feature, not just within one
// task's own unit tests. See
// .superpowers/sdd/2026-11-13-phase-3-students-crm-scheduling/task-16-brief.md.
//
// Follows the exact harness pattern established by
// app/api/v1/studios/[studioId]/appointments/route.test.ts: a real
// Testcontainers Postgres instance, mocking ONLY verifyApiSession /
// verifySession from @/lib/dal — permission checks, RLS, conflict checks,
// and the real queries all run against real Postgres.
//
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing/test-database";
import {
  users,
  students,
  studentAssignments,
  rooms,
  locations,
  instructorLocations,
  memberships,
  roles,
} from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";

const sessionUser = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/dal", () => ({
  verifyApiSession: async () => (sessionUser.userId ? { userId: sessionUser.userId } : null),
  verifySession: async () => (sessionUser.userId ? { userId: sessionUser.userId } : null),
}));

describe("Phase 3 cross-cutting acceptance tests", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let studentsGET: typeof import("./[studioId]/students/route").GET;
  let studentPATCH: typeof import("./[studioId]/students/[studentId]/route").PATCH;
  let notesGET: typeof import("./[studioId]/students/[studentId]/notes/route").GET;
  let notesPOST: typeof import("./[studioId]/students/[studentId]/notes/route").POST;
  let appointmentsPOST: typeof import("./[studioId]/appointments/route").POST;
  let provisionStudio: typeof import("@/lib/studios/provision").provisionStudio;
  let withTenantContext: typeof import("@/lib/db/with-tenant-context").withTenantContext;
  let appDb: typeof import("@/lib/db/client").db;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    // The routes use the default db client, which reads this at import time.
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ GET: studentsGET } = await import("./[studioId]/students/route"));
    ({ PATCH: studentPATCH } = await import("./[studioId]/students/[studentId]/route"));
    ({ GET: notesGET, POST: notesPOST } = await import(
      "./[studioId]/students/[studentId]/notes/route"
    ));
    ({ POST: appointmentsPOST } = await import("./[studioId]/appointments/route"));
    ({ provisionStudio } = await import("@/lib/studios/provision"));
    ({ withTenantContext } = await import("@/lib/db/with-tenant-context"));
    ({ db: appDb } = await import("@/lib/db/client"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await appDb.$client.end();
    await testDb.stop();
  });

  function makeStudentsGetRequest(studioId: string) {
    return new Request(`http://localhost/api/v1/studios/${studioId}/students`);
  }

  function makeStudentPatchRequest(studioId: string, studentId: string, body: unknown) {
    return new Request(`http://localhost/api/v1/studios/${studioId}/students/${studentId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  function makeNotesGetRequest(studioId: string, studentId: string) {
    return new Request(
      `http://localhost/api/v1/studios/${studioId}/students/${studentId}/notes`
    );
  }

  function makeNotesPostRequest(studioId: string, studentId: string, body: unknown) {
    return new Request(
      `http://localhost/api/v1/studios/${studioId}/students/${studentId}/notes`,
      { method: "POST", body: JSON.stringify(body) }
    );
  }

  function makeAppointmentsPostRequest(studioId: string, body: unknown) {
    return new Request(`http://localhost/api/v1/studios/${studioId}/appointments`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // --- Acceptance #2 fixture ---------------------------------------------
  // One studio, an Instructor (students.read + students.update_assigned,
  // NOT update_all, per BUILTIN_ROLE_PERMISSIONS), two students — one with
  // an active studentAssignments row for the instructor, one with none.
  async function createAcceptance2Fixture(emailSuffix: string) {
    const db = drizzle(pool, { schema });
    const [owner] = await db
      .insert(users)
      .values({ email: `owner-acc2-${emailSuffix}@example.com` })
      .returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const [instructor] = await db
      .insert(users)
      .values({ email: `instructor-acc2-${emailSuffix}@example.com` })
      .returning();

    const { assignedStudent, unassignedStudent } = await withTenantContext(
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

        const [assignedStudent] = await tx
          .insert(students)
          .values({ studioId, displayName: "Assigned Student" })
          .returning();
        const [unassignedStudent] = await tx
          .insert(students)
          .values({ studioId, displayName: "Unassigned Student" })
          .returning();

        await tx.insert(studentAssignments).values({
          studentId: assignedStudent.id,
          studioId,
          instructorUserId: instructor.id,
          isPrimary: true,
          effectiveAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // yesterday
          endedAt: null,
        });

        return { assignedStudent, unassignedStudent };
      },
      db
    );

    return { db, owner, instructor, studioId, assignedStudent, unassignedStudent };
  }

  test("acceptance #2: an instructor sees all of a studio's students but can only edit assigned ones and cannot read a restricted note on an unassigned student", async () => {
    const { owner, instructor, studioId, assignedStudent, unassignedStudent } =
      await createAcceptance2Fixture("main");

    // The Owner (students.update_all / notes.write_assigned via
    // students.update_all's write rule) writes a restricted note on the
    // UNASSIGNED student through the real notes route. The note's
    // existence isn't under test here, only its visibility to the
    // instructor below.
    sessionUser.userId = owner.id;
    const createNoteResponse = await notesPOST(
      makeNotesPostRequest(studioId, unassignedStudent.id, {
        body: "Sensitive note about the unassigned student",
        restricted: true,
      }),
      { params: Promise.resolve({ studioId, studentId: unassignedStudent.id }) }
    );
    expect(createNoteResponse.status).toBe(201);

    // The Instructor sees ALL of the studio's students via GET, assigned
    // or not.
    sessionUser.userId = instructor.id;
    const listResponse = await studentsGET(makeStudentsGetRequest(studioId), {
      params: Promise.resolve({ studioId }),
    });
    expect(listResponse.status).toBe(200);
    const listBody = (await listResponse.json()) as { students: { id: string }[] };
    const listedIds = listBody.students.map((s) => s.id);
    expect(listedIds).toContain(assignedStudent.id);
    expect(listedIds).toContain(unassignedStudent.id);

    // The Instructor CAN edit the assigned student's profile.
    const editAssignedResponse = await studentPATCH(
      makeStudentPatchRequest(studioId, assignedStudent.id, {
        displayName: "Updated By Instructor",
      }),
      { params: Promise.resolve({ studioId, studentId: assignedStudent.id }) }
    );
    expect(editAssignedResponse.status).toBe(200);

    // The Instructor CANNOT edit the unassigned student's profile.
    const editUnassignedResponse = await studentPATCH(
      makeStudentPatchRequest(studioId, unassignedStudent.id, {
        displayName: "Should Not Be Allowed",
      }),
      { params: Promise.resolve({ studioId, studentId: unassignedStudent.id }) }
    );
    expect(editUnassignedResponse.status).toBe(403);

    // The Instructor cannot read the restricted note on the unassigned
    // student — it's simply absent from the response, never a 403.
    const notesResponse = await notesGET(makeNotesGetRequest(studioId, unassignedStudent.id), {
      params: Promise.resolve({ studioId, studentId: unassignedStudent.id }),
    });
    expect(notesResponse.status).toBe(200);
    const notesBody = (await notesResponse.json()) as { notes: unknown[] };
    expect(notesBody.notes).toHaveLength(0);
  });

  // --- Acceptance #4/#5 fixture -------------------------------------------
  // One studio, two locations, one room per location, one instructor
  // assigned to BOTH locations (direct instructorLocations insert), and a
  // student.
  async function createSchedulingFixture(emailSuffix: string) {
    const db = drizzle(pool, { schema });
    const [owner] = await db
      .insert(users)
      .values({ email: `owner-sched-acc-${emailSuffix}@example.com` })
      .returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const [instructor] = await db
      .insert(users)
      .values({ email: `instructor-sched-acc-${emailSuffix}@example.com` })
      .returning();

    const { locationA, locationB, roomA, roomB, student } = await withTenantContext(
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

        // The instructor is assigned to BOTH locations — the fixture for
        // acceptance #4 (double-booking across the two locations an
        // instructor is actually scheduled at).
        await tx.insert(instructorLocations).values([
          { studioId, instructorUserId: instructor.id, locationId: locationA.id },
          { studioId, instructorUserId: instructor.id, locationId: locationB.id },
        ]);

        const [student] = await tx
          .insert(students)
          .values({ studioId, displayName: "Student" })
          .returning();

        return { locationA, locationB, roomA, roomB, student };
      },
      db
    );

    return { db, owner, instructor, studioId, locationA, locationB, roomA, roomB, student };
  }

  test("acceptance #4: an instructor already booked at Location A cannot be double-booked at Location B for an overlapping time", async () => {
    const { owner, instructor, studioId, locationA, locationB, roomA, roomB, student } =
      await createSchedulingFixture("acc4");
    sessionUser.userId = owner.id;

    // Book the instructor at Location A.
    const firstBooking = await appointmentsPOST(
      makeAppointmentsPostRequest(studioId, {
        instructorUserId: instructor.id,
        locationId: locationA.id,
        roomId: roomA.id,
        startAt: "2024-05-06T15:00:00.000Z",
        endAt: "2024-05-06T16:00:00.000Z",
        attendeeStudentIds: [student.id],
      }),
      { params: Promise.resolve({ studioId }) }
    );
    expect(firstBooking.status).toBe(201);

    // Attempt to book the SAME instructor at Location B, in Location B's
    // own room, for an overlapping window. The conflict check must span
    // locations, not just check within one location's bookings.
    const secondBooking = await appointmentsPOST(
      makeAppointmentsPostRequest(studioId, {
        instructorUserId: instructor.id,
        locationId: locationB.id,
        roomId: roomB.id,
        startAt: "2024-05-06T15:30:00.000Z",
        endAt: "2024-05-06T16:30:00.000Z",
        attendeeStudentIds: [student.id],
      }),
      { params: Promise.resolve({ studioId }) }
    );

    expect(secondBooking.status).toBe(409);
    const body = (await secondBooking.json()) as { error: string };
    expect(body.error).toMatch(/overlapping appointment/i);
  });

  test("acceptance #5: a room belonging to Location A is rejected for an appointment at Location B, even when the caller supplies the room id directly", async () => {
    const { owner, instructor, studioId, locationB, roomA, student } =
      await createSchedulingFixture("acc5");
    sessionUser.userId = owner.id;

    // roomA belongs to locationA, not locationB — supplied directly in the
    // request body, not through any UI affordance.
    const response = await appointmentsPOST(
      makeAppointmentsPostRequest(studioId, {
        instructorUserId: instructor.id,
        locationId: locationB.id,
        roomId: roomA.id,
        startAt: "2024-05-06T15:00:00.000Z",
        endAt: "2024-05-06T16:00:00.000Z",
        attendeeStudentIds: [student.id],
      }),
      { params: Promise.resolve({ studioId }) }
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/does not belong to location/i);
  });
});
