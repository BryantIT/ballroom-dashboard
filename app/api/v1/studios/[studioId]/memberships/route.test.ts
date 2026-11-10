// app/api/v1/studios/[studioId]/memberships/route.test.ts
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
  verifyApiSession: async () => ({ userId: sessionUser.userId }),
  verifySession: async () => ({ userId: sessionUser.userId }),
}));

describe("GET /api/v1/studios/{studioId}/memberships", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let GET: typeof import("./route").GET;
  let provisionStudio: typeof import("@/lib/studios/provision").provisionStudio;
  let withTenantContext: typeof import("@/lib/db/with-tenant-context").withTenantContext;
  let appDb: typeof import("@/lib/db/client").db;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    // The route uses the default db client, which reads this at import time.
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ GET } = await import("./route"));
    ({ provisionStudio } = await import("@/lib/studios/provision"));
    ({ withTenantContext } = await import("@/lib/db/with-tenant-context"));
    ({ db: appDb } = await import("@/lib/db/client"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await appDb.$client.end();
    await testDb.stop();
  });

  test("returns only the requested studio's memberships, never the caller's own rows in another studio", async () => {
    const db = drizzle(pool, { schema });
    const [user] = await db.insert(users).values({ email: "leak-a@example.com" }).returning();
    const [ownerB] = await db.insert(users).values({ email: "leak-b@example.com" }).returning();

    const { studioId: studioA } = await provisionStudio(
      { ownerId: user.id, studioName: "A", timezone: "America/Chicago" },
      db
    );
    const { studioId: studioB } = await provisionStudio(
      { ownerId: ownerB.id, studioName: "B", timezone: "America/Chicago" },
      db
    );

    // Give the same user a membership in studio B too — the row RLS's
    // self_or_tenant_select policy lets through under studio A's context.
    await withTenantContext(
      { userId: ownerB.id, tenantId: studioB },
      async (tx) => {
        const [instructorRoleB] = await tx
          .select()
          .from(roles)
          .where(and(eq(roles.studioId, studioB), eq(roles.code, "instructor")));
        await tx.insert(memberships).values({
          studioId: studioB,
          userId: user.id,
          roleId: instructorRoleB.id,
          status: "active",
        });
      },
      db
    );

    sessionUser.userId = user.id;
    const response = await GET(
      new Request(`http://localhost/api/v1/studios/${studioA}/memberships`),
      { params: Promise.resolve({ studioId: studioA }) }
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { memberships: { studioId: string; userId: string }[] };
    expect(body.memberships.length).toBeGreaterThan(0);
    expect(body.memberships.some((m) => m.userId === user.id)).toBe(true);
    for (const row of body.memberships) {
      expect(row.studioId).toBe(studioA);
    }
  });
});
