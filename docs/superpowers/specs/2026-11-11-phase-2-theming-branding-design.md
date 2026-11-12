# Phase 2 — Studio Theming & Branding: Design

**Roadmap section:** `docs/development-plan.md`, Phase 2. Not in the
original spec (`references/ballroom_dash_spec_v0_3.md`) — an added
requirement so the product reads as a distinct, high-end studio brand
rather than a generic template, from the first screen a prospective
student or staff member sees.

**Depends on:** Phase 1 (studio records, `branding.manage`-style
permission plumbing, memberships/roles). Independent of Phases 3–9 —
can run in parallel with all of them.

## Intent and why

A studio owner's trust in the product hinges on two things above all
else, confirmed directly with the product owner: **their logo and their
studio name** showing up correctly, everywhere a client or staff member
would see them. Accent color matters far less — a nice-to-have, not a
trust signal. This phase exists to make the first two unmissable and the
third a simple, low-stakes override, and to give every studio a branded
public presence (a subdomain) before a client ever logs in.

## Scope note: base UI did not land in Phase 0

A builder check against the actual codebase found that Phase 0's
roadmap deliverable of a shadcn/ui "nav shell, data tables, cards,
forms" only partially landed: `theme-provider`, `theme-toggle`, and two
components (`button`, `card`) exist; there is no dashboard nav, no
authenticated shell, and no login page anywhere in `app/`. Phase 1 was
API-routes-only by design.

This means Phase 2 cannot theme/brand an existing nav or login screen —
those screens don't exist yet. **Decided with the product owner:** Phase
2's scope expands to include building that base scaffolding — the
authenticated dashboard shell (nav + content area) and the sign-in
page — with theming and branding built in from the start, rather than
building generic chrome now and re-skinning it later.

## Session architecture (decided)

NextAuth's session cookie is host-scoped, and a user can hold
memberships in multiple studios simultaneously (Phase 1). To avoid
rearchitecting auth around per-subdomain cookies: **the authenticated
dashboard and the actual sign-in form live at one canonical app domain**
(e.g. `app.ballroomdash.app`), never on a per-studio subdomain. The
studio-branded subdomain only drives the look of the pre-auth splash —
clicking "sign in" there redirects to the canonical domain's sign-in
flow. This keeps the session/cookie model simple and consistent with
Phase 1's existing multi-studio-per-login design; the "branded front
door" experience lives entirely in the pre-auth splash, not in the
authenticated app shell (which is branded per the active studio in
nav/header, independent of which domain served it).

## Goals

- A minimal authenticated dashboard shell (nav + content area) and a
  sign-in page exist, themed/branded from the start — since neither
  exists yet after Phases 0–1.
- A studio owner can choose one of several curated theme presets, with
  light/dark variants, with no design work required on their part.
- A studio owner can override the accent color if their brand has a
  specific one.
- A studio owner can upload a logo that renders correctly in the
  dashboard nav and on their studio's public login screen.
- A visitor on a studio's branded subdomain sees that studio's name,
  logo, and theme before authenticating.
- Branding changes for one studio never leak into another studio's
  session, nav, or subdomain (tenant-isolation discipline, same as spec
  acceptance test #1, applied here).

## Non-goals

- Building out the full shadcn/ui component library (data tables,
  complex forms) that Phase 0's roadmap sketch mentioned. This phase
  builds only what the dashboard shell, sign-in page, and branding
  settings form need; a data-table component arrives whenever a later
  phase (e.g. Phase 3's student roster) first needs one.
- Server-side image processing/resizing of uploaded logos. CSS-level
  scaling only.
- A theme/preset editor — presets are curated and fixed; studios choose
  from the set and optionally override one accent color. No custom
  palette builder.
- Real DNS/wildcard-domain setup. This phase builds the subdomain
  *resolution logic* against whatever host header arrives; pointing a
  real domain at it is a deployment-time configuration step outside this
  phase's scope.
- Per-location branding. Branding is studio-wide, not per-location
  (locations are a Phase 1 concept; theming attaches to the studio).

## Anti-goals

- A studio ever seeing another studio's logo, name, or theme — even
  transiently, even on a cache hit, even for an unauthenticated request.
- The settings UI being reachable by a role that doesn't hold
  `branding.manage`.
- A broken or missing logo producing a layout break (a missing-logo
  fallback must exist).

## Decided design

### Theme presets

Six curated presets, each with a light and dark variant (variant chosen
via the existing `next-themes` / Phase 0 CSS-variable token layer — no
new theming engine):

| Preset | Accent | Feel |
|---|---|---|
| Midnight Ballroom | warm gold on deep navy | formal, evening, competition-hall |
| Blush Studio | soft rose on warm white | boutique, friendly, social-dance |
| Classic Noir | sharp red on black/white | high-contrast, dramatic, competitive |
| Garden Waltz | sage green on warm cream | approachable, natural |
| Sunset Tango | terracotta/amber on warm white | energetic, Latin/social |
| Ocean Foxtrot | teal on deep ink blue | calm, modern, studio-chain |

Each preset is a named set of CSS-variable values (base surface, text,
accent, border) layered on top of Phase 0's existing token structure.
Selecting a preset sets all of its variables; separately overriding the
accent color replaces only the accent variable, leaving the rest of the
preset's palette intact. Both are stored on the studio record (preset
key + optional accent hex override + light/dark preference or
"follow system").

### Logo

- Stored as the uploaded file, unmodified, in Vercel Blob (per Phase 0's
  object-storage assumption).
- Rendered via CSS (`object-fit: contain`) into two fixed slots: a
  square-ish nav badge (dashboard header) and a larger badge on the
  public login splash. No server-side cropping/resizing — an oddly
  shaped or oversized source image is visually scaled to fit, not
  rejected or reprocessed.
- The upload UI shows guidance before/during upload: **recommended
  square format (e.g. 512×512px), SVG or PNG with a transparent
  background, under 2MB** — with a note that the logo will be visually
  resized to fit the nav/login slots if it doesn't match this guidance,
  so a non-square or oversized logo still works, just may look
  letterboxed.
- Missing-logo fallback: a generic Ballroom Dash mark, both in the nav
  and on the public splash.

### Branded subdomain

- Every studio gets a unique, URL-safe **slug**, separate from its UUID.
  Auto-generated from the studio name at creation time (e.g.
  "Gold Coast Dance Studio" → `gold-coast-dance-studio`, de-duplicated
  with a numeric suffix on collision); the owner can edit it later
  through the branding settings UI, subject to the same uniqueness
  constraint.
- The studio is resolved from the request's host header by extracting
  the leftmost label and looking up the matching slug. **Builder's
  call, decided here to avoid an open question:** this runs as a
  regular Node.js-runtime lookup inside the login page/route itself,
  not literal Next.js Edge Middleware — the existing DB layer
  (`drizzle-orm/node-postgres`, marked `server-only`) isn't built for
  the edge runtime, and nothing else in this phase needs true
  middleware. This is **domain-agnostic**: it doesn't assume
  `ballroomdash.app` or any other specific root domain, since no domain
  is registered yet. It works once any domain with wildcard DNS points
  at the app.
- Local-dev workaround: a documented override (query param or header) to
  simulate a given studio's subdomain without real DNS, since
  `localhost` has no subdomain to resolve.
- Unrecognized subdomain (no matching slug) falls back to generic
  Ballroom Dash branding on the login screen rather than erroring —
  consistent with the anti-goal of never breaking the page.
- The subdomain resolution only affects branding/display on the
  pre-auth login screen. It does not change tenant context or bypass
  any Phase 1 authorization — a user still authenticates against their
  actual memberships regardless of which studio's subdomain they landed
  on.

### Settings UI & permissions

- A new permission code, `branding.manage`, added to the Phase 1
  permissions catalog and granted to the built-in Owner role (not
  Instructor; Admin inclusion is the builder's call, consistent with
  how Phase 1 scoped Admin elsewhere).
- A studio settings page (gated by `branding.manage`, checked at the
  service layer per Phase 1's established pattern — not RLS alone) lets
  the owner: pick a preset, optionally set an accent hex, upload/replace
  the logo, edit the slug.

## Constraints

- Must build on Phase 0's existing CSS-variable token layer and
  `next-themes` setup — no new theming engine.
- Must use the Phase 0 object-storage assumption (Vercel Blob) for logo
  storage.
- Authorization for the settings UI follows Phase 1's established
  service-layer-check pattern, not RLS alone (RLS still enforces
  tenant-scoped reads/writes on the branding columns/table, but the
  permission gate is enforced in code).
- Studio slug uniqueness is a hard database constraint, not just an
  application-level check (same discipline as other unique business
  keys in this codebase).

## What's left to the builder

- Exact CSS-variable names/values for each preset's light and dark
  variant (the table above fixes the palette intent; the builder
  derives the literal hex values and variable names from Phase 0's
  existing token structure).
- Exact slug collision/suffix algorithm (e.g. `-2`, `-3`, ... on
  collision) and slug validation regex (lowercase, hyphens, length
  bounds).
- Whether branding lives on the `studios` table directly or a separate
  `studio_branding` table — builder's call based on how Phase 1's
  `studios` table is already shaped.
- The exact local-dev subdomain-override mechanism (query param vs.
  header vs. a dev-only `.env` studio pin) — pick whichever fits the
  existing Phase 0/1 middleware and test-harness conventions.
- Whether `branding.manage` is granted to the built-in Admin role in
  addition to Owner — consistent with how Phase 1 already scoped
  comparable admin-only permissions.
- The acceptance test for cross-studio branding isolation (per the
  Goals section) — exact test shape is a Phase 2 plan task, not decided
  here.
