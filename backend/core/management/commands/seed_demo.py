# backend/core/management/commands/seed_demo.py
import random
from datetime import timedelta
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from django.utils import timezone
from django.db import transaction

from core.models import Skill, Technician, Job, Assignment, Profile

User = get_user_model()


class Command(BaseCommand):
    help = "Seed demo data: skills, users, technicians, jobs and assignments."

    def add_arguments(self, parser):
        parser.add_argument("--jobs", type=int, default=50, help="Number of jobs to create")
        parser.add_argument("--techs", type=int, default=5, help="Number of demo technicians to create")
        parser.add_argument("--assign-prob", type=float, default=0.6, help="Probability a job is assigned to a technician (0..1)")

    def handle(self, *args, **options):
        jobs_count = options["jobs"]
        tech_count = options["techs"]
        assign_prob = float(options["assign_prob"])

        self.stdout.write(self.style.MIGRATE_HEADING("Starting demo seed..."))
        with transaction.atomic():
            # 1) Skills
            skill_defs = [
                ("fiber_repair", "Fiber repair"),
                ("soldering", "Soldering"),
                ("electrical", "Electrical"),
                ("network", "Network"),
                ("mechanical", "Mechanical")
            ]
            skills = []
            for code, name in skill_defs:
                s, _ = Skill.objects.get_or_create(code=code, defaults={"name": name})
                skills.append(s)
            self.stdout.write(self.style.SUCCESS(f"Skills present: {len(skills)}"))

            # 2) Create admin & dispatcher
            created_users = []
            def ensure_user(username, password="pass1234", email=None, role="customer"):
                user, created = User.objects.get_or_create(username=username, defaults={"email": email or f"{username}@example.com"})
                if created:
                    user.set_password(password)
                    user.save()
                # Ensure profile role
                profile = getattr(user, "profile", None)
                if profile:
                    if profile.role != role:
                        profile.role = role
                        profile.save()
                else:
                    Profile.objects.get_or_create(user=user, defaults={"role": role})
                return user

            admin = ensure_user("admin", "adminpass", role="admin")
            dispatcher = ensure_user("dispatcher", "dispatcher", role="dispatcher")
            created_users.extend([admin, dispatcher])

            # 3) Create technicians users + Technician records
            tech_users = []
            for i in range(1, tech_count + 1):
                uname = f"tech{i}"
                pw = f"tech{i}pass"
                u = ensure_user(uname, pw, role="technician")
                tech_users.append(u)

                # Create Technician model (if not exists) and attach some skills and a last-known location
                tech_obj, created = Technician.objects.get_or_create(user=u, defaults={
                    "status": "available",
                    "last_lat": -17.825,  # base Harare approx; randomize below
                    "last_lon": 31.033,
                })
                # assign 1-3 random skills
                sample = random.sample(skills, k=random.randint(1, min(3, len(skills))))
                tech_obj.skills.set(sample)
                # small random offset for location
                tech_obj.last_lat = tech_obj.last_lat + random.uniform(-0.02, 0.02)
                tech_obj.last_lon = tech_obj.last_lon + random.uniform(-0.02, 0.02)
                tech_obj.save()

            self.stdout.write(self.style.SUCCESS(f"Technicians ensured: {len(tech_users)}"))

            # 4) Create some customers
            customer_names = [
                "Alice Corp", "Bob Enterprises", "Charlie Ltd", "Daisy Homes", "Echo Logistics",
                "Foxtrot Solutions", "Gamma Telecom", "Harare Housing", "Ivy Services", "Jade Electronics"
            ]
            customer_users = []
            for idx, cname in enumerate(customer_names[:5], start=1):
                uname = f"customer{idx}"
                u = ensure_user(uname, "custpass", role="customer")
                customer_users.append((u, cname))

            # 5) Create jobs
            now = timezone.now()
            jobs_created = []
            for i in range(jobs_count):
                cust = random.choice(customer_users)[1]  # customer company name
                # pick 0..2 required skills
                k = random.randint(0, 2)
                req_skills = random.sample(skills, k=k) if k > 0 else []
                start = now + timedelta(hours=random.randint(0, 72))
                end = start + timedelta(hours=random.randint(1, 3))
                duration = random.choice([30, 45, 60, 90, 120])

                job = Job.objects.create(
                    customer_name=cust,
                    address=f"{random.randint(1,999)} Demo St, DemoTown",
                    lat=-17.825 + random.uniform(-0.05, 0.05),
                    lon=31.033 + random.uniform(-0.05, 0.05),
                    requested_window_start=start,
                    requested_window_end=end,
                    status=Job.STATUS_NEW,
                    estimated_duration_minutes=duration,
                )
                if req_skills:
                    job.required_skills.set(req_skills)

                jobs_created.append(job)

                # optionally assign to a technician
                if tech_users and random.random() < assign_prob:
                    tech_user = random.choice(tech_users)
                    # get Technician record
                    try:
                        tech_obj = tech_user.technician
                    except Technician.DoesNotExist:
                        continue
                    Assignment.objects.create(job=job, technician=tech_obj, score_breakdown={"skill_match": round(random.random(), 2)})
                    job.assigned_technician = tech_obj
                    job.status = Job.STATUS_ASSIGNED
                    job.save()

            self.stdout.write(self.style.SUCCESS(f"Jobs created: {len(jobs_created)}"))

            # Summary counts
            total_skills = Skill.objects.count()
            total_techs = Technician.objects.count()
            total_jobs = Job.objects.count()
            total_assigns = Assignment.objects.count()

            self.stdout.write(self.style.SQL_FIELD("Seed complete -- summary:"))
            self.stdout.write(self.style.SUCCESS(f"  skills:      {total_skills}"))
            self.stdout.write(self.style.SUCCESS(f"  technicians: {total_techs}"))
            self.stdout.write(self.style.SUCCESS(f"  jobs:        {total_jobs}"))
            self.stdout.write(self.style.SUCCESS(f"  assignments: {total_assigns}"))

        self.stdout.write(self.style.MIGRATE_LABEL("Done."))
