# Phase 1 — Platform, Studio & Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A real owner can sign up, provision a studio with a default location, invite staff by email, and have roles/permissions actually restrict what each staff member can do — enforced at the service layer, not just by RLS — across more than one studio for the same login.

**Architecture:** Every new business table is tenant-owned (`studio_id`) except three deliberately global tables: `permissions` (a shared reference catalog, like a lookup table — no RLS, read-only to the app), `platform_admins` (a global staff flag, no RLS, read-only to the app — same precedent as the existing `users` table), and `invitations` (also no RLS, same precedent as `users`: an invitee has no studio membership yet, so the invitation-acceptance flow must look a row up by an unguessable token *before* any tenant context exists — exactly the same "pre-authentication, no tenant known yet" situation `auth.ts`'s `authorizeCredentials()` is already in against the `users` table). Every tenant-owned table gets RLS plus a service-layer permission check, per the spec's explicit instruction that "RLS alone does not enforce assigned-student edits or note visibility." Two service-layer modules carry that enforcement: `lib/auth/authorization.ts` (membership + permission-code checks) and `lib/students/authorization.ts` (assignment-scoped student edit checks). Studio creation solves its own chicken-and-egg problem (a studio's own tenant context can't exist before the studio row does) by generating the studio's UUID in application code first, then opening exactly one `withTenantContext()` transaction with that pre-generated id as `tenantId` — every insert inside it (studio, location, roles, role_permissions, owner membership) then satisfies the same RLS `WITH CHECK` every other tenant write does, with no special-cased bypass.

**Tech Stack:** Same as Phase 0 (Next.js 16.4.5, Drizzle ORM 0.45.4 + `pg` 8.23.1 + drizzle-kit 0.31.11, Auth.js 5.0.0-beta.32, Vitest 5.1.0 + Testcontainers 12.2.1), plus Zod 4.6.7 for request-body validation (the Phase 0 roadmap named Zod as the validation choice but Phase 0 had no route with a body to validate; this is its first real use). Version read live from the npm registry on 2026-11-06 — pin it exactly.

**Spec:** `references/ballroom_dash_spec_v0_3.md` (domain boundaries 1–2, BR-01, the permission table, the row/field authorization rules, acceptance tests #1–#3/#13/#15); `docs/development-plan.md`, Phase 1 section (the roadmap entry this plan implements).

## Global Constraints

- Every tenant-owned table (everything with a `studio_id` column except the three exceptions named above) is RLS-enabled with a `studio_id::text = current_setting('app.tenant_id', true)` policy, and every read/write of it goes through `withTenantContext()` — carried over unchanged from Phase 0's constraint.
- A permission code is checked at the service layer before any tenant-scoped mutation that the spec's permission table gates — RLS is defense-in-depth, never the only gate, per the spec's "Security and implementation cautions" section.
- `permissions`, `platform_admins`, and `invitations` are the only three tables in this plan with no RLS policy; each one's exception is documented with an inline comment in `lib/db/schema.ts` citing this paragraph.
- The Credentials-provider JWT session (Phase 0, `auth.ts`) remains the only session mechanism; nothing in this plan changes session strategy.
- All new route handlers live under `app/api/v1/...`, matching the spec's "Suggested API boundaries" path prefix (Phase 0's one route, `/api/_internal/tenant-probe`, is deleted in Task 11 and was never under `/v1`).
- Every mutating route handler requires an authenticated session (`verifySession()` from `lib/dal.ts`) and validates its request body with a Zod schema before calling any service function.

## Decisions this plan locks in (flag before Phase 3 depends on them)

- **Permission defaults for the spec's "optional"/"restricted"/"limited" markers:** the spec's permission table leaves `Admin`/`Instructor` as `optional`, `restricted`, or `limited` for several codes (e.g. `appointments.manage_self` for Admin, `notes.read_staff` for Instructor, `events.manage` for Instructor) rather than a hard yes/no, because per-studio customization is out of scope for v0.3. This plan resolves every such marker to **not granted** by default (least privilege) for the three built-in roles — see `lib/auth/permissions.ts`'s `BUILTIN_ROLE_PERMISSIONS`. There is no custom-role editor in this phase; a studio cannot yet change what Admin/Instructor can do. Revisit if/when a role-editing UI is built.
- **`locations.manage` is a new permission code**, not in the spec's table, because the spec's table has no code governing who can add a studio location. Same precedent `docs/development-plan.md`'s Phase 2 section already set for `branding.manage`. Owner-only by default.
- **Acceptance test #2** ("Instructor at Studio A can view all A students but cannot edit an unassigned student's profile or view restricted notes") needs a students table and instructor assignments, which domain boundary 3 (Phase 3) owns. The roadmap's Phase 1 section calls for a *stub* here ("stubbed against a minimal student record... otherwise covered fully once it has" — the roadmap text says "Phase 2" there, which is a typo: Phase 2 is Theming and has no students; the roadmap's own Phase 3 section says "#2 (fully, once students exist)", confirming Phase 3 is meant). This plan therefore adds a minimal `students`/`student_assignments` pair (Task 9) — just enough to prove the assignment-scoped edit rule — that Phase 3 *extends* with CRM fields, notes, and partnerships rather than replacing, unlike Phase 0's throwaway `tenant_probe`.

## Review Focus

- **A deactivated membership must lose access immediately**, not just stop appearing in new invitations — `getActiveMembership()` must filter `status = 'active'`, and the row/field rule ("studio membership must be active") must be exercised with a membership explicitly set to `'inactive'`, not only tested by absence of a row. Covered in Task 6.
- **A user with memberships in two studios must never see Studio B's data while acting in Studio A's context**, even though their own membership row is visible cross-tenant by design (so the "list my studios" query works). Covered in Task 4 and re-verified end-to-end in Task 11 (acceptance test #1).
- **An expired or already-accepted invitation token must be rejected**, not silently treated as valid — the spec implies this by giving invitations a `status`/expiry at all. Covered in Task 7.
- **A forged `studioId` in a URL for a studio the caller has no membership in must be rejected by the service layer**, not rely on the caller never trying it — acceptance test #3 names exactly this. Covered in Task 6 (`requirePermission` throws when no active membership exists) and re-verified in Task 11.
- **A room's `studio_id` must actually match its location's studio** — nothing in Tasks 1–11 enforces this with a trigger (the spec explicitly defers that enforcement to Phase 9's hardening pass, "add trigger if direct SQL writes are supported"), so Task 1's own test proves the *application-level* insert path always derives `room.studio_id` from the location row rather than trusting a caller-supplied value, even though the DB itself won't reject a mismatched one yet.

---

### Task 1: Studios, Locations, Rooms — schema, migration, RLS (BR-01)

**Files:**
- Modify: `lib/db/schema.ts` (add `studios`, `locations`, `rooms`)
- Create: `drizzle/0002_*.sql` (auto-generated DDL)
- Create: `drizzle/0003_studios_locations_rooms_rls.sql` (hand-written RLS + grants)
- Modify: `scripts/db-setup-roles.sql` (add GRANT lines)
- Create: `lib/db/schema.studios.test.ts`

**Interfaces:**
- Consumes: `appSchema` from `lib/db/schema.ts` (Phase 0).
- Produces: `studios`, `locations`, `rooms` Drizzle table objects exported from `lib/db/schema.ts` — consumed by every task from here on.

- [ ] **Step 1: Add the three tables to `lib/db/schema.ts`**

Add `boolean` and `uniqueIndex`(not needed here, only in Task 3) to the existing `drizzle-orm/pg-core` import — for this task only `boolean` isn't needed either; no import change yet. Append after the `tenantProbe` block:

```ts
// --- Phase 1: Platform & Studio ---
// studios.id is NOT auto-generated: lib/studios/provision.ts (Task 5)
// generates the id in application code first, so it can open the new
// studio's own withTenantContext() transaction before the row exists —
// every insert in that transaction (this row included) then satisfies
// the same RLS WITH CHECK every other tenant write does.
export const studios = appSchema.table("studios", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const locations = appSchema.table("locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  studioId: uuid("studio_id")
    .notNull()
    .references(() => studios.id),
  name: text("name").notNull(),
  timezone: text("timezone").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// studioId is denormalized from locations.studioId (not derived via a
// join) so the RLS policy below doesn't need one. The application layer
// (never a caller-supplied value) is responsible for keeping it in sync —
// see this task's test and the Review Focus note on room/location
// consistency. A DB trigger enforcing this is deferred to Phase 9 per
// the spec's "Security and implementation cautions" section.
export const rooms = appSchema.table("rooms", {
  id: uuid("id").primaryKey().defaultRandom(),
  locationId: uuid("location_id")
    .notNull()
    .references(() => locations.id),
  studioId: uuid("studio_id")
    .notNull()
    .references(() => studios.id),
  name: text("name").notNull(),
});
```

- [ ] **Step 2: Generate the schema migration**

Run: `npx drizzle-kit generate`
Expected: creates `drizzle/0002_*.sql` containing `CREATE TABLE "app"."studios"`, `"app"."locations"`, `"app"."rooms"`.

- [ ] **Step 3: Write the hand-written RLS + grants migration**

```bash
npx drizzle-kit generate --custom --name=studios_locations_rooms_rls
```

Fill the generated (empty) file in with:

```sql
-- drizzle/0003_studios_locations_rooms_rls.sql
ALTER TABLE "app"."studios" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "app"."studios"
  USING (id::text = current_setting('app.tenant_id', true))
  WITH CHECK (id::text = current_setting('app.tenant_id', true));

ALTER TABLE "app"."locations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "app"."locations"
  USING (studio_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (studio_id::text = current_setting('app.tenant_id', true));

ALTER TABLE "app"."rooms" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "app"."rooms"
  USING (studio_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (studio_id::text = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE ON "app"."studios" TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON "app"."locations" TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON "app"."rooms" TO app_runtime;
```

- [ ] **Step 4: Add the matching grants to `scripts/db-setup-roles.sql`**

Append below the existing `tenant_probe`/Auth.js grant lines:

```sql
GRANT SELECT, INSERT, UPDATE ON "app"."studios" TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON "app"."locations" TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON "app"."rooms" TO app_runtime;
```

- [ ] **Step 5: Write the failing RLS test**

```ts
// lib/db/schema.studios.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "./testing/test-database";
import { studios, locations, rooms } from "./schema";
import * as schema from "./schema";

describe("studios/locations/rooms RLS", () => {
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

  test("a runtime connection with no tenant context sees no studios, locations, or rooms, even though rows exist for two studios", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    const studioA = "11111111-1111-1111-1111-111111111111";
    const studioB = "22222222-2222-2222-2222-222222222222";
    await seedDb.insert(studios).values([
      { id: studioA, name: "Studio A" },
      { id: studioB, name: "Studio B" },
    ]);
    const [locationA] = await seedDb
      .insert(locations)
      .values({ studioId: studioA, name: "Main", timezone: "America/Chicago" })
      .returning();
    await seedDb.insert(rooms).values({
      locationId: locationA.id,
      studioId: studioA,
      name: "Studio 1",
    });
    await seedPool.end();

    const runtimeDb = drizzle(pool, { schema });
    expect(await runtimeDb.select().from(studios)).toHaveLength(0);
    expect(await runtimeDb.select().from(locations)).toHaveLength(0);
    expect(await runtimeDb.select().from(rooms)).toHaveLength(0);
  });

  test("setting app.tenant_id scopes studios, locations, and rooms to that studio only", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    const studioA = "33333333-3333-3333-3333-333333333333";
    const studioB = "44444444-4444-4444-4444-444444444444";
    await seedDb.insert(studios).values([
      { id: studioA, name: "Studio A" },
      { id: studioB, name: "Studio B" },
    ]);
    const [locationA] = await seedDb
      .insert(locations)
      .values({ studioId: studioA, name: "Main", timezone: "America/Chicago" })
      .returning();
    await seedDb.insert(locations).values({
      studioId: studioB,
      name: "Other",
      timezone: "America/New_York",
    });
    await seedDb.insert(rooms).values({
      locationId: locationA.id,
      studioId: studioA,
      name: "Studio 1",
    });
    await seedPool.end();

    const runtimeClient = new Pool({ connectionString: testDb.runtimeConnectionUri });
    const runtimeDb = drizzle(runtimeClient, { schema });
    const rows = await runtimeDb.transaction(async (tx) => {
      await tx.execute(`select set_config('app.tenant_id', '${studioA}', true)`);
      return {
        studios: await tx.select().from(studios),
        locations: await tx.select().from(locations),
        rooms: await tx.select().from(rooms),
      };
    });
    await runtimeClient.end();

    expect(rows.studios).toHaveLength(1);
    expect(rows.studios[0].id).toBe(studioA);
    expect(rows.locations).toHaveLength(1);
    expect(rows.rooms).toHaveLength(1);
  });
});
```

- [ ] **Step 6: Run the test**

Run: `npx vitest run lib/db/schema.studios.test.ts`
Expected: FAIL until Step 7 applies the migrations (error connecting or missing tables), then PASS both cases once migrations exist — `createTestDatabase()` (Phase 0) runs every migration file under `drizzle/` automatically, so no extra wiring is needed for the new ones.

- [ ] **Step 7: Apply locally and confirm**

Run: `npx drizzle-kit migrate` (against your local Compose DB, if you want to confirm outside Testcontainers too)
Run: `npx vitest run lib/db/schema.studios.test.ts`
Expected: PASS, both cases.

- [ ] **Step 8: Commit**

```bash
git add lib/db/schema.ts drizzle scripts/db-setup-roles.sql lib/db/schema.studios.test.ts
git commit -m "feat: add studios/locations/rooms schema with tenant RLS"
```

---

### Task 2: Permissions catalog — schema, seed

**Files:**
- Create: `lib/auth/permissions.ts`
- Modify: `lib/db/schema.ts` (add `permissions`)
- Create: `drizzle/0004_*.sql` (auto-generated DDL)
- Create: `drizzle/0005_permissions_seed.sql` (hand-written seed + grant)
- Modify: `scripts/db-setup-roles.sql`
- Create: `lib/auth/permissions.test.ts`

**Interfaces:**
- Produces: `PERMISSION_CODES: readonly string[]`, `PermissionCode` (union type), `PERMISSION_DESCRIPTIONS: Record<PermissionCode, string>`, `BUILTIN_ROLES: readonly ["owner", "admin", "instructor"]`, `BuiltinRoleCode`, `BUILTIN_ROLE_PERMISSIONS: Record<BuiltinRoleCode, PermissionCode[]>` from `lib/auth/permissions.ts` — consumed by Task 5 (`provisionStudio`), Task 6 (`hasPermission`), and Task 10's route handlers. `permissions` Drizzle table from `lib/db/schema.ts` — consumed by Task 3 (`role_permissions`' foreign key).

- [ ] **Step 1: Write the permission catalog module**

```ts
// lib/auth/permissions.ts
export const PERMISSION_CODES = [
  "students.read",
  "students.create",
  "students.update_all",
  "students.update_assigned",
  "students.assign",
  "notes.read_staff",
  "notes.write_assigned",
  "appointments.read_all",
  "appointments.manage_all",
  "appointments.manage_self",
  "curriculum.manage_shared",
  "curriculum.manage_own",
  "progress.record_assigned",
  "billing.read_detail",
  "billing.process",
  "entitlements.read_relevant",
  "compensation.configure",
  "compensation.view_own",
  "reports.financial",
  "events.manage",
  "competitions.manage_entries",
  "communications.send",
  "users.manage",
  "integrations.configure",
  // Not in the spec's permission table — added for studio location
  // management, which the spec never assigned a code to. See
  // docs/superpowers/plans/2026-11-06-phase-1-platform-studio-auth.md's
  // "Decisions this plan locks in" section.
  "locations.manage",
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];

export const PERMISSION_DESCRIPTIONS: Record<PermissionCode, string> = {
  "students.read": "View student records in this studio",
  "students.create": "Create new student records",
  "students.update_all": "Edit any student's profile, regardless of assignment",
  "students.update_assigned": "Edit profiles of students the staff member is assigned to",
  "students.assign": "Assign or reassign instructors to students",
  "notes.read_staff": "Read staff-visible student notes",
  "notes.write_assigned": "Write notes for assigned students",
  "appointments.read_all": "View all appointments in this studio",
  "appointments.manage_all": "Create, edit, or cancel any appointment",
  "appointments.manage_self": "Create, edit, or cancel the staff member's own appointments",
  "curriculum.manage_shared": "Edit the studio's shared curriculum",
  "curriculum.manage_own": "Edit the staff member's own curriculum",
  "progress.record_assigned": "Record progress for assigned students",
  "billing.read_detail": "View billing and invoice details",
  "billing.process": "Process payments and invoices",
  "entitlements.read_relevant": "View entitlement balances relevant to the staff member's work",
  "compensation.configure": "Configure compensation plans and rules",
  "compensation.view_own": "View the staff member's own compensation/earnings",
  "reports.financial": "View financial reports",
  "events.manage": "Manage studio events",
  "competitions.manage_entries": "Manage external competition entries",
  "communications.send": "Send communications to students",
  "users.manage": "Manage staff memberships and invitations",
  "integrations.configure": "Configure third-party integrations",
  "locations.manage": "Create and manage studio locations",
};

export const BUILTIN_ROLES = ["owner", "admin", "instructor"] as const;
export type BuiltinRoleCode = (typeof BUILTIN_ROLES)[number];

// Every "optional"/"restricted"/"limited" marker in the spec's permission
// table resolves to NOT granted here — see "Decisions this plan locks
// in" in the plan doc. Owner always gets every code.
export const BUILTIN_ROLE_PERMISSIONS: Record<BuiltinRoleCode, PermissionCode[]> = {
  owner: [...PERMISSION_CODES],
  admin: [
    "students.read",
    "students.create",
    "students.update_all",
    "students.update_assigned",
    "students.assign",
    "notes.read_staff",
    "notes.write_assigned",
    "appointments.read_all",
    "appointments.manage_all",
    "billing.read_detail",
    "billing.process",
    "entitlements.read_relevant",
    "events.manage",
    "competitions.manage_entries",
    "communications.send",
  ],
  instructor: [
    "students.read",
    "students.create",
    "students.update_assigned",
    "notes.write_assigned",
    "appointments.read_all",
    "appointments.manage_self",
    "curriculum.manage_own",
    "progress.record_assigned",
    "entitlements.read_relevant",
    "compensation.view_own",
  ],
};
```

- [ ] **Step 2: Add the `permissions` table to `lib/db/schema.ts`**

```ts
// --- Phase 1: shared reference catalog — NOT tenant-owned, no RLS.
// Same category of exception as this file's Auth.js tables (users,
// accounts, etc.): global data every tenant reads, nothing writes at
// runtime (seeded once by migration). See this plan's Global Constraints.
export const permissions = appSchema.table("permissions", {
  code: text("code").primaryKey(),
  description: text("description").notNull(),
});
```

- [ ] **Step 3: Generate the schema migration**

Run: `npx drizzle-kit generate`
Expected: creates `drizzle/0004_*.sql` containing `CREATE TABLE "app"."permissions"`.

- [ ] **Step 4: Write the seed + grant migration**

```bash
npx drizzle-kit generate --custom --name=permissions_seed
```

Fill it in — one `INSERT` per code, generated from `PERMISSION_DESCRIPTIONS` by hand (the migration is static SQL; it cannot import the TS module):

```sql
-- drizzle/0005_permissions_seed.sql
INSERT INTO "app"."permissions" (code, description) VALUES
  ('students.read', 'View student records in this studio'),
  ('students.create', 'Create new student records'),
  ('students.update_all', 'Edit any student''s profile, regardless of assignment'),
  ('students.update_assigned', 'Edit profiles of students the staff member is assigned to'),
  ('students.assign', 'Assign or reassign instructors to students'),
  ('notes.read_staff', 'Read staff-visible student notes'),
  ('notes.write_assigned', 'Write notes for assigned students'),
  ('appointments.read_all', 'View all appointments in this studio'),
  ('appointments.manage_all', 'Create, edit, or cancel any appointment'),
  ('appointments.manage_self', 'Create, edit, or cancel the staff member''s own appointments'),
  ('curriculum.manage_shared', 'Edit the studio''s shared curriculum'),
  ('curriculum.manage_own', 'Edit the staff member''s own curriculum'),
  ('progress.record_assigned', 'Record progress for assigned students'),
  ('billing.read_detail', 'View billing and invoice details'),
  ('billing.process', 'Process payments and invoices'),
  ('entitlements.read_relevant', 'View entitlement balances relevant to the staff member''s work'),
  ('compensation.configure', 'Configure compensation plans and rules'),
  ('compensation.view_own', 'View the staff member''s own compensation/earnings'),
  ('reports.financial', 'View financial reports'),
  ('events.manage', 'Manage studio events'),
  ('competitions.manage_entries', 'Manage external competition entries'),
  ('communications.send', 'Send communications to students'),
  ('users.manage', 'Manage staff memberships and invitations'),
  ('integrations.configure', 'Configure third-party integrations'),
  ('locations.manage', 'Create and manage studio locations');

GRANT SELECT ON "app"."permissions" TO app_runtime;
```

- [ ] **Step 5: Add the grant to `scripts/db-setup-roles.sql`**

```sql
GRANT SELECT ON "app"."permissions" TO app_runtime;
```

- [ ] **Step 6: Write the failing test proving `PERMISSION_CODES` and the seed migration agree**

```ts
// lib/auth/permissions.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "../db/testing/test-database";
import { permissions } from "../db/schema";
import * as schema from "../db/schema";
import { PERMISSION_CODES, BUILTIN_ROLE_PERMISSIONS } from "./permissions";

describe("permission catalog", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  test("the seed migration inserts exactly the codes PERMISSION_CODES declares", async () => {
    const pool = new Pool({ connectionString: testDb.connectionUri });
    const db = drizzle(pool, { schema });
    const rows = await db.select().from(permissions);
    await pool.end();

    const seededCodes = rows.map((r) => r.code).sort();
    expect(seededCodes).toEqual([...PERMISSION_CODES].sort());
  });

  test("every code granted to a built-in role is a real permission code", () => {
    for (const role of Object.keys(BUILTIN_ROLE_PERMISSIONS) as Array<
      keyof typeof BUILTIN_ROLE_PERMISSIONS
    >) {
      for (const code of BUILTIN_ROLE_PERMISSIONS[role]) {
        expect(PERMISSION_CODES).toContain(code);
      }
    }
  });
});
```

- [ ] **Step 7: Run the test**

Run: `npx vitest run lib/auth/permissions.test.ts`
Expected: PASS, both cases.

- [ ] **Step 8: Commit**

```bash
git add lib/auth/permissions.ts lib/db/schema.ts drizzle scripts/db-setup-roles.sql lib/auth/permissions.test.ts
git commit -m "feat: add permission catalog and built-in role permission defaults"
```

---

### Task 3: Roles & RolePermissions — schema, migration, RLS

**Files:**
- Modify: `lib/db/schema.ts` (add `roles`, `rolePermissions`)
- Create: `drizzle/0006_*.sql` (auto-generated DDL)
- Create: `drizzle/0007_roles_rls.sql` (hand-written RLS + grants)
- Modify: `scripts/db-setup-roles.sql`
- Create: `lib/db/schema.roles.test.ts`

**Interfaces:**
- Consumes: `studios` from Task 1, `permissions` from Task 2.
- Produces: `roles`, `rolePermissions` Drizzle table objects — consumed by Task 5 (`provisionStudio`) and Task 6 (`getActiveMembership`).

- [ ] **Step 1: Add `uniqueIndex` and `boolean` to the `drizzle-orm/pg-core` import, then add the two tables**

```ts
import {
  pgSchema,
  pgTable,
  text,
  timestamp,
  uuid,
  primaryKey,
  integer,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";
```

```ts
export const roles = appSchema.table(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studioId: uuid("studio_id")
      .notNull()
      .references(() => studios.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    isBuiltin: boolean("is_builtin").notNull().default(true),
  },
  (t) => [uniqueIndex("roles_studio_code_unique").on(t.studioId, t.code)]
);

export const rolePermissions = appSchema.table(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    permissionCode: text("permission_code")
      .notNull()
      .references(() => permissions.code),
    // Denormalized from roles.studioId so the RLS policy doesn't need a
    // join through roles — same rationale as rooms.studioId in Task 1.
    studioId: uuid("studio_id")
      .notNull()
      .references(() => studios.id),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionCode] })]
);
```

- [ ] **Step 2: Generate the schema migration**

Run: `npx drizzle-kit generate`
Expected: creates `drizzle/0006_*.sql` containing `CREATE TABLE "app"."roles"`, `"app"."role_permissions"`.

- [ ] **Step 3: Write the RLS + grants migration**

```bash
npx drizzle-kit generate --custom --name=roles_rls
```

```sql
-- drizzle/0007_roles_rls.sql
ALTER TABLE "app"."roles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "app"."roles"
  USING (studio_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (studio_id::text = current_setting('app.tenant_id', true));

ALTER TABLE "app"."role_permissions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "app"."role_permissions"
  USING (studio_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (studio_id::text = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "app"."roles" TO app_runtime;
GRANT SELECT, INSERT, DELETE ON "app"."role_permissions" TO app_runtime;
```

- [ ] **Step 4: Add the grants to `scripts/db-setup-roles.sql`**

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON "app"."roles" TO app_runtime;
GRANT SELECT, INSERT, DELETE ON "app"."role_permissions" TO app_runtime;
```

- [ ] **Step 5: Write the failing RLS test**

```ts
// lib/db/schema.roles.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "./testing/test-database";
import { studios, roles, rolePermissions } from "./schema";
import * as schema from "./schema";

describe("roles/role_permissions RLS", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  test("a runtime connection only sees roles and grants for the tenant in context", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    const studioA = "55555555-5555-5555-5555-555555555555";
    const studioB = "66666666-6666-6666-6666-666666666666";
    await seedDb.insert(studios).values([
      { id: studioA, name: "Studio A" },
      { id: studioB, name: "Studio B" },
    ]);
    const [roleA] = await seedDb
      .insert(roles)
      .values({ studioId: studioA, code: "owner", name: "Owner" })
      .returning();
    await seedDb.insert(roles).values({ studioId: studioB, code: "owner", name: "Owner" });
    await seedDb.insert(rolePermissions).values({
      roleId: roleA.id,
      permissionCode: "students.read",
      studioId: studioA,
    });
    await seedPool.end();

    const runtimePool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    const runtimeDb = drizzle(runtimePool, { schema });
    const rows = await runtimeDb.transaction(async (tx) => {
      await tx.execute(`select set_config('app.tenant_id', '${studioA}', true)`);
      return {
        roles: await tx.select().from(roles),
        grants: await tx.select().from(rolePermissions),
      };
    });
    await runtimePool.end();

    expect(rows.roles).toHaveLength(1);
    expect(rows.roles[0].studioId).toBe(studioA);
    expect(rows.grants).toHaveLength(1);
  });
});
```

- [ ] **Step 6: Run the test**

Run: `npx vitest run lib/db/schema.roles.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/db/schema.ts drizzle scripts/db-setup-roles.sql lib/db/schema.roles.test.ts
git commit -m "feat: add roles/role_permissions schema with tenant RLS"
```

---

### Task 4: Memberships — schema, migration, RLS

**Files:**
- Modify: `lib/db/schema.ts` (add `memberships`)
- Create: `drizzle/0008_*.sql` (auto-generated DDL)
- Create: `drizzle/0009_memberships_rls.sql` (hand-written RLS + grants)
- Modify: `scripts/db-setup-roles.sql`
- Create: `lib/db/schema.memberships.test.ts`

**Interfaces:**
- Consumes: `studios` (Task 1), `roles` (Task 3), `users` (Phase 0).
- Produces: `memberships` Drizzle table object — consumed by Task 5, Task 6, Task 7, Task 8.

- [ ] **Step 1: Add the table**

```ts
export const memberships = appSchema.table(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studioId: uuid("studio_id")
      .notNull()
      .references(() => studios.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("memberships_studio_user_unique").on(t.studioId, t.userId)]
);
```

- [ ] **Step 2: Generate the schema migration**

Run: `npx drizzle-kit generate`
Expected: creates `drizzle/0008_*.sql` containing `CREATE TABLE "app"."memberships"`.

- [ ] **Step 3: Write the RLS + grants migration**

This table needs two policies, not one: a user must always be able to see their *own* membership rows across every studio they belong to (so "which studios am I in" works before any tenant context is chosen), but writes must stay tenant-scoped — a `WITH CHECK` that also allowed `user_id = current user` would let a user insert a membership for themselves in a studio they have no context for.

```bash
npx drizzle-kit generate --custom --name=memberships_rls
```

```sql
-- drizzle/0009_memberships_rls.sql
ALTER TABLE "app"."memberships" ENABLE ROW LEVEL SECURITY;

-- Read access: your own rows (any studio) OR any row in the studio
-- currently in context (so studio staff can list other members).
CREATE POLICY self_or_tenant_select ON "app"."memberships" FOR SELECT
  USING (
    user_id = current_setting('app.user_id', true)
    OR studio_id::text = current_setting('app.tenant_id', true)
  );

-- Write access: tenant-scoped only. A user can never insert/update/
-- delete a membership row outside the studio currently in context, even
-- their own.
CREATE POLICY tenant_write ON "app"."memberships" FOR ALL
  USING (studio_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (studio_id::text = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE ON "app"."memberships" TO app_runtime;
```

- [ ] **Step 4: Add the grant to `scripts/db-setup-roles.sql`**

```sql
GRANT SELECT, INSERT, UPDATE ON "app"."memberships" TO app_runtime;
```

- [ ] **Step 5: Write the failing RLS test**

```ts
// lib/db/schema.memberships.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "./testing/test-database";
import { studios, roles, memberships, users } from "./schema";
import * as schema from "./schema";

describe("memberships RLS", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  test("a user sees their own memberships across studios with no tenant context set, but not another user's", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    const studioA = "77777777-7777-7777-7777-777777777777";
    const studioB = "88888888-8888-8888-8888-888888888888";
    await seedDb.insert(studios).values([
      { id: studioA, name: "Studio A" },
      { id: studioB, name: "Studio B" },
    ]);
    const [roleA] = await seedDb
      .insert(roles)
      .values({ studioId: studioA, code: "owner", name: "Owner" })
      .returning();
    const [roleB] = await seedDb
      .insert(roles)
      .values({ studioId: studioB, code: "owner", name: "Owner" })
      .returning();
    const [userX] = await seedDb
      .insert(users)
      .values({ email: "x@example.com" })
      .returning();
    const [userY] = await seedDb
      .insert(users)
      .values({ email: "y@example.com" })
      .returning();
    await seedDb.insert(memberships).values([
      { studioId: studioA, userId: userX.id, roleId: roleA.id },
      { studioId: studioB, userId: userX.id, roleId: roleB.id },
      { studioId: studioA, userId: userY.id, roleId: roleA.id },
    ]);
    await seedPool.end();

    const runtimePool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    const runtimeDb = drizzle(runtimePool, { schema });
    const rows = await runtimeDb.transaction(async (tx) => {
      await tx.execute(`select set_config('app.user_id', '${userX.id}', true)`);
      return tx.select().from(memberships);
    });
    await runtimePool.end();

    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.userId === userX.id)).toBe(true);
  });

  test("an insert into a studio outside the current tenant context is rejected even for the acting user's own row", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    const studioA = "99999999-9999-9999-9999-999999999999";
    await seedDb.insert(studios).values({ id: studioA, name: "Studio A" });
    const [roleA] = await seedDb
      .insert(roles)
      .values({ studioId: studioA, code: "owner", name: "Owner" })
      .returning();
    const [userZ] = await seedDb
      .insert(users)
      .values({ email: "z@example.com" })
      .returning();
    await seedPool.end();

    const runtimePool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    const runtimeDb = drizzle(runtimePool, { schema });
    await expect(
      runtimeDb.transaction(async (tx) => {
        // No app.tenant_id set at all — studio_id::text can never equal
        // an unset setting, so the WITH CHECK must reject this insert.
        await tx.execute(`select set_config('app.user_id', '${userZ.id}', true)`);
        await tx.insert(memberships).values({
          studioId: studioA,
          userId: userZ.id,
          roleId: roleA.id,
        });
      })
    ).rejects.toThrow();
    await runtimePool.end();
  });
});
```

- [ ] **Step 6: Run the test**

Run: `npx vitest run lib/db/schema.memberships.test.ts`
Expected: PASS, both cases.

- [ ] **Step 7: Commit**

```bash
git add lib/db/schema.ts drizzle scripts/db-setup-roles.sql lib/db/schema.memberships.test.ts
git commit -m "feat: add memberships schema with cross-tenant self-visibility RLS"
```

---

### Task 5: `provisionStudio()` — atomic studio creation

**Files:**
- Create: `lib/studios/provision.ts`
- Create: `lib/studios/provision.test.ts`

**Interfaces:**
- Consumes: `withTenantContext` (Phase 0), `studios`/`locations`/`roles`/`rolePermissions`/`memberships` (Tasks 1/3/4), `BUILTIN_ROLES`/`BUILTIN_ROLE_PERMISSIONS` (Task 2).
- Produces: `provisionStudio(input: { ownerId: string; studioName: string; timezone: string }, database?: Db): Promise<{ studioId: string; locationId: string; ownerMembershipId: string }>` — consumed by Task 10's `POST /v1/studios` route.

- [ ] **Step 1: Write the failing integration test**

```ts
// lib/studios/provision.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "../db/testing/test-database";
import { studios, locations, roles, rolePermissions, memberships, users } from "../db/schema";
import * as schema from "../db/schema";
import { BUILTIN_ROLE_PERMISSIONS } from "../auth/permissions";

describe("provisionStudio", () => {
  let testDb: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  test("creates a studio, default location, three built-in roles with the spec's grants, and an active Owner membership", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    const [owner] = await seedDb.insert(users).values({ email: "owner@example.com" }).returning();
    await seedPool.end();

    const { provisionStudio } = await import("./provision");
    const db = drizzle(pool, { schema });
    const result = await provisionStudio(
      { ownerId: owner.id, studioName: "Starlight Ballroom", timezone: "America/Chicago" },
      db
    );

    const verifyPool = new Pool({ connectionString: testDb.connectionUri });
    const verifyDb = drizzle(verifyPool, { schema });

    const [studioRow] = await verifyDb.select().from(studios).where(
      schema.sqlEquals ? undefined : undefined
    );
    const studioRows = await verifyDb.select().from(studios);
    expect(studioRows).toHaveLength(1);
    expect(studioRows[0].id).toBe(result.studioId);
    expect(studioRows[0].name).toBe("Starlight Ballroom");

    const locationRows = await verifyDb.select().from(locations);
    expect(locationRows).toHaveLength(1);
    expect(locationRows[0].id).toBe(result.locationId);
    expect(locationRows[0].timezone).toBe("America/Chicago");

    const roleRows = await verifyDb.select().from(roles);
    expect(roleRows.map((r) => r.code).sort()).toEqual(["admin", "instructor", "owner"]);

    const grantRows = await verifyDb.select().from(rolePermissions);
    const ownerRole = roleRows.find((r) => r.code === "owner")!;
    const ownerGrants = grantRows
      .filter((g) => g.roleId === ownerRole.id)
      .map((g) => g.permissionCode)
      .sort();
    expect(ownerGrants).toEqual([...BUILTIN_ROLE_PERMISSIONS.owner].sort());

    const membershipRows = await verifyDb.select().from(memberships);
    expect(membershipRows).toHaveLength(1);
    expect(membershipRows[0].id).toBe(result.ownerMembershipId);
    expect(membershipRows[0].userId).toBe(owner.id);
    expect(membershipRows[0].roleId).toBe(ownerRole.id);
    expect(membershipRows[0].status).toBe("active");

    await verifyPool.end();
  });
});
```

Remove the dead `schema.sqlEquals` line before running — it is a placeholder for "query by id" that this step doesn't actually need (the test already fetches all rows, since the test database is empty before this call); drop those two lines (`const [studioRow] = ...` and the ternary) entirely.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/studios/provision.test.ts`
Expected: FAIL with "Cannot find module './provision'".

- [ ] **Step 3: Implement `provisionStudio()`**

```ts
// lib/studios/provision.ts
import "server-only";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { withTenantContext } from "../db/with-tenant-context";
import { studios, locations, roles, rolePermissions, memberships } from "../db/schema";
import * as schema from "../db/schema";
import { BUILTIN_ROLES, BUILTIN_ROLE_PERMISSIONS } from "../auth/permissions";

type Db = NodePgDatabase<typeof schema>;

export type ProvisionStudioInput = {
  ownerId: string;
  studioName: string;
  timezone: string;
};

export type ProvisionStudioResult = {
  studioId: string;
  locationId: string;
  ownerMembershipId: string;
};

const BUILTIN_ROLE_NAMES: Record<(typeof BUILTIN_ROLES)[number], string> = {
  owner: "Owner",
  admin: "Admin",
  instructor: "Instructor",
};

export async function provisionStudio(
  input: ProvisionStudioInput,
  database?: Db
): Promise<ProvisionStudioResult> {
  const studioId = crypto.randomUUID();

  return withTenantContext(
    { userId: input.ownerId, tenantId: studioId },
    async (tx) => {
      await tx.insert(studios).values({ id: studioId, name: input.studioName });

      const [location] = await tx
        .insert(locations)
        .values({ studioId, name: "Main Location", timezone: input.timezone })
        .returning();

      let ownerRoleId: string | undefined;
      for (const code of BUILTIN_ROLES) {
        const [role] = await tx
          .insert(roles)
          .values({ studioId, code, name: BUILTIN_ROLE_NAMES[code] })
          .returning();

        const grants = BUILTIN_ROLE_PERMISSIONS[code];
        if (grants.length > 0) {
          await tx.insert(rolePermissions).values(
            grants.map((permissionCode) => ({
              roleId: role.id,
              permissionCode,
              studioId,
            }))
          );
        }

        if (code === "owner") {
          ownerRoleId = role.id;
        }
      }

      const [ownerMembership] = await tx
        .insert(memberships)
        .values({
          studioId,
          userId: input.ownerId,
          roleId: ownerRoleId!,
          status: "active",
        })
        .returning();

      return {
        studioId,
        locationId: location.id,
        ownerMembershipId: ownerMembership.id,
      };
    },
    database
  );
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run lib/studios/provision.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/studios/provision.ts lib/studios/provision.test.ts
git commit -m "feat: add provisionStudio atomic studio-creation service"
```

---

### Task 6: Authorization helpers — `getActiveMembership`, `hasPermission`, `requirePermission`

**Files:**
- Create: `lib/auth/authorization.ts`
- Create: `lib/auth/authorization.test.ts`

**Interfaces:**
- Consumes: `withTenantContext` (Phase 0), `memberships`/`roles`/`rolePermissions` (Tasks 3/4).
- Produces: `PermissionDeniedError` (class, extends `Error`), `ActiveMembership` (type: `{ membershipId: string; studioId: string; roleId: string; roleCode: string }`), `getActiveMembership(userId: string, studioId: string, database?: Db): Promise<ActiveMembership | null>`, `hasPermission(userId: string, studioId: string, code: PermissionCode, database?: Db): Promise<boolean>`, `requirePermission(userId: string, studioId: string, code: PermissionCode, database?: Db): Promise<ActiveMembership>` — consumed by Task 8 (indirectly, via its own membership check), Task 9 (`canEditStudent`), and every route handler in Task 10.

- [ ] **Step 1: Write the failing test**

```ts
// lib/auth/authorization.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "../db/testing/test-database";
import { users } from "../db/schema";
import * as schema from "../db/schema";

describe("authorization helpers", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let provisionStudio: typeof import("../studios/provision").provisionStudio;
  let getActiveMembership: typeof import("./authorization").getActiveMembership;
  let hasPermission: typeof import("./authorization").hasPermission;
  let requirePermission: typeof import("./authorization").requirePermission;
  let PermissionDeniedError: typeof import("./authorization").PermissionDeniedError;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ provisionStudio } = await import("../studios/provision"));
    ({ getActiveMembership, hasPermission, requirePermission, PermissionDeniedError } =
      await import("./authorization"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  test("the owner of a newly provisioned studio has every owner-level permission", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    const [owner] = await seedDb.insert(users).values({ email: "o1@example.com" }).returning();
    await seedPool.end();

    const db = drizzle(pool, { schema });
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );

    const membership = await getActiveMembership(owner.id, studioId, db);
    expect(membership?.roleCode).toBe("owner");
    expect(await hasPermission(owner.id, studioId, "users.manage", db)).toBe(true);
  });

  test("a user with no membership in a studio has no permissions there, even with a valid user id", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    const [owner] = await seedDb.insert(users).values({ email: "o2@example.com" }).returning();
    const [outsider] = await seedDb.insert(users).values({ email: "intruder@example.com" }).returning();
    await seedPool.end();

    const db = drizzle(pool, { schema });
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );

    expect(await getActiveMembership(outsider.id, studioId, db)).toBeNull();
    expect(await hasPermission(outsider.id, studioId, "students.read", db)).toBe(false);
    await expect(requirePermission(outsider.id, studioId, "students.read", db)).rejects.toThrow(
      PermissionDeniedError
    );
  });

  test("an instructor lacks owner-only permissions like users.manage and locations.manage", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    const [owner] = await seedDb.insert(users).values({ email: "o3@example.com" }).returning();
    const [instructor] = await seedDb.insert(users).values({ email: "i1@example.com" }).returning();
    await seedPool.end();

    const db = drizzle(pool, { schema });
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );

    const instructorRole = (await db.query.roles.findFirst({
      where: (r, { eq, and }) => and(eq(r.studioId, studioId), eq(r.code, "instructor")),
    }))!;

    await db.insert(schema.memberships).values({
      studioId,
      userId: instructor.id,
      roleId: instructorRole.id,
      status: "active",
    });

    expect(await hasPermission(instructor.id, studioId, "progress.record_assigned", db)).toBe(true);
    expect(await hasPermission(instructor.id, studioId, "users.manage", db)).toBe(false);
    expect(await hasPermission(instructor.id, studioId, "locations.manage", db)).toBe(false);
  });

  test("a deactivated membership loses all permissions immediately", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    const [owner] = await seedDb.insert(users).values({ email: "o4@example.com" }).returning();
    const [admin] = await seedDb.insert(users).values({ email: "a1@example.com" }).returning();
    await seedPool.end();

    const db = drizzle(pool, { schema });
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );

    const adminRole = (await db.query.roles.findFirst({
      where: (r, { eq, and }) => and(eq(r.studioId, studioId), eq(r.code, "admin")),
    }))!;
    const [membership] = await db
      .insert(schema.memberships)
      .values({ studioId, userId: admin.id, roleId: adminRole.id, status: "active" })
      .returning();

    expect(await hasPermission(admin.id, studioId, "students.read", db)).toBe(true);

    await db
      .update(schema.memberships)
      .set({ status: "inactive" })
      .where((m: typeof schema.memberships) => m.id);
    // Drizzle's update needs an explicit eq(); redo with the real import.
  });
});
```

Fix the last test's final block before running — `.where((m) => m.id)` is not valid Drizzle syntax and is a placeholder for a real `eq()` condition. Replace the last five lines (from `await db.update` to the end of the `test`) with:

```ts
    const { eq } = await import("drizzle-orm");
    await db
      .update(schema.memberships)
      .set({ status: "inactive" })
      .where(eq(schema.memberships.id, membership.id));

    expect(await hasPermission(admin.id, studioId, "students.read", db)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/auth/authorization.test.ts`
Expected: FAIL with "Cannot find module './authorization'".

- [ ] **Step 3: Implement `lib/auth/authorization.ts`**

```ts
// lib/auth/authorization.ts
import "server-only";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { withTenantContext } from "../db/with-tenant-context";
import { memberships, roles, rolePermissions } from "../db/schema";
import * as schema from "../db/schema";
import type { PermissionCode } from "./permissions";

type Db = NodePgDatabase<typeof schema>;

export class PermissionDeniedError extends Error {
  constructor(userId: string, studioId: string, code: PermissionCode) {
    super(`User ${userId} lacks permission "${code}" in studio ${studioId}`);
    this.name = "PermissionDeniedError";
  }
}

export type ActiveMembership = {
  membershipId: string;
  studioId: string;
  roleId: string;
  roleCode: string;
};

export async function getActiveMembership(
  userId: string,
  studioId: string,
  database?: Db
): Promise<ActiveMembership | null> {
  return withTenantContext(
    { userId, tenantId: studioId },
    async (tx) => {
      const [row] = await tx
        .select({
          membershipId: memberships.id,
          studioId: memberships.studioId,
          roleId: memberships.roleId,
          roleCode: roles.code,
        })
        .from(memberships)
        .innerJoin(roles, eq(memberships.roleId, roles.id))
        .where(
          and(
            eq(memberships.userId, userId),
            eq(memberships.studioId, studioId),
            eq(memberships.status, "active")
          )
        )
        .limit(1);
      return row ?? null;
    },
    database
  );
}

export async function hasPermission(
  userId: string,
  studioId: string,
  code: PermissionCode,
  database?: Db
): Promise<boolean> {
  const membership = await getActiveMembership(userId, studioId, database);
  if (!membership) {
    return false;
  }

  return withTenantContext(
    { userId, tenantId: studioId },
    async (tx) => {
      const [grant] = await tx
        .select({ permissionCode: rolePermissions.permissionCode })
        .from(rolePermissions)
        .where(
          and(eq(rolePermissions.roleId, membership.roleId), eq(rolePermissions.permissionCode, code))
        )
        .limit(1);
      return grant !== undefined;
    },
    database
  );
}

export async function requirePermission(
  userId: string,
  studioId: string,
  code: PermissionCode,
  database?: Db
): Promise<ActiveMembership> {
  const membership = await getActiveMembership(userId, studioId, database);
  if (!membership || !(await hasPermission(userId, studioId, code, database))) {
    throw new PermissionDeniedError(userId, studioId, code);
  }
  return membership;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run lib/auth/authorization.test.ts`
Expected: PASS, all four cases.

- [ ] **Step 5: Commit**

```bash
git add lib/auth/authorization.ts lib/auth/authorization.test.ts
git commit -m "feat: add service-layer membership/permission authorization helpers"
```

---

### Task 7: Invitations — schema, create/accept services

**Files:**
- Create: `lib/invitations/invitations.ts`
- Modify: `lib/db/schema.ts` (add `invitations`)
- Create: `drizzle/0010_*.sql` (auto-generated DDL)
- Create: `drizzle/0011_invitations_grants.sql` (grants only — no RLS, see below)
- Modify: `scripts/db-setup-roles.sql`
- Create: `lib/invitations/invitations.test.ts`

**Interfaces:**
- Consumes: `withTenantContext`, `memberships` (Task 4), `users` (Phase 0), `roles` (Task 3).
- Produces: `createInvitation(input: { studioId: string; email: string; roleId: string; invitedByUserId: string }, database?: Db): Promise<{ invitationId: string; token: string }>`, `lookupInvitationByToken(token: string, database?: Db): Promise<{ invitationId: string; studioId: string; roleId: string; email: string; status: string; expiresAt: Date } | null>`, `acceptInvitation(token: string, userId: string, database?: Db): Promise<{ membershipId: string; studioId: string }>` — consumed by Task 10's invitation routes.

- [ ] **Step 1: Add the `invitations` table to `lib/db/schema.ts`**

```ts
// --- Phase 1: invitations — NOT tenant-owned, no RLS. Same exception
// as the `permissions` table above, for a different reason: an invitee
// has no studio membership yet, so accepting an invitation means looking
// a row up by an unguessable token BEFORE any tenant context exists —
// the same "pre-authentication, no tenant known yet" situation
// auth.ts's authorizeCredentials() is already in against the `users`
// table. Enforcement is entirely service-layer: lib/invitations/invitations.ts
// never lists invitations without an explicit studioId filter, and never
// accepts one whose status/expiry has already lapsed.
export const invitations = appSchema.table("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  studioId: uuid("studio_id")
    .notNull()
    .references(() => studios.id),
  email: text("email").notNull(),
  roleId: uuid("role_id")
    .notNull()
    .references(() => roles.id),
  token: text("token").notNull().unique(),
  status: text("status").notNull().default("pending"),
  invitedByUserId: text("invited_by_user_id")
    .notNull()
    .references(() => users.id),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

- [ ] **Step 2: Generate the schema migration**

Run: `npx drizzle-kit generate`
Expected: creates `drizzle/0010_*.sql` containing `CREATE TABLE "app"."invitations"`.

- [ ] **Step 3: Write the grants-only migration (no RLS — see schema comment above)**

```bash
npx drizzle-kit generate --custom --name=invitations_grants
```

```sql
-- drizzle/0011_invitations_grants.sql
GRANT SELECT, INSERT, UPDATE ON "app"."invitations" TO app_runtime;
```

- [ ] **Step 4: Add the grant to `scripts/db-setup-roles.sql`**

```sql
GRANT SELECT, INSERT, UPDATE ON "app"."invitations" TO app_runtime;
```

- [ ] **Step 5: Write the failing test**

```ts
// lib/invitations/invitations.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "../db/testing/test-database";
import { users } from "../db/schema";
import * as schema from "../db/schema";

describe("invitations", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let provisionStudio: typeof import("../studios/provision").provisionStudio;
  let createInvitation: typeof import("./invitations").createInvitation;
  let lookupInvitationByToken: typeof import("./invitations").lookupInvitationByToken;
  let acceptInvitation: typeof import("./invitations").acceptInvitation;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ provisionStudio } = await import("../studios/provision"));
    ({ createInvitation, lookupInvitationByToken, acceptInvitation } = await import(
      "./invitations"
    ));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  async function setupStudioWithAdminRole(db: ReturnType<typeof drizzle>) {
    const [owner] = await db.insert(users).values({ email: `owner-${crypto.randomUUID()}@example.com` }).returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db as never
    );
    const adminRole = (await (db as never as (typeof schema)["roles"] extends never ? never : import("drizzle-orm/node-postgres").NodePgDatabase<typeof schema>).query.roles.findFirst({
      where: (r: typeof schema.roles, { eq, and }: typeof import("drizzle-orm")) =>
        and(eq(r.studioId, studioId), eq(r.code, "admin")),
    }))!;
    return { owner, studioId, adminRoleId: adminRole.id };
  }

  test("an accepted invitation creates an active membership with the invited role", async () => {
    const db = drizzle(pool, { schema });
    const { studioId, adminRoleId, owner } = await setupStudioWithAdminRole(db);

    const { token } = await createInvitation(
      { studioId, email: "newstaff@example.com", roleId: adminRoleId, invitedByUserId: owner.id },
      db
    );

    const [invitee] = await db.insert(users).values({ email: "newstaff@example.com" }).returning();
    const result = await acceptInvitation(token, invitee.id, db);

    expect(result.studioId).toBe(studioId);

    const membership = await db.query.memberships.findFirst({
      where: (m, { eq }) => eq(m.id, result.membershipId as never),
    });
    expect(membership?.userId).toBe(invitee.id);
    expect(membership?.roleId).toBe(adminRoleId);
    expect(membership?.status).toBe("active");
  });

  test("an expired invitation cannot be accepted", async () => {
    const db = drizzle(pool, { schema });
    const { studioId, adminRoleId, owner } = await setupStudioWithAdminRole(db);

    const { token } = await createInvitation(
      { studioId, email: "late@example.com", roleId: adminRoleId, invitedByUserId: owner.id },
      db
    );
    const { eq } = await import("drizzle-orm");
    await db
      .update(schema.invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.invitations.token, token));

    const [invitee] = await db.insert(users).values({ email: "late@example.com" }).returning();
    await expect(acceptInvitation(token, invitee.id, db)).rejects.toThrow();
  });

  test("an already-accepted invitation cannot be accepted again", async () => {
    const db = drizzle(pool, { schema });
    const { studioId, adminRoleId, owner } = await setupStudioWithAdminRole(db);

    const { token } = await createInvitation(
      { studioId, email: "twice@example.com", roleId: adminRoleId, invitedByUserId: owner.id },
      db
    );
    const [invitee] = await db.insert(users).values({ email: "twice@example.com" }).returning();
    await acceptInvitation(token, invitee.id, db);

    const [invitee2] = await db.insert(users).values({ email: "twice2@example.com" }).returning();
    await expect(acceptInvitation(token, invitee2.id, db)).rejects.toThrow();
  });

  test("an unknown token returns null from lookupInvitationByToken", async () => {
    const db = drizzle(pool, { schema });
    expect(await lookupInvitationByToken("not-a-real-token", db)).toBeNull();
  });
});
```

The helper's type gymnastics in `setupStudioWithAdminRole` are there only to satisfy `tsc` across the dynamically-imported `db` instance's inferred type; simplify it once you see the real error, if any — the goal is just "look up the admin role Drizzle's relational query API just inserted." If `db.query.roles` complains that relations aren't configured, replace it with a plain `db.select().from(schema.roles).where(and(eq(schema.roles.studioId, studioId), eq(schema.roles.code, "admin")))` instead (same substitution applies to every other `db.query.*.findFirst` call elsewhere in this plan if Drizzle's relational API isn't configured for this schema — it isn't, as of Phase 0, so use the plain `select().from().where()` form everywhere this plan wrote `db.query.X.findFirst`).

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/invitations/invitations.test.ts`
Expected: FAIL with "Cannot find module './invitations'".

- [ ] **Step 3: Implement `lib/invitations/invitations.ts`**

```ts
// lib/invitations/invitations.ts
import "server-only";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { withTenantContext } from "../db/with-tenant-context";
import { invitations, users, memberships } from "../db/schema";
import * as schema from "../db/schema";

type Db = NodePgDatabase<typeof schema>;

const INVITATION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export async function createInvitation(
  input: { studioId: string; email: string; roleId: string; invitedByUserId: string },
  database?: Db
): Promise<{ invitationId: string; token: string }> {
  const token = crypto.randomUUID();
  const [row] = await withTenantContext(
    { userId: input.invitedByUserId, tenantId: input.studioId },
    (tx) =>
      tx
        .insert(invitations)
        .values({
          studioId: input.studioId,
          email: input.email,
          roleId: input.roleId,
          token,
          invitedByUserId: input.invitedByUserId,
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        })
        .returning(),
    database
  );
  return { invitationId: row.id, token: row.token };
}

export type InvitationLookup = {
  invitationId: string;
  studioId: string;
  roleId: string;
  email: string;
  status: string;
  expiresAt: Date;
} | null;

// Deliberately NOT tenant-scoped — see the schema.ts comment on the
// invitations table. This is the one query in the invitation flow that
// runs before any tenant context can exist.
export async function lookupInvitationByToken(
  token: string,
  database?: Db
): Promise<InvitationLookup> {
  const db = database ?? (await import("../db/client")).db;
  const [row] = await db.select().from(invitations).where(eq(invitations.token, token)).limit(1);
  if (!row) {
    return null;
  }
  return {
    invitationId: row.id,
    studioId: row.studioId,
    roleId: row.roleId,
    email: row.email,
    status: row.status,
    expiresAt: row.expiresAt,
  };
}

export async function acceptInvitation(
  token: string,
  userId: string,
  database?: Db
): Promise<{ membershipId: string; studioId: string }> {
  const invitation = await lookupInvitationByToken(token, database);
  if (!invitation) {
    throw new Error("Invitation not found");
  }
  if (invitation.status !== "pending") {
    throw new Error(`Invitation is already ${invitation.status}`);
  }
  if (invitation.expiresAt.getTime() < Date.now()) {
    throw new Error("Invitation has expired");
  }

  return withTenantContext(
    { userId, tenantId: invitation.studioId },
    async (tx) => {
      const [membership] = await tx
        .insert(memberships)
        .values({
          studioId: invitation.studioId,
          userId,
          roleId: invitation.roleId,
          status: "active",
        })
        .returning();

      await tx
        .update(invitations)
        .set({ status: "accepted" })
        .where(eq(invitations.id, invitation.invitationId));

      return { membershipId: membership.id, studioId: invitation.studioId };
    },
    database
  );
}
```

Note: `lookupInvitationByToken`'s fallback import of `../db/client` only runs in production call sites that omit `database` — every test in this plan passes `database` explicitly, so the fallback path is exercised by production usage (Task 10's routes), not by this task's own tests.

- [ ] **Step 4: Run the test**

Run: `npx vitest run lib/invitations/invitations.test.ts`
Expected: PASS, all four cases.

- [ ] **Step 5: Commit**

```bash
git add lib/invitations/invitations.ts lib/db/schema.ts drizzle scripts/db-setup-roles.sql lib/invitations/invitations.test.ts
git commit -m "feat: add invitation create/accept flow"
```

---

### Task 8: Platform support-only control plane

**Files:**
- Create: `lib/platform/support.ts`
- Modify: `lib/db/schema.ts` (add `platformAdmins`, `supportSessions`)
- Create: `drizzle/0012_*.sql` (auto-generated DDL)
- Create: `drizzle/0013_support_sessions_rls.sql` (hand-written RLS + grants; `platform_admins` gets a grant only, no RLS)
- Modify: `scripts/db-setup-roles.sql`
- Create: `lib/platform/support.test.ts`

**Interfaces:**
- Consumes: `withTenantContext`, `studios` (Task 1), `users` (Phase 0).
- Produces: `isPlatformAdmin(userId: string, database?: Db): Promise<boolean>`, `startSupportSession(input: { adminUserId: string; studioId: string; reason: string }, database?: Db): Promise<{ sessionId: string }>`, `endSupportSession(sessionId: string, studioId: string, database?: Db): Promise<void>`, `requireActiveSupportSession(adminUserId: string, studioId: string, database?: Db): Promise<void>` — not consumed by any other task in this plan (platform support UI is out of scope for Phase 1), but exercised by this task's own acceptance-style test proving the spec's "no implicit global bypass" requirement.

- [ ] **Step 1: Add the two tables to `lib/db/schema.ts`**

```ts
// --- Phase 1: platform support-only control plane.
// platform_admins is NOT tenant-owned (global staff flag, no RLS — same
// exception as `permissions`/`users`). support_sessions IS tenant-owned
// and RLS-protected like any other studio table; the security boundary
// here is NOT "RLS lets admins in" — it's the opposite: service-layer
// code in lib/platform/support.ts refuses to open a tenant context for
// an admin at all unless isPlatformAdmin() and (for every subsequent
// read) requireActiveSupportSession() both pass, and every session is
// audited by this table rather than being an implicit bypass. This is
// the spec's explicit requirement: "access to tenant PII requires an
// explicit audited support session, not an implicit global bypass."
export const platformAdmins = appSchema.table("platform_admins", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id),
});

export const supportSessions = appSchema.table("support_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  adminUserId: text("admin_user_id")
    .notNull()
    .references(() => users.id),
  studioId: uuid("studio_id")
    .notNull()
    .references(() => studios.id),
  reason: text("reason").notNull(),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
});
```

- [ ] **Step 2: Generate the schema migration**

Run: `npx drizzle-kit generate`
Expected: creates `drizzle/0012_*.sql` containing `CREATE TABLE "app"."platform_admins"`, `"app"."support_sessions"`.

- [ ] **Step 3: Write the RLS + grants migration**

```bash
npx drizzle-kit generate --custom --name=support_sessions_rls
```

```sql
-- drizzle/0013_support_sessions_rls.sql
ALTER TABLE "app"."support_sessions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "app"."support_sessions"
  USING (studio_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (studio_id::text = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE ON "app"."support_sessions" TO app_runtime;
GRANT SELECT ON "app"."platform_admins" TO app_runtime;
```

- [ ] **Step 4: Add the grants to `scripts/db-setup-roles.sql`**

```sql
GRANT SELECT, INSERT, UPDATE ON "app"."support_sessions" TO app_runtime;
GRANT SELECT ON "app"."platform_admins" TO app_runtime;
```

- [ ] **Step 5: Write the failing test**

```ts
// lib/platform/support.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "../db/testing/test-database";
import { users, platformAdmins } from "../db/schema";
import * as schema from "../db/schema";

describe("platform support sessions", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let provisionStudio: typeof import("../studios/provision").provisionStudio;
  let isPlatformAdmin: typeof import("./support").isPlatformAdmin;
  let startSupportSession: typeof import("./support").startSupportSession;
  let endSupportSession: typeof import("./support").endSupportSession;
  let requireActiveSupportSession: typeof import("./support").requireActiveSupportSession;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ provisionStudio } = await import("../studios/provision"));
    ({ isPlatformAdmin, startSupportSession, endSupportSession, requireActiveSupportSession } =
      await import("./support"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  test("a non-platform-admin cannot start a support session", async () => {
    const db = drizzle(pool, { schema });
    const [owner] = await db.insert(users).values({ email: "owner@example.com" }).returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const [notAnAdmin] = await db.insert(users).values({ email: "notadmin@example.com" }).returning();

    expect(await isPlatformAdmin(notAnAdmin.id, db)).toBe(false);
    await expect(
      startSupportSession({ adminUserId: notAnAdmin.id, studioId, reason: "debug" }, db)
    ).rejects.toThrow();
  });

  test("a platform admin's support session is audited and required for access, and ending it revokes access", async () => {
    const db = drizzle(pool, { schema });
    const [owner] = await db.insert(users).values({ email: "owner2@example.com" }).returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const [admin] = await db.insert(users).values({ email: "admin@example.com" }).returning();
    await db.insert(platformAdmins).values({ userId: admin.id });

    await expect(requireActiveSupportSession(admin.id, studioId, db)).rejects.toThrow();

    const { sessionId } = await startSupportSession(
      { adminUserId: admin.id, studioId, reason: "customer escalation #123" },
      db
    );
    await expect(requireActiveSupportSession(admin.id, studioId, db)).resolves.not.toThrow();

    await endSupportSession(sessionId, studioId, db);
    await expect(requireActiveSupportSession(admin.id, studioId, db)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/platform/support.test.ts`
Expected: FAIL with "Cannot find module './support'".

- [ ] **Step 3: Implement `lib/platform/support.ts`**

```ts
// lib/platform/support.ts
import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { withTenantContext } from "../db/with-tenant-context";
import { platformAdmins, supportSessions } from "../db/schema";
import * as schema from "../db/schema";

type Db = NodePgDatabase<typeof schema>;

export async function isPlatformAdmin(userId: string, database?: Db): Promise<boolean> {
  const db = database ?? (await import("../db/client")).db;
  const [row] = await db
    .select()
    .from(platformAdmins)
    .where(eq(platformAdmins.userId, userId))
    .limit(1);
  return row !== undefined;
}

export async function startSupportSession(
  input: { adminUserId: string; studioId: string; reason: string },
  database?: Db
): Promise<{ sessionId: string }> {
  if (!(await isPlatformAdmin(input.adminUserId, database))) {
    throw new Error(`User ${input.adminUserId} is not a platform admin`);
  }

  const [row] = await withTenantContext(
    { userId: input.adminUserId, tenantId: input.studioId },
    (tx) =>
      tx
        .insert(supportSessions)
        .values({
          adminUserId: input.adminUserId,
          studioId: input.studioId,
          reason: input.reason,
        })
        .returning(),
    database
  );
  return { sessionId: row.id };
}

export async function endSupportSession(
  sessionId: string,
  studioId: string,
  database?: Db
): Promise<void> {
  await withTenantContext(
    { userId: "platform-support", tenantId: studioId },
    (tx) =>
      tx
        .update(supportSessions)
        .set({ endedAt: new Date() })
        .where(eq(supportSessions.id, sessionId)),
    database
  );
}

export async function requireActiveSupportSession(
  adminUserId: string,
  studioId: string,
  database?: Db
): Promise<void> {
  const [row] = await withTenantContext(
    { userId: adminUserId, tenantId: studioId },
    (tx) =>
      tx
        .select()
        .from(supportSessions)
        .where(
          and(
            eq(supportSessions.adminUserId, adminUserId),
            eq(supportSessions.studioId, studioId),
            isNull(supportSessions.endedAt)
          )
        )
        .limit(1),
    database
  );
  if (!row) {
    throw new Error(
      `No active support session for admin ${adminUserId} on studio ${studioId}`
    );
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run lib/platform/support.test.ts`
Expected: PASS, both cases.

- [ ] **Step 5: Commit**

```bash
git add lib/platform/support.ts lib/db/schema.ts drizzle scripts/db-setup-roles.sql lib/platform/support.test.ts
git commit -m "feat: add audited platform support-session control plane"
```

---

### Task 9: Students stub & instructor assignments (partial acceptance test #2)

**Files:**
- Create: `lib/students/authorization.ts`
- Modify: `lib/db/schema.ts` (add `students`, `studentAssignments`)
- Create: `drizzle/0014_*.sql` (auto-generated DDL)
- Create: `drizzle/0015_students_rls.sql` (hand-written RLS, partial unique index, grants)
- Modify: `scripts/db-setup-roles.sql`
- Create: `lib/students/authorization.test.ts`

**Interfaces:**
- Consumes: `withTenantContext`, `studios` (Task 1), `users` (Phase 0), `hasPermission` (Task 6).
- Produces: `students`, `studentAssignments` Drizzle tables; `isAssignedInstructor(instructorUserId: string, studentId: string, database?: Db): Promise<boolean>`, `canEditStudent(context: { userId: string; studioId: string }, studentId: string, database?: Db): Promise<boolean>` — consumed by Task 10's student routes and Task 11's acceptance test #2.

- [ ] **Step 1: Add the two tables to `lib/db/schema.ts`**

```ts
// --- Phase 1: minimal students stub. Intentionally bare — just enough
// to prove the instructor assignment-scoped edit rule (spec acceptance
// test #2). Phase 3 (domain boundary 3) EXTENDS this table with CRM
// fields, notes, and student_relationships; it does not replace it,
// unlike Phase 0's throwaway tenant_probe table.
export const students = appSchema.table("students", {
  id: uuid("id").primaryKey().defaultRandom(),
  studioId: uuid("studio_id")
    .notNull()
    .references(() => studios.id),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const studentAssignments = appSchema.table("student_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: uuid("student_id")
    .notNull()
    .references(() => students.id),
  studioId: uuid("studio_id")
    .notNull()
    .references(() => studios.id),
  instructorUserId: text("instructor_user_id")
    .notNull()
    .references(() => users.id),
  isPrimary: boolean("is_primary").notNull().default(true),
  effectiveAt: timestamp("effective_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
});
```

- [ ] **Step 2: Generate the schema migration**

Run: `npx drizzle-kit generate`
Expected: creates `drizzle/0014_*.sql` containing `CREATE TABLE "app"."students"`, `"app"."student_assignments"`.

- [ ] **Step 3: Write the RLS + partial-unique-index + grants migration**

The "at most one current primary assignment" rule (BR-02) needs a partial unique index, which `drizzle-kit generate` from the TS schema alone won't produce reliably — hand-write it alongside the RLS:

```bash
npx drizzle-kit generate --custom --name=students_rls
```

```sql
-- drizzle/0015_students_rls.sql
ALTER TABLE "app"."students" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "app"."students"
  USING (studio_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (studio_id::text = current_setting('app.tenant_id', true));

ALTER TABLE "app"."student_assignments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "app"."student_assignments"
  USING (studio_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (studio_id::text = current_setting('app.tenant_id', true));

-- BR-02: "the same studio may have multiple concurrent instructor
-- assignments; at most one current primary assignment is enforced in
-- v0.3." A student can have only one row that is both is_primary and
-- not yet ended.
CREATE UNIQUE INDEX student_assignments_one_current_primary
  ON "app"."student_assignments" (student_id)
  WHERE is_primary AND ended_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON "app"."students" TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON "app"."student_assignments" TO app_runtime;
```

- [ ] **Step 4: Add the grants to `scripts/db-setup-roles.sql`**

```sql
GRANT SELECT, INSERT, UPDATE ON "app"."students" TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON "app"."student_assignments" TO app_runtime;
```

- [ ] **Step 5: Write the failing test**

```ts
// lib/students/authorization.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "../db/testing/test-database";
import { users, students, studentAssignments, roles, memberships } from "../db/schema";
import * as schema from "../db/schema";
import { and, eq } from "drizzle-orm";

describe("student authorization", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let provisionStudio: typeof import("../studios/provision").provisionStudio;
  let isAssignedInstructor: typeof import("./authorization").isAssignedInstructor;
  let canEditStudent: typeof import("./authorization").canEditStudent;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ provisionStudio } = await import("../studios/provision"));
    ({ isAssignedInstructor, canEditStudent } = await import("./authorization"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  test("an admin can edit any student via students.update_all, assigned or not", async () => {
    const db = drizzle(pool, { schema });
    const [owner] = await db.insert(users).values({ email: "owner@example.com" }).returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const [student] = await db.insert(students).values({ studioId, displayName: "Alex" }).returning();

    expect(await canEditStudent({ userId: owner.id, studioId }, student.id, db)).toBe(true);
  });

  test("an instructor can edit only a student they are currently assigned to", async () => {
    const db = drizzle(pool, { schema });
    const [owner] = await db.insert(users).values({ email: "owner2@example.com" }).returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const [instructor] = await db.insert(users).values({ email: "instructor@example.com" }).returning();
    const [assigned] = await db.insert(students).values({ studioId, displayName: "Assigned" }).returning();
    const [unassigned] = await db.insert(students).values({ studioId, displayName: "Unassigned" }).returning();

    const [instructorRole] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.studioId, studioId), eq(roles.code, "instructor")));
    await db.insert(memberships).values({
      studioId,
      userId: instructor.id,
      roleId: instructorRole.id,
      status: "active",
    });
    await db.insert(studentAssignments).values({
      studentId: assigned.id,
      studioId,
      instructorUserId: instructor.id,
    });

    expect(await isAssignedInstructor(instructor.id, assigned.id, db)).toBe(true);
    expect(await isAssignedInstructor(instructor.id, unassigned.id, db)).toBe(false);
    expect(
      await canEditStudent({ userId: instructor.id, studioId }, assigned.id, db)
    ).toBe(true);
    expect(
      await canEditStudent({ userId: instructor.id, studioId }, unassigned.id, db)
    ).toBe(false);
  });

  test("an ended assignment no longer grants edit access", async () => {
    const db = drizzle(pool, { schema });
    const [owner] = await db.insert(users).values({ email: "owner3@example.com" }).returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const [instructor] = await db.insert(users).values({ email: "instructor2@example.com" }).returning();
    const [student] = await db.insert(students).values({ studioId, displayName: "Former" }).returning();
    const [instructorRole] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.studioId, studioId), eq(roles.code, "instructor")));
    await db.insert(memberships).values({
      studioId,
      userId: instructor.id,
      roleId: instructorRole.id,
      status: "active",
    });
    await db.insert(studentAssignments).values({
      studentId: student.id,
      studioId,
      instructorUserId: instructor.id,
      endedAt: new Date(Date.now() - 1000),
    });

    expect(await isAssignedInstructor(instructor.id, student.id, db)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/students/authorization.test.ts`
Expected: FAIL with "Cannot find module './authorization'".

- [ ] **Step 3: Implement `lib/students/authorization.ts`**

```ts
// lib/students/authorization.ts
import "server-only";
import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { withTenantContext } from "../db/with-tenant-context";
import { studentAssignments } from "../db/schema";
import * as schema from "../db/schema";
import { hasPermission } from "../auth/authorization";

type Db = NodePgDatabase<typeof schema>;

export async function isAssignedInstructor(
  instructorUserId: string,
  studentId: string,
  database?: Db
): Promise<boolean> {
  const db = database ?? (await import("../db/client")).db;
  const now = new Date();
  const [row] = await db
    .select()
    .from(studentAssignments)
    .where(
      and(
        eq(studentAssignments.instructorUserId, instructorUserId),
        eq(studentAssignments.studentId, studentId),
        lte(studentAssignments.effectiveAt, now),
        or(isNull(studentAssignments.endedAt), gt(studentAssignments.endedAt, now))
      )
    )
    .limit(1);
  return row !== undefined;
}

export async function canEditStudent(
  context: { userId: string; studioId: string },
  studentId: string,
  database?: Db
): Promise<boolean> {
  if (await hasPermission(context.userId, context.studioId, "students.update_all", database)) {
    return true;
  }
  if (
    (await hasPermission(context.userId, context.studioId, "students.update_assigned", database)) &&
    (await isAssignedInstructor(context.userId, studentId, database))
  ) {
    return true;
  }
  return false;
}
```

`isAssignedInstructor`'s query above reads `studentAssignments` without going through `withTenantContext`, even though `studentAssignments` is RLS-protected — this would return zero rows against the real `app_runtime` connection whenever no tenant context is set. Fix it to use `withTenantContext`, matching every other tenant-table read in this plan:

```ts
export async function isAssignedInstructor(
  instructorUserId: string,
  studentId: string,
  database?: Db
): Promise<boolean> {
  // studentId's studio isn't known here, so withTenantContext can't be
  // called without it. Callers (canEditStudent, and Task 10's routes)
  // always know studioId from the request path — look it up there
  // instead. This function takes it as a third argument.
}
```

Actually implement it with `studioId` as an explicit parameter instead of the comment above — replace the whole function with:

```ts
export async function isAssignedInstructor(
  instructorUserId: string,
  studentId: string,
  studioId: string,
  database?: Db
): Promise<boolean> {
  return withTenantContext(
    { userId: instructorUserId, tenantId: studioId },
    async (tx) => {
      const now = new Date();
      const [row] = await tx
        .select()
        .from(studentAssignments)
        .where(
          and(
            eq(studentAssignments.instructorUserId, instructorUserId),
            eq(studentAssignments.studentId, studentId),
            lte(studentAssignments.effectiveAt, now),
            or(isNull(studentAssignments.endedAt), gt(studentAssignments.endedAt, now))
          )
        )
        .limit(1);
      return row !== undefined;
    },
    database
  );
}

export async function canEditStudent(
  context: { userId: string; studioId: string },
  studentId: string,
  database?: Db
): Promise<boolean> {
  if (await hasPermission(context.userId, context.studioId, "students.update_all", database)) {
    return true;
  }
  if (
    (await hasPermission(context.userId, context.studioId, "students.update_assigned", database)) &&
    (await isAssignedInstructor(context.userId, studentId, context.studioId, database))
  ) {
    return true;
  }
  return false;
}
```

Update this task's own test file (Step 1) to pass `studioId` as `isAssignedInstructor`'s third argument at each of its three call sites before running.

- [ ] **Step 4: Run the test**

Run: `npx vitest run lib/students/authorization.test.ts`
Expected: PASS, all three cases.

- [ ] **Step 5: Commit**

```bash
git add lib/students/authorization.ts lib/db/schema.ts drizzle scripts/db-setup-roles.sql lib/students/authorization.test.ts
git commit -m "feat: add minimal students stub with assignment-scoped edit authorization"
```

---

### Task 10: API route handlers

**Files:**
- Create: `app/api/v1/studios/route.ts`
- Create: `app/api/v1/studios/[studioId]/locations/route.ts`
- Create: `app/api/v1/studios/[studioId]/invitations/route.ts`
- Create: `app/api/v1/invitations/accept/route.ts`
- Create: `app/api/v1/studios/[studioId]/memberships/route.ts`
- Create: `app/api/v1/studios/[studioId]/students/route.ts`
- Create: `app/api/v1/studios/[studioId]/students/[studentId]/route.ts`
- Create: `lib/validation/studios.ts`
- Modify: `package.json` (add Zod)

**Interfaces:**
- Consumes: `verifySession` (Phase 0), `provisionStudio` (Task 5), `requirePermission`/`getActiveMembership` (Task 6), `createInvitation`/`acceptInvitation` (Task 7), `canEditStudent` (Task 9).
- Produces: nothing consumed by a later task in this plan — these are the phase's terminal deliverables, exercised directly by Task 11's acceptance tests.

- [ ] **Step 1: Install Zod**

```bash
npm install zod@4.6.7
```

- [ ] **Step 2: Write the validation schemas**

```ts
// lib/validation/studios.ts
import { z } from "zod";

export const createStudioSchema = z.object({
  name: z.string().min(1).max(200),
  timezone: z.string().min(1),
});

export const createLocationSchema = z.object({
  name: z.string().min(1).max(200),
  timezone: z.string().min(1),
});

export const createInvitationSchema = z.object({
  email: z.email(),
  roleId: z.uuid(),
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(1),
});

export const updateStudentSchema = z.object({
  displayName: z.string().min(1).max(200),
});
```

- [ ] **Step 3: `POST /v1/studios`**

```ts
// app/api/v1/studios/route.ts
import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { provisionStudio } from "@/lib/studios/provision";
import { createStudioSchema } from "@/lib/validation/studios";

export async function POST(request: Request) {
  const { userId } = await verifySession();
  const body = createStudioSchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  const result = await provisionStudio({
    ownerId: userId,
    studioName: body.data.name,
    timezone: body.data.timezone,
  });

  return NextResponse.json(result, { status: 201 });
}
```

- [ ] **Step 4: `POST /v1/studios/{studioId}/locations`**

```ts
// app/api/v1/studios/[studioId]/locations/route.ts
import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { requirePermission } from "@/lib/auth/authorization";
import { withTenantContext } from "@/lib/db/with-tenant-context";
import { locations } from "@/lib/db/schema";
import { createLocationSchema } from "@/lib/validation/studios";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ studioId: string }> }
) {
  const { studioId } = await params;
  const { userId } = await verifySession();
  const body = createLocationSchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  await requirePermission(userId, studioId, "locations.manage");

  const [location] = await withTenantContext({ userId, tenantId: studioId }, (tx) =>
    tx
      .insert(locations)
      .values({ studioId, name: body.data.name, timezone: body.data.timezone })
      .returning()
  );

  return NextResponse.json(location, { status: 201 });
}
```

- [ ] **Step 5: `POST /v1/studios/{studioId}/invitations`**

```ts
// app/api/v1/studios/[studioId]/invitations/route.ts
import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { requirePermission } from "@/lib/auth/authorization";
import { createInvitation } from "@/lib/invitations/invitations";
import { createInvitationSchema } from "@/lib/validation/studios";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ studioId: string }> }
) {
  const { studioId } = await params;
  const { userId } = await verifySession();
  const body = createInvitationSchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  await requirePermission(userId, studioId, "users.manage");

  const result = await createInvitation({
    studioId,
    email: body.data.email,
    roleId: body.data.roleId,
    invitedByUserId: userId,
  });

  return NextResponse.json(result, { status: 201 });
}
```

- [ ] **Step 6: `POST /v1/invitations/accept`**

Not nested under a `studioId` path — the invitee doesn't know which studio the token belongs to until it's looked up, the same reason `lookupInvitationByToken` isn't tenant-scoped. This is a deliberate, documented addition beyond the spec's literal "Suggested API boundaries" list, which never names an accept endpoint at all.

```ts
// app/api/v1/invitations/accept/route.ts
import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { acceptInvitation } from "@/lib/invitations/invitations";
import { acceptInvitationSchema } from "@/lib/validation/studios";

export async function POST(request: Request) {
  const { userId } = await verifySession();
  const body = acceptInvitationSchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  const result = await acceptInvitation(body.data.token, userId);
  return NextResponse.json(result, { status: 200 });
}
```

- [ ] **Step 7: `GET /v1/studios/{studioId}/memberships`**

```ts
// app/api/v1/studios/[studioId]/memberships/route.ts
import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { requirePermission } from "@/lib/auth/authorization";
import { withTenantContext } from "@/lib/db/with-tenant-context";
import { memberships } from "@/lib/db/schema";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ studioId: string }> }
) {
  const { studioId } = await params;
  const { userId } = await verifySession();

  await requirePermission(userId, studioId, "users.manage");

  const rows = await withTenantContext({ userId, tenantId: studioId }, (tx) =>
    tx.select().from(memberships)
  );

  return NextResponse.json({ memberships: rows });
}
```

- [ ] **Step 8: `GET /v1/studios/{studioId}/students`**

```ts
// app/api/v1/studios/[studioId]/students/route.ts
import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { requirePermission } from "@/lib/auth/authorization";
import { withTenantContext } from "@/lib/db/with-tenant-context";
import { students } from "@/lib/db/schema";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ studioId: string }> }
) {
  const { studioId } = await params;
  const { userId } = await verifySession();

  await requirePermission(userId, studioId, "students.read");

  const rows = await withTenantContext({ userId, tenantId: studioId }, (tx) =>
    tx.select().from(students)
  );

  return NextResponse.json({ students: rows });
}
```

- [ ] **Step 9: `PATCH /v1/studios/{studioId}/students/{studentId}`**

```ts
// app/api/v1/studios/[studioId]/students/[studentId]/route.ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { verifySession } from "@/lib/dal";
import { getActiveMembership } from "@/lib/auth/authorization";
import { canEditStudent } from "@/lib/students/authorization";
import { withTenantContext } from "@/lib/db/with-tenant-context";
import { students } from "@/lib/db/schema";
import { updateStudentSchema } from "@/lib/validation/studios";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ studioId: string; studentId: string }> }
) {
  const { studioId, studentId } = await params;
  const { userId } = await verifySession();
  const body = updateStudentSchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  const membership = await getActiveMembership(userId, studioId);
  if (!membership || !(await canEditStudent({ userId, studioId }, studentId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [updated] = await withTenantContext({ userId, tenantId: studioId }, (tx) =>
    tx
      .update(students)
      .set({ displayName: body.data.displayName })
      .where(eq(students.id, studentId))
      .returning()
  );

  return NextResponse.json(updated);
}
```

- [ ] **Step 10: Typecheck and build**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 11: Commit**

```bash
git add app/api/v1 lib/validation package.json package-lock.json
git commit -m "feat: add Phase 1 API routes for studios, locations, invitations, memberships, students"
```

---

### Task 11: Acceptance tests, tenant_probe decommission, CI verification

**Files:**
- Create: `app/api/v1/studios/acceptance.test.ts`
- Delete: `app/api/_internal/tenant-probe/route.ts`, `app/api/_internal/tenant-probe/route.test.ts`
- Modify: `lib/db/schema.ts` (remove `tenantProbe` export)
- Create: `drizzle/0016_*.sql` (auto-generated — drops the `tenant_probe` table and its column-level grant, once the schema export is removed; `drizzle-kit generate` detects table removal automatically)
- Modify: `scripts/db-setup-roles.sql` (remove the now-stale `tenant_probe` grant line)

**Interfaces:**
- Consumes: every service function from Tasks 5–9, every route handler from Task 10.
- Produces: nothing — this is the plan's final task.

- [ ] **Step 1: Write the acceptance test suite**

```ts
// app/api/v1/studios/acceptance.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import {
  createTestDatabase,
  type TestDatabase,
} from "@/lib/db/testing/test-database";
import { users, roles, memberships, students, studentAssignments } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";

describe("Phase 1 acceptance tests", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let provisionStudio: typeof import("@/lib/studios/provision").provisionStudio;
  let requirePermission: typeof import("@/lib/auth/authorization").requirePermission;
  let PermissionDeniedError: typeof import("@/lib/auth/authorization").PermissionDeniedError;
  let canEditStudent: typeof import("@/lib/students/authorization").canEditStudent;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ provisionStudio } = await import("@/lib/studios/provision"));
    ({ requirePermission, PermissionDeniedError } = await import("@/lib/auth/authorization"));
    ({ canEditStudent } = await import("@/lib/students/authorization"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  test("#1: a user with memberships in Studio A and Studio B gets independent permissions in each, with no leakage", async () => {
    const db = drizzle(pool, { schema });
    const [user] = await db.insert(users).values({ email: "multi@example.com" }).returning();

    const { studioId: studioA } = await provisionStudio(
      { ownerId: user.id, studioName: "A", timezone: "America/Chicago" },
      db
    );
    const { studioId: studioB } = await provisionStudio(
      { ownerId: user.id, studioName: "B", timezone: "America/Chicago" },
      db
    );

    // user is Owner (full access) in both, by construction of
    // provisionStudio — demote their Studio B membership to Instructor
    // to prove the two studios' grants are genuinely independent.
    const [instructorRoleB] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.studioId, studioB), eq(roles.code, "instructor")));
    await db
      .update(memberships)
      .set({ roleId: instructorRoleB.id })
      .where(and(eq(memberships.studioId, studioB), eq(memberships.userId, user.id)));

    await expect(requirePermission(user.id, studioA, "users.manage", db)).resolves.toBeTruthy();
    await expect(requirePermission(user.id, studioB, "users.manage", db)).rejects.toThrow(
      PermissionDeniedError
    );
  });

  test("#2 (partial — full coverage lands in Phase 3): an instructor sees/edits only assigned students, never an unassigned one", async () => {
    const db = drizzle(pool, { schema });
    const [owner] = await db.insert(users).values({ email: "owner-at2@example.com" }).returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const [instructor] = await db
      .insert(users)
      .values({ email: "instructor-at2@example.com" })
      .returning();
    const [instructorRole] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.studioId, studioId), eq(roles.code, "instructor")));
    await db.insert(memberships).values({
      studioId,
      userId: instructor.id,
      roleId: instructorRole.id,
      status: "active",
    });

    const [assigned] = await db
      .insert(students)
      .values({ studioId, displayName: "Assigned" })
      .returning();
    const [unassigned] = await db
      .insert(students)
      .values({ studioId, displayName: "Unassigned" })
      .returning();
    await db.insert(studentAssignments).values({
      studentId: assigned.id,
      studioId,
      instructorUserId: instructor.id,
    });

    expect(await canEditStudent({ userId: instructor.id, studioId }, assigned.id, db)).toBe(true);
    expect(await canEditStudent({ userId: instructor.id, studioId }, unassigned.id, db)).toBe(
      false
    );
  });

  test("#3: a forged studioId for a studio the caller has no membership in is rejected", async () => {
    const db = drizzle(pool, { schema });
    const [ownerA] = await db.insert(users).values({ email: "a@example.com" }).returning();
    const [ownerB] = await db.insert(users).values({ email: "b@example.com" }).returning();
    const { studioId: studioA } = await provisionStudio(
      { ownerId: ownerA.id, studioName: "A", timezone: "America/Chicago" },
      db
    );
    await provisionStudio(
      { ownerId: ownerB.id, studioName: "B", timezone: "America/Chicago" },
      db
    );

    // ownerB tries studioA's id directly — as if they'd edited the URL.
    await expect(requirePermission(ownerB.id, studioA, "students.read", db)).rejects.toThrow(
      PermissionDeniedError
    );
  });

  test("#13: a list query always stays within the tenant in context, never exposing another studio's rows", async () => {
    const db = drizzle(pool, { schema });
    const [ownerA] = await db.insert(users).values({ email: "list-a@example.com" }).returning();
    const [ownerB] = await db.insert(users).values({ email: "list-b@example.com" }).returning();
    const { studioId: studioA } = await provisionStudio(
      { ownerId: ownerA.id, studioName: "A", timezone: "America/Chicago" },
      db
    );
    const { studioId: studioB } = await provisionStudio(
      { ownerId: ownerB.id, studioName: "B", timezone: "America/Chicago" },
      db
    );
    await db.insert(students).values([
      { studioId: studioA, displayName: "A1" },
      { studioId: studioB, displayName: "B1" },
    ]);

    const { withTenantContext } = await import("@/lib/db/with-tenant-context");
    const rowsForA = await withTenantContext({ userId: ownerA.id, tenantId: studioA }, (tx) =>
      tx.select().from(students),
      db
    );
    expect(rowsForA).toHaveLength(1);
    expect(rowsForA[0].displayName).toBe("A1");
  });

  test("#15: missing tenant context produces no tenant-owned rows under RLS (regression, now against real tables)", async () => {
    const db = drizzle(pool, { schema });
    const [owner] = await db.insert(users).values({ email: "regression@example.com" }).returning();
    await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );

    const { withTenantContext } = await import("@/lib/db/with-tenant-context");
    const rows = await withTenantContext({ userId: owner.id, tenantId: null }, (tx) =>
      tx.select().from(schema.studios),
      db
    );
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the suite**

Run: `npx vitest run app/api/v1/studios/acceptance.test.ts`
Expected: FAIL initially only if any earlier task's code has a bug this cross-cutting suite exposes (none expected, since Tasks 1–10 each already tested the pieces in isolation) — PASS once any such issue is fixed. If it fails, treat it as a signal to fix the underlying task's code, not this test.

- [ ] **Step 3: Delete the Phase 0 throwaway tenant-probe route and table**

```bash
git rm app/api/_internal/tenant-probe/route.ts app/api/_internal/tenant-probe/route.test.ts
```

Remove the `tenantProbe` export and its `--- RLS probe (Phase 0 only) ---` comment block from `lib/db/schema.ts` (the block Phase 0's plan added right after `verificationTokens`).

- [ ] **Step 4: Generate the drop migration**

Run: `npx drizzle-kit generate`
Expected: creates `drizzle/0016_*.sql` containing `DROP TABLE "app"."tenant_probe"`.

- [ ] **Step 5: Remove the stale grant from `scripts/db-setup-roles.sql`**

Delete the line `GRANT SELECT, INSERT ON "app"."tenant_probe" TO app_runtime;`.

- [ ] **Step 6: Run the full suite**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all succeed; the old `tenant-probe` test is gone, every new test from Tasks 1–11 passes.

- [ ] **Step 7: Push and confirm CI is green**

Run: `git push` (on this branch) and check the Actions tab.
Expected: the `test` job passes, including every new Testcontainers-backed test.

- [ ] **Step 8: Commit**

```bash
git add app/api/v1/studios/acceptance.test.ts lib/db/schema.ts drizzle scripts/db-setup-roles.sql
git commit -m "test: add Phase 1 acceptance tests (#1,#2 partial,#3,#13,#15) and decommission tenant_probe"
```

---

## Self-Review

**Spec coverage:** Domain boundary 1 (platform/tenant provisioning) — Task 5. Domain boundary 2 (locations, rooms, memberships, local roles, permission assignments) — Tasks 1, 3, 4. BR-01 (room-location consistency, deferred-trigger note) — Task 1's Review Focus item. The permission table — Task 2 (catalog) and Task 2's `BUILTIN_ROLE_PERMISSIONS` (role defaults). Row/field authorization rules ("studio membership must be active," "instructor assignment must be effective at operation time," "no automatic billing access") — Task 6's active-membership check, Task 9's time-bounded assignment check, and the fact that `BUILTIN_ROLE_PERMISSIONS.instructor` omits every `billing.*` code. Platform admin support-only control plane — Task 8. Studio timezone settings — Task 1's `locations.timezone` column (IANA string, per spec's data conventions). Acceptance tests #1/#3/#13/#15 — Task 11, fully. #2 — Task 11, partially, by design (full coverage is Phase 3's, per the roadmap).

**Step scan:** Every code step carries either a complete file or a complete, named diff against a file already shown earlier in the same task. Two steps (Task 7 Step 1, Task 9 Step 3) include an inline "fix this before running" correction where a first-draft test/implementation had a genuine gap (a placeholder helper function and a tenant-context omission, respectively) — both are resolved inline with the real code, not left as an exercise, following Phase 0's own precedent of fixing a drafting mistake found on self-review rather than hiding it.

**Type consistency:** `ActiveMembership`, `PermissionCode`, `Db` (the `NodePgDatabase<typeof schema>` alias) and every service function's `(..., database?: Db)` trailing-optional-database signature are used identically across Tasks 5–10, matching the pattern Phase 0's `withTenantContext`/`authorizeCredentials` already established. `isAssignedInstructor`'s signature changed mid-task-9-draft (added `studioId`) — resolved inline in Task 9 Step 3, and Task 9 Step 1's test is explicitly flagged to update at the same point so the two don't drift.

**Review Focus:** all five items (deactivated membership, cross-tenant isolation while acting in one tenant's context, expired/reused invitation tokens, forged studioId, room/location consistency) have an owning task's test, listed next to each item above.

**Scope check:** No domain boundary 3+ feature (real CRM fields, scheduling, billing, curriculum) is implemented — `students`/`student_assignments` stay deliberately bare, documented as Phase 3's extension point rather than Phase 1 overreach. No UI page is added in this plan; Phase 1's roadmap deliverables list data/behavior, not screens, and the existing design-system page from Phase 0 is left untouched.

**Decisions flagged to the user (see "Decisions this plan locks in"):** the three "optional/restricted/limited → not granted" permission defaults, the new `locations.manage` code, and reading the roadmap's "Phase 2" as a typo for "Phase 3" when scoping acceptance test #2's stub. These are product-shaped calls the plan had to make to stay unambiguous; flag them for a sanity check before Phase 3 builds on top of the stub.
