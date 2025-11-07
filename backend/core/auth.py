from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.views import TokenObtainPairView

class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        data = super().validate(attrs)
        user = self.user
        # include extra user fields (role)
        data["user"] = {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "role": getattr(user.profile, "role", None)
        }
        return data

class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer

# backend/core/auth.py
"""
Compatibility shim: re-export the real permission & JWT classes so older imports
like `from core.auth import RolePermission` continue to work.

This file does NOT change your real implementations in:
 - backend/core/permissions.py
 - backend/core/auth_serializers.py

It simply imports and re-exports them. If the real modules can't be imported
(for example during early import-order issues), minimal safe fallbacks are provided
so Django startup does not crash.
"""

# Try to import the canonical implementations first (preferred).
try:
    from .permissions import RolePermission, IsTechnician, IsDispatcher  # type: ignore
except Exception:
    # Minimal safe fallback implementations (will be used only if import fails).
    from rest_framework import permissions

    class RolePermission(permissions.BasePermission):
        def has_permission(self, request, view):
            user = getattr(request, "user", None)
            if not user or not getattr(user, "is_authenticated", False):
                return False
            allowed = getattr(view, "allowed_roles", None)
            if allowed is None:
                return True
            role = getattr(getattr(user, "profile", None), "role", None)
            return role in allowed

        def has_object_permission(self, request, view, obj):
            return self.has_permission(request, view)

    class IsTechnician(RolePermission):
        pass

    class IsDispatcher(RolePermission):
        pass

# Try to re-export JWT token view/serializer if available.
try:
    from .auth_serializers import CustomTokenObtainPairView, CustomTokenObtainPairSerializer  # type: ignore
except Exception:
    CustomTokenObtainPairView = None
    CustomTokenObtainPairSerializer = None

# Public API
__all__ = [
    "RolePermission",
    "IsTechnician",
    "IsDispatcher",
    "CustomTokenObtainPairView",
    "CustomTokenObtainPairSerializer",
]
