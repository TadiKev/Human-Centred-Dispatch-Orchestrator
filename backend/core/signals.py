# backend/core/signals.py
import logging
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from django.contrib.auth import get_user_model

from .models import Profile, Assignment

logger = logging.getLogger(__name__)

# Try to import task helpers, but do not let missing celery/tasks break startup.
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
    Ensure a Profile exists for each User. Safe to call repeatedly.
    """
    try:
        if created:
            Profile.objects.create(user=instance)
        else:
            # instance.profile may not exist in some edge cases; use get_or_create defensively
            Profile.objects.get_or_create(user=instance)
    except Exception as exc:
        logger.exception("Failed to create/update Profile for user %s: %s", getattr(instance, "pk", None), exc)


@receiver(post_save, sender=Assignment)
def assignment_saved(sender, instance, created, **kwargs):
    """
    When an Assignment is created/updated we schedule a background itinerary regeneration
    for the affected technician (best-effort). If tasks aren't configured we log and continue.
    """
    tech = instance.technician
    if not tech:
        return

    # Best-effort call to celery task (or dummy). Wrap in try/except so this signal cannot crash startup.
    try:
        if regenerate_itinerary_task is not None:
            # some dummy wrappers may not accept keyword args; call as positional
            regenerate_itinerary_task.delay(tech.id)
        else:
            logger.debug("regenerate_itinerary_task not configured; skipping background refresh for tech %s", tech.id)
    except Exception as exc:
        logger.exception("Error calling regenerate_itinerary_task.delay for tech %s: %s", tech.id, exc)


@receiver(post_delete, sender=Assignment)
def assignment_deleted(sender, instance, **kwargs):
    """
    When an Assignment is deleted, schedule itinerary regen for the technician.
    """
    tech = instance.technician
    if not tech:
        return

    try:
        if regenerate_itinerary_task is not None:
            regenerate_itinerary_task.delay(tech.id)
        else:
            logger.debug("regenerate_itinerary_task not configured; skipping background refresh for tech %s", tech.id)
    except Exception as exc:
        logger.exception("Error calling regenerate_itinerary_task.delay for tech %s: %s", tech.id, exc)
