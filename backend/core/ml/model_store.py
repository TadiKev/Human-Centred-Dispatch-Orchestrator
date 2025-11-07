# backend/core/ml/model_store.py
import joblib
import json
from pathlib import Path
from django.conf import settings
from . import train_models  # for FEATURE_NAMES constant
from math import isnan

MODEL_DIR = Path(getattr(settings, "BASE_DIR", Path(__file__).resolve().parents[3])) / "ml_models"
META_PATH = MODEL_DIR / "meta.json"

_default_median = {
    "required_skills_count": 1.0,
    "estimated_duration_minutes": 60.0,
    "historical_avg_duration": 60.0,
    "tech_experience_years": 2.0,
    "distance_km": 5.0,
}

def _load_meta():
    if META_PATH.exists():
        with open(META_PATH, "r") as fh:
            return json.load(fh)
    return {"feature_names": train_models.FEATURE_NAMES}

def _load_model(name):
    meta = _load_meta()
    mfile = MODEL_DIR / meta.get(name, {}).get("model_file", "")
    if mfile.exists():
        return joblib.load(mfile)
    return None

# Cached loaders
_duration_model = None
_no_show_model = None
_meta = None

def get_models():
    global _duration_model, _no_show_model, _meta
    if _meta is None:
        _meta = _load_meta()
    if _duration_model is None:
        _duration_model = _load_model("regressor") or _load_model("duration_rfr") or _load_model("duration_rfr.joblib")
    if _no_show_model is None:
        _no_show_model = _load_model("classifier") or _load_model("no_show_rfc") or _load_model("no_show_rfc.joblib")
    return _duration_model, _no_show_model, _meta

def extract_features_from_job(job, technician=None):
    """
    job: Job model instance
    technician: optional Technician instance (to compute tech_experience_years)
    Returns dict of FEATURES (feature_name -> value)
    """
    # required_skills_count
    try:
        req_count = job.required_skills.count() if hasattr(job, "required_skills") else (len(getattr(job, "required_skills", [])) if job.required_skills else 0)
    except Exception:
        req_count = _default_median["required_skills_count"]

    est = job.estimated_duration_minutes or _default_median["estimated_duration_minutes"]

    # historical avg duration for a given customer_name (best-effort): fallback to estimated
    hist_avg = getattr(job, "estimated_duration_minutes", None) or est
    try:
        from core.models import Job as JobModel
        qs = JobModel.objects.filter(customer_name=job.customer_name, estimated_duration_minutes__isnull=False).exclude(pk=job.pk)
        if qs.exists():
            hist_avg = qs.aggregate(_avg=models.Avg("estimated_duration_minutes"))["_avg"] or est
    except Exception:
        pass

    # tech experience (years) best-effort (if technician provided or linked via assigned_technician)
    tech_exp = None
    try:
        tech = technician or getattr(job, "assigned_technician", None)
        if tech and hasattr(tech, "user") and tech.user.date_joined:
            import datetime
            diff = datetime.datetime.now(datetime.timezone.utc) - tech.user.date_joined
            tech_exp = max(0, diff.days // 365)
    except Exception:
        tech_exp = None

    # distance: compute from assigned tech last coords if available else median
    dist = _default_median["distance_km"]
    try:
        if job.lat is not None and job.lon is not None and tech and getattr(tech, "last_lat", None) is not None:
            # simple haversine
            from math import radians, sin, cos, sqrt, atan2
            R = 6371.0
            lat1, lon1 = radians(job.lat), radians(job.lon)
            lat2, lon2 = radians(tech.last_lat), radians(tech.last_lon)
            dlat = lat2 - lat1
            dlon = lon2 - lon1
            a = sin(dlat/2)**2 + cos(lat1)*cos(lat2)*sin(dlon/2)**2
            c = 2 * atan2(sqrt(a), sqrt(1-a))
            dist = R * c
    except Exception:
        pass

    features = {
        "required_skills_count": float(req_count),
        "estimated_duration_minutes": float(est),
        "historical_avg_duration": float(hist_avg),
        "tech_experience_years": float(tech_exp) if tech_exp is not None else _default_median["tech_experience_years"],
        "distance_km": float(dist),
    }

    # guard nans
    for k, v in list(features.items()):
        if v is None or (isinstance(v, float) and isnan(v)):
            features[k] = _default_median.get(k, 0.0)
    return features

def predict_for_features(features):
    duration_model, no_show_model, meta = get_models()
    feat_names = meta.get("feature_names", train_models.FEATURE_NAMES)
    X = [features.get(n, 0.0) for n in feat_names]

    # regressor mean + tree-variance as proxy for uncertainty
    if duration_model:
        # mean
        mean_pred = float(duration_model.predict([X])[0])
        # pseudo-std: predictions of individual trees
        try:
            all_preds = [est.predict([X])[0] for est in duration_model.estimators_]
            import statistics
            std_pred = float(statistics.pstdev(all_preds)) if len(all_preds) > 1 else 0.0
        except Exception:
            std_pred = 0.0
    else:
        mean_pred = features.get("estimated_duration_minutes", 60.0)
        std_pred = 15.0

    # classifier probability
    if no_show_model:
        try:
            prob = float(no_show_model.predict_proba([X])[0, 1])
        except Exception:
            # if predict_proba not available use predict
            prob = float(no_show_model.predict([X])[0])
    else:
        prob = 0.05

    # feature importances (regressor if available)
    importances = {}
    try:
        model_for_importance = duration_model or no_show_model
        if model_for_importance and hasattr(model_for_importance, "feature_importances_"):
            raw = model_for_importance.feature_importances_
            importances = dict(zip(feat_names, [float(round(x, 4)) for x in raw]))
    except Exception:
        importances = {}

    return {
        "duration_minutes_pred": round(mean_pred, 1),
        "duration_minutes_std": round(std_pred, 1),
        "no_show_prob": round(prob, 3),
        "feature_importances": importances,
        "features_used": features,
    }
