# backend/core/serializers_auth.py
from rest_framework import serializers
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password

User = get_user_model()

class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    email = serializers.EmailField(required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, min_length=6)
    role = serializers.ChoiceField(
        choices=[("TECHNICIAN","TECHNICIAN"), ("CUSTOMER","CUSTOMER")],
        default="TECHNICIAN"
    )

    def validate_username(self, v):
        if User.objects.filter(username=v).exists():
            raise serializers.ValidationError("Username already exists")
        return v

    def validate_password(self, v):
        # run Django password validators (strong password recommended)
        validate_password(v)
        return v

    def create(self, validated_data):
        role = validated_data.pop("role", "TECHNICIAN")
        user = User.objects.create_user(
            username=validated_data["username"],
            email=validated_data.get("email") or "",
            password=validated_data["password"],
        )
        # Profile signal should auto-create profile; update role if profile exists
        user.refresh_from_db()
        profile = getattr(user, "profile", None)
        if profile:
            profile.role = role
            profile.save()
        return user
