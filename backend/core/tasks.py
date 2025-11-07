# backend/core/tasks.py
"""
Safe tasks module.

- If Celery is installed, register real tasks (shared_task).
- Otherwise provide dummy task-like objects with .delay() that no-op (and log)
  so imports and calls from signals/views won't raise at import time.
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)

# Try to import Celery's shared_task. If unavailable, we create dummy tasks.
try:
    from celery import shared_task  # type: ignore
    CELERY_AVAILABLE = True
except Exception as exc:
    shared_task = None  # type: ignore
    CELERY_AVAILABLE = False
    logger.debug("Celery not available: %s", exc)


if CELERY_AVAILABLE and shared_task is not None:
    # Real (lightweight) Celery tasks. Keep them minimal to avoid heavy imports at module import-time.

    @shared_task(bind=False)
    def regenerate_itinerary_task(tech_id: int, use_ortools: bool = False, speed_kmph: float = 40.0) -> dict:
        """
        Recompute and cache itinerary for technician `tech_id`.
        This function intentionally imports compute helper lazily to avoid circular imports.
        """
        try:
            from django.core.cache import cache
            from django.utils import timezone
            # compute_itinerary_for_technician should be implemented to return the same payload as the API view.
            try:
                from .itinerary import compute_itinerary_for_technician
            except Exception:
                # If you don't have a compute helper, fallback to None
                compute_itinerary_for_technician = None

            now = timezone.now()
            if compute_itinerary_for_technician:
                result = compute_itinerary_for_technician(tech_id, now=now, use_ortools=use_ortools, speed_kmph=speed_kmph)
                cache_key = f"itinerary:tech:{tech_id}:speed:{int(speed_kmph)}"
                cache.set(cache_key, result, timeout=60 * 60 * 24)
                return {"ok": True, "tech_id": tech_id, "num_stops": len(result.get("current", {}).get("stops", []))}
            else:
                # Nothing to compute; still return success marker
                return {"ok": True, "tech_id": tech_id, "note": "no compute helper available"}
        except Exception as exc:
            logger.exception("regenerate_itinerary_task failed for tech %s", tech_id)
            return {"ok": False, "error": str(exc)}


    @shared_task(bind=False)
    def auto_assign_job_task(job_id: int, creator_user_id: int = None, weights: Any = None) -> dict:
        """
        Background job auto-assignment using the rule engine.
        """
        try:
            from django.shortcuts import get_object_or_404
            from django.db import transaction
            from .models import Job, Technician, Assignment
            from .auto_assign import rule_based_candidates
            from django.contrib.auth import get_user_model

            JobModel = Job
            job = get_object_or_404(JobModel, pk=job_id)
            result = rule_based_candidates(job, weights=weights)
            chosen = result.get("chosen")
            if not chosen:
                return {"ok": False, "reason": "no_candidate"}

            tech = get_object_or_404(Technician, pk=chosen["technician_id"])

            creator = None
            if creator_user_id:
                try:
                    creator = get_user_model().objects.get(pk=creator_user_id)
                except Exception:
                    creator = None

            with transaction.atomic():
                assignment = Assignment.objects.create(
                    job=job,
                    technician=tech,
                    score_breakdown=chosen.get("score_breakdown", {}),
                    reason=f"Auto-assigned (bg task): {chosen.get('explanation', {}).get('text','')}",
                    created_by=creator,
                )
                job.assigned_technician = tech
                job.status = getattr(job, "STATUS_ASSIGNED", "assigned")
                job.save(update_fields=["assigned_technician", "status"])

            return {"ok": True, "assignment_id": assignment.id, "auto_assign_result": result}
        except Exception as exc:
            logger.exception("auto_assign_job_task failed for job %s", job_id)
            return {"ok": False, "error": str(exc)}


else:
    # Celery not available: provide dummy task objects with .delay() method that no-op but log.
    class _DummyTask:
        def __init__(self, name: str):
            self._name = name

        def delay(self, *args: Any, **kwargs: Any):
            try:
                logger.debug("DummyTask %s called .delay args=%s kwargs=%s", self._name, args, kwargs)
            except Exception:
                pass
            return None

    regenerate_itinerary_task = _DummyTask("regenerate_itinerary_task")
    auto_assign_job_task = _DummyTask("auto_assign_job_task")

# core/tasks.py
from celery import shared_task
from django.utils import timezone
from datetime import timedelta
from django.db import transaction
import logging

from .models import Job, Assignment, Technician, SLAAction
from .auto_assign import haversine_km, choose_best_candidate

logger = logging.getLogger(__name__)

# tuning constants
DEFAULT_TRAVEL_SPEED_KMH = 40.0  # assumption for ETA
MEDIUM_RISK_MINUTES = 15
HIGH_RISK_MINUTES = 0  # predicted_arrival after window_end => high

def estimate_travel_time_minutes(job_lat, job_lon, tech_lat, tech_lon, speed_kmh=DEFAULT_TRAVEL_SPEED_KMH):
    if None in (job_lat, job_lon, tech_lat, tech_lon):
        return None
    dist = haversine_km(job_lat, job_lon, tech_lat, tech_lon)
    if dist is None:
        return None
    # minutes = hours * 60
    hours = dist / float(max(1e-6, speed_kmh))
    return hours * 60.0

def predict_arrival_for_job(job, now=None):
    """
    Simple prediction:
      predicted_arrival = now + travel_time_to_job + queue_time
    queue_time = sum remaining estimated_duration_minutes of assignments for assigned tech that start before this job
    This is an approximation but good enough for SLA risk detection.
    """
    if now is None:
        now = timezone.now()

    assigned = getattr(job, "assigned_technician", None)
    if not assigned:
        return None

    try:
        tech = assigned
        # if assigned is a Technician instance or a FK
        if hasattr(tech, "last_lat"):
            tech_lat = tech.last_lat
            tech_lon = tech.last_lon
        else:
            tech_lat = None
            tech_lon = None
    except Exception:
        return None

    job_lat = getattr(job, "lat", None) or getattr(job, "latitude", None)
    job_lon = getattr(job, "lon", None) or getattr(job, "longitude", None)

    travel_minutes = estimate_travel_time_minutes(job_lat, job_lon, tech_lat, tech_lon)
    # queue_time: sum of durations for assignments for this technician with status 'assigned' and created earlier than job
    # fallback: zero
    queue_minutes = 0.0
    try:
        # choose assignments for this technician excluding this job
        future_asgs = Assignment.objects.filter(
            technician=getattr(tech, "id", tech),
        ).exclude(job=job).order_by("created_at")
        # naive: sum up estimated durations for assignments that are likely to run before this job
        for a in future_asgs:
            # If assignment job requested_window_start is before this job's window_start, assume runs earlier
            other_job = a.job
            if getattr(other_job, "requested_window_start", None) and getattr(job, "requested_window_start", None):
                if other_job.requested_window_start <= job.requested_window_start:
                    queue_minutes += float(other_job.estimated_duration_minutes or 0)
            else:
                queue_minutes += float(other_job.estimated_duration_minutes or 0)
    except Exception:
        queue_minutes = 0.0

    if travel_minutes is None:
        # if we can't compute travel, still use queue time
        predicted = now + timedelta(minutes=queue_minutes)
    else:
        predicted = now + timedelta(minutes=(travel_minutes + queue_minutes))

    diagnostics = {
        "travel_minutes": travel_minutes,
        "queue_minutes": queue_minutes,
        "predicted_arrival_iso": predicted.isoformat(),
    }
    return predicted, diagnostics

@shared_task(bind=True)
def compute_sla_risks(self, max_jobs=200):
    """
    Periodic celery task that computes SLA risk for assigned jobs.
    Creates SLAAction for medium/high risk jobs.
    """
    now = timezone.now()
    # Consider jobs that are assigned and not completed/cancelled
    candidate_jobs = Job.objects.filter(status__in=["assigned", "scheduled"]).order_by("requested_window_start")[:max_jobs]
    created = 0
    for job in candidate_jobs:
        try:
            predicted_tuple = predict_arrival_for_job(job, now=now)
            if predicted_tuple is None:
                continue
            predicted, diag = predicted_tuple
            # use job.requested_window_end as SLA deadline; if not present use requested_window_start + estimated_duration
            window_end = getattr(job, "requested_window_end", None)
            if window_end is None and getattr(job, "requested_window_start", None):
                window_end = job.requested_window_start + timedelta(minutes=(job.estimated_duration_minutes or 0))

            if window_end is None:
                continue

            # compute delta in minutes: positive => predicted after window_end (bad)
            delta_min = (predicted - window_end).total_seconds() / 60.0
            # risk_score normalized: clamp [-120..120] map to 0..1 (arrive 120 min late => 1, arrive 120 min early => 0)
            clamp = max(-120.0, min(120.0, delta_min))
            risk_score = (clamp + 120.0) / 240.0
            # classify
            if delta_min > HIGH_RISK_MINUTES:
                level = "high"
            elif delta_min >= -MEDIUM_RISK_MINUTES:
                level = "medium"
            else:
                level = "low"

            # pick recommended action
            recommended_action = None
            suggested_technician = None
            candidates = None
            # High or medium risk -> recommend reassign (first) then notify
            if level in ("high", "medium"):
                # call chooser to find alternative candidate (exclude current technician by filtering QS)
                try:
                    # Use choose_best_candidate to get candidate list
                    from .auto_assign import rule_based_candidates
                    # build technicians_qs that excludes current tech
                    tech_qs = Technician.objects.exclude(pk=getattr(job.assigned_technician, "id", None))
                    rb = rule_based_candidates(job, technicians_qs=tech_qs, top_n=3)
                    candidates = rb.get("candidates", [])
                    if candidates:
                        recommended_action = "reassign"
                        suggested_technician_id = candidates[0].get("technician_id")
                        try:
                            suggested_technician = Technician.objects.get(pk=suggested_technician_id)
                        except Technician.DoesNotExist:
                            suggested_technician = None
                except Exception as e:
                    logger.exception("choose candidate for SLA failed: %s", e)
                    candidates = []
                    recommended_action = "notify"
            else:
                recommended_action = None

            # Create SLAAction for medium/high risk (or update existing pending one)
            if level in ("high", "medium"):
                with transaction.atomic():
                    # Avoid duplicate pending actions for same job + reason by checking recent ones
                    existing = SLAAction.objects.filter(job=job, status="pending").order_by("-created_at").first()
                    if existing:
                        # update if new risk higher
                        if existing.risk_score < risk_score:
                            existing.risk_score = risk_score
                            existing.risk_level = level
                            existing.recommended_action = recommended_action or existing.recommended_action
                            existing.meta.update({"diag": diag, "candidates": candidates})
                            existing.save(update_fields=["risk_score", "risk_level", "recommended_action", "meta"])
                            created += 1
                    else:
                        sla = SLAAction.objects.create(
                            job=job,
                            recommended_action=recommended_action or "notify",
                            reason=f"SLA risk detected (level={level}, delta_min={round(delta_min,1)})",
                            suggested_technician=suggested_technician,
                            risk_score=risk_score,
                            risk_level=level,
                            status="pending",
                            meta={"diag": diag, "candidates": candidates},
                        )
                        created += 1
        except Exception as e:
            logger.exception("Error computing SLA for job %s: %s", getattr(job, "id", "<unknown>"), e)
            continue

    logger.info("compute_sla_risks: created/updated %d SLAAction(s)", created)
    return {"created": created}
