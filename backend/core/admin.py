# backend/core/admin.py
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import (
    SyncLog,
    SLAAction,
    Profile,
    Skill,
    Technician,
    Job,
    Assignment,
)

User = get_user_model()


class ProfileInline(admin.StackedInline):
    model = Profile
    can_delete = False
    verbose_name_plural = "profile"
    fk_name = "user"
    readonly_fields = ("created_at",)


class CustomUserAdmin(BaseUserAdmin):
    inlines = (ProfileInline,)
    list_display = ("username", "email", "first_name", "last_name", "is_staff", "get_role")
    list_select_related = ("profile",)

    def get_role(self, obj):
        try:
            return obj.profile.role
        except Exception:
            return None

    get_role.short_description = "Role"


# Unregister and re-register the User admin safely
try:
    admin.site.unregister(User)
except admin.sites.NotRegistered:
    pass

admin.site.register(User, CustomUserAdmin)


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "role", "created_at")
    search_fields = ("user__username", "user__email", "role")


@admin.register(Skill)
class SkillAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "created_at")
    search_fields = ("name", "code")


@admin.register(Technician)
class TechnicianAdmin(admin.ModelAdmin):
    list_display = ("user", "status", "created_at")
    search_fields = ("user__username", "user__email")


@admin.register(Job)
class JobAdmin(admin.ModelAdmin):
    list_display = ("id", "customer_name", "status", "assigned_technician", "created_at")
    search_fields = ("customer_name", "address")
    list_filter = ("status",)
    filter_horizontal = ("required_skills",)


@admin.register(Assignment)
class AssignmentAdmin(admin.ModelAdmin):
    list_display = ("id", "job", "technician", "created_by", "created_at")
    search_fields = ("job__customer_name", "technician__user__username", "created_by__username")
    readonly_fields = ("created_at",)
    list_filter = ("created_at",)
    fieldsets = (
        (None, {"fields": ("job", "technician", "created_by", "created_at")}),
        ("Rationale", {"fields": ("reason", "score_breakdown")}),
    )


@admin.register(SyncLog)
class SyncLogAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "device_id", "event", "server_ts")
    search_fields = ("user__username", "device_id", "event")
    readonly_fields = ("server_ts",)
    list_filter = ("event", "server_ts")
    fieldsets = (
        (None, {"fields": ("user", "device_id", "event", "client_ts", "server_ts")}),
        ("Payload", {"classes": ("collapse",), "fields": ("payload",)}),
    )


@admin.register(SLAAction)
class SLAActionAdmin(admin.ModelAdmin):
    # Fields exist on the SLAAction model you provided
    list_display = (
        "id",
        "job",
        "recommended_action",
        "suggested_technician",
        "risk_level",
        "risk_score",
        "status",
        "created_by",
        "created_at",
    )
    search_fields = ("job__customer_name", "reason", "created_by__username")
    list_filter = ("status", "risk_level", "recommended_action", "created_at")
    readonly_fields = ("created_at", "applied_at")
    fieldsets = (
        (None, {"fields": ("job", "recommended_action", "suggested_technician", "reason", "meta")}),
        ("Status", {"fields": ("status", "risk_level", "risk_score", "created_by", "applied_at")}),
    )
