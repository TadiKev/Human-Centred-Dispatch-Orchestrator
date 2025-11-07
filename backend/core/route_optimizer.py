# backend/core/route_optimizer.py
import math
import logging
from ortools.constraint_solver import pywrapcp, routing_enums_pb2

logger = logging.getLogger(__name__)

def haversine_km(lat1, lon1, lat2, lon2):
    # same simple haversine used elsewhere
    R = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c

def build_distance_matrix(coords):
    """
    coords: list of (lat, lon) tuples
    returns a matrix of integer distances (meters rounded) for OR-Tools
    """
    n = len(coords)
    mat = [[0]*n for _ in range(n)]
    for i in range(n):
        lat1, lon1 = coords[i]
        for j in range(n):
            if i == j:
                mat[i][j] = 0
            else:
                lat2, lon2 = coords[j]
                if lat1 is None or lon1 is None or lat2 is None or lon2 is None:
                    mat[i][j] = 10**7  # large penalty for missing coords
                else:
                    km = haversine_km(lat1, lon1, lat2, lon2)
                    mat[i][j] = int(round(km * 1000))  # meters
    return mat

def optimize_order_ortools(start_coord, job_coords, timeout_seconds=10):
    """
    start_coord: (lat, lon) start position (technician)
    job_coords: list of (lat, lon) for jobs in arbitrary order
    returns: ordered indices into job_coords (list)
    """

    if not job_coords:
        return []

    # build coords: index 0 = start, then jobs 1..n
    coords = [start_coord] + job_coords
    dm = build_distance_matrix(coords)

    size = len(coords)
    manager = pywrapcp.RoutingIndexManager(size, 1, 0)  # single vehicle, depot=0
    routing = pywrapcp.RoutingModel(manager)

    def distance_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return dm[from_node][to_node]

    transit_cb = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_cb)

    # search parameters
    search_params = pywrapcp.DefaultRoutingSearchParameters()
    search_params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    search_params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    search_params.time_limit.seconds = int(timeout_seconds)
    search_params.log_search = False

    solution = routing.SolveWithParameters(search_params)
    if solution is None:
        logger.warning("OR-Tools returned no solution, falling back to input order")
        return list(range(len(job_coords)))

    # extract route (skip depot 0)
    index = routing.Start(0)
    ordered_job_indices = []
    while not routing.IsEnd(index):
        node = manager.IndexToNode(index)
        if node != 0:
            ordered_job_indices.append(node - 1)  # -1 to map to job_coords indexes
        index = solution.Value(routing.NextVar(index))

    return ordered_job_indices
