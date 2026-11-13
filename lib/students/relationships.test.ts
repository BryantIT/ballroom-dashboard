// lib/students/relationships.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "../db/testing/test-database";
import { users, students, roles, memberships } from "../db/schema";
import * as schema from "../db/schema";

describe("student relationships", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let provisionStudio: typeof import("../studios/provision").provisionStudio;
  let linkStudents: typeof import("./relationships").linkStudents;
  let listRelatedStudents: typeof import("./relationships").listRelatedStudents;
  let SelfRelationshipError: typeof import("./relationships").SelfRelationshipError;
  let DuplicateRelationshipError: typeof import("./relationships").DuplicateRelationshipError;
  let PermissionDeniedError: typeof import("../auth/authorization").PermissionDeniedError;
  let withTenantContext: typeof import("../db/with-tenant-context").withTenantContext;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ provisionStudio } = await import("../studios/provision"));
    ({ linkStudents, listRelatedStudents, SelfRelationshipError, DuplicateRelationshipError } =
      await import("./relationships"));
    ({ withTenantContext } = await import("../db/with-tenant-context"));
    ({ PermissionDeniedError } = await import("../auth/authorization"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  async function createOwnerAndStudents(emailSuffix: string) {
    const db = drizzle(pool, { schema });
    const [owner] = await db
      .insert(users)
      .values({ email: `owner-${emailSuffix}@example.com` })
      .returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const { studentA, studentB } = await withTenantContext(
      { userId: owner.id, tenantId: studioId },
      async (tx) => {
        const [studentA] = await tx
          .insert(students)
          .values({ studioId, displayName: "Alex" })
          .returning();
        const [studentB] = await tx
          .insert(students)
          .values({ studioId, displayName: "Blair" })
          .returning();
        return { studentA, studentB };
      },
      db
    );
    return { db, owner, studioId, studentA, studentB };
  }

  test("links two students and lists the relationship from either side", async () => {
    const { db, owner, studioId, studentA, studentB } = await createOwnerAndStudents("link");

    await linkStudents(owner.id, studioId, studentA.id, studentB.id, db);

    expect(await listRelatedStudents(studioId, studentA.id, db)).toEqual([studentB.id]);
    expect(await listRelatedStudents(studioId, studentB.id, db)).toEqual([studentA.id]);
  });

  test("rejects linking a student to themselves", async () => {
    const { db, owner, studioId, studentA } = await createOwnerAndStudents("self");

    await expect(
      linkStudents(owner.id, studioId, studentA.id, studentA.id, db)
    ).rejects.toThrow(SelfRelationshipError);
  });

  test("rejects linking the same pair twice, in either order", async () => {
    const { db, owner, studioId, studentA, studentB } = await createOwnerAndStudents("dup");

    await linkStudents(owner.id, studioId, studentA.id, studentB.id, db);

    await expect(
      linkStudents(owner.id, studioId, studentB.id, studentA.id, db)
    ).rejects.toThrow(DuplicateRelationshipError);
  });

  test("a non-Owner/Admin cannot link students", async () => {
    const { db, owner, studioId, studentA, studentB } = await createOwnerAndStudents("perm");
    const [instructor] = await db
      .insert(users)
      .values({ email: "instructor-relationships@example.com" })
      .returning();
    // roles/memberships are RLS-protected, so this setup runs inside
    // withTenantContext — same note as lib/students/authorization.test.ts.
    await withTenantContext(
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
      },
      db
    );

    await expect(
      linkStudents(instructor.id, studioId, studentA.id, studentB.id, db)
    ).rejects.toThrow(PermissionDeniedError);
  });
});
