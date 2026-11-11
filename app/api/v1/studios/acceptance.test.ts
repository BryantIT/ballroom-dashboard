// app/api/v1/studios/acceptance.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import {
  createTestDatabase,
  type TestDatabase,
} from "@/lib/db/testing/test-database";
import { users, roles, memberships, students, studentAssignments } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";

describe("Phase 1 acceptance tests", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let provisionStudio: typeof import("@/lib/studios/provision").provisionStudio;
  let requirePermission: typeof import("@/lib/auth/authorization").requirePermission;
  let PermissionDeniedError: typeof import("@/lib/auth/authorization").PermissionDeniedError;
  let canEditStudent: typeof import("@/lib/students/authorization").canEditStudent;
  let withTenantContext: typeof import("@/lib/db/with-tenant-context").withTenantContext;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ provisionStudio } = await import("@/lib/studios/provision"));
    ({ requirePermission, PermissionDeniedError } = await import("@/lib/auth/authorization"));
    ({ canEditStudent } = await import("@/lib/students/authorization"));
    ({ withTenantContext } = await import("@/lib/db/with-tenant-context"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  test("#1: a user with memberships in Studio A and Studio B gets independent permissions in each, with no leakage", async () => {
    const db = drizzle(pool, { schema });
    const [user] = await db.insert(users).values({ email: "multi@example.com" }).returning();

    const { studioId: studioA } = await provisionStudio(
      { ownerId: user.id, studioName: "A", timezone: "America/Chicago" },
      db
    );
    const { studioId: studioB } = await provisionStudio(
      { ownerId: user.id, studioName: "B", timezone: "America/Chicago" },
      db
    );

    // user is Owner (full access) in both, by construction of
    // provisionStudio — demote their Studio B membership to Instructor
    // to prove the two studios' grants are genuinely independent.
    //
    // roles/memberships are RLS-protected, so — like every tenant-scoped
    // query in this codebase, including the implementation under test —
    // this lookup/update must run inside a transaction with app.tenant_id
    // set via withTenantContext. Without it, the plain select/update
    // returns no rows / is rejected by the tenant_write WITH CHECK clause
    // (same correction Task 6 and Task 9 already made to their own tests).
    await withTenantContext(
      { userId: user.id, tenantId: studioB },
      async (tx) => {
        const [instructorRoleB] = await tx
          .select()
          .from(roles)
          .where(and(eq(roles.studioId, studioB), eq(roles.code, "instructor")));
        await tx
          .update(memberships)
          .set({ roleId: instructorRoleB.id })
          .where(and(eq(memberships.studioId, studioB), eq(memberships.userId, user.id)));
      },
      db
    );

    await expect(requirePermission(user.id, studioA, "users.manage", db)).resolves.toBeTruthy();
    await expect(requirePermission(user.id, studioB, "users.manage", db)).rejects.toThrow(
      PermissionDeniedError
    );
  });

  test("#2 (partial — full coverage lands in Phase 3): an instructor sees/edits only assigned students, never an unassigned one", async () => {
    const db = drizzle(pool, { schema });
    const [owner] = await db.insert(users).values({ email: "owner-at2@example.com" }).returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const [instructor] = await db
      .insert(users)
      .values({ email: "instructor-at2@example.com" })
      .returning();
    // roles/memberships/students/student_assignments are all RLS-protected
    // — same correction as test #1 above, wrapping the setup in
    // withTenantContext so the lookups/inserts aren't silently blocked.
    const { assigned, unassigned } = await withTenantContext(
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

        const [assigned] = await tx
          .insert(students)
          .values({ studioId, displayName: "Assigned" })
          .returning();
        const [unassigned] = await tx
          .insert(students)
          .values({ studioId, displayName: "Unassigned" })
          .returning();
        await tx.insert(studentAssignments).values({
          studentId: assigned.id,
          studioId,
          instructorUserId: instructor.id,
        });

        return { assigned, unassigned };
      },
      db
    );

    expect(await canEditStudent({ userId: instructor.id, studioId }, assigned.id, db)).toBe(true);
    expect(await canEditStudent({ userId: instructor.id, studioId }, unassigned.id, db)).toBe(
      false
    );
  });

  test("#3: a forged studioId for a studio the caller has no membership in is rejected", async () => {
    const db = drizzle(pool, { schema });
    const [ownerA] = await db.insert(users).values({ email: "a@example.com" }).returning();
    const [ownerB] = await db.insert(users).values({ email: "b@example.com" }).returning();
    const { studioId: studioA } = await provisionStudio(
      { ownerId: ownerA.id, studioName: "A", timezone: "America/Chicago" },
      db
    );
    await provisionStudio(
      { ownerId: ownerB.id, studioName: "B", timezone: "America/Chicago" },
      db
    );

    // ownerB tries studioA's id directly — as if they'd edited the URL.
    await expect(requirePermission(ownerB.id, studioA, "students.read", db)).rejects.toThrow(
      PermissionDeniedError
    );
  });

  test("#13: a list query always stays within the tenant in context, never exposing another studio's rows", async () => {
    const db = drizzle(pool, { schema });
    const [ownerA] = await db.insert(users).values({ email: "list-a@example.com" }).returning();
    const [ownerB] = await db.insert(users).values({ email: "list-b@example.com" }).returning();
    const { studioId: studioA } = await provisionStudio(
      { ownerId: ownerA.id, studioName: "A", timezone: "America/Chicago" },
      db
    );
    const { studioId: studioB } = await provisionStudio(
      { ownerId: ownerB.id, studioName: "B", timezone: "America/Chicago" },
      db
    );
    // students is RLS-protected; a single multi-row insert can't satisfy
    // one tenant's WITH CHECK for rows belonging to two different studios
    // at once, so each studio's row is inserted under its own tenant
    // context (same correction as tests #1/#2 above).
    await withTenantContext(
      { userId: ownerA.id, tenantId: studioA },
      (tx) => tx.insert(students).values({ studioId: studioA, displayName: "A1" }),
      db
    );
    await withTenantContext(
      { userId: ownerB.id, tenantId: studioB },
      (tx) => tx.insert(students).values({ studioId: studioB, displayName: "B1" }),
      db
    );

    const rowsForA = await withTenantContext({ userId: ownerA.id, tenantId: studioA }, (tx) =>
      tx.select().from(students),
      db
    );
    expect(rowsForA).toHaveLength(1);
    expect(rowsForA[0].displayName).toBe("A1");
  });

  test("#15: missing tenant context produces no tenant-owned rows under RLS (regression, now against real tables)", async () => {
    const db = drizzle(pool, { schema });
    const [owner] = await db.insert(users).values({ email: "regression@example.com" }).returning();
    await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );

    const rows = await withTenantContext({ userId: owner.id, tenantId: null }, (tx) =>
      tx.select().from(schema.studios),
      db
    );
    expect(rows).toHaveLength(0);
  });
});
