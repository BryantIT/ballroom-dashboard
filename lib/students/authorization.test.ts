// lib/students/authorization.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "../db/testing/test-database";
import { users, students, studentAssignments, roles, memberships } from "../db/schema";
import * as schema from "../db/schema";
import { and, eq } from "drizzle-orm";

describe("student authorization", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let provisionStudio: typeof import("../studios/provision").provisionStudio;
  let isAssignedInstructor: typeof import("./authorization").isAssignedInstructor;
  let canEditStudent: typeof import("./authorization").canEditStudent;
  let withTenantContext: typeof import("../db/with-tenant-context").withTenantContext;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ provisionStudio } = await import("../studios/provision"));
    ({ isAssignedInstructor, canEditStudent } = await import("./authorization"));
    ({ withTenantContext } = await import("../db/with-tenant-context"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  test("an admin can edit any student via students.update_all, assigned or not", async () => {
    const db = drizzle(pool, { schema });
    const [owner] = await db.insert(users).values({ email: "owner@example.com" }).returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    // students is RLS-protected (app.studio_id-keyed tenant_isolation
    // policy), so — like every tenant-table write in this codebase — this
    // insert must run inside a transaction with app.tenant_id set via
    // withTenantContext. Without it, the plain insert the brief specifies
    // is rejected by the WITH CHECK clause.
    const [student] = await withTenantContext(
      { userId: owner.id, tenantId: studioId },
      (tx) => tx.insert(students).values({ studioId, displayName: "Alex" }).returning(),
      db
    );

    expect(await canEditStudent({ userId: owner.id, studioId }, student.id, db)).toBe(true);
  });

  test("an instructor can edit only a student they are currently assigned to", async () => {
    const db = drizzle(pool, { schema });
    const [owner] = await db.insert(users).values({ email: "owner2@example.com" }).returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const [instructor] = await db.insert(users).values({ email: "instructor@example.com" }).returning();

    // students/memberships/student_assignments are all RLS-protected, so
    // this setup runs inside withTenantContext — same note as the admin
    // test above.
    const { assigned, unassigned } = await withTenantContext(
      { userId: owner.id, tenantId: studioId },
      async (tx) => {
        const [assigned] = await tx
          .insert(students)
          .values({ studioId, displayName: "Assigned" })
          .returning();
        const [unassigned] = await tx
          .insert(students)
          .values({ studioId, displayName: "Unassigned" })
          .returning();

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
        await tx.insert(studentAssignments).values({
          studentId: assigned.id,
          studioId,
          instructorUserId: instructor.id,
        });

        return { assigned, unassigned };
      },
      db
    );

    expect(await isAssignedInstructor(instructor.id, assigned.id, studioId, db)).toBe(true);
    expect(await isAssignedInstructor(instructor.id, unassigned.id, studioId, db)).toBe(false);
    expect(
      await canEditStudent({ userId: instructor.id, studioId }, assigned.id, db)
    ).toBe(true);
    expect(
      await canEditStudent({ userId: instructor.id, studioId }, unassigned.id, db)
    ).toBe(false);
  });

  test("an ended assignment no longer grants edit access", async () => {
    const db = drizzle(pool, { schema });
    const [owner] = await db.insert(users).values({ email: "owner3@example.com" }).returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const [instructor] = await db.insert(users).values({ email: "instructor2@example.com" }).returning();

    // Same RLS note as the instructor test above.
    const { student } = await withTenantContext(
      { userId: owner.id, tenantId: studioId },
      async (tx) => {
        const [student] = await tx
          .insert(students)
          .values({ studioId, displayName: "Former" })
          .returning();
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
        await tx.insert(studentAssignments).values({
          studentId: student.id,
          studioId,
          instructorUserId: instructor.id,
          endedAt: new Date(Date.now() - 1000),
        });
        return { student };
      },
      db
    );

    expect(await isAssignedInstructor(instructor.id, student.id, studioId, db)).toBe(false);
  });
});
