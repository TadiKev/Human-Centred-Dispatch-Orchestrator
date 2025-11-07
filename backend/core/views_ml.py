# backend/core/views_ml.py
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from django.shortcuts import get_object_or_404

from .models import Job, Technician
from .ml.model_store import extract_features_from_job, predict_for_features

class PredictDurationAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        body = request.data or {}
        job_id = body.get("job_id")
        features = body.get("features")

        if job_id and not features:
            job = get_object_or_404(Job, pk=job_id)
            tech = getattr(job, "assigned_technician", None)
            features = extract_features_from_job(job, technician=tech)

        if not features:
            return Response({"detail": "Provide job_id or features"}, status=status.HTTP_400_BAD_REQUEST)

        res = predict_for_features(features)
        return Response({"prediction": res})

class PredictNoShowAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        # same behavior (we can reuse predict_for_features)
        body = request.data or {}
        job_id = body.get("job_id")
        features = body.get("features")

        if job_id and not features:
            job = get_object_or_404(Job, pk=job_id)
            tech = getattr(job, "assigned_technician", None)
            features = extract_features_from_job(job, technician=tech)

        if not features:
            return Response({"detail": "Provide job_id or features"}, status=status.HTTP_400_BAD_REQUEST)

        res = predict_for_features(features)
        # return only relevant keys for no-show endpoint
        return Response({"no_show_prob": res["no_show_prob"], "features_used": res["features_used"], "feature_importances": res["feature_importances"]})
