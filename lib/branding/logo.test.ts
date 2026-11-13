// lib/branding/logo.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { uploadLogo, InvalidLogoFileError, MAX_LOGO_BYTES } from "./logo";
import { createTestDatabase, type TestDatabase } from "../db/testing/test-database";
import * as schema from "../db/schema";
import { users, studioBranding } from "../db/schema";

function fakeFile(type: string, size: number): File {
  return new File([new Uint8Array(size)], "logo", { type });
}

describe("uploadLogo", () => {
  test("rejects a disallowed MIME type before calling the uploader", async () => {
    const put = vi.fn();
    await expect(uploadLogo("studio-1", fakeFile("image/gif", 100), put))
      .rejects.toThrow(InvalidLogoFileError);
    expect(put).not.toHaveBeenCalled();
  });

  test("rejects a file over MAX_LOGO_BYTES before calling the uploader", async () => {
    const put = vi.fn();
    await expect(uploadLogo("studio-1", fakeFile("image/png", MAX_LOGO_BYTES + 1), put))
      .rejects.toThrow(InvalidLogoFileError);
    expect(put).not.toHaveBeenCalled();
  });

  test("uploads a valid file and returns the stored URL", async () => {
    const put = vi.fn().mockResolvedValue({ url: "https://blob.example/studio-1-logo.png" });
    const url = await uploadLogo("studio-1", fakeFile("image/png", 1000), put);
    expect(url).toBe("https://blob.example/studio-1-logo.png");
    expect(put).toHaveBeenCalledWith(
      expect.stringMatching(/^studio-logos\/studio-1-\d+\.png$/),
      expect.anything(),
      expect.objectContaining({ access: "public", contentType: "image/png" })
    );
  });

  test("derives the pathname extension and contentType from a JPEG file", async () => {
    const put = vi.fn().mockResolvedValue({ url: "https://blob.example/studio-1-logo.jpg" });
    await uploadLogo("studio-1", fakeFile("image/jpeg", 1000), put);
    expect(put).toHaveBeenCalledWith(
      expect.stringMatching(/^studio-logos\/studio-1-\d+\.jpg$/),
      expect.anything(),
      expect.objectContaining({ access: "public", contentType: "image/jpeg" })
    );
  });

  test("derives the pathname extension and contentType from an SVG file", async () => {
    const put = vi.fn().mockResolvedValue({ url: "https://blob.example/studio-1-logo.svg" });
    await uploadLogo("studio-1", fakeFile("image/svg+xml", 1000), put);
    expect(put).toHaveBeenCalledWith(
      expect.stringMatching(/^studio-logos\/studio-1-\d+\.svg$/),
      expect.anything(),
      expect.objectContaining({ access: "public", contentType: "image/svg+xml" })
    );
  });
});

// Same shape as branding.test.ts's coverage of updateBranding: a real
// Testcontainers-backed Postgres, a provisioned studio/owner, and
// DATABASE_RUNTIME_URL set in beforeAll before anything that transitively
// reaches lib/db/client.ts is dynamically imported. The `put` passed in is
// always a vi.fn() fake — never the real @vercel/blob client — so no test
// here makes a network call.
describe("updateBrandingLogo", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let provisionStudio: typeof import("../studios/provision").provisionStudio;
  let updateBrandingLogo: typeof import("./logo").updateBrandingLogo;
  let PermissionDeniedError: typeof import("../auth/authorization").PermissionDeniedError;
  let withTenantContext: typeof import("../db/with-tenant-context").withTenantContext;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    // provisionStudio's import chain reaches lib/db/client.ts, which reads
    // DATABASE_RUNTIME_URL at module-load time — set it before the dynamic
    // import below, same as lib/branding/branding.test.ts.
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ provisionStudio } = await import("../studios/provision"));
    ({ updateBrandingLogo } = await import("./logo"));
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

    // Same RLS note as branding.test.ts: adding a membership for a second
    // user requires app.tenant_id to be set, so this runs inside
    // withTenantContext.
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

  test("a non-owner cannot update the logo", async () => {
    const { instructorId, studioId, db } = await provisionWithInstructor("Logo Studio A");
    const put = vi.fn();

    await expect(
      updateBrandingLogo(instructorId, studioId, fakeFile("image/png", 1000), db, put)
    ).rejects.toThrow(PermissionDeniedError);
    expect(put).not.toHaveBeenCalled();
  });

  test("the owner can update the logo, the uploader is called with the expected args, and the returned branding reflects the new URL", async () => {
    const { ownerId, studioId, db } = await provisionWithInstructor("Logo Studio B");
    const put = vi.fn().mockResolvedValue({ url: "https://blob.example/logo-studio-b.png" });
    const file = fakeFile("image/png", 1000);

    const result = await updateBrandingLogo(ownerId, studioId, file, db, put);

    expect(put).toHaveBeenCalledWith(
      expect.stringContaining(studioId),
      file,
      expect.objectContaining({ access: "public" })
    );
    expect(result.logoUrl).toBe("https://blob.example/logo-studio-b.png");
  });

  test("the new logo URL is actually persisted in studio_branding, not just echoed back in memory", async () => {
    const { ownerId, studioId, db } = await provisionWithInstructor("Logo Studio C");
    const put = vi.fn().mockResolvedValue({ url: "https://blob.example/logo-studio-c.png" });

    await updateBrandingLogo(ownerId, studioId, fakeFile("image/png", 1000), db, put);

    const [row] = await db
      .select({ logoUrl: studioBranding.logoUrl })
      .from(studioBranding)
      .where(eq(studioBranding.studioId, studioId))
      .limit(1);
    expect(row?.logoUrl).toBe("https://blob.example/logo-studio-c.png");
  });
});
