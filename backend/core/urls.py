from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView
from . import views
# Views / view classes
from .views_sync import TechJobsAPIView, SyncAPIView, SyncConflictsList, ResolveConflictAPIView
from .views_ml import PredictDurationAPIView, PredictNoShowAPIView
from .views import (
    register_view,
    me_view,
    SkillViewSet,
    TechnicianViewSet,
    JobViewSet,
    AssignmentViewSet,
    JobCandidatesAPIView,
    AutoAssignAPIView,
    SLAOverviewAPIView,
    SLAMitigateAPIView,
)
from .views_analytics import AnalyticsOverviewAPIView
from .views_customers import CustomerRequestsAPIView, CustomerRequestsMeAPIView
from .auth import CustomTokenObtainPairView

router = DefaultRouter()
router.register(r"skills", SkillViewSet, basename="skill")
router.register(r"technicians", TechnicianViewSet, basename="technician")
router.register(r"jobs", JobViewSet, basename="job")
router.register(r"assignments", AssignmentViewSet, basename="assignment")

urlpatterns = [
    # Auth / registration
    path("auth/register/", register_view, name="auth-register"),
    path("auth/login/", CustomTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("auth/refresh/", TokenRefreshView.as_view(), name="token_refresh"),

    # Current user
    path("users/me/", me_view, name="users-me"),

    # Router-managed viewsets
    path("", include(router.urls)),

    # Custom endpoints
    path("tech/<str:tech_id>/jobs/", TechJobsAPIView.as_view(), name="tech-jobs"),
    path("jobs/<int:job_id>/candidates/", JobCandidatesAPIView.as_view(), name="job-candidates"),
    path("auto_assign/", AutoAssignAPIView.as_view(), name="api-auto-assign"),

    # Sync
    path("sync/", SyncAPIView.as_view(), name="api-sync"),
    path("sync/conflicts/", SyncConflictsList.as_view(), name="api-sync-conflicts"),
    path("sync/conflicts/<int:pk>/resolve/", ResolveConflictAPIView.as_view(), name="api-sync-resolve"),

    # Technician itinerary
    path("technicians/<int:pk>/itinerary/", TechnicianViewSet.as_view({"get": "itinerary"}), name="technician-itinerary"),

    # ML helpers (use the class names exactly as defined in core/views_ml.py)
    path("ml/predict/duration/", PredictDurationAPIView.as_view(), name="predict-duration"),
    path("ml/predict/noshow/", PredictNoShowAPIView.as_view(), name="predict-noshow"),

    # SLA
    path("sla/overview/", SLAOverviewAPIView.as_view(), name="sla-overview"),
    path("sla/mitigate/", SLAMitigateAPIView.as_view(), name="sla-mitigate"),

    # Analytics
    path("analytics/overview/", AnalyticsOverviewAPIView.as_view(), name="analytics-overview"),

    # Customer-facing endpoints
    path("customers/me/requests/", CustomerRequestsMeAPIView.as_view(), name="customer-requests-me"),
    path("customers/<str:customer_id>/requests/", CustomerRequestsAPIView.as_view(), name="customer-requests"),

    path('ml/model_info/', views.ml_model_info, name='ml_model_info'),
]

