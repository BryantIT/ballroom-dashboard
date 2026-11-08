// lib/studios/provision.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "../db/testing/test-database";
import { studios, locations, roles, rolePermissions, memberships, users } from "../db/schema";
import * as schema from "../db/schema";
import { BUILTIN_ROLE_PERMISSIONS } from "../auth/permissions";

describe("provisionStudio", () => {
  let testDb: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  test("creates a studio, default location, three built-in roles with the spec's grants, and an active Owner membership", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    const [owner] = await seedDb.insert(users).values({ email: "owner@example.com" }).returning();
    await seedPool.end();

    const { provisionStudio } = await import("./provision");
    const db = drizzle(pool, { schema });
    const result = await provisionStudio(
      { ownerId: owner.id, studioName: "Starlight Ballroom", timezone: "America/Chicago" },
      db
    );

    const verifyPool = new Pool({ connectionString: testDb.connectionUri });
    const verifyDb = drizzle(verifyPool, { schema });

    const studioRows = await verifyDb.select().from(studios);
    expect(studioRows).toHaveLength(1);
    expect(studioRows[0].id).toBe(result.studioId);
    expect(studioRows[0].name).toBe("Starlight Ballroom");

    const locationRows = await verifyDb.select().from(locations);
    expect(locationRows).toHaveLength(1);
    expect(locationRows[0].id).toBe(result.locationId);
    expect(locationRows[0].timezone).toBe("America/Chicago");

    const roleRows = await verifyDb.select().from(roles);
    expect(roleRows.map((r) => r.code).sort()).toEqual(["admin", "instructor", "owner"]);

    const grantRows = await verifyDb.select().from(rolePermissions);
    const ownerRole = roleRows.find((r) => r.code === "owner")!;
    const ownerGrants = grantRows
      .filter((g) => g.roleId === ownerRole.id)
      .map((g) => g.permissionCode)
      .sort();
    expect(ownerGrants).toEqual([...BUILTIN_ROLE_PERMISSIONS.owner].sort());

    const membershipRows = await verifyDb.select().from(memberships);
    expect(membershipRows).toHaveLength(1);
    expect(membershipRows[0].id).toBe(result.ownerMembershipId);
    expect(membershipRows[0].userId).toBe(owner.id);
    expect(membershipRows[0].roleId).toBe(ownerRole.id);
    expect(membershipRows[0].status).toBe("active");

    await verifyPool.end();
  });
});
