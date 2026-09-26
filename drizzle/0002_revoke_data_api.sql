-- Defence in depth (Supabase changelog 2026-04-28: new tables are no longer auto-exposed to the Data
-- API, but older projects may still grant anon/authenticated on public). The app never uses those
-- roles: it connects as the owner. Revoke everything so the Data API can't reach these tables even if
-- RLS were ever relaxed. Guarded so it also runs on plain Postgres without Supabase roles.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
    END IF;
  END LOOP;
END $$;
