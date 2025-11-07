# backend/core/views_sync.py
from django.utils import timezone
from django.shortcuts import get_object_or_404
from django.db import transaction
from django.utils import dateparse

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status

from .models import Technician, Job, Assignment, SyncLog
from .serializers import JobSerializer
from .permissions import RolePermission


def parse_client_ts(ts):
    """Parse ISO datetime into aware timezone datetime or None."""
    if not ts:
        return None
    dt = dateparse.parse_datetime(ts)
    if dt is None:
        return None
    if timezone.is_naive(dt):
        return timezone.make_aware(dt)
    return dt


class TechJobsAPIView(APIView):
    """
    GET /api/tech/<tech_id>/jobs/?since=<iso-ts>
    tech_id: 'me' or numeric id
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, tech_id=None):
        # resolve technician
        if str(tech_id).lower() in ("me", "0", "none", "null", ""):
            try:
                tech = request.user.technician
            except Exception:
                return Response({"detail": "Technician profile not found for current user."}, status=status.HTTP_404_NOT_FOUND)
        else:
            tech = get_object_or_404(Technician, pk=tech_id)

        since = request.query_params.get("since")
        qs = Job.objects.filter(assigned_technician=tech).order_by("-updated_at", "-created_at")
        if since:
            dt = parse_client_ts(since)
            if dt is not None:
                qs = qs.filter(updated_at__gt=dt)

        serializer = JobSerializer(qs, many=True, context={"request": request})
        return Response({"server_ts": timezone.now(), "jobs": serializer.data})


class SyncAPIView(APIView):
    """
    POST /api/sync/
    Accepts:
    {
      "device_id": "...",
      "last_synced_at": "...",  // optional
      "events": [
         { "event": "complete_job", "payload": {"job_id": 12}, "client_ts": "..." },
         { "event": "update_job", "payload": {"job_id": 15, "changes": { ... }}, "client_ts": "..." }
      ]
    }

    Returns per-event results, and records each raw event into SyncLog for audit.
    Assignment changes are treated as critical: conflicts are detected when client_ts is older than job.updated_at.
    """
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request):
        payload = request.data or {}
        device_id = payload.get("device_id")
        last_synced_at = parse_client_ts(payload.get("last_synced_at"))
        events = payload.get("events", [])

        if not isinstance(events, list):
            return Response({"detail": "events must be a list"}, status=status.HTTP_400_BAD_REQUEST)

        results = {"applied": [], "conflicts": [], "errors": []}

        for ev in events:
            try:
                event_type = ev.get("event")
                client_ts = parse_client_ts(ev.get("client_ts")) or last_synced_at
                data = ev.get("payload", {}) or {}

                # persist raw event for audit
                try:
                    SyncLog.objects.create(device_id=device_id, user=request.user, event=event_type or "unknown", payload=data, client_ts=client_ts)
                except Exception:
                    # don't break sync if logging fails
                    pass

                # ---------- complete_job ----------
                if event_type == "complete_job":
                    job_id = data.get("job_id")
                    if job_id is None:
                        results["errors"].append({"event": ev, "reason": "missing job_id"})
                        continue

                    job = Job.objects.select_for_update().filter(pk=job_id).first()
                    if not job:
                        results["errors"].append({"event": ev, "reason": f"job {job_id} not found"})
                        continue

                    # LWW: only apply if client's timestamp is newer than server updated_at
                    apply_update = True
                    if client_ts and job.updated_at and client_ts <= job.updated_at:
                        apply_update = False

                    if apply_update:
                        job.status = getattr(Job, "STATUS_DONE", "done")
                        job.save()
                        results["applied"].append({"event": ev, "job_id": job_id})
                    else:
                        # create conflict log entry
                        conflict_payload = {
                            "conflict_type": "status_change",
                            "job_id": job.id,
                            "server_state": {"status": job.status, "job_updated_at": job.updated_at.isoformat() if job.updated_at else None},
                            "client_change": {"status": "done", "client_ts": client_ts.isoformat() if client_ts else None},
                        }
                        conflict = SyncLog.objects.create(device_id=device_id, user=request.user, event="conflict_status", payload=conflict_payload, client_ts=client_ts)
                        results["conflicts"].append({"event": ev, "job_id": job_id, "conflict_log_id": conflict.id, "reason": "older than server state"})

                # ---------- start_job ----------
                elif event_type == "start_job":
                    job_id = data.get("job_id")
                    if job_id is None:
                        results["errors"].append({"event": ev, "reason": "missing job_id"})
                        continue
                    job = Job.objects.select_for_update().filter(pk=job_id).first()
                    if not job:
                        results["errors"].append({"event": ev, "reason": f"job {job_id} not found"})
                        continue

                    job.status = getattr(Job, "STATUS_IN_PROGRESS", "in_progress")
                    job.save()
                    results["applied"].append({"event": ev, "job_id": job_id})

                # ---------- update_job / patch_job (generic) ----------
                elif event_type in ("update_job", "patch_job"):
                    job_id = data.get("job_id")
                    changes = data.get("changes") or data.get("patch") or {}
                    if not job_id:
                        results["errors"].append({"event": ev, "reason": "missing job_id"})
                        continue

                    job = Job.objects.select_for_update().filter(pk=job_id).first()
                    if not job:
                        results["errors"].append({"event": ev, "reason": f"job {job_id} not found"})
                        continue

                    # detect assignment changes (critical)
                    assign_change = None
                    if "assigned_technician_id" in changes:
                        assign_change = changes.get("assigned_technician_id")

                    # conflict detection for assignment
                    conflict_detected = False
                    if assign_change is not None and job.updated_at and client_ts:
                        try:
                            if job.updated_at > client_ts:
                                conflict_detected = True
                        except Exception:
                            conflict_detected = False

                    if conflict_detected:
                        conflict_payload = {
                            "conflict_type": "assignment_change",
                            "job_id": job.id,
                            "server_state": {
                                "assigned_technician_id": job.assigned_technician.id if job.assigned_technician else None,
                                "job_updated_at": job.updated_at.isoformat() if job.updated_at else None,
                            },
                            "client_change": {"assigned_technician_id": assign_change, "client_ts": client_ts.isoformat() if client_ts else None},
                        }
                        conflict = SyncLog.objects.create(device_id=device_id, user=request.user, event="conflict_assignment", payload=conflict_payload, client_ts=client_ts)
                        results["conflicts"].append({"event": ev, "job_id": job_id, "conflict_log_id": conflict.id, "reason": "assignment conflict (server newer)"})
                        continue

                    # no conflict -> apply allowed fields conservatively
                    applied = []
                    if "status" in changes:
                        job.status = changes["status"]; applied.append("status")
                    if "customer_name" in changes:
                        job.customer_name = changes["customer_name"]; applied.append("customer_name")
                    if "address" in changes:
                        job.address = changes["address"]; applied.append("address")
                    if "lat" in changes:
                        job.lat = changes["lat"]; applied.append("lat")
                    if "lon" in changes:
                        job.lon = changes["lon"]; applied.append("lon")
                    if "requested_window_start" in changes:
                        job.requested_window_start = parse_client_ts(changes["requested_window_start"]); applied.append("requested_window_start")
                    if "requested_window_end" in changes:
                        job.requested_window_end = parse_client_ts(changes["requested_window_end"]); applied.append("requested_window_end")
                    if "estimated_duration_minutes" in changes:
                        job.estimated_duration_minutes = changes["estimated_duration_minutes"]; applied.append("estimated_duration_minutes")
                    if "notes" in changes:
                        job.notes = changes["notes"]; applied.append("notes")

                    if assign_change is not None:
                        if assign_change in (None, "null", ""):
                            job.assigned_technician = None
                        else:
                            try:
                                tech = Technician.objects.get(pk=int(assign_change))
                                job.assigned_technician = tech
                            except Exception:
                                # invalid tech id -> ignore assignment
                                pass
                        applied.append("assigned_technician")

                    job.save()

                    # if assignment applied, create audit Assignment record
                    if "assigned_technician" in applied and job.assigned_technician:
                        Assignment.objects.create(
                            job=job,
                            technician=job.assigned_technician,
                            score_breakdown={"source": "sync_client"},
                            reason=f"Assigned via device {device_id} by user {request.user.username}",
                            created_by=request.user
                        )

                    results["applied"].append({"event": ev, "job_id": job_id, "applied_fields": applied})

                else:
                    # unsupported event
                    results["errors"].append({"event": ev, "reason": f"unsupported event type: {event_type}"})

            except Exception as e:
                results["errors"].append({"event": ev, "reason": str(e)})

        return Response({"result": results, "server_ts": timezone.now()})


class SyncConflictsList(APIView):
    """
    GET /api/sync/conflicts/
    Manager-only: list outstanding conflicts recorded in SyncLog.
    """
    permission_classes = [IsAuthenticated, RolePermission]
    allowed_roles = ["dispatcher", "admin"]

    def get(self, request):
        qs = SyncLog.objects.filter(event__icontains="conflict").order_by("-server_ts")[:500]
        items = []
        for s in qs:
            items.append({
                "id": s.id,
                "device_id": s.device_id,
                "user_id": getattr(s.user, "id", None),
                "user_username": getattr(s.user, "username", None),
                "event": s.event,
                "payload": s.payload,
                "client_ts": s.client_ts.isoformat() if s.client_ts else None,
                "server_ts": s.server_ts.isoformat() if getattr(s, "server_ts", None) else None,
            })
        return Response({"conflicts": items})


class ResolveConflictAPIView(APIView):
    """
    POST /api/sync/conflicts/<pk>/resolve/
    Body: { "resolution": "server" | "client" | "manual", "apply_change": {...} }
    - If 'client' chosen, tries to apply the client's change (payload.client_change) to server.
    - Records 'resolved_by' in the conflict SyncLog payload.
    """
    permission_classes = [IsAuthenticated, RolePermission]
    allowed_roles = ["dispatcher", "admin"]

    @transaction.atomic
    def post(self, request, pk=None):
        conflict = get_object_or_404(SyncLog, pk=pk)
        payload = conflict.payload or {}
        resolution = (request.data or {}).get("resolution")
        apply_change = (request.data or {}).get("apply_change") or payload.get("client_change")

        if resolution not in ("server", "client", "manual"):
            return Response({"detail": "resolution must be 'server'|'client'|'manual'."}, status=status.HTTP_400_BAD_REQUEST)

        # Apply client choice if requested
        if resolution == "client" and apply_change:
            try:
                job_id = payload.get("job_id") or (apply_change or {}).get("job_id")
                if not job_id:
                    return Response({"detail": "no job_id found in conflict payload or apply_change"}, status=status.HTTP_400_BAD_REQUEST)
                job = get_object_or_404(Job, pk=job_id)

                # Example: apply assigned_technician_id if present
                if "assigned_technician_id" in (apply_change or {}):
                    val = apply_change.get("assigned_technician_id")
                    if val in (None, "null", ""):
                        job.assigned_technician = None
                    else:
                        try:
                            tech = Technician.objects.get(pk=int(val))
                            job.assigned_technician = tech
                        except Exception:
                            job.assigned_technician = None
                    job.save(update_fields=["assigned_technician"])
                    if job.assigned_technician:
                        Assignment.objects.create(
                            job=job,
                            technician=job.assigned_technician,
                            score_breakdown={"source": "conflict_resolution_client"},
                            reason=f"Resolved by {request.user.username} (client choice)",
                            created_by=request.user,
                        )
                # Additional fields (status etc.) could be applied similarly as needed.

            except Exception as e:
                return Response({"detail": "failed applying client change", "error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # mark conflict as resolved
        payload["resolved_by"] = {
            "user_id": request.user.id,
            "username": request.user.username,
            "resolution": resolution,
            "resolved_at": timezone.now().isoformat(),
        }
        conflict.payload = payload
        conflict.save(update_fields=["payload"])

        return Response({"ok": True, "conflict_id": conflict.id, "resolution": resolution})
