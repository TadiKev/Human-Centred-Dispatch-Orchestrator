# backend/core/ml_client.py
import os
import json
import time
import hashlib
import logging
from typing import Any, Dict, Optional

import requests
from requests.adapters import HTTPAdapter, Retry

from django.core.cache import cache
from django.conf import settings

LOG = logging.getLogger("core.ml_client")

# Configurable via env or Django settings (recommended defaults)
ML_SERVICE_URL = getattr(settings, "ML_SERVICE_URL", os.environ.get("ML_SERVICE_URL", "http://ml_service:8000"))
ML_ROLLOUT_PCT = float(getattr(settings, "ML_ROLLOUT_PCT", os.environ.get("ML_ROLLOUT_PCT", 100)))  # 0..100
ML_CACHE_TTL_SECONDS = int(getattr(settings, "ML_CACHE_TTL_SECONDS", os.environ.get("ML_CACHE_TTL_SECONDS", 86400)))  # 1 day
ML_REQUEST_TIMEOUT = float(getattr(settings, "ML_REQUEST_TIMEOUT", os.environ.get("ML_REQUEST_TIMEOUT", 5.0)))
DISABLE_FALLBACK = str(getattr(settings, "DISABLE_FALLBACK", os.environ.get("DISABLE_FALLBACK", "false"))).lower() == "true"
ROLLOUT_STICKY_KEY = getattr(settings, "ROLLOUT_STICKY_KEY", os.environ.get("ROLLOUT_STICKY_KEY", "")) or ""

# requests session with retries
_session: Optional[requests.Session] = None


def _get_session() -> requests.Session:
    global _session
    if _session is not None:
        return _session
    s = requests.Session()
    retries = Retry(total=2, backoff_factor=0.2, status_forcelist=(500, 502, 503, 504))
    s.mount("http://", HTTPAdapter(max_retries=retries))
    s.mount("https://", HTTPAdapter(max_retries=retries))
    _session = s
    return _session


def _deterministic_rollout(key: str, pct: float) -> bool:
    """
    Deterministic rollout decision based on hex(hash) mod 100 < pct.
    key: unique string per-request (job_id or payload fingerprint)
    pct: 0..100
    """
    try:
        if pct <= 0:
            return False
        if pct >= 100:
            return True
        h = hashlib.sha256((ROLLOUT_STICKY_KEY + "|" + str(key)).encode("utf-8")).hexdigest()
        val = int(h[:8], 16) % 100
        return val < int(pct)
    except Exception:
        return True  # default to allow when unsure


def _mask_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Minimal masking before caching/logging. Removes customer_name entirely.
    Adjust to mask other PII as needed.
    """
    p = dict(payload or {})
    if "customer_name" in p:
        p["customer_name"] = "[REDACTED]"
    return p


def _call_ml_service(path: str, payload: Dict[str, Any], timeout: float = ML_REQUEST_TIMEOUT) -> Dict[str, Any]:
    url = ML_SERVICE_URL.rstrip("/") + path
    s = _get_session()
    headers = {"Content-Type": "application/json"}
    start = time.time()
    try:
        r = s.post(url, json=payload, headers=headers, timeout=timeout)
        r.raise_for_status()
        return r.json()
    except requests.HTTPError as e:
        LOG.warning("ML service HTTP error %s %s: %s", url, e, getattr(e, "response", None).text if getattr(e, "response", None) else "")
        raise
    except Exception as e:
        LOG.exception("ML service call failed %s: %s", url, e)
        raise
    finally:
        LOG.debug("ML call %s took %.3fs", path, time.time() - start)


def predict_no_show(payload: Dict[str, Any], cache_ttl: Optional[int] = None, rollout_key: Optional[str] = None) -> Dict[str, Any]:
    """
    Returns dict with fields:
      - predictions (list) or predicted (legacy)
      - probabilities (list) optional
      - model_version, fallback, used_ml
    Implements deterministic rollout and caching.
    """
    if cache_ttl is None:
        cache_ttl = ML_CACHE_TTL_SECONDS

    # use deterministic key if provided, else use fingerprint of payload
    key = rollout_key or hashlib.sha256(json.dumps(_mask_payload(payload), sort_keys=True).encode("utf-8")).hexdigest()
    cache_key = f"ml:no_show:{key}"
    cached = cache.get(cache_key)
    if cached is not None:
        LOG.debug("No-show cache hit %s", cache_key)
        return cached

    # decide rollout (if rollout < 100, fallback to rule-based; empty rollout_key uses payload fingerprint)
    use_ml = _deterministic_rollout(key, ML_ROLLOUT_PCT)

    if not use_ml:
        LOG.info("No-show: rollout decision -> fallback (key=%s pct=%s)", key, ML_ROLLOUT_PCT)
        # return structured fallback that other code can detect (used_ml False)
        out = {"predictions": [0], "probabilities": [0.25], "model_version": None, "fallback": True, "used_ml": False}
        cache.set(cache_key, out, cache_ttl)
        return out

    # call ML service
    try:
        resp = _call_ml_service("/predict/no_show/", payload)
        # normalize minimal fields
        out = {
            "predictions": resp.get("predictions") or resp.get("predicted") or [],
            "probabilities": resp.get("probabilities"),
            "model_version": resp.get("model_version"),
            "fallback": resp.get("fallback", False),
            "used_ml": resp.get("used_ml", True) if "used_ml" in resp else not resp.get("fallback", False)
        }
    except Exception:
        # fallback behaviour if ML service down
        if DISABLE_FALLBACK:
            raise
        LOG.info("No-show ML failed; returning fallback suggestion")
        out = {"predictions": [0], "probabilities": [0.25], "model_version": None, "fallback": True, "used_ml": False}

    cache.set(cache_key, out, cache_ttl)
    return out


def predict_duration(payload: Dict[str, Any], cache_ttl: Optional[int] = None, rollout_key: Optional[str] = None) -> Dict[str, Any]:
    """
    Similar to predict_no_show but returns predicted_duration.
    """
    if cache_ttl is None:
        cache_ttl = ML_CACHE_TTL_SECONDS

    key = rollout_key or hashlib.sha256(json.dumps(_mask_payload(payload), sort_keys=True).encode("utf-8")).hexdigest()
    cache_key = f"ml:duration:{key}"
    cached = cache.get(cache_key)
    if cached is not None:
        LOG.debug("Duration cache hit %s", cache_key)
        return cached

    use_ml = _deterministic_rollout(key, ML_ROLLOUT_PCT)
    if not use_ml:
        LOG.info("Duration: rollout decision -> fallback (key=%s pct=%s)", key, ML_ROLLOUT_PCT)
        out = {"predicted_duration": [payload.get("estimated_duration_minutes") or 60], "model_version": None, "fallback": True, "used_ml": False}
        cache.set(cache_key, out, cache_ttl)
        return out

    try:
        resp = _call_ml_service("/predict/duration/", payload)
        out = {
            "predicted_duration": resp.get("predicted_duration") or resp.get("predictions") or [],
            "probabilities": resp.get("probabilities"),
            "model_version": resp.get("model_version"),
            "fallback": resp.get("fallback", False),
            "used_ml": resp.get("used_ml", True) if "used_ml" in resp else not resp.get("fallback", False)
        }
    except Exception:
        if DISABLE_FALLBACK:
            raise
        LOG.info("Duration ML failed; using estimated_duration_minutes fallback")
        out = {"predicted_duration": [payload.get("estimated_duration_minutes") or 60], "model_version": None, "fallback": True, "used_ml": False}

    cache.set(cache_key, out, cache_ttl)
    return out


# convenience helpers for job model objects
def predict_duration_for_job(job, cache_ttl: Optional[int] = None) -> Dict[str, Any]:
    payload = {
        "assigned_technician_id": getattr(job, "assigned_technician_id", None),
        "distance_km": getattr(job, "distance_km", getattr(job, "distance", None)) or getattr(job, "distance_km", None),
        "estimated_duration_minutes": getattr(job, "estimated_duration_minutes", None),
        "is_peak_hour": int(bool(getattr(job, "is_peak_hour", None))),
        "num_required_skills": getattr(job, "required_skills").count() if hasattr(job, "required_skills") else None,
        "tech_skill_match_count": None,
        "time_of_day": getattr(job, "time_of_day", None) or None,
        "weekday": getattr(job, "requested_window_start", None) and getattr(job, "requested_window_start").strftime("%A") or None,
    }
    key = f"job:{getattr(job, 'id', '')}"
    return predict_duration(payload, cache_ttl=cache_ttl, rollout_key=key)


def predict_no_show_for_job(job, cache_ttl: Optional[int] = None) -> Dict[str, Any]:
    payload = {
        "assigned_technician_id": getattr(job, "assigned_technician_id", None),
        "distance_km": getattr(job, "distance_km", getattr(job, "distance", None)) or getattr(job, "distance_km", None),
        "estimated_duration_minutes": getattr(job, "estimated_duration_minutes", None),
        "is_peak_hour": int(bool(getattr(job, "is_peak_hour", None))),
        "num_required_skills": getattr(job, "required_skills").count() if hasattr(job, "required_skills") else None,
        "tech_skill_match_count": None,
        "time_of_day": getattr(job, "time_of_day", None) or None,
        "weekday": getattr(job, "requested_window_start", None) and getattr(job, "requested_window_start").strftime("%A") or None,
    }
    key = f"job:{getattr(job, 'id', '')}"
    return predict_no_show(payload, cache_ttl=cache_ttl, rollout_key=key)
