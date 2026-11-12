# Phase 2 — Studio Theming & Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A studio owner can pick a theme preset, set an accent color,
upload a logo, and get a branded subdomain and login screen — and, since
no dashboard UI exists yet after Phases 0–1, this phase also builds the
first authenticated dashboard shell and the sign-in page themed from the
start.

**Architecture:** A new `studio_branding` table (deliberately **not**
RLS-protected, for the same structural reason `invitations` isn't: the
public subdomain lookup must resolve a studio from a slug *before* any
tenant context can be set — enforcement is entirely service-layer, same
discipline Phase 1 already established). Six curated theme presets are
TypeScript data (`lib/branding/presets.ts`), rendered as a server-emitted
`<style>` tag scoping CSS custom properties to a wrapper element, so a
per-studio preset layers on top of Phase 0's existing token names without
a new theming engine. The authenticated dashboard and the real sign-in
form live at one canonical app route (`/dashboard`, `/login`); a studio's
subdomain only drives the look of the public, pre-auth splash at `/`.

**Tech Stack:** Next.js 16 App Router (Server Components for data
fetching, Client Components for forms), Drizzle ORM, Zod, `@vercel/blob`
(new dependency, for logo storage), existing `next-themes` dark-mode
plumbing, Vitest + Testcontainers Postgres for integration tests,
`@testing-library/react` for component tests.

**Spec:** `docs/superpowers/specs/2026-11-11-phase-2-theming-branding-design.md`
(the design doc this plan implements — read both; Phase 2 is additive to
`references/ballroom_dash_spec_v0_3.md`, not derived from it).

## Global Constraints

- Six theme presets, exact keys `midnight`, `blush`, `noir`, `garden`,
  `sunset`, `ocean` — each with a light and dark token set (full hex
  values fixed in Task 3's table; do not invent different values).
- `branding.manage` permission: granted only to the built-in Owner role
  (not Admin), matching the existing `locations.manage` precedent in
  `lib/auth/permissions.ts`.
- Logo upload: recommended square 512×512px, SVG or PNG, transparent
  background, under 2MB. `MAX_LOGO_BYTES = 2 * 1024 * 1024`;
  `ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml"]`.
  Rendering is CSS `object-fit: contain` only — never server-side
  resizing/re-encoding.
- Slug format: lowercase, matches `^[a-z0-9]+(-[a-z0-9]+)*$`, max 63
  characters, unique across all studios. Auto-generated from the studio
  name at provisioning time; collisions resolved with a numeric suffix
  (`-2`, `-3`, ...).
- `studio_branding` has **no RLS** — same exception category as
  `invitations`/`permissions`/`users` (see `lib/db/schema.ts`'s existing
  comments on those). All scoping is enforced in `lib/branding/*.ts`,
  never assumed from the database.
- The authenticated dashboard and the real sign-in form live at one
  canonical route (`/dashboard`, `/login`); a studio's subdomain only
  changes what renders at `/` before authentication. Subdomain
  resolution runs as a normal Node.js-runtime server component (not
  Next.js Edge Middleware — the DB layer isn't edge-compatible), and is
  domain-agnostic (no assumption about which root domain is in use). A
  non-production `?studio=<slug>` query override on `/` exists for local
  dev, since `localhost` has no real subdomain.
- An unrecognized subdomain redirects to `/login` — never an error page.
- `studio_branding`'s `app_runtime` grant in `scripts/db-setup-roles.sql`
  is `SELECT, INSERT, UPDATE` only (no `DELETE` — same as
  `students`/`student_assignments`).

## Review Focus

- Two studios whose names would slugify identically (e.g. "Gold Coast
  Dance" and "Gold Coast Dance Studio" both → `gold-coast-dance...`) —
  the second one provisioned must get a numeric-suffixed slug, not a
  collision or a 500. Covered in Task 2.
- A visitor on a subdomain that doesn't match any studio (mistyped,
  studio renamed, never existed) must land on a normal login page, not
  an error. Covered in Task 10.
- A logo upload with the wrong MIME type or over 2MB must be rejected
  before any network call to blob storage, with a clear error — not
  silently accepted, not a crash. Covered in Task 7.
- A non-Owner (Admin or Instructor) attempting to update branding or
  upload a logo must get a clean permission error, not a silent success
  or an unhandled 500 — `branding.manage` is Owner-only by design, and
  Admin is the easy role to mistakenly grant it to by analogy with other
  admin-ish permissions. Covered in Task 6 and Task 8.
- Changing a studio's slug to one already used by another studio must
  fail with a clear, specific error — not a raw Postgres unique-
  constraint violation surfacing as a generic 500. Covered in Task 6.

---

### Task 1: `studio_branding` table, `branding.manage` permission, runtime grants

**Files:**
- Modify: `lib/db/schema.ts` (add `studioBranding` table + explanatory
  comment on the no-RLS exception)
- Modify: `lib/auth/permissions.ts` (add `branding.manage` to
  `PERMISSION_CODES`, `PERMISSION_DESCRIPTIONS`, and the `owner` entry of
  `BUILTIN_ROLE_PERMISSIONS` — leave `admin`/`instructor` unchanged)
- Modify: `scripts/db-setup-roles.sql` (add the GRANT line)
- Create migration: `drizzle/00xx_studio_branding.sql` (via
  `npm run db:generate` after the schema change)
- Test: `lib/db/schema.studioBranding.test.ts`
- Test: `lib/auth/permissions.test.ts` (extend existing file)

**Interfaces:**
- Produces: `studioBranding` Drizzle table with columns `studioId`
  (uuid, PK, references `studios.id`), `slug` (text, not null, unique),
  `themePreset` (text, not null, default `"midnight"`),
  `accentColorOverride` (text, nullable), `colorMode` (text, not null,
  default `"system"`), `logoUrl` (text, nullable), `createdAt`,
  `updatedAt` (timestamps, both `defaultNow()`).
- Produces: `"branding.manage"` added to the `PermissionCode` union.

- [ ] **Step 1: Write the failing schema test**

```ts
// lib/db/schema.studioBranding.test.ts
import { describe, expect, test } from "vitest";
import { studioBranding } from "./schema";

describe("studioBranding table", () => {
  test("has the expected columns with defaults", () => {
    expect(Object.keys(studioBranding)).toEqual(
      expect.arrayContaining([
        "studioId", "slug", "themePreset", "accentColorOverride",
        "colorMode", "logoUrl", "createdAt", "updatedAt",
      ])
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/db/schema.studioBranding.test.ts`
Expected: FAIL — `studioBranding` is not exported.

- [ ] **Step 3: Add the table to `lib/db/schema.ts`**

Place it after the `students`/`studentAssignments` block, with a comment
explaining the no-RLS exception (mirror the existing comment style on
`invitations`): the public subdomain lookup (Task 5) must resolve a
studio from a slug before any `app.tenant_id` can be set, so this table
cannot be gated by the same tenant-context RLS pattern as
`locations`/`rooms`/etc. — enforcement of who may *write* it lives
entirely in `lib/branding/branding.ts` (Task 6), via an explicit
`requirePermission(..., "branding.manage")` call, not RLS.

```ts
export const studioBranding = appSchema.table("studio_branding", {
  studioId: uuid("studio_id").primaryKey().references(() => studios.id),
  slug: text("slug").notNull().unique(),
  themePreset: text("theme_preset").notNull().default("midnight"),
  accentColorOverride: text("accent_color_override"),
  colorMode: text("color_mode").notNull().default("system"),
  logoUrl: text("logo_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/db/schema.studioBranding.test.ts` — PASS.

- [ ] **Step 5: Add `branding.manage` to the permission catalog**

In `lib/auth/permissions.ts`: add `"branding.manage"` to
`PERMISSION_CODES` (anywhere in the array — order doesn't matter), add
`"branding.manage": "Manage studio theme, logo, and subdomain slug"` to
`PERMISSION_DESCRIPTIONS`. Do **not** add it to `admin` or `instructor`
in `BUILTIN_ROLE_PERMISSIONS` — `owner: [...PERMISSION_CODES]` already
picks it up automatically.

- [ ] **Step 6: Extend the permissions test**

Add to `lib/auth/permissions.test.ts`:

```ts
test("branding.manage is owner-only, matching locations.manage", () => {
  expect(BUILTIN_ROLE_PERMISSIONS.owner).toContain("branding.manage");
  expect(BUILTIN_ROLE_PERMISSIONS.admin).not.toContain("branding.manage");
  expect(BUILTIN_ROLE_PERMISSIONS.instructor).not.toContain("branding.manage");
});
```

Run: `npx vitest run lib/auth/permissions.test.ts` — PASS.

- [ ] **Step 7: Generate the migration**

Run: `npm run db:generate` — review the generated SQL in
`drizzle/`, confirm it creates `app.studio_branding` with no RLS
statements (no `ENABLE ROW LEVEL SECURITY`, no `CREATE POLICY` — unlike
every prior tenant-owned table's migration).

- [ ] **Step 8: Add the runtime grant**

In `scripts/db-setup-roles.sql`, after the `student_assignments` grant
line, add:

```sql
-- NOT RLS-protected (see lib/db/schema.ts) — the public subdomain
-- lookup must read this before any tenant context exists. Scoping is
-- enforced entirely in lib/branding/branding.ts.
GRANT SELECT, INSERT, UPDATE ON "app"."studio_branding" TO app_runtime;
```

- [ ] **Step 9: Commit**

```bash
git add lib/db/schema.ts lib/db/schema.studioBranding.test.ts lib/auth/permissions.ts lib/auth/permissions.test.ts scripts/db-setup-roles.sql drizzle/
git commit -m "feat: add studio_branding table and branding.manage permission"
```

---

### Task 2: Slug generation + `provisionStudio` extension

**Files:**
- Create: `lib/branding/slug.ts`
- Test: `lib/branding/slug.test.ts`
- Modify: `lib/studios/provision.ts`
- Modify: `lib/studios/provision.test.ts` (extend existing tests)

**Interfaces:**
- Consumes: `studioBranding` (Task 1), `withTenantContext` (existing).
- Produces: `slugify(name: string): string`; `generateUniqueSlug(name:
  string, isTaken: (candidate: string) => Promise<boolean>):
  Promise<string>` — both used by Task 5/6/10/11 wherever a slug is
  validated or (re)generated.
- Produces: `ProvisionStudioResult` gains a `slug: string` field.

- [ ] **Step 1: Write the failing slug tests**

```ts
// lib/branding/slug.test.ts
import { describe, expect, test } from "vitest";
import { slugify, generateUniqueSlug } from "./slug";

describe("slugify", () => {
  test("lowercases and hyphenates", () => {
    expect(slugify("Gold Coast Dance Studio")).toBe("gold-coast-dance-studio");
  });
  test("collapses non-alphanumeric runs and trims edges", () => {
    expect(slugify("  Rock & Roll!! Dance_Co.  ")).toBe("rock-roll-dance-co");
  });
  test("falls back to a generic value when nothing alphanumeric remains", () => {
    expect(slugify("!!!")).toBe("studio");
  });
  test("truncates to 63 characters", () => {
    const long = "a".repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(63);
  });
});

describe("generateUniqueSlug", () => {
  test("returns the base slug when it's free", async () => {
    const result = await generateUniqueSlug("Starlight Ballroom", async () => false);
    expect(result).toBe("starlight-ballroom");
  });
  test("appends -2, -3, ... until a free slug is found", async () => {
    const taken = new Set(["starlight-ballroom", "starlight-ballroom-2"]);
    const result = await generateUniqueSlug(
      "Starlight Ballroom",
      async (candidate) => taken.has(candidate)
    );
    expect(result).toBe("starlight-ballroom-3");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/branding/slug.test.ts` — FAIL (module doesn't exist).

- [ ] **Step 3: Implement `lib/branding/slug.ts`**

`slugify`: lowercase, replace every run of one-or-more characters that
aren't `a-z0-9` with a single `-`, trim leading/trailing `-`, truncate
to 63 chars (re-trimming any trailing `-` left by truncation), and
return `"studio"` if the result is empty.

`generateUniqueSlug`: compute `base = slugify(name)`, try `base`; if
`isTaken(base)` resolves true, try `${base}-2`, `${base}-3`, ... (loop,
awaiting `isTaken` each time) until one resolves false.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/branding/slug.test.ts` — PASS.

- [ ] **Step 5: Extend `provisionStudio` to create the branding row**

In `lib/studios/provision.ts`, inside the existing transaction, after
inserting `locations`: call `generateUniqueSlug(input.studioName,
async (candidate) => { const [existing] = await tx.select({ s: studioBranding.slug }).from(studioBranding).where(eq(studioBranding.slug, candidate)).limit(1); return existing !== undefined; })`,
then `tx.insert(studioBranding).values({ studioId, slug })` (theme
preset/colorMode/accent/logo all take their column defaults). Add
`slug` to `ProvisionStudioResult` and return it from the function.

- [ ] **Step 6: Extend the existing provision test**

Add to `lib/studios/provision.test.ts`'s existing test (or a new
`test(...)` in the same `describe`): after calling `provisionStudio`,
assert `result.slug === "starlight-ballroom"` and that
`verifyDb.select().from(studioBranding).where(eq(studioBranding.studioId, result.studioId))`
returns exactly one row with `themePreset === "midnight"` and
`colorMode === "system"`.

Add a second test: provisioning two studios named `"Starlight Ballroom"`
back-to-back produces slugs `"starlight-ballroom"` and
`"starlight-ballroom-2"`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run lib/studios/provision.test.ts` — PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/branding/slug.ts lib/branding/slug.test.ts lib/studios/provision.ts lib/studios/provision.test.ts
git commit -m "feat: generate a unique studio slug at provisioning time"
```

---

### Task 3: Theme preset tokens + CSS generation

**Files:**
- Create: `lib/branding/presets.ts`
- Test: `lib/branding/presets.test.ts`

**Interfaces:**
- Produces: `THEME_PRESET_KEYS` (readonly tuple), `ThemePresetKey`
  (type), `ThemeTokens` (type: `{ background, foreground, card,
  cardForeground, primary, primaryForeground, muted, mutedForeground,
  border }`, all `string`), `THEME_PRESETS: Record<ThemePresetKey, {
  light: ThemeTokens; dark: ThemeTokens }>`, `buildThemeCss(preset:
  ThemePresetKey, accentOverride?: string | null): string`.
- Consumed by: Task 9 (dashboard shell), Task 10 (splash page), Task 11
  (settings form preview).

- [ ] **Step 1: Write the failing tests**

```ts
// lib/branding/presets.test.ts
import { describe, expect, test } from "vitest";
import { THEME_PRESETS, buildThemeCss } from "./presets";

describe("THEME_PRESETS", () => {
  test("has exactly the six decided preset keys", () => {
    expect(Object.keys(THEME_PRESETS).sort()).toEqual(
      ["blush", "garden", "midnight", "noir", "ocean", "sunset"].sort()
    );
  });
});

describe("buildThemeCss", () => {
  test("emits light and dark rules using the preset's own tokens", () => {
    const css = buildThemeCss("midnight");
    expect(css).toContain("[data-theme-root]");
    expect(css).toContain("--primary: #c9a24b");
    expect(css).toContain(".dark [data-theme-root]");
    expect(css).toContain("--background: #12182b");
  });
  test("an accent override replaces --primary in both light and dark rules", () => {
    const css = buildThemeCss("midnight", "#ff0000");
    expect(css.match(/--primary: #ff0000/g)).toHaveLength(2);
  });
  test("a null/absent override leaves the preset's own accent untouched", () => {
    const css = buildThemeCss("midnight", null);
    expect(css).toContain("--primary: #c9a24b");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/branding/presets.test.ts` — FAIL.

- [ ] **Step 3: Implement `lib/branding/presets.ts`**

Fixed token table — use exactly these hex values (studio owner-facing
color decisions, not left to the builder):

| Preset | Mode | background | foreground | card | cardForeground | primary | primaryForeground | muted | mutedForeground | border |
|---|---|---|---|---|---|---|---|---|---|---|
| midnight | light | #f7f5ef | #1b2030 | #ffffff | #1b2030 | #c9a24b | #1b2030 | #ece7da | #6b6552 | #ddd6c4 |
| midnight | dark | #12182b | #e9e4d8 | #1a2238 | #e9e4d8 | #c9a24b | #12182b | #202a44 | #a9a38c | #2a3454 |
| blush | light | #fff6f3 | #2e2a2b | #ffffff | #2e2a2b | #d98a9b | #2e2a2b | #f1d9d0 | #7a5d61 | #ecd3c9 |
| blush | dark | #241a1c | #f6e9e4 | #2e2224 | #f6e9e4 | #d98a9b | #241a1c | #3a2c2f | #c9a8ac | #433437 |
| noir | light | #f5f5f5 | #111111 | #ffffff | #111111 | #c81e3a | #ffffff | #e6e6e6 | #4d4d4d | #d0d0d0 |
| noir | dark | #111111 | #f2f2f2 | #1c1c1c | #f2f2f2 | #c81e3a | #ffffff | #2b2b2b | #b3b3b3 | #333333 |
| garden | light | #f6f3ea | #2f3a2b | #ffffff | #2f3a2b | #7a9273 | #ffffff | #e3ddc8 | #5f6b55 | #d7cfae |
| garden | dark | #1c231a | #e8e4d4 | #263121 | #e8e4d4 | #8aa67f | #1c231a | #30402a | #a9b89d | #3f4a3a |
| sunset | light | #fdf1e6 | #4a2e22 | #ffffff | #4a2e22 | #d9703a | #ffffff | #f6d9b8 | #8a5a3c | #efc79a |
| sunset | dark | #2a1a10 | #f6e3cc | #352316 | #f6e3cc | #e08a53 | #2a1a10 | #45301f | #c9a479 | #533a25 |
| ocean | light | #eef5f6 | #163038 | #ffffff | #163038 | #2c7a8c | #ffffff | #cfe6ea | #4c7680 | #bcdce1 |
| ocean | dark | #0e1f24 | #d9eef1 | #15282e | #d9eef1 | #3f9bb0 | #0e1f24 | #1c3b43 | #9fc3cb | #24474f |

`buildThemeCss(preset, accentOverride)`: look up `THEME_PRESETS[preset]`,
build a light token object and a dark token object, and if
`accentOverride` is a non-null string, set `primary` to it in *both*
objects (leave `primaryForeground` as the preset's own value — not
recomputing contrast is an accepted simplification for this phase).
Return a template string:

```css
[data-theme-root] { --background: ${light.background}; --foreground: ${light.foreground}; --card: ${light.card}; --card-foreground: ${light.cardForeground}; --primary: ${light.primary}; --primary-foreground: ${light.primaryForeground}; --muted: ${light.muted}; --muted-foreground: ${light.mutedForeground}; --border: ${light.border}; }
.dark [data-theme-root] { --background: ${dark.background}; --foreground: ${dark.foreground}; --card: ${dark.card}; --card-foreground: ${dark.cardForeground}; --primary: ${dark.primary}; --primary-foreground: ${dark.primaryForeground}; --muted: ${dark.muted}; --muted-foreground: ${dark.mutedForeground}; --border: ${dark.border}; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/branding/presets.test.ts` — PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/branding/presets.ts lib/branding/presets.test.ts
git commit -m "feat: add the six curated theme presets and CSS generation"
```

---

### Task 4: Subdomain slug extraction

**Files:**
- Create: `lib/branding/subdomain.ts`
- Test: `lib/branding/subdomain.test.ts`

**Interfaces:**
- Produces: `extractSubdomainSlug(host: string): string | null`.
- Consumed by: Task 10 (root splash page).

- [ ] **Step 1: Write the failing tests**

```ts
// lib/branding/subdomain.test.ts
import { describe, expect, test } from "vitest";
import { extractSubdomainSlug } from "./subdomain";

describe("extractSubdomainSlug", () => {
  test("extracts the leftmost label from a studio subdomain", () => {
    expect(extractSubdomainSlug("gold-coast.ballroomdash.app")).toBe("gold-coast");
  });
  test("strips a port before parsing", () => {
    expect(extractSubdomainSlug("gold-coast.ballroomdash.app:3000")).toBe("gold-coast");
  });
  test("returns null for an apex domain (two labels, no subdomain)", () => {
    expect(extractSubdomainSlug("ballroomdash.app")).toBeNull();
  });
  test("returns null for localhost", () => {
    expect(extractSubdomainSlug("localhost:3000")).toBeNull();
  });
  test("returns null for a bare IP host", () => {
    expect(extractSubdomainSlug("127.0.0.1:3000")).toBeNull();
  });
  test("lowercases the extracted label", () => {
    expect(extractSubdomainSlug("Gold-Coast.ballroomdash.app")).toBe("gold-coast");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/branding/subdomain.test.ts` — FAIL.

- [ ] **Step 3: Implement `lib/branding/subdomain.ts`**

Strip a trailing `:<port>` if present. Return `null` if the remaining
host is `"localhost"` or matches an IPv4 pattern (`/^\d+\.\d+\.\d+\.\d+$/`).
Split on `.`; return `null` if there are 2 or fewer labels (apex domain,
nothing to the left of the registrable domain); otherwise return the
first label, lowercased.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/branding/subdomain.test.ts` — PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/branding/subdomain.ts lib/branding/subdomain.test.ts
git commit -m "feat: extract a studio slug from the request host header"
```

---

### Task 5: Public branding lookup (pre-auth, no tenant context)

**Files:**
- Create: `lib/branding/public-branding.ts`
- Test: `lib/branding/public-branding.test.ts`

**Interfaces:**
- Consumes: `studios`, `studioBranding` (Task 1), `ThemePresetKey`
  (Task 3).
- Produces: `type PublicBranding = { studioId: string; studioName:
  string; slug: string; themePreset: ThemePresetKey; accentColorOverride:
  string | null; colorMode: "light" | "dark" | "system"; logoUrl: string
  | null }`; `getPublicBrandingBySlug(slug: string, database?: Db):
  Promise<PublicBranding | null>`.
- Consumed by: Task 10 (root splash page), Task 12 (acceptance test).

- [ ] **Step 1: Write the failing tests**

```ts
// lib/branding/public-branding.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "../db/testing/test-database";
import * as schema from "../db/schema";
import { users } from "../db/schema";
import { provisionStudio } from "../studios/provision";
import { getPublicBrandingBySlug } from "./public-branding";

describe("getPublicBrandingBySlug", () => {
  let testDb: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  test("returns the studio's public branding fields by slug, with no tenant context set", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    const [owner] = await seedDb.insert(users).values({ email: "o@example.com" }).returning();
    await seedPool.end();

    const db = drizzle(pool, { schema });
    const result = await provisionStudio(
      { ownerId: owner.id, studioName: "Starlight Ballroom", timezone: "America/Chicago" },
      db
    );

    const branding = await getPublicBrandingBySlug(result.slug, db);
    expect(branding).toMatchObject({
      studioId: result.studioId,
      studioName: "Starlight Ballroom",
      slug: result.slug,
      themePreset: "midnight",
      colorMode: "system",
      accentColorOverride: null,
      logoUrl: null,
    });
  });

  test("returns null for an unknown slug", async () => {
    const db = drizzle(pool, { schema });
    const branding = await getPublicBrandingBySlug("no-such-studio", db);
    expect(branding).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/branding/public-branding.test.ts` — FAIL.

- [ ] **Step 3: Implement `lib/branding/public-branding.ts`**

A plain `database.select({...}).from(studioBranding).innerJoin(studios,
eq(studioBranding.studioId, studios.id)).where(eq(studioBranding.slug,
slug)).limit(1)` — called directly on the passed-in `db` (default the
real client), **not** wrapped in `withTenantContext`, since there is no
tenant to set context for yet. Map the row to `PublicBranding` (or
return `null` if no row).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/branding/public-branding.test.ts` — PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/branding/public-branding.ts lib/branding/public-branding.test.ts
git commit -m "feat: add pre-auth public branding lookup by slug"
```

---

### Task 6: Authenticated branding read/update (permission-gated)

**Files:**
- Create: `lib/branding/branding.ts`
- Create: `lib/validation/branding.ts`
- Test: `lib/branding/branding.test.ts`

**Interfaces:**
- Consumes: `requirePermission`, `PermissionDeniedError` (existing,
  `lib/auth/authorization.ts`); `generateUniqueSlug` (Task 2);
  `PublicBranding` (Task 5).
- Produces: `class SlugTakenError extends Error`;
  `getBrandingByStudioId(studioId: string, database?: Db):
  Promise<PublicBranding>`; `type UpdateBrandingInput = {
  themePreset?: ThemePresetKey; accentColorOverride?: string | null;
  colorMode?: "light" | "dark" | "system"; slug?: string }`;
  `updateBranding(userId: string, studioId: string, input:
  UpdateBrandingInput, database?: Db): Promise<PublicBranding>`.
- Produces: `updateBrandingSchema` (Zod, in `lib/validation/branding.ts`)
  matching `UpdateBrandingInput`, with `themePreset` as
  `z.enum(THEME_PRESET_KEYS)`, `accentColorOverride` as
  `z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional()`,
  `colorMode` as `z.enum(["light", "dark", "system"])`, `slug` as
  `z.string().min(1).max(63).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)`, all
  fields `.optional()`.
- Consumed by: Task 8 (API route), Task 11 (settings page).

- [ ] **Step 1: Write the failing tests**

```ts
// lib/branding/branding.test.ts (same Testcontainers setup pattern as Task 5/provision.test.ts)
test("a non-owner cannot update branding", async () => {
  // seed a studio + an Instructor membership for a second user
  await expect(
    updateBranding(instructorUserId, studioId, { themePreset: "noir" }, db)
  ).rejects.toThrow(PermissionDeniedError);
});

test("the owner can update theme, accent, and color mode", async () => {
  const result = await updateBranding(
    ownerUserId, studioId,
    { themePreset: "ocean", accentColorOverride: "#ff00ff", colorMode: "dark" },
    db
  );
  expect(result).toMatchObject({ themePreset: "ocean", accentColorOverride: "#ff00ff", colorMode: "dark" });
});

test("changing the slug to one already used by another studio fails clearly", async () => {
  // provision a second studio with a known slug, then:
  await expect(
    updateBranding(ownerUserId, studioId, { slug: otherStudioSlug }, db)
  ).rejects.toThrow(SlugTakenError);
});

test("changing the slug to a free value succeeds", async () => {
  const result = await updateBranding(ownerUserId, studioId, { slug: "new-slug" }, db);
  expect(result.slug).toBe("new-slug");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/branding/branding.test.ts` — FAIL.

- [ ] **Step 3: Implement `lib/branding/branding.ts`**

`getBrandingByStudioId`: same shape as `getPublicBrandingBySlug` but
`where(eq(studioBranding.studioId, studioId))`; throw if not found (a
branding row always exists after Task 2's provisioning change, so a
missing row means a bad `studioId`, not a legitimate empty state).

`updateBranding`: call `await requirePermission(userId, studioId,
"branding.manage", database)` first (propagates `PermissionDeniedError`
unchanged). If `input.slug` is provided and differs from the current
slug, check it against `isTaken` (select where `slug = input.slug AND
studioId != studioId`) and throw `SlugTakenError` if found. Build the
`.set({...input, updatedAt: new Date()})` object from whichever fields
were provided, run the update filtered by `studioId`, return the fresh
row via `getBrandingByStudioId`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/branding/branding.test.ts` — PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/branding/branding.ts lib/validation/branding.ts lib/branding/branding.test.ts
git commit -m "feat: add permission-gated branding read/update"
```

---

### Task 7: Logo upload

**Files:**
- Create: `lib/branding/logo.ts`
- Test: `lib/branding/logo.test.ts`
- Modify: `package.json` (add `@vercel/blob` dependency)

**Interfaces:**
- Produces: `class InvalidLogoFileError extends Error`;
  `MAX_LOGO_BYTES = 2 * 1024 * 1024`; `ALLOWED_LOGO_TYPES` (readonly
  tuple of the three MIME types); `uploadLogo(studioId: string, file:
  File, put?: typeof import("@vercel/blob").put):
  Promise<string>` (returns the stored URL); `updateBrandingLogo(userId:
  string, studioId: string, file: File, database?: Db, put?: ...):
  Promise<PublicBranding>`.
- Consumes: `requirePermission` (existing); `getBrandingByStudioId`
  (Task 6).
- Consumed by: Task 8 (API route), Task 11 (settings page).

- [ ] **Step 1: Write the failing tests**

```ts
// lib/branding/logo.test.ts
import { describe, expect, test, vi } from "vitest";
import { uploadLogo, InvalidLogoFileError, MAX_LOGO_BYTES } from "./logo";

function fakeFile(type: string, size: number): File {
  return new File([new Uint8Array(size)], "logo", { type });
}

describe("uploadLogo", () => {
  test("rejects a disallowed MIME type before calling the uploader", async () => {
    const put = vi.fn();
    await expect(uploadLogo("studio-1", fakeFile("image/gif", 100), put))
      .rejects.toThrow(InvalidLogoFileError);
    expect(put).not.toHaveBeenCalled();
  });

  test("rejects a file over MAX_LOGO_BYTES before calling the uploader", async () => {
    const put = vi.fn();
    await expect(uploadLogo("studio-1", fakeFile("image/png", MAX_LOGO_BYTES + 1), put))
      .rejects.toThrow(InvalidLogoFileError);
    expect(put).not.toHaveBeenCalled();
  });

  test("uploads a valid file and returns the stored URL", async () => {
    const put = vi.fn().mockResolvedValue({ url: "https://blob.example/studio-1-logo.png" });
    const url = await uploadLogo("studio-1", fakeFile("image/png", 1000), put);
    expect(url).toBe("https://blob.example/studio-1-logo.png");
    expect(put).toHaveBeenCalledWith(
      expect.stringContaining("studio-1"),
      expect.anything(),
      expect.objectContaining({ access: "public" })
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/branding/logo.test.ts` — FAIL.

- [ ] **Step 3: Add the dependency and implement `lib/branding/logo.ts`**

Run: `npm install @vercel/blob`.

`uploadLogo(studioId, file, put = (await import("@vercel/blob")).put)`:
throw `InvalidLogoFileError` if `!ALLOWED_LOGO_TYPES.includes(file.type
as any)` or `file.size > MAX_LOGO_BYTES`, with a message naming which
check failed. Otherwise call `await put(\`studio-logos/${studioId}-${Date.now()}\`,
file, { access: "public" })` and return `.url`.

`updateBrandingLogo(userId, studioId, file, database, put)`: call
`requirePermission(userId, studioId, "branding.manage", database)`,
then `uploadLogo(studioId, file, put)`, then update
`studioBranding.logoUrl` for `studioId` and return the fresh row via
`getBrandingByStudioId` (same database param threading pattern as Task
6).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/branding/logo.test.ts` — PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json lib/branding/logo.ts lib/branding/logo.test.ts
git commit -m "feat: add logo upload with type/size validation"
```

---

### Task 8: Branding API routes

**Files:**
- Create: `app/api/v1/studios/[studioId]/branding/route.ts` (GET, PATCH)
- Create: `app/api/v1/studios/[studioId]/branding/logo/route.ts` (POST)
- Test: `app/api/v1/studios/[studioId]/branding/route.test.ts`
- Test: `app/api/v1/studios/[studioId]/branding/logo/route.test.ts`

**Interfaces:**
- Consumes: `verifyApiSession` (existing, `lib/dal.ts`);
  `getBrandingByStudioId`, `updateBranding`, `SlugTakenError` (Task 6);
  `updateBrandingLogo`, `InvalidLogoFileError` (Task 7);
  `updateBrandingSchema` (Task 6); `PermissionDeniedError` (existing).
- Follows the exact response-shape/status-code conventions already
  established in `app/api/v1/studios/[studioId]/memberships/route.ts`
  (401 via `verifyApiSession`, `z.uuid()` path validation → 400, 403 on
  `PermissionDeniedError`).

- [ ] **Step 1: Write the failing route tests**

Mirror the structure of the existing
`app/api/v1/studios/[studioId]/memberships/route.test.ts`: seed a studio
via `provisionStudio`, then assert:
- `GET` with no session → 401.
- `GET` with an invalid `studioId` path segment → 400.
- `GET` as the owner → 200 with the branding shape from Task 5/6.
- `PATCH` as an Instructor membership → 403.
- `PATCH` as the owner with `{ themePreset: "noir" }` → 200, and a
  follow-up `GET` reflects `themePreset: "noir"`.
- `PATCH` with an invalid body (e.g. `{ themePreset: "not-a-preset" }`)
  → 400.
- `PATCH` with a `slug` already used by another studio → 409.

For the logo route: `POST` with no session → 401; `POST` as Instructor →
403; `POST` with a `multipart/form-data` body containing an oversized
file → 400 (`InvalidLogoFileError` mapped); `POST` as owner with a
small valid PNG `Blob` → 200 with a `logoUrl` in the response (inject a
fake `put` — the route needs a way to accept an injected uploader for
tests; see Step 3).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/api/v1/studios/[studioId]/branding` — FAIL
(routes don't exist).

- [ ] **Step 3: Implement the routes**

`branding/route.ts`: `GET` — `verifyApiSession` → 401; `z.uuid()` on
`studioId` → 400; `getBrandingByStudioId(studioId)` → 200. `PATCH` —
same auth/validation, `updateBrandingSchema.safeParse(await
request.json())` → 400 on failure, `updateBranding(userId, studioId,
body.data)` → 200, catching `PermissionDeniedError` → 403 and
`SlugTakenError` → 409 (new error class from Task 6 needs a dedicated
catch branch — don't let it fall through to an uncaught 500).

`branding/logo/route.ts`: `POST` — same auth/validation, read
`await request.formData()`, get the `file` entry, 400 if missing/not a
`File`, else `updateBrandingLogo(userId, studioId, file)` → 200,
catching `InvalidLogoFileError` → 400 and `PermissionDeniedError` → 403.
(The route calls the Task 7 functions with their default `put` — no
test-only injection point needed in the route itself; the route tests
that need to avoid a real network call should test against
`uploadLogo`/`updateBrandingLogo` directly with an injected `put`, per
Task 7's own tests, and keep this route's own test suite to the
validation/auth paths plus one happy-path test that mocks the
`@vercel/blob` module with `vi.mock`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/api/v1/studios/[studioId]/branding` — PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/studios/[studioId]/branding
git commit -m "feat: add branding read/update/logo-upload API routes"
```

---

### Task 9: Authenticated dashboard shell

**Files:**
- Create: `lib/branding/theme-root.tsx` (Server Component)
- Create: `components/sign-out-button.tsx`
- Create: `app/dashboard/layout.tsx`
- Create: `app/dashboard/page.tsx`
- Test: `lib/branding/theme-root.test.tsx`
- Test: `app/dashboard/layout.test.tsx`

**Interfaces:**
- Consumes: `verifySession` (existing, `lib/dal.ts`);
  `getBrandingByStudioId` (Task 6); `buildThemeCss` (Task 3); `auth`,
  `signOut` (existing, `@/auth`); `getActiveMembership`-style lookup —
  for this task, finding *which* studio to show: query `memberships`
  directly for the first active row for this user (ordered by
  `createdAt`), since picking a "default" studio among several is
  explicitly left open by the design doc and this is the simplest
  correct choice for a single-studio owner, the common case this phase
  targets.
- Produces: `<ThemeRoot preset accentOverride>{children}</ThemeRoot>`
  (wraps children in a `<div data-theme-root>` plus a `<style>` tag from
  `buildThemeCss`); `<SignOutButton />` (client component, calls
  `signOut()` via a form action).

- [ ] **Step 1: Write the failing `ThemeRoot` test**

```tsx
// lib/branding/theme-root.test.tsx
// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { ThemeRoot } from "./theme-root";

describe("ThemeRoot", () => {
  test("renders a data-theme-root wrapper with the preset's CSS inlined", () => {
    const { container } = render(
      <ThemeRoot preset="ocean" accentOverride={null}>
        <p>hello</p>
      </ThemeRoot>
    );
    expect(container.querySelector("[data-theme-root]")).not.toBeNull();
    expect(container.querySelector("style")?.textContent).toContain("--primary: #2c7a8c");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/branding/theme-root.test.tsx` — FAIL.

- [ ] **Step 3: Implement `lib/branding/theme-root.tsx`**

```tsx
import { buildThemeCss, type ThemePresetKey } from "./presets";

export function ThemeRoot({ preset, accentOverride, children }: {
  preset: ThemePresetKey; accentOverride: string | null; children: React.ReactNode;
}) {
  return (
    <div data-theme-root>
      <style dangerouslySetInnerHTML={{ __html: buildThemeCss(preset, accentOverride) }} />
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/branding/theme-root.test.tsx` — PASS.

- [ ] **Step 5: Implement the dashboard layout and nav**

`app/dashboard/layout.tsx` (Server Component): `const { userId } = await
verifySession()`; look up the first active membership's `studioId`
(plain query, `memberships` + `eq(status, "active")`, `limit(1)`,
ordered by `createdAt`); if none, render a minimal "no studio yet" state
(no redirect loop — this is a real reachable state for a brand-new user
with no studio); otherwise `getBrandingByStudioId(studioId)`, wrap
`children` in `<ThemeRoot preset={branding.themePreset}
accentOverride={branding.accentColorOverride}>`, and render a nav bar:
an `<img>` (or a generic fallback mark `<div>` if `branding.logoUrl` is
null) sized via CSS to a fixed badge slot, `branding.studioName`,
`<ThemeToggle />` (existing component), `<SignOutButton />`.

`components/sign-out-button.tsx` (`"use client"`): a `<form
action={signOutFormAction}>` wrapping a submit `<Button variant="outline">Sign
out</Button>` — or simpler, a Server Action imported directly: `async
function signOutAction() { "use server"; await signOut(); }` referenced
as the form's `action`.

`app/dashboard/page.tsx`: minimal placeholder content (e.g. "Dashboard
coming online" card, reusing the existing `Card` component) — later
phases fill this in.

- [ ] **Step 6: Write and pass the dashboard layout test**

Component-test the nav in isolation (not the full `verifySession` redirect
path, which is already covered by existing `lib/dal.ts` behavior):
extract the nav-rendering JSX into a small exported `DashboardNav({
branding }: { branding: PublicBranding })` component so it can be
rendered directly in a test without a real session/DB. Test: renders the
studio name; renders the `<img>` when `logoUrl` is set; renders the
generic fallback mark when `logoUrl` is `null`.

Run: `npx vitest run app/dashboard/layout.test.tsx` — PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/branding/theme-root.tsx lib/branding/theme-root.test.tsx components/sign-out-button.tsx app/dashboard
git commit -m "feat: add the authenticated dashboard shell"
```

---

### Task 10: Public branded splash + sign-in page

**Files:**
- Modify: `app/page.tsx` (replace the Phase 0 placeholder)
- Create: `app/login/page.tsx`
- Create: `components/login-form.tsx`
- Test: `app/page.test.tsx`
- Test: `components/login-form.test.tsx`

**Interfaces:**
- Consumes: `auth` (existing, `@/auth`); `extractSubdomainSlug` (Task
  4); `getPublicBrandingBySlug` (Task 5); `ThemeRoot` (Task 9);
  `signIn` (existing, `@/auth`).
- Produces: `BrandedSplash({ branding }: { branding: PublicBranding })`
  (exported from `app/page.tsx` or a sibling component file, for direct
  testing) — logo/fallback mark, studio name, a "Sign in" link to
  `/login`.

- [ ] **Step 1: Write the failing splash test**

```tsx
// app/page.test.tsx
// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { BrandedSplash } from "./page";

describe("BrandedSplash", () => {
  test("renders the studio's name and a sign-in link", () => {
    const { getByText, getByRole } = render(
      <BrandedSplash branding={{
        studioId: "s1", studioName: "Starlight Ballroom", slug: "starlight-ballroom",
        themePreset: "ocean", accentColorOverride: null, colorMode: "system", logoUrl: null,
      }} />
    );
    expect(getByText("Starlight Ballroom")).toBeTruthy();
    expect(getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/page.test.tsx` — FAIL.

- [ ] **Step 3: Implement `app/page.tsx`**

Export `BrandedSplash` as a plain component (logo/fallback mark, studio
name, a `<Link href="/login">Sign in</Link>`, wrapped in `<ThemeRoot>`
using the branding's preset/accent). The default export (the actual
route) is a Server Component:

```tsx
const session = await auth();
if (session?.user) redirect("/dashboard");
const host = (await headers()).get("host") ?? "";
const params = await searchParams;
const devOverride = process.env.NODE_ENV !== "production" ? (params.studio ?? null) : null;
const slug = devOverride ?? extractSubdomainSlug(host);
const branding = slug ? await getPublicBrandingBySlug(slug) : null;
if (!branding) redirect("/login");
return <BrandedSplash branding={branding} />;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/page.test.tsx` — PASS.

- [ ] **Step 5: Write the failing login-form test**

```tsx
// components/login-form.test.tsx
// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { LoginForm } from "./login-form";

vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));

describe("LoginForm", () => {
  test("submits email and password to signIn with the credentials provider", async () => {
    const { signIn } = await import("next-auth/react");
    const { getByLabelText, getByRole } = render(<LoginForm />);
    fireEvent.change(getByLabelText(/email/i), { target: { value: "a@example.com" } });
    fireEvent.change(getByLabelText(/password/i), { target: { value: "secret" } });
    fireEvent.click(getByRole("button", { name: /sign in/i }));
    expect(signIn).toHaveBeenCalledWith("credentials", expect.objectContaining({
      email: "a@example.com", password: "secret", redirectTo: "/dashboard",
    }));
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run components/login-form.test.tsx` — FAIL.

- [ ] **Step 7: Implement `components/login-form.tsx` and `app/login/page.tsx`**

`LoginForm` (`"use client"`): a form with labeled email/password inputs
(reuse/introduce `components/ui/input.tsx` and `components/ui/label.tsx`
— minimal shadcn-style components, same pattern as the existing
`button.tsx`/`card.tsx`) and a submit handler calling
`signIn("credentials", { email, password, redirectTo: "/dashboard" })`
from `next-auth/react`.

`app/login/page.tsx`: a plain (unbranded — canonical, no `ThemeRoot`)
page rendering the Ballroom Dash wordmark/generic look and `<LoginForm
/>`.

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run components/login-form.test.tsx` — PASS.

- [ ] **Step 9: Commit**

```bash
git add app/page.tsx app/page.test.tsx app/login components/login-form.tsx components/login-form.test.tsx components/ui/input.tsx components/ui/label.tsx
git commit -m "feat: add the branded public splash and sign-in page"
```

---

### Task 11: Branding settings page

**Files:**
- Create: `app/dashboard/settings/branding/page.tsx`
- Create: `components/branding-settings-form.tsx`
- Create: `components/ui/select.tsx` (minimal, if a native `<select>`
  wrapped in the existing styling conventions doesn't already suffice —
  builder's call on whether a styled wrapper is worth it for 6 options)
- Test: `components/branding-settings-form.test.tsx`

**Interfaces:**
- Consumes: `getBrandingByStudioId`, `hasPermission` (existing +
  Task 6); `THEME_PRESET_KEYS` (Task 3); the Task 8 API routes (called
  via `fetch` from the client form).

- [ ] **Step 1: Write the failing form test**

```tsx
// components/branding-settings-form.test.tsx
// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { BrandingSettingsForm } from "./branding-settings-form";

describe("BrandingSettingsForm", () => {
  test("submits the chosen preset to the PATCH branding endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const { getByLabelText, getByRole } = render(
      <BrandingSettingsForm
        studioId="studio-1"
        initial={{ themePreset: "midnight", accentColorOverride: null, colorMode: "system", slug: "starlight-ballroom", logoUrl: null }}
      />
    );
    fireEvent.click(getByLabelText(/ocean/i));
    fireEvent.click(getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/studios/studio-1/branding",
        expect.objectContaining({ method: "PATCH" })
      );
    });
  });

  test("shows the logo upload guidance text", () => {
    const { getByText } = render(
      <BrandingSettingsForm studioId="studio-1" initial={{ themePreset: "midnight", accentColorOverride: null, colorMode: "system", slug: "s", logoUrl: null }} />
    );
    expect(getByText(/512.?x.?512/i)).toBeTruthy();
    expect(getByText(/resized/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run components/branding-settings-form.test.tsx` — FAIL.

- [ ] **Step 3: Implement `components/branding-settings-form.tsx`**

`"use client"` component taking `studioId: string` and `initial:
Pick<PublicBranding, "themePreset" | "accentColorOverride" | "colorMode"
| "slug" | "logoUrl">` props (not the full `PublicBranding` — `studioId`
is already its own prop, and `studioName` isn't editable here). Renders: a radio group over `THEME_PRESET_KEYS` (label each with
its display name — "Midnight Ballroom", "Blush Studio", "Classic Noir",
"Garden Waltz", "Sunset Tango", "Ocean Foxtrot" — from a small
`PRESET_DISPLAY_NAMES` map colocated in this file or `presets.ts`); an
accent-color text input (optional, hex); a slug text input; a file input
for the logo, with visible guidance text: *"Recommended: a square logo,
512×512px, SVG or PNG with a transparent background, under 2MB. A logo
that doesn't match this will be resized to fit."* On submit: `fetch`
`PATCH /api/v1/studios/${studioId}/branding` with the preset/accent/
colorMode/slug fields; if a file was chosen, separately `fetch` `POST
/api/v1/studios/${studioId}/branding/logo` with a `FormData` body.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run components/branding-settings-form.test.tsx` — PASS.

- [ ] **Step 5: Implement the settings page**

`app/dashboard/settings/branding/page.tsx` (Server Component):
`verifySession()`, resolve the active studio the same way as Task 9's
layout, `hasPermission(userId, studioId, "branding.manage")` — if false,
render a simple "You don't have access to this page" message (no new
UI component needed, plain text in the existing `Card`); if true,
`getBrandingByStudioId(studioId)` and render `<BrandingSettingsForm
studioId={studioId} initial={branding} />`.

- [ ] **Step 6: Commit**

```bash
git add app/dashboard/settings components/branding-settings-form.tsx components/branding-settings-form.test.tsx
git commit -m "feat: add the branding settings page"
```

---

### Task 12: Cross-studio branding isolation acceptance test

**Files:**
- Create: `app/api/v1/studios/branding-acceptance.test.ts`

**Interfaces:**
- Consumes: `provisionStudio`, `getPublicBrandingBySlug`,
  `updateBranding`, all prior tasks' exports — no new production code.

- [ ] **Step 1: Write the acceptance test**

```ts
// app/api/v1/studios/branding-acceptance.test.ts
// @vitest-environment node
// (same Testcontainers beforeAll/afterAll pattern as the other acceptance tests)

test("a studio's branding never leaks into another studio's lookup or update", async () => {
  // provision Studio A (owner: userA) and Studio B (owner: userB)
  // give userA's branding themePreset "midnight", userB's "noir"

  const brandingA = await getPublicBrandingBySlug(studioA.slug, db);
  const brandingB = await getPublicBrandingBySlug(studioB.slug, db);
  expect(brandingA?.studioId).toBe(studioA.studioId);
  expect(brandingB?.studioId).toBe(studioB.studioId);
  expect(brandingA?.themePreset).not.toBe(brandingB?.themePreset);

  // Owner A updates Studio A's branding
  await updateBranding(userA, studioA.studioId, { themePreset: "ocean" }, db);

  // Studio B's row is untouched
  const brandingBAfter = await getPublicBrandingBySlug(studioB.slug, db);
  expect(brandingBAfter?.themePreset).toBe("noir");
});

test("a user who is Owner of A and Instructor of B sees the correct branding per studio", async () => {
  // add userA as an Instructor membership on Studio B too (second provisionStudio
  // call for B, then a direct memberships insert for userA with the Instructor role)
  await expect(updateBranding(userA, studioB.studioId, { themePreset: "garden" }, db))
    .rejects.toThrow(PermissionDeniedError); // userA is only an Instructor on B
  const brandingA = await getBrandingByStudioId(studioA.studioId, db);
  const brandingB = await getBrandingByStudioId(studioB.studioId, db);
  expect(brandingA.studioId).not.toBe(brandingB.studioId);
});

test("an unrecognized slug resolves to null, never throws", async () => {
  await expect(getPublicBrandingBySlug("totally-unknown-slug", db)).resolves.toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails for the right reason first**

Run: `npx vitest run app/api/v1/studios/branding-acceptance.test.ts` —
should FAIL only if any prior task's implementation has a real isolation
bug; if all prior tasks are correctly implemented, this test should
already pass once written (it exercises existing functions, doesn't add
new behavior) — if it fails, that's a real defect in a prior task to fix
before proceeding, not a signal to add new code here.

- [ ] **Step 3: Run the full suite and build**

Run: `npm run lint && npm run typecheck && npx vitest run && npm run build`
— all green.

- [ ] **Step 4: Commit**

```bash
git add app/api/v1/studios/branding-acceptance.test.ts
git commit -m "test: add cross-studio branding isolation acceptance test"
```
