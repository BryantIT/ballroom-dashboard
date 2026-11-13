-- Backfills data for studios/roles that were provisioned before Phase 2
-- (migrations 0016/0017) existed. provisionStudio (lib/studios/provision.ts)
-- only writes a studio_branding row and a branding.manage role_permissions
-- grant for studios created AFTER this phase shipped; any studio created
-- earlier has neither, which otherwise 500s app/dashboard/layout.tsx (no
-- branding row) and 403s every Owner (no grant) once branding itself works.
--
-- Both inserts are idempotent (ON CONFLICT DO NOTHING on each table's own
-- primary key), matching how real deployments re-run migrations.

-- One studio_branding row per pre-existing studio that doesn't have one
-- yet. The slug is generated in pure SQL rather than reproducing the TS
-- slugify()/generateUniqueSlug() algorithm: lowercase the trimmed name,
-- collapse any run of non-alphanumeric characters to a single hyphen,
-- strip any leading/trailing hyphen left by that collapse (a name like
-- "Legacy Ballroom & Co." would otherwise end in "-" before the suffix,
-- producing a double hyphen that fails updateBrandingSchema's slug
-- regex), cap the base at 54 characters so the base plus "-" plus the
-- 8-character suffix never exceeds the schema's 63-character max, fall
-- back to "studio" if nothing alphanumeric survives, then append the
-- first 8 characters of the studio's UUID. The UUID-derived suffix
-- guarantees uniqueness unconditionally for this one-time backfill
-- (unlike the TS path's collision-only numeric suffixing, which newly
-- provisioned studios still use) — a deliberate, acceptable inconsistency.
INSERT INTO "app"."studio_branding" (studio_id, slug)
SELECT
  s.id,
  COALESCE(
    NULLIF(
      regexp_replace(
        left(
          regexp_replace(
            lower(regexp_replace(trim(s.name), '[^a-zA-Z0-9]+', '-', 'g')),
            '(^-+|-+$)', '', 'g'
          ),
          54
        ),
        '(^-+|-+$)', '', 'g'
      ),
      ''
    ),
    'studio'
  ) || '-' || substr(s.id::text, 1, 8)
FROM "app"."studios" s
WHERE NOT EXISTS (
  SELECT 1 FROM "app"."studio_branding" sb WHERE sb.studio_id = s.id
)
ON CONFLICT (studio_id) DO NOTHING;
--> statement-breakpoint

-- Grant branding.manage to every pre-existing owner role that doesn't
-- already have it.
INSERT INTO "app"."role_permissions" (role_id, permission_code, studio_id)
SELECT
  r.id,
  'branding.manage',
  r.studio_id
FROM "app"."roles" r
WHERE r.code = 'owner'
  AND NOT EXISTS (
    SELECT 1 FROM "app"."role_permissions" rp
    WHERE rp.role_id = r.id AND rp.permission_code = 'branding.manage'
  )
ON CONFLICT (role_id, permission_code) DO NOTHING;
