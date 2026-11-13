// lib/branding/public-branding.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "../db/testing/test-database";
import * as schema from "../db/schema";
import { users } from "../db/schema";
import { getPublicBrandingBySlug } from "./public-branding";

describe("getPublicBrandingBySlug", () => {
  let testDb: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    // provisionStudio's import chain reaches lib/db/client.ts, which reads
    // DATABASE_RUNTIME_URL at module-load time — set it before the dynamic
    // import below, same as lib/studios/provision.test.ts.
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  test("returns the studio's public branding fields by slug, with no tenant context set", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    const [owner] = await seedDb.insert(users).values({ email: "o@example.com" }).returning();
    await seedPool.end();

    const { provisionStudio } = await import("../studios/provision");
    const db = drizzle(pool, { schema });
    const result = await provisionStudio(
      { ownerId: owner.id, studioName: "Starlight Ballroom", timezone: "America/Chicago" },
      db
    );

    const branding = await getPublicBrandingBySlug(result.slug, db);
    expect(branding).toMatchObject({
      studioId: result.studioId,
      studioName: "Starlight Ballroom",
      slug: result.slug,
      themePreset: "midnight",
      colorMode: "system",
      accentColorOverride: null,
      logoUrl: null,
    });
  });

  test("returns null for an unknown slug", async () => {
    const db = drizzle(pool, { schema });
    const branding = await getPublicBrandingBySlug("no-such-studio", db);
    expect(branding).toBeNull();
  });
});
