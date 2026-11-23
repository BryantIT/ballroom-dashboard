// lib/scheduling/appointments.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "../db/testing/test-database";
import {
  users,
  locations,
  rooms,
  roles,
  memberships,
  appointments,
  appointmentAttendees,
  students,
  studentAssignments,
} from "../db/schema";
import * as schema from "../db/schema";

describe("appointment booking", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let provisionStudio: typeof import("../studios/provision").provisionStudio;
  let createBlock: typeof import("./blocks").createBlock;
  let withTenantContext: typeof import("../db/with-tenant-context").withTenantContext;
  let createAppointment: typeof import("./appointments").createAppointment;
  let createAppointmentSeries: typeof import("./appointments").createAppointmentSeries;
  let CrossInstructorReasonRequiredError: typeof import("./appointments").CrossInstructorReasonRequiredError;
  let StudentNotFoundError: typeof import("./appointments").StudentNotFoundError;
  let InstructorNotFoundError: typeof import("./appointments").InstructorNotFoundError;
  let InstructorConflictError: typeof import("./conflicts").InstructorConflictError;
  let RoomConflictError: typeof import("./conflicts").RoomConflictError;
  let RoomLocationMismatchError: typeof import("./conflicts").RoomLocationMismatchError;
  let InstructorUnavailableError: typeof import("./conflicts").InstructorUnavailableError;
  let PermissionDeniedError: typeof import("../auth/authorization").PermissionDeniedError;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ provisionStudio } = await import("../studios/provision"));
    ({ createBlock } = await import("./blocks"));
    ({ withTenantContext } = await import("../db/with-tenant-context"));
    ({
      createAppointment,
      createAppointmentSeries,
      CrossInstructorReasonRequiredError,
      StudentNotFoundError,
      InstructorNotFoundError,
    } = await import("./appointments"));
    ({
      InstructorConflictError,
      RoomConflictError,
      RoomLocationMismatchError,
      InstructorUnavailableError,
    } = await import("./conflicts"));
    ({ PermissionDeniedError } = await import("../auth/authorization"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  // One studio, two locations (different timezones, by default — same
  // posture as Task 8's conflicts.test.ts fixture), one room per location,
  // and two instructors with active memberships.
  async function createFixture(
    emailSuffix: string,
    locationATimezone = "America/Chicago",
    locationBTimezone = "America/New_York"
  ) {
    const db = drizzle(pool, { schema });
    const [owner] = await db
      .insert(users)
      .values({ email: `owner-appt-${emailSuffix}@example.com` })
      .returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: locationATimezone },
      db
    );
    const [instructor1] = await db
      .insert(users)
      .values({ email: `instructor1-appt-${emailSuffix}@example.com` })
      .returning();
    const [instructor2] = await db
      .insert(users)
      .values({ email: `instructor2-appt-${emailSuffix}@example.com` })
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
          .values({ studioId, name: "Location A", timezone: locationATimezone })
          .returning();
        const [locationB] = await tx
          .insert(locations)
          .values({ studioId, name: "Location B", timezone: locationBTimezone })
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

  async function insertPrimaryAssignment(
    db: ReturnType<typeof drizzle<typeof schema>>,
    studioId: string,
    ownerId: string,
    studentId: string,
    instructorUserId: string
  ) {
    await withTenantContext(
      { userId: ownerId, tenantId: studioId },
      (tx) =>
        tx.insert(studentAssignments).values({
          studentId,
          studioId,
          instructorUserId,
          isPrimary: true,
        }),
      db
    );
  }

  async function insertAppointmentDirectly(
    db: ReturnType<typeof drizzle<typeof schema>>,
    studioId: string,
    ownerId: string,
    overrides: {
      instructorUserId: string;
      locationId: string;
      roomId: string;
      startAt: Date;
      endAt: Date;
      status?: string;
    }
  ) {
    const [created] = await withTenantContext(
      { userId: ownerId, tenantId: studioId },
      (tx) =>
        tx
          .insert(appointments)
          .values({
            studioId,
            instructorUserId: overrides.instructorUserId,
            locationId: overrides.locationId,
            roomId: overrides.roomId,
            startAt: overrides.startAt,
            endAt: overrides.endAt,
            status: overrides.status ?? "scheduled",
          })
          .returning(),
      db
    );
    return created;
  }

  async function listAttendees(db: ReturnType<typeof drizzle<typeof schema>>, studioId: string, ownerId: string, appointmentId: string) {
    return withTenantContext(
      { userId: ownerId, tenantId: studioId },
      (tx) => tx.select().from(appointmentAttendees).where(eq(appointmentAttendees.appointmentId, appointmentId)),
      db
    );
  }

  describe("createAppointment", () => {
    test("books a single-attendee appointment with no conflicts", async () => {
      const { db, owner, instructor1, studioId, locationA, roomA } = await createFixture("single");
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

      expect(appointment.instructorUserId).toBe(instructor1.id);
      expect(appointment.locationId).toBe(locationA.id);
      expect(appointment.roomId).toBe(roomA.id);
      expect(appointment.status).toBe("scheduled");

      const attendees = await listAttendees(db, studioId, owner.id, appointment.id);
      expect(attendees).toHaveLength(1);
      expect(attendees[0].studentId).toBe(student1.id);
    });

    test("books a multi-attendee appointment (e.g. a couple) as one appointment with two attendee rows", async () => {
      const { db, owner, instructor1, studioId, locationA, roomA } = await createFixture("multi-attendee");
      const student1 = await insertStudent(db, studioId, owner.id, "Partner One");
      const student2 = await insertStudent(db, studioId, owner.id, "Partner Two");

      const appointment = await createAppointment(
        owner.id,
        studioId,
        {
          instructorUserId: instructor1.id,
          locationId: locationA.id,
          roomId: roomA.id,
          startAt: new Date("2024-03-04T15:00:00Z"),
          endAt: new Date("2024-03-04T16:00:00Z"),
          attendeeStudentIds: [student1.id, student2.id],
        },
        db
      );

      const attendees = await listAttendees(db, studioId, owner.id, appointment.id);
      expect(attendees).toHaveLength(2);
      expect(attendees.map((a) => a.studentId).sort()).toEqual([student1.id, student2.id].sort());
    });

    test("requires a cross-instructor reason when the attendee's current primary instructor differs from the booked instructor", async () => {
      const { db, owner, instructor1, instructor2, studioId, locationA, roomA } = await createFixture(
        "cross-instructor-required"
      );
      const student1 = await insertStudent(db, studioId, owner.id, "Student One");
      await insertPrimaryAssignment(db, studioId, owner.id, student1.id, instructor2.id);

      await expect(
        createAppointment(
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
        )
      ).rejects.toThrow(CrossInstructorReasonRequiredError);
    });

    test("does not require a reason when booking the attendee's own assigned instructor", async () => {
      const { db, owner, instructor1, studioId, locationA, roomA } = await createFixture("own-instructor");
      const student1 = await insertStudent(db, studioId, owner.id, "Student One");
      await insertPrimaryAssignment(db, studioId, owner.id, student1.id, instructor1.id);

      await expect(
        createAppointment(
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
        )
      ).resolves.toBeTruthy();
    });

    test("does not require a reason for a brand-new student with no assignment yet", async () => {
      const { db, owner, instructor1, studioId, locationA, roomA } = await createFixture("new-student");
      const student1 = await insertStudent(db, studioId, owner.id, "Brand New Student");

      await expect(
        createAppointment(
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
        )
      ).resolves.toBeTruthy();
    });

    test("stores the cross-instructor reason on the appointment when given", async () => {
      const { db, owner, instructor1, instructor2, studioId, locationA, roomA } = await createFixture(
        "cross-instructor-stored"
      );
      const student1 = await insertStudent(db, studioId, owner.id, "Student One");
      await insertPrimaryAssignment(db, studioId, owner.id, student1.id, instructor2.id);

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
          crossInstructorReason: { code: "buddy_lesson", note: "Booking with a friend's instructor" },
        },
        db
      );

      expect(appointment.crossInstructorReasonCode).toBe("buddy_lesson");
      expect(appointment.crossInstructorReasonNote).toBe("Booking with a friend's instructor");
    });

    test("a staff member without appointments.manage_all cannot book for an instructor other than themselves", async () => {
      const { db, instructor1, instructor2, studioId, locationA, roomA } = await createFixture(
        "permission-denied"
      );
      const student1 = await insertStudent(db, studioId, instructor1.id, "Student One");

      // instructor2 only holds appointments.manage_self, and is trying to
      // book an appointment for instructor1 — a different instructor.
      await expect(
        createAppointment(
          instructor2.id,
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
        )
      ).rejects.toThrow(PermissionDeniedError);
    });

    test("an instructor with only appointments.manage_self can book their own slot", async () => {
      const { db, owner, instructor1, studioId, locationA, roomA } = await createFixture("self-service");
      const student1 = await insertStudent(db, studioId, owner.id, "Student One");

      await expect(
        createAppointment(
          instructor1.id,
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
        )
      ).resolves.toBeTruthy();
    });

    describe("conflict checks (reusing Task 8's fixtures/scenarios)", () => {
      test("rejects when the instructor already has an overlapping appointment", async () => {
        const { db, owner, instructor1, studioId, locationA, roomA, locationB, roomB } = await createFixture(
          "conflict-instructor"
        );
        const student1 = await insertStudent(db, studioId, owner.id, "Student One");

        // Existing appointment at a DIFFERENT location — proves the check
        // isn't location-scoped (acceptance test #4, same as Task 8).
        await insertAppointmentDirectly(db, studioId, owner.id, {
          instructorUserId: instructor1.id,
          locationId: locationB.id,
          roomId: roomB.id,
          startAt: new Date("2024-03-04T15:00:00Z"),
          endAt: new Date("2024-03-04T16:00:00Z"),
        });

        await expect(
          createAppointment(
            owner.id,
            studioId,
            {
              instructorUserId: instructor1.id,
              locationId: locationA.id,
              roomId: roomA.id,
              startAt: new Date("2024-03-04T15:30:00Z"),
              endAt: new Date("2024-03-04T16:30:00Z"),
              attendeeStudentIds: [student1.id],
            },
            db
          )
        ).rejects.toThrow(InstructorConflictError);
      });

      test("rejects when the room already has an overlapping appointment", async () => {
        const { db, owner, instructor1, instructor2, studioId, locationA, roomA } = await createFixture(
          "conflict-room"
        );
        const student1 = await insertStudent(db, studioId, owner.id, "Student One");

        await insertAppointmentDirectly(db, studioId, owner.id, {
          instructorUserId: instructor2.id,
          locationId: locationA.id,
          roomId: roomA.id,
          startAt: new Date("2024-03-04T15:00:00Z"),
          endAt: new Date("2024-03-04T16:00:00Z"),
        });

        // Different instructor (instructor1 is otherwise free), same room,
        // overlapping time — isolates the room check from the instructor
        // check.
        await expect(
          createAppointment(
            owner.id,
            studioId,
            {
              instructorUserId: instructor1.id,
              locationId: locationA.id,
              roomId: roomA.id,
              startAt: new Date("2024-03-04T15:30:00Z"),
              endAt: new Date("2024-03-04T16:30:00Z"),
              attendeeStudentIds: [student1.id],
            },
            db
          )
        ).rejects.toThrow(RoomConflictError);
      });

      test("rejects when the room doesn't belong to the appointment's own location", async () => {
        const { db, owner, instructor1, studioId, locationB, roomA } = await createFixture(
          "conflict-room-location"
        );
        const student1 = await insertStudent(db, studioId, owner.id, "Student One");

        await expect(
          createAppointment(
            owner.id,
            studioId,
            {
              instructorUserId: instructor1.id,
              locationId: locationB.id, // roomA belongs to locationA, not B
              roomId: roomA.id,
              startAt: new Date("2024-03-04T15:00:00Z"),
              endAt: new Date("2024-03-04T16:00:00Z"),
              attendeeStudentIds: [student1.id],
            },
            db
          )
        ).rejects.toThrow(RoomLocationMismatchError);
      });

      test("rejects when the instructor is unavailable due to an availability block", async () => {
        const { db, owner, instructor1, studioId, locationA, roomA } = await createFixture(
          "conflict-availability"
        );
        const student1 = await insertStudent(db, studioId, owner.id, "Student One");

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

        // 2024-03-04 is a Monday; America/Chicago is UTC-6 in March, so
        // 09:00-17:00 CST is 15:00-23:00Z. Pick a window nested inside it.
        await expect(
          createAppointment(
            owner.id,
            studioId,
            {
              instructorUserId: instructor1.id,
              locationId: locationA.id,
              roomId: roomA.id,
              startAt: new Date("2024-03-04T18:00:00Z"),
              endAt: new Date("2024-03-04T18:30:00Z"),
              attendeeStudentIds: [student1.id],
            },
            db
          )
        ).rejects.toThrow(InstructorUnavailableError);
      });
    });
  });

  // Final-review Finding 1: the conflict checks are SELECTs followed by an
  // INSERT in a READ COMMITTED transaction, so without a lock two
  // concurrent bookings can both pass their checks before either commits.
  // These tests fire several bookings genuinely concurrently (Promise.
  // allSettled over un-awaited calls, each on its own pooled connection)
  // against the real test database — several racers rather than two, so
  // that without the advisory locks at least two of them reliably
  // interleave between check and insert.
  describe("concurrent booking (advisory locks)", () => {
    const RACERS = 6;

    async function addInstructor(
      db: ReturnType<typeof drizzle<typeof schema>>,
      studioId: string,
      ownerId: string,
      email: string
    ) {
      const [instructor] = await db.insert(users).values({ email }).returning();
      await withTenantContext(
        { userId: ownerId, tenantId: studioId },
        async (tx) => {
          const [instructorRole] = await tx
            .select()
            .from(roles)
            .where(and(eq(roles.studioId, studioId), eq(roles.code, "instructor")));
          await tx
            .insert(memberships)
            .values({ studioId, userId: instructor.id, roleId: instructorRole.id, status: "active" });
        },
        db
      );
      return instructor;
    }

    async function countActiveAppointments(
      db: ReturnType<typeof drizzle<typeof schema>>,
      studioId: string,
      ownerId: string
    ) {
      const rows = await withTenantContext(
        { userId: ownerId, tenantId: studioId },
        (tx) => tx.select({ id: appointments.id }).from(appointments).where(eq(appointments.studioId, studioId)),
        db
      );
      return rows.length;
    }

    test("concurrent overlapping bookings for the same instructor: exactly one succeeds", async () => {
      const { db, owner, instructor1, studioId, locationA } = await createFixture("race-instructor");
      const student1 = await insertStudent(db, studioId, owner.id, "Student One");

      // One distinct room per racer, all at the same location, so the ONLY
      // thing they contend on is the instructor.
      const raceRooms = await withTenantContext(
        { userId: owner.id, tenantId: studioId },
        (tx) =>
          tx
            .insert(rooms)
            .values(
              Array.from({ length: RACERS }, (_, i) => ({
                studioId,
                locationId: locationA.id,
                name: `Race Room ${i}`,
              }))
            )
            .returning(),
        db
      );

      const results = await Promise.allSettled(
        raceRooms.map((room, i) =>
          createAppointment(
            owner.id,
            studioId,
            {
              instructorUserId: instructor1.id,
              locationId: locationA.id,
              roomId: room.id,
              // Overlapping, not identical, windows.
              startAt: new Date(Date.UTC(2024, 2, 4, 15, i * 5)),
              endAt: new Date(Date.UTC(2024, 2, 4, 16, i * 5)),
              attendeeStudentIds: [student1.id],
            },
            db
          )
        )
      );

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(RACERS - 1);
      for (const r of rejected) {
        expect(r.reason).toBeInstanceOf(InstructorConflictError);
      }
      expect(await countActiveAppointments(db, studioId, owner.id)).toBe(1);
    });

    test("concurrent overlapping bookings for the same room: exactly one succeeds", async () => {
      const { db, owner, studioId, locationA, roomA } = await createFixture("race-room");
      const student1 = await insertStudent(db, studioId, owner.id, "Student One");

      // One distinct instructor per racer, so the ONLY thing they contend
      // on is the room.
      const raceInstructors = [];
      for (let i = 0; i < RACERS; i++) {
        raceInstructors.push(await addInstructor(db, studioId, owner.id, `race-room-instr-${i}@example.com`));
      }

      const results = await Promise.allSettled(
        raceInstructors.map((instructor, i) =>
          createAppointment(
            owner.id,
            studioId,
            {
              instructorUserId: instructor.id,
              locationId: locationA.id,
              roomId: roomA.id,
              startAt: new Date(Date.UTC(2024, 2, 4, 15, i * 5)),
              endAt: new Date(Date.UTC(2024, 2, 4, 16, i * 5)),
              attendeeStudentIds: [student1.id],
            },
            db
          )
        )
      );

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(RACERS - 1);
      for (const r of rejected) {
        expect(r.reason).toBeInstanceOf(RoomConflictError);
      }
      expect(await countActiveAppointments(db, studioId, owner.id)).toBe(1);
    });
  });

  // Final-review Finding 7.3: FK constraints bypass RLS, so without an
  // explicit tenant-scoped check an INSERT could reference another
  // studio's student or a non-member instructor.
  describe("tenant-scoped reference checks", () => {
    test("rejects an attendee student id that belongs to a different studio", async () => {
      const victim = await createFixture("xt-student-victim");
      const victimStudent = await insertStudent(victim.db, victim.studioId, victim.owner.id, "Victim Student");
      const attacker = await createFixture("xt-student-attacker");
      const ownStudent = await insertStudent(attacker.db, attacker.studioId, attacker.owner.id, "Own Student");

      await expect(
        createAppointment(
          attacker.owner.id,
          attacker.studioId,
          {
            instructorUserId: attacker.instructor1.id,
            locationId: attacker.locationA.id,
            roomId: attacker.roomA.id,
            startAt: new Date("2024-03-04T15:00:00Z"),
            endAt: new Date("2024-03-04T16:00:00Z"),
            attendeeStudentIds: [ownStudent.id, victimStudent.id],
          },
          attacker.db
        )
      ).rejects.toThrow(StudentNotFoundError);

      // Nothing was written in the attacker's studio either.
      const rows = await withTenantContext(
        { userId: attacker.owner.id, tenantId: attacker.studioId },
        (tx) => tx.select().from(appointments).where(eq(appointments.studioId, attacker.studioId)),
        attacker.db
      );
      expect(rows).toHaveLength(0);
    });

    test("rejects an instructor who is a member of a different studio but not this one", async () => {
      const victim = await createFixture("xt-instr-victim");
      const attacker = await createFixture("xt-instr-attacker");
      const ownStudent = await insertStudent(attacker.db, attacker.studioId, attacker.owner.id, "Own Student");

      await expect(
        createAppointment(
          attacker.owner.id,
          attacker.studioId,
          {
            instructorUserId: victim.instructor1.id,
            locationId: attacker.locationA.id,
            roomId: attacker.roomA.id,
            startAt: new Date("2024-03-04T15:00:00Z"),
            endAt: new Date("2024-03-04T16:00:00Z"),
            attendeeStudentIds: [ownStudent.id],
          },
          attacker.db
        )
      ).rejects.toThrow(InstructorNotFoundError);
    });

    test("rejects an instructor whose membership in this studio is not active", async () => {
      const { db, owner, instructor1, studioId, locationA, roomA } = await createFixture("xt-instr-disabled");
      const student1 = await insertStudent(db, studioId, owner.id, "Student One");
      await withTenantContext(
        { userId: owner.id, tenantId: studioId },
        (tx) =>
          tx
            .update(memberships)
            .set({ status: "disabled" })
            .where(and(eq(memberships.studioId, studioId), eq(memberships.userId, instructor1.id))),
        db
      );

      await expect(
        createAppointment(
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
        )
      ).rejects.toThrow(InstructorNotFoundError);
    });

    test("createAppointmentSeries also rejects a cross-studio attendee (check lives in the shared core)", async () => {
      const victim = await createFixture("xt-series-victim");
      const victimStudent = await insertStudent(victim.db, victim.studioId, victim.owner.id, "Victim Student");
      const attacker = await createFixture("xt-series-attacker");

      await expect(
        createAppointmentSeries(
          attacker.owner.id,
          attacker.studioId,
          {
            instructorUserId: attacker.instructor1.id,
            locationId: attacker.locationA.id,
            roomId: attacker.roomA.id,
            attendeeStudentIds: [victimStudent.id],
            dayOfWeek: 1,
            startTime: "09:00",
            endTime: "10:00",
            seriesStartDate: new Date("2024-03-04T06:00:00Z"),
            seriesEndDate: new Date("2024-03-26T00:00:00Z"),
          },
          attacker.db
        )
      ).rejects.toThrow(StudentNotFoundError);
    });
  });

  describe("createAppointmentSeries", () => {
    test("materializes one appointment per week within the 12-week default window", async () => {
      const { db, owner, instructor1, studioId, locationA, roomA } = await createFixture("series-basic");
      const student1 = await insertStudent(db, studioId, owner.id, "Student One");

      // 2024-03-04T06:00:00Z is local midnight Monday in America/Chicago
      // (CST, UTC-6, before DST starts Mar 10) — the series' own 09:00
      // start time lands well inside each week's window regardless of the
      // DST transition partway through the 12-week run.
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
        },
        db
      );

      expect(result.skipped).toHaveLength(0);
      expect(result.created).toHaveLength(12);
      expect(result.created.every((a) => a.seriesId === result.seriesId)).toBe(true);

      // First occurrence: Mon Mar 4 09:00 CST = 15:00Z.
      expect(result.created[0].startAt.toISOString()).toBe("2024-03-04T15:00:00.000Z");
      expect(result.created[0].endAt.toISOString()).toBe("2024-03-04T16:00:00.000Z");
      // 12th occurrence (11 weeks later, Mon May 20): CDT by then (UTC-5),
      // so 09:00 CDT = 14:00Z.
      expect(result.created[11].startAt.toISOString()).toBe("2024-05-20T14:00:00.000Z");

      // Each occurrence is its own independently-editable row.
      const ids = new Set(result.created.map((a) => a.id));
      expect(ids.size).toBe(12);
    });

    test("skips a conflicting week and still creates the rest, reporting the skip", async () => {
      const { db, owner, instructor1, studioId, locationA, locationB, roomA, roomB } = await createFixture(
        "series-skip"
      );
      const student1 = await insertStudent(db, studioId, owner.id, "Student One");

      // Pre-existing appointment for the SAME instructor, at a different
      // location/room, overlapping exactly the 3rd occurrence
      // (Mon Mar 18 2024, 09:00-10:00 CDT = 14:00-15:00Z — DST has started
      // by then).
      await insertAppointmentDirectly(db, studioId, owner.id, {
        instructorUserId: instructor1.id,
        locationId: locationB.id,
        roomId: roomB.id,
        startAt: new Date("2024-03-18T14:00:00Z"),
        endAt: new Date("2024-03-18T15:00:00Z"),
      });

      // Bounded to exactly 4 weekly occurrences: Mar 4, 11, 18, 25.
      const result = await createAppointmentSeries(
        owner.id,
        studioId,
        {
          instructorUserId: instructor1.id,
          locationId: locationA.id,
          roomId: roomA.id,
          attendeeStudentIds: [student1.id],
          dayOfWeek: 1,
          startTime: "09:00",
          endTime: "10:00",
          seriesStartDate: new Date("2024-03-04T06:00:00Z"),
          seriesEndDate: new Date("2024-03-26T00:00:00Z"),
        },
        db
      );

      expect(result.created).toHaveLength(3);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].date.toISOString()).toBe("2024-03-18T14:00:00.000Z");
      expect(result.skipped[0].reason).toMatch(/instructor/i);

      const createdDates = result.created.map((a) => a.startAt.toISOString()).sort();
      expect(createdDates).toEqual([
        "2024-03-04T15:00:00.000Z",
        // DST starts Mar 10, 2024, so Mar 11 is already CDT (UTC-5).
        "2024-03-11T14:00:00.000Z",
        "2024-03-25T14:00:00.000Z",
      ]);
    });

    // Final-review Finding 4: the booking form now sends the start of the
    // day AFTER the user's chosen end date (seriesEndDate is exclusive), so
    // a lesson falling ON that chosen date is created.
    test("includes the chosen end date's own occurrence when given the next local day's midnight as seriesEndDate", async () => {
      const { db, owner, instructor1, studioId, locationA, roomA } = await createFixture("series-end-inclusive");
      const student1 = await insertStudent(db, studioId, owner.id, "Student One");
      const { localDateTimeToUtc } = await import("./timezone");

      // User picks Mon 2024-03-18 as the end date (America/Chicago); the
      // client sends local midnight of Tue 2024-03-19.
      const result = await createAppointmentSeries(
        owner.id,
        studioId,
        {
          instructorUserId: instructor1.id,
          locationId: locationA.id,
          roomId: roomA.id,
          attendeeStudentIds: [student1.id],
          dayOfWeek: 1,
          startTime: "09:00",
          endTime: "10:00",
          seriesStartDate: localDateTimeToUtc(2024, 3, 4, 0, 0, "America/Chicago"),
          seriesEndDate: localDateTimeToUtc(2024, 3, 18 + 1, 0, 0, "America/Chicago"),
        },
        db
      );

      expect(result.skipped).toHaveLength(0);
      expect(result.created.map((a) => a.startAt.toISOString())).toEqual([
        "2024-03-04T15:00:00.000Z",
        "2024-03-11T14:00:00.000Z",
        "2024-03-18T14:00:00.000Z",
      ]);
    });

    test("resolves weekly occurrence dates in the location's own timezone, not UTC", async () => {
      const { db, owner, instructor1, studioId, locationA, roomA } = await createFixture(
        "series-timezone",
        "America/Los_Angeles"
      );
      const student1 = await insertStudent(db, studioId, owner.id, "Student One");

      // Monday 22:00-23:59 PST (America/Los_Angeles, UTC-8 in January) —
      // crosses into Tuesday by UTC's calendar, the same scenario as this
      // phase's Task 6 timezone test (lib/scheduling/blocks.test.ts).
      // 2024-01-01 is itself a Monday.
      const result = await createAppointmentSeries(
        owner.id,
        studioId,
        {
          instructorUserId: instructor1.id,
          locationId: locationA.id,
          roomId: roomA.id,
          attendeeStudentIds: [student1.id],
          dayOfWeek: 1,
          startTime: "22:00",
          endTime: "23:59",
          seriesStartDate: new Date("2024-01-01T08:00:00Z"), // local midnight Mon Jan 1, PST
          seriesEndDate: new Date("2024-01-03T00:00:00Z"), // bounds the series to just this one occurrence
        },
        db
      );

      expect(result.skipped).toHaveLength(0);
      expect(result.created).toHaveLength(1);
      // A UTC-naive implementation would compute the weekday of these
      // instants (both of which fall on Jan 2, a Tuesday, in UTC) and
      // miss the Monday occurrence entirely.
      expect(result.created[0].startAt.toISOString()).toBe("2024-01-02T06:00:00.000Z");
      expect(result.created[0].endAt.toISOString()).toBe("2024-01-02T07:59:00.000Z");
    });
  });
});
