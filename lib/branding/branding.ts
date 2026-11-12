// lib/branding/branding.ts
import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { studioBranding, studios } from "../db/schema";
import * as schema from "../db/schema";
import { requirePermission } from "../auth/authorization";
import type { PublicBranding } from "./public-branding";
import type { ThemePresetKey } from "./presets";

type Db = NodePgDatabase<typeof schema>;

export class SlugTakenError extends Error {
  constructor(slug: string) {
    super(`Slug "${slug}" is already in use by another studio`);
    this.name = "SlugTakenError";
  }
}

export type UpdateBrandingInput = {
  themePreset?: ThemePresetKey;
  accentColorOverride?: string | null;
  colorMode?: "light" | "dark" | "system";
  slug?: string;
};

// studio_branding has no RLS (see the schema.ts comment on that table), so
// this lookup by studioId is a plain, unscoped read — same as the first
// query in getPublicBrandingBySlug (Task 5). studios DOES have RLS
// (tenant_isolation, keyed only on app.tenant_id), so once we know the
// legitimate studioId from the unscoped branding row, we open a short
// transaction that sets app.tenant_id to that same id before reading
// studios.name — the exact pattern Task 5 established. No app.user_id is
// set: no policy on studios checks it, and this isn't withTenantContext
// because callers of this function may not have an open tenant context
// (requirePermission already closed its own by the time it returns).
export async function getBrandingByStudioId(
  studioId: string,
  database?: Db
): Promise<PublicBranding> {
  const db = database ?? (await import("../db/client")).db;

  const [branding] = await db
    .select()
    .from(studioBranding)
    .where(eq(studioBranding.studioId, studioId))
    .limit(1);
  if (!branding) {
    // A branding row always exists after provisioning (Task 2), so a
    // missing row here means a bad studioId, not a legitimate empty state.
    throw new Error(`No branding row found for studio ${studioId}`);
  }

  const [studioRow] = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${studioId}, true)`);
    return tx.select({ name: studios.name }).from(studios).where(eq(studios.id, studioId)).limit(1);
  });
  if (!studioRow) {
    throw new Error(`No studio found for studio ${studioId}`);
  }

  return {
    studioId: branding.studioId,
    studioName: studioRow.name,
    slug: branding.slug,
    themePreset: branding.themePreset as ThemePresetKey,
    accentColorOverride: branding.accentColorOverride,
    colorMode: branding.colorMode as "light" | "dark" | "system",
    logoUrl: branding.logoUrl,
  };
}

export async function updateBranding(
  userId: string,
  studioId: string,
  input: UpdateBrandingInput,
  database?: Db
): Promise<PublicBranding> {
  const db = database ?? (await import("../db/client")).db;

  // Propagates PermissionDeniedError unchanged on failure.
  await requirePermission(userId, studioId, "branding.manage", db);

  if (input.slug !== undefined) {
    const current = await getBrandingByStudioId(studioId, db);
    if (input.slug !== current.slug) {
      const [existing] = await db
        .select({ studioId: studioBranding.studioId })
        .from(studioBranding)
        .where(and(eq(studioBranding.slug, input.slug), ne(studioBranding.studioId, studioId)))
        .limit(1);
      if (existing) {
        throw new SlugTakenError(input.slug);
      }
    }
  }

  await db
    .update(studioBranding)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(studioBranding.studioId, studioId));

  return getBrandingByStudioId(studioId, db);
}
