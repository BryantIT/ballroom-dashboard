// lib/branding/slug.ts

const MAX_SLUG_LENGTH = 63;

// Slugs that collide with infrastructure the canonical app itself needs
// once a real domain exists (e.g. app.ballroomdash.com, api.ballroomdash.com).
// A studio must never be able to claim one of these as its subdomain slug —
// doing so would let that studio's branding render on what should be the
// canonical app's own front door.
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "app",
  "www",
  "api",
  "admin",
  "auth",
  "mail",
  "login",
  "dashboard",
  "static",
  "assets",
]);

/**
 * Converts a studio name into a URL-safe slug: lowercase, hyphen-separated,
 * with any run of non-alphanumeric characters collapsed to a single hyphen
 * and leading/trailing hyphens trimmed. Falls back to "studio" if nothing
 * alphanumeric remains, and truncates to 63 characters.
 */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const truncated = base.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, "");

  return truncated.length > 0 ? truncated : "studio";
}

/**
 * Generates a slug for `name` that is guaranteed unique according to
 * `isTaken`. Tries the base slug first, then `${base}-2`, `${base}-3`, ...
 * until `isTaken` resolves false for a candidate.
 */
export async function generateUniqueSlug(
  name: string,
  isTaken: (candidate: string) => Promise<boolean>
): Promise<string> {
  const base = slugify(name);

  let candidate = base;
  let suffix = 2;
  while (RESERVED_SLUGS.has(candidate) || (await isTaken(candidate))) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}
