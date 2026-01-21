# core/serializers.py
import json 
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


# backend/core/serializers.py
# (REPLACE ONLY the AssignmentSerializer class with this block)

class AssignmentSerializer(serializers.ModelSerializer):
    job = JobSerializer(read_only=True)
    job_id = serializers.PrimaryKeyRelatedField(write_only=True, queryset=Job.objects.all(), source="job")

    technician = serializers.SerializerMethodField(read_only=True)
    technician_id = serializers.PrimaryKeyRelatedField(write_only=True, queryset=Technician.objects.all(), source="technician")
    created_by = UserLightSerializer(read_only=True)

    # Friendly, pre-parsed explanation fields for the UI
    explanation_text = serializers.SerializerMethodField(read_only=True)
    explanation_bullets = serializers.SerializerMethodField(read_only=True)
    explanation_confidence = serializers.SerializerMethodField(read_only=True)
    explanation_alternatives = serializers.SerializerMethodField(read_only=True)

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
            "explanation_text",
            "explanation_bullets",
            "explanation_confidence",
            "explanation_alternatives",
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

    # -------------------------
    # Internal helpers
    # -------------------------
    def _parse_reason(self, obj):
        """Return dict representation for obj.reason or None."""
        reason = getattr(obj, "reason", None)
        if not reason:
            return None
        if isinstance(reason, dict):
            return reason
        if isinstance(reason, str):
            try:
                parsed = json.loads(reason)
                if isinstance(parsed, dict):
                    return parsed
            except Exception:
                return {"text": reason}
        try:
            return {"text": str(reason)}
        except Exception:
            return None

    def _get_score_policy_raw(self, obj):
        """
        Helper to return a raw policy dict candidate/result possibly embedded
        either in reason['raw'] or in obj.score_breakdown / obj.reason.
        """
        r = self._parse_reason(obj) or {}
        raw_from_reason = r.get("raw")
        if isinstance(raw_from_reason, dict):
            return raw_from_reason
        sb = getattr(obj, "score_breakdown", None)
        # If score_breakdown looks like components for the chosen candidate, embed it
        if isinstance(sb, dict):
            return {"chosen": {"score_breakdown": sb, "score": sb.get("score"), "username": None}, "candidates": []}
        return raw_from_reason or {}

    # -------------------------
    # Public serializer fields
    # -------------------------
    def get_explanation_text(self, obj):
        """
        Preferred single-line summary:
         - If reason['text'] exists return it
         - Else, synthesize: 'Assigned to {username} — <top_reasons>. Confidence: NN%'
         - Else fallback to 'Auto-rule dispatch'
        """
        r = self._parse_reason(obj)
        if r:
            text = r.get("text")
            if text:
                return text

        # synthesize from raw policy or score_breakdown
        raw = self._get_score_policy_raw(obj) or {}
        chosen = raw.get("chosen") if isinstance(raw, dict) else None

        # pick username / name
        if isinstance(chosen, dict):
            uname = chosen.get("username") or chosen.get("name")
            score = chosen.get("score")
            # short list of reasons from components if present
            comps = chosen.get("score_breakdown") or {}
            reasons = []
            try:
                if comps.get("skill_match_count"):
                    reasons.append("strong skill match")
                if comps.get("distance_km") is not None and float(comps.get("distance_km")) <= 25:
                    reasons.append("close proximity")
                if comps.get("availability") and int(float(comps.get("availability"))):
                    reasons.append("available now")
            except Exception:
                pass

            summary = ", ".join(reasons) if reasons else "best composite score"
            if uname and score is not None:
                try:
                    percent = int(round(self._compute_confidence_from_raw(raw) * 100))
                    return f"Assigned to {uname} — {summary}. Confidence: {percent}%."
                except Exception:
                    return f"Assigned to {uname} — {summary}."
            if uname:
                return f"Assigned to {uname} — {summary}."

        # fallback to score_breakdown if present on assignment
        sb = getattr(obj, "score_breakdown", None) or {}
        if isinstance(sb, dict) and sb.get("score") is not None:
            try:
                return f"Auto-rule dispatch — composite score {round(float(sb.get('score')),3)}."
            except Exception:
                return "Auto-rule dispatch."

        # final fallback
        return "Auto-rule dispatch."

    def _compute_confidence_from_raw(self, raw, top_k: int = 5, min_conf: float = 0.05):
        """
        Robust confidence estimator (0..1) from a raw policy dict.

        Strategy:
         - Try to collect numeric scores for up to top_k candidates.
         - Use numerically stable softmax: exp(score - max_score) / sum(...)
         - Match chosen candidate to pick its softmax probability.
         - If no candidate list available but we have a single chosen score, map it with a logistic fallback.
         - Always return at least min_conf (so UI never shows 0%).
        """
        try:
            import math
            if not isinstance(raw, dict):
                return float(min_conf)

            chosen = raw.get("chosen") or {}
            candidates = raw.get("candidates") or []

            # collect up to top_k numeric scores (try robust parsing)
            scores = []
            for c in (candidates[:top_k] if isinstance(candidates, (list, tuple)) else []):
                s = None
                if isinstance(c, dict):
                    s = c.get("score")
                    if s is None:
                        sb = c.get("score_breakdown") or {}
                        s = sb.get("score") if isinstance(sb, dict) else None
                try:
                    scores.append(float(s) if s is not None else 0.0)
                except Exception:
                    scores.append(0.0)

            # get chosen score if explicitly present
            chosen_score = None
            try:
                chosen_score = chosen.get("score")
            except Exception:
                chosen_score = None
            if chosen_score is None and isinstance(chosen.get("score_breakdown"), dict):
                try:
                    chosen_score = chosen.get("score_breakdown").get("score")
                except Exception:
                    chosen_score = None
            try:
                chosen_score = float(chosen_score) if chosen_score is not None else None
            except Exception:
                chosen_score = None

            # Case: we have candidate scores -> softmax
            if scores:
                # extend scores if chosen_score present but not in candidates (so chosen is included)
                used_scores = list(scores)
                chosen_index = None

                # try find chosen in provided candidate list by technician id or username
                chosen_tid = chosen.get("technician_id") or chosen.get("id")
                if chosen_tid is not None:
                    for i, c in enumerate(candidates[:top_k]):
                        try:
                            if isinstance(c, dict) and (c.get("technician_id") == chosen_tid or c.get("id") == chosen_tid):
                                chosen_index = i
                                break
                        except Exception:
                            continue

                # if chosen not found but chosen_score available, append it so we can compute its softmax
                if chosen_index is None and chosen_score is not None:
                    used_scores.append(chosen_score)
                    chosen_index = len(used_scores) - 1

                # numeric stability: subtract max before exponentiating
                max_s = max(used_scores) if used_scores else 0.0
                exps = [math.exp(s - max_s) for s in used_scores]
                ssum = sum(exps) if exps else 1.0

                # if chosen index not known, default to top scorer (index of first max)
                if chosen_index is None:
                    try:
                        chosen_index = int(used_scores.index(max(used_scores)))
                    except Exception:
                        chosen_index = 0

                conf = float(exps[chosen_index] / (ssum or 1.0))
                # clamp and enforce minimal floor
                conf = max(min_conf, min(0.999, conf))
                return conf

            # Case: no candidate list but a single chosen_score exists -> fallback mapping
            if chosen_score is not None:
                # logistic map to (0,1). Scale chosen_score to reasonable range with a divisor.
                try:
                    conf = 1.0 / (1.0 + math.exp(-chosen_score / 5.0))
                except Exception:
                    conf = 0.5
                conf = max(min_conf, min(0.999, conf))
                return conf

        except Exception:
            # on any failure return minimum safe confidence
            return float(min_conf)

        # nothing found -> return minimum floor
        return float(min_conf)

    def get_explanation_confidence(self, obj):
        r = self._parse_reason(obj) or {}
        try:
            explicit = r.get("confidence")
            if isinstance(explicit, (int, float)):
                return round(float(explicit), 3)
            if isinstance(explicit, str):
                try:
                    v = float(explicit)
                    return round(v, 3)
                except Exception:
                    pass
        except Exception:
            pass

        raw = self._get_score_policy_raw(obj) or {}
        try:
            conf = self._compute_confidence_from_raw(raw)
            return round(float(conf), 3)
        except Exception:
            return round(0.05, 3)

    def get_explanation_bullets(self, obj):
        """
        Return list[str] - explicit bullets if present, else synthesized bullets from score_breakdown/raw.
        """
        r = self._parse_reason(obj)
        if r:
            bullets = r.get("bullets")
            if isinstance(bullets, (list, tuple)):
                # normalize to strings
                safe = []
                for b in bullets:
                    try:
                        safe.append(str(b))
                    except Exception:
                        continue
                if safe:
                    # avoid duplicate single 'Auto-rule dispatch' bullet
                    if len(safe) == 1 and safe[0].strip().lower() == "auto-rule dispatch".lower():
                        # prefer synthesized bullets instead of a single generic one
                        pass
                    else:
                        return safe

        # synthesize from score_breakdown or raw
        raw = self._get_score_policy_raw(obj) or {}
        chosen = raw.get("chosen") if isinstance(raw, dict) else None
        comps = None
        if isinstance(chosen, dict):
            comps = chosen.get("score_breakdown") or chosen.get("components")
        if not comps:
            sb = getattr(obj, "score_breakdown", None)
            if isinstance(sb, dict):
                comps = sb

        bullets = []
        if isinstance(comps, dict):
            try:
                sc = comps.get("skill_match_count") or comps.get("skills")
                if sc:
                    bullets.append(f"Has {int(sc)} required skill(s).")
            except Exception:
                pass

            d = comps.get("distance_km") or comps.get("distance")
            if d is not None:
                try:
                    bullets.append(f"Approx distance: {round(float(d), 3)} km.")
                except Exception:
                    bullets.append(f"Approx distance: {d} km.")

            avail = comps.get("availability") or comps.get("availability_score")
            try:
                if avail is not None and int(float(avail)):
                    bullets.append("Currently marked available.")
            except Exception:
                pass

            fat = comps.get("fatigue_score") or comps.get("fatigue")
            if fat is not None:
                try:
                    fval = float(fat)
                    if fval >= 0.8:
                        bullets.append(f"High recent workload (fatigue {round(fval,3)}).")
                    elif fval >= 0.4:
                        bullets.append(f"Moderate workload (fatigue {round(fval,3)}).")
                    else:
                        bullets.append("Low recent workload.")
                except Exception:
                    bullets.append(f"Fatigue: {fat}.")

            ac = comps.get("assigned_count") or comps.get("fatigue_count")
            if ac:
                try:
                    bullets.append(f"{int(ac)} active/recent job(s).")
                except Exception:
                    pass

        # if still empty, try any text fallback
        if not bullets:
            if r and r.get("text"):
                bullets = [str(r.get("text"))]
            else:
                # last-resort: return None so UI can show minimal text only
                return None

        return bullets

    def get_explanation_alternatives(self, obj):
        """
        Return list of small alternative candidate summaries (id, username, reason_short, score).
        """
        r = self._parse_reason(obj) or {}
        # try direct alternatives in reason
        alts = r.get("alternatives")
        if isinstance(alts, (list, tuple)) and alts:
            safe = []
            for a in alts[:3]:
                try:
                    safe.append({
                        "technician_id": a.get("technician_id") if isinstance(a, dict) else None,
                        "username": a.get("username") or a.get("name") or None,
                        "reason_short": a.get("reason_short") or None,
                        "score": a.get("score") if isinstance(a.get("score", None), (int, float)) else None,
                    })
                except Exception:
                    continue
            if safe:
                return safe

        # else attempt from raw policy
        raw = self._get_score_policy_raw(obj) or {}
        try:
            candidates = raw.get("candidates") or []
            alts = []
            for c in candidates[:3]:
                if not isinstance(c, dict):
                    continue
                try:
                    sb = c.get("score_breakdown") or {}
                    reason_short_parts = []
                    if sb.get("skill_match_count"):
                        reason_short_parts.append(f"{int(sb.get('skill_match_count'))} skills")
                    if sb.get("distance_km") is not None:
                        reason_short_parts.append(f"{round(float(sb.get('distance_km')),3)} km")
                    reason_short = ", ".join(reason_short_parts) if reason_short_parts else None
                except Exception:
                    reason_short = None

                alts.append({
                    "technician_id": c.get("technician_id") or c.get("id"),
                    "username": c.get("username") or c.get("name"),
                    "reason_short": reason_short,
                    "score": c.get("score"),
                })
            return alts if alts else None
        except Exception:
            return None



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

# backend/core/serializers.py (append)
from rest_framework import serializers
from .models import Technician

class TechnicianWorkloadSerializer(serializers.ModelSerializer):
    fatigue_score = serializers.FloatField(read_only=True)
    assigned_count = serializers.IntegerField(read_only=True)
    recent_completed_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Technician
        fields = ("id", "user", "status", "last_lat", "last_lon", "fatigue_score", "assigned_count", "recent_completed_count")
