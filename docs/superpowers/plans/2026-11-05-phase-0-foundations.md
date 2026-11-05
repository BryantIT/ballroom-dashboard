# Phase 0 — Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the empty-but-real skeleton this whole project builds on: a Next.js 16 app that talks to a real Postgres database under enforced row-level security, with authentication, a per-request tenant-context transaction helper, a design-system foundation, and a test harness (unit + real-Postgres integration) that can prove all of it actually works — before any business table exists.

**Architecture:** A `proxy.ts` does cheap, cookie-only optimistic auth redirects only (no DB access, per Next.js 16's Proxy constraints). Real authorization and tenant scoping happen inside a Data Access Layer (`lib/dal.ts`) and a `withTenantContext()` transaction helper (`lib/db/with-tenant-context.ts`) that opens a Drizzle transaction, issues parameterized `set_config('app.user_id'/'app.tenant_id', ..., true)` calls (transaction-scoped, safe on a pooled connection), and only then runs the caller's query — so Postgres RLS policies see the right session variables for every tenant-scoped read/write. The app connects to Postgres as a least-privilege `app_runtime` role; a separate `app_migrator` role (the one in `DATABASE_URL` used by `drizzle-kit`) owns the schema and runs migrations, so a compromised app connection can never alter schema, policies, or grants.

**Tech Stack:** Next.js 16.4.5 (App Router, Turbopack default), React 19.3.0, TypeScript 5. Drizzle ORM 0.45.4 + `pg` 8.23.1 (node-postgres) + drizzle-kit 0.31.11. Auth.js (`next-auth`) 5.0.0-beta.32 + `@auth/drizzle-adapter` 1.11.3, `bcryptjs` 3.0.3. Zod 4.6.7. Vitest 5.1.0 + `@vitejs/plugin-react` 6.2.1 + `jsdom` 31.0.0 + `@testing-library/react` 16.3.3 + `@testing-library/dom` 10.4.2 + `vite-tsconfig-paths` 6.1.1 for unit tests; `testcontainers` 12.2.1 + `@testcontainers/postgresql` 12.2.1 for real-Postgres integration tests. Tailwind CSS v4 (already in repo) + `next-themes` 0.4.6 + `class-variance-authority` 0.7.1 + `clsx` 2.1.1 + `tailwind-merge` 3.7.0 + `lucide-react` 1.69.0 + `@radix-ui/react-slot` 1.5.0 for the shadcn/ui-style component layer. All versions above were read live from the npm registry on 2026-11-05 as part of this planning pass — pin them exactly; don't let a package manager silently pick something newer, since `next-auth` is still a beta major version.

**Spec:** `references/ballroom_dash_spec_v0_3.md` (business/domain spec — "Security and implementation cautions" section drives Task 3's role split); `docs/development-plan.md`, Phase 0 section (the roadmap entry this plan implements).

## Global Constraints

- Every tenant-scoped database read or write goes through `withTenantContext()` — no call site queries a tenant-owned table directly on the shared `db` client.
- The app's runtime Postgres connection always authenticates as `app_runtime`, never as the schema-owning/migration role. `DATABASE_URL` (migrations, drizzle-kit) and `DATABASE_RUNTIME_URL` (app connection pool) are different roles on the same database.
- `SET`/session-level Postgres config is never used for tenant context — only `SET LOCAL` / `set_config(..., true)` inside an explicit transaction, because connections are pooled and session state would leak across requests otherwise.
- `proxy.ts` never queries the database or calls anything `async` that touches Postgres — cookie presence checks only. Real authorization lives in `lib/dal.ts` and is re-checked server-side on every Server Action / Route Handler.
- `cacheComponents` and `partialPrefetching` are OFF in `next.config.ts` for this entire project (deviation from the `create-next-app` scaffold, decided in this planning pass): this app is an authenticated, per-tenant dashboard with no cacheable public content, and the Cache Components model would force a `<Suspense>` boundary and `use cache: private` around every single session read in every future phase for a caching feature this app won't benefit from. Standard per-request dynamic rendering is simpler and matches the spec's emphasis on transactional correctness over caching.
- `next-auth`'s Credentials provider only supports the default **JWT** session strategy — it doesn't persist an `account` row the way OAuth sign-in does, so Auth.js cannot maintain a database-backed session for it. This plan therefore uses JWT session strategy (a signed, httpOnly cookie), **not** the database-table session strategy the Phase 0 roadmap entry assumed — a necessary correction, flagged here rather than silently changed. `@auth/drizzle-adapter` is still wired up (for the `users` table and for forward-compatibility), and a `sessions` table is still created so that adding an OAuth provider later needs zero schema changes, but that table stays unused until an OAuth provider exists.
- All new Next.js file conventions in this plan use Next 16 names: `proxy.ts` (not `middleware.ts`), exported function named `proxy` (not `middleware`), and every use of `cookies()`/`headers()`/`params` is `await`ed (Next 16 removed synchronous compatibility).
- `next.config.ts`'s existing `turbopack.rules` block (Tailwind's Turbopack CSS loader) and `experimental.agentFeedback: true` are preserved as-is; only `cacheComponents` and `partialPrefetching` are removed.

---

### Task 1: Disable Cache Components, confirm build/dev still work

**Files:**
- Modify: `next.config.ts`
- Test: manual (`next build`, `next dev` smoke check — no automated test framework exists yet; Task 2 adds one)

**Interfaces:**
- Produces: a `next.config.ts` with no `cacheComponents`/`partialPrefetching` keys, used unmodified by every later task.

- [ ] **Step 1: Confirm the current build works before changing anything**

Run: `npm run build`
Expected: succeeds (baseline, so a later failure is attributable to this change).

- [ ] **Step 2: Remove `cacheComponents` and `partialPrefetching`**

```ts
// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
```

- [ ] **Step 3: Verify build and dev server still work**

Run: `npm run build`
Expected: succeeds, and the build output no longer mentions Partial Prerendering / Cache Components.

Run: `npm run dev` (then Ctrl+C after it reports "Ready")
Expected: starts without error.

- [ ] **Step 4: Commit**

```bash
git add next.config.ts
git commit -m "chore: disable Cache Components (dashboard app has no cacheable public content)"
```

---

### Task 2: Vitest unit-test harness

**Files:**
- Create: `vitest.config.mts`
- Create: `__tests__/page.test.tsx`
- Modify: `package.json` (add `test`/`test:watch` scripts and devDependencies)

**Interfaces:**
- Produces: `npm test` (single run) and `npm run test:watch`, used by every later task's unit tests and by Task 9's CI workflow.

- [ ] **Step 1: Install Vitest and React Testing Library**

```bash
npm install -D vitest@5.1.0 @vitejs/plugin-react@6.2.1 jsdom@31.0.0 @testing-library/react@16.3.3 @testing-library/dom@10.4.2 vite-tsconfig-paths@6.1.1
```

- [ ] **Step 2: Add Vitest config**

```ts
// vitest.config.mts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
  },
});
```

- [ ] **Step 3: Add `test` scripts to `package.json`**

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 4: Write a failing sample test**

```tsx
// __tests__/page.test.tsx
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import Page from "../app/page";

test("home page renders a heading", () => {
  render(<Page />);
  expect(screen.getByRole("heading", { level: 1 })).toBeDefined();
});
```

- [ ] **Step 5: Run it — expect it to pass already (current `app/page.tsx` has an `<h1>`) or fail clearly if not**

Run: `npm test`
Expected: either PASS (the scaffolded `app/page.tsx` has an `<h1>To get started...`) — if so this step just proves the harness works end-to-end; if the markup has since changed and there's no `<h1>`, this FAILs with "Unable to find role heading", confirming the test actually checks something.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.mts __tests__/page.test.tsx package.json package-lock.json
git commit -m "test: add Vitest unit-test harness"
```

---

### Task 3: Postgres, Drizzle schema, role split, and the RLS probe table

**Files:**
- Create: `docker-compose.yml`
- Create: `scripts/db-setup-roles.sql`
- Create: `drizzle.config.ts`
- Create: `lib/db/schema.ts`
- Create: `lib/db/client.ts`
- Create: `lib/db/testing/test-database.ts`
- Create: `lib/db/testing/test-database.test.ts`
- Modify: `package.json` (devDependencies, `db:generate`/`db:migrate` scripts)
- Create: `.env.example`

**Interfaces:**
- Produces: `lib/db/schema.ts` exports `users`, `accounts`, `sessions`, `verificationTokens` (Auth.js adapter tables, consumed by Task 5), `appSchema.tenantProbe` (consumed by Task 4 and Task 8). `lib/db/client.ts` exports `db: NodePgDatabase<typeof schema>` (the shared runtime client, authenticated as `app_runtime`, consumed by Task 4). `lib/db/testing/test-database.ts` exports `createTestDatabase(): Promise<{ connectionUri: string; runtimeConnectionUri: string; stop(): Promise<void> }>`, consumed by Task 4, Task 5, and Task 8's integration tests.

- [ ] **Step 1: Install Drizzle, pg, and Testcontainers**

```bash
npm install drizzle-orm@0.45.4 pg@8.23.1
npm install -D drizzle-kit@0.31.11 @types/pg@8.23.1 testcontainers@12.2.1 @testcontainers/postgresql@12.2.1
```

- [ ] **Step 2: Add local dev Postgres via Docker Compose**

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: ballroomdash_migrator
      POSTGRES_PASSWORD: ballroomdash_migrator
      POSTGRES_DB: ballroomdash
    ports:
      - "5432:5432"
    volumes:
      - ballroomdash_pgdata:/var/lib/postgresql/data

volumes:
  ballroomdash_pgdata:
```

- [ ] **Step 3: Write the role-split SQL script**

This runs once per database (local dev, CI, and inside every Testcontainers instance) — it is cluster/role setup, not a versioned schema migration, so it is not a Drizzle migration file.

```sql
-- scripts/db-setup-roles.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime LOGIN PASSWORD 'app_runtime';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE ballroomdash TO app_runtime;
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT USAGE ON SCHEMA app TO app_runtime;
```

> Note: `CREATE SCHEMA app` happens in the Drizzle migration (Step 5), which runs as the migrator role, before this script's `GRANT USAGE ON SCHEMA app` can succeed — Step 7 documents the required run order. For the local Compose database, `ballroomdash_migrator` (the Compose-created superuser-ish owner) runs this script and all migrations; for Testcontainers, `createTestDatabase()` (Step 9) does the same against the container's default user.

- [ ] **Step 4: Add `drizzle.config.ts`**

```ts
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

- [ ] **Step 5: Write the Drizzle schema (Auth.js adapter tables + the RLS probe table)**

```ts
// lib/db/schema.ts
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
```

- [ ] **Step 6: Write the runtime DB client**

```ts
// lib/db/client.ts
import "server-only";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const pool = new Pool({
  connectionString: process.env.DATABASE_RUNTIME_URL,
});

export const db = drizzle(pool, { schema });
```

- [ ] **Step 7: Generate the migration, document the run order, apply locally**

Run: `npx drizzle-kit generate`
Expected: creates `drizzle/0000_*.sql` with the `CREATE SCHEMA "app"` and all five tables (`user`, `account`, `session`, `verificationToken`, `app.tenant_probe`).

Add the RLS policy as a second, hand-written migration (drizzle-kit only generates schema DDL from the TS schema, not policies):

```sql
-- drizzle/0001_tenant_probe_rls.sql
ALTER TABLE "app"."tenant_probe" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "app"."tenant_probe"
  USING (studio_id::text = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT ON "app"."tenant_probe" TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON "user", "account", "session", "verificationToken" TO app_runtime;
```

Run order (document in `.env.example`'s comments too):
1. `docker compose up -d`
2. `psql $DATABASE_URL -c "CREATE DATABASE ballroomdash;"` if Compose didn't already create it (Compose's `POSTGRES_DB` env var handles this on first boot).
3. `npx drizzle-kit migrate` (runs both `drizzle/0000_*.sql` and `0001_tenant_probe_rls.sql`, as the migrator role — creates schema `app` before the roles script needs to grant on it).
4. `psql $DATABASE_URL -f scripts/db-setup-roles.sql` (creates `app_runtime`, grants `USAGE` on both schemas now that they exist).

- [ ] **Step 8: Add `.env.example`**

```bash
# .env.example
# Migrator role: owns the schema, runs drizzle-kit migrations.
DATABASE_URL=postgresql://ballroomdash_migrator:ballroomdash_migrator@localhost:5432/ballroomdash

# Runtime role: least-privilege, used by the app's connection pool.
# Created by scripts/db-setup-roles.sql — never give this role DDL rights.
DATABASE_RUNTIME_URL=postgresql://app_runtime:app_runtime@localhost:5432/ballroomdash
```

- [ ] **Step 9: Write the Testcontainers test-database helper**

```ts
// lib/db/testing/test-database.ts
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";

export type TestDatabase = {
  /** Migrator-role connection string — owns the schema. */
  connectionUri: string;
  /** app_runtime-role connection string — use this one in tests that
   * exercise RLS, since the migrator role bypasses it as table owner. */
  runtimeConnectionUri: string;
  stop(): Promise<void>;
};

export async function createTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer("postgres:16").start();
  const connectionUri = container.getConnectionUri();

  const migratorClient = new Client({ connectionString: connectionUri });
  await migratorClient.connect();

  const db = drizzle(migratorClient);
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });

  const rolesSql = readFileSync(
    path.join(process.cwd(), "scripts/db-setup-roles.sql"),
    "utf-8"
  )
    // The committed script targets the Compose database by name; the
    // Testcontainers database has a generated name, so grant on whatever
    // database this connection is actually using instead.
    .replace("GRANT CONNECT ON DATABASE ballroomdash TO app_runtime;", "");
  await migratorClient.query(rolesSql);

  const runtimeConnectionUri = connectionUri.replace(
    /postgresql:\/\/[^:]+:[^@]+@/,
    "postgresql://app_runtime:app_runtime@"
  );

  await migratorClient.end();

  return {
    connectionUri,
    runtimeConnectionUri,
    async stop() {
      await container.stop();
    },
  };
}
```

- [ ] **Step 10: Write the integration test proving the role split and RLS work, before any app code uses it**

```ts
// lib/db/testing/test-database.test.ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Client } from "pg";
import { createTestDatabase, type TestDatabase } from "./test-database";

describe("tenant_probe RLS", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  test("a runtime connection with no tenant context set sees zero rows, even though rows exist for two tenants", async () => {
    const seedClient = new Client({ connectionString: testDb.connectionUri });
    await seedClient.connect();
    const studioA = "11111111-1111-1111-1111-111111111111";
    const studioB = "22222222-2222-2222-2222-222222222222";
    await seedClient.query(
      `INSERT INTO "app"."tenant_probe" (studio_id, label) VALUES ($1, 'a'), ($2, 'b')`,
      [studioA, studioB]
    );
    await seedClient.end();

    const runtimeClient = new Client({
      connectionString: testDb.runtimeConnectionUri,
    });
    await runtimeClient.connect();
    const result = await runtimeClient.query(
      `SELECT * FROM "app"."tenant_probe"`
    );
    await runtimeClient.end();

    expect(result.rows).toHaveLength(0);
  });

  test("setting app.tenant_id via SET LOCAL scopes visible rows to that tenant only", async () => {
    const seedClient = new Client({ connectionString: testDb.connectionUri });
    await seedClient.connect();
    const studioA = "33333333-3333-3333-3333-333333333333";
    const studioB = "44444444-4444-4444-4444-444444444444";
    await seedClient.query(
      `INSERT INTO "app"."tenant_probe" (studio_id, label) VALUES ($1, 'a'), ($2, 'b')`,
      [studioA, studioB]
    );
    await seedClient.end();

    const runtimeClient = new Client({
      connectionString: testDb.runtimeConnectionUri,
    });
    await runtimeClient.connect();
    await runtimeClient.query("BEGIN");
    await runtimeClient.query(
      `SELECT set_config('app.tenant_id', $1, true)`,
      [studioA]
    );
    const result = await runtimeClient.query(
      `SELECT * FROM "app"."tenant_probe"`
    );
    await runtimeClient.query("COMMIT");
    await runtimeClient.end();

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].studio_id).toBe(studioA);
  });

  test("SET LOCAL does not leak tenant context across transactions on the same connection", async () => {
    const seedClient = new Client({ connectionString: testDb.connectionUri });
    await seedClient.connect();
    const studioA = "55555555-5555-5555-5555-555555555555";
    await seedClient.query(
      `INSERT INTO "app"."tenant_probe" (studio_id, label) VALUES ($1, 'a')`,
      [studioA]
    );
    await seedClient.end();

    const runtimeClient = new Client({
      connectionString: testDb.runtimeConnectionUri,
    });
    await runtimeClient.connect();

    await runtimeClient.query("BEGIN");
    await runtimeClient.query(
      `SELECT set_config('app.tenant_id', $1, true)`,
      [studioA]
    );
    await runtimeClient.query(`SELECT * FROM "app"."tenant_probe"`);
    await runtimeClient.query("COMMIT");

    // New transaction on the SAME connection, no set_config call.
    await runtimeClient.query("BEGIN");
    const result = await runtimeClient.query(
      `SELECT * FROM "app"."tenant_probe"`
    );
    await runtimeClient.query("COMMIT");
    await runtimeClient.end();

    expect(result.rows).toHaveLength(0);
  });
});
```

- [ ] **Step 11: Run the integration test**

Run: `npx vitest run lib/db/testing/test-database.test.ts`
Expected: PASS, all three assertions. Requires Docker running locally (Testcontainers starts a real `postgres:16` container).

- [ ] **Step 12: Add `db:generate`/`db:migrate` scripts and commit**

```json
{
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate"
  }
}
```

```bash
git add docker-compose.yml scripts/db-setup-roles.sql drizzle.config.ts lib/db/schema.ts lib/db/client.ts lib/db/testing/test-database.ts lib/db/testing/test-database.test.ts drizzle .env.example package.json package-lock.json
git commit -m "feat: Postgres schema baseline with app_runtime/migrator role split and tenant_probe RLS"
```

---

### Task 4: `withTenantContext()` transaction helper

**Files:**
- Create: `lib/db/with-tenant-context.ts`
- Create: `lib/db/with-tenant-context.test.ts`

**Interfaces:**
- Consumes: `db` from `lib/db/client.ts` (Task 3), `tenantProbe` from `lib/db/schema.ts` (Task 3), `createTestDatabase()` from `lib/db/testing/test-database.ts` (Task 3).
- Produces: `withTenantContext<T>(context: { userId: string; tenantId: string | null }, callback: (tx: NodePgDatabase<typeof schema>) => Promise<T>): Promise<T>` — consumed by Task 8's probe route, and by every tenant-scoped query in every later phase.

- [ ] **Step 1: Write the failing integration test**

```ts
// lib/db/with-tenant-context.test.ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "./testing/test-database";
import { withTenantContext } from "./with-tenant-context";
import { tenantProbe } from "./schema";
import * as schema from "./schema";

describe("withTenantContext", () => {
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

  test("a query run without a tenantId sees zero rows", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    await seedDb.insert(tenantProbe).values({
      studioId: "66666666-6666-6666-6666-666666666666",
      label: "seeded",
    });
    await seedPool.end();

    const db = drizzle(pool, { schema });
    const rows = await withTenantContext(
      { userId: "test-user", tenantId: null },
      (tx) => tx.select().from(tenantProbe),
      db
    );

    expect(rows).toHaveLength(0);
  });

  test("a query run with a tenantId sees only that tenant's rows", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    const studioId = "77777777-7777-7777-7777-777777777777";
    await seedDb.insert(tenantProbe).values([
      { studioId, label: "mine" },
      { studioId: "88888888-8888-8888-8888-888888888888", label: "not-mine" },
    ]);
    await seedPool.end();

    const db = drizzle(pool, { schema });
    const rows = await withTenantContext(
      { userId: "test-user", tenantId: studioId },
      (tx) => tx.select().from(tenantProbe),
      db
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("mine");
  });
});
```

- [ ] **Step 2: Run it to verify it fails (module doesn't exist yet)**

Run: `npx vitest run lib/db/with-tenant-context.test.ts`
Expected: FAIL with "Cannot find module './with-tenant-context'".

- [ ] **Step 3: Implement `withTenantContext()`, accepting an injectable database handle so tests can point it at the Testcontainers connection while production call sites use the default shared client**

```ts
// lib/db/with-tenant-context.ts
import "server-only";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db as defaultDb } from "./client";
import type * as schema from "./schema";

export type TenantContext = {
  userId: string;
  tenantId: string | null;
};

type Db = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Runs `callback` inside a transaction with `app.user_id` and (if present)
 * `app.tenant_id` set via `set_config(..., true)`, scoped to that
 * transaction only (never leaks to the next transaction on a pooled
 * connection — see lib/db/with-tenant-context.test.ts). RLS policies on
 * tenant-owned tables key off these two settings.
 */
export async function withTenantContext<T>(
  context: TenantContext,
  callback: (tx: Tx) => Promise<T>,
  database: Db = defaultDb
): Promise<T> {
  return database.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.user_id', ${context.userId}, true)`
    );
    if (context.tenantId) {
      await tx.execute(
        sql`select set_config('app.tenant_id', ${context.tenantId}, true)`
      );
    }
    return callback(tx);
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/db/with-tenant-context.test.ts`
Expected: PASS, both tests.

- [ ] **Step 5: Commit**

```bash
git add lib/db/with-tenant-context.ts lib/db/with-tenant-context.test.ts
git commit -m "feat: add withTenantContext transaction helper"
```

---

### Task 5: Auth.js — Credentials provider, Drizzle adapter, JWT sessions

**Files:**
- Create: `auth.ts`
- Create: `app/api/auth/[...nextauth]/route.ts`
- Create: `auth.test.ts`

**Interfaces:**
- Consumes: `users` schema from `lib/db/schema.ts` (Task 3), `createTestDatabase()` from `lib/db/testing/test-database.ts` (Task 3).
- Produces: `auth`, `signIn`, `signOut`, `handlers` exported from `auth.ts` — `auth()` consumed by Task 7's DAL.

- [ ] **Step 1: Install Auth.js and bcryptjs**

```bash
npm install next-auth@beta @auth/drizzle-adapter@1.11.3 bcryptjs@3.0.3
npm install -D @types/bcryptjs@3.0.0
```

> `next-auth@beta` currently resolves to `5.0.0-beta.32` — verify with `npm list next-auth` after install and pin that exact string in `package.json` if npm resolved something else by the time this task runs.

- [ ] **Step 2: Write the failing test (sign-up then sign-in round trip)**

```ts
// auth.test.ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { createTestDatabase, type TestDatabase } from "./lib/db/testing/test-database";
import { users } from "./lib/db/schema";
import * as schema from "./lib/db/schema";

describe("credentials auth", () => {
  let testDb: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  test("a user created with a bcrypt hash can authorize with the matching password", async () => {
    const db = drizzle(pool, { schema });
    const passwordHash = await bcrypt.hash("correct-password", 10);
    await db.insert(users).values({
      email: "owner@example.com",
      passwordHash,
    });

    const { authorizeCredentials } = await import("./auth");
    const result = await authorizeCredentials(
      { email: "owner@example.com", password: "correct-password" },
      db
    );

    expect(result).not.toBeNull();
    expect(result?.email).toBe("owner@example.com");
  });

  test("authorize rejects a wrong password", async () => {
    const db = drizzle(pool, { schema });
    const passwordHash = await bcrypt.hash("correct-password", 10);
    await db.insert(users).values({
      email: "owner2@example.com",
      passwordHash,
    });

    const { authorizeCredentials } = await import("./auth");
    const result = await authorizeCredentials(
      { email: "owner2@example.com", password: "wrong-password" },
      db
    );

    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run auth.test.ts`
Expected: FAIL with "Cannot find module './auth'".

- [ ] **Step 4: Implement `auth.ts`, extracting `authorizeCredentials` as a standalone, injectable-db function**

The default Auth.js `Session["user"]` type has no `id` field, and `lib/dal.ts` (Task 7) needs to read `session.user.id`. Without the module augmentation below, both this file's `session` callback (assigning `session.user.id`) and Task 7's DAL (reading it) fail `tsc --noEmit` — add it in this same file so it's in scope wherever `next-auth`'s types are used:

```ts
// auth.ts
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import bcrypt from "bcryptjs";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { db as defaultDb } from "./lib/db/client";
import * as schema from "./lib/db/schema";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & { id: string };
  }
}

type Db = NodePgDatabase<typeof schema>;

export async function authorizeCredentials(
  credentials: { email: string; password: string },
  database: Db = defaultDb
) {
  const [user] = await database
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, credentials.email))
    .limit(1);

  if (!user || !user.passwordHash) {
    return null;
  }

  const valid = await bcrypt.compare(credentials.password, user.passwordHash);
  if (!valid) {
    return null;
  }

  return { id: user.id, email: user.email, name: user.name };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(defaultDb, {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  }),
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (
          typeof credentials?.email !== "string" ||
          typeof credentials?.password !== "string"
        ) {
          return null;
        }
        return authorizeCredentials({
          email: credentials.email,
          password: credentials.password,
        });
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.id === "string") {
        session.user.id = token.id;
      }
      return session;
    },
  },
});
```

- [ ] **Step 5: Add the Route Handler**

```ts
// app/api/auth/[...nextauth]/route.ts
export { GET, POST } from "@/auth";
```

- [ ] **Step 6: Run the test**

Run: `npx vitest run auth.test.ts`
Expected: PASS, both cases.

- [ ] **Step 7: Add `AUTH_SECRET` to `.env.example`**

```bash
# .env.example (append)
AUTH_SECRET=replace-with-output-of-openssl-rand-base64-32
```

- [ ] **Step 8: Commit**

```bash
git add auth.ts app/api/auth/[...nextauth]/route.ts auth.test.ts .env.example package.json package-lock.json
git commit -m "feat: Auth.js Credentials provider with Drizzle-backed users table"
```

---

### Task 6: `proxy.ts` — optimistic auth redirect

**Files:**
- Create: `proxy.ts`
- Create: `proxy.test.ts`

**Interfaces:**
- Produces: nothing consumed by later tasks (terminal file per Next.js convention — only one `proxy.ts` is allowed per project).

- [ ] **Step 1: Write the failing test**

```ts
// proxy.test.ts
// @vitest-environment node
import { describe, expect, test } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

describe("proxy", () => {
  test("redirects an unauthenticated request to a protected path to /login", () => {
    const request = new NextRequest("http://localhost/dashboard");
    const response = proxy(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  test("passes through an unauthenticated request to a public path", () => {
    const request = new NextRequest("http://localhost/login");
    const response = proxy(request);
    expect(response.status).toBe(200);
  });

  test("passes through a request to a protected path that carries a session cookie", () => {
    const request = new NextRequest("http://localhost/dashboard");
    request.cookies.set("authjs.session-token", "fake-token-value");
    const response = proxy(request);
    expect(response.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run proxy.test.ts`
Expected: FAIL with "Cannot find module './proxy'".

- [ ] **Step 3: Implement `proxy.ts`**

```ts
// proxy.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/dashboard"];

export function proxy(request: NextRequest) {
  const isProtected = PROTECTED_PREFIXES.some((prefix) =>
    request.nextUrl.pathname.startsWith(prefix)
  );
  if (!isProtected) {
    return NextResponse.next();
  }

  const hasSessionCookie =
    request.cookies.has("authjs.session-token") ||
    request.cookies.has("__Secure-authjs.session-token");

  if (!hasSessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
```

> Cookie name verification note: Auth.js v5 beta uses `authjs.session-token` (renamed from v4's `next-auth.session-token`). Since `next-auth` is still pre-1.0 in its v5 line, confirm this name against the installed `5.0.0-beta.32` before relying on it in Task 9's CI — a quick way is to sign in locally via Task 5's route and inspect the `Set-Cookie` header.

- [ ] **Step 4: Run the test**

Run: `npx vitest run proxy.test.ts`
Expected: PASS, all three cases.

- [ ] **Step 5: Commit**

```bash
git add proxy.ts proxy.test.ts
git commit -m "feat: add optimistic auth proxy for protected routes"
```

---

### Task 7: Data Access Layer — `verifySession()`

**Files:**
- Create: `lib/dal.ts`

**Interfaces:**
- Consumes: `auth` from `auth.ts` (Task 5).
- Produces: `verifySession(): Promise<{ userId: string }>` — consumed by Task 8's probe route and by every protected Server Component/Action/Route Handler in every later phase.

- [ ] **Step 1: Implement `verifySession()`**

No new testable behavior beyond what Task 5's `auth()` and Task 6's redirect already cover in isolation — this task is a thin, memoized wrapper per the Next.js DAL pattern, verified by Task 8's end-to-end integration test instead of its own unit test (there is nothing to unit-test here that doesn't require a running session, which Task 8 already sets up against a real test database).

```ts
// lib/dal.ts
import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export const verifySession = cache(async () => {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return { userId: session.user.id };
});
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors (confirms `session.user.id` is a valid access path given Task 5's `declare module "next-auth"` augmentation and its `session` callback, which together type and populate `session.user.id` from the JWT).

- [ ] **Step 3: Commit**

```bash
git add lib/dal.ts
git commit -m "feat: add verifySession DAL helper"
```

---

### Task 8: The acceptance-test-#15 smoke test — tenant probe route

**Files:**
- Create: `app/api/_internal/tenant-probe/route.ts`
- Create: `app/api/_internal/tenant-probe/route.test.ts`

**Interfaces:**
- Consumes: `verifySession` from `lib/dal.ts` (Task 7), `withTenantContext` from `lib/db/with-tenant-context.ts` (Task 4), `tenantProbe` from `lib/db/schema.ts` (Task 3), `createTestDatabase` from `lib/db/testing/test-database.ts` (Task 3), `authorizeCredentials`/`users` insert path from Task 3/5 for seeding a real authenticated user.

This is the throwaway end-to-end proof for spec acceptance test #15 ("missing tenant context produces no tenant-owned rows under RLS"). Delete this route and its test once Phase 1 lands with real studio/membership resolution — see the comment in `lib/db/schema.ts` Task 3 Step 5.

- [ ] **Step 1: Write the failing integration test**

```ts
// app/api/_internal/tenant-probe/route.test.ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  createTestDatabase,
  type TestDatabase,
} from "@/lib/db/testing/test-database";
import { tenantProbe } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";

describe("GET /api/_internal/tenant-probe", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  test("an authenticated request with no tenant context returns zero rows, even though other tenants' rows exist", async () => {
    const seedPool = new Pool({ connectionString: testDb.connectionUri });
    const seedDb = drizzle(seedPool, { schema });
    await seedDb.insert(tenantProbe).values([
      { studioId: "99999999-9999-9999-9999-999999999999", label: "tenant-a" },
      { studioId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", label: "tenant-b" },
    ]);
    await seedPool.end();

    const { GET } = await import("./route");
    const response = await GET();
    const body = await response.json();

    expect(body.rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run app/api/_internal/tenant-probe/route.test.ts`
Expected: FAIL with "Cannot find module './route'".

- [ ] **Step 3: Implement the route, stubbing `verifySession` since this test has no real Auth.js session cookie**

The test calls `GET()` directly (no HTTP layer, no cookies), so it cannot satisfy `verifySession()`'s real auth check. Accept a userId directly for this internal-only probe route rather than routing it through session verification — unlike every other route in every later phase, this one route is explicitly exempt from the "always go through the DAL" rule because it exists only to test the tenant-context plumbing itself, before `verifySession` has a tenant/session concept to verify against:

```ts
// app/api/_internal/tenant-probe/route.ts
import { NextResponse } from "next/server";
import { withTenantContext } from "@/lib/db/with-tenant-context";
import { tenantProbe } from "@/lib/db/schema";

// THROWAWAY (Phase 0 only): proves RLS end-to-end before any real
// studio/membership table exists. Delete this file and its test once
// Phase 1 lands. Deliberately calls withTenantContext with tenantId:
// null to simulate "authenticated request, no tenant context" — this is
// spec acceptance test #15.
export async function GET() {
  const rows = await withTenantContext(
    { userId: "internal-probe", tenantId: null },
    (tx) => tx.select().from(tenantProbe)
  );
  return NextResponse.json({ rows });
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run app/api/_internal/tenant-probe/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/_internal/tenant-probe/route.ts app/api/_internal/tenant-probe/route.test.ts
git commit -m "test: add throwaway tenant-probe route proving acceptance test #15"
```

---

### Task 9: CI pipeline

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `npm run lint`, `npm run typecheck`, `npm test` (Task 2), the Testcontainers-based integration tests (Tasks 3/4/5/8) which need Docker.

- [ ] **Step 1: Write the workflow**

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci

      - run: npm run lint

      - run: npm run typecheck

      - run: npm test
```

> GitHub-hosted `ubuntu-latest` runners include Docker by default, which Testcontainers needs to start `postgres:16` — no extra service container configuration is required since every integration test calls `createTestDatabase()` itself rather than relying on a workflow-level `services:` Postgres.

- [ ] **Step 2: Verify locally that the same commands pass**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all three succeed (this is the same sequence CI runs; confirming it locally catches config mistakes before pushing).

- [ ] **Step 3: Push and confirm the Actions run is green**

Run: `git push` (on a branch, or open a PR) and check the Actions tab.
Expected: the `test` job passes end-to-end, including the Testcontainers-backed tests from Tasks 3/4/5/8.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run lint, typecheck, and tests (including Testcontainers integration tests) on push/PR"
```

---

### Task 10: Design-system foundation (shadcn/ui-style components + light/dark mode)

**Files:**
- Create: `lib/utils.ts`
- Create: `components/ui/button.tsx`
- Create: `components/ui/card.tsx`
- Create: `components/theme-provider.tsx`
- Create: `components/theme-toggle.tsx`
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`
- Modify: `app/page.tsx`
- Modify: `__tests__/page.test.tsx`

**Interfaces:**
- Produces: `cn()` util, `Button`, `Card`/`CardHeader`/`CardTitle`/`CardContent`, `ThemeProvider`, `ThemeToggle` — consumed by every page built in every later phase.

- [ ] **Step 1: Install the component-layer dependencies**

```bash
npm install next-themes@0.4.6 class-variance-authority@0.7.1 clsx@2.1.1 tailwind-merge@3.7.0 lucide-react@1.69.0 @radix-ui/react-slot@1.5.0
```

- [ ] **Step 2: Add the `cn()` class-merging util**

```ts
// lib/utils.ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 3: Add CSS-variable design tokens (extending the existing Tailwind v4 `@theme inline` block)**

```css
/* app/globals.css */
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

:root {
  --background: #ffffff;
  --foreground: #0f172a;
  --card: #ffffff;
  --card-foreground: #0f172a;
  --primary: #4f46e5;
  --primary-foreground: #ffffff;
  --muted: #f1f5f9;
  --muted-foreground: #64748b;
  --border: #e2e8f0;
  --radius: 0.75rem;
}

.dark {
  --background: #0b0f19;
  --foreground: #e2e8f0;
  --card: #111729;
  --card-foreground: #e2e8f0;
  --primary: #818cf8;
  --primary-foreground: #0b0f19;
  --muted: #1b2332;
  --muted-foreground: #94a3b8;
  --border: #1f2a3d;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-border: var(--border);
  --radius-lg: var(--radius);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

body {
  background: var(--background);
  color: var(--foreground);
}
```

> The accent color here (`--primary`) is exactly the one variable Phase 2's per-studio theming overrides — no new theming engine needed, per `docs/development-plan.md` Phase 2.

- [ ] **Step 4: Add the `Button` component**

```tsx
// components/ui/button.tsx
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 disabled:pointer-events-none",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:opacity-90",
        outline:
          "border border-border bg-transparent hover:bg-muted text-foreground",
        ghost: "hover:bg-muted text-foreground",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-9 px-3",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
```

- [ ] **Step 5: Add the `Card` components**

```tsx
// components/ui/card.tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card text-card-foreground shadow-sm",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 p-6", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-lg font-semibold leading-none", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}
```

- [ ] **Step 6: Add `ThemeProvider` and `ThemeToggle`**

```tsx
// components/theme-provider.tsx
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
```

```tsx
// components/theme-toggle.tsx
"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="outline"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="h-4 w-4 dark:hidden" />
      <Moon className="h-4 w-4 hidden dark:block" />
    </Button>
  );
}
```

- [ ] **Step 7: Wire `ThemeProvider` into the root layout**

```tsx
// app/layout.tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ballroom Dash",
  description: "Studio management for ballroom dance businesses.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 8: Replace the scaffolded home page with a minimal, themeable page using the new components**

```tsx
// app/page.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="flex w-full max-w-md items-center justify-between">
        <h1 className="text-xl font-semibold">Ballroom Dash</h1>
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Foundations are up</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Database, auth, and the design system are wired. Phase 1 starts
          building real studios next.
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 9: Update the existing page test for the new markup**

```tsx
// __tests__/page.test.tsx
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import Page from "../app/page";

test("home page renders the Ballroom Dash heading and a theme toggle", () => {
  render(<Page />);
  expect(
    screen.getByRole("heading", { level: 1, name: "Ballroom Dash" })
  ).toBeDefined();
  expect(screen.getByRole("button", { name: "Toggle theme" })).toBeDefined();
});
```

- [ ] **Step 10: Run the test**

Run: `npx vitest run __tests__/page.test.tsx`
Expected: PASS.

- [ ] **Step 11: Run the full build to confirm nothing broke**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 12: Commit**

```bash
git add lib/utils.ts components app/globals.css app/layout.tsx app/page.tsx __tests__/page.test.tsx package.json package-lock.json
git commit -m "feat: add shadcn-style design-system foundation with light/dark theming"
```

---

## Self-Review

**Spec coverage:** Every Phase 0 deliverable from `docs/development-plan.md` has a task: Drizzle schema/migrations (Task 3), tenant-context transaction helper (Task 4), Auth.js with `users`/`sessions` distinct from any future `students` table (Task 5), CI pipeline (Task 9), design-system foundation (Task 10), acceptance-test-#15 smoke test (Task 8). The spec's role-split and `SET LOCAL` requirements ("Security and implementation cautions") are covered in Task 3 Steps 1–3 and Task 4. The Next.js 16 `proxy`/async-APIs/Turbopack specifics are reflected in Tasks 1 and 6.

**Placeholder scan:** No "TBD"/"TODO" markers; every step has real, complete code. (A first draft of Task 4 had a step that deliberately wrote broken code to motivate a refactor in the next step — removed on review; `withTenantContext()` now takes its final injectable-database signature from the first implementation step, with no intermediate throwaway version.)

**Type/signature consistency:** `withTenantContext`'s signature (`context, callback, database?`) is introduced once in Task 4 Step 3 and used identically (3-argument form) in its own test and in Task 8. `TenantContext` (`{ userId: string; tenantId: string | null }`) is used consistently in Tasks 4 and 8. `verifySession(): Promise<{ userId: string }>` (Task 7) matches how a future phase would call it, though Task 8's probe route deliberately bypasses it (documented reason given inline). `createTestDatabase()`'s returned shape (`connectionUri`, `runtimeConnectionUri`, `stop()`) is defined once in Task 3 and used identically in Tasks 3's own test, Task 4, Task 5, and Task 8.

**Correctness fix found on review:** The default Auth.js `Session["user"]` type has no `id` field. Task 5's `session` callback assigns `session.user.id`, and Task 7's DAL reads it — both would fail `tsc --noEmit` without a type augmentation. Added a `declare module "next-auth"` block to `auth.ts` (Task 5, Step 4) extending `Session["user"]` with `id: string`, and updated Task 7's typecheck step to reference it. Also fixed a duplicate "Step 2" label in Task 5 (two different steps were both numbered 2); steps are renumbered 1–8 with no gaps or repeats.

**Scope check:** This plan stays inside Phase 0's boundary — no studio, membership, or student table is introduced; the one business-shaped table (`tenant_probe`) is explicitly marked throwaway with a removal note tied to Phase 1.

**Step count after review fixes:** 64 steps across 10 tasks (was 67 in the first draft; Task 4 dropped from 7 steps to 5 by removing the deliberate-bug teaching step).
