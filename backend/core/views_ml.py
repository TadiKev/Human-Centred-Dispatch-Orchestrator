# backend/core/views_ml.py
import logging
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status
from django.shortcuts import get_object_or_404

from .models import Job
from . import ml_client

LOG = logging.getLogger("core.views_ml")


class PredictDurationAPIView(APIView):
    """
    POST /api/ml/predict/duration/
    Body: arbitrary job-like json. Optional query param job_id to attach result to a Job.meta field.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        payload = request.data or {}
        job_id = request.query_params.get("job_id") or payload.get("job_id")
        try:
            result = ml_client.predict_duration(payload)
        except Exception as e:
            LOG.exception("Duration prediction failed: %s", e)
            return Response({"detail": "ml_call_failed"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        # optional: persist into Job.meta.predicted_duration if job_id provided
        if job_id:
            try:
                job = get_object_or_404(Job, pk=int(job_id))
                meta = job.meta or {}
                # store only scalar predicted value for convenience
                pd = result.get("predicted_duration")
                if pd and isinstance(pd, (list, tuple)):
                    meta["predicted_duration"] = float(pd[0])
                elif isinstance(pd, (int, float)):
                    meta["predicted_duration"] = float(pd)
                job.meta = meta
                job.save(update_fields=["meta"])
            except Exception as e:
                LOG.debug("Failed to save predicted duration into job.meta: %s", e)

        return Response(result)


class PredictNoShowAPIView(APIView):
    """
    POST /api/ml/predict/noshow/
    Body: arbitrary job-like json. Optional query param job_id for persistence.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        payload = request.data or {}
        job_id = request.query_params.get("job_id") or payload.get("job_id")
        try:
            result = ml_client.predict_no_show(payload)
        except Exception as e:
            LOG.exception("No-show prediction failed: %s", e)
            return Response({"detail": "ml_call_failed"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        # optional persistence
        if job_id:
            try:
                job = get_object_or_404(Job, pk=int(job_id))
                meta = job.meta or {}
                # store probability if present
                probs = result.get("probabilities")
                if probs and isinstance(probs, (list, tuple)):
                    meta["predicted_no_show_prob"] = float(probs[0])
                elif isinstance(probs, (int, float)):
                    meta["predicted_no_show_prob"] = float(probs)
                job.meta = meta
                job.save(update_fields=["meta"])
            except Exception as e:
                LOG.debug("Failed to save predicted no-show into job.meta: %s", e)

        return Response(result)
