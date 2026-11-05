import "server-only";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_RUNTIME_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_RUNTIME_URL is not set. The app must connect as the least-" +
      "privilege app_runtime role, never via ambient pg defaults (PGUSER/" +
      "PGHOST/OS user), which could silently be a superuser and bypass RLS."
  );
}

const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });
