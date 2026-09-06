-- S8: least-privilege database role for the API runtime.
--
-- Threat: the application connects as the database owner (superuser-equivalent:
-- DDL, CREATE ROLE, schema mutation). A SQL-injection or connection-string leak
-- then means full database compromise instead of row-level damage.
--
-- Design:
--   * `itehaas_app` gets DML only (SELECT/INSERT/UPDATE/DELETE) on app tables,
--     USAGE on schema/sequences, EXECUTE on public functions (pgcrypto/trgm
--     defaults and triggers). Deliberately NO CREATE/DROP/ALTER, NO role admin.
--   * NOLOGIN by default: the role cannot connect until an operator sets a
--     strong password out-of-band and points the app at it via DATABASE_APP_URL.
--     Until then the app keeps using DATABASE_URL (owner) — behavior unchanged.
--   * Best-effort: hosted environments where migrations run without CREATEROLE
--     get a NOTICE instead of a failed boot (fail-open here is safe: it preserves
--     the status-quo owner role, and downgrading to it can never lock operators out).
--   * Future tables created by later migrations are covered via ALTER DEFAULT
--     PRIVILEGES FOR ROLE CURRENT_USER (the migration role).
--
-- Operator runbook (enable least privilege):
--   1. psql "$DATABASE_URL" -c "ALTER ROLE itehaas_app WITH LOGIN PASSWORD <32+ random>;"
--      (psql substitutes nothing here: replace the placeholder with a generated secret,
--      e.g. openssl rand -base64 32, and never commit it to git)
--   2. DATABASE_APP_URL="postgres://itehaas_app:<pwd>@db:5432/itehaas" in .env
--   3. Restart server; verify `SHOW SESSION AUTHORIZATION` / logs use itehaas_app.
--   4. Never grant itehaas_app DDL, and never run migrations as itehaas_app
--      (migrate.ts must keep using the owner DATABASE_URL).

DO $$
DECLARE
  dbname text := current_database();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'itehaas_app') THEN
    CREATE ROLE itehaas_app WITH NOLOGIN;
  END IF;

  EXECUTE format('GRANT CONNECT ON DATABASE %I TO itehaas_app', dbname);
  GRANT USAGE ON SCHEMA public TO itehaas_app;

  GRANT SELECT, INSERT, UPDATE, DELETE
    ON ALL TABLES IN SCHEMA public
    TO itehaas_app;

  GRANT USAGE, SELECT
    ON ALL SEQUENCES IN SCHEMA public
    TO itehaas_app;

  GRANT EXECUTE
    ON ALL FUNCTIONS IN SCHEMA public
    TO itehaas_app;

  ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO itehaas_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO itehaas_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO itehaas_app;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'S8: insufficient privilege to create itehaas_app role; continuing with owner role (see 011_db_roles.sql runbook)';
END
$$;
