# backend/core/models.py
from django.conf import settings
from django.db import models
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from django.db.models.signals import post_save
from django.dispatch import receiver

# Use settings.AUTH_USER_MODEL string for DB references (keeps compatibility)
USER_MODEL = settings.AUTH_USER_MODEL

# -------------------------
# Profile (Module 1 compatibility)
# -------------------------
class Profile(models.Model):
    class Roles(models.TextChoices):
        ADMIN = "admin", _("Admin")
        DISPATCHER = "dispatcher", _("Dispatcher")
        TECHNICIAN = "technician", _("Technician")
        CUSTOMER = "customer", _("Customer")

    user = models.OneToOneField(USER_MODEL, on_delete=models.CASCADE, related_name="profile")
    role = models.CharField(max_length=20, choices=Roles.choices, default=Roles.CUSTOMER)
    phone = models.CharField(max_length=32, blank=True, null=True)
    last_seen = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    def __str__(self):
        try:
            username = self.user.username
        except Exception:
            username = str(self.user)
        return f"{username} ({self.role})"


# Signal: ensure Profile exists for each created user
@receiver(post_save, sender=USER_MODEL)
def ensure_profile(sender, instance, created, **kwargs):
    """
    Create a Profile when a User is created. If user already exists but
    has no Profile (defensive), create it.
    """
    if created:
        # Create profile for new user
        Profile.objects.create(user=instance)
    else:
        Profile.objects.get_or_create(user=instance)


# -------------------------
# Skill
# -------------------------
class Skill(models.Model):
    code = models.CharField(max_length=64, unique=True)
    name = models.CharField(max_length=128)
    created_at = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return f"{self.name} ({self.code})"


# -------------------------
# Technician
# -------------------------
class Technician(models.Model):
    """
    Lightweight technician profile separate from Profile to hold
    operational technician fields (location, skills, status).
    OneToOne with User for easy joins.
    """
    user = models.OneToOneField(USER_MODEL, on_delete=models.CASCADE, related_name="technician")
    skills = models.ManyToManyField(Skill, blank=True, related_name="technicians")
    status = models.CharField(max_length=32, default="available")  # available / busy / offshift
    last_lat = models.FloatField(blank=True, null=True)
    last_lon = models.FloatField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)

    def __str__(self):
        try:
            return f"Tech {self.user.username}"
        except Exception:
            return f"Tech {self.pk}"


# -------------------------
# Job
# -------------------------
class Job(models.Model):
    STATUS_NEW = "new"
    STATUS_ASSIGNED = "assigned"
    STATUS_IN_PROGRESS = "in_progress"
    STATUS_DONE = "done"
    STATUS_CANCELLED = "cancelled"

    STATUS_CHOICES = [
        (STATUS_NEW, "New"),
        (STATUS_ASSIGNED, "Assigned"),
        (STATUS_IN_PROGRESS, "In progress"),
        (STATUS_DONE, "Done"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    customer_name = models.CharField(max_length=200)
    address = models.CharField(max_length=512, blank=True)
    lat = models.FloatField(null=True, blank=True)
    lon = models.FloatField(null=True, blank=True)
    requested_window_start = models.DateTimeField(null=True, blank=True)
    requested_window_end = models.DateTimeField(null=True, blank=True)
    required_skills = models.ManyToManyField(Skill, blank=True, related_name="jobs")
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default=STATUS_NEW)
    estimated_duration_minutes = models.IntegerField(null=True, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # optional assigned technician FK (nullable)
    assigned_technician = models.ForeignKey(
        Technician,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assigned_jobs",
    )

    def __str__(self):
        return f"Job {self.pk} - {self.customer_name} ({self.status})"


# -------------------------
# Assignment (audit + score)
# -------------------------
class Assignment(models.Model):
    job = models.ForeignKey(Job, on_delete=models.CASCADE, related_name="assignments")
    technician = models.ForeignKey(Technician, null=True, blank=True,
                                   on_delete=models.SET_NULL, related_name="assignments")
    # JSON field for score breakdown / explainability
    score_breakdown = models.JSONField(null=True, blank=True)
    reason = models.TextField(blank=True)
    created_by = models.ForeignKey(USER_MODEL, null=True, blank=True,
                                   on_delete=models.SET_NULL, related_name="created_assignments")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        tech = self.technician.user.username if self.technician and self.technician.user else "unassigned"
        return f"Assignment job={self.job_id} -> {tech} @ {self.created_at.isoformat()}"

# --- append to backend/core/models.py (near the end of the file) ---


class SyncLog(models.Model):
    """
    Record client-sent sync events for auditing/conflict resolution.
    """
    device_id = models.CharField(max_length=128, null=True, blank=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                             on_delete=models.SET_NULL, related_name="sync_logs")
    event = models.CharField(max_length=64)  # e.g. 'complete_job'
    payload = models.JSONField(null=True, blank=True)
    client_ts = models.DateTimeField(null=True, blank=True)
    server_ts = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        uname = getattr(self.user, "username", str(self.user)) if self.user else "anonymous"
        return f"SyncLog {self.pk} {self.event} by {uname} at {self.server_ts.isoformat()}"
# -----------------------------------------------------------------

class SLAAction(models.Model):
    ACTION_CHOICES = [
        ("reassign", "Reassign"),
        ("notify", "Notify customer"),
        ("escalate", "Escalate"),
    ]
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("applied", "Applied"),
        ("ignored", "Ignored"),
    ]

    job = models.ForeignKey("Job", on_delete=models.CASCADE, related_name="sla_actions")
    recommended_action = models.CharField(max_length=32, choices=ACTION_CHOICES)
    reason = models.TextField(blank=True)  # human-readable reason why flagged
    suggested_technician = models.ForeignKey("Technician", null=True, blank=True, on_delete=models.SET_NULL)
    risk_score = models.FloatField(default=0.0)  # normalized risk 0..1
    risk_level = models.CharField(max_length=16, default="low")  # low|medium|high
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="pending")
    created_at = models.DateTimeField(auto_now_add=True)
    applied_at = models.DateTimeField(null=True, blank=True)
    meta = models.JSONField(default=dict, blank=True)  # store candidate list / diagnostics

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)

    class Meta:
        ordering = ["-created_at"]

    def mark_applied(self):
        from django.utils import timezone
        self.status = "applied"
        self.applied_at = timezone.now()
        self.save(update_fields=["status", "applied_at"])
