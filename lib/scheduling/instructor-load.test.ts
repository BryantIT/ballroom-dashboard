// lib/scheduling/instructor-load.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "../db/testing/test-database";
import { users, memberships, roles, students, studentAssignments } from "../db/schema";
import * as schema from "../db/schema";

describe("getInstructorLoad", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let provisionStudio: typeof import("../studios/provision").provisionStudio;
  let withTenantContext: typeof import("../db/with-tenant-context").withTenantContext;
  let getInstructorLoad: typeof import("./instructor-load").getInstructorLoad;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ provisionStudio } = await import("../studios/provision"));
    ({ withTenantContext } = await import("../db/with-tenant-context"));
    ({ getInstructorLoad } = await import("./instructor-load"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  test("returns each instructor's current active student count, not counting ended assignments", async () => {
    const db = drizzle(pool, { schema });
    const [owner] = await db
      .insert(users)
      .values({ email: "owner-load@example.com", name: "Owner Olivia" })
      .returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const [instructorA] = await db
      .insert(users)
      .values({ email: "instructor-a-load@example.com", name: "Instructor Ada" })
      .returning();
    const [instructorB] = await db
      .insert(users)
      .values({ email: "instructor-b-load@example.com", name: "Instructor Ben" })
      .returning();

    await withTenantContext(
      { userId: owner.id, tenantId: studioId },
      async (tx) => {
        const [instructorRole] = await tx
          .select()
          .from(roles)
          .where(and(eq(roles.studioId, studioId), eq(roles.code, "instructor")));
        await tx.insert(memberships).values([
          { studioId, userId: instructorA.id, roleId: instructorRole.id, status: "active" },
          { studioId, userId: instructorB.id, roleId: instructorRole.id, status: "active" },
        ]);

        const created = await tx
          .insert(students)
          .values([
            { studioId, displayName: "Student One" },
            { studioId, displayName: "Student Two" },
            { studioId, displayName: "Student Three" },
          ])
          .returning();

        await tx.insert(studentAssignments).values([
          // Instructor A: two current assignments...
          { studioId, studentId: created[0].id, instructorUserId: instructorA.id },
          { studioId, studentId: created[1].id, instructorUserId: instructorA.id },
          // ...and one ended assignment, which must not be counted.
          {
            studioId,
            studentId: created[2].id,
            instructorUserId: instructorA.id,
            endedAt: new Date("2025-01-01T00:00:00Z"),
          },
        ]);
      },
      db
    );

    const load = await getInstructorLoad(studioId, db);

    const rowA = load.find((row) => row.instructorUserId === instructorA.id);
    const rowB = load.find((row) => row.instructorUserId === instructorB.id);
    expect(rowA).toEqual({
      instructorUserId: instructorA.id,
      name: "Instructor Ada",
      activeStudentCount: 2,
    });
    expect(rowB).toEqual({
      instructorUserId: instructorB.id,
      name: "Instructor Ben",
      activeStudentCount: 0,
    });
    // Owner holds appointments.manage_all, so is a bookable instructor too.
    const rowOwner = load.find((row) => row.instructorUserId === owner.id);
    expect(rowOwner?.activeStudentCount).toBe(0);
  });
});
