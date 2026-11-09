// lib/invitations/invitations.ts
import "server-only";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { withTenantContext } from "../db/with-tenant-context";
import { invitations, users, memberships } from "../db/schema";
import * as schema from "../db/schema";

type Db = NodePgDatabase<typeof schema>;

const INVITATION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export async function createInvitation(
  input: { studioId: string; email: string; roleId: string; invitedByUserId: string },
  database?: Db
): Promise<{ invitationId: string; token: string }> {
  const token = crypto.randomUUID();
  const [row] = await withTenantContext(
    { userId: input.invitedByUserId, tenantId: input.studioId },
    (tx) =>
      tx
        .insert(invitations)
        .values({
          studioId: input.studioId,
          email: input.email,
          roleId: input.roleId,
          token,
          invitedByUserId: input.invitedByUserId,
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        })
        .returning(),
    database
  );
  return { invitationId: row.id, token: row.token };
}

export type InvitationLookup = {
  invitationId: string;
  studioId: string;
  roleId: string;
  email: string;
  status: string;
  expiresAt: Date;
} | null;

// Deliberately NOT tenant-scoped — see the schema.ts comment on the
// invitations table. This is the one query in the invitation flow that
// runs before any tenant context can exist.
export async function lookupInvitationByToken(
  token: string,
  database?: Db
): Promise<InvitationLookup> {
  const db = database ?? (await import("../db/client")).db;
  const [row] = await db.select().from(invitations).where(eq(invitations.token, token)).limit(1);
  if (!row) {
    return null;
  }
  return {
    invitationId: row.id,
    studioId: row.studioId,
    roleId: row.roleId,
    email: row.email,
    status: row.status,
    expiresAt: row.expiresAt,
  };
}

export async function acceptInvitation(
  token: string,
  userId: string,
  database?: Db
): Promise<{ membershipId: string; studioId: string }> {
  const invitation = await lookupInvitationByToken(token, database);
  if (!invitation) {
    throw new Error("Invitation not found");
  }
  if (invitation.status !== "pending") {
    throw new Error(`Invitation is already ${invitation.status}`);
  }
  if (invitation.expiresAt.getTime() < Date.now()) {
    throw new Error("Invitation has expired");
  }

  return withTenantContext(
    { userId, tenantId: invitation.studioId },
    async (tx) => {
      const [membership] = await tx
        .insert(memberships)
        .values({
          studioId: invitation.studioId,
          userId,
          roleId: invitation.roleId,
          status: "active",
        })
        .returning();

      await tx
        .update(invitations)
        .set({ status: "accepted" })
        .where(eq(invitations.id, invitation.invitationId));

      return { membershipId: membership.id, studioId: invitation.studioId };
    },
    database
  );
}
