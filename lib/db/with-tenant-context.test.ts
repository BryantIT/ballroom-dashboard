// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "./testing/test-database";
import type { withTenantContext as WithTenantContext } from "./with-tenant-context";
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

  // Phase 0's throwaway tenant_probe table (and its tests) is decommissioned
  // in Phase 1 (Task 11) now that real tenant-owned tables exist. These
  // scenarios are ported onto `studios` — the simplest real RLS-protected
  // table (policy: `id::text = current_setting('app.tenant_id', true)`) —
  // preserving the original assertions.
  test("a query run without a tenantId sees zero rows", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    await seedDb.insert(schema.studios).values({
      id: "66666666-6666-6666-6666-666666666666",
      name: "seeded",
    });
    await seedPool.end();

    const db = drizzle(pool, { schema });
    const rows = await withTenantContext(
      { userId: "test-user", tenantId: null },
      (tx) => tx.select().from(schema.studios),
      db
    );

    expect(rows).toHaveLength(0);
  });

  test("a query run with a tenantId sees only that tenant's rows", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    const studioId = "77777777-7777-7777-7777-777777777777";
    await seedDb.insert(schema.studios).values([
      { id: studioId, name: "mine" },
      { id: "88888888-8888-8888-8888-888888888888", name: "not-mine" },
    ]);
    await seedPool.end();

    const db = drizzle(pool, { schema });
    const rows = await withTenantContext(
      { userId: "test-user", tenantId: studioId },
      (tx) => tx.select().from(schema.studios),
      db
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("mine");
  });

  test("does not leak tenant context across calls sharing one pooled connection", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    const studioA = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const studioB = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    await seedDb.insert(schema.studios).values([
      { id: studioA, name: "a" },
      { id: studioB, name: "b" },
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
      (tx) => tx.select().from(schema.studios),
      singleConnDb
    );
    expect(asStudioA).toHaveLength(1);
    expect(asStudioA[0].id).toBe(studioA);

    const withNoTenant = await withTenantContext(
      { userId: "test-user", tenantId: null },
      (tx) => tx.select().from(schema.studios),
      singleConnDb
    );
    expect(withNoTenant).toHaveLength(0);

    const asStudioB = await withTenantContext(
      { userId: "test-user", tenantId: studioB },
      (tx) => tx.select().from(schema.studios),
      singleConnDb
    );
    expect(asStudioB).toHaveLength(1);
    expect(asStudioB[0].id).toBe(studioB);

    await singleConnPool.end();
  });
});
