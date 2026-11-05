import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "./testing/test-database";
import { withTenantContext } from "./with-tenant-context";
import { tenantProbe } from "./schema";
import * as schema from "./schema";

describe("withTenantContext", () => {
  let testDb: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  test("a query run without a tenantId sees zero rows", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    await seedDb.insert(tenantProbe).values({
      studioId: "66666666-6666-6666-6666-666666666666",
      label: "seeded",
    });
    await seedPool.end();

    const db = drizzle(pool, { schema });
    const rows = await withTenantContext(
      { userId: "test-user", tenantId: null },
      (tx) => tx.select().from(tenantProbe),
      db
    );

    expect(rows).toHaveLength(0);
  });

  test("a query run with a tenantId sees only that tenant's rows", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    const studioId = "77777777-7777-7777-7777-777777777777";
    await seedDb.insert(tenantProbe).values([
      { studioId, label: "mine" },
      { studioId: "88888888-8888-8888-8888-888888888888", label: "not-mine" },
    ]);
    await seedPool.end();

    const db = drizzle(pool, { schema });
    const rows = await withTenantContext(
      { userId: "test-user", tenantId: studioId },
      (tx) => tx.select().from(tenantProbe),
      db
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("mine");
  });
});
