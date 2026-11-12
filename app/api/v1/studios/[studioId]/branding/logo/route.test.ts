// app/api/v1/studios/[studioId]/branding/logo/route.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing/test-database";
import { users, roles, memberships } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";

// Only session verification is stubbed; everything below it (permission
// checks, RLS, the query itself) runs against real Postgres.
const sessionUser = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/dal", () => ({
  verifyApiSession: async () => (sessionUser.userId ? { userId: sessionUser.userId } : null),
  verifySession: async () => (sessionUser.userId ? { userId: sessionUser.userId } : null),
}));

// This route calls updateBrandingLogo/uploadLogo with their default `put`
// (no test-only injection point in the route itself, per the Task 8
// brief), so the one test that needs to reach a real upload call mocks the
// @vercel/blob module instead of making a real network call.
const putMock = vi.hoisted(() => vi.fn().mockResolvedValue({ url: "https://blob.example/logo.png" }));
vi.mock("@vercel/blob", () => ({ put: putMock }));

function fakeFile(type: string, size: number, name = "logo.png"): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe("POST /api/v1/studios/{studioId}/branding/logo", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let POST: typeof import("./route").POST;
  let provisionStudio: typeof import("@/lib/studios/provision").provisionStudio;
  let withTenantContext: typeof import("@/lib/db/with-tenant-context").withTenantContext;
  let appDb: typeof import("@/lib/db/client").db;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ POST } = await import("./route"));
    ({ provisionStudio } = await import("@/lib/studios/provision"));
    ({ withTenantContext } = await import("@/lib/db/with-tenant-context"));
    ({ db: appDb } = await import("@/lib/db/client"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await appDb.$client.end();
    await testDb.stop();
  });

  async function provisionWithInstructor(studioName: string) {
    const db = drizzle(pool, { schema });
    const [owner] = await db
      .insert(users)
      .values({ email: `owner-${crypto.randomUUID()}@example.com` })
      .returning();
    const [instructor] = await db
      .insert(users)
      .values({ email: `instructor-${crypto.randomUUID()}@example.com` })
      .returning();

    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName, timezone: "America/Chicago" },
      db
    );

    await withTenantContext(
      { userId: owner.id, tenantId: studioId },
      async (tx) => {
        const [instructorRole] = await tx
          .select()
          .from(roles)
          .where(and(eq(roles.studioId, studioId), eq(roles.code, "instructor")));
        await tx.insert(memberships).values({
          studioId,
          userId: instructor.id,
          roleId: instructorRole.id,
          status: "active",
        });
      },
      db
    );

    return { ownerId: owner.id, instructorId: instructor.id, studioId };
  }

  function params(studioId: string) {
    return { params: Promise.resolve({ studioId }) };
  }

  function formRequest(studioId: string, file?: File) {
    const formData = new FormData();
    if (file) {
      formData.set("file", file);
    }
    return new Request(`http://localhost/api/v1/studios/${studioId}/branding/logo`, {
      method: "POST",
      body: formData,
    });
  }

  test("POST with no session returns 401", async () => {
    sessionUser.userId = "";
    const { studioId } = await provisionWithInstructor("No Session Logo Studio");

    const response = await POST(formRequest(studioId, fakeFile("image/png", 1000)), params(studioId));

    expect(response.status).toBe(401);
  });

  test("POST as Instructor returns 403", async () => {
    const { instructorId, studioId } = await provisionWithInstructor("Forbidden Logo Studio");
    sessionUser.userId = instructorId;

    const response = await POST(formRequest(studioId, fakeFile("image/png", 1000)), params(studioId));

    expect(response.status).toBe(403);
  });

  test("POST with an oversized file returns 400", async () => {
    const { ownerId, studioId } = await provisionWithInstructor("Oversized Logo Studio");
    sessionUser.userId = ownerId;

    const response = await POST(
      formRequest(studioId, fakeFile("image/png", 2 * 1024 * 1024 + 1)),
      params(studioId)
    );

    expect(response.status).toBe(400);
    expect(putMock).not.toHaveBeenCalled();
  });

  test("POST with a missing file entry returns 400", async () => {
    const { ownerId, studioId } = await provisionWithInstructor("Missing File Logo Studio");
    sessionUser.userId = ownerId;

    const response = await POST(formRequest(studioId), params(studioId));

    expect(response.status).toBe(400);
  });

  test("POST as the owner with a small valid PNG returns 200 with a logoUrl", async () => {
    const { ownerId, studioId } = await provisionWithInstructor("Valid Logo Studio");
    sessionUser.userId = ownerId;

    const response = await POST(formRequest(studioId, fakeFile("image/png", 1000)), params(studioId));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.logoUrl).toBe("https://blob.example/logo.png");
    expect(putMock).toHaveBeenCalled();
  });
});
