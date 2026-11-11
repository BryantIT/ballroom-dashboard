// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "./testing/test-database";
import { studios, locations, rooms } from "./schema";
import * as schema from "./schema";

describe("studios/locations/rooms RLS", () => {
  let testDb: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  test("a runtime connection with no tenant context sees no studios, locations, or rooms, even though rows exist for two studios", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    const studioA = "11111111-1111-1111-1111-111111111111";
    const studioB = "22222222-2222-2222-2222-222222222222";
    await seedDb.insert(studios).values([
      { id: studioA, name: "Studio A" },
      { id: studioB, name: "Studio B" },
    ]);
    const [locationA] = await seedDb
      .insert(locations)
      .values({ studioId: studioA, name: "Main", timezone: "America/Chicago" })
      .returning();
    await seedDb.insert(rooms).values({
      locationId: locationA.id,
      studioId: studioA,
      name: "Studio 1",
    });
    await seedPool.end();

    const runtimeDb = drizzle(pool, { schema });
    expect(await runtimeDb.select().from(studios)).toHaveLength(0);
    expect(await runtimeDb.select().from(locations)).toHaveLength(0);
    expect(await runtimeDb.select().from(rooms)).toHaveLength(0);
  });

  test("setting app.tenant_id scopes studios, locations, and rooms to that studio only", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    const studioA = "33333333-3333-3333-3333-333333333333";
    const studioB = "44444444-4444-4444-4444-444444444444";
    await seedDb.insert(studios).values([
      { id: studioA, name: "Studio A" },
      { id: studioB, name: "Studio B" },
    ]);
    const [locationA] = await seedDb
      .insert(locations)
      .values({ studioId: studioA, name: "Main", timezone: "America/Chicago" })
      .returning();
    await seedDb.insert(locations).values({
      studioId: studioB,
      name: "Other",
      timezone: "America/New_York",
    });
    await seedDb.insert(rooms).values({
      locationId: locationA.id,
      studioId: studioA,
      name: "Studio 1",
    });
    await seedPool.end();

    const runtimeClient = new Pool({ connectionString: testDb.runtimeConnectionUri });
    const runtimeDb = drizzle(runtimeClient, { schema });
    const rows = await runtimeDb.transaction(async (tx) => {
      await tx.execute(`select set_config('app.tenant_id', '${studioA}', true)`);
      return {
        studios: await tx.select().from(studios),
        locations: await tx.select().from(locations),
        rooms: await tx.select().from(rooms),
      };
    });
    await runtimeClient.end();

    expect(rows.studios).toHaveLength(1);
    expect(rows.studios[0].id).toBe(studioA);
    expect(rows.locations).toHaveLength(1);
    expect(rows.rooms).toHaveLength(1);
  });
});
