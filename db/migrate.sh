#!/usr/bin/env sh
# Applies db/migrations/*.sql in order, each in its own transaction, skipping applied ones.
# Usage: DATABASE_URL=postgresql://... ./db/migrate.sh
set -eu
DIR="$(cd "$(dirname "$0")" && pwd)/migrations"
: "${DATABASE_URL:?DATABASE_URL is required}"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
  "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());"

for f in "$DIR"/*.sql; do
  v="$(basename "$f" .sql)"
  applied="$(printf "SELECT 1 FROM schema_migrations WHERE version = :'v';\n" | psql "$DATABASE_URL" -tAq -v v="$v")"
  if [ "$applied" = "1" ]; then continue; fi
  echo "applying $v"
  { cat "$f"; printf "\nINSERT INTO schema_migrations (version) VALUES (:'v');\n"; } \
    | psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -1 -v v="$v"
done
echo "migrations up to date"
