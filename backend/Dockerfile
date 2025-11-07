# backend/Dockerfile
FROM python:3.11-slim

# make builds non-interactive
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Install OS packages required for building some Python packages and postgres client
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      build-essential \
      gcc \
      libpq-dev \
      postgresql-client \
      curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first to leverage Docker cache (context is ./backend)
COPY requirements.txt /app/requirements.txt

# Install Python deps, then ensure celery & redis client are present
RUN pip install --upgrade pip setuptools wheel && \
    pip install -r /app/requirements.txt && \
    pip install celery redis

# Copy app sources
COPY . /app

# Ensure entrypoint script is executable if present (no-op if missing)
RUN if [ -f /app/entrypoint.sh ]; then chmod +x /app/entrypoint.sh; fi

EXPOSE 8000

# Entrypoint (keeps your existing entrypoint if present). Default to gunicorn.
# Docker Compose overrides are permitted.
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["gunicorn", "server.wsgi:application", "--bind", "0.0.0.0:8000"]
