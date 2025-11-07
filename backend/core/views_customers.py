from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from django.core.paginator import Paginator
from django.db.models import Q

from .models import Job
from .serializers import JobSerializer, JobCreateSerializer


class CustomerRequestsAPIView(APIView):
    """
    GET /api/customers/<customer_id>/requests/?page=1&page_size=25
    Returns: { requests: [...], pagination: {...} }
    Auth required.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, customer_id=None):
        # Validate input
        if not customer_id:
            return Response({"detail": "customer_id required in URL"}, status=status.HTTP_400_BAD_REQUEST)

        # Safely parse pagination params
        try:
            page = int(request.query_params.get("page", 1))
        except (TypeError, ValueError):
            page = 1
        try:
            page_size = int(request.query_params.get("page_size", 25))
        except (TypeError, ValueError):
            page_size = 25

        # Base queryset
        qs = Job.objects.all().order_by("-created_at")

        # Determine which field to filter on in a robust way
        field_names = {f.name for f in Job._meta.get_fields()}

        if "customer_id" in field_names:
            qs = qs.filter(customer_id=str(customer_id))
        elif "customer" in field_names:
            # If customer is a FK, attempt to match by pk
            qs = qs.filter(customer__pk=customer_id)
        elif "customer_name" in field_names:
            # fallback: match by icontains on customer_name
            qs = qs.filter(customer_name__icontains=str(customer_id))
        else:
            # Nothing to match on — return empty result set
            qs = Job.objects.none()

        paginator = Paginator(qs, page_size)
        page_obj = paginator.get_page(page)

        ser = JobSerializer(page_obj.object_list, many=True, context={"request": request})
        data = {
            "requests": ser.data,
            "pagination": {
                "page": page_obj.number,
                "page_size": page_size,
                "num_pages": paginator.num_pages,
                "total": paginator.count,
            },
        }
        return Response(data)


class CustomerRequestsMeAPIView(APIView):
    """
    GET /api/customers/me/requests/?page=1&page_size=25
    Attempts to find jobs that belong to the current authenticated user using
    simple heuristics.

    POST /api/customers/me/requests/
    Create a new job request from the authenticated customer.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user

        # parse pagination safely
        try:
            page = int(request.query_params.get("page", 1))
        except (TypeError, ValueError):
            page = 1
        try:
            page_size = int(request.query_params.get("page_size", 25))
        except (TypeError, ValueError):
            page_size = 25

        # gather candidate identifiers from user/profile
        username = getattr(user, "username", "") or ""
        email = getattr(user, "email", "") or ""
        full_name = ""
        try:
            fn = getattr(user, "get_full_name", None)
            if callable(fn):
                full_name = user.get_full_name() or ""
        except Exception:
            full_name = ""
        profile = getattr(user, "profile", None)
        profile_phone = None
        profile_company = None
        profile_customer_id = None
        if profile is not None:
            profile_phone = getattr(profile, "phone", None)
            profile_company = getattr(profile, "company", None) if hasattr(profile, "company") else None
            profile_customer_id = getattr(profile, "customer_id", None) if hasattr(profile, "customer_id") else None

        if profile_customer_id:
            # delegate to same behaviour as CustomerRequestsAPIView
            field_names = {f.name for f in Job._meta.get_fields()}
            qs = Job.objects.all().order_by("-created_at")
            if "customer_id" in field_names:
                qs = qs.filter(customer_id=str(profile_customer_id))
            elif "customer" in field_names:
                qs = qs.filter(customer__pk=profile_customer_id)
            elif "customer_name" in field_names:
                qs = qs.filter(customer_name__icontains=str(profile_customer_id))
            else:
                qs = Job.objects.none()

            paginator = Paginator(qs, page_size)
            page_obj = paginator.get_page(page)
            ser = JobSerializer(page_obj.object_list, many=True, context={"request": request})
            return Response({
                "requests": ser.data,
                "pagination": {
                    "page": page_obj.number,
                    "page_size": page_size,
                    "num_pages": paginator.num_pages,
                    "total": paginator.count,
                },
            })

        # Build heuristic Q
        q = Q()
        added_any = False

        if username:
            q |= Q(customer_name__icontains=username)
            added_any = True

        if full_name and full_name.strip():
            q |= Q(customer_name__icontains=full_name)
            added_any = True

        if email:
            q |= Q(notes__icontains=email)
            q |= Q(customer_name__icontains=email)
            added_any = True

        if profile_phone:
            q |= Q(notes__icontains=profile_phone)
            q |= Q(customer_name__icontains=profile_phone)
            added_any = True

        if profile_company:
            q |= Q(address__icontains=profile_company)
            q |= Q(customer_name__icontains=profile_company)
            added_any = True

        if not added_any:
            qs = Job.objects.none()
        else:
            qs = Job.objects.filter(q).order_by("-created_at").distinct()

        paginator = Paginator(qs, page_size)
        page_obj = paginator.get_page(page)

        ser = JobSerializer(page_obj.object_list, many=True, context={"request": request})
        return Response({
            "requests": ser.data,
            "pagination": {
                "page": page_obj.number,
                "page_size": page_size,
                "num_pages": paginator.num_pages,
                "total": paginator.count,
            },
        })

    def post(self, request):
        serializer = JobCreateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response({"detail": "Invalid input", "errors": serializer.errors}, status=status.HTTP_400_BAD_REQUEST)

        # Use serializer.save() so create() or future overrides are respected
        job = serializer.save()

        # append trace to notes if possible (non-breaking)
        try:
            user = request.user
            uname = getattr(user, "username", None)
            if uname:
                if job.notes:
                    job.notes = f"{job.notes}\nCreated by user: {uname}"
                else:
                    job.notes = f"Created by user: {uname}"
                job.save(update_fields=["notes"])
        except Exception:
            pass

        out = JobSerializer(job, context={"request": request})
        return Response(out.data, status=status.HTTP_201_CREATED)
