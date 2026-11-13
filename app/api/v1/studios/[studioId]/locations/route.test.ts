// app/api/v1/studios/[studioId]/locations/route.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing/test-database";
import { users } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";

// Only session verification is stubbed; everything below it (permission
// checks, RLS, the query itself) runs against real Postgres.
const sessionUser = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/dal", () => ({
  verifyApiSession: async () => (sessionUser.userId ? { userId: sessionUser.userId } : null),
  verifySession: async () => (sessionUser.userId ? { userId: sessionUser.userId } : null),
}));

describe("/api/v1/studios/{studioId}/locations", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let GET: typeof import("./route").GET;
  let POST: typeof import("./route").POST;
  let provisionStudio: typeof import("@/lib/studios/provision").provisionStudio;
  let appDb: typeof import("@/lib/db/client").db;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ GET, POST } = await import("./route"));
    ({ provisionStudio } = await import("@/lib/studios/provision"));
    ({ db: appDb } = await import("@/lib/db/client"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await appDb.$client.end();
    await testDb.stop();
  });

  function makeGetRequest(studioId: string) {
    return new Request(`http://localhost/api/v1/studios/${studioId}/locations`);
  }

  function makePostRequest(studioId: string, body: unknown) {
    return new Request(`http://localhost/api/v1/studios/${studioId}/locations`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async function createOwner(emailSuffix: string) {
    const db = drizzle(pool, { schema });
    const [owner] = await db
      .insert(users)
      .values({ email: `owner-locations-${emailSuffix}@example.com` })
      .returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    return { db, owner, studioId };
  }

  describe("GET", () => {
    test("returns 401 when there is no session", async () => {
      const { studioId } = await createOwner("get-401");
      sessionUser.userId = "";

      const response = await GET(makeGetRequest(studioId), {
        params: Promise.resolve({ studioId }),
      });

      expect(response.status).toBe(401);
    });

    test("returns 400 for an invalid studioId", async () => {
      const response = await GET(makeGetRequest("not-a-uuid"), {
        params: Promise.resolve({ studioId: "not-a-uuid" }),
      });

      expect(response.status).toBe(400);
    });

    test("returns 403 for a user with no membership in the studio", async () => {
      const { db, studioId } = await createOwner("get-403");
      const [outsider] = await db
        .insert(users)
        .values({ email: "outsider-locations-get@example.com" })
        .returning();
      sessionUser.userId = outsider.id;

      const response = await GET(makeGetRequest(studioId), {
        params: Promise.resolve({ studioId }),
      });

      expect(response.status).toBe(403);
    });

    test("lists all locations for the studio for any active member", async () => {
      const { owner, studioId } = await createOwner("get-list");
      sessionUser.userId = owner.id;
      await POST(makePostRequest(studioId, { name: "Main Studio", timezone: "America/Chicago" }), {
        params: Promise.resolve({ studioId }),
      });

      const response = await GET(makeGetRequest(studioId), {
        params: Promise.resolve({ studioId }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as Array<{ name: string }>;
      // provisionStudio already seeds a "Main Location" for the new studio.
      expect(body.map((location) => location.name).sort()).toEqual([
        "Main Location",
        "Main Studio",
      ]);
    });
  });
});
