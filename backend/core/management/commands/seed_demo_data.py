# backend/core/management/commands/seed_demo_data.py
import random
import sys
from datetime import timedelta, datetime

from django.core.management.base import BaseCommand
from django.utils import timezone
from django.db import transaction

from django.contrib.auth import get_user_model

from core.models import Profile, Technician, Skill, Job, Assignment, SLAAction, SyncLog

User = get_user_model()


class Command(BaseCommand):
    help = "Seed demo data (Zimbabwe context) for HOF-SMART: users, technicians, skills, jobs, assignments, sla actions."

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Clear demo users previously created by this command (based on username prefix) before seeding.",
        )
        parser.add_argument(
            "--num-techs",
            type=int,
            default=6,
            help="Number of technician users to create.",
        )
        parser.add_argument(
            "--num-jobs",
            type=int,
            default=100,
            help="Number of job records to create.",
        )
        parser.add_argument(
            "--seed",
            type=int,
            default=None,
            help="Random seed for reproducible demo data.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        force = options["force"]
        num_techs = max(0, options["num_techs"])
        num_jobs = max(0, options["num_jobs"])
        seed = options["seed"]

        if seed is not None:
            random.seed(seed)

        self.stdout.write(self.style.MIGRATE_HEADING("Seeding demo data for HOF-SMART"))
        self.stdout.write(f"Settings: num_techs={num_techs}, num_jobs={num_jobs}, force={force}, seed={seed}")

        # Config: username prefixes to use for demo-created users
        demo_prefix = "demo_"
        demo_tech_prefix = demo_prefix + "tech"
        demo_disp_username = demo_prefix + "dispatcher"

        # If force: remove demo users (and cascades) first
        if force:
            self.stdout.write(self.style.WARNING("Force mode: removing existing demo users and related objects..."))
            users_to_remove = User.objects.filter(username__startswith(demo_prefix))
            cnt = users_to_remove.count()
            if cnt:
                users_to_remove.delete()
                self.stdout.write(self.style.SUCCESS(f"Removed {cnt} demo users (and cascaded related rows)."))
            else:
                self.stdout.write("No demo users found to remove.")

        # 1) create skills if not exist
        skill_defs = [
            ("plumbing", "Plumbing"),
            ("electrical", "Electrical"),
            ("hvac", "HVAC"),
            ("network", "IT / Network"),
            ("carpentry", "Carpentry"),
            ("gas", "Gas technician"),
        ]
        skills = []
        for code, name in skill_defs:
            s, _ = Skill.objects.get_or_create(code=code, defaults={"name": name})
            skills.append(s)
        self.stdout.write(self.style.SUCCESS(f"Ensured {len(skills)} skills present."))

        # 2) create dispatcher user (one)
        dispatcher, created = User.objects.get_or_create(
            username=demo_disp_username,
            defaults={"email": "dispatcher@example.local", "first_name": "Demo", "last_name": "Dispatcher"},
        )
        if created:
            dispatcher.set_password("password")
            dispatcher.is_staff = True
            dispatcher.is_superuser = False
            dispatcher.save()
            Profile.objects.get_or_create(user=dispatcher)
            dispatcher.profile.role = Profile.Roles.DISPATCHER
            dispatcher.profile.save()
            self.stdout.write(self.style.SUCCESS("Created demo dispatcher user (username: demo_dispatcher / password: password)"))
        else:
            self.stdout.write("Dispatcher user already exists, skipped creating.")

        # 3) create technician users
        tech_users = []
        for i in range(1, num_techs + 1):
            username = f"{demo_tech_prefix}{i}"
            user, created = User.objects.get_or_create(
                username=username,
                defaults={"email": f"{username}@example.local", "first_name": "Tech", "last_name": str(i)},
            )
            if created:
                user.set_password("password")
                user.save()
                Profile.objects.get_or_create(user=user)
                # mark role
                try:
                    user.profile.role = Profile.Roles.TECHNICIAN
                    user.profile.save()
                except Exception:
                    # defensive: profile may be created by signal; ensure get_or_create
                    p, _ = Profile.objects.get_or_create(user=user)
                    p.role = Profile.Roles.TECHNICIAN
                    p.save()

            # create Technician record if missing
            tech, tcreated = Technician.objects.get_or_create(
                user=user,
                defaults={
                    "status": random.choice(["available", "available", "busy"]),
                    "last_lat": None,
                    "last_lon": None,
                },
            )
            # give each tech 1-3 random skills
            assigned = random.sample(skills, k=random.randint(1, min(3, len(skills))))
            tech.skills.clear()
            for s in assigned:
                tech.skills.add(s)
            tech.save()
            tech_users.append(tech)

        self.stdout.write(self.style.SUCCESS(f"Ensured {len(tech_users)} technician accounts exist."))

        # 4) Prepare Zimbabwe localities and approximate coordinates (centers)
        # These are approximate centers; we'll jitter coords slightly for realism.
        cities = {
            "Harare - Borrowdale": (-17.798, 31.057),   # Borrowdale/Borrowdale area
            "Harare - Mbare": (-17.833, 31.044),
            "Ruwa": (-17.778, 31.115),
            "Chisipite": (-17.794, 31.090),
            "Sunway City": (-17.836, 31.033),
            "Zimre Park": (-17.811, 31.028),
            "Bulawayo - CBD": (-20.150, 28.583),
            "Gweru": (-19.450, 29.816),
            "Mutare": (-18.970, 32.670),
            "Masvingo": (-20.074, 30.828),
        }
        city_names = list(cities.keys())

        # small helper to jitter lat/lon near center (within ~0.01 degrees ~1km-1.5km)
        def jitter_coord(lat, lon, radius_deg=0.02):
            return (lat + random.uniform(-radius_deg, radius_deg), lon + random.uniform(-radius_deg, radius_deg))

        # 5) create jobs
        created_jobs = []
        now = timezone.now()
        for j in range(num_jobs):
            city = random.choice(city_names)
            lat0, lon0 = cities[city]
            lat, lon = jitter_coord(lat0, lon0, radius_deg=0.02)
            customer_name = random.choice(["OK Zimbabwe", "Acme Holdings", "ProServe", "Zim Water", "Ruwa Clinic", "GreenFarm", "Eastgate Mall"])
            address = f"{random.randint(1, 200)} {random.choice(['Borrowdale Road','Samora Machel Ave','Main Rd','Market St','Masvingo Rd','Harare Drive'])}, {city.split(' - ')[0]}"
            status = random.choices(
                population=[Job.STATUS_NEW, Job.STATUS_ASSIGNED, Job.STATUS_IN_PROGRESS, Job.STATUS_DONE],
                weights=[0.6, 0.2, 0.15, 0.05],
                k=1,
            )[0]
            job = Job.objects.create(
                customer_name=f"{customer_name} #{random.randint(1,999)}",
                address=address,
                lat=round(lat, 6),
                lon=round(lon, 6),
                requested_window_start=(now + timedelta(hours=random.randint(1, 72))) if random.random() < 0.5 else None,
                requested_window_end=None,
                status=status,
                estimated_duration_minutes=random.choice([30, 45, 60, 90, None]),
                notes="Demo job seeded for HOF-SMART.",
            )
            # set some required skills randomly
            if random.random() < 0.6:
                req_count = random.randint(0, 2)
                if req_count:
                    job.required_skills.add(*random.sample(skills, k=req_count))
            job.save()
            created_jobs.append(job)

        self.stdout.write(self.style.SUCCESS(f"Created {len(created_jobs)} demo jobs."))

        # 6) create assignments for some assigned jobs and SLA actions
        assigned_jobs = [j for j in created_jobs if j.status in (Job.STATUS_ASSIGNED, Job.STATUS_IN_PROGRESS)]
        for job in assigned_jobs:
            # pick a random tech to assign
            tech = random.choice(tech_users)
            job.assigned_technician = tech
            job.status = Job.STATUS_ASSIGNED
            job.save(update_fields=["assigned_technician", "status"])

            # create assignment audit row
            Assignment.objects.create(
                job=job,
                technician=tech,
                score_breakdown={"demo": True, "score": random.uniform(0, 10)},
                reason="Demo seeded assignment",
                created_by=dispatcher,
            )

        self.stdout.write(self.style.SUCCESS(f"Assigned {len(assigned_jobs)} jobs to technicians (audit entries created)."))

        # 7) create some SLAAction rows (mix of levels)
        sla_created = 0
        for job in random.sample(created_jobs, k=min( int(max(1, len(created_jobs)*0.15)), len(created_jobs) )):
            score = round(random.random(), 3)
            if score >= 0.75:
                action = "reassign"
                level = "high"
            elif score >= 0.40:
                action = "notify"
                level = "medium"
            else:
                action = "notify"
                level = "low"

            suggested_tech = random.choice(tech_users) if random.random() < 0.6 else None

            sa = SLAAction.objects.create(
                job=job,
                recommended_action=action,
                reason=f"Auto-detected risk (demo) score {score}",
                suggested_technician=suggested_tech,
                risk_score=score,
                risk_level=level,
                status="pending",
                meta={"demo_seed": True},
                created_by=dispatcher,
            )
            sla_created += 1

        self.stdout.write(self.style.SUCCESS(f"Created {sla_created} SLAAction demo rows."))

        # 8) set some last locations for technicians (so frontends show human-readable areas)
        for tech in tech_users:
            # randomly pick a city and jitter lat/lon near it
            city = random.choice(city_names)
            lat0, lon0 = cities[city]
            lat, lon = jitter_coord(lat0, lon0, radius_deg=0.015)
            tech.last_lat = round(lat, 6)
            tech.last_lon = round(lon, 6)
            tech.status = random.choice(["available", "busy"])
            tech.save()

        self.stdout.write(self.style.SUCCESS("Populated technician last_lat/last_lon and statuses."))

        # 9) create a few SyncLogs for demo/audit
        sync_count = 0
        for _ in range(min(10, len(created_jobs))):
            SyncLog.objects.create(
                device_id=f"device-{random.randint(1,999)}",
                user=random.choice([dispatcher] + [t.user for t in tech_users]),
                event=random.choice(["complete_job", "sync", "heartbeat"]),
                payload={"demo": True},
                client_ts=timezone.now() - timedelta(minutes=random.randint(10, 1000)),
            )
            sync_count += 1

        self.stdout.write(self.style.SUCCESS(f"Created {sync_count} SyncLog demo rows."))

        # final summary
        self.stdout.write(self.style.SUCCESS("Demo seeding complete. Summary:"))
        self.stdout.write(f" - tech users created/ensured: {len(tech_users)}")
        self.stdout.write(f" - jobs created: {len(created_jobs)}")
        self.stdout.write(f" - assignments (for assigned jobs): {len(assigned_jobs)}")
        self.stdout.write(f" - sla actions created: {sla_created}")
        self.stdout.write(f" - demo dispatcher: {dispatcher.username} (password: password)")

        self.stdout.write(self.style.NOTICE("You can re-run this command. Use --force to remove previous demo users (prefixed with 'demo_')."))

