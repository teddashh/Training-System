from training.documents import convert_document
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from rest_framework.routers import DefaultRouter
from training import auth_views as auth
from training import (
    administration,
    figures,
    email_views,
    invitations,
    marks_import,
    monitoring,
    operations,
    previews,
    reporting,
    reopening,
    scorm,
    views,
)

from training import groups, materials, registration, simple_training

router = DefaultRouter()
router.register("groups", groups.TrainingGroups, basename="groups")
router.register("users", views.Users)
router.register("courses", views.Courses, basename="courses")
router.register("exams", views.Exams, basename="exams")
router.register("invitations", invitations.Invitations, basename="invitations")
router.register("question-bank", operations.QuestionBank, basename="question-bank")
router.register("assignments", operations.Assignments, basename="assignments")
from training import directory_views, settings_views, google_auth

urlpatterns = [
    path('api/settings/', settings_views.settings_detail),
    path('api/settings/logo/', settings_views.settings_logo),
    path('api/settings/<str:section>/', settings_views.settings_update),
    path('api/organization/logo/<str:digest>/', settings_views.organization_logo),
    path('api/auth/google/start/', google_auth.start),
    path('api/auth/google/callback/', google_auth.callback),

    path('api/trainings/', simple_training.create_training),
    path('api/trainings/check-people/', simple_training.check_training_people),
    path('api/trainings/people-template/', simple_training.people_template),
    path('api/courses/<int:course_id>/roster/', simple_training.roster_import),
    path('api/courses/<int:course_id>/training/', simple_training.training_overview),
    path('api/registration/lookup/', registration.lookup),
    path('api/courses/<int:course_id>/materials/', materials.materials),
    path('api/courses/<int:course_id>/materials/<int:material_id>/', materials.materials),
    path('api/courses/<int:course_id>/materials/<int:material_id>/download/', materials.download_material),
    path("api/question-figures/", figures.upload_figure),
    path("api/question-figures/<str:key>/", figures.serve_figure),
    path("api/directory/status/", directory_views.status),
    path("api/directory/run/", directory_views.run),
    path("health/", lambda request: JsonResponse({"status": "ok"})),
    path("admin/", administration.administration_entry),
    path("admin/data/", admin.site.urls),
    path("api/administration/", administration.overview),
    path("api/email/", email_views.email_log),
    path("api/email/test/", email_views.test_email),
    path("api/email/<int:pk>/<str:action>/", email_views.email_action),
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
    path("api/attempts/<uuid:pk>/heartbeat/", monitoring.heartbeat),
    path("api/attempts/<uuid:pk>/extensions/", monitoring.time_extensions),
    path("api/attempts/<uuid:pk>/inspection/", reopening.inspect_attempt),
    path("api/attempts/<uuid:pk>/reopenings/", reopening.reopenings),
    path(
        "api/attempts/<uuid:pk>/reopenings/<uuid:record_id>/",
        reopening.previous_submission,
    ),
    path("api/exams/<int:pk>/monitor/", monitoring.exam_monitor),
    path("api/exams/<int:pk>/marks/template/", marks_import.marks_template),
    path("api/exams/<int:pk>/marks/imports/", marks_import.marks_imports),
    path(
        "api/exams/<int:pk>/marks/imports/<uuid:import_id>/",
        marks_import.marks_import_detail,
    ),
    path("api/exams/<int:pk>/previews/", previews.exam_previews),
    path("api/previews/<uuid:pk>/", previews.preview_detail),
    path("api/previews/<uuid:pk>/review/", previews.preview_review),
    path("api/results/", reporting.results),
    path("api/results/<uuid:pk>/review/", views.review),
    path("api/results/export/", reporting.export_results),
    path("api/dashboard/", views.dashboard),
    path("api/exams/<int:pk>/insights/", reporting.exam_insights),
    path("api/audit/", views.audit_log),
    path("api/readiness/", operations.readiness),
    path("api/documents/convert/", convert_document),
    path("api/courses/<int:course_id>/upload/", scorm.upload_package),
    path("api/courses/<int:course_id>/source/", scorm.download_source),
    path("api/scorm/<uuid:package_id>/launch/", scorm.launch),
    path("api/scorm/<uuid:package_id>/commit/", scorm.commit),
    path("api/", include(router.urls)),
]
