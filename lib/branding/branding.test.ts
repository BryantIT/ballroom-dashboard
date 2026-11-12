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
});
