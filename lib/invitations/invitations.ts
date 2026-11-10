// lib/invitations/invitations.ts
import "server-only";
import { and, eq, gt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { withTenantContext } from "../db/with-tenant-context";
import { invitations, users, memberships, roles } from "../db/schema";
import * as schema from "../db/schema";

type Db = NodePgDatabase<typeof schema>;

const INVITATION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export class InvalidRoleError extends Error {
  constructor(message = "Role does not belong to this studio") {
    super(message);
    this.name = "InvalidRoleError";
  }
}

export class InvitationNotFoundError extends Error {
  constructor(message = "Invitation not found") {
    super(message);
    this.name = "InvitationNotFoundError";
  }
}

export class InvitationEmailMismatchError extends Error {
  constructor(message = "Invitation was issued to a different email address") {
    super(message);
    this.name = "InvitationEmailMismatchError";
  }
}

export class InvitationNotPendingError extends Error {
  constructor(message = "Invitation has already been accepted or has expired") {
    super(message);
    this.name = "InvitationNotPendingError";
  }
}

export class InvitationAlreadyMemberError extends Error {
  constructor(message = "User is already a member of this studio") {
    super(message);
    this.name = "InvitationAlreadyMemberError";
  }
}

export async function createInvitation(
  input: { studioId: string; email: string; roleId: string; invitedByUserId: string },
  database?: Db
): Promise<{ invitationId: string; token: string }> {
  const token = crypto.randomUUID();
  const row = await withTenantContext(
    { userId: input.invitedByUserId, tenantId: input.studioId },
    async (tx) => {
      // FK checks bypass RLS, so a roleId from another studio would be
      // silently accepted by the insert below — verify ownership here.
      const [role] = await tx
        .select()
        .from(roles)
        .where(and(eq(roles.id, input.roleId), eq(roles.studioId, input.studioId)))
        .limit(1);
      if (!role) {
        throw new InvalidRoleError(
          `Role ${input.roleId} does not belong to studio ${input.studioId}`
        );
      }

      const [inserted] = await tx
        .insert(invitations)
        .values({
          studioId: input.studioId,
          email: input.email,
          roleId: input.roleId,
          token,
          invitedByUserId: input.invitedByUserId,
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        })
        .returning();
      return inserted;
    },
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
    throw new InvitationNotFoundError();
  }

  // Bind acceptance to the invited address: a forwarded/leaked token must
  // not be redeemable by an arbitrary account.
  const db = database ?? (await import("../db/client")).db;
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    throw new InvitationEmailMismatchError();
  }

  return withTenantContext(
    { userId, tenantId: invitation.studioId },
    async (tx) => {
      // Atomic claim: the WHERE clause is the sole authority on
      // pending/unexpired, re-checked at write time, so two concurrent
      // accepts cannot both succeed.
      const [accepted] = await tx
        .update(invitations)
        .set({ status: "accepted" })
        .where(
          and(
            eq(invitations.id, invitation.invitationId),
            eq(invitations.status, "pending"),
            gt(invitations.expiresAt, new Date())
          )
        )
        .returning();
      if (!accepted) {
        throw new InvitationNotPendingError();
      }

      const [existing] = await tx
        .select()
        .from(memberships)
        .where(and(eq(memberships.studioId, invitation.studioId), eq(memberships.userId, userId)))
        .limit(1);
      if (existing) {
        throw new InvitationAlreadyMemberError();
      }

      const [membership] = await tx
        .insert(memberships)
        .values({
          studioId: invitation.studioId,
          userId,
          roleId: invitation.roleId,
          status: "active",
        })
        .returning();

      return { membershipId: membership.id, studioId: invitation.studioId };
    },
    database
  );
}
