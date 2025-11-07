# server/settings.py
import os
from pathlib import Path
from datetime import timedelta
from dotenv import load_dotenv

load_dotenv()

# server/settings.py (add near other settings)
import os

# Celery broker/result
CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://127.0.0.1:6379/0")
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", "redis://127.0.0.1:6379/1")

# server/settings.py (append)
from celery.schedules import crontab

CELERY_BEAT_SCHEDULE = {
    "compute-sla-risks-every-5-min": {
        "task": "core.tasks.compute_sla_risks",
        "schedule": 300.0,   # seconds (5 minutes)
        "args": (),
    },
}


# Django cache: prefer Redis when available, otherwise local-memory
if os.getenv("REDIS_URL"):
    CACHES = {
        "default": {
            "BACKEND": "django_redis.cache.RedisCache",
            "LOCATION": os.getenv("REDIS_URL"),
            "OPTIONS": {"CLIENT_CLASS": "django_redis.client.DefaultClient"},
        }
    }
else:
    # simple fallback - not shared across processes (useful for local dev)
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "unique-snowflake",
        }
    }


BASE_DIR = Path(__file__).resolve().parent.parent

# Feature toggles
FEATURE_TOGGLES = {
    "AUTO_ASSIGN": os.environ.get("FEATURE_AUTO_ASSIGN", "false").lower() in ("1", "true", "yes"),
}



# Security / debug
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "django-insecure-replace-this-in-production")
DEBUG = os.environ.get("DJANGO_DEBUG", "true").lower() in ("1", "true", "yes")

AUTO_ASSIGN_MODE = "rules"

# Hosts (comma-separated in env)
_allowed = os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")
ALLOWED_HOSTS = [h.strip() for h in _allowed.split(",") if h.strip()]

# Installed apps
INSTALLED_APPS = [
    # corsheaders must appear before CommonMiddleware in MIDDLEWARE (and only once)
    "corsheaders",
    # helpful in dev containers for static serving (optional)
    "whitenoise.runserver_nostatic",

    # Django builtins
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",

    # third-party
    "rest_framework",
    "rest_framework_simplejwt",

    # local apps
    "core.apps.CoreConfig",
]

# Middleware (order matters; cors first)
MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",             # must be high
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",        # keep for admin/templates
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "server.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],  # add BASE_DIR / "templates" if you use templates
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "server.wsgi.application"

# Database selection (toggle with USE_SQLITE env)
USE_SQLITE = os.environ.get("USE_SQLITE", "true").lower() in ("1", "true", "yes")

if USE_SQLITE:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.environ.get("POSTGRES_DB", "hofsmart"),
            "USER": os.environ.get("POSTGRES_USER", "hofuser"),
            "PASSWORD": os.environ.get("POSTGRES_PASSWORD", "hofpass"),
            "HOST": os.environ.get("POSTGRES_HOST", "db"),
            "PORT": os.environ.get("POSTGRES_PORT", "5432"),
        }
    }

# CSRF / CORS: allow dev servers (adjust for production)
CSRF_TRUSTED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

CORS_ALLOW_ALL_ORIGINS = True
CORS_ALLOW_CREDENTIALS = True

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# Internationalization / timezone
LANGUAGE_CODE = "en-us"
TIME_ZONE = os.environ.get("TIME_ZONE", "Africa/Harare")
USE_I18N = True
USE_TZ = True

# Static files (Whitenoise)
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [
    # BASE_DIR / "static",
]
STATICFILES_STORAGE = "whitenoise.storage.CompressedStaticFilesStorage"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Simple JWT settings
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=int(os.environ.get("JWT_ACCESS_MINUTES", 30))),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=int(os.environ.get("JWT_REFRESH_DAYS", 7))),
    "ROTATE_REFRESH_TOKENS": False,
    "BLACKLIST_AFTER_ROTATION": False,
    # keep defaults for signing algorithm, etc.
}

# DRF configuration — JWT only for API authentication (avoids CSRF issues on API)
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticatedOrReadOnly",
    ),
    # optionally add pagination, throttling, etc.
}

# Logging — minimal for dev; adjust as needed
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "simple": {"format": "[%(levelname)s] %(message)s"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "simple"},
    },
    "root": {"handlers": ["console"], "level": os.environ.get("DJANGO_LOG_LEVEL", "INFO")},
}

# -- End of settings.py --
