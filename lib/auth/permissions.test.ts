// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "../db/testing/test-database";
import { permissions } from "../db/schema";
import * as schema from "../db/schema";
import {
  PERMISSION_CODES,
  BUILTIN_ROLE_PERMISSIONS,
} from "./permissions";

describe("permission catalog", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  test("the seed migration inserts exactly the codes PERMISSION_CODES declares", async () => {
    const pool = new Pool({ connectionString: testDb.connectionUri });
    const db = drizzle(pool, { schema });
    const rows = await db.select().from(permissions);
    await pool.end();

    const seededCodes = rows.map((r) => r.code).sort();
    expect(seededCodes).toEqual([...PERMISSION_CODES].sort());
  });

  test("every code granted to a built-in role is a real permission code", () => {
    for (const role of Object.keys(BUILTIN_ROLE_PERMISSIONS) as Array<
      keyof typeof BUILTIN_ROLE_PERMISSIONS
    >) {
      for (const code of BUILTIN_ROLE_PERMISSIONS[role]) {
        expect(PERMISSION_CODES).toContain(code);
      }
    }
  });
});
