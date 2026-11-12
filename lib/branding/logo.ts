// lib/branding/logo.ts
import "server-only";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { studioBranding } from "../db/schema";
import * as schema from "../db/schema";
import type { PublicBranding } from "./public-branding";

type Db = NodePgDatabase<typeof schema>;
type Put = typeof import("@vercel/blob").put;

export class InvalidLogoFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLogoFileError";
  }
}

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml"] as const;

export async function uploadLogo(studioId: string, file: File, put?: Put): Promise<string> {
  const putBlob = put ?? (await import("@vercel/blob")).put;

  if (!ALLOWED_LOGO_TYPES.includes(file.type as (typeof ALLOWED_LOGO_TYPES)[number])) {
    throw new InvalidLogoFileError(
      `Logo file type "${file.type}" is not allowed; must be one of ${ALLOWED_LOGO_TYPES.join(", ")}`
    );
  }
  if (file.size > MAX_LOGO_BYTES) {
    throw new InvalidLogoFileError(
      `Logo file size ${file.size} bytes exceeds the maximum of ${MAX_LOGO_BYTES} bytes`
    );
  }

  const blob = await putBlob(`studio-logos/${studioId}-${Date.now()}`, file, { access: "public" });
  return blob.url;
}

export async function updateBrandingLogo(
  userId: string,
  studioId: string,
  file: File,
  database?: Db,
  put?: Put
): Promise<PublicBranding> {
  const db = database ?? (await import("../db/client")).db;

  // Imported dynamically (rather than at module top level, like
  // branding.ts does) so that merely importing this module — e.g. from
  // logo.test.ts, which exercises uploadLogo without a database — doesn't
  // eagerly pull in lib/db/client.ts via authorization.ts's import chain
  // and throw on a missing DATABASE_RUNTIME_URL.
  const { requirePermission } = await import("../auth/authorization");
  const { getBrandingByStudioId } = await import("./branding");

  // Propagates PermissionDeniedError unchanged on failure.
  await requirePermission(userId, studioId, "branding.manage", db);

  const logoUrl = await uploadLogo(studioId, file, put);

  await db
    .update(studioBranding)
    .set({ logoUrl, updatedAt: new Date() })
    .where(eq(studioBranding.studioId, studioId));

  return getBrandingByStudioId(studioId, db);
}
