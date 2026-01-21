# backend/core/views_geo.py

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from django.core.cache import cache
from django.conf import settings
import logging

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 60 * 60 * 24 * 7  # 7 days


def get_geolocator():
    """
    Lazy-load geopy so Django never crashes at import time.
    """
    try:
        from geopy.geocoders import Nominatim
        return Nominatim(
            user_agent=getattr(
                settings,
                "GEOPY_USER_AGENT",
                "hof_smart_app/1.0 (backend)"
            )
        )
    except Exception as e:
        logger.exception("Geopy not available")
        return None


class GeoReverseAPIView(APIView):
    """
    GET /api/geo/reverse/?lat=<lat>&lon=<lon>

    Returns:
    {
      "name": <short name or None>,
      "display_name": <human readable location or None>,
      "raw": <provider payload or None>
    }
    """

    permission_classes = (IsAuthenticated,)

    def get(self, request, *args, **kwargs):
        lat = request.query_params.get("lat")
        lon = request.query_params.get("lon")

        if lat is None or lon is None:
            return Response(
                {"detail": "lat and lon query parameters are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            latf = float(lat)
            lonf = float(lon)
        except (TypeError, ValueError):
            return Response(
                {"detail": "lat and lon must be numeric"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        cache_key = f"geo_rev:{latf:.6f}:{lonf:.6f}"
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        geolocator = get_geolocator()
        if geolocator is None:
            payload = {
                "name": None,
                "display_name": None,
                "raw": None,
                "warning": "geolocation_service_unavailable",
            }
            cache.set(cache_key, payload, 300)
            return Response(payload, status=status.HTTP_200_OK)

        try:
            loc = geolocator.reverse(
                (latf, lonf),
                exactly_one=True,
                timeout=10,
            )

            if not loc:
                payload = {"name": None, "display_name": None, "raw": None}
            else:
                raw = getattr(loc, "raw", None)

                name = None
                display_name = None

                if isinstance(raw, dict):
                    address = raw.get("address", {})
                    name = (
                        raw.get("name")
                        or address.get("road")
                        or address.get("village")
                        or address.get("town")
                        or address.get("city")
                        or address.get("county")
                    )
                    display_name = raw.get("display_name") or loc.address
                else:
                    display_name = getattr(loc, "address", None)

                payload = {
                    "name": name,
                    "display_name": display_name,
                    "raw": raw,
                }

            cache.set(cache_key, payload, CACHE_TTL_SECONDS)
            return Response(payload)

        except Exception as e:
            logger.exception("Reverse geocoding failed")
            payload = {
                "name": None,
                "display_name": None,
                "raw": None,
                "error": "reverse_geocoding_failed",
            }
            return Response(payload, status=status.HTTP_200_OK)
