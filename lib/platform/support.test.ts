// lib/platform/support.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "../db/testing/test-database";
import { users, platformAdmins } from "../db/schema";
import * as schema from "../db/schema";

describe("platform support sessions", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let provisionStudio: typeof import("../studios/provision").provisionStudio;
  let isPlatformAdmin: typeof import("./support").isPlatformAdmin;
  let startSupportSession: typeof import("./support").startSupportSession;
  let endSupportSession: typeof import("./support").endSupportSession;
  let requireActiveSupportSession: typeof import("./support").requireActiveSupportSession;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ provisionStudio } = await import("../studios/provision"));
    ({ isPlatformAdmin, startSupportSession, endSupportSession, requireActiveSupportSession } =
      await import("./support"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  test("a non-platform-admin cannot start a support session", async () => {
    const db = drizzle(pool, { schema });
    const [owner] = await db.insert(users).values({ email: "owner@example.com" }).returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const [notAnAdmin] = await db.insert(users).values({ email: "notadmin@example.com" }).returning();

    expect(await isPlatformAdmin(notAnAdmin.id, db)).toBe(false);
    await expect(
      startSupportSession({ adminUserId: notAnAdmin.id, studioId, reason: "debug" }, db)
    ).rejects.toThrow();
  });

  test("a platform admin's support session is audited and required for access, and ending it revokes access", async () => {
    const db = drizzle(pool, { schema });
    const [owner] = await db.insert(users).values({ email: "owner2@example.com" }).returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const [admin] = await db.insert(users).values({ email: "admin@example.com" }).returning();
    await db.insert(platformAdmins).values({ userId: admin.id });

    await expect(requireActiveSupportSession(admin.id, studioId, db)).rejects.toThrow();

    const { sessionId } = await startSupportSession(
      { adminUserId: admin.id, studioId, reason: "customer escalation #123" },
      db
    );
    await expect(requireActiveSupportSession(admin.id, studioId, db)).resolves.not.toThrow();

    await endSupportSession(sessionId, studioId, db);
    await expect(requireActiveSupportSession(admin.id, studioId, db)).rejects.toThrow();
  });
});
