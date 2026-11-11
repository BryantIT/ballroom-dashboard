// lib/invitations/invitations.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "../db/testing/test-database";
import { users } from "../db/schema";
import * as schema from "../db/schema";

describe("invitations", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let provisionStudio: typeof import("../studios/provision").provisionStudio;
  let createInvitation: typeof import("./invitations").createInvitation;
  let lookupInvitationByToken: typeof import("./invitations").lookupInvitationByToken;
  let acceptInvitation: typeof import("./invitations").acceptInvitation;
  let InvitationNotPendingError: typeof import("./invitations").InvitationNotPendingError;
  let InvitationEmailMismatchError: typeof import("./invitations").InvitationEmailMismatchError;
  let InvitationAlreadyMemberError: typeof import("./invitations").InvitationAlreadyMemberError;
  let InvalidRoleError: typeof import("./invitations").InvalidRoleError;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ provisionStudio } = await import("../studios/provision"));
    // Error classes are imported dynamically alongside the functions (the
    // module must load after DATABASE_RUNTIME_URL is set), so instanceof
    // checks compare against the same class identity the code throws.
    ({
      createInvitation,
      lookupInvitationByToken,
      acceptInvitation,
      InvitationNotPendingError,
      InvitationEmailMismatchError,
      InvitationAlreadyMemberError,
      InvalidRoleError,
    } = await import("./invitations"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  async function setupStudioWithAdminRole(db: ReturnType<typeof drizzle>) {
    const [owner] = await db.insert(users).values({ email: `owner-${crypto.randomUUID()}@example.com` }).returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db as never
    );
    const { eq, and } = await import("drizzle-orm");
    // roles is RLS-protected (Task 3): a plain select on the app_runtime
    // connection with no tenant context set returns zero rows, so this
    // lookup runs inside withTenantContext like every other roles query.
    // Imported dynamically (like provisionStudio/createInvitation above)
    // since the static import in with-tenant-context.ts reads
    // DATABASE_RUNTIME_URL at module-load time, before beforeAll sets it.
    const { withTenantContext } = await import("../db/with-tenant-context");
    const [adminRole] = await withTenantContext(
      { userId: owner.id, tenantId: studioId },
      (tx) =>
        tx
          .select()
          .from(schema.roles)
          .where(and(eq(schema.roles.studioId, studioId), eq(schema.roles.code, "admin"))),
      db as never
    );
    return { owner, studioId, adminRoleId: adminRole.id };
  }

  test("an accepted invitation creates an active membership with the invited role", async () => {
    const db = drizzle(pool, { schema });
    const { studioId, adminRoleId, owner } = await setupStudioWithAdminRole(db);

    const { token } = await createInvitation(
      { studioId, email: "newstaff@example.com", roleId: adminRoleId, invitedByUserId: owner.id },
      db
    );

    const [invitee] = await db.insert(users).values({ email: "newstaff@example.com" }).returning();
    const result = await acceptInvitation(token, invitee.id, db);

    expect(result.studioId).toBe(studioId);

    const { eq } = await import("drizzle-orm");
    // memberships is RLS-protected (Task 4): self_or_tenant_select requires
    // app.user_id or app.tenant_id to be set, so this verification select
    // runs inside withTenantContext too (see the roles lookup above).
    const { withTenantContext } = await import("../db/with-tenant-context");
    const [membership] = await withTenantContext(
      { userId: invitee.id, tenantId: studioId },
      (tx) =>
        tx.select().from(schema.memberships).where(eq(schema.memberships.id, result.membershipId)),
      db as never
    );
    expect(membership?.userId).toBe(invitee.id);
    expect(membership?.roleId).toBe(adminRoleId);
    expect(membership?.status).toBe("active");
  });

  test("an expired invitation cannot be accepted", async () => {
    const db = drizzle(pool, { schema });
    const { studioId, adminRoleId, owner } = await setupStudioWithAdminRole(db);

    const { token } = await createInvitation(
      { studioId, email: "late@example.com", roleId: adminRoleId, invitedByUserId: owner.id },
      db
    );
    const { eq } = await import("drizzle-orm");
    await db
      .update(schema.invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.invitations.token, token));

    const [invitee] = await db.insert(users).values({ email: "late@example.com" }).returning();
    await expect(acceptInvitation(token, invitee.id, db)).rejects.toThrow(
      InvitationNotPendingError
    );
  });

  test("an already-accepted invitation cannot be accepted again", async () => {
    const db = drizzle(pool, { schema });
    const { studioId, adminRoleId, owner } = await setupStudioWithAdminRole(db);

    const { token } = await createInvitation(
      { studioId, email: "twice@example.com", roleId: adminRoleId, invitedByUserId: owner.id },
      db
    );
    const [invitee] = await db.insert(users).values({ email: "twice@example.com" }).returning();
    await acceptInvitation(token, invitee.id, db);

    // Re-accept with the same (email-matching) account: with email binding
    // enforced, a different account would now fail on the email check
    // first and never exercise the already-accepted path.
    await expect(acceptInvitation(token, invitee.id, db)).rejects.toThrow(
      InvitationNotPendingError
    );
  });

  test("an invitation cannot be accepted by an account with a different email", async () => {
    const db = drizzle(pool, { schema });
    const { studioId, adminRoleId, owner } = await setupStudioWithAdminRole(db);

    const { token } = await createInvitation(
      { studioId, email: "intended@example.com", roleId: adminRoleId, invitedByUserId: owner.id },
      db
    );
    const [other] = await db.insert(users).values({ email: "forwarded-to@example.com" }).returning();
    await expect(acceptInvitation(token, other.id, db)).rejects.toThrow(
      InvitationEmailMismatchError
    );
  });

  test("an invitation cannot be accepted by an account that is already a member of the studio", async () => {
    const db = drizzle(pool, { schema });
    const { studioId, adminRoleId, owner } = await setupStudioWithAdminRole(db);

    const { token: tokenX } = await createInvitation(
      { studioId, email: "member@example.com", roleId: adminRoleId, invitedByUserId: owner.id },
      db
    );
    const { token: tokenY } = await createInvitation(
      { studioId, email: "member@example.com", roleId: adminRoleId, invitedByUserId: owner.id },
      db
    );
    const [invitee] = await db.insert(users).values({ email: "member@example.com" }).returning();
    await acceptInvitation(tokenX, invitee.id, db);

    await expect(acceptInvitation(tokenY, invitee.id, db)).rejects.toThrow(
      InvitationAlreadyMemberError
    );
  });

  test("an invitation cannot be created with a role from a different studio", async () => {
    const db = drizzle(pool, { schema });
    const { studioId: studioA, owner: ownerA } = await setupStudioWithAdminRole(db);
    const { adminRoleId: studioBAdminRoleId } = await setupStudioWithAdminRole(db);

    await expect(
      createInvitation(
        {
          studioId: studioA,
          email: "crossrole@example.com",
          roleId: studioBAdminRoleId,
          invitedByUserId: ownerA.id,
        },
        db
      )
    ).rejects.toThrow(InvalidRoleError);
  });

  test("an unknown token returns null from lookupInvitationByToken", async () => {
    const db = drizzle(pool, { schema });
    expect(await lookupInvitationByToken("not-a-real-token", db)).toBeNull();
  });
});
