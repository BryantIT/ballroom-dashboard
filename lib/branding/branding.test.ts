// lib/branding/branding.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "../db/testing/test-database";
import * as schema from "../db/schema";
import { users } from "../db/schema";

describe("branding read/update", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let provisionStudio: typeof import("../studios/provision").provisionStudio;
  let updateBranding: typeof import("./branding").updateBranding;
  let getBrandingByStudioId: typeof import("./branding").getBrandingByStudioId;
  let SlugTakenError: typeof import("./branding").SlugTakenError;
  let PermissionDeniedError: typeof import("../auth/authorization").PermissionDeniedError;
  let withTenantContext: typeof import("../db/with-tenant-context").withTenantContext;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    // provisionStudio's import chain reaches lib/db/client.ts, which reads
    // DATABASE_RUNTIME_URL at module-load time — set it before the dynamic
    // import below, same as lib/studios/provision.test.ts.
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ provisionStudio } = await import("../studios/provision"));
    ({ updateBranding, getBrandingByStudioId, SlugTakenError } = await import("./branding"));
    ({ PermissionDeniedError } = await import("../auth/authorization"));
    ({ withTenantContext } = await import("../db/with-tenant-context"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  async function provisionWithInstructor(studioName: string) {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    const [owner] = await seedDb
      .insert(users)
      .values({ email: `owner-${crypto.randomUUID()}@example.com` })
      .returning();
    const [instructor] = await seedDb
      .insert(users)
      .values({ email: `instructor-${crypto.randomUUID()}@example.com` })
      .returning();
    await seedPool.end();

    const db = drizzle(pool, { schema });
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName, timezone: "America/Chicago" },
      db
    );

    // Same RLS note as lib/auth/authorization.test.ts: adding a membership
    // for a second user requires app.tenant_id to be set, so this runs
    // inside withTenantContext.
    await withTenantContext(
      { userId: owner.id, tenantId: studioId },
      async (tx) => {
        const [instructorRole] = await tx
          .select()
          .from(schema.roles)
          .where(and(eq(schema.roles.studioId, studioId), eq(schema.roles.code, "instructor")));

        await tx.insert(schema.memberships).values({
          studioId,
          userId: instructor.id,
          roleId: instructorRole.id,
          status: "active",
        });
      },
      db
    );

    return { ownerId: owner.id, instructorId: instructor.id, studioId, db };
  }

  test("a non-owner cannot update branding", async () => {
    const { instructorId, studioId, db } = await provisionWithInstructor("Studio A");

    await expect(
      updateBranding(instructorId, studioId, { themePreset: "noir" }, db)
    ).rejects.toThrow(PermissionDeniedError);
  });

  test("the owner can update theme, accent, and color mode", async () => {
    const { ownerId, studioId, db } = await provisionWithInstructor("Studio B");

    const result = await updateBranding(
      ownerId,
      studioId,
      { themePreset: "ocean", accentColorOverride: "#ff00ff", colorMode: "dark" },
      db
    );

    expect(result).toMatchObject({
      themePreset: "ocean",
      accentColorOverride: "#ff00ff",
      colorMode: "dark",
    });
  });

  test("changing the slug to one already used by another studio fails clearly", async () => {
    const { ownerId, studioId, db } = await provisionWithInstructor("Studio C");
    const other = await provisionWithInstructor("Studio D");
    const otherBranding = await getBrandingByStudioId(other.studioId, db);

    await expect(
      updateBranding(ownerId, studioId, { slug: otherBranding.slug }, db)
    ).rejects.toThrow(SlugTakenError);
  });

  test("changing the slug to a free value succeeds", async () => {
    const { ownerId, studioId, db } = await provisionWithInstructor("Studio E");

    const result = await updateBranding(ownerId, studioId, { slug: "new-slug" }, db);

    expect(result.slug).toBe("new-slug");
  });

  test("a slug conflict committed after the pre-check but before the update still fails as SlugTakenError, not a raw DB error", async () => {
    const { ownerId, studioId } = await provisionWithInstructor("Studio F");
    const other = await provisionWithInstructor("Studio G");
    const db = drizzle(pool, { schema });

    // Reproduce the race window the pre-check alone can't close: hold an
    // UNCOMMITTED write of the target slug onto a different studio's row.
    // Postgres's own unique index makes updateBranding's pre-check SELECT
    // below genuinely unable to see this (MVCC: uncommitted data from
    // another transaction is invisible), so it passes clean — then this
    // test's own UPDATE blocks on the unique index until we COMMIT it,
    // at which point updateBranding's UPDATE wakes up and hits the real
    // 23505 for the first time, proving the catch-and-rethrow path (not
    // the pre-check) is what turns it into SlugTakenError.
    const raceClient = await pool.connect();
    try {
      await raceClient.query("BEGIN");
      await raceClient.query('UPDATE app.studio_branding SET slug = $1 WHERE studio_id = $2', [
        "race-slug",
        other.studioId,
      ]);

      const updatePromise = updateBranding(ownerId, studioId, { slug: "race-slug" }, db);

      // Give updateBranding's pre-check SELECT time to run (and find no
      // conflict, since the row above is still uncommitted) before we
      // commit it out from under the in-flight update.
      await new Promise((resolve) => setTimeout(resolve, 200));
      await raceClient.query("COMMIT");

      await expect(updatePromise).rejects.toThrow(SlugTakenError);
    } finally {
      raceClient.release();
    }
  });
});
