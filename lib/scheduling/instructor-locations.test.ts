// lib/scheduling/instructor-locations.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "../db/testing/test-database";
import { users, locations, roles, memberships } from "../db/schema";
import * as schema from "../db/schema";

describe("instructor locations", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let provisionStudio: typeof import("../studios/provision").provisionStudio;
  let assignInstructorToLocation: typeof import("./instructor-locations").assignInstructorToLocation;
  let listInstructorLocations: typeof import("./instructor-locations").listInstructorLocations;
  let listLocationInstructors: typeof import("./instructor-locations").listLocationInstructors;
  let InstructorNotFoundError: typeof import("./instructor-locations").InstructorNotFoundError;
  let LocationNotFoundError: typeof import("./instructor-locations").LocationNotFoundError;
  let PermissionDeniedError: typeof import("../auth/authorization").PermissionDeniedError;
  let withTenantContext: typeof import("../db/with-tenant-context").withTenantContext;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ provisionStudio } = await import("../studios/provision"));
    ({
      assignInstructorToLocation,
      listInstructorLocations,
      listLocationInstructors,
      InstructorNotFoundError,
      LocationNotFoundError,
    } = await import("./instructor-locations"));
    ({ withTenantContext } = await import("../db/with-tenant-context"));
    ({ PermissionDeniedError } = await import("../auth/authorization"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  async function createOwnerInstructorAndLocation(emailSuffix: string) {
    const db = drizzle(pool, { schema });
    const [owner] = await db
      .insert(users)
      .values({ email: `owner-il-${emailSuffix}@example.com` })
      .returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const [instructor] = await db
      .insert(users)
      .values({ email: `instructor-il-${emailSuffix}@example.com` })
      .returning();
    const { location } = await withTenantContext(
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
        const [location] = await tx
          .insert(locations)
          .values({ studioId, name: "Main Studio", timezone: "America/Chicago" })
          .returning();
        return { location };
      },
      db
    );
    return { db, owner, instructor, studioId, location };
  }

  test("assigns an instructor to a location and lists it both directions", async () => {
    const { db, owner, instructor, studioId, location } =
      await createOwnerInstructorAndLocation("assign");

    await assignInstructorToLocation(owner.id, studioId, instructor.id, location.id, db);

    expect(await listInstructorLocations(studioId, instructor.id, db)).toEqual([location.id]);
    expect(await listLocationInstructors(studioId, location.id, db)).toEqual([instructor.id]);
  });

  test("assigning the same pair twice is a no-op, not an error", async () => {
    const { db, owner, instructor, studioId, location } =
      await createOwnerInstructorAndLocation("dup");

    await assignInstructorToLocation(owner.id, studioId, instructor.id, location.id, db);

    await expect(
      assignInstructorToLocation(owner.id, studioId, instructor.id, location.id, db)
    ).resolves.not.toThrow();

    expect(await listInstructorLocations(studioId, instructor.id, db)).toEqual([location.id]);
  });

  // Final-review Finding 7.4: FK constraints bypass RLS, so the assignment
  // must verify both the instructor's membership and the location belong
  // to the caller's own studio.
  test("rejects a locationId that belongs to a different studio", async () => {
    const victim = await createOwnerInstructorAndLocation("xt-loc-victim");
    const attacker = await createOwnerInstructorAndLocation("xt-loc-attacker");

    await expect(
      assignInstructorToLocation(
        attacker.owner.id,
        attacker.studioId,
        attacker.instructor.id,
        victim.location.id,
        attacker.db
      )
    ).rejects.toThrow(LocationNotFoundError);

    expect(await listInstructorLocations(attacker.studioId, attacker.instructor.id, attacker.db)).toEqual([]);
  });

  test("rejects an instructor who is a member of a different studio but not this one", async () => {
    const victim = await createOwnerInstructorAndLocation("xt-instr-victim");
    const attacker = await createOwnerInstructorAndLocation("xt-instr-attacker");

    await expect(
      assignInstructorToLocation(
        attacker.owner.id,
        attacker.studioId,
        victim.instructor.id,
        attacker.location.id,
        attacker.db
      )
    ).rejects.toThrow(InstructorNotFoundError);

    expect(await listLocationInstructors(attacker.studioId, attacker.location.id, attacker.db)).toEqual([]);
  });

  test("rejects an instructor whose membership in this studio is not active", async () => {
    const { db, owner, instructor, studioId, location } = await createOwnerInstructorAndLocation("disabled");
    await withTenantContext(
      { userId: owner.id, tenantId: studioId },
      (tx) =>
        tx
          .update(memberships)
          .set({ status: "disabled" })
          .where(and(eq(memberships.studioId, studioId), eq(memberships.userId, instructor.id))),
      db
    );

    await expect(
      assignInstructorToLocation(owner.id, studioId, instructor.id, location.id, db)
    ).rejects.toThrow(InstructorNotFoundError);
  });

  test("a non-Owner cannot assign instructor-location pairs", async () => {
    const { instructor, studioId, location, db } =
      await createOwnerInstructorAndLocation("perm");

    await expect(
      assignInstructorToLocation(instructor.id, studioId, instructor.id, location.id, db)
    ).rejects.toThrow(PermissionDeniedError);
  });
});
