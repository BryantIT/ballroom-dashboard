// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "./testing/test-database";
import type { withTenantContext as WithTenantContext } from "./with-tenant-context";
import { tenantProbe } from "./schema";
import * as schema from "./schema";

describe("withTenantContext", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let withTenantContext: typeof WithTenantContext;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    // lib/db/with-tenant-context.ts imports lib/db/client.ts, which now
    // throws eagerly at import time if DATABASE_RUNTIME_URL isn't set (see
    // lib/db/client.ts). Set it and import dynamically, after the test
    // database is up, instead of statically at module load.
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ withTenantContext } = await import("./with-tenant-context"));
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

  test("does not leak tenant context across calls sharing one pooled connection", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    const studioA = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const studioB = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    await seedDb.insert(tenantProbe).values([
      { studioId: studioA, label: "a" },
      { studioId: studioB, label: "b" },
    ]);
    await seedPool.end();

    // max: 1 forces every withTenantContext call below to reuse the SAME
    // underlying physical connection, which is exactly the scenario the
    // JSDoc's "never leaks" claim is about.
    const singleConnPool = new Pool({
      connectionString: testDb.runtimeConnectionUri,
      max: 1,
    });
    const singleConnDb = drizzle(singleConnPool, { schema });

    const asStudioA = await withTenantContext(
      { userId: "test-user", tenantId: studioA },
      (tx) => tx.select().from(tenantProbe),
      singleConnDb
    );
    expect(asStudioA).toHaveLength(1);
    expect(asStudioA[0].studioId).toBe(studioA);

    const withNoTenant = await withTenantContext(
      { userId: "test-user", tenantId: null },
      (tx) => tx.select().from(tenantProbe),
      singleConnDb
    );
    expect(withNoTenant).toHaveLength(0);

    const asStudioB = await withTenantContext(
      { userId: "test-user", tenantId: studioB },
      (tx) => tx.select().from(tenantProbe),
      singleConnDb
    );
    expect(asStudioB).toHaveLength(1);
    expect(asStudioB[0].studioId).toBe(studioB);

    await singleConnPool.end();
  });
});
