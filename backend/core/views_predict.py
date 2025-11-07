# backend/core/views_predict.py
import os
import joblib
import numpy as np
from django.conf import settings
from django.shortcuts import get_object_or_404
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from .models import Job

# Try these filenames (joblib/pkl) inside <project_root>/ml_models
MODEL_CANDIDATES = {
    "duration": ["duration_model.joblib", "duration_model.pkl", "duration.joblib", "duration.pkl"],
    "no_show": ["no_show_model.joblib", "no_show_model.pkl", "no_show.joblib", "no_show.pkl"],
}


def model_path_for(kind):
    ml_dir = os.path.join(settings.BASE_DIR, "ml_models")
    for fname in MODEL_CANDIDATES.get(kind, []):
        p = os.path.join(ml_dir, fname)
        if os.path.exists(p):
            return p
    return None


def load_model_for(kind):
    p = model_path_for(kind)
    if not p:
        return None
    try:
        return joblib.load(p)
    except Exception:
        try:
            return joblib.load(p, mmap_mode=None)
        except Exception:
            return None


def featurize_job_obj(job):
    """
    Produce a minimal numeric feature vector for a Job instance.
    Keep it simple so fallback rule and models both work.
    Returns 2D numpy array shape (1, N_features).
    """
    # basic features: estimated_duration_minutes, number_of_required_skills, has_coords (0/1)
    est = job.estimated_duration_minutes or 60
    num_skills = 0
    try:
        num_skills = job.required_skills.count()
    except Exception:
        # if required_skills is a list/attr, try length
        try:
            num_skills = len(getattr(job, "required_skills", [])) or 0
        except Exception:
            num_skills = 0
    has_coords = 1 if (job.lat is not None and job.lon is not None) else 0
    return np.array([[float(est), float(num_skills), float(has_coords)]])


def featurize_job_dict(job_dict):
    est = job_dict.get("estimated_duration_minutes") or job_dict.get("estimated_duration") or 60
    num_skills = len(job_dict.get("required_skills", []))
    has_coords = 1 if (job_dict.get("lat") is not None and job_dict.get("lon") is not None) else 0
    return np.array([[float(est), float(num_skills), float(has_coords)]])


class PredictDurationAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        data = request.data or {}
        job_id = data.get("job_id")
        try:
            if job_id:
                job = get_object_or_404(Job, pk=job_id)
                X = featurize_job_obj(job)
            elif data.get("job"):
                X = featurize_job_dict(data.get("job"))
            else:
                return Response({"detail": "Provide job_id or job payload"}, status=status.HTTP_400_BAD_REQUEST)

            model = load_model_for("duration")
            if model is None:
                # fallback: use estimated_duration_minutes if present or a default 60
                mean = float(X[0, 0])
                return Response(
                    {"pred_duration_minutes": round(mean, 1), "pred_std_minutes": None, "model": None, "note": "No model available; using rule-based fallback"}
                )

            # model.predict may return array
            pred = model.predict(X)
            mean_pred = float(pred[0])
            # attempt to estimate uncertainty if model exposes anything; otherwise None
            std_est = None
            # simple rule: if the model object has attribute 'oob_prediction_' or similar, but keep conservative
            return Response({"pred_duration_minutes": round(mean_pred, 1), "pred_std_minutes": std_est, "model": model.__class__.__name__})
        except Exception as e:
            return Response({"detail": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class PredictNoShowAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        data = request.data or {}
        job_id = data.get("job_id")
        try:
            if job_id:
                job = get_object_or_404(Job, pk=job_id)
                X = featurize_job_obj(job)
            elif data.get("job"):
                X = featurize_job_dict(data.get("job"))
            else:
                return Response({"detail": "Provide job_id or job payload"}, status=status.HTTP_400_BAD_REQUEST)

            model = load_model_for("no_show")
            if model is None:
                # fallback probability: 0.1 (10%)
                return Response({"no_show_prob": 0.10, "model": None, "note": "No model available; using rule-based fallback"})

            if hasattr(model, "predict_proba"):
                probs = model.predict_proba(X)
                # assume positive class is index 1 if binary
                prob = float(probs[0, 1]) if probs.shape[1] > 1 else float(probs[0, 0])
            else:
                # model returns probability-like output via predict() — clamp to [0,1]
                p = model.predict(X)
                prob = float(np.clip(p[0], 0.0, 1.0))
            return Response({"no_show_prob": round(prob, 3), "model": model.__class__.__name__})
        except Exception as e:
            return Response({"detail": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
