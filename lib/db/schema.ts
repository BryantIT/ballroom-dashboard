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

// Login identity only. NOT the business "students" table from later
// phases — students are CRM records and never log in (spec BR, domain
// boundary 3). Shape matches the standard Auth.js Drizzle adapter schema,
// plus one extra column (passwordHash) for the Credentials provider.
export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  passwordHash: text("password_hash"),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ]
);

// Unused until an OAuth provider is added in a later phase — the
// Credentials provider only supports JWT-strategy sessions (see Global
// Constraints). Created now so adding OAuth later needs no migration.
export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })]
);

export const appSchema = pgSchema("app");

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
// join) so the RLS policy below doesn't need one. BR-01 requires this
// stay in sync with the owning location's studio_id. Nothing enforces or
// tests that yet: no task in this phase creates rooms through the API.
// Whichever future phase adds room creation must derive studioId
// server-side from the location, never accept it from the caller, and
// test that derivation against a mismatched value. A DB trigger enforcing
// this is separately deferred to Phase 9 hardening, per the spec's
// "Security and implementation cautions" section.
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

// --- Phase 1: shared reference catalog — NOT tenant-owned, no RLS.
// Same category of exception as this file's Auth.js tables (users,
// accounts, etc.): global data every tenant reads, nothing writes at
// runtime (seeded once by migration). See this plan's Global Constraints.
export const permissions = appSchema.table("permissions", {
  code: text("code").primaryKey(),
  description: text("description").notNull(),
});

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

// --- Phase 2: studio_branding — NOT tenant-owned, no RLS. Same exception
// as `invitations` above, for a different reason: the public subdomain
// lookup must resolve a studio from its slug BEFORE any app.tenant_id can
// be set, so this table cannot be gated by the tenant-context RLS pattern
// used by locations/rooms/etc. Enforcement of who may WRITE it lives
// entirely in lib/branding/branding.ts, via an explicit
// requirePermission(..., "branding.manage") call, not RLS.
export const studioBranding = appSchema.table("studio_branding", {
  studioId: uuid("studio_id")
    .primaryKey()
    .references(() => studios.id),
  slug: text("slug").notNull().unique(),
  themePreset: text("theme_preset").notNull().default("midnight"),
  accentColorOverride: text("accent_color_override"),
  colorMode: text("color_mode").notNull().default("system"),
  logoUrl: text("logo_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
