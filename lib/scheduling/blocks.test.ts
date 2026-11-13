// lib/scheduling/blocks.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "../db/testing/test-database";
import { users, locations, roles, memberships } from "../db/schema";
import * as schema from "../db/schema";

describe("instructor availability blocks", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let provisionStudio: typeof import("../studios/provision").provisionStudio;
  let createBlock: typeof import("./blocks").createBlock;
  let getBlockLabel: typeof import("./blocks").getBlockLabel;
  let listBlocksInRange: typeof import("./blocks").listBlocksInRange;
  let createBlockSchema: typeof import("../validation/scheduling").createBlockSchema;
  let assignInstructorToLocation: typeof import("./instructor-locations").assignInstructorToLocation;
  let PermissionDeniedError: typeof import("../auth/authorization").PermissionDeniedError;
  let withTenantContext: typeof import("../db/with-tenant-context").withTenantContext;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ provisionStudio } = await import("../studios/provision"));
    ({ createBlock, getBlockLabel, listBlocksInRange } = await import("./blocks"));
    ({ createBlockSchema } = await import("../validation/scheduling"));
    ({ assignInstructorToLocation } = await import("./instructor-locations"));
    ({ withTenantContext } = await import("../db/with-tenant-context"));
    ({ PermissionDeniedError } = await import("../auth/authorization"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  async function createOwnerAndInstructor(emailSuffix: string, timezone = "America/Chicago") {
    const db = drizzle(pool, { schema });
    const [owner] = await db
      .insert(users)
      .values({ email: `owner-ib-${emailSuffix}@example.com` })
      .returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const [instructor] = await db
      .insert(users)
      .values({ email: `instructor-ib-${emailSuffix}@example.com` })
      .returning();
    const { location } = await withTenantContext(
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
        const [location] = await tx
          .insert(locations)
          .values({ studioId, name: "Main Studio", timezone })
          .returning();
        return { location };
      },
      db
    );
    return { db, owner, instructor, studioId, location };
  }

  describe("createBlock", () => {
    test("an instructor can create their own personal_time_off block", async () => {
      const { db, instructor, studioId } = await createOwnerAndInstructor("self");

      const block = await createBlock(
        instructor.id,
        studioId,
        {
          kind: "personal_time_off",
          instructorUserId: instructor.id,
          startAt: new Date("2024-03-01T18:00:00Z"),
          endAt: new Date("2024-03-01T20:00:00Z"),
          label: "Dentist",
        },
        db
      );

      expect(block.instructorUserId).toBe(instructor.id);
      expect(block.kind).toBe("personal_time_off");
      expect(block.label).toBe("Dentist");
    });

    test("an instructor cannot create a personal_time_off block for a different instructor without appointments.manage_all", async () => {
      const { db, instructor, studioId } = await createOwnerAndInstructor("other");
      const [otherInstructor] = await db
        .insert(users)
        .values({ email: "other-instructor-ib@example.com" })
        .returning();

      await expect(
        createBlock(
          instructor.id,
          studioId,
          {
            kind: "personal_time_off",
            instructorUserId: otherInstructor.id,
            startAt: new Date("2024-03-01T18:00:00Z"),
            endAt: new Date("2024-03-01T20:00:00Z"),
          },
          db
        )
      ).rejects.toThrow(PermissionDeniedError);
    });

    test("creating a studio_holiday requires appointments.manage_all even for the block's own instructor field being null", async () => {
      const { db, instructor, studioId } = await createOwnerAndInstructor("holiday");

      await expect(
        createBlock(
          instructor.id,
          studioId,
          {
            kind: "studio_holiday",
            startAt: new Date("2024-12-25T00:00:00Z"),
            endAt: new Date("2024-12-26T00:00:00Z"),
            label: "Christmas",
          },
          db
        )
      ).rejects.toThrow(PermissionDeniedError);
    });

    test("an Owner can create a studio_holiday", async () => {
      const { db, owner, studioId } = await createOwnerAndInstructor("holiday-owner");

      const block = await createBlock(
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

      expect(block.instructorUserId).toBeNull();
      expect(block.kind).toBe("studio_holiday");
    });
  });

  describe("createBlockSchema", () => {
    test("regular_day_off rejects a payload that also includes startAt/endAt", () => {
      const result = createBlockSchema.safeParse({
        kind: "regular_day_off",
        instructorUserId: "00000000-0000-0000-0000-000000000000",
        dayOfWeek: 1,
        startTime: "09:00",
        endTime: "17:00",
        startAt: new Date("2024-03-01T18:00:00Z"),
        endAt: new Date("2024-03-01T20:00:00Z"),
      });

      expect(result.success).toBe(false);
    });

    test("a valid regular_day_off payload parses successfully", () => {
      const result = createBlockSchema.safeParse({
        kind: "regular_day_off",
        instructorUserId: "00000000-0000-0000-0000-000000000000",
        dayOfWeek: 1,
        startTime: "09:00",
        endTime: "17:00",
      });

      expect(result.success).toBe(true);
    });
  });

  describe("getBlockLabel", () => {
    const block = { instructorUserId: "instructor-1", label: "Dentist appointment" };

    test("reveals the label to the block's own instructor", () => {
      expect(getBlockLabel("instructor-1", block, false)).toBe("Dentist appointment");
    });

    test("hides the label from someone else without viewerCanSeeAllLabels", () => {
      expect(getBlockLabel("someone-else", block, false)).toBeNull();
    });

    test("reveals the label to a viewer with viewerCanSeeAllLabels=true", () => {
      expect(getBlockLabel("someone-else", block, true)).toBe("Dentist appointment");
    });
  });

  describe("listBlocksInRange", () => {
    test("expands a Monday regular_day_off into every Monday in the given range", async () => {
      const { db, owner, instructor, studioId, location } = await createOwnerAndInstructor(
        "weekly",
        "America/Chicago"
      );
      await assignInstructorToLocation(owner.id, studioId, instructor.id, location.id, db);

      await createBlock(
        instructor.id,
        studioId,
        {
          kind: "regular_day_off",
          instructorUserId: instructor.id,
          dayOfWeek: 1, // Monday
          startTime: "09:00",
          endTime: "10:00",
        },
        db
      );

      // 2024-01-01T00:00:00Z is a Monday; 3 weeks later is also a Monday.
      // "America/Chicago" is UTC-6 in January (no DST), so each occurrence
      // starts well inside its own local-calendar-date Monday with no
      // boundary ambiguity in this test.
      const startAt = new Date("2024-01-01T00:00:00Z");
      const endAt = new Date("2024-01-22T00:00:00Z");

      const resolved = await listBlocksInRange(studioId, startAt, endAt, db);

      expect(resolved).toHaveLength(3);
      const localDates = resolved
        .map((occurrence) => occurrence.startAt.toISOString())
        .sort();
      expect(localDates).toEqual([
        "2024-01-01T15:00:00.000Z", // Jan 1 09:00 CST = 15:00 UTC
        "2024-01-08T15:00:00.000Z",
        "2024-01-15T15:00:00.000Z",
      ]);
    });

    test("resolves dayOfWeek in the location's timezone, not UTC", async () => {
      const { db, owner, instructor, studioId, location } = await createOwnerAndInstructor(
        "tz",
        "America/Los_Angeles"
      );
      await assignInstructorToLocation(owner.id, studioId, instructor.id, location.id, db);

      // Monday 22:00-23:59 PST (America/Los_Angeles, UTC-8 in January).
      await createBlock(
        instructor.id,
        studioId,
        {
          kind: "regular_day_off",
          instructorUserId: instructor.id,
          dayOfWeek: 1, // Monday
          startTime: "22:00",
          endTime: "23:59",
        },
        db
      );

      // Range: [Tue 2024-01-02T06:00:00Z, Tue 2024-01-02T08:00:00Z).
      // In America/Los_Angeles that instant range is
      // [Mon 2024-01-01T22:00:00, Tue 2024-01-02T00:00:00) — entirely
      // still Monday, Jan 1, local time, even though every instant in it
      // falls on Jan 2 (a Tuesday) by UTC's calendar. A UTC-naive
      // implementation that computed the weekday of these instants (or
      // scanned calendar dates) using UTC would see only Tuesday Jan 2 in
      // this window and find zero Monday occurrences. The correct,
      // timezone-aware expansion must still find the Monday occurrence
      // whose 22:00 PST start lands exactly at this range's lower bound.
      const startAt = new Date("2024-01-02T06:00:00Z");
      const endAt = new Date("2024-01-02T08:00:00Z");

      const resolved = await listBlocksInRange(studioId, startAt, endAt, db);

      expect(resolved).toHaveLength(1);
      expect(resolved[0].startAt.toISOString()).toBe("2024-01-02T06:00:00.000Z");
      expect(resolved[0].endAt.toISOString()).toBe("2024-01-02T07:59:00.000Z");
    });

    test("includes one-off personal_time_off/studio_holiday rows as-is when they overlap the range", async () => {
      const { db, owner, instructor, studioId } = await createOwnerAndInstructor("oneoff");

      await createBlock(
        instructor.id,
        studioId,
        {
          kind: "personal_time_off",
          instructorUserId: instructor.id,
          startAt: new Date("2024-05-01T18:00:00Z"),
          endAt: new Date("2024-05-01T20:00:00Z"),
        },
        db
      );
      await createBlock(
        owner.id,
        studioId,
        {
          kind: "studio_holiday",
          startAt: new Date("2024-12-25T00:00:00Z"),
          endAt: new Date("2024-12-26T00:00:00Z"),
        },
        db
      );

      const resolved = await listBlocksInRange(
        studioId,
        new Date("2024-01-01T00:00:00Z"),
        new Date("2024-12-31T00:00:00Z"),
        db
      );

      expect(resolved.map((r) => r.kind).sort()).toEqual(["personal_time_off", "studio_holiday"]);
    });
  });
});
