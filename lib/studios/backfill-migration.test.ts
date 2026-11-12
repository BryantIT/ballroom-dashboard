// lib/studios/backfill-migration.test.ts
//
// Regression test for drizzle/0018_backfill_branding_and_permission.sql.
// createTestDatabase() already runs every migration (including 0018)
// before any test body executes, so a studio inserted directly — bypassing
// provisionStudio entirely — simulates a studio that predates Phase 2
// (migrations 0016/0017): it has no studio_branding row and its owner
// role has no branding.manage grant. Re-running 0018's own two INSERT
// statements (safe, since they're idempotent) must then backfill both.
// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "../db/testing/test-database";
import * as schema from "../db/schema";
import { studios, roles, rolePermissions, studioBranding } from "../db/schema";

describe("0018 backfill migration", () => {
  let testDb: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    pool = new Pool({ connectionString: testDb.connectionUri });
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  async function rerunBackfillMigration() {
    const sql = readFileSync(
      path.join(process.cwd(), "drizzle/0018_backfill_branding_and_permission.sql"),
      "utf-8"
    );
    const statements = sql.split("--> statement-breakpoint").map((chunk) =>
      chunk
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim()
    );
    for (const statement of statements) {
      if (statement.length > 0) {
        await pool.query(statement);
      }
    }
  }

  test("backfills a studio_branding row and the owner's branding.manage grant for a pre-Phase-2 studio", async () => {
    const db = drizzle(pool, { schema });

    // Simulate a studio provisioned before Phase 2: insert the studio and
    // its owner role directly, bypassing provisionStudio — so no
    // studio_branding row and no branding.manage grant exist yet.
    const studioId = crypto.randomUUID();
    await db.insert(studios).values({ id: studioId, name: "Legacy Ballroom & Co." });
    const [ownerRole] = await db
      .insert(roles)
      .values({ studioId, code: "owner", name: "Owner" })
      .returning();

    const brandingBefore = await db
      .select()
      .from(studioBranding)
      .where(eq(studioBranding.studioId, studioId));
    expect(brandingBefore).toHaveLength(0);

    const grantBefore = await db
      .select()
      .from(rolePermissions)
      .where(
        and(
          eq(rolePermissions.roleId, ownerRole.id),
          eq(rolePermissions.permissionCode, "branding.manage")
        )
      );
    expect(grantBefore).toHaveLength(0);

    // Re-run the migration's own backfill statements again. This is safe
    // because they're idempotent (ON CONFLICT DO NOTHING), and it directly
    // tests the backfill logic against the pre-existing studio above.
    await rerunBackfillMigration();
    // Running it twice in a row also proves idempotency.
    await rerunBackfillMigration();

    const [brandingRow] = await db
      .select()
      .from(studioBranding)
      .where(eq(studioBranding.studioId, studioId));
    expect(brandingRow).toBeDefined();
    expect(brandingRow.slug.startsWith("legacy-ballroom-co-")).toBe(true);
    expect(brandingRow.slug.endsWith(studioId.slice(0, 8))).toBe(true);

    const [grantRow] = await db
      .select()
      .from(rolePermissions)
      .where(
        and(
          eq(rolePermissions.roleId, ownerRole.id),
          eq(rolePermissions.permissionCode, "branding.manage")
        )
      );
    expect(grantRow).toBeDefined();
    expect(grantRow.studioId).toBe(studioId);
  });
});
