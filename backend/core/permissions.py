from rest_framework import permissions

class RolePermission(permissions.BasePermission):
    """
    Views may define `allowed_roles = ['TECHNICIAN', 'DISPATCHER', ...]`.
    If allowed_roles is None, permission is allowed (change if you prefer deny-by-default).
    """
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        allowed = getattr(view, "allowed_roles", None)
        if allowed is None:
            return True
        role = getattr(getattr(request.user, "profile", None), "role", None)
        return role in allowed

class IsTechnician(RolePermission):
    pass

class IsDispatcher(RolePermission):
    pass
