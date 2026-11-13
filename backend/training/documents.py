"""Import document text locally; source files are removed after extraction."""

from .access import has_courses, manages_course
from .models import Course
from django.shortcuts import get_object_or_404

import json
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from .i18n import translate


@api_view(["POST"])
def convert_document(request):
    if not has_courses(request.user):
        raise PermissionDenied()
    # A new-course import needs C; an existing destination additionally needs ownership.
    if request.data.get('course'):
        course_id = serializers.IntegerField(min_value=1).run_validation(request.data['course'])
        course = get_object_or_404(Course, pk=course_id)
        if not manages_course(request.user, course):
            raise PermissionDenied()
    upload = request.FILES.get("file")
    suffix = Path(upload.name).suffix.lower() if upload else ""
    if not upload or suffix not in (".pdf", ".pptx"):
        raise ValidationError(translate("Choose a PDF or PPTX file."))
    if upload.size > 20 * 1024 * 1024:
        raise ValidationError(translate("Documents must be smaller than 20 MB."))
    with TemporaryDirectory(prefix="training-document-") as directory:
        source = Path(directory) / ("source" + suffix)
        with source.open("wb") as output:
            for chunk in upload.chunks():
                output.write(chunk)
        try:
            process = subprocess.run(
                [
                    sys.executable,
                    str(Path(__file__).with_name("document_extract.py").resolve()),
                    str(source),
                ],
                capture_output=True,
                text=True,
                timeout=30,
            )
            result = json.loads(process.stdout)
        except (subprocess.TimeoutExpired, ValueError):
            raise ValidationError(
                translate(
                    "The document is too complex to import. Split it into smaller files."
                )
            )
        if process.returncode or "error" in result:
            raise ValidationError(
                translate(result.get("error", "The document could not be read."))
            )
    return Response(result)
