# backend/core/auth_serializers.py
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.views import TokenObtainPairView

class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    Extend the token response to include a small `user` object (id, username, email, role)
    """
    def validate(self, attrs):
        data = super().validate(attrs)
        user = self.user
        data["user"] = {
            "id": user.id,
            "username": user.username,
            "email": getattr(user, "email", None),
            "role": getattr(getattr(user, "profile", None), "role", None),
        }
        return data

class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer
