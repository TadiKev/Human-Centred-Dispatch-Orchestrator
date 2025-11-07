# backend/core/auto_assign.py
import math
from django.utils import timezone
from django.db.models import Count
from datetime import timedelta

from .models import Technician, Assignment

# --- simple haversine distance in km
def haversine_km(lat1, lon1, lat2, lon2):
    try:
        R = 6371.0
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlambda = math.radians(lon2 - lon1)
        a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return R * c
    except Exception:
        return None


def rule_based_candidates(job, technicians_qs=None, top_n=5, now=None, weights=None):
    """
    Compute rule-based candidate scores for a given Job instance.
    Returns a sorted list of candidate dicts (desc by score).
    weights: dict override for scoring weights, e.g. {"w_skill":10, "w_dist":4, "w_avail":5, "w_fatigue":1}
    """
    if now is None:
        now = timezone.now()

    if technicians_qs is None:
        technicians_qs = Technician.objects.select_related("user").prefetch_related("skills").all()

    # defaults
    w = {"w_skill": 10.0, "w_dist": 4.0, "w_avail": 5.0, "w_fatigue": 2.0}
    if isinstance(weights, dict):
        w.update(weights)

    required_skills = list(job.required_skills.all())
    req_skill_ids = {s.id for s in required_skills}

    # Precompute fatigue: assignments per tech in last 24h (or 7 days if you prefer)
    since = now - timedelta(hours=24)
    recent_counts = (
        Assignment.objects.filter(created_at__gte=since)
        .values("technician")
        .annotate(cnt=Count("id"))
    )
    fatigue_map = {rc["technician"]: rc["cnt"] for rc in recent_counts}

    candidates = []
    for tech in technicians_qs:
        tech_skill_ids = {s.id for s in tech.skills.all()}
        skill_match_count = len(req_skill_ids & tech_skill_ids)

        # distance km (may be None)
        dist_km = None
        if job.lat is not None and job.lon is not None and tech.last_lat is not None and tech.last_lon is not None:
            dist_km = haversine_km(job.lat, job.lon, tech.last_lat, tech.last_lon)

        # availability
        availability = 1 if (tech.status or "").lower() == "available" else 0

        # fatigue score (higher -> more penalty). Simple: use number of assignments in last 24h
        fatigue_count = fatigue_map.get(tech.id, 0)
        fatigue_penalty = fatigue_count

        # build components
        components = {}
        # skill contribution: linear
        components["skill_match_count"] = skill_match_count
        skill_score = w["w_skill"] * skill_match_count

        # distance contribution: normalized inverse (1/(1+dist_km))
        if dist_km is not None:
            # scale factor so that distance contribution is in reasonable range relative to skill_score
            dist_score = w["w_dist"] * (1.0 / (1.0 + dist_km))
            components["distance_km"] = round(dist_km, 3)
        else:
            dist_score = 0.0
            components["distance_km"] = None

        components["distance_score"] = round(dist_score, 3)
        # availability contribution
        avail_score = w["w_avail"] * availability
        components["availability"] = availability
        components["availability_score"] = round(avail_score, 3)

        # fatigue penalty
        fatigue_score = w["w_fatigue"] * fatigue_penalty
        components["fatigue_count"] = fatigue_count
        components["fatigue_penalty"] = round(fatigue_score, 3)

        # total
        total = skill_score + dist_score + avail_score - fatigue_score
        components["score"] = round(total, 3)

        explanation = {
            "text": f"Skill matches: {skill_match_count}, availability: {availability}, distance_km: {components['distance_km']}, fatigue_cnt: {fatigue_count}",
            "components": components,
        }

        candidates.append({
            "technician_id": tech.id,
            "username": getattr(getattr(tech, "user", None), "username", str(tech)),
            "status": tech.status,
            "skills": [{"id": s.id, "name": s.name} for s in tech.skills.all()],
            "score": round(total, 3),
            "score_breakdown": components,
            "explanation": explanation,
            "dist_km": components["distance_km"],
            "fatigue_count": fatigue_count,
        })

    # sort descending by score
    candidates_sorted = sorted(candidates, key=lambda c: c["score"], reverse=True)

    # if there are required skills and no candidate has skill_match_count > 0, relax: return top by availability+distance anyway.
    if req_skill_ids:
        best_skill_match = max((c["score_breakdown"].get("skill_match_count", 0) for c in candidates_sorted), default=0)
        if best_skill_match == 0:
            # warn: no matching skills present; keep candidates_sorted as-is (they're sorted by composite score)
            pass

    # return top_n and full list
    return {
        "job_id": job.id,
        "chosen": candidates_sorted[0] if candidates_sorted else None,
        "candidates": candidates_sorted[:top_n],
        "all_candidates_count": len(candidates_sorted),
    }
# --- add this to the bottom of backend/core/auto_assign.py ---

def choose_best_candidate(job, technicians_qs=None, top_n=5, allow_override=False, now=None, weights=None):
    """
    Thin wrapper around rule_based_candidates that provides a small policy:
      - returns dict with keys: job_id, chosen, candidates, unsafe (bool), reason (optional)
      - if allow_override=True and all candidates blocked/none found, return top candidate with forced_override flag
    This matches what SLAMitigateAPIView expects.
    """
    if now is None:
        from django.utils import timezone
        now = timezone.now()

    # get the rule-based results
    results = rule_based_candidates(job, technicians_qs=technicians_qs, top_n=top_n, now=now, weights=weights)
    # rule_based_candidates returns: { "job_id", "chosen", "candidates", "all_candidates_count" }
    candidates = results.get("candidates", []) or []
    chosen = results.get("chosen")

    # If no candidates at all
    if not candidates and not chosen:
        return {
            "job_id": results.get("job_id"),
            "chosen": None,
            "candidates": [],
            "unsafe": True,
            "reason": "no_candidates",
        }

    # If chosen exists and looks like a normal candidate, consider it safe
    # (you can tweak logic here — e.g., check for 'blocked' flags if you add them later)
    if chosen:
        return {
            "job_id": results.get("job_id"),
            "chosen": chosen,
            "candidates": candidates,
            "unsafe": False,
        }

    # fallback: no chosen but candidate list present (shouldn't usually happen)
    if candidates:
        top = candidates[0]
        if allow_override:
            top = dict(top)
            top["forced_override"] = True
            return {
                "job_id": results.get("job_id"),
                "chosen": top,
                "candidates": candidates,
                "unsafe": False,
                "reason": "forced_override_used",
                "forced_override": True,
            }
        else:
            return {
                "job_id": results.get("job_id"),
                "chosen": None,
                "candidates": candidates,
                "unsafe": True,
                "reason": "candidates_present_but_no_choice",
            }

    # last-resort safety
    return {
        "job_id": results.get("job_id"),
        "chosen": None,
        "candidates": candidates,
        "unsafe": True,
        "reason": "unknown",
    }
