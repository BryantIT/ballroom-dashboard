// lib/auth/authorization.ts
import "server-only";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { withTenantContext } from "../db/with-tenant-context";
import { memberships, roles, rolePermissions } from "../db/schema";
import * as schema from "../db/schema";
import type { PermissionCode } from "./permissions";

type Db = NodePgDatabase<typeof schema>;

export class PermissionDeniedError extends Error {
  constructor(userId: string, studioId: string, code: PermissionCode) {
    super(`User ${userId} lacks permission "${code}" in studio ${studioId}`);
    this.name = "PermissionDeniedError";
  }
}

export type ActiveMembership = {
  membershipId: string;
  studioId: string;
  roleId: string;
  roleCode: string;
};

export async function getActiveMembership(
  userId: string,
  studioId: string,
  database?: Db
): Promise<ActiveMembership | null> {
  return withTenantContext(
    { userId, tenantId: studioId },
    async (tx) => {
      const [row] = await tx
        .select({
          membershipId: memberships.id,
          studioId: memberships.studioId,
          roleId: memberships.roleId,
          roleCode: roles.code,
        })
        .from(memberships)
        .innerJoin(roles, eq(memberships.roleId, roles.id))
        .where(
          and(
            eq(memberships.userId, userId),
            eq(memberships.studioId, studioId),
            eq(memberships.status, "active")
          )
        )
        .limit(1);
      return row ?? null;
    },
    database
  );
}

export async function hasPermission(
  userId: string,
  studioId: string,
  code: PermissionCode,
  database?: Db
): Promise<boolean> {
  const membership = await getActiveMembership(userId, studioId, database);
  if (!membership) {
    return false;
  }

  return withTenantContext(
    { userId, tenantId: studioId },
    async (tx) => {
      const [grant] = await tx
        .select({ permissionCode: rolePermissions.permissionCode })
        .from(rolePermissions)
        .where(
          and(eq(rolePermissions.roleId, membership.roleId), eq(rolePermissions.permissionCode, code))
        )
        .limit(1);
      return grant !== undefined;
    },
    database
  );
}

export async function requirePermission(
  userId: string,
  studioId: string,
  code: PermissionCode,
  database?: Db
): Promise<ActiveMembership> {
  const membership = await getActiveMembership(userId, studioId, database);
  if (!membership || !(await hasPermission(userId, studioId, code, database))) {
    throw new PermissionDeniedError(userId, studioId, code);
  }
  return membership;
}
