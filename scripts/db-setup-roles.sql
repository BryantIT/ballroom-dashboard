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

-- Table-level privileges live here (not in a Drizzle migration) because
-- they must run after app_runtime is created above, and migrations run
-- before this script in the documented order (schema "app" must exist
-- before this script's "GRANT USAGE ON SCHEMA app" above can succeed).
GRANT SELECT, INSERT ON "app"."tenant_probe" TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON "user", "account", "session", "verificationToken" TO app_runtime;
