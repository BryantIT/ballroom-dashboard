import {
  pgSchema,
  pgTable,
  text,
  timestamp,
  uuid,
  primaryKey,
  integer,
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

// --- RLS probe (Phase 0 only) ---
// Exists solely to prove the tenant-context/RLS plumbing end-to-end before
// any real business table exists. Phase 1 introduces the real `studios`
// and `memberships` tables; once that lands, this table and its one route
// handler (Task 8) should be dropped.
export const appSchema = pgSchema("app");

export const tenantProbe = appSchema.table("tenant_probe", {
  id: uuid("id").primaryKey().defaultRandom(),
  studioId: uuid("studio_id").notNull(),
  label: text("label").notNull(),
});

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
