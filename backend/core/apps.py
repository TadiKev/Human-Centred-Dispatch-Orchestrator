# backend/core/apps.py
import logging
from django.apps import AppConfig

logger = logging.getLogger(__name__)

class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "core"

    def ready(self):
        """
        Import signals here. Use try/except so missing optional dependencies
        (like celery) do not break Django startup.
        """
        try:
            # Importing signals registers them with Django's signal dispatcher.
            from . import signals  # noqa: F401
        except Exception as exc:
            # Log but do not fail startup
            logger.exception("core.apps.CoreConfig.ready(): failed to import signals: %s", exc)
