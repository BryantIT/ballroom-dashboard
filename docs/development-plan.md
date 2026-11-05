# Ballroom Dash — Phased Development Plan

**Spec:** `references/ballroom_dash_spec_v0_3.md` (Implementation Specification v0.3)

## How to use this document

This is a **roadmap**, not an execution-ready task list. The spec covers nine
independent domain boundaries (platform, scheduling, curriculum, billing,
compensation, events, communications...) — too much to turn into one
code-level TDD plan without the plan going stale before half of it is built.

Each phase below is scoped to ship **working, testable software on its own**.
When a phase is about to start, run the `writing-plans` skill again against
that phase's section to produce the granular, file-by-file, TDD task plan —
at that point tech choices are locked and the real file layout exists to
plan against.

Phase numbers are a dependency order, not a strict calendar — Phase 2
(Theming & Branding) only needs Phase 1 and can run in parallel with
everything downstream. Phases 4 and 5 (Curriculum and Commercial) can also
run in parallel with Phase 3 and each other once Phase 1 lands, since
neither depends on Students/Scheduling or on each other.

---

## Phase 0 — Foundations

**Goal:** Empty-but-real skeleton: a Next.js app that talks to a real
Postgres database under RLS, with auth, tenant context, and a test harness
that can prove any of it works.

**Why first:** Every later phase's acceptance tests (`tenant isolation`,
`idempotent completion`, `RLS blocks missing context`) depend on this
plumbing existing and being trustworthy. Retrofitting tenant-context
middleware after business logic exists is expensive; building it first is
cheap.

**Decisions this repo doesn't have yet, with a default to build against**
(flag to the user before Phase 1 locks in — cheap to change now, expensive
after Phase 4):
- **ORM/DB access:** Drizzle ORM + `node-postgres`, not Prisma. The spec
  leans on hand-written triggers, `SET LOCAL` tenant context, RLS policies,
  and `SERIALIZABLE` transactions — Drizzle's thin query builder and raw-SQL
  escape hatches fit that better than Prisma's migration engine fighting
  hand-written DDL.
- **Auth:** Auth.js (NextAuth) v5, database sessions, credentials provider
  to start (email/password), OAuth providers added later without a rewrite.
- **Validation:** Zod, shared between API route handlers and Drizzle
  insert/update shapes.
- **Testing:** Vitest for unit tests; integration tests run against a real
  Postgres via Testcontainers (RLS and triggers can't be meaningfully
  tested against a mock). Playwright for e2e once there's a UI worth
  clicking through.
- **Hosting assumption:** Vercel + a managed Postgres (Neon or RDS) — not
  load-bearing for the plan, easy to swap.
- **UI/design system:** Tailwind (already in the repo) + shadcn/ui (Radix
  primitives) for the high-end admin-dashboard look; `next-themes` for
  light/dark mode; CSS custom-property design tokens, so Phase 2's
  per-studio accent-color override is a variable swap, not a new theming
  engine.
- **Object storage:** Vercel Blob for studio logo uploads (Phase 2) —
  matches the Vercel hosting assumption; swappable for S3/R2 later.

**Deliverables:**
- Drizzle schema + migration tooling wired up; `app.permissions` /
  `app.*` schema baseline from the spec checked in as the first migration.
- Tenant-context middleware: every authenticated request resolves actor →
  active memberships, and sets `SET LOCAL app.tenant_id` / `app.user_id`
  inside the request's transaction before any query runs.
- Auth.js wired with a `users` / `sessions` table distinct from the
  business `students` table (students never log in — spec is explicit on
  this).
- CI pipeline: lint, typecheck, unit tests, and integration tests against
  a disposable Postgres container.
- Design-system foundation: shadcn/ui component set (nav shell, data
  tables, cards, forms) wired to the Tailwind config, light/dark mode via
  `next-themes`, CSS-variable token layer for color/spacing/typography.
  Every later phase's UI builds on this instead of ad hoc styling, so the
  product reads as a cohesive, high-end dashboard from the first real
  screen rather than needing a restyling pass later.
- One throwaway end-to-end smoke test: authenticated request with no
  tenant context returns zero rows under RLS (this is acceptance test
  **#15** from the spec, and it's the cheapest possible proof the whole
  stack is wired correctly).

**Explicitly deferred:** any real business table beyond what RLS needs to
prove itself; anything from the spec's domain boundaries 2–9.

---

## Phase 1 — Platform, Studio & Authorization

**Spec sections:** Domain boundaries 1–2; BR-01; permission table;
row/field authorization rules; implementation order item 1.

**Goal:** A real owner can sign up, create a studio with locations/rooms,
invite staff, and have roles/permissions actually restrict what they can
see — across more than one studio, for the same login.

**Deliverables:**
- Global user identity, studio (tenant) provisioning, locations, rooms.
- Memberships: a user can hold independent roles in Studio A and Studio B.
- Permission codes from the spec's table, seeded and assigned to the
  built-in Owner/Admin/Instructor roles; authorization checked at the
  **service layer**, not just RLS (spec is explicit: "RLS alone does not
  enforce assigned-student edits or note visibility").
- Platform admin support-only control plane: a separate, audited path for
  staff support access — not an implicit bypass of tenant RLS.
- Studio settings: timezone (IANA) per location, used for all later
  recurrence/display calculations.

**Acceptance tests covered (spec numbering):** #1 (no permission leakage
across studios), #2 (instructor sees all students, can't edit unassigned
or view restricted notes — stubbed against a minimal student record if
Phase 2 hasn't landed yet, otherwise covered fully once it has), #3
(tenant isolation survives a forged UUID/header), #13 (reports/list
endpoints always filter by tenant), #15 (missing tenant context → zero
rows).

**Depends on:** Phase 0.

---

## Phase 2 — Studio Theming & Branding

**Spec sections:** Not in the original spec — added requirement: studios
get a distinct visual identity, and the product reads as a high-end,
sleek admin dashboard out of the box rather than a generic template.

**Goal:** A studio owner can pick a preset theme, choose an accent color,
upload a logo, get a branded subdomain, and see that branding on the
login screen — all on top of Phase 0's design-token layer, with no new
theming engine required.

**Deliverables:**
- Per-studio theme settings: a handful of curated presets (with light/
  dark variants) plus a single studio-chosen accent color that overrides
  one CSS variable across the Phase 0 token layer.
- Logo upload (Vercel Blob), rendered in the dashboard nav/header in
  place of the default mark.
- Custom subdomain resolution (`<studio>.ballroomdash.app`): the Phase 0
  tenant-context middleware resolves the studio from the subdomain for
  unauthenticated requests too, so a visitor on a branded subdomain sees
  that studio's branding before logging in.
- Branded login/splash screen: the subdomain-resolved studio's logo and
  theme colors render before authentication completes.
- Theme/branding settings UI for owners, gated by a new `branding.manage`
  permission code (the spec's existing permission table has no entry for
  this, since branding wasn't part of the original spec).

**Acceptance tests covered:** None of the spec's 15 — this is a net-new
requirement outside the original spec. Add this phase's own test before
closing it: a studio's accent color/logo/subdomain never leaks into
another studio's session or subdomain (the same tenant-isolation
discipline as spec acceptance test #1, applied to branding).

**Depends on:** Phase 1 (studio records to attach theme/branding to) and
Phase 0 (design-token layer to override). Independent of Phases 3–9 —
can run in parallel with all of them.

---

## Phase 3 — Students, CRM & Scheduling

**Spec sections:** Domain boundaries 3–4; BR-01 (rooms/locations), BR-02,
BR-04 (appointment states only — completion transaction itself is Phase 5);
implementation order item 2.

**Goal:** Staff can manage a student roster, assign instructors, and book
appointments without double-booking a room or an instructor across
locations.

**Deliverables:**
- Student records (CRM, not login-capable), instructor assignments
  (multiple concurrent, at most one "current primary" per BR-02),
  `student_relationships` for linked couples (no merged data).
- Scoped notes: staff-visible vs. assigned-instructor-visible, per the
  row/field authorization rules.
- Appointments: `scheduled → checked_in → completed`, plus
  `canceled`/`late_canceled`/`no_show` terminal states (state machine only
  — the completion side-effects belong to Phase 5).
  Recurring schedule series.
- Conflict checking: instructor double-booking across locations; a room
  can only be booked for its own location (BR-01, transactional check,
  trigger if direct SQL writes are ever allowed).

**Acceptance tests covered:** #2 (fully, once students exist), #4
(cross-location double-booking), #5 (room/location mismatch rejected).

**Depends on:** Phase 1 (studios, locations, rooms, memberships).

---

## Phase 4 — Curriculum

**Spec sections:** Domain boundary 5; BR-08; implementation order item 3.

**Goal:** Studios define their own dance/syllabus catalog; students get a
specific syllabus version assigned, and progress stays pinned to that
version even as the studio keeps editing the curriculum.

**Deliverables:**
- Dances, levels, figures — fully studio-defined.
- Syllabi owned by a studio or by an individual instructor, independently.
- Versioning: publishing a syllabus edit creates a new version; published
  versions are write-locked.
- Per-student assigned version + append-only progress tracking against
  that specific version's items.
- Permission split: editing a shared curriculum vs. recording progress are
  separate grants (`curriculum.manage_shared` vs `progress.record_assigned`).

**Acceptance tests covered:** #9 (version N stays attached to existing
progress after publishing N+1).

**Depends on:** Phase 1 (studio/permissions). Independent of Phase 3 — can
run in parallel.

---

## Phase 5 — Commercial / Billing & Entitlements

**Spec sections:** Domain boundary 6; BR-03, BR-05; implementation order
item 4.

**Goal:** A studio can sell a package or membership, issue invoices, take
a payment, and have the right number of lesson credits land on the right
billing account — without ever double-counting under concurrent requests.

**Deliverables:**
- Products/prices, billing accounts, invoices (draft → issued immutable,
  credit-note/void/reissue only), payments, refunds.
- Payment provider **adapter interface** first, a single concrete
  implementation (Stripe, as a default pending the spec's own open
  question on provider choice) second — so swapping/adding a provider
  later doesn't touch call sites.
- Entitlements: purchase → grant → `entitlement_beneficiaries`; ledger
  balance = grant + signed changes; earliest-expiring-grant-first
  consumption; overdraw prevented via row locking / `SERIALIZABLE`.
- Idempotent webhook handling for the payment provider.
- Card data never touches our storage — provider-hosted tokens only.

**Acceptance tests covered:** #6 (shared couple package consumes one
credit per appointment, not per attendee), #8 (price/plan changes don't
alter prior invoices), #11 (webhook retry doesn't double-create), #12
(refund doesn't erase attended-lesson or compensation history — asserted
here at the data-model level; full assertion needs Phase 6's compensation
records too).

**Depends on:** Phase 1 (studios/billing accounts live under a studio);
independent of Phases 3–4 for its own data model, though real invoices
will reference real students (soft dependency on Phase 3).

---

## Phase 6 — Lesson Completion & Compensation Engine

**Spec sections:** "Transaction workflow: finalize a private lesson";
BR-04 (completion/reversal), BR-07; compensation rule contract;
implementation order item 5.

**Goal:** Finishing a lesson is one idempotent transaction that completes
the appointment, consumes exactly the right entitlement, and pays the
right instructor(s) the right (and independently computed) amount — and
can be reversed cleanly if it was wrong.

**Deliverables:**
- The 8-step completion transaction from the spec, verbatim: lock
  appointment + entitlement aggregate, verify not already finalized,
  transition to `completed`, insert `lesson_completions`, apply
  consumption policy once via idempotency key, evaluate compensation
  rules, insert `instructor_earnings` with calculation snapshot, append
  audit record, commit; notifications fire async via outbox after commit.
- Compensation rule engine: JSONB rules validated against a **versioned
  JSON Schema**, interpreted by a deterministic restricted evaluator (no
  user-supplied executable code). `flat` calculation type first; schema
  leaves room for `percentage`/`hourly`/`tiered`/`bonus`/`deduction` to be
  added without a rule-format migration.
- Reversal path: compensating entitlement + earnings entries, completion
  status set to `reversed`, audit append — never a delete.
- Pay runs: export approved earnings. Explicitly not statutory payroll.
- Minimal outbox worker (the spec flags this as "a next migration" —
  build the table and a polling worker now rather than bolting it on
  later as a second migration).

**Acceptance tests covered:** #7 (two simultaneous completions never
double-consume or double-earn); #14 (disabling an instructor preserves
prior lesson notes and earnings — soft-deactivate only, enforced from
Phase 1's "no cascade-delete" rule plus this phase's immutable earnings).

**Depends on:** Phase 3 (appointments), Phase 5 (entitlements, billing
accounts). This is the first phase that genuinely needs both prior
verticals finished — don't start it early.

---

## Phase 7 — Memberships, Events & External Competitions, Communications

**Spec sections:** Domain boundaries 6 (membership subscriptions)/8/9;
BR-06, BR-09, BR-10; implementation order item 6.

**Goal:** Recurring membership billing, studio-run events, external
competition entry/billing, and consent-respecting messaging — the three
remaining customer-facing verticals the spec explicitly groups together
as "last."

**Deliverables:**
- Membership plans (cadence + benefits) and subscriptions (account state);
  idempotent renewal/cancellation; periodic entitlement grants traceable
  back to the subscription period that generated them; configurable
  rollover/grace/failed-payment policy per studio.
- Studio events: creation and registration.
- External competitions: entries with multiple student/professional
  participants, dance/level/division/heat descriptors, billed via normal
  invoice lines. Explicitly no judging/heat-generation — out of scope per
  spec's non-goals.
- Communications: conversations, per-channel consent/opt-out state
  gating marketing sends; transactional messages still compliance-aware;
  provider webhooks verified, deduplicated, retained without excess
  sensitive payload.

**Acceptance tests covered:** #10 (competition entry with student +
professional partner, multiple charges, no judging data required).

**Depends on:** Phase 5 (billing/invoicing), Phase 3 (students).

---

## Phase 8 — Reporting, Audit & Platform Support Tooling

**Spec sections:** Domain boundary 9 (audit half); permissions
`reports.financial`; acceptance test #13.

**Goal:** Owners and admins get the financial/operational reports the
business actually runs on, and every sensitive operation already has an
audit trail that's queryable, not just written.

**Deliverables:**
- `GET /v1/studios/{studioId}/reports/financial` and friends — tenant +
  date + optional-location filtered, every list endpoint paginated.
- Audit log viewer for platform support and studio owners.
- Platform support session audit surfacing (ties back to Phase 1's
  audited support-session requirement).

**Acceptance tests covered:** #13 (fully, across all report endpoints
that exist by this point).

**Depends on:** all prior phases contributing data to report on; mostly
additive once Phases 1–7 exist.

---

## Phase 9 — Hardening & Launch Readiness

**Spec sections:** "Security and implementation cautions"; all 15
acceptance tests as a regression suite.

**Goal:** Everything the spec flags as "needed before this is a
production-certified system" rather than a schema baseline.

**Deliverables:**
- Encryption/access-control + retention policy for sensitive notes,
  payment tokens, external-provider secrets (secrets manager, not env
  vars, for the latter).
- Database trigger/constraint pass: room-location consistency,
  progress-item/version consistency, nonoverlapping compensation
  assignments, completed-financial arithmetic checks — anything that was
  "add trigger if direct SQL writes are supported" in earlier phases
  gets finished here.
- Webhook/accounting reconciliation jobs; outbox worker hardened for
  retry/poison-message handling.
- Backup/restore drill, executed at least once against a staging copy.
- Full run of all 15 spec acceptance tests as one regression suite,
  including the concurrency-sensitive ones (#7, #11) under load.
- Resolve the spec's open "Follow-up decisions requiring product input"
  list (franchise/multi-studio consolidation, compensation basis,
  package transferability, SaaS metering basis, final payment/SMS
  provider) — these are product calls, not engineering ones, and should
  be confirmed before this phase closes, not discovered during it.
- Taxes, coupons, consent/legal policy, PCI merchant setup finalized.

**Depends on:** everything.

---

## Dependency summary

```
Phase 0 (Foundations incl. design system)
  └─ Phase 1 (Platform/Studio/Auth)
       ├─ Phase 2 (Theming & Branding)                 [parallel w/ 3-7]
       ├─ Phase 3 (Students/Scheduling)
       │     └─ Phase 6 (Completion/Compensation) ←── also needs Phase 5
       ├─ Phase 4 (Curriculum)                         [parallel w/ 3 & 5]
       └─ Phase 5 (Billing/Entitlements)
             ├─ Phase 6 (Completion/Compensation)
             └─ Phase 7 (Memberships/Events/Comms)      [also needs Phase 3]
Phase 8 (Reporting/Audit)   ← additive over 1–7
Phase 9 (Hardening/Launch)  ← everything
```

## Next step

Pick a phase (Phase 0 is the only unblocked one right now) and run the
`writing-plans` skill against this document's section for that phase to
get the file-by-file, TDD-granular implementation plan.
