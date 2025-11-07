# backend/core/views_analytics.py
from datetime import timedelta
from django.utils import timezone
from django.core.paginator import Paginator
from django.utils.dateparse import parse_datetime

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, permissions

from .auth import RolePermission
from .models import Job, Assignment, SLAAction, Technician
from .auto_assign import haversine_km


class AnalyticsOverviewAPIView(APIView):
    """
    GET /api/analytics/overview/?from=<iso>&to=<iso>&page=1&page_size=25
    Returns: { kpis: {...}, traces: [...], pagination: {...} }
    """
    permission_classes = [permissions.IsAuthenticated, RolePermission]
    allowed_roles = ["dispatcher", "admin"]

    def _parse_range(self, request):
        # parse 'from' and 'to' query params, fallback to last 7 days
        qs_from = request.query_params.get("from")
        qs_to = request.query_params.get("to")
        now = timezone.now()
        try:
            if qs_from:
                dt_from = parse_datetime(qs_from)
            else:
                dt_from = now - timedelta(days=7)
            if qs_to:
                dt_to = parse_datetime(qs_to)
            else:
                dt_to = now
            # ensure timezone-aware
            if dt_from is None:
                dt_from = now - timedelta(days=7)
            if dt_to is None:
                dt_to = now
            return dt_from, dt_to
        except Exception:
            return now - timedelta(days=7), now

    def get(self, request):
        dt_from, dt_to = self._parse_range(request)
        page = int(request.query_params.get("page", 1))
        page_size = int(request.query_params.get("page_size", 25))

        # Jobs created (or requested_window_start inside range) - adjust to your data model
        jobs_qs = Job.objects.filter(created_at__gte=dt_from, created_at__lte=dt_to).order_by("-created_at")

        total_jobs = jobs_qs.count()

        # SLA breaches: count SLAAction entries with high risk in range (tune to your definition)
        sla_breaches = SLAAction.objects.filter(created_at__gte=dt_from, created_at__lte=dt_to, risk_level="high").count()

        # Avg travel (for jobs that have assigned technician + coords)
        travel_sum = 0.0
        travel_count = 0
        for job in jobs_qs.select_related("assigned_technician")[:500]:  # limit to avoid heavy loops
            tech = getattr(job, "assigned_technician", None)
            if not tech:
                continue
            # try access coordinates (field names may differ)
            job_lat = getattr(job, "lat", None) or getattr(job, "latitude", None)
            job_lon = getattr(job, "lon", None) or getattr(job, "longitude", None)
            tech_lat = getattr(tech, "last_lat", None)
            tech_lon = getattr(tech, "last_lon", None)
            if None not in (job_lat, job_lon, tech_lat, tech_lon):
                try:
                    d = haversine_km(job_lat, job_lon, tech_lat, tech_lon)
                except Exception:
                    d = None
                if d is not None:
                    travel_sum += d
                    travel_count += 1

        avg_travel_km = (travel_sum / travel_count) if travel_count > 0 else None

        # On-time rate: simple heuristic — job considered late if there is any SLAAction with risk_level='high'
        if total_jobs > 0:
            # jobs with no high-risk SLAAction in the time window
            late_job_ids = set(
                SLAAction.objects.filter(risk_level="high", created_at__gte=dt_from, created_at__lte=dt_to).values_list("job_id", flat=True)
            )
            on_time_count = total_jobs - len(late_job_ids)
            on_time_rate = on_time_count / total_jobs
        else:
            on_time_rate = None

        # pagination for traces: use recent jobs in range
        paginator = Paginator(jobs_qs, page_size)
        try:
            page_obj = paginator.page(page)
        except Exception:
            page_obj = paginator.page(1)

        traces = []
        jobs_page = page_obj.object_list.select_related("assigned_technician")
        for job in jobs_page:
            assignment = Assignment.objects.filter(job=job).order_by("-created_at").first()
            assigned_tech = getattr(job, "assigned_technician", None)
            tech_username = None
            if assigned_tech:
                tech_username = getattr(getattr(assigned_tech, "user", None), "username", None) or getattr(assigned_tech, "user", None)

            job_lat = getattr(job, "lat", None) or getattr(job, "latitude", None)
            job_lon = getattr(job, "lon", None) or getattr(job, "longitude", None)
            tech_lat = getattr(assigned_tech, "last_lat", None) if assigned_tech else None
            tech_lon = getattr(assigned_tech, "last_lon", None) if assigned_tech else None

            travel_km = None
            if None not in (job_lat, job_lon, tech_lat, tech_lon):
                try:
                    travel_km = haversine_km(job_lat, job_lon, tech_lat, tech_lon)
                except Exception:
                    travel_km = None

            sla_flags = list(SLAAction.objects.filter(job=job).values("risk_level", "status", "created_at"))

            # on_time heuristic: job is "on_time" if it doesn't have a high risk SLAAction
            has_high = SLAAction.objects.filter(job=job, risk_level="high").exists()
            traces.append({
                "job_id": job.id,
                "customer_name": getattr(job, "customer_name", None),
                "assigned_technician": tech_username,
                "assignment_time": assignment.created_at.isoformat() if assignment else None,
                "travel_km": travel_km,
                "on_time": (not has_high) if (has_high is not None) else None,
                "sla_flags": sla_flags,
            })

        result = {
            "kpis": {
                "total_jobs": total_jobs,
                "on_time_rate": on_time_rate,
                "avg_travel_km": avg_travel_km,
                "sla_breaches": sla_breaches,
            },
            "traces": traces,
            "pagination": {
                "page": page_obj.number,
                "page_size": page_size,
                "num_pages": paginator.num_pages,
                "total": paginator.count,
            },
        }
        return Response(result, status=status.HTTP_200_OK)
