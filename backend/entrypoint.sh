#!/bin/sh
set -e

echo "Waiting for Postgres..."
until PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c '\q' 2>/dev/null; do
  echo "Postgres is unavailable - sleeping"
  sleep 1
done

echo "Postgres available - running migrations"
python manage.py migrate --noinput
python manage.py collectstatic --noinput

exec "$@"
