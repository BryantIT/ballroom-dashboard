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
