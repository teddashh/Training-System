from django.urls import path
from training.scorm import content_launch, content_file

urlpatterns = [
    path("launch", content_launch),
    path("packages/<uuid:package_id>/<path:path>", content_file),
]
