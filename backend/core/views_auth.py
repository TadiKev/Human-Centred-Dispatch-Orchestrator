# backend/core/views_auth.py
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status
from .serializers_auth import RegisterSerializer

@api_view(["POST"])
@permission_classes([AllowAny])
def register_view(request):
    """
    Simple public register endpoint for demo:
    - allows role selection only between TECHNICIAN and CUSTOMER.
    - Admin/Dispatcher must be created in admin or via shell.
    """
    serializer = RegisterSerializer(data=request.data)
    if serializer.is_valid():
        user = serializer.save()
        return Response({"id": user.id, "username": user.username}, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
