// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "./testing/test-database";
import { studios, roles, rolePermissions } from "./schema";
import * as schema from "./schema";

describe("roles/role_permissions RLS", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  test("a runtime connection only sees roles and grants for the tenant in context", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    const studioA = "55555555-5555-5555-5555-555555555555";
    const studioB = "66666666-6666-6666-6666-666666666666";
    await seedDb.insert(studios).values([
      { id: studioA, name: "Studio A" },
      { id: studioB, name: "Studio B" },
    ]);
    const [roleA] = await seedDb
      .insert(roles)
      .values({ studioId: studioA, code: "owner", name: "Owner" })
      .returning();
    await seedDb.insert(roles).values({ studioId: studioB, code: "owner", name: "Owner" });
    await seedDb.insert(rolePermissions).values({
      roleId: roleA.id,
      permissionCode: "students.read",
      studioId: studioA,
    });
    await seedPool.end();

    const runtimePool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    const runtimeDb = drizzle(runtimePool, { schema });
    const rows = await runtimeDb.transaction(async (tx) => {
      await tx.execute(`select set_config('app.tenant_id', '${studioA}', true)`);
      return {
        roles: await tx.select().from(roles),
        grants: await tx.select().from(rolePermissions),
      };
    });
    await runtimePool.end();

    expect(rows.roles).toHaveLength(1);
    expect(rows.roles[0].studioId).toBe(studioA);
    expect(rows.grants).toHaveLength(1);
  });
});
