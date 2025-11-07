# backend/core/__init__.py
# Keep this file minimal. Rely on AppConfig.ready() to import signals safely.
# If you want older Django behaviour, you can set default_app_config, but Django 3.2+ auto-discovers AppConfig.
default_app_config = "core.apps.CoreConfig"
