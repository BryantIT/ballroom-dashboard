// lib/scheduling/conflicts.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "../db/testing/test-database";
import { users, locations, rooms, roles, memberships, appointments } from "../db/schema";
import * as schema from "../db/schema";

describe("conflict checking", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let provisionStudio: typeof import("../studios/provision").provisionStudio;
  let createBlock: typeof import("./blocks").createBlock;
  let withTenantContext: typeof import("../db/with-tenant-context").withTenantContext;
  let checkInstructorConflict: typeof import("./conflicts").checkInstructorConflict;
  let checkRoomConflict: typeof import("./conflicts").checkRoomConflict;
  let checkRoomLocationMatch: typeof import("./conflicts").checkRoomLocationMatch;
  let checkAvailabilityBlock: typeof import("./conflicts").checkAvailabilityBlock;
  let InstructorConflictError: typeof import("./conflicts").InstructorConflictError;
  let RoomConflictError: typeof import("./conflicts").RoomConflictError;
  let RoomLocationMismatchError: typeof import("./conflicts").RoomLocationMismatchError;
  let InstructorUnavailableError: typeof import("./conflicts").InstructorUnavailableError;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ provisionStudio } = await import("../studios/provision"));
    ({ createBlock } = await import("./blocks"));
    ({ withTenantContext } = await import("../db/with-tenant-context"));
    ({
      checkInstructorConflict,
      checkRoomConflict,
      checkRoomLocationMatch,
      checkAvailabilityBlock,
      InstructorConflictError,
      RoomConflictError,
      RoomLocationMismatchError,
      InstructorUnavailableError,
    } = await import("./conflicts"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  // Builds one studio with two locations (different timezones, matching the
  // phase plan's acceptance test #4 setup — an instructor double-booked
  // across locations), one room per location, and two instructors with
  // active memberships.
  async function createFixture(emailSuffix: string) {
    const db = drizzle(pool, { schema });
    const [owner] = await db
      .insert(users)
      .values({ email: `owner-conflicts-${emailSuffix}@example.com` })
      .returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const [instructor1] = await db
      .insert(users)
      .values({ email: `instructor1-conflicts-${emailSuffix}@example.com` })
      .returning();
    const [instructor2] = await db
      .insert(users)
      .values({ email: `instructor2-conflicts-${emailSuffix}@example.com` })
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

  async function insertAppointment(
    db: ReturnType<typeof drizzle<typeof schema>>,
    studioId: string,
    overrides: {
      instructorUserId: string;
      locationId: string;
      roomId: string;
      startAt: Date;
      endAt: Date;
      status?: string;
    },
    ownerId: string
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

  describe("checkInstructorConflict", () => {
    test("throws when the same instructor already has an overlapping appointment at a DIFFERENT location", async () => {
      // acceptance test #4
      const { db, owner, instructor1, studioId, locationA, locationB, roomA, roomB } =
        await createFixture("diff-location");

      await insertAppointment(
        db,
        studioId,
        {
          instructorUserId: instructor1.id,
          locationId: locationA.id,
          roomId: roomA.id,
          startAt: new Date("2024-03-04T15:00:00Z"),
          endAt: new Date("2024-03-04T16:00:00Z"),
        },
        owner.id
      );

      await withTenantContext(
        { userId: owner.id, tenantId: studioId },
        async (tx) => {
          await expect(
            checkInstructorConflict(
              tx,
              studioId,
              instructor1.id,
              new Date("2024-03-04T15:30:00Z"),
              new Date("2024-03-04T16:30:00Z")
            )
          ).rejects.toThrow(InstructorConflictError);
        },
        db
      );

      // locationB/roomB exist purely to prove the conflict fires regardless
      // of location — the overlap above never references them.
      expect(locationB.id).toBeTruthy();
      expect(roomB.id).toBeTruthy();
    });

    test("does not throw for a non-overlapping time", async () => {
      const { db, owner, instructor1, studioId, locationA, roomA } = await createFixture("no-overlap");

      await insertAppointment(
        db,
        studioId,
        {
          instructorUserId: instructor1.id,
          locationId: locationA.id,
          roomId: roomA.id,
          startAt: new Date("2024-03-04T15:00:00Z"),
          endAt: new Date("2024-03-04T16:00:00Z"),
        },
        owner.id
      );

      await withTenantContext(
        { userId: owner.id, tenantId: studioId },
        async (tx) => {
          // Back-to-back, starting exactly when the existing one ends — a
          // half-open interval, so this must NOT conflict.
          await expect(
            checkInstructorConflict(
              tx,
              studioId,
              instructor1.id,
              new Date("2024-03-04T16:00:00Z"),
              new Date("2024-03-04T17:00:00Z")
            )
          ).resolves.toBeUndefined();
        },
        db
      );
    });

    test("ignores canceled appointments when checking for overlap", async () => {
      const { db, owner, instructor1, studioId, locationA, roomA } = await createFixture("canceled");

      await insertAppointment(
        db,
        studioId,
        {
          instructorUserId: instructor1.id,
          locationId: locationA.id,
          roomId: roomA.id,
          startAt: new Date("2024-03-04T15:00:00Z"),
          endAt: new Date("2024-03-04T16:00:00Z"),
          status: "canceled",
        },
        owner.id
      );

      await withTenantContext(
        { userId: owner.id, tenantId: studioId },
        async (tx) => {
          await expect(
            checkInstructorConflict(
              tx,
              studioId,
              instructor1.id,
              new Date("2024-03-04T15:30:00Z"),
              new Date("2024-03-04T16:30:00Z")
            )
          ).resolves.toBeUndefined();
        },
        db
      );
    });
  });

  describe("checkRoomConflict", () => {
    test("throws when the same room already has an overlapping appointment", async () => {
      const { db, owner, instructor1, instructor2, studioId, locationA, roomA } =
        await createFixture("room-conflict");

      await insertAppointment(
        db,
        studioId,
        {
          instructorUserId: instructor1.id,
          locationId: locationA.id,
          roomId: roomA.id,
          startAt: new Date("2024-03-04T15:00:00Z"),
          endAt: new Date("2024-03-04T16:00:00Z"),
        },
        owner.id
      );

      await withTenantContext(
        { userId: owner.id, tenantId: studioId },
        async (tx) => {
          // Different instructor, same room, overlapping time.
          await expect(
            checkRoomConflict(
              tx,
              studioId,
              roomA.id,
              new Date("2024-03-04T15:30:00Z"),
              new Date("2024-03-04T16:30:00Z")
            )
          ).rejects.toThrow(RoomConflictError);
          expect(instructor2.id).toBeTruthy();
        },
        db
      );
    });
  });

  describe("checkRoomLocationMatch", () => {
    test("throws when the room belongs to a different location than the appointment's", async () => {
      // acceptance test #5
      const { db, owner, studioId, locationB, roomA } = await createFixture("room-location-mismatch");

      await withTenantContext(
        { userId: owner.id, tenantId: studioId },
        async (tx) => {
          await expect(checkRoomLocationMatch(tx, roomA.id, locationB.id)).rejects.toThrow(
            RoomLocationMismatchError
          );
        },
        db
      );
    });

    test("does not throw when the room belongs to the appointment's own location", async () => {
      const { db, owner, studioId, locationA, roomA } = await createFixture("room-location-match");

      await withTenantContext(
        { userId: owner.id, tenantId: studioId },
        async (tx) => {
          await expect(checkRoomLocationMatch(tx, roomA.id, locationA.id)).resolves.toBeUndefined();
        },
        db
      );
    });
  });

  describe("checkAvailabilityBlock", () => {
    test("throws for a time inside the instructor's regular_day_off window", async () => {
      const { db, owner, instructor1, studioId, locationA } = await createFixture("day-off");

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

      // 2024-03-04 is a Monday. "America/Chicago" is UTC-6 in March (no DST
      // yet), so 09:00-17:00 CST is 15:00-23:00Z. Pick a candidate window
      // strictly nested inside that occurrence (not matching its bounds
      // exactly), to prove the overlap check isn't just an exact-match
      // comparison.
      await withTenantContext(
        { userId: owner.id, tenantId: studioId },
        async (tx) => {
          await expect(
            checkAvailabilityBlock(
              tx,
              studioId,
              instructor1.id,
              new Date("2024-03-04T18:00:00Z"),
              new Date("2024-03-04T18:30:00Z"),
              locationA.id
            )
          ).rejects.toThrow(InstructorUnavailableError);
        },
        db
      );
    });

    test("throws for a time inside a studio-wide holiday, for any instructor", async () => {
      const { db, owner, instructor1, instructor2, studioId, locationA } = await createFixture("holiday");

      await createBlock(
        owner.id,
        studioId,
        {
          kind: "studio_holiday",
          startAt: new Date("2024-12-25T00:00:00Z"),
          endAt: new Date("2024-12-26T00:00:00Z"),
          label: "Christmas",
        },
        db
      );

      await withTenantContext(
        { userId: owner.id, tenantId: studioId },
        async (tx) => {
          await expect(
            checkAvailabilityBlock(
              tx,
              studioId,
              instructor1.id,
              new Date("2024-12-25T15:00:00Z"),
              new Date("2024-12-25T16:00:00Z"),
              locationA.id
            )
          ).rejects.toThrow(InstructorUnavailableError);

          await expect(
            checkAvailabilityBlock(
              tx,
              studioId,
              instructor2.id,
              new Date("2024-12-25T15:00:00Z"),
              new Date("2024-12-25T16:00:00Z"),
              locationA.id
            )
          ).rejects.toThrow(InstructorUnavailableError);
        },
        db
      );
    });

    test("throws for a time inside another instructor's personal_time_off only if it's THEIR OWN block (not someone else's)", async () => {
      const { db, instructor1, instructor2, studioId, locationA } = await createFixture("personal-time-off");

      await createBlock(
        instructor2.id,
        studioId,
        {
          kind: "personal_time_off",
          instructorUserId: instructor2.id,
          startAt: new Date("2024-03-04T18:00:00Z"),
          endAt: new Date("2024-03-04T19:00:00Z"),
          label: "Dentist",
        },
        db
      );

      await withTenantContext(
        { userId: instructor1.id, tenantId: studioId },
        async (tx) => {
          // Not instructor2's block, so instructor1 is unaffected by it.
          await expect(
            checkAvailabilityBlock(
              tx,
              studioId,
              instructor1.id,
              new Date("2024-03-04T18:15:00Z"),
              new Date("2024-03-04T18:45:00Z"),
              locationA.id
            )
          ).resolves.toBeUndefined();

          // But instructor2 themselves IS blocked by their own time off.
          await expect(
            checkAvailabilityBlock(
              tx,
              studioId,
              instructor2.id,
              new Date("2024-03-04T18:15:00Z"),
              new Date("2024-03-04T18:45:00Z"),
              locationA.id
            )
          ).rejects.toThrow(InstructorUnavailableError);
        },
        db
      );
    });
  });
});
