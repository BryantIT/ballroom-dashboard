import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Client } from "pg";
import { createTestDatabase, type TestDatabase } from "./test-database";

describe("tenant_probe RLS", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  test("a runtime connection with no tenant context set sees zero rows, even though rows exist for two tenants", async () => {
    const seedClient = new Client({ connectionString: testDb.connectionUri });
    await seedClient.connect();
    const studioA = "11111111-1111-1111-1111-111111111111";
    const studioB = "22222222-2222-2222-2222-222222222222";
    await seedClient.query(
      `INSERT INTO "app"."tenant_probe" (studio_id, label) VALUES ($1, 'a'), ($2, 'b')`,
      [studioA, studioB]
    );
    await seedClient.end();

    const runtimeClient = new Client({
      connectionString: testDb.runtimeConnectionUri,
    });
    await runtimeClient.connect();
    const result = await runtimeClient.query(
      `SELECT * FROM "app"."tenant_probe"`
    );
    await runtimeClient.end();

    expect(result.rows).toHaveLength(0);
  });

  test("setting app.tenant_id via SET LOCAL scopes visible rows to that tenant only", async () => {
    const seedClient = new Client({ connectionString: testDb.connectionUri });
    await seedClient.connect();
    const studioA = "33333333-3333-3333-3333-333333333333";
    const studioB = "44444444-4444-4444-4444-444444444444";
    await seedClient.query(
      `INSERT INTO "app"."tenant_probe" (studio_id, label) VALUES ($1, 'a'), ($2, 'b')`,
      [studioA, studioB]
    );
    await seedClient.end();

    const runtimeClient = new Client({
      connectionString: testDb.runtimeConnectionUri,
    });
    await runtimeClient.connect();
    await runtimeClient.query("BEGIN");
    await runtimeClient.query(
      `SELECT set_config('app.tenant_id', $1, true)`,
      [studioA]
    );
    const result = await runtimeClient.query(
      `SELECT * FROM "app"."tenant_probe"`
    );
    await runtimeClient.query("COMMIT");
    await runtimeClient.end();

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].studio_id).toBe(studioA);
  });

  test("SET LOCAL does not leak tenant context across transactions on the same connection", async () => {
    const seedClient = new Client({ connectionString: testDb.connectionUri });
    await seedClient.connect();
    const studioA = "55555555-5555-5555-5555-555555555555";
    await seedClient.query(
      `INSERT INTO "app"."tenant_probe" (studio_id, label) VALUES ($1, 'a')`,
      [studioA]
    );
    await seedClient.end();

    const runtimeClient = new Client({
      connectionString: testDb.runtimeConnectionUri,
    });
    await runtimeClient.connect();

    await runtimeClient.query("BEGIN");
    await runtimeClient.query(
      `SELECT set_config('app.tenant_id', $1, true)`,
      [studioA]
    );
    await runtimeClient.query(`SELECT * FROM "app"."tenant_probe"`);
    await runtimeClient.query("COMMIT");

    // New transaction on the SAME connection, no set_config call.
    await runtimeClient.query("BEGIN");
    const result = await runtimeClient.query(
      `SELECT * FROM "app"."tenant_probe"`
    );
    await runtimeClient.query("COMMIT");
    await runtimeClient.end();

    expect(result.rows).toHaveLength(0);
  });
});
