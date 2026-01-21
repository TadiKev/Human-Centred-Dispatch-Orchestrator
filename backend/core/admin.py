# backend/core/admin.py
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.db import IntegrityError

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
    max_num = 1

    def has_add_permission(self, request, obj=None):
        """
        When editing an existing user, prevent the admin UI from attempting to add
        a second profile if one already exists. When creating a new user (obj is None)
        allow the inline to be shown (admin still sends empty formset).
        """
        if obj is None:
            return True
        return not hasattr(obj, "profile")


class CustomUserAdmin(BaseUserAdmin):
    inlines = (ProfileInline,)
    list_display = ("username", "email", "first_name", "last_name", "is_staff", "get_role")
    list_select_related = ("profile",)

    def get_role(self, obj):
        return getattr(obj.profile, "role", None)

    get_role.short_description = "Role"

    def save_related(self, request, form, formsets, change):
        """
        Robust save_related which:
        - updates an existing Profile inline without creating a duplicate row
        - still sets the formset attributes Django expects (new_objects, changed_objects, deleted_objects)
          so construct_change_message and admin history work correctly.
        """
        user = form.instance

        for formset in formsets:
            model = getattr(formset, "model", None)

            if model is Profile:
                # If a Profile already exists, apply inline data to it and skip creating a new row.
                try:
                    existing = getattr(user, "profile", None)
                except Exception:
                    existing = None

                if existing:
                    # Copy data from the first non-empty form into the existing profile.
                    # Note: Django has already validated forms at this point.
                    forms_handled = 0
                    try:
                        for f in formset.forms:
                            if getattr(f, "cleaned_data", None) is None:
                                continue
                            if f.cleaned_data.get("DELETE", False):
                                continue
                            # Update existing with cleaned data fields that exist on the model
                            for name, value in f.cleaned_data.items():
                                if name in ("DELETE", "id"):
                                    continue
                                if hasattr(existing, name):
                                    setattr(existing, name, value)
                            forms_handled += 1
                        if forms_handled:
                            existing.save()
                        # Because we didn't call formset.save(), set the attributes Django expects.
                        formset.new_objects = []
                        formset.changed_objects = []
                        formset.deleted_objects = []
                    except Exception:
                        # Fallback: attempt to let the formset save; handle race safely.
                        try:
                            formset.save()
                        except IntegrityError:
                            # Race: profile inserted concurrently — update existing and set attributes
                            try:
                                existing = Profile.objects.get(user=user)
                                for f in formset.forms:
                                    if getattr(f, "cleaned_data", None) is None:
                                        continue
                                    if f.cleaned_data.get("DELETE", False):
                                        continue
                                    for name, value in f.cleaned_data.items():
                                        if name in ("DELETE", "id"):
                                            continue
                                        if hasattr(existing, name):
                                            setattr(existing, name, value)
                                existing.save()
                            except Exception:
                                # ensure attributes exist even on failure
                                formset.new_objects = []
                                formset.changed_objects = []
                                formset.deleted_objects = []
                        except Exception:
                            # ensure attributes exist so admin does not crash building change message
                            formset.new_objects = []
                            formset.changed_objects = []
                            formset.deleted_objects = []
                    continue
                else:
                    # No existing profile — safe to save (this will create profile and set formset attrs)
                    try:
                        formset.save()
                    except IntegrityError:
                        # Defensive: race where another thread/process created Profile between checks.
                        try:
                            existing = Profile.objects.get(user=user)
                            # copy submitted data into existing
                            for f in formset.forms:
                                if getattr(f, "cleaned_data", None) is None:
                                    continue
                                if f.cleaned_data.get("DELETE", False):
                                    continue
                                for name, value in f.cleaned_data.items():
                                    if name in ("DELETE", "id"):
                                        continue
                                    if hasattr(existing, name):
                                        setattr(existing, name, value)
                            existing.save()
                        except Exception:
                            pass
                        # Ensure attrs exist
                        formset.new_objects = []
                        formset.changed_objects = []
                        formset.deleted_objects = []
                    continue
            # Non-profile formsets: let Django save normally (will set required attrs)
            formset.save()


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
    readonly_fields = ("created_at",)


@admin.register(Skill)
class SkillAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "created_at")
    search_fields = ("name", "code")
    readonly_fields = ("created_at",)


@admin.register(Technician)
class TechnicianAdmin(admin.ModelAdmin):
    list_display = ("user", "status", "created_at")
    search_fields = ("user__username", "user__email")
    readonly_fields = ("created_at",)


@admin.register(Job)
class JobAdmin(admin.ModelAdmin):
    list_display = ("id", "customer_name", "status", "assigned_technician", "created_at")
    search_fields = ("customer_name", "address")
    list_filter = ("status",)
    filter_horizontal = ("required_skills",)
    readonly_fields = ("created_at", "updated_at")


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
