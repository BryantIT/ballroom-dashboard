// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { createTestDatabase, type TestDatabase } from "./lib/db/testing/test-database";
import { users } from "./lib/db/schema";
import * as schema from "./lib/db/schema";

describe("credentials auth", () => {
  let testDb: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  test("a user created with a bcrypt hash can authorize with the matching password", async () => {
    const db = drizzle(pool, { schema });
    const passwordHash = await bcrypt.hash("correct-password", 10);
    await db.insert(users).values({
      email: "owner@example.com",
      passwordHash,
    });

    const { authorizeCredentials } = await import("./auth");
    const result = await authorizeCredentials(
      { email: "owner@example.com", password: "correct-password" },
      db
    );

    expect(result).not.toBeNull();
    expect(result?.email).toBe("owner@example.com");
  });

  test("authorize rejects a wrong password", async () => {
    const db = drizzle(pool, { schema });
    const passwordHash = await bcrypt.hash("correct-password", 10);
    await db.insert(users).values({
      email: "owner2@example.com",
      passwordHash,
    });

    const { authorizeCredentials } = await import("./auth");
    const result = await authorizeCredentials(
      { email: "owner2@example.com", password: "wrong-password" },
      db
    );

    expect(result).toBeNull();
  });
});
