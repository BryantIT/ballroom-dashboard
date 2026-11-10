// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Client } from "pg";
import { createTestDatabase, type TestDatabase } from "./test-database";

// Phase 0's throwaway tenant_probe table is decommissioned in Phase 1
// (Task 11) now that real tenant-owned tables exist. These scenarios are
// ported onto `studios` — the simplest real RLS-protected table (policy:
// `id::text = current_setting('app.tenant_id', true)`) — preserving the
// original assertions (see lib/db/with-tenant-context.test.ts for the
// Drizzle-level equivalent of the first three).
describe("RLS enforcement (regression, now against real tables)", () => {
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
      `INSERT INTO "app"."studios" (id, name) VALUES ($1, 'a'), ($2, 'b')`,
      [studioA, studioB]
    );
    await seedClient.end();

    const runtimeClient = new Client({
      connectionString: testDb.runtimeConnectionUri,
    });
    await runtimeClient.connect();
    const result = await runtimeClient.query(
      `SELECT * FROM "app"."studios"`
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
      `INSERT INTO "app"."studios" (id, name) VALUES ($1, 'a'), ($2, 'b')`,
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
      `SELECT * FROM "app"."studios"`
    );
    await runtimeClient.query("COMMIT");
    await runtimeClient.end();

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].id).toBe(studioA);
  });

  test("SET LOCAL does not leak tenant context across transactions on the same connection", async () => {
    const seedClient = new Client({ connectionString: testDb.connectionUri });
    await seedClient.connect();
    const studioA = "55555555-5555-5555-5555-555555555555";
    await seedClient.query(
      `INSERT INTO "app"."studios" (id, name) VALUES ($1, 'a')`,
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
    await runtimeClient.query(`SELECT * FROM "app"."studios"`);
    await runtimeClient.query("COMMIT");

    // New transaction on the SAME connection, no set_config call.
    await runtimeClient.query("BEGIN");
    const result = await runtimeClient.query(
      `SELECT * FROM "app"."studios"`
    );
    await runtimeClient.query("COMMIT");
    await runtimeClient.end();

    expect(result.rows).toHaveLength(0);
  });

  test("the runtime connection has restricted, non-owner, non-superuser privileges", async () => {
    const runtimeClient = new Client({
      connectionString: testDb.runtimeConnectionUri,
    });
    await runtimeClient.connect();

    const who = await runtimeClient.query("select current_user");
    expect(who.rows[0].current_user).toBe("app_runtime");

    const roleAttrs = await runtimeClient.query(
      "select rolsuper, rolbypassrls from pg_roles where rolname = current_user"
    );
    expect(roleAttrs.rows[0].rolsuper).toBe(false);
    expect(roleAttrs.rows[0].rolbypassrls).toBe(false);

    const owner = await runtimeClient.query(
      `select relowner::regrole::text as owner from pg_class where oid = '"app"."studios"'::regclass`
    );
    expect(owner.rows[0].owner).not.toBe("app_runtime");

    await expect(
      runtimeClient.query(
        `alter table "app"."studios" disable row level security`
      )
    ).rejects.toThrow();

    await expect(
      runtimeClient.query(`create table "app"."should_not_exist" (id int)`)
    ).rejects.toThrow();

    await runtimeClient.end();
  });
});
