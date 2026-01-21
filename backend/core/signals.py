# backend/core/signals.py
import logging
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from django.contrib.auth import get_user_model

from .models import Profile, Assignment

logger = logging.getLogger(__name__)

# Try to import optional tasks but don't crash if not available
try:
    from .tasks import regenerate_itinerary_task, auto_assign_job_task  # may be dummy or real
except Exception as exc:
    regenerate_itinerary_task = None
    auto_assign_job_task = None
    logger.debug("core.signals: tasks not available at import time (%s)", exc)

User = get_user_model()


@receiver(post_save, sender=User)
def create_or_update_profile(sender, instance, created, **kwargs):
    """
    Ensure a Profile exists for each User in a safe, idempotent way.
    Uses get_or_create to avoid duplicate-key errors and populates the instance cache.
    """
    try:
        profile, created_flag = Profile.objects.get_or_create(user=instance)
        # Cache profile on the user object so admin code can access instance.profile immediately.
        try:
            setattr(instance, "_profile_cache", profile)
        except Exception:
            logger.debug("Could not set _profile_cache for user %s", getattr(instance, "pk", None))
    except Exception as exc:
        logger.exception("Failed to create/update Profile for user %s: %s", getattr(instance, "pk", None), exc)


@receiver(post_save, sender=Assignment)
def assignment_saved(sender, instance, created, **kwargs):
    tech = getattr(instance, "technician", None)
    if not tech:
        return
    try:
        if regenerate_itinerary_task is not None:
            regenerate_itinerary_task.delay(tech.id)
        else:
            logger.debug("regenerate_itinerary_task not configured; skipping background refresh for tech %s", tech.id)
    except Exception as exc:
        logger.exception("Error calling regenerate_itinerary_task.delay for tech %s: %s", tech.id, exc)


@receiver(post_delete, sender=Assignment)
def assignment_deleted(sender, instance, **kwargs):
    tech = getattr(instance, "technician", None)
    if not tech:
        return
    try:
        if regenerate_itinerary_task is not None:
            regenerate_itinerary_task.delay(tech.id)
        else:
            logger.debug("regenerate_itinerary_task not configured; skipping background refresh for tech %s", tech.id)
    except Exception as exc:
        logger.exception("Error calling regenerate_itinerary_task.delay for tech %s: %s", tech.id, exc)
