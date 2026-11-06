-- DEV/CI ONLY. The app_runtime password here is a hardcoded literal for
-- local Compose and Testcontainers use. Production roles are provisioned
-- with a secret from the secrets manager, never this script, as written.
--
-- Every new tenant-owned table needs a GRANT line added below for
-- app_runtime (this script runs after migrations create the schema, so a
-- migration cannot grant its own table's privileges to app_runtime
-- without this two-step split).

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
GRANT SELECT, INSERT, UPDATE ON "app"."studios" TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON "app"."locations" TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON "app"."rooms" TO app_runtime;
