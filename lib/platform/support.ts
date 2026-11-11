// lib/platform/support.ts
import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { withTenantContext } from "../db/with-tenant-context";
import { platformAdmins, supportSessions } from "../db/schema";
import * as schema from "../db/schema";

type Db = NodePgDatabase<typeof schema>;

export async function isPlatformAdmin(userId: string, database?: Db): Promise<boolean> {
  const db = database ?? (await import("../db/client")).db;
  const [row] = await db
    .select()
    .from(platformAdmins)
    .where(eq(platformAdmins.userId, userId))
    .limit(1);
  return row !== undefined;
}

export async function startSupportSession(
  input: { adminUserId: string; studioId: string; reason: string },
  database?: Db
): Promise<{ sessionId: string }> {
  if (!(await isPlatformAdmin(input.adminUserId, database))) {
    throw new Error(`User ${input.adminUserId} is not a platform admin`);
  }

  const [row] = await withTenantContext(
    { userId: input.adminUserId, tenantId: input.studioId },
    (tx) =>
      tx
        .insert(supportSessions)
        .values({
          adminUserId: input.adminUserId,
          studioId: input.studioId,
          reason: input.reason,
        })
        .returning(),
    database
  );
  return { sessionId: row.id };
}

export async function endSupportSession(
  sessionId: string,
  studioId: string,
  database?: Db
): Promise<void> {
  await withTenantContext(
    { userId: "platform-support", tenantId: studioId },
    (tx) =>
      tx
        .update(supportSessions)
        .set({ endedAt: new Date() })
        .where(eq(supportSessions.id, sessionId)),
    database
  );
}

export async function requireActiveSupportSession(
  adminUserId: string,
  studioId: string,
  database?: Db
): Promise<void> {
  const [row] = await withTenantContext(
    { userId: adminUserId, tenantId: studioId },
    (tx) =>
      tx
        .select()
        .from(supportSessions)
        .where(
          and(
            eq(supportSessions.adminUserId, adminUserId),
            eq(supportSessions.studioId, studioId),
            isNull(supportSessions.endedAt)
          )
        )
        .limit(1),
    database
  );
  if (!row) {
    throw new Error(
      `No active support session for admin ${adminUserId} on studio ${studioId}`
    );
  }
}
