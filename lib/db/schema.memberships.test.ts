// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "./testing/test-database";
import { studios, roles, memberships, users } from "./schema";
import * as schema from "./schema";

describe("memberships RLS", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  test("a user sees their own memberships across studios with no tenant context set, but not another user's", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    const studioA = "77777777-7777-7777-7777-777777777777";
    const studioB = "88888888-8888-8888-8888-888888888888";
    await seedDb.insert(studios).values([
      { id: studioA, name: "Studio A" },
      { id: studioB, name: "Studio B" },
    ]);
    const [roleA] = await seedDb
      .insert(roles)
      .values({ studioId: studioA, code: "owner", name: "Owner" })
      .returning();
    const [roleB] = await seedDb
      .insert(roles)
      .values({ studioId: studioB, code: "owner", name: "Owner" })
      .returning();
    const [userX] = await seedDb
      .insert(users)
      .values({ email: "x@example.com" })
      .returning();
    const [userY] = await seedDb
      .insert(users)
      .values({ email: "y@example.com" })
      .returning();
    await seedDb.insert(memberships).values([
      { studioId: studioA, userId: userX.id, roleId: roleA.id },
      { studioId: studioB, userId: userX.id, roleId: roleB.id },
      { studioId: studioA, userId: userY.id, roleId: roleA.id },
    ]);
    await seedPool.end();

    const runtimePool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    const runtimeDb = drizzle(runtimePool, { schema });
    const rows = await runtimeDb.transaction(async (tx) => {
      await tx.execute(`select set_config('app.user_id', '${userX.id}', true)`);
      return tx.select().from(memberships);
    });
    await runtimePool.end();

    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.userId === userX.id)).toBe(true);
  });

  test("an insert into a studio outside the current tenant context is rejected even for the acting user's own row", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    const studioA = "99999999-9999-9999-9999-999999999999";
    await seedDb.insert(studios).values({ id: studioA, name: "Studio A" });
    const [roleA] = await seedDb
      .insert(roles)
      .values({ studioId: studioA, code: "owner", name: "Owner" })
      .returning();
    const [userZ] = await seedDb
      .insert(users)
      .values({ email: "z@example.com" })
      .returning();
    await seedPool.end();

    const runtimePool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    const runtimeDb = drizzle(runtimePool, { schema });
    await expect(
      runtimeDb.transaction(async (tx) => {
        // No app.tenant_id set at all — studio_id::text can never equal
        // an unset setting, so the WITH CHECK must reject this insert.
        await tx.execute(`select set_config('app.user_id', '${userZ.id}', true)`);
        await tx.insert(memberships).values({
          studioId: studioA,
          userId: userZ.id,
          roleId: roleA.id,
        });
      })
    ).rejects.toThrow();
    await runtimePool.end();
  });
});
