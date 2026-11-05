// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  createTestDatabase,
  type TestDatabase,
} from "@/lib/db/testing/test-database";
import { tenantProbe } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";

describe("GET /api/_internal/tenant-probe", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
  }, 60_000);

  afterAll(async () => {
    // GET() below imports lib/db/client.ts, whose module-level Pool reads
    // DATABASE_RUNTIME_URL at import time and is never closed by app code
    // (it's a long-lived singleton in production). Left open here, it
    // outlives testDb.stop() below and throws an unhandled "terminating
    // connection due to administrator command" when the container dies
    // out from under it.
    const { db } = await import("@/lib/db/client");
    await db.$client.end();
    await testDb.stop();
  });

  test("an authenticated request with no tenant context returns zero rows, even though other tenants' rows exist", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    await seedDb.insert(tenantProbe).values([
      { studioId: "99999999-9999-9999-9999-999999999999", label: "tenant-a" },
      { studioId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", label: "tenant-b" },
    ]);
    await seedPool.end();

    const { GET } = await import("./route");
    const response = await GET();
    const body = await response.json();

    expect(body.rows).toHaveLength(0);
  });
});
