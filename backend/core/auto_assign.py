# backend/core/auto_assign.py
# (REPLACE ENTIRE FILE with this content)

"""
Auto-assignment helpers for HOF-SMART.

Features:
- Rule-based candidate scoring (skills, distance, availability, fatigue)
- Fatigue computation using DB aggregates (assigned jobs + recent completed)
- Policy wrapper to choose best candidate with warnings/explanations
- Transactional assignment helper to actually create Assignment and update Job
- Convenience `auto_assign_job` function to be used by views
"""

import math
import logging
import json
from typing import Optional, Dict, Any, List

from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from datetime import timedelta

from .models import Technician, Assignment, Job

logger = logging.getLogger(__name__)


# --- util: haversine distance (km)
def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> Optional[float]:
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


# ---------- Fatigue & metrics computation ----------
def compute_fatigue_metrics(technicians_qs=None, now=None, completed_window_days: int = 7) -> Dict[int, Dict[str, Any]]:
    """
    Aggregate metrics for technicians used to compute fatigue.
    Returns a dict keyed by technician.id with fields:
      {
        "assigned_count": int,
        "recent_completed_count": int,
        "fatigue_raw": float,
      }
    """
    if now is None:
        now = timezone.now()

    if technicians_qs is None:
        technicians_qs = Technician.objects.all()

    tech_list = list(technicians_qs)
    tech_ids = [t.id for t in tech_list]
    metrics = {tid: {"assigned_count": 0, "recent_completed_count": 0, "fatigue_raw": 0.0} for tid in tech_ids}
    if not tech_ids:
        return metrics

    # Assigned count: active assigned/in_progress jobs for each tech
    assigned_qs = (
        Job.objects.filter(assigned_technician__in=tech_ids)
        .filter(Q(status__icontains="assigned") | Q(status__icontains="in_progress") | Q(status__icontains="in progress"))
        .values("assigned_technician")
        .annotate(cnt=Count("id"))
    )
    for row in assigned_qs:
        tid = row.get("assigned_technician")
        if tid in metrics:
            metrics[tid]["assigned_count"] = int(row.get("cnt", 0))

    # Recent completed: assignments created within window (proxy for completed work)
    since = now - timedelta(days=completed_window_days)
    recent_completed_qs = (
        Assignment.objects.filter(created_at__gte=since)
        .values("technician")
        .annotate(cnt=Count("id"))
    )
    for row in recent_completed_qs:
        tid = row.get("technician")
        if tid in metrics:
            metrics[tid]["recent_completed_count"] = int(row.get("cnt", 0))

    # Build raw fatigues (tunable weights)
    w_assigned = 1.0
    w_recent_completed = 0.4
    for tid, m in metrics.items():
        m["fatigue_raw"] = (m["assigned_count"] * w_assigned) + (m["recent_completed_count"] * w_recent_completed)

    return metrics


def _normalize_fatigue_map(metrics_map: Dict[int, Dict[str, Any]]) -> Dict[int, Dict[str, Any]]:
    """
    Normalize fatigue_raw values to 0..1 scale (fatigue_score).
    Mutates metrics_map by adding "fatigue_score".
    """
    vals = [m.get("fatigue_raw", 0.0) for m in metrics_map.values()]
    if not vals:
        return metrics_map
    min_v = min(vals)
    max_v = max(vals)
    denom = (max_v - min_v) if (max_v - min_v) > 0 else 1.0
    for tid, m in metrics_map.items():
        raw = m.get("fatigue_raw", 0.0)
        m["fatigue_score"] = max(0.0, min(1.0, (raw - min_v) / denom))
    return metrics_map


# ---------- Candidate scoring ----------
def rule_based_candidates(job: Job, technicians_qs=None, top_n: int = 5, now=None, weights: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
    """
    Compute rule-based candidate scores for a Job instance.
    Returns a dict with keys: job_id, chosen, candidates (list), all_candidates_count
    """
    if now is None:
        now = timezone.now()

    if technicians_qs is None:
        technicians_qs = Technician.objects.select_related("user").prefetch_related("skills").all()

    # default weights (tweakable)
    w = {"w_skill": 10.0, "w_dist": 4.0, "w_avail": 5.0, "w_fatigue": 3.0}
    if isinstance(weights, dict):
        w.update(weights)

    required_skills = list(job.required_skills.all())
    req_skill_ids = {s.id for s in required_skills}

    # compute fatigue metrics and normalize
    fatigue_map = compute_fatigue_metrics(technicians_qs=technicians_qs, now=now)
    _normalize_fatigue_map(fatigue_map)

    candidates: List[Dict[str, Any]] = []
    for tech in technicians_qs:
        tech_skill_ids = {s.id for s in tech.skills.all()}
        skill_match_count = len(req_skill_ids & tech_skill_ids)

        # distance (km)
        dist_km = None
        if job.lat is not None and job.lon is not None and tech.last_lat is not None and tech.last_lon is not None:
            try:
                dist_km = haversine_km(float(job.lat), float(job.lon), float(tech.last_lat), float(tech.last_lon))
            except Exception:
                dist_km = None

        # availability flag
        availability = 1 if (tech.status or "").lower() == "available" else 0

        # fatigue metrics for this tech
        f = fatigue_map.get(tech.id, {"assigned_count": 0, "recent_completed_count": 0, "fatigue_score": 0.0})
        fatigue_score = float(f.get("fatigue_score", 0.0))
        assigned_count = int(f.get("assigned_count", 0))
        recent_completed_count = int(f.get("recent_completed_count", 0))

        # components and scores
        components: Dict[str, Any] = {}
        skill_score = w["w_skill"] * skill_match_count

        if dist_km is not None:
            dist_score = w["w_dist"] * (1.0 / (1.0 + dist_km))
            components["distance_km"] = round(dist_km, 3)
        else:
            dist_score = 0.0
            components["distance_km"] = None

        avail_score = w["w_avail"] * availability
        fatigue_penalty = w["w_fatigue"] * fatigue_score

        components["skill_match_count"] = skill_match_count
        components["distance_score"] = round(dist_score, 3)
        components["availability"] = availability
        components["availability_score"] = round(avail_score, 3)
        components["fatigue_score_raw"] = round(f.get("fatigue_raw", 0.0), 3)
        components["fatigue_score"] = round(fatigue_score, 3)
        components["assigned_count"] = assigned_count
        components["recent_completed_count"] = recent_completed_count

        total = skill_score + dist_score + avail_score - fatigue_penalty
        components["score"] = round(total, 3)

        explanation = {
            "text": f"Skill matches: {skill_match_count}; availability: {availability}; distance_km: {components['distance_km']}; fatigue_score: {components['fatigue_score']} (assigned: {assigned_count}, recent_completed: {recent_completed_count})",
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
            "fatigue_count": assigned_count,
            "fatigue_score": fatigue_score,
        })

    # sort by composite score desc
    candidates_sorted = sorted(candidates, key=lambda c: c.get("score", 0.0), reverse=True)

    return {
        "job_id": job.id,
        "chosen": candidates_sorted[0] if candidates_sorted else None,
        "candidates": candidates_sorted[:top_n],
        "all_candidates_count": len(candidates_sorted),
    }


# ---------- Human-readable explanation builder ----------
def _score_components_from_candidate(candidate: Dict[str, Any]) -> Dict[str, float]:
    """
    Map candidate components into numeric contributions so we can rank contributors.
    """
    comps = candidate.get("score_breakdown", {}) or {}
    return {
        "skill": float(comps.get("skill_match_count", 0)) * 1.0,
        "distance": float(comps.get("distance_score", 0.0)),
        "availability": float(comps.get("availability_score", 0.0)),
        "fatigue": -float(comps.get("fatigue_score", 0.0)),  # penalty (negative)
    }


def build_human_readable_explanation(job: Job, candidates: List[Dict[str, Any]], chosen: Optional[Dict[str, Any]], policy: Dict[str, Any]) -> Dict[str, Any]:
    """
    Produce a human-friendly explanation dict for why a technician was chosen.
    """
    if not chosen:
        return {"text": "No suitable candidate was chosen.", "bullets": [], "confidence": 0.0, "alternatives": [], "raw": policy}

    # Robust softmax-based confidence computation with floor
    try:
        min_conf = 0.05
        cand_scores = []
        for c in (candidates[:3] if isinstance(candidates, (list, tuple)) else []):
            try:
                s = c.get("score", None)
                if s is None and isinstance(c.get("score_breakdown", None), dict):
                    s = c.get("score_breakdown", {}).get("score")
                cand_scores.append(float(s) if s is not None else 0.0)
            except Exception:
                cand_scores.append(0.0)

        chosen_score = None
        try:
            chosen_score = chosen.get("score", None)
            if chosen_score is None and isinstance(chosen.get("score_breakdown", None), dict):
                chosen_score = chosen.get("score_breakdown", {}).get("score")
            chosen_score = float(chosen_score) if chosen_score is not None else None
        except Exception:
            chosen_score = None

        confidence = 0.5
        if cand_scores:
            used_scores = list(cand_scores)
            chosen_index = None
            chosen_tid = chosen.get("technician_id") if isinstance(chosen, dict) else None
            if chosen_tid is not None:
                for i, c in enumerate(candidates[:3]):
                    try:
                        if isinstance(c, dict) and (c.get("technician_id") == chosen_tid or c.get("id") == chosen_tid):
                            chosen_index = i
                            break
                    except Exception:
                        continue
            if chosen_index is None and chosen_score is not None:
                used_scores.append(chosen_score)
                chosen_index = len(used_scores) - 1
            if chosen_index is None:
                try:
                    chosen_index = int(used_scores.index(max(used_scores)))
                except Exception:
                    chosen_index = 0

            max_s = max(used_scores) if used_scores else 0.0
            exps = [math.exp(s - max_s) for s in used_scores]
            ssum = sum(exps) if exps else 1.0
            confidence = float(exps[chosen_index] / (ssum or 1.0))
            confidence = max(min_conf, min(0.999, confidence))
        elif chosen_score is not None:
            try:
                confidence = 1.0 / (1.0 + math.exp(-chosen_score / 5.0))
            except Exception:
                confidence = 0.5
            confidence = max(min_conf, min(0.999, confidence))
        else:
            confidence = min_conf
    except Exception:
        confidence = 0.05

    try:
        confidence = round(float(confidence), 3)
    except Exception:
        confidence = 0.05

    comps = chosen.get("score_breakdown", {}) or {}
    bullets = []

    # Skill match
    skill_count = comps.get("skill_match_count", 0)
    if skill_count:
        bullets.append(f"Has {skill_count} required skill(s).")

    # Distance
    dist = comps.get("distance_km", None)
    if dist is not None:
        bullets.append(f"Approx distance: {dist} km.")

    # Availability
    availability = comps.get("availability", 0)
    if availability:
        bullets.append("Currently marked available.")
    else:
        bullets.append("Not marked available.")

    # Fatigue
    fatigue = comps.get("fatigue_score", 0.0)
    assigned_count = comps.get("assigned_count", 0)
    try:
        fval = float(fatigue)
        if fval >= 0.8:
            bullets.append(f"High recent workload (fatigue {fval}, {assigned_count} active/recent jobs).")
        elif fval >= 0.4:
            bullets.append(f"Moderate workload (fatigue {fval}).")
        else:
            bullets.append("Low recent workload.")
    except Exception:
        if fatigue is not None:
            bullets.append(f"Fatigue: {fatigue}.")

    # Top reasons from contributions
    contrib = _score_components_from_candidate(chosen)
    contrib_items = sorted(contrib.items(), key=lambda kv: abs(kv[1]), reverse=True)
    top_reasons = []
    for name, val in contrib_items:
        if name == "skill" and val > 0:
            top_reasons.append("strong skill match")
        elif name == "distance" and val > 0:
            top_reasons.append("close proximity")
        elif name == "availability" and val > 0:
            top_reasons.append("available now")

    summary = ", ".join(top_reasons) if top_reasons else "Best composite score among candidates"

    # Alternatives (top 2)
    alternatives = []
    for alt in candidates[:3]:
        if alt.get("technician_id") == chosen.get("technician_id"):
            continue
        alt_comps = alt.get("score_breakdown", {}) or {}
        alt_desc_parts = []
        if alt_comps.get("skill_match_count", 0):
            alt_desc_parts.append(f"{alt_comps.get('skill_match_count')} skills")
        if alt_comps.get("distance_km") is not None:
            alt_desc_parts.append(f"{alt_comps.get('distance_km')} km")
        alternatives.append({
            "technician_id": alt.get("technician_id"),
            "username": alt.get("username"),
            "reason_short": ", ".join(alt_desc_parts) if alt_desc_parts else None,
            "score": alt.get("score"),
        })
        if len(alternatives) >= 2:
            break

    text = f"Assigned to {chosen.get('username')} — {summary}. Confidence: {int(confidence * 100)}%."
    return {
        "text": text,
        "bullets": bullets,
        "confidence": confidence,
        "alternatives": alternatives,
        "raw": policy,
    }


# ---------- Policy wrapper ----------
def choose_best_candidate(job: Job, technicians_qs=None, top_n: int = 5, allow_override: bool = False, now=None, weights: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
    """
    Choose the 'best' candidate applying a small policy.
    """
    if now is None:
        now = timezone.now()

    results = rule_based_candidates(job, technicians_qs=technicians_qs, top_n=top_n, now=now, weights=weights)
    candidates = results.get("candidates", []) or []
    chosen = results.get("chosen")

    if not candidates and not chosen:
        return {
            "job_id": results.get("job_id"),
            "chosen": None,
            "candidates": [],
            "unsafe": True,
            "reason": "no_candidates",
        }

    if candidates:
        # sort by score desc, then by lower fatigue (prefer low)
        sorted_by_composite = sorted(candidates, key=lambda c: (c.get("score", 0.0), -c.get("fatigue_score", 0.0)), reverse=True)
        if len(sorted_by_composite) >= 2:
            best = sorted_by_composite[0]
            runner_up = sorted_by_composite[1]
            diff = (best.get("score", 0.0) - runner_up.get("score", 0.0)) if runner_up else 999
            if abs(diff) < 1e-3:
                top_slice = sorted_by_composite[:3]
                best = min(top_slice, key=lambda c: c.get("fatigue_score", 0.0))
            chosen = best
        else:
            chosen = sorted_by_composite[0]

    if not chosen:
        if candidates:
            top = candidates[0]
            if allow_override:
                top = dict(top)
                top["forced_override"] = True
                return {"job_id": results.get("job_id"), "chosen": top, "candidates": candidates, "unsafe": False, "reason": "forced_override_used", "forced_override": True}
            else:
                return {"job_id": results.get("job_id"), "chosen": None, "candidates": candidates, "unsafe": True, "reason": "no_safe_candidate"}

    # warnings for high fatigue
    warning = False
    warn_reasons = []
    if chosen.get("fatigue_score", 0.0) >= 0.8:
        warning = True
        warn_reasons.append("high_fatigue")

    return {
        "job_id": results.get("job_id"),
        "chosen": chosen,
        "candidates": candidates,
        "unsafe": False,
        "warning": warning,
        "warning_reasons": warn_reasons,
    }


# ---------- Assignment helpers ----------
def assign_job_to_technician(job: Job, technician: Technician, created_by=None, set_status: Optional[str] = None,
                             score_breakdown: Optional[Dict[str, Any]] = None, reason: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Create an Assignment and update Job.assigned_technician (transactional).
    """
    if job is None or technician is None:
        raise ValueError("job and technician are required")

    with transaction.atomic():
        job.refresh_from_db()
        job.assigned_technician = technician
        if set_status:
            job.status = set_status
        else:
            try:
                if hasattr(Job, "STATUS_ASSIGNED"):
                    job.status = getattr(Job, "STATUS_ASSIGNED")
                else:
                    job.status = "assigned"
            except Exception:
                job.status = "assigned"
        job.save(update_fields=["assigned_technician", "status", "updated_at"] if hasattr(job, "updated_at") else ["assigned_technician", "status"])

        assignment_kwargs = {"job": job, "technician": technician}
        if created_by is not None:
            assignment_kwargs["created_by"] = created_by
        assignment = Assignment.objects.create(**assignment_kwargs)

        try:
            changed = []
            if score_breakdown is not None and hasattr(assignment, "score_breakdown"):
                assignment.score_breakdown = score_breakdown
                changed.append("score_breakdown")
            if reason is not None and hasattr(assignment, "reason"):
                try:
                    assignment.reason = reason
                except Exception:
                    assignment.reason = json.dumps(reason)
                changed.append("reason")
            if changed:
                assignment.save(update_fields=changed)
        except Exception:
            logger.exception("Failed saving score_breakdown/reason on Assignment")

        assignment.refresh_from_db()

    return {
        "ok": True,
        "assignment_id": assignment.id,
        "job_id": job.id,
        "technician_id": technician.id,
    }


def auto_assign_job(job_id: int, allow_override: bool = False, target_technician_id: Optional[int] = None, created_by=None, top_n: int = 5, weights: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
    """
    Convenience function to perform auto-assignment flow.
    """
    try:
        job = Job.objects.select_related("assigned_technician").prefetch_related("required_skills").get(pk=job_id)
    except Job.DoesNotExist:
        return {"ok": False, "error": "job_not_found", "job_id": job_id}

    # if caller requested explicit technician override
    if target_technician_id is not None:
        try:
            tech = Technician.objects.get(pk=target_technician_id)
        except Technician.DoesNotExist:
            return {"ok": False, "error": "technician_not_found", "job_id": job_id, "target_technician_id": target_technician_id}

        try:
            policy = choose_best_candidate(job, technicians_qs=Technician.objects.filter(id=target_technician_id) | Technician.objects.all(), top_n=top_n, allow_override=allow_override, weights=weights)
        except Exception:
            policy = choose_best_candidate(job, technicians_qs=None, top_n=top_n, allow_override=allow_override, weights=weights)

        chosen_candidate = {"technician_id": tech.id, "username": getattr(getattr(tech, "user", None), "username", str(tech))}
        candidates = policy.get("candidates", []) or []
        explanation = build_human_readable_explanation(job, candidates, chosen_candidate, policy)

        try:
            assigned = assign_job_to_technician(job, tech, created_by=created_by, score_breakdown=(chosen_candidate.get("score_breakdown") if isinstance(chosen_candidate, dict) else None), reason=explanation)
            return {
                "ok": True,
                "job_id": job.id,
                "chosen": chosen_candidate,
                "assigned": assigned,
                "explanation": explanation,
                "warning": policy.get("warning", False),
            }
        except Exception as e:
            logger.exception("auto_assign forced assign error")
            return {"ok": False, "error": str(e), "job_id": job.id}

    # normal flow: compute best candidate among technicians
    policy = choose_best_candidate(job, technicians_qs=None, top_n=top_n, allow_override=allow_override, weights=weights)
    chosen = policy.get("chosen")
    candidates = policy.get("candidates", []) or []

    explanation = build_human_readable_explanation(job, candidates, chosen, policy)

    if not chosen:
        return {"ok": False, "job_id": job.id, "chosen": None, "assigned": None, "explanation": explanation, "warning": True, "error": "no_suitable_candidate"}

    chosen_tid = chosen.get("technician_id")
    try:
        tech = Technician.objects.get(pk=chosen_tid)
    except Technician.DoesNotExist:
        return {"ok": False, "job_id": job.id, "error": "chosen_technician_not_found", "chosen": chosen, "explanation": explanation}

    if policy.get("warning", False) and not allow_override:
        return {"ok": False, "job_id": job.id, "chosen": chosen, "assigned": None, "explanation": explanation, "warning": True, "error": "chosen_high_fatigue"}

    try:
        assigned = assign_job_to_technician(job, tech, created_by=created_by,
                                            score_breakdown=chosen.get("score_breakdown"),
                                            reason=explanation)
        return {"ok": True, "job_id": job.id, "chosen": chosen, "assigned": assigned, "explanation": explanation, "warning": policy.get("warning", False)}
    except Exception as e:
        logger.exception("auto_assign assign error")
        return {"ok": False, "job_id": job.id, "error": str(e), "chosen": chosen, "explanation": explanation}
