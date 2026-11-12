// lib/branding/public-branding.ts
import "server-only";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { studioBranding, studios } from "../db/schema";
import * as schema from "../db/schema";
import type { ThemePresetKey } from "./presets";

type Db = NodePgDatabase<typeof schema>;

export type PublicBranding = {
  studioId: string;
  studioName: string;
  slug: string;
  themePreset: ThemePresetKey;
  accentColorOverride: string | null;
  colorMode: "light" | "dark" | "system";
  logoUrl: string | null;
};

// Deliberately NOT withTenantContext — see the schema.ts comment on
// studio_branding. This lookup runs before any login/session exists, so
// there is no tenant to set context for yet; studio_branding has no RLS
// for exactly this reason. This first query is a plain, unscoped read.
export async function getPublicBrandingBySlug(
  slug: string,
  database?: Db
): Promise<PublicBranding | null> {
  const db = database ?? (await import("../db/client")).db;

  const [branding] = await db
    .select()
    .from(studioBranding)
    .where(eq(studioBranding.slug, slug))
    .limit(1);
  if (!branding) {
    return null;
  }

  // studios DOES have RLS (tenant_isolation, drizzle/0003) requiring
  // app.tenant_id to match the row — unlike studio_branding, it was never
  // meant to be read pre-auth. We only just resolved branding.studioId
  // from the unscoped slug lookup above, so scoping this one read to that
  // same, now-known-legitimate studio id reveals nothing beyond what the
  // slug itself already grants access to. No app.user_id is set (no
  // policy on studios checks it) and this intentionally isn't
  // withTenantContext — there is still no authenticated user here.
  const [studioRow] = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${branding.studioId}, true)`);
    return tx.select({ name: studios.name }).from(studios).where(eq(studios.id, branding.studioId)).limit(1);
  });
  if (!studioRow) {
    return null;
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
