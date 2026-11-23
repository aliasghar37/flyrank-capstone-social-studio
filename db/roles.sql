-- Optional least-privilege runtime role. Run once as the DB owner, after migrations:
--   psql "$MIGRATION_DATABASE_URL" -v app_password="'change_me'" -f db/roles.sql
-- The API and worker then connect as studio_app; migrations keep using the owner.
-- No DELETE/TRUNCATE: publish history and posts are append/update-only for the app.

DO $$ BEGIN
  CREATE ROLE studio_app LOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER ROLE studio_app PASSWORD :app_password;

GRANT USAGE ON SCHEMA public TO studio_app;
GRANT SELECT, INSERT         ON posts, generation_runs, mock_posts      TO studio_app;
GRANT SELECT, INSERT, UPDATE ON variants, slots, publish_attempts       TO studio_app;
GRANT SELECT                 ON publish_history, schema_migrations      TO studio_app;
