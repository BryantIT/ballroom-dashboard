// lib/studios/provision.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "../db/testing/test-database";
import {
  studios,
  locations,
  roles,
  rolePermissions,
  memberships,
  users,
  studioBranding,
} from "../db/schema";
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

    expect(result.slug).toBe("starlight-ballroom");
    const brandingRows = await verifyDb
      .select()
      .from(studioBranding)
      .where(eq(studioBranding.studioId, result.studioId));
    expect(brandingRows).toHaveLength(1);
    expect(brandingRows[0].themePreset).toBe("midnight");
    expect(brandingRows[0].colorMode).toBe("system");

    await verifyPool.end();
  });

  test("provisioning two more studios with the same name produces unique slugs", async () => {
    // Note: the preceding test in this describe already provisioned a
    // "Starlight Ballroom" (slug "starlight-ballroom") against the same
    // shared test database, so the next two provisions here land on
    // "-2" and "-3" rather than the base slug and "-2" — this still
    // exercises the same sequential-suffix behavior.
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    const [ownerOne] = await seedDb
      .insert(users)
      .values({ email: "owner-one@example.com" })
      .returning();
    const [ownerTwo] = await seedDb
      .insert(users)
      .values({ email: "owner-two@example.com" })
      .returning();
    await seedPool.end();

    const { provisionStudio } = await import("./provision");
    const db = drizzle(pool, { schema });

    const resultOne = await provisionStudio(
      { ownerId: ownerOne.id, studioName: "Starlight Ballroom", timezone: "America/Chicago" },
      db
    );
    const resultTwo = await provisionStudio(
      { ownerId: ownerTwo.id, studioName: "Starlight Ballroom", timezone: "America/Chicago" },
      db
    );

    expect(resultOne.slug).toBe("starlight-ballroom-2");
    expect(resultTwo.slug).toBe("starlight-ballroom-3");
  });
});
