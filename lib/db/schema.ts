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
