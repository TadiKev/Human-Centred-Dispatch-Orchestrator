## File: `backend/ml/ingest/build_features.py`


"""
Feature extraction script for Phase A.

Usage (local):
  # set your DJANGO_SETTINGS_MODULE to your project settings module
  export DJANGO_SETTINGS_MODULE=your_project.settings
  python backend/ml/ingest/build_features.py --output data/features.csv

Inside Docker (example):
  docker compose exec backend bash -c "export DJANGO_SETTINGS_MODULE=your_project.settings && python backend/ml/ingest/build_features.py --output /app/data/features.csv"

The script will read Job and Assignment models and write a CSV row per job.
"""

import os
import csv
import argparse
import math
from datetime import timezone

# Django bootstrapping
import django

env = os.environ.copy()
# If user hasn't set DJANGO_SETTINGS_MODULE, we do not assume a specific project name.
# The user should set DJANGO_SETTINGS_MODULE externally, e.g. backend.settings
if not env.get("DJANGO_SETTINGS_MODULE"):
    print("WARNING: DJANGO_SETTINGS_MODULE not set. Please set it to your Django settings (e.g. 'backend.settings')")

os.environ.update(env)
try:
    django.setup()
except Exception:
    # Attempt to call setup anyway; many environments already have it set in Docker/entrypoint.
    try:
        django.setup()
    except Exception as e:
        raise RuntimeError("Failed to setup Django. Set DJANGO_SETTINGS_MODULE environment variable. Error: %s" % e)

from django.utils import timezone as dj_timezone
from core.models import Job, Assignment, Technician  # adjust import path if your app name differs


def haversine_km(lat1, lon1, lat2, lon2):
    try:
        R = 6371.0
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlambda = math.radians(lon2 - lon1)
        a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return R * c
    except Exception:
        return None


def worker(output_path):
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    fieldnames = [
        "job_id",
        "customer_name",
        "num_required_skills",
        "required_skill_ids",
        "has_required_skills",
        "assigned_technician_id",
        "assigned_technician_username",
        "tech_skill_match_count",
        "distance_km",
        "time_of_day",
        "weekday",
        "estimated_duration_minutes",
        "actual_duration_minutes",
        "was_completed",
        "was_no_show",
        "created_at",
        "updated_at",
    ]

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()

        qs = Job.objects.all().order_by("-created_at")
        for job in qs:
            # required skills
            req_skills = list(job.required_skills.all()) if hasattr(job, "required_skills") else []
            req_ids = ",".join(str(s.id) for s in req_skills)
            num_req = len(req_skills)

            # first assignment (earliest) if exists
            assignment = Assignment.objects.filter(job=job).order_by("created_at").first()
            assigned_tech = getattr(assignment, "technician", None) if assignment else None
            assigned_tech_id = getattr(assigned_tech, "id", None)
            assigned_tech_user = getattr(getattr(assigned_tech, "user", None), "username", None) if assigned_tech else None

            tech_skill_match_count = None
            distance = None
            if assigned_tech:
                tech_sk = list(assigned_tech.skills.all()) if hasattr(assigned_tech, "skills") else []
                tech_skill_ids = {s.id for s in tech_sk}
                tech_skill_match_count = len({s.id for s in req_skills} & tech_skill_ids)
                if job.lat is not None and job.lon is not None and assigned_tech.last_lat is not None and assigned_tech.last_lon is not None:
                    distance = haversine_km(job.lat, job.lon, assigned_tech.last_lat, assigned_tech.last_lon)

            # time features
            pivot = job.requested_window_start or job.created_at or dj_timezone.now()
            try:
                local_pivot = dj_timezone.localtime(pivot)
                time_of_day = local_pivot.hour
                weekday = local_pivot.weekday()
            except Exception:
                time_of_day = None
                weekday = None

            est = getattr(job, "estimated_duration_minutes", None)

            # actual duration: if job is completed (status==done) and we have an assignment created_at and job.updated_at
            actual_minutes = None
            was_completed = (getattr(job, "status", None) == "done")
            if was_completed and assignment and assignment.created_at and job.updated_at:
                try:
                    delta = job.updated_at - assignment.created_at
                    actual_minutes = round(delta.total_seconds() / 60.0, 2)
                except Exception:
                    actual_minutes = None

            # was_no_show heuristic: assigned but not completed and window_end passed
            was_no_show = None
            try:
                if assignment and job.requested_window_end:
                    now = dj_timezone.now()
                    if job.requested_window_end < now and not was_completed:
                        # job window ended and not completed
                        was_no_show = True
                    else:
                        was_no_show = False
                else:
                    was_no_show = None
            except Exception:
                was_no_show = None

            row = {
                "job_id": job.id,
                "customer_name": job.customer_name,
                "num_required_skills": num_req,
                "required_skill_ids": req_ids,
                "has_required_skills": bool(num_req),
                "assigned_technician_id": assigned_tech_id,
                "assigned_technician_username": assigned_tech_user,
                "tech_skill_match_count": tech_skill_match_count,
                "distance_km": None if distance is None else round(distance, 3),
                "time_of_day": time_of_day,
                "weekday": weekday,
                "estimated_duration_minutes": est,
                "actual_duration_minutes": actual_minutes,
                "was_completed": was_completed,
                "was_no_show": was_no_show,
                "created_at": job.created_at.isoformat() if getattr(job, "created_at", None) else None,
                "updated_at": job.updated_at.isoformat() if getattr(job, "updated_at", None) else None,
            }

            writer.writerow(row)

    print(f"Wrote features to {output_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build features CSV using Django ORM")
    parser.add_argument("--output", default="data/features.csv", help="Output CSV path")
    args = parser.parse_args()
    worker(args.output)