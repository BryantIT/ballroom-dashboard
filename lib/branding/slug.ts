// lib/branding/slug.ts

const MAX_SLUG_LENGTH = 63;

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
  while (await isTaken(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}
