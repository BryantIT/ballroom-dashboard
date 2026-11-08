// lib/auth/authorization.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "../db/testing/test-database";
import { users } from "../db/schema";
import * as schema from "../db/schema";

describe("authorization helpers", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let provisionStudio: typeof import("../studios/provision").provisionStudio;
  let getActiveMembership: typeof import("./authorization").getActiveMembership;
  let hasPermission: typeof import("./authorization").hasPermission;
  let requirePermission: typeof import("./authorization").requirePermission;
  let PermissionDeniedError: typeof import("./authorization").PermissionDeniedError;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ provisionStudio } = await import("../studios/provision"));
    ({ getActiveMembership, hasPermission, requirePermission, PermissionDeniedError } =
      await import("./authorization"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  test("the owner of a newly provisioned studio has every owner-level permission", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    const [owner] = await seedDb.insert(users).values({ email: "o1@example.com" }).returning();
    await seedPool.end();

    const db = drizzle(pool, { schema });
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );

    const membership = await getActiveMembership(owner.id, studioId, db);
    expect(membership?.roleCode).toBe("owner");
    expect(await hasPermission(owner.id, studioId, "users.manage", db)).toBe(true);
  });

  test("a user with no membership in a studio has no permissions there, even with a valid user id", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    const [owner] = await seedDb.insert(users).values({ email: "o2@example.com" }).returning();
    const [outsider] = await seedDb.insert(users).values({ email: "intruder@example.com" }).returning();
    await seedPool.end();

    const db = drizzle(pool, { schema });
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );

    expect(await getActiveMembership(outsider.id, studioId, db)).toBeNull();
    expect(await hasPermission(outsider.id, studioId, "students.read", db)).toBe(false);
    await expect(requirePermission(outsider.id, studioId, "students.read", db)).rejects.toThrow(
      PermissionDeniedError
    );
  });

  test("an instructor lacks owner-only permissions like users.manage and locations.manage", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    const [owner] = await seedDb.insert(users).values({ email: "o3@example.com" }).returning();
    const [instructor] = await seedDb.insert(users).values({ email: "i1@example.com" }).returning();
    await seedPool.end();

    const db = drizzle(pool, { schema });
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );

    // These two queries hit RLS-protected tables (app.roles, app.memberships)
    // over the app_runtime-role pool, so — like every tenant-scoped query in
    // this codebase, including the implementation under test — they must run
    // inside a transaction with app.tenant_id set via withTenantContext.
    // Without it, the plain select the brief's correction specifies returns
    // no rows (RLS silently filters them), and the subsequent insert would
    // fail memberships' tenant_write WITH CHECK policy.
    const { eq, and } = await import("drizzle-orm");
    const { withTenantContext } = await import("../db/with-tenant-context");
    await withTenantContext(
      { userId: owner.id, tenantId: studioId },
      async (tx) => {
        const [instructorRole] = await tx
          .select()
          .from(schema.roles)
          .where(and(eq(schema.roles.studioId, studioId), eq(schema.roles.code, "instructor")));

        await tx.insert(schema.memberships).values({
          studioId,
          userId: instructor.id,
          roleId: instructorRole.id,
          status: "active",
        });
      },
      db
    );

    expect(await hasPermission(instructor.id, studioId, "progress.record_assigned", db)).toBe(true);
    expect(await hasPermission(instructor.id, studioId, "users.manage", db)).toBe(false);
    expect(await hasPermission(instructor.id, studioId, "locations.manage", db)).toBe(false);
  });

  test("a deactivated membership loses all permissions immediately", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    const [owner] = await seedDb.insert(users).values({ email: "o4@example.com" }).returning();
    const [admin] = await seedDb.insert(users).values({ email: "a1@example.com" }).returning();
    await seedPool.end();

    const db = drizzle(pool, { schema });
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );

    // Same RLS note as the instructor test above: these queries run inside
    // withTenantContext because the plain select/insert/update the brief
    // specifies would otherwise be blocked by RLS on app.roles/app.memberships.
    const { eq, and } = await import("drizzle-orm");
    const { withTenantContext } = await import("../db/with-tenant-context");
    const membership = await withTenantContext(
      { userId: owner.id, tenantId: studioId },
      async (tx) => {
        const [adminRole] = await tx
          .select()
          .from(schema.roles)
          .where(and(eq(schema.roles.studioId, studioId), eq(schema.roles.code, "admin")));
        const [m] = await tx
          .insert(schema.memberships)
          .values({ studioId, userId: admin.id, roleId: adminRole.id, status: "active" })
          .returning();
        return m;
      },
      db
    );

    expect(await hasPermission(admin.id, studioId, "students.read", db)).toBe(true);

    await withTenantContext(
      { userId: owner.id, tenantId: studioId },
      async (tx) => {
        await tx
          .update(schema.memberships)
          .set({ status: "inactive" })
          .where(eq(schema.memberships.id, membership.id));
      },
      db
    );

    expect(await hasPermission(admin.id, studioId, "students.read", db)).toBe(false);
  });
});
