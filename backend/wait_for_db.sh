#!/bin/sh
echo "Waiting for Postgres..."

# small Python loop that attempts to connect using psycopg2
python - <<'PY'
import time
import os
import sys
import psycopg2
from psycopg2 import OperationalError

host = os.environ.get("POSTGRES_HOST", "db")
port = int(os.environ.get("POSTGRES_PORT", 5432))
dbname = os.environ.get("POSTGRES_DB", "hofsmart")
user = os.environ.get("POSTGRES_USER", "hofuser")
password = os.environ.get("POSTGRES_PASSWORD", "hofpass")

retry = 0
while True:
    try:
        conn = psycopg2.connect(host=host, port=port, dbname=dbname, user=user, password=password, connect_timeout=3)
        conn.close()
        print("Postgres is available")
        break
    except OperationalError as e:
        retry += 1
        if retry % 4 == 0:
            print(f"Waiting for Postgres... (attempt {retry})")
        time.sleep(0.5)

# run migrations (safe no-op if nothing to do)
print("Running migrations")
os.system("python manage.py migrate --noinput")
PY

# exec final command (passed as args in docker-compose)
echo "Starting server..."
exec "$@"


