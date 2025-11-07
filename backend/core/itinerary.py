# backend/core/itinerary.py
from django.utils import timezone
from django.shortcuts import get_object_or_404
from datetime import timedelta
import math

# Optional OR-Tools import (best-effort)
try:
    from ortools.constraint_solver import pywrapcp, routing_enums_pb2
    _HAS_ORTOOLS = True
except Exception:
    _HAS_ORTOOLS = False

# Import models lazily (avoid circular imports at import-time)
from .models import Technician, Job

# ----------------------
# Basic geo/time helpers
# ----------------------
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
    if dist_km is None:
        return None
    try:
        return (dist_km / float(speed_kmph)) * 60.0
    except Exception:
        return None

def _format_iso(dt):
    if dt is None:
        return None
    return timezone.localtime(dt).isoformat()

# ----------------------
# Itinerary builders
# ----------------------
def build_itinerary_from_order(start_lat, start_lon, jobs_ordered, now=None, default_speed_kmph=40.0, default_service_minutes=60):
    if now is None:
        now = timezone.now()

    cur_lat = start_lat
    cur_lon = start_lon
    cur_time = now
    stops = []
    total_km = 0.0
    total_travel_minutes = 0.0

    for job in jobs_ordered:
        service_minutes = job.estimated_duration_minutes or default_service_minutes

        if cur_lat is not None and cur_lon is not None and job.lat is not None and job.lon is not None:
            dist = _haversine_km(cur_lat, cur_lon, job.lat, job.lon)
            travel_minutes = _minutes_for_distance(dist, speed_kmph=default_speed_kmph) or 0
        else:
            dist = None
            travel_minutes = 0

        arrival = cur_time + timedelta(minutes=travel_minutes)

        window_start = job.requested_window_start
        window_end = job.requested_window_end

        if window_start is not None and arrival < window_start:
            arrival = window_start

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

        if dist is not None:
            total_km += dist
            total_travel_minutes += travel_minutes

        cur_lat = job.lat if job.lat is not None else cur_lat
        cur_lon = job.lon if job.lon is not None else cur_lon
        cur_time = departure

    return stops, round(total_km, 3), round(total_travel_minutes, 1)


def nearest_neighbor_order(start_lat, start_lon, jobs_qs):
    jobs = list(jobs_qs)
    with_coords = [j for j in jobs if j.lat is not None and j.lon is not None]
    without_coords = [j for j in jobs if j.lat is None or j.lon is None]

    order = []
    cur_lat = start_lat
    cur_lon = start_lon

    if cur_lat is None or cur_lon is None:
        sorted_with = sorted(with_coords, key=lambda j: (j.requested_window_start or timezone.make_aware(timezone.datetime.min)))
        return sorted_with + without_coords

    remaining = with_coords.copy()
    while remaining:
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

    order.extend(without_coords)
    return order

# ----------------------
# OR-Tools solver (best-effort)
# ----------------------
def solve_with_ortools_time_windows(start_lat, start_lon, jobs, speed_kmph=40.0, default_service_minutes=60):
    """
    Best-effort: use OR-Tools to return an ordered list of job instances.
    If OR-Tools not installed or any job missing coords OR solver fails -> return None.
    """
    if not _HAS_ORTOOLS:
        return None

    # Ensure all jobs have coords (ORTools distance matrix requires coords)
    for job in jobs:
        if job.lat is None or job.lon is None:
            return None

    # Build list (index 0 = start, indexes 1..n = jobs)
    coords = [(start_lat, start_lon)] + [(j.lat, j.lon) for j in jobs]
    n = len(coords)
    if n <= 2:
        return jobs  # trivial

    # Haversine distance -> travel minutes
    def hav(lat1, lon1, lat2, lon2):
        return _haversine_km(lat1, lon1, lat2, lon2)

    travel_time = [[0]*n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            if i == j:
                travel_time[i][j] = 0
            else:
                km = hav(coords[i][0], coords[i][1], coords[j][0], coords[j][1])
                if km is None:
                    return None
                travel_time[i][j] = int(round((km / float(speed_kmph)) * 60.0))

    # Service times and time windows relative to "now"
    import datetime
    now = datetime.datetime.now(datetime.timezone.utc)
    def to_minutes(dt):
        if dt is None:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=datetime.timezone.utc)
        delta = dt - now
        return int(delta.total_seconds() // 60)

    service = [0]
    tw_start = [-(24*60*365)]
    tw_end = [24*60*365]
    for j in jobs:
        svc = j.estimated_duration_minutes or default_service_minutes
        service.append(int(svc))
        ws = to_minutes(j.requested_window_start)
        we = to_minutes(j.requested_window_end)
        tw_start.append(ws if ws is not None else -(24*60*365))
        tw_end.append(we if we is not None else (24*60*365))

    try:
        manager = pywrapcp.RoutingIndexManager(n, 1, 0)
        routing = pywrapcp.RoutingModel(manager)

        def time_callback(from_index, to_index):
            from_node = manager.IndexToNode(from_index)
            to_node = manager.IndexToNode(to_index)
            return travel_time[from_node][to_node] + service[to_node]

        transit_cb_idx = routing.RegisterTransitCallback(time_callback)
        routing.SetArcCostEvaluatorOfAllVehicles(transit_cb_idx)

        horizon = 24 * 60 * 7  # 7 days
        routing.AddDimension(
            transit_cb_idx,
            horizon,
            horizon,
            False,
            "Time"
        )
        time_dim = routing.GetDimensionOrDie("Time")

        # set time windows (shift by horizon//2 to avoid negative windows)
        shift = horizon // 2
        for node in range(n):
            idx = manager.NodeToIndex(node)
            start = tw_start[node] + shift
            end = tw_end[node] + shift
            if start > end:
                # skip invalid window
                continue
            time_dim.CumulVar(idx).SetRange(start, end)

        search_parameters = pywrapcp.DefaultRoutingSearchParameters()
        search_parameters.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
        search_parameters.time_limit.seconds = 5

        solution = routing.SolveWithParameters(search_parameters)
        if solution is None:
            return None

        # Extract route (skip depot)
        idx = routing.Start(0)
        ordered_jobs = []
        while not routing.IsEnd(idx):
            node = manager.IndexToNode(idx)
            if node != 0:
                ordered_jobs.append(jobs[node-1])
            idx = solution.Value(routing.NextVar(idx))
        return ordered_jobs
    except Exception:
        return None

# ----------------------
# Public entrypoint used by views/tasks
# ----------------------
def compute_itinerary_for_technician(tech_id, now=None, use_ortools=False, speed_kmph=40.0):
    """
    Returns payload:
      { technician_id, technician_username, now, current: {stops,...}, optimized: {stops,...}, comparison: {...}, note? }
    Best-effort: if OR-Tools requested but unavailable/fails, returns nearest-neighbour and sets note.
    """
    tech = get_object_or_404(Technician.objects.select_related("user"), pk=tech_id)

    jobs_qs = Job.objects.filter(assigned_technician=tech).order_by("requested_window_start", "-created_at")

    start_lat = tech.last_lat
    start_lon = tech.last_lon
    if (start_lat is None or start_lon is None) and jobs_qs.exists():
        first = jobs_qs.first()
        start_lat = first.lat
        start_lon = first.lon

    if now is None:
        now = timezone.now()

    # current order (by window)
    current_order_jobs = list(jobs_qs)
    current_stops, current_km, current_minutes = build_itinerary_from_order(
        start_lat, start_lon, current_order_jobs, now=now, default_speed_kmph=speed_kmph
    )

    note = None
    optimized_order_jobs = None

    if use_ortools:
        ort_order = solve_with_ortools_time_windows(start_lat, start_lon, current_order_jobs, speed_kmph=speed_kmph)
        if ort_order is not None:
            optimized_order_jobs = ort_order
        else:
            note = "use_ortools requested but OR-Tools unavailable/failed; falling back to nearest-neighbour."
            optimized_order_jobs = nearest_neighbor_order(start_lat, start_lon, jobs_qs)
    else:
        optimized_order_jobs = nearest_neighbor_order(start_lat, start_lon, jobs_qs)

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

    if note:
        payload["note"] = note

    return payload
