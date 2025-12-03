# core/serializers.py
from django.contrib.auth import get_user_model
from rest_framework import serializers
from .models import Profile, Technician, Skill, Job, Assignment, SLAAction
from decimal import Decimal

# geopy import for server-side geocoding (best-effort; dev use with Nominatim)
try:
    from geopy.geocoders import Nominatim
    from geopy.exc import GeopyError
    geolocator = Nominatim(user_agent="hof_smart_app/1.0 (dev)")
except Exception:
    geolocator = None
    GeopyError = Exception  # fallback so code below can still reference GeopyError


User = get_user_model()


def _try_geocode_address(address):
    """
    Try to geocode an address using geopy.Nominatim.
    Returns (Decimal(lat), Decimal(lon)) or (None, None) on failure.
    This is best-effort and must not raise.
    """
    if not address:
        return None, None
    if not geolocator:
        return None, None
    try:
        loc = geolocator.geocode(address, exactly_one=True, timeout=10)
        if not loc:
            return None, None
        # quantize to 6 decimals
        lat = Decimal(str(loc.latitude)).quantize(Decimal("0.000001"))
        lon = Decimal(str(loc.longitude)).quantize(Decimal("0.000001"))
        return lat, lon
    except GeopyError:
        return None, None
    except Exception:
        return None, None


class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = Profile
        fields = ("role", "phone", "last_seen", "created_at")


class UserSerializer(serializers.ModelSerializer):
    profile = ProfileSerializer(read_only=True)

    class Meta:
        model = User
        fields = ("id", "username", "email", "first_name", "last_name", "profile")


class UserLightSerializer(serializers.ModelSerializer):
    profile = ProfileSerializer(read_only=True)

    class Meta:
        model = User
        fields = ("id", "username", "email", "profile")


class SkillSerializer(serializers.ModelSerializer):
    class Meta:
        model = Skill
        fields = ("id", "code", "name", "created_at")


class TechnicianSerializer(serializers.ModelSerializer):
    user = UserLightSerializer(read_only=True)
    skills = SkillSerializer(many=True, read_only=True)
    skill_ids = serializers.PrimaryKeyRelatedField(
        many=True, write_only=True, queryset=Skill.objects.all(), source="skills", required=False
    )

    class Meta:
        model = Technician
        fields = ("id", "user", "status", "last_lat", "last_lon", "skills", "skill_ids", "created_at")


class TechnicianSummarySerializer(serializers.Serializer):
    id = serializers.IntegerField()
    username = serializers.CharField(allow_null=True, required=False)


class JobSerializer(serializers.ModelSerializer):
    required_skills = SkillSerializer(many=True, read_only=True)
    required_skill_ids = serializers.PrimaryKeyRelatedField(
        many=True, write_only=True, queryset=Skill.objects.all(), source="required_skills", required=False
    )

    # IMPORTANT: assigned_technician is a simple primitive value safe for the UI
    assigned_technician = serializers.SerializerMethodField(read_only=True)
    assigned_technician_summary = serializers.SerializerMethodField(read_only=True)
    assigned_technician_detail = TechnicianSerializer(read_only=True, source="assigned_technician")

    assigned_technician_id = serializers.PrimaryKeyRelatedField(
        write_only=True, queryset=Technician.objects.all(), source="assigned_technician", allow_null=True, required=False
    )

    class Meta:
        model = Job
        fields = (
            "id",
            "customer_name",
            "address",
            "lat",
            "lon",
            "requested_window_start",
            "requested_window_end",
            "status",
            "required_skills",
            "required_skill_ids",
            "estimated_duration_minutes",
            "assigned_technician",
            "assigned_technician_summary",
            "assigned_technician_detail",
            "assigned_technician_id",
            "notes",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("created_at", "updated_at")

    def _tech_username_or_full(self, tech):
        """Return username/fullname or None when no user info available."""
        if not tech:
            return None
        user = getattr(tech, "user", None)
        if not user:
            return None
        try:
            get_full = getattr(user, "get_full_name", None)
            if callable(get_full):
                full = user.get_full_name()
                if full:
                    return full
            if getattr(user, "username", None):
                return user.username
        except Exception:
            return None
        return None

    def get_assigned_technician(self, obj):
        """
        Return a primitive that frontends can safely test:
         - None when there's no technician (so UI can show 'unassigned')
         - username / fullname string when assigned
        """
        tech = getattr(obj, "assigned_technician", None)
        return self._tech_username_or_full(tech)

    def get_assigned_technician_summary(self, obj):
        tech = getattr(obj, "assigned_technician", None)
        if not tech:
            return None
        user = getattr(tech, "user", None)
        username = None
        try:
            if user and getattr(user, "username", None):
                username = user.username
            else:
                if user and callable(getattr(user, "get_full_name", None)):
                    username = user.get_full_name() or None
        except Exception:
            username = None
        return {"id": tech.id, "username": username}

    def create(self, validated_data):
        """
        On create, if lat/lon not provided but address present, attempt geocode (best-effort).
        Keep behavior conservative: don't override provided coords and don't raise on geocode failure.
        """
        lat = validated_data.get("lat", None)
        lon = validated_data.get("lon", None)
        address = validated_data.get("address") or validated_data.get("location") or None

        if (lat is None or lon is None) and address:
            g_lat, g_lon = _try_geocode_address(address)
            if g_lat is not None and g_lon is not None:
                validated_data["lat"] = g_lat
                validated_data["lon"] = g_lon

        return super().create(validated_data)

    def update(self, instance, validated_data):
        """
        On update, if address changed (or provided) and coords missing, attempt geocode.
        Do not overwrite existing coords if present in validated_data.
        """
        address = validated_data.get("address", None)
        lat = validated_data.get("lat", None)
        lon = validated_data.get("lon", None)
        if address and (lat is None or lon is None):
            g_lat, g_lon = _try_geocode_address(address)
            if g_lat is not None and g_lon is not None:
                # only set if not provided explicitly
                validated_data.setdefault("lat", g_lat)
                validated_data.setdefault("lon", g_lon)
        return super().update(instance, validated_data)


class JobCreateSerializer(serializers.Serializer):
    customer_name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    address = serializers.CharField(max_length=512, required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    requested_window_start = serializers.DateTimeField(required=False, allow_null=True)
    requested_window_end = serializers.DateTimeField(required=False, allow_null=True)
    estimated_duration_minutes = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    # accept optional lat/lon from frontend map
    lat = serializers.DecimalField(required=False, allow_null=True, max_digits=9, decimal_places=6)
    lon = serializers.DecimalField(required=False, allow_null=True, max_digits=9, decimal_places=6)
    required_skill_ids = serializers.ListField(child=serializers.IntegerField(), required=False)

    def create(self, validated_data):
        """
        Create Job. Attempt geocode if coords missing and address provided.
        Keep behavior minimal and safe.
        """
        customer_name = validated_data.get("customer_name") or "Customer"
        status = getattr(Job, "STATUS_NEW", "new")

        # Attempt geocode only if lat/lon not provided and address present
        lat = validated_data.get("lat", None)
        lon = validated_data.get("lon", None)
        address = validated_data.get("address", "") or ""

        if (lat is None or lon is None) and address:
            g_lat, g_lon = _try_geocode_address(address)
            if g_lat is not None and g_lon is not None:
                validated_data["lat"] = g_lat
                validated_data["lon"] = g_lon

        job = Job.objects.create(
            customer_name=customer_name,
            address=address,
            notes=validated_data.get("notes", "") or "",
            requested_window_start=validated_data.get("requested_window_start", None),
            requested_window_end=validated_data.get("requested_window_end", None),
            estimated_duration_minutes=validated_data.get("estimated_duration_minutes", None),
            status=status,
            lat=validated_data.get("lat", None),
            lon=validated_data.get("lon", None),
        )

        # attach required skills if provided (many-to-many)
        req_skill_ids = validated_data.get("required_skill_ids", None)
        if req_skill_ids:
            try:
                skills_qs = Skill.objects.filter(id__in=req_skill_ids)
                job.required_skills.set(skills_qs)
            except Exception:
                # be defensive: ignore errors setting skills rather than fail creation
                pass

        return job


class AssignmentSerializer(serializers.ModelSerializer):
    job = JobSerializer(read_only=True)
    job_id = serializers.PrimaryKeyRelatedField(write_only=True, queryset=Job.objects.all(), source="job")

    technician = serializers.SerializerMethodField(read_only=True)
    technician_id = serializers.PrimaryKeyRelatedField(write_only=True, queryset=Technician.objects.all(), source="technician")
    created_by = UserLightSerializer(read_only=True)

    class Meta:
        model = Assignment
        fields = (
            "id",
            "job",
            "job_id",
            "technician",
            "technician_id",
            "score_breakdown",
            "reason",
            "created_by",
            "created_at",
        )
        read_only_fields = ("created_at",)

    def get_technician(self, obj):
        tech = getattr(obj, "technician", None)
        if not tech:
            return None
        user = getattr(tech, "user", None)
        username = None
        try:
            if user and getattr(user, "username", None):
                username = user.username
            else:
                if user and callable(getattr(user, "get_full_name", None)):
                    username = user.get_full_name() or None
        except Exception:
            username = None
        return {"id": tech.id, "username": username}


class SLAActionSerializer(serializers.ModelSerializer):
    suggested_technician = serializers.SerializerMethodField()
    job_id = serializers.IntegerField(source="job.id", read_only=True)

    class Meta:
        model = SLAAction
        fields = [
            "id", "job_id", "recommended_action", "reason", "risk_score", "risk_level",
            "status", "created_at", "applied_at", "suggested_technician", "meta",
        ]

    def get_suggested_technician(self, obj):
        if obj.suggested_technician:
            return {"id": obj.suggested_technician.id, "username": getattr(obj.suggested_technician.user, "username", None)}
        return None


class AnalyticsJobTraceSerializer(serializers.Serializer):
    job_id = serializers.IntegerField()
    customer_name = serializers.CharField(allow_null=True, required=False)
    assigned_technician = serializers.CharField(allow_null=True, required=False)
    assignment_time = serializers.DateTimeField(allow_null=True, required=False)
    travel_km = serializers.FloatField(allow_null=True, required=False)
    on_time = serializers.BooleanField(allow_null=True, required=False)
    first_time_fix = serializers.BooleanField(allow_null=True, required=False)
    sla_flags = serializers.ListField(child=serializers.DictField(), required=False)
    meta = serializers.DictField(required=False)
