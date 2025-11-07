# backend/core/views.py
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.response import Response
from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from django.db import transaction
from django.db.models import Count
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework import status
from rest_framework.response import Response

from django.shortcuts import get_object_or_404
from .auto_assign import rule_based_candidates

from .models import Technician, Job, Assignment, Skill
from .serializers import AssignmentSerializer, JobSerializer, TechnicianSerializer
from .permissions import RolePermission
from django.utils import timezone
from datetime import timedelta
import math


from .serializers import (
    UserSerializer,
    JobSerializer,
    AssignmentSerializer,
    SkillSerializer,
    TechnicianSerializer,
)
from .models import Job, Assignment, Skill, Technician
from .permissions import RolePermission, IsTechnician

# Import the custom token view & register serializer used in Module 1.
# Keep these import paths as you had them in Module 1 so existing urls continue to work.
from .auth_serializers import CustomTokenObtainPairView  # must exist from Module 1
from .serializers_auth import RegisterSerializer  # must exist from Module 1

from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework.permissions import AllowAny, IsAuthenticated

User = get_user_model()

# Re-export token view so urls that import from views keep working
CustomTokenObtainPairView = CustomTokenObtainPairView

# at top of views.py add:
from .itinerary import compute_itinerary_for_technician

# inside TechnicianViewSet.itinerary (replace current computation block with this)
@action(detail=True, methods=["get"], permission_classes=[IsAuthenticated], url_path="itinerary")
def itinerary(self, request, pk=None):
    tech = get_object_or_404(Technician.objects.prefetch_related("user"), pk=pk)

    # query params
    force = request.query_params.get("force", "false").lower() == "true"
    use_ortools = request.query_params.get("use_ortools", "false").lower() == "true"
    try:
        speed_kmph = float(request.query_params.get("speed_kmph", 40.0))
    except Exception:
        speed_kmph = 40.0

    # optional now override for testing
    now_param = request.query_params.get("now")
    if now_param:
        try:
            now_dt = timezone.datetime.fromisoformat(now_param)
            if timezone.is_naive(now_dt):
                now_dt = timezone.make_aware(now_dt)
            now = now_dt
        except Exception:
            now = timezone.now()
    else:
        now = timezone.now()

    # cache key & cache bypass handled elsewhere if present — simple compute here
    res = compute_itinerary_for_technician(tech.id, now=now, use_ortools=use_ortools, speed_kmph=speed_kmph)
    return Response(res)



@api_view(["POST"])
@permission_classes([AllowAny])
def register_view(request):
    """
    Register a new user. Returns basic user info and JWT tokens (access + refresh).
    """
    serializer = RegisterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = serializer.save()

    # create tokens for the new user
    refresh = RefreshToken.for_user(user)
    access_token = str(refresh.access_token)
    refresh_token = str(refresh)

    return Response(
        {
            "id": user.id,
            "username": user.username,
            "access": access_token,
            "refresh": refresh_token,
            "user": {
                "id": user.id,
                "username": user.username,
                "email": getattr(user, "email", None),
                "role": getattr(getattr(user, "profile", None), "role", None),
            },
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me_view(request):
    serializer = UserSerializer(request.user, context={"request": request})
    return Response(serializer.data)


# ----- Module 2 viewsets -----


class SkillViewSet(viewsets.ModelViewSet):
    """
    CRUD for skills. Authenticated users only for demo.
    """
    queryset = Skill.objects.all().order_by("name")
    serializer_class = SkillSerializer
    permission_classes = [permissions.IsAuthenticated]


# Replace the TechnicianViewSet class in backend/core/views.py with the block below

from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from django.core.cache import cache
from django.utils import timezone

from .models import Technician, Job
from .serializers import TechnicianSerializer

# import compute helper (we added this file)
from .itinerary import compute_itinerary_for_technician

# optional celery task (best-effort import)
try:
    from .tasks import regenerate_itinerary_task
except Exception:
    regenerate_itinerary_task = None


class TechnicianViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Read-only technicians list and a /me endpoint for the current technician.
    Also exposes GET /api/technicians/{pk}/itinerary/
    """
    queryset = Technician.objects.select_related("user").prefetch_related("skills").all()
    serializer_class = TechnicianSerializer
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=False, methods=["get"], permission_classes=[permissions.IsAuthenticated])
    def me(self, request):
        try:
            tech = request.user.technician
        except Technician.DoesNotExist:
            return Response({"detail": "No technician profile for this user."}, status=status.HTTP_404_NOT_FOUND)
        serializer = self.get_serializer(tech)
        return Response(serializer.data)

    @action(detail=True, methods=["get"], permission_classes=[IsAuthenticated], url_path="itinerary")
    def itinerary(self, request, pk=None):
        """
        GET /api/technicians/{pk}/itinerary/
        Query params:
           - speed_kmph (float)
           - now (ISO datetime)
           - force=true
           - use_ortools=true
        """
        tech = get_object_or_404(Technician.objects.prefetch_related("user"), pk=pk)

        # parse params
        force = request.query_params.get("force", "false").lower() == "true"
        use_ortools = request.query_params.get("use_ortools", "false").lower() == "true"
        try:
            speed_kmph = float(request.query_params.get("speed_kmph", 40.0))
        except Exception:
            speed_kmph = 40.0

        now_param = request.query_params.get("now")
        if now_param:
            try:
                now_dt = timezone.datetime.fromisoformat(now_param)
                if timezone.is_naive(now_dt):
                    now_dt = timezone.make_aware(now_dt)
                now = now_dt
            except Exception:
                now = timezone.now()
        else:
            now = timezone.now()

        cache_key = f"itinerary:tech:{tech.id}:speed:{int(speed_kmph)}"

        cached = None
        try:
            cached = cache.get(cache_key)
        except Exception:
            cached = None

        if cached and not force:
            # schedule background compute to refresh cache (best-effort)
            if regenerate_itinerary_task:
                try:
                    regenerate_itinerary_task.delay(tech.id, use_ortools, speed_kmph)
                except Exception:
                    pass
            return Response(cached)

        # compute synchronously
        try:
            payload = compute_itinerary_for_technician(tech.id, now=now, use_ortools=use_ortools, speed_kmph=speed_kmph)
        except Exception as e:
            return Response({"detail": f"Failed to compute itinerary: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # cache result
        try:
            cache.set(cache_key, payload, timeout=60 * 60 * 24)
        except Exception:
            pass

        # schedule background update (best-effort)
        if regenerate_itinerary_task:
            try:
                regenerate_itinerary_task.delay(tech.id, use_ortools, speed_kmph)
            except Exception:
                pass

        return Response(payload)


class JobViewSet(viewsets.ModelViewSet):
    """
    Jobs CRUD. Create/update/destroy restricted to dispatchers/admin via RolePermission.
    Technicians can list their assigned jobs via ?mine=1 or via the assigned action.
    """
    queryset = Job.objects.select_related("assigned_technician__user").prefetch_related("required_skills").order_by("-created_at")
    serializer_class = JobSerializer
    permission_classes = [permissions.IsAuthenticated]

    # restrict write actions to dispatcher/admin only
    def get_permissions(self):
        # for write actions require RolePermission with allowed_roles set
        if self.action in ("create", "update", "partial_update", "destroy"):
            # set allowed roles for RolePermission to pick up
            self.allowed_roles = ["dispatcher", "admin"]
            return [permissions.IsAuthenticated(), RolePermission()]
        return [permissions.IsAuthenticated()]

    @action(detail=False, methods=["get"], permission_classes=[IsTechnician], url_path="assigned")
    def assigned(self, request):
        """
        Jobs assigned to the authenticated technician.
        Uses RolePermission via IsTechnician (which expects request.user.profile.role == "technician").
        """
        qs = self.get_queryset().filter(assignments__technician__user=request.user).distinct()
        page = self.paginate_queryset(qs)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)

    # allow technicians to ask for ?mine=1 to filter to their assigned jobs
    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        mine = request.query_params.get("mine")
        if mine and request.user.is_authenticated:
            try:
                tech = request.user.technician
                qs = qs.filter(assigned_technician=tech)
            except Technician.DoesNotExist:
                qs = qs.none()
        page = self.paginate_queryset(qs)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)


class AssignmentViewSet(viewsets.ModelViewSet):
    queryset = Assignment.objects.select_related("job", "technician__user", "created_by").all()
    serializer_class = AssignmentSerializer
    permission_classes = [permissions.IsAuthenticated, RolePermission]
    # restrict create to dispatcher/admin
    allowed_roles = ["dispatcher", "admin"]

    def get_queryset(self):
        qs = super().get_queryset()
        job_id = self.request.query_params.get("job_id")
        if job_id:
            qs = qs.filter(job__id=job_id)
        return qs

    @transaction.atomic
    def perform_create(self, serializer):
        """
        Persist Assignment (with created_by), ensure manual reason is embedded
        into score_breakdown for audit consumers, then update the Job state.
        """
        # 1) save assignment with created_by
        assignment = serializer.save(created_by=self.request.user)

        # 2) ensure score_breakdown contains manual info when reason provided
        sb = assignment.score_breakdown or {}
        if assignment.reason:
            # mark this as manual and store the textual rationale in JSON too
            sb["manual_flag"] = True
            # do not overwrite existing manual_reason if present; otherwise set it
            sb.setdefault("manual_reason", assignment.reason)
            assignment.score_breakdown = sb
            # persist only the updated JSON column
            assignment.save(update_fields=["score_breakdown"])

        # 3) update the Job to reflect the new assignment (immutable audit kept in Assignment)
        job = assignment.job
        job.assigned_technician = assignment.technician
        job.status = getattr(job, "STATUS_ASSIGNED", "assigned")
        # update only the changed fields
        job.save(update_fields=["assigned_technician", "status"])

        return assignment

# If you already have _haversine_km in the file, you can keep that one and remove this duplicate.
def _haversine_km(lat1, lon1, lat2, lon2):
    try:
        R = 6371.0
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlambda = math.radians(lon2 - lon1)
        a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
        return R * c
    except Exception:
        return None


def _minutes_for_distance(dist_km, speed_kmph=40.0):
    """Return minutes to travel dist_km given speed (km/h). Default speed fallback 40 km/h."""
    if dist_km is None:
        return None
    try:
        return (dist_km / float(speed_kmph)) * 60.0
    except Exception:
        return None


def _format_iso(dt):
    if dt is None:
        return None
    # ensure naive/aware handled by django timezone
    return timezone.localtime(dt).isoformat()


def build_itinerary_from_order(start_lat, start_lon, jobs_ordered, now=None, default_speed_kmph=40.0, default_service_minutes=60):
    """
    Build an itinerary (list of stops) given an ordered list of Job model instances.
    Returns (stops_list, total_travel_km, total_travel_minutes).
    Each stop is dict: { job_id, customer_name, lat, lon, distance_from_prev_km, arrival, window_start, window_end, departure, service_minutes }
    """
    if now is None:
        now = timezone.now()

    cur_lat = start_lat
    cur_lon = start_lon
    cur_time = now
    stops = []
    total_km = 0.0
    total_travel_minutes = 0.0

    for job in jobs_ordered:
        # default service time
        service_minutes = job.estimated_duration_minutes or default_service_minutes

        # compute distance from current pos
        if cur_lat is not None and cur_lon is not None and job.lat is not None and job.lon is not None:
            dist = _haversine_km(cur_lat, cur_lon, job.lat, job.lon)
            travel_minutes = _minutes_for_distance(dist, speed_kmph=default_speed_kmph) or 0
        else:
            dist = None
            travel_minutes = 0

        # arrival = cur_time + travel_minutes
        arrival = cur_time + timedelta(minutes=travel_minutes)

        # respect requested window start (wait if we arrive earlier than window start)
        window_start = job.requested_window_start
        window_end = job.requested_window_end

        # If job has a requested window and arrival is before its start, wait
        if window_start is not None and arrival < window_start:
            arrival = window_start

        # departure = arrival + service_minutes
        departure = arrival + timedelta(minutes=service_minutes)

        stops.append({
            "job_id": job.id,
            "customer_name": job.customer_name,
            "address": job.address,
            "lat": job.lat,
            "lon": job.lon,
            "distance_from_prev_km": None if dist is None else round(dist, 3),
            "travel_minutes_from_prev": None if travel_minutes is None else round(travel_minutes, 1),
            "arrival_iso": _format_iso(arrival),
            "window_start_iso": _format_iso(window_start) if window_start else None,
            "window_end_iso": _format_iso(window_end) if window_end else None,
            "departure_iso": _format_iso(departure),
            "service_minutes": service_minutes,
        })

        # update totals and current position/time
        if dist is not None:
            total_km += dist
            total_travel_minutes += travel_minutes

        cur_lat = job.lat if job.lat is not None else cur_lat
        cur_lon = job.lon if job.lon is not None else cur_lon
        cur_time = departure

    return stops, round(total_km, 3), round(total_travel_minutes, 1)


def nearest_neighbor_order(start_lat, start_lon, jobs_qs):
    """
    Return a list of job instances ordered by a greedy nearest-neighbour algorithm starting from start_lat/lon.
    Jobs with missing coords are appended at the end in original order.
    """
    jobs = list(jobs_qs)
    # separate ones with coords and without
    with_coords = [j for j in jobs if j.lat is not None and j.lon is not None]
    without_coords = [j for j in jobs if j.lat is None or j.lon is None]

    order = []
    cur_lat = start_lat
    cur_lon = start_lon

    # if start coords missing, just return by requested_window_start then append those without coords
    if cur_lat is None or cur_lon is None:
        # sort by window then append without_coords
        sorted_with = sorted(with_coords, key=lambda j: (j.requested_window_start or timezone.make_aware(timezone.datetime.min)))
        return sorted_with + without_coords

    remaining = with_coords.copy()
    while remaining:
        # choose nearest from current position
        nearest = None
        nearest_dist = None
        for j in remaining:
            d = _haversine_km(cur_lat, cur_lon, j.lat, j.lon)
            if d is None:
                continue
            if nearest is None or d < nearest_dist:
                nearest = j
                nearest_dist = d
        if nearest is None:
            break
        order.append(nearest)
        remaining.remove(nearest)
        cur_lat, cur_lon = nearest.lat, nearest.lon

    # append any jobs missing coords
    order.extend(without_coords)
    return order


# Add an action to the TechnicianViewSet (or standalone APIView). Example as an action:
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated

from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from django.core.cache import cache
from django.utils import timezone

# make sure build_itinerary_from_order and nearest_neighbor_order are defined
# earlier in this file (you already have them above in views.py)
# from .itinerary_helpers import build_itinerary_from_order, nearest_neighbor_order  # not needed if in same file

# Optional background task (Celery) — imported safely
try:
    from .tasks import regenerate_itinerary_task
except Exception:
    regenerate_itinerary_task = None

class TechnicianViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Read-only technicians list and a /me endpoint for the current technician.
    Also exposes GET /api/technicians/{pk}/itinerary/

    Query params for itinerary:
      - speed_kmph (float)     : travel speed used to estimate durations (default 40)
      - now (ISO datetime)     : override "now" for ETA computation (server-local)
      - force=true             : bypass cache and compute fresh
      - use_ortools=true       : optional flag to use OR-Tools (not implemented in this block)
    """
    queryset = Technician.objects.select_related("user").prefetch_related("skills").all()
    serializer_class = TechnicianSerializer
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=False, methods=["get"], permission_classes=[permissions.IsAuthenticated])
    def me(self, request):
        try:
            tech = request.user.technician
        except Technician.DoesNotExist:
            return Response({"detail": "No technician profile for this user."}, status=status.HTTP_404_NOT_FOUND)
        serializer = self.get_serializer(tech)
        return Response(serializer.data)

    @action(detail=True, methods=["get"], permission_classes=[IsAuthenticated], url_path="itinerary")
    def itinerary(self, request, pk=None):
        """
        GET /api/technicians/{pk}/itinerary/

        Returns:
          {
            "technician_id": ...,
            "technician_username": "...",
            "now": ISO,
            "current": { "stops": [...], "total_travel_km": ..., "total_travel_minutes": ... },
            "optimized": { "stops": [...], "total_travel_km": ..., "total_travel_minutes": ... },
            "comparison": { ... }
          }

        The function uses existing helpers build_itinerary_from_order and nearest_neighbor_order.
        """
        tech = get_object_or_404(Technician.objects.prefetch_related("user"), pk=pk)

        # Query params
        force = request.query_params.get("force", "false").lower() == "true"
        use_ortools = request.query_params.get("use_ortools", "false").lower() == "true"

        # speed override
        try:
            speed_kmph = float(request.query_params.get("speed_kmph", 40.0))
        except Exception:
            speed_kmph = 40.0

        # now override
        now_param = request.query_params.get("now")
        if now_param:
            try:
                now_dt = timezone.datetime.fromisoformat(now_param)
                if timezone.is_naive(now_dt):
                    now_dt = timezone.make_aware(now_dt)
                now = now_dt
            except Exception:
                now = timezone.now()
        else:
            now = timezone.now()

        # cache key
        cache_key = f"itinerary:tech:{tech.id}:speed:{int(speed_kmph)}"

        # Try cached
        cached = None
        try:
            cached = cache.get(cache_key)
        except Exception:
            cached = None

        if cached and not force:
            # fire background refresh (best-effort) to keep cache warm
            if regenerate_itinerary_task:
                try:
                    regenerate_itinerary_task.delay(tech.id, use_ortools, speed_kmph)
                except Exception:
                    # don't fail if Celery isn't available / misconfigured
                    pass
            # return cached payload
            return Response(cached)

        # --- Compute itinerary synchronously (same logic you had) ---
        # fetch assigned jobs for this technician (ordered by requested_window_start)
        jobs_qs = Job.objects.filter(assigned_technician=tech).order_by("requested_window_start", "-created_at")

        # starting location: technician last known coords if present, otherwise first job coords
        start_lat = tech.last_lat
        start_lon = tech.last_lon
        if (start_lat is None or start_lon is None) and jobs_qs.exists():
            first = jobs_qs.first()
            start_lat = first.lat
            start_lon = first.lon

        # Build "current" ordering
        current_order_jobs = list(jobs_qs)
        current_stops, current_km, current_minutes = build_itinerary_from_order(
            start_lat, start_lon, current_order_jobs, now=now, default_speed_kmph=speed_kmph
        )

        # Build optimized ordering (nearest-neighbour). If use_ortools is requested but not implemented, we still compute NN.
        if use_ortools:
            # OR-Tools is optional — if you later add a function to compute with OR-Tools, call it here.
            # For now, default to nearest_neighbor_order and include a note in the response.
            optimized_order_jobs = nearest_neighbor_order(start_lat, start_lon, jobs_qs)
            ortools_note = "use_ortools requested but OR-Tools optimization not configured; falling back to nearest-neighbour."
        else:
            optimized_order_jobs = nearest_neighbor_order(start_lat, start_lon, jobs_qs)
            ortools_note = None

        optimized_stops, opt_km, opt_minutes = build_itinerary_from_order(
            start_lat, start_lon, optimized_order_jobs, now=now, default_speed_kmph=speed_kmph
        )

        comparison = {
            "current_total_travel_km": current_km,
            "optimized_total_travel_km": opt_km,
            "delta_travel_km": round(current_km - opt_km, 3),
            "current_total_travel_minutes": current_minutes,
            "optimized_total_travel_minutes": opt_minutes,
            "delta_travel_minutes": round(current_minutes - opt_minutes, 1),
            "start_lat": start_lat,
            "start_lon": start_lon,
            "num_stops": jobs_qs.count(),
        }

        payload = {
            "technician_id": tech.id,
            "technician_username": getattr(getattr(tech, "user", None), "username", None),
            "now": _format_iso(now),
            "current": {
                "stops": current_stops,
                "total_travel_km": current_km,
                "total_travel_minutes": current_minutes,
            },
            "optimized": {
                "stops": optimized_stops,
                "total_travel_km": opt_km,
                "total_travel_minutes": opt_minutes,
            },
            "comparison": comparison,
        }

        if ortools_note:
            payload["note"] = ortools_note

        # Cache the result (best-effort)
        try:
            cache.set(cache_key, payload, timeout=60 * 60 * 24)  # cache 24 hours (adjust as you like)
        except Exception:
            pass

        # Trigger background refresh asynchronously (best-effort)
        if regenerate_itinerary_task:
            try:
                regenerate_itinerary_task.delay(tech.id, use_ortools, speed_kmph)
            except Exception:
                pass

        return Response(payload)




class JobCandidatesAPIView(APIView):
    """
    GET /api/jobs/{job_id}/candidates/
    Returns candidate technicians with a simple score_breakdown + explanation.
    """
    permission_classes = [IsAuthenticated, RolePermission]
    # only admin/dispatcher can view candidates by default:
    allowed_roles = ["dispatcher", "admin"]

    def get(self, request, job_id=None):
        job = get_object_or_404(Job, pk=job_id)
        # fetch all technicians (could be refined to active only)
        tech_qs = Technician.objects.select_related("user").prefetch_related("skills").all()

        required_skills = list(job.required_skills.all())
        req_skill_ids = {s.id for s in required_skills}
        candidates = []

        for tech in tech_qs:
            tech_skill_ids = {s.id for s in tech.skills.all()}
            skill_match_count = len(req_skill_ids & tech_skill_ids)
            # compute distance if coords available
            dist_km = None
            if job.lat is not None and job.lon is not None and tech.last_lat is not None and tech.last_lon is not None:
                dist_km = _haversine_km(job.lat, job.lon, tech.last_lat, tech.last_lon)
            # availability heuristic
            availability = 1 if (tech.status or "").lower() == "available" else 0

            # score composition (simple & explainable)
            score = 0
            score_components = {}
            score += skill_match_count * 10
            score_components["skill_match_count"] = skill_match_count
            if dist_km is not None:
                # penalty by distance
                score -= dist_km * 0.5
                score_components["distance_km"] = round(dist_km, 2)
                score_components["distance_penalty"] = round(dist_km * 0.5, 2)
            else:
                score_components["distance_km"] = None
                score_components["distance_penalty"] = 0
            score += availability * 5
            score_components["availability"] = availability
            score_components["score"] = round(score, 2)

            explanation = {
                "text": f"Skill matches: {skill_match_count}, availability: {availability}, distance_km: {score_components['distance_km']}",
                "components": score_components,
            }

            candidates.append({
                "technician_id": tech.id,
                "username": tech.user.username,
                "status": tech.status,
                "skills": [{"id": s.id, "name": s.name} for s in tech.skills.all()],
                "score_breakdown": score_components,
                "score": round(score, 2),
                "explanation": explanation,
            })

        # sort by score desc
        candidates = sorted(candidates, key=lambda c: c["score"], reverse=True)
        return Response({"job_id": job.id, "candidates": candidates})

    @transaction.atomic
    def perform_create(self, serializer):
        # Save created_by from the request user
        assignment = serializer.save(created_by=self.request.user)

        # If manual reason present and score_breakdown is empty or doesn't have a manual_reason,
        # attach an explicit manual_reason key so audit consumers can see it in the score JSON.
        sb = assignment.score_breakdown or {}
        if assignment.reason:
            # keep existing components and add manual_reason and manual_flag
            sb.setdefault("manual_flag", True)
            sb.setdefault("manual_reason", assignment.reason)
            assignment.score_breakdown = sb
            assignment.save(update_fields=["score_breakdown"])

        # ensure job is updated immutably (audit is the assignment record)
        job = assignment.job
        job.assigned_technician = assignment.technician
        if hasattr(job, "STATUS_ASSIGNED"):
            job.status = job.STATUS_ASSIGNED
        else:
            job.status = "assigned"
        job.save()
        return assignment

class AutoAssignAPIView(APIView):
    """
    POST /api/auto_assign/?job_id=... (optionally body {"assign": true, "top_n": 5})
    Returns chosen technician and score details. If assign=true, creates the Assignment
    and updates Job.assigned_technician atomically (only dispatchers/admin allowed).

    Returns a compact summary under `auto_assign_summary`.
    """
    permission_classes = [IsAuthenticated, RolePermission]
    allowed_roles = ["dispatcher", "admin"]

    def _fill_missing_usernames(self, result):
        """
        Fill candidate['username'] and chosen['username'] from DB when missing.
        Uses an inline sanitizer (no external utils required).
        """
        if not result:
            return result

        def _sanitize(val):
            if not val:
                return None
            try:
                s = str(val).strip()
            except Exception:
                return None
            if not s:
                return None
            # treat obviously invalid placeholders as missing
            if s.lower() in ("unknown", "unassigned", "none", "n/a", "-", "?"):
                return None
            return s

        def _try_fill(candidate):
            if not candidate:
                return candidate
            if candidate.get("username"):
                return candidate

            tid = candidate.get("technician_id")
            if not tid:
                return candidate

            try:
                tech = Technician.objects.select_related("user").get(pk=tid)
                user = getattr(tech, "user", None)
                uname = None
                if user:
                    try:
                        get_full = getattr(user, "get_full_name", None)
                        if callable(get_full):
                            full = get_full()
                            uname = _sanitize(full)
                        if not uname:
                            uname = _sanitize(getattr(user, "username", None))
                    except Exception:
                        uname = _sanitize(getattr(user, "username", None))
                if uname:
                    candidate["username"] = uname
            except Technician.DoesNotExist:
                pass
            except Exception:
                # be defensive: don't crash on DB issues
                pass
            return candidate

        cand_list = result.get("candidates", [])
        for i, c in enumerate(cand_list):
            cand_list[i] = _try_fill(c)

        chosen = result.get("chosen")
        if chosen:
            result["chosen"] = _try_fill(chosen)

        return result

    def _compact_auto_assign_result(self, result):
        """
        Convert the rule_based_candidates result into a compact summary:
        { chosen: {technician_id, name}, score: 0..1, raw_score, score_breakdown, reason }
        """
        if not result:
            return {"chosen": None, "score": None, "raw_score": None, "score_breakdown": None, "reason": None}

        # make sure usernames populated where possible
        self._fill_missing_usernames(result)

        chosen = result.get("chosen")
        candidates = result.get("candidates", []) or []

        if not chosen:
            return {"chosen": None, "score": None, "raw_score": None, "score_breakdown": None, "reason": result.get("reason")}

        raw_score = chosen.get("score", None)

        # gather numeric scores for normalization
        scores = [c.get("score", 0.0) for c in candidates if c is not None and isinstance(c.get("score", None), (int, float))]
        if raw_score is not None and raw_score not in scores:
            scores.append(raw_score)

        norm = None
        try:
            if scores:
                s_min = min(scores)
                s_max = max(scores)
                if s_min == s_max:
                    norm = 1.0
                else:
                    norm = (raw_score - s_min) / (s_max - s_min)
                    norm = max(0.0, min(1.0, float(norm)))
            else:
                norm = None
        except Exception:
            norm = None

        name = chosen.get("username") or chosen.get("name") or None

        reason = None
        if isinstance(chosen.get("explanation"), dict):
            reason = chosen.get("explanation", {}).get("text")
        if not reason:
            reason = result.get("reason") or None

        return {
            "chosen": {"technician_id": chosen.get("technician_id"), "name": name},
            "score": (round(norm, 3) if isinstance(norm, float) else None),
            "raw_score": (round(raw_score, 3) if isinstance(raw_score, (int, float)) else None),
            "score_breakdown": chosen.get("score_breakdown", None),
            "reason": reason,
        }

    def post(self, request, format=None):
        job_id_raw = request.query_params.get("job_id") or request.data.get("job_id")
        if not job_id_raw:
            return Response({"detail": "job_id is required as query param or in JSON body."}, status=status.HTTP_400_BAD_REQUEST)

        if isinstance(job_id_raw, str):
            job_id_clean = job_id_raw.strip().rstrip("/")
        else:
            job_id_clean = job_id_raw

        try:
            job_id_int = int(job_id_clean)
        except (ValueError, TypeError):
            return Response({"detail": "job_id must be an integer."}, status=status.HTTP_400_BAD_REQUEST)

        job = get_object_or_404(Job, pk=job_id_int)

        try:
            top_n = int(request.data.get("top_n", request.query_params.get("top_n", 5)))
        except Exception:
            top_n = 5
        assign_flag = bool(request.data.get("assign", False) or request.query_params.get("assign") == "true")
        weights = request.data.get("weights") or None

        # compute candidates
        result = rule_based_candidates(job, top_n=top_n, weights=weights)
        result = self._fill_missing_usernames(result)

        # compact summary
        summary = self._compact_auto_assign_result(result)

        # assign if requested
        if assign_flag:
            chosen = result.get("chosen")
            if not chosen:
                return Response({"detail": "No candidate available to assign."}, status=status.HTTP_400_BAD_REQUEST)

            with transaction.atomic():
                job_locked = Job.objects.select_for_update().get(pk=job.id)
                if job_locked.assigned_technician is not None:
                    return Response({"detail": "Job already assigned."}, status=status.HTTP_409_CONFLICT)

                tech = get_object_or_404(Technician.objects.select_related("user"), pk=chosen["technician_id"])

                assignment = Assignment.objects.create(
                    job=job_locked,
                    technician=tech,
                    score_breakdown=chosen.get("score_breakdown", {}),
                    reason=request.data.get("reason", f"Auto-assigned by rules: {chosen.get('explanation', {}).get('text', '')}"),
                    created_by=request.user
                )

                job_locked.assigned_technician = tech
                job_locked.status = getattr(job_locked, "STATUS_ASSIGNED", "assigned")
                job_locked.save(update_fields=["assigned_technician", "status"])

            assignment_ser = AssignmentSerializer(assignment, context={"request": request})

            # recompute and return updated summary
            result_after = rule_based_candidates(job_locked, top_n=top_n, weights=weights)
            result_after = self._fill_missing_usernames(result_after)
            summary_after = self._compact_auto_assign_result(result_after)

            return Response({
                "assigned": True,
                "assignment": assignment_ser.data,
                "auto_assign_summary": summary_after
            }, status=status.HTTP_201_CREATED)

        # not assigning — return compact summary
        return Response({"assigned": False, "auto_assign_summary": summary})


# core/views.py (append)
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, permissions
from django.shortcuts import get_object_or_404
from django.db import transaction
from django.utils import timezone

from .models import SLAAction, Job, Technician, Assignment
from .serializers import SLAActionSerializer
from .auto_assign import choose_best_candidate  # uses your choose_best_candidate implementation
from .serializers import AssignmentSerializer
from .permissions import RolePermission

class SLAOverviewAPIView(APIView):
    permission_classes = [permissions.IsAuthenticated, RolePermission]
    allowed_roles = ["dispatcher", "admin"]

    def get(self, request):
        # return pending SLA actions (optionally filter)
        qs = SLAAction.objects.filter(status="pending").select_related("job", "suggested_technician").order_by("risk_level", "-risk_score")
        ser = SLAActionSerializer(qs, many=True, context={"request": request})
        return Response({"count": qs.count(), "items": ser.data})

class SLAMitigateAPIView(APIView):
    permission_classes = [permissions.IsAuthenticated, RolePermission]
    allowed_roles = ["dispatcher", "admin"]

    def post(self, request):
        """
        Body:
        {
           "job_id": 123,
           "action": "reassign"|"notify",
           "target_technician_id": 12,        # optional
           "override": true|false,            # if true allow forced reassign
           "override_reason": "..."
        }
        """
        data = request.data
        job_id = data.get("job_id")
        action = data.get("action")
        if not job_id or not action:
            return Response({"detail": "job_id and action are required."}, status=status.HTTP_400_BAD_REQUEST)

        job = get_object_or_404(Job, pk=job_id)
        sla = SLAAction.objects.filter(job=job, status="pending").order_by("-created_at").first()

        if not sla:
            return Response({"detail": "No pending SLA action for this job."}, status=status.HTTP_404_NOT_FOUND)

        resp = {"job_id": job.id, "action": action}
        user = request.user

        if action == "notify":
            # mark applied and optionally store message
            sla.reason = (sla.reason or "") + f"\nNotification requested by {user.username}"
            sla.mark_applied()
            # TODO: send notification to customer (hook to your notification system)
            resp["notified"] = True
            resp["message"] = data.get("message", "Customer will be notified of potential delay.")
            return Response(resp, status=status.HTTP_200_OK)

        if action == "reassign":
            target_id = data.get("target_technician_id")
            override_flag = bool(data.get("override", False))
            override_reason = (data.get("override_reason") or "").strip()

            # If target provided, prefer it; else use chooser
            chosen = None
            if target_id:
                try:
                    chosen_tech = Technician.objects.get(pk=int(target_id))
                    chosen = {"technician_id": chosen_tech.id, "username": getattr(chosen_tech.user, "username", None)}
                except Technician.DoesNotExist:
                    return Response({"detail": "target_technician_id not found."}, status=status.HTTP_400_BAD_REQUEST)
            else:
                # ask chooser for best candidate excluding current tech
                result = choose_best_candidate(job, allow_override=override_flag)
                if result.get("unsafe") and not override_flag:
                    return Response({"detail": "No safe candidate found. Use override or choose target_technician_id."}, status=status.HTTP_409_CONFLICT)
                chosen = result.get("chosen")
                resp["candidate_list"] = result.get("candidates", [])

            if not chosen:
                return Response({"detail": "No candidate chosen."}, status=status.HTTP_400_BAD_REQUEST)

            # if override requested require reason
            if override_flag and (not override_reason or len(override_reason) < 3):
                return Response({"detail": "override_reason required when override=true."}, status=status.HTTP_400_BAD_REQUEST)

            # Persist a new assignment atomically (similar to AutoAssignAPIView)
            with transaction.atomic():
                job_locked = Job.objects.select_for_update().get(pk=job.id)
                # allow reassign even if job already had assigned_technician (we can reassign)
                tech = Technician.objects.get(pk=chosen["technician_id"])

                # create Assignment
                reason_text = f"SLA mitigation reassign: {sla.reason}"
                if override_flag:
                    reason_text = f"Forced SLA reassign by {user.username}: {override_reason}. {reason_text}"

                assignment = Assignment.objects.create(
                    job=job_locked,
                    technician=tech,
                    score_breakdown=chosen.get("score_breakdown", {}) if isinstance(chosen, dict) else {},
                    reason=reason_text,
                    created_by=user,
                )

                # update job assigned_technician (overwrite)
                job_locked.assigned_technician = tech
                job_locked.status = getattr(job_locked, "STATUS_ASSIGNED", "assigned")
                job_locked.save(update_fields=["assigned_technician", "status"])

                # mark SLAAction applied
                sla.mark_applied()

            resp["assigned"] = True
            resp["assignment"] = AssignmentSerializer(assignment, context={"request": request}).data
            if override_flag:
                resp["forced_override"] = True
                resp["override_reason"] = override_reason

            return Response(resp, status=status.HTTP_201_CREATED)

        return Response({"detail": "Unsupported action"}, status=status.HTTP_400_BAD_REQUEST)

# core/views.py (append)
from django.utils import timezone
from django.core.paginator import Paginator
from django.db.models import Q
from django.utils.dateparse import parse_datetime, parse_date
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, permissions

from .models import Job, Assignment, SLAAction, Technician
from .serializers import AnalyticsJobTraceSerializer
from .auto_assign import haversine_km

import math

DEFAULT_PAGE_SIZE = 25

def _parse_range(from_str, to_str):
    """Return (start, end) datetimes. If missing, return last 7 days."""
    now = timezone.now()
    if not from_str and not to_str:
        end = now
        start = now - timezone.timedelta(days=7)
        return start, end
    start = None
    end = None
    if from_str:
        # try parse datetime then date
        start = parse_datetime(from_str) or (parse_date(from_str) and timezone.make_aware(timezone.datetime.combine(parse_date(from_str), timezone.datetime.min.time())))
    if to_str:
        end = parse_datetime(to_str) or (parse_date(to_str) and timezone.make_aware(timezone.datetime.combine(parse_date(to_str), timezone.datetime.max.time())))
    # fallback defaults
    if not start:
        start = now - timezone.timedelta(days=7)
    if not end:
        end = now
    return start, end

class AnalyticsOverviewAPIView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        """
        GET /api/analytics/overview/?from=ISO&to=ISO&page=1&page_size=25
        Returns KPIs and paginated per-job traces.
        """
        from_q = request.query_params.get("from")
        to_q = request.query_params.get("to")
        page = int(request.query_params.get("page", 1))
        page_size = int(request.query_params.get("page_size", DEFAULT_PAGE_SIZE))

        start, end = _parse_range(from_q, to_q)

        # Consider assignments created in the window (this gives us actual work performed)
        assignments_qs = Assignment.objects.select_related("job", "technician__user").filter(
            created_at__gte=start, created_at__lte=end
        ).order_by("created_at")

        # Build earliest assignment per job (first assignment is the audit of who handled job)
        earliest_by_job = {}
        for a in assignments_qs:
            if a.job_id not in earliest_by_job:
                earliest_by_job[a.job_id] = a

        job_ids = list(earliest_by_job.keys())
        total_jobs = len(job_ids)

        # KPI calculations
        on_time_count = 0
        travel_sum = 0.0
        travel_count = 0
        first_time_fix_count = 0
        first_time_fix_total = 0
        traces = []

        # fetch SLA actions in range
        sla_qs = SLAAction.objects.filter(created_at__gte=start, created_at__lte=end)
        sla_breaches = sla_qs.filter(risk_level__in=["high", "medium"]).count()

        for jid, assignment in earliest_by_job.items():
            job = assignment.job
            tech = assignment.technician
            # compute window_end if present
            window_end = getattr(job, "requested_window_end", None)
            if window_end is None and getattr(job, "requested_window_start", None):
                window_end = job.requested_window_start + timezone.timedelta(minutes=(job.estimated_duration_minutes or 0))

            # find on_time: compare assignment.created_at to window_end
            on_time = None
            if window_end and assignment.created_at:
                on_time = assignment.created_at <= window_end
                if on_time:
                    on_time_count += 1

            # travel_km: prefer assignment.score_breakdown.distance_km if present
            travel_km = None
            try:
                sb = getattr(assignment, "score_breakdown", None) or {}
                if isinstance(sb, dict) and sb.get("distance_km") is not None:
                    travel_km = float(sb.get("distance_km") or 0.0)
                else:
                    # fallback compute from job lat/lon and technician last known location
                    job_lat = getattr(job, "lat", None) or getattr(job, "latitude", None)
                    job_lon = getattr(job, "lon", None) or getattr(job, "longitude", None)
                    tech_lat = getattr(tech, "last_lat", None)
                    tech_lon = getattr(tech, "last_lon", None)
                    if None not in (job_lat, job_lon, tech_lat, tech_lon):
                        travel_km = haversine_km(job_lat, job_lon, tech_lat, tech_lon)
                        # ensure numeric
                        if travel_km is not None:
                            travel_km = float(travel_km)
            except Exception:
                travel_km = None

            if travel_km is not None:
                travel_sum += travel_km
                travel_count += 1

            # first_time_fix: various possible field names - check defensively
            ffix = None
            if hasattr(job, "first_time_fix"):
                ffix = bool(getattr(job, "first_time_fix"))
            elif hasattr(job, "first_visit_success"):
                ffix = bool(getattr(job, "first_visit_success"))
            elif hasattr(job, "fix_attempts"):
                try:
                    ffix = (int(getattr(job, "fix_attempts") or 0) == 1)
                except Exception:
                    ffix = None

            if ffix is not None:
                first_time_fix_total += 1
                if ffix:
                    first_time_fix_count += 1

            # collect SLA flags for this job in range
            sla_items = []
            for s in sla_qs.filter(job=job).order_by("-created_at"):
                sla_items.append({
                    "id": s.id,
                    "risk_level": s.risk_level,
                    "risk_score": float(s.risk_score or 0.0),
                    "recommended_action": s.recommended_action,
                    "status": s.status,
                    "created_at": s.created_at,
                    "meta": s.meta or {},
                })

            trace = {
                "job_id": job.id,
                "customer_name": getattr(job, "customer_name", None),
                "assigned_technician": getattr(getattr(assignment, "technician", None), "user", None) and getattr(assignment.technician.user, "username", None) or str(getattr(assignment, "technician", None)),
                "assignment_time": assignment.created_at,
                "travel_km": travel_km,
                "on_time": on_time,
                "first_time_fix": ffix,
                "sla_flags": sla_items,
                "meta": getattr(job, "meta", {}) or {},
            }
            traces.append(trace)

        on_time_rate = (on_time_count / total_jobs) if total_jobs else None
        avg_travel_km = (travel_sum / travel_count) if travel_count else None
        first_time_fix_rate = (first_time_fix_count / first_time_fix_total) if first_time_fix_total else None

        # paginate traces (sorted by assignment_time desc)
        traces_sorted = sorted(traces, key=lambda t: t["assignment_time"] or timezone.datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        paginator = Paginator(traces_sorted, page_size)
        page_obj = paginator.get_page(page)

        data = {
            "range": {"from": start.isoformat(), "to": end.isoformat()},
            "kpis": {
                "total_jobs": total_jobs,
                "on_time_rate": on_time_rate,
                "avg_travel_km": avg_travel_km,
                "first_time_fix_rate": first_time_fix_rate,
                "sla_breaches": sla_breaches,
            },
            "traces": page_obj.object_list,
            "pagination": {
                "page": page_obj.number,
                "num_pages": paginator.num_pages,
                "page_size": page_size,
                "total_traces": paginator.count,
            }
        }
        return Response(data, status=status.HTTP_200_OK)
