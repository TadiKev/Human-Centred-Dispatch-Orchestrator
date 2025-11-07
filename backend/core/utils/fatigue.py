# backend/core/utils/fatigue.py
"""
Fatigue and skill-decay helpers.

Functions:
 - compute_fatigue_score(technician) -> float [0..1]
 - skills_with_decay(technician, required_skills, days_threshold=90) -> dict { skill_id: True/False }
 - human_readable_fatigue_breakdown(technician) -> dict (debug)
Assumptions:
 - Job model exists and may have fields: assigned_technician (FK to Technician),
   departure_time/arrival_time or updated_at/created_at/service_minutes. We use defensive queries.
 - Skill instances are model objects (id or object convertible).
 - If DB does not contain the detailed info we fall back to conservative defaults.
"""
from datetime import timedelta
from django.utils import timezone
from django.db.models import Q, Sum, F
import math
import logging

logger = logging.getLogger(__name__)

DEFAULT_FATIGUE_THRESHOLD = 0.75  # above this => unsafe / block auto-assign by default


def _get_recent_jobs_for_tech(tech, since_dt):
    from core.models import Job  # local import to avoid circular imports if any
    # Defensive queries: try different fields
    q = Job.objects.filter(assigned_technician=tech)
    # Filter by updated_at or created_at if available
    try:
        return q.filter(Q(updated_at__gte=since_dt) | Q(created_at__gte=since_dt))
    except Exception:
        try:
            return q.filter(created_at__gte=since_dt)
        except Exception:
            return Job.objects.none()


def compute_fatigue_score(tech):
    """
    Returns float in [0,1] where 0 = no fatigue, 1 = fully fatigued.
    Composite of:
      - hours_worked_last_24h (normalized)
      - jobs_last_8h (normalized)
      - recent_travel_km (normalized)
    Values are combined and squashed into [0,1].
    """
    now = timezone.now()
    # windows
    since_24h = now - timedelta(hours=24)
    since_8h = now - timedelta(hours=8)
    # defaults
    hours_worked = 0.0
    jobs_last_8h = 0
    recent_travel_km = 0.0

    try:
        jobs_24 = _get_recent_jobs_for_tech(tech, since_24h)
        # sum service minutes if exists
        if jobs_24.exists():
            # try to sum service_minutes
            agg = jobs_24.aggregate(total_minutes=Sum("service_minutes"))
            if agg and agg.get("total_minutes"):
                hours_worked = (agg.get("total_minutes") or 0) / 60.0
            else:
                # fallback: estimate from count and an avg 45 min per job
                hours_worked = jobs_24.count() * 0.75
        # jobs in last 8h
        jobs_8 = _get_recent_jobs_for_tech(tech, since_8h)
        jobs_last_8h = jobs_8.count()
        # travel: try to sum stored travel_km on job (distance_from_prev_km), else 0
        try:
            agg2 = jobs_24.aggregate(total_km=Sum("distance_from_prev_km"))
            recent_travel_km = float(agg2.get("total_km") or 0.0)
        except Exception:
            recent_travel_km = 0.0
    except Exception as e:
        logger.debug("compute_fatigue_score fallback: %s", e)
        # keep defaults

    # Normalization heuristics (tunable)
    # - 12 hours work => 1.0 (extreme)
    # - 6 jobs in 8h => 1.0
    # - 200 km recent travel => 1.0
    h_norm = min(hours_worked / 12.0, 1.0)
    j_norm = min(jobs_last_8h / 6.0, 1.0)
    t_norm = min(recent_travel_km / 200.0, 1.0)

    # Weighted composite (weights sum to 1)
    w_h, w_j, w_t = 0.5, 0.3, 0.2
    raw = w_h * h_norm + w_j * j_norm + w_t * t_norm

    # squash curve so moderate values become noticeable
    score = raw ** 1.2
    score = float(max(0.0, min(score, 1.0)))
    return score


def skills_with_decay(tech, required_skills, days_threshold=90):
    """
    Return dict mapping skill identifier -> { 'decayed': True/False, 'last_used': datetime|None }.
    required_skills: list of Skill objects or ids.
    Strategy:
     - For each skill, look for a Job (assigned to this technician) in the past `days_threshold`.
     - If none found -> decayed=True.
    """
    from core.models import Job, Skill
    now = timezone.now()
    threshold = now - timedelta(days=days_threshold)
    out = {}
    # Normalize list of skills to IDs if objects
    skill_ids = []
    for s in required_skills or []:
        try:
            # if passed Skill object
            if hasattr(s, "id"):
                skill_ids.append(s.id)
            else:
                skill_ids.append(int(s))
        except Exception:
            # ignore invalid entries
            continue

    for sid in skill_ids:
        out[sid] = {"decayed": False, "last_used": None}
        try:
            # find most recent job where this tech used the skill (defensive)
            qs = Job.objects.filter(assigned_technician=tech, required_skills__id=sid)
            # prefer jobs with updated_at
            recent = qs.order_by("-updated_at", "-created_at").first()
            if recent:
                last_ts = getattr(recent, "updated_at", None) or getattr(recent, "created_at", None)
                out[sid]["last_used"] = last_ts
                if last_ts is None or last_ts < threshold:
                    out[sid]["decayed"] = True
                else:
                    out[sid]["decayed"] = False
            else:
                # no job ever -> decay
                out[sid]["decayed"] = True
                out[sid]["last_used"] = None
        except Exception as e:
            logger.debug("skills_with_decay unexpected: %s", e)
            out[sid]["decayed"] = True
            out[sid]["last_used"] = None

    return out


def human_readable_fatigue_breakdown(tech):
    """Optional debug helper returning the numeric components."""
    now = timezone.now()
    since_24h = now - timedelta(hours=24)
    jobs_24 = _get_recent_jobs_for_tech(tech, since_24h)
    try:
        total_minutes = jobs_24.aggregate(total_minutes=Sum("service_minutes")).get("total_minutes") or 0
    except Exception:
        total_minutes = jobs_24.count() * 45
    return {
        "hours_worked_last_24h": float(total_minutes / 60.0),
        "jobs_last_24h": jobs_24.count()
    }
