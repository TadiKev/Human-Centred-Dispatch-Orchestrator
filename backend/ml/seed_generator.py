#!/usr/bin/env python3
"""
Robust Synthetic data generator for ML experiments.

Usage (inside container / bash):
  export PYTHONPATH=/app
  export DJANGO_SETTINGS_MODULE=backend.settings
  python backend/ml/seed_generator.py --tech 10 --jobs 200 --assign_rate 0.7

PowerShell (host) -> exec into container and run above, or in PowerShell before running without container:
  $env:PYTHONPATH = "C:\path\to\repo"
  $env:DJANGO_SETTINGS_MODULE = "backend.settings"
  python backend\ml\seed_generator.py --tech 10 --jobs 200 --assign_rate 0.7

This script is defensive: it will reuse existing users and technicians, avoid duplicate Profiles,
and skip problematic inserts while reporting them.
"""

import os
import argparse
import random
import sys
from datetime import timedelta

# Django bootstrap
import django
from django.db import transaction, IntegrityError

if not os.environ.get("DJANGO_SETTINGS_MODULE"):
    print("WARNING: DJANGO_SETTINGS_MODULE not set. Defaulting to 'backend.settings' (you may override).")
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")

try:
    django.setup()
except Exception as e:
    print("Django setup failed:", e)
    raise

from django.utils import timezone
from django.contrib.auth import get_user_model
from core.models import Skill, Technician, Job, Assignment, Profile  # Profile presence helps defensive checks

User = get_user_model()

# third-party
try:
    from faker import Faker
except Exception:
    print("Faker not installed. Install it with `pip install Faker` inside your environment.")
    raise
fake = Faker()


def safe_create_user(username, email=None, allow_retry=True):
    """
    Return a User instance by reusing existing or creating safely.
    On IntegrityError, will try to fetch existing user by username; if still fails and allow_retry True,
    create with a randomized suffix to avoid unique collisions.
    """
    user = User.objects.filter(username=username).first()
    if user:
        return user

    email = email or f"{username}@example.com"
    try:
        with transaction.atomic():
            # prefer create_user when available to set password handling correctly
            try:
                user = User.objects.create_user(username=username, email=email)
            except TypeError:
                # some projects override create_user signature; fallback to create + set_unusable_password
                user = User.objects.create(username=username, email=email)
                user.set_unusable_password()
                user.save(update_fields=["password"])
            return user
    except IntegrityError as e:
        # possible race or inconsistent DB; attempt to fetch existing
        user = User.objects.filter(username=username).first()
        if user:
            return user
        if not allow_retry:
            raise
        # try with a safe randomized username to ensure progress
        alt_username = f"{username}_{random.randint(1000,9999)}"
        print(f"[seed_generator] IntegrityError creating user '{username}': {e}. Retrying as '{alt_username}'")
        try:
            with transaction.atomic():
                user = User.objects.create_user(username=alt_username, email=email)
                return user
        except IntegrityError:
            # last-resort: fetch any user that has this email (if email unique in your project)
            user = User.objects.filter(email=email).first()
            if user:
                return user
            # re-raise if still impossible
            raise


def ensure_profile_for_user(user):
    """
    Ensure a Profile row exists for the user. Use get_or_create safely.
    """
    if user is None:
        return None
    # If your project auto-creates profiles via signals, this is harmless and just returns existing.
    try:
        profile, _ = Profile.objects.get_or_create(user=user)
        return profile
    except IntegrityError:
        # Something odd in DB; try to fetch and return
        existing = Profile.objects.filter(user_id=user.id).first()
        if existing:
            return existing
        raise


def create_skills(names=None):
    default = ["fiber_repair", "soldering", "electrical", "network", "mechanical"]
    names = names or default
    skills = []
    for n in names:
        s, _ = Skill.objects.get_or_create(code=n, defaults={"name": n})
        skills.append(s)
    return skills


def create_technicians(n=10, skills_pool=None):
    techs = []
    for i in range(n):
        username = f"seed_tech_{i+1}"
        email = f"{username}@example.com"

        # create or reuse user safely
        try:
            user = safe_create_user(username, email)
        except Exception as e:
            print(f"[seed_generator] Failed to create or fetch user '{username}': {e}. Skipping this technician.")
            continue

        # ensure profile exists (defensive)
        try:
            ensure_profile_for_user(user)
        except Exception as e:
            print(f"[seed_generator] Warning: failed to ensure Profile for user {user.id}: {e}")

        # create/reuse technician record
        tech = Technician.objects.filter(user=user).first()
        if not tech:
            try:
                with transaction.atomic():
                    tech = Technician.objects.create(user=user, status="available")
            except IntegrityError as e:
                # Try to recover: fetch again, else skip
                tech = Technician.objects.filter(user=user).first()
                if not tech:
                    print(f"[seed_generator] IntegrityError creating Technician for user {user.id}: {e}. Skipping.")
                    continue

        # set skills if provided
        try:
            if skills_pool:
                # sample between 1 and min(3, len(skills_pool))
                count = random.randint(1, min(3, len(skills_pool)))
                tech.skills.set(random.sample(skills_pool, k=count))
        except Exception as e:
            print(f"[seed_generator] Failed to set skills for tech {tech.id}: {e}")

        # assign coordinates and persist
        try:
            tech.last_lat = -17.82 + random.uniform(-0.02, 0.02)
            tech.last_lon = 31.03 + random.uniform(-0.02, 0.02)
            tech.save()
        except Exception as e:
            print(f"[seed_generator] Failed to save coordinates for tech {getattr(tech, 'id', 'unknown')}: {e}")

        techs.append(tech)
    return techs


def create_jobs(n=100, skills_pool=None):
    jobs = []
    now = timezone.now()
    for i in range(n):
        name = fake.company()
        lat = -17.82 + random.uniform(-0.03, 0.04)
        lon = 31.03 + random.uniform(-0.03, 0.04)
        try:
            j = Job.objects.create(
                customer_name=name[:80],
                address=fake.address()[:200],
                lat=lat,
                lon=lon,
                requested_window_start=now + timedelta(hours=random.randint(-48, 48)),
                requested_window_end=now + timedelta(hours=random.randint(1, 72)),
                estimated_duration_minutes=random.choice([30, 45, 60, 90]),
                status="new",
            )
        except IntegrityError as e:
            print(f"[seed_generator] IntegrityError creating job #{i+1}: {e}. Skipping.")
            continue

        # attach 0-2 required skills
        try:
            if skills_pool and random.random() < 0.8:
                to_attach = random.sample(skills_pool, k=random.randint(0, min(2, len(skills_pool))))
                j.required_skills.set(to_attach)
                j.save()
        except Exception as e:
            print(f"[seed_generator] Failed to attach skills to job {getattr(j, 'id', 'unknown')}: {e}")
        jobs.append(j)
    return jobs


def create_assignments(jobs, techs, assign_rate=0.6):
    created = []
    for j in jobs:
        if random.random() <= assign_rate and techs:
            tech = random.choice(techs)
            # ensure tech.user exists
            user = getattr(tech, "user", None)
            if not user:
                print(f"[seed_generator] Technician {getattr(tech, 'id', 'unknown')} has no user—skipping assignment.")
                continue

            try:
                with transaction.atomic():
                    a = Assignment.objects.create(
                        job=j,
                        technician=tech,
                        created_by=user,
                        score_breakdown={"synthetic": True}
                    )
                    # update job as assigned
                    j.assigned_technician = tech
                    j.status = "assigned"
                    j.save(update_fields=["assigned_technician", "status"])
                    created.append(a)
            except IntegrityError as e:
                print(f"[seed_generator] IntegrityError creating assignment for job {j.id}: {e}. Skipping.")
            except Exception as e:
                print(f"[seed_generator] Failed to create assignment for job {j.id}: {e}. Skipping.")
    return created


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tech", type=int, default=10, help="Number of technicians to create")
    parser.add_argument("--jobs", type=int, default=100, help="Number of jobs to create")
    parser.add_argument("--assign_rate", type=float, default=0.6, help="Probability to assign a job")
    args = parser.parse_args()

    print("[seed_generator] Starting seeding. This is defensive: will reuse existing users/techs where possible.")
    skills = create_skills()
    print(f"[seed_generator] Ensured {len(skills)} skills.")

    techs = create_technicians(n=args.tech, skills_pool=skills)
    print(f"[seed_generator] Created/reused {len(techs)} technicians.")

    jobs = create_jobs(n=args.jobs, skills_pool=skills)
    print(f"[seed_generator] Created {len(jobs)} jobs.")

    assignments = create_assignments(jobs, techs, assign_rate=args.assign_rate)
    print(f"[seed_generator] Created {len(assignments)} assignments.")

    print("[seed_generator] Done.")


if __name__ == "__main__":
    main()
