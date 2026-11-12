// app/api/v1/studios/branding-acceptance.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import {
  createTestDatabase,
  type TestDatabase,
} from "@/lib/db/testing/test-database";
import { users, roles, memberships } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";

// Phase 2 cross-cutting acceptance test: proves branding never leaks
// between studios. This composes functions already built and individually
// tested in Tasks 1-11 (provisionStudio, getPublicBrandingBySlug,
// getBrandingByStudioId, updateBranding, PermissionDeniedError) — it adds
// no new production code.
describe("Phase 2 acceptance: cross-studio branding isolation", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let provisionStudio: typeof import("@/lib/studios/provision").provisionStudio;
  let getPublicBrandingBySlug: typeof import("@/lib/branding/public-branding").getPublicBrandingBySlug;
  let getBrandingByStudioId: typeof import("@/lib/branding/branding").getBrandingByStudioId;
  let updateBranding: typeof import("@/lib/branding/branding").updateBranding;
  let PermissionDeniedError: typeof import("@/lib/auth/authorization").PermissionDeniedError;
  let withTenantContext: typeof import("@/lib/db/with-tenant-context").withTenantContext;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    // provisionStudio's import chain reaches lib/db/client.ts, which reads
    // DATABASE_RUNTIME_URL at module-load time — set it before the dynamic
    // import below, same as the other acceptance/branding tests.
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ provisionStudio } = await import("@/lib/studios/provision"));
    ({ getPublicBrandingBySlug } = await import("@/lib/branding/public-branding"));
    ({ getBrandingByStudioId, updateBranding } = await import("@/lib/branding/branding"));
    ({ PermissionDeniedError } = await import("@/lib/auth/authorization"));
    ({ withTenantContext } = await import("@/lib/db/with-tenant-context"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  test("a studio's branding never leaks into another studio's lookup or update", async () => {
    const db = drizzle(pool, { schema });
    const [userA] = await db.insert(users).values({ email: "owner-a@example.com" }).returning();
    const [userB] = await db.insert(users).values({ email: "owner-b@example.com" }).returning();

    const studioA = await provisionStudio(
      { ownerId: userA.id, studioName: "Studio A", timezone: "America/Chicago" },
      db
    );
    const studioB = await provisionStudio(
      { ownerId: userB.id, studioName: "Studio B", timezone: "America/Chicago" },
      db
    );

    await updateBranding(userA.id, studioA.studioId, { themePreset: "midnight" }, db);
    await updateBranding(userB.id, studioB.studioId, { themePreset: "noir" }, db);

    const brandingA = await getPublicBrandingBySlug(studioA.slug, db);
    const brandingB = await getPublicBrandingBySlug(studioB.slug, db);
    expect(brandingA?.studioId).toBe(studioA.studioId);
    expect(brandingB?.studioId).toBe(studioB.studioId);
    expect(brandingA?.themePreset).not.toBe(brandingB?.themePreset);

    // Owner A updates Studio A's branding.
    await updateBranding(userA.id, studioA.studioId, { themePreset: "ocean" }, db);

    // Studio B's row is untouched.
    const brandingBAfter = await getPublicBrandingBySlug(studioB.slug, db);
    expect(brandingBAfter?.themePreset).toBe("noir");
  });

  test("a user who is Owner of A and Instructor of B sees the correct branding per studio", async () => {
    const db = drizzle(pool, { schema });
    const [userA] = await db.insert(users).values({ email: "owner-a2@example.com" }).returning();
    const [userB] = await db.insert(users).values({ email: "owner-b2@example.com" }).returning();

    const studioA = await provisionStudio(
      { ownerId: userA.id, studioName: "Studio A2", timezone: "America/Chicago" },
      db
    );
    const studioB = await provisionStudio(
      { ownerId: userB.id, studioName: "Studio B2", timezone: "America/Chicago" },
      db
    );

    // Add userA as an Instructor membership on Studio B too — same
    // established pattern as lib/auth/authorization.test.ts and
    // lib/branding/logo.test.ts: look up the `instructor` role within the
    // target studio's tenant context, then insert the membership inside
    // that same withTenantContext call (memberships/roles are RLS-protected
    // and require app.tenant_id to be set).
    await withTenantContext(
      { userId: userB.id, tenantId: studioB.studioId },
      async (tx) => {
        const [instructorRoleB] = await tx
          .select()
          .from(roles)
          .where(and(eq(roles.studioId, studioB.studioId), eq(roles.code, "instructor")));
        await tx.insert(memberships).values({
          studioId: studioB.studioId,
          userId: userA.id,
          roleId: instructorRoleB.id,
          status: "active",
        });
      },
      db
    );

    await expect(
      updateBranding(userA.id, studioB.studioId, { themePreset: "garden" }, db)
    ).rejects.toThrow(PermissionDeniedError); // userA is only an Instructor on B

    const brandingA = await getBrandingByStudioId(studioA.studioId, db);
    const brandingB = await getBrandingByStudioId(studioB.studioId, db);
    expect(brandingA.studioId).not.toBe(brandingB.studioId);
  });

  test("an unrecognized slug resolves to null, never throws", async () => {
    const db = drizzle(pool, { schema });
    await expect(getPublicBrandingBySlug("totally-unknown-slug", db)).resolves.toBeNull();
  });
});
