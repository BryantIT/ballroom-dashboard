import "server-only";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db as defaultDb } from "./client";
import type * as schema from "./schema";

export type TenantContext = {
  userId: string;
  tenantId: string | null;
};

type Db = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Runs `callback` inside a transaction with `app.user_id` and (if present)
 * `app.tenant_id` set via `set_config(..., true)`, scoped to that
 * transaction only (never leaks to the next transaction on a pooled
 * connection — see lib/db/with-tenant-context.test.ts). RLS policies on
 * tenant-owned tables key off these two settings.
 */
export async function withTenantContext<T>(
  context: TenantContext,
  callback: (tx: Tx) => Promise<T>,
  database: Db = defaultDb
): Promise<T> {
  return database.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.user_id', ${context.userId}, true)`
    );
    if (context.tenantId) {
      await tx.execute(
        sql`select set_config('app.tenant_id', ${context.tenantId}, true)`
      );
    }
    return callback(tx);
  });
}
