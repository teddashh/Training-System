from django.contrib import admin
from django.http import JsonResponse
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from training import auth_views as auth, views, scorm

router = DefaultRouter()
router.register("users", views.Users)
router.register("courses", views.Courses, basename="courses")
router.register("exams", views.Exams, basename="exams")
router.register("invitations", views.Invitations, basename="invitations")
urlpatterns = [
    path("health/", lambda request: JsonResponse({"status": "ok"})),
    path("admin/", admin.site.urls),
    path("api/auth/session/", auth.session),
    path("api/auth/login/", auth.password_login),
    path("api/auth/logout/", auth.sign_out),
    path("api/auth/email/request/", auth.email_request),
    path("api/auth/email/verify/", auth.email_verify),
    path("api/auth/entra/", auth.entra_start),
    path("api/auth/entra/callback/", auth.entra_callback),
    path("api/guest/exchange/", views.guest_exchange),
    path("api/guest/exam/", views.guest_exam),
    path("api/attempts/<uuid:pk>/", views.attempt_detail),
    path("api/results/", views.results),
    path("api/results/<uuid:pk>/review/", views.review),
    path("api/results/export/", views.export_results),
    path("api/dashboard/", views.dashboard),
    path("api/audit/", views.audit_log),
    path("api/courses/<int:course_id>/upload/", scorm.upload_package),
    path("api/courses/<int:course_id>/source/", scorm.download_source),
    path("api/scorm/<uuid:package_id>/launch/", scorm.launch),
    path("api/scorm/<uuid:package_id>/commit/", scorm.commit),
    path("api/", include(router.urls)),
]
