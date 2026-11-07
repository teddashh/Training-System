from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from rest_framework.routers import DefaultRouter
from training import auth_views as auth
from training import operations, reporting, scorm, views

router = DefaultRouter()
router.register("users", views.Users)
router.register("courses", views.Courses, basename="courses")
router.register("exams", views.Exams, basename="exams")
router.register("invitations", views.Invitations, basename="invitations")
router.register("question-bank", operations.QuestionBank, basename="question-bank")
router.register("assignments", operations.Assignments, basename="assignments")
urlpatterns = [
    path("health/", lambda request: JsonResponse({"status": "ok"})),
    path("admin/", admin.site.urls),
    path("api/auth/session/", auth.session),
    path("api/auth/login/", auth.password_login),
    path("api/auth/logout/", auth.sign_out),
    path("api/auth/password/", operations.change_password),
    path("api/users/import/", operations.import_people),
    path("api/auth/email/request/", auth.email_request),
    path("api/auth/email/verify/", auth.email_verify),
    path("api/auth/entra/", auth.entra_start),
    path("api/auth/entra/callback/", auth.entra_callback),
    path("api/guest/exchange/", views.guest_exchange),
    path("api/guest/exam/", views.guest_exam),
    path("api/guest/email/request/", views.guest_email_request),
    path("api/guest/email/verify/", views.guest_email_verify),
    path("api/attempts/<uuid:pk>/", views.attempt_detail),
    path("api/results/", reporting.results),
    path("api/results/<uuid:pk>/review/", views.review),
    path("api/results/export/", reporting.export_results),
    path("api/dashboard/", views.dashboard),
    path("api/exams/<int:pk>/insights/", reporting.exam_insights),
    path("api/audit/", views.audit_log),
    path("api/readiness/", operations.readiness),
    path("api/courses/<int:course_id>/upload/", scorm.upload_package),
    path("api/courses/<int:course_id>/source/", scorm.download_source),
    path("api/scorm/<uuid:package_id>/launch/", scorm.launch),
    path("api/scorm/<uuid:package_id>/commit/", scorm.commit),
    path("api/", include(router.urls)),
]
