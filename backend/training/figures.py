"""Bounded, metadata-free question images shared by uploads and bundle imports."""
import hashlib
import warnings
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.http import Http404, HttpResponse, HttpResponseNotModified
from django.shortcuts import get_object_or_404
from django.utils.http import parse_etags
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .i18n import translate
from .models import QuestionFigure
from .services import audit
from .views import session_invite
from .access import has_exams

MAX_INPUT = 5 * 1024 * 1024
MAX_SIDE = 4096
MAX_PIXELS = 16_000_000
FORMATS = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}
INVALID = "Choose a valid, non-animated PNG, JPEG or WebP image."
LIMIT = "Figures must be at most 5 MiB, 4096 pixels per side and 16 megapixels."


def process_figure(data, *, created_by=None):
    if len(data) > MAX_INPUT:
        raise ValidationError(translate(LIMIT))
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as source:
                image_format = source.format
                if image_format not in FORMATS:
                    raise ValidationError(translate(INVALID))
                width, height = source.size
                if max(width, height) > MAX_SIDE or width * height > MAX_PIXELS:
                    raise ValidationError(translate(LIMIT))
                if getattr(source, "n_frames", 1) > 1:
                    raise ValidationError(translate(INVALID))
                source.verify()
            with Image.open(BytesIO(data)) as source:
                oriented = ImageOps.exif_transpose(source)
                mode = "RGB" if image_format == "JPEG" else (
                    "RGBA" if "A" in oriented.getbands() or "transparency" in oriented.info else "RGB"
                )
                converted = oriented.convert(mode)
                # A fresh pixel-only image cannot retain EXIF, XMP, ICC, text or comments.
                clean = Image.frombytes(mode, converted.size, converted.tobytes())
                output = BytesIO()
                options = {"optimize": True} if image_format == "PNG" else (
                    {"quality": 90} if image_format == "JPEG" else {}
                )
                clean.save(output, format=image_format, **options)
                width, height = clean.size
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ValidationError(translate(LIMIT)) from None
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError, EOFError):
        raise ValidationError(translate(INVALID)) from None
    stored = output.getvalue()
    figure, _ = QuestionFigure.objects.get_or_create(
        sha256=hashlib.sha256(stored).hexdigest(),
        defaults={"data": stored, "content_type": FORMATS[image_format],
                  "width": width, "height": height, "size": len(stored), "created_by": created_by},
    )
    return figure


@api_view(["POST"])
@transaction.atomic
def upload_figure(request):
    if not has_exams(request.user):
        raise PermissionDenied()
    upload = request.FILES.get("file")
    if not upload:
        raise ValidationError(translate(INVALID))
    figure = process_figure(upload.read(MAX_INPUT + 1), created_by=request.user)
    audit(request.user, "question_figure.upload", figure.pk)
    return Response({field: getattr(figure, field) for field in
                     ("key", "width", "height", "content_type", "size")})


@api_view(["GET"])
@permission_classes([AllowAny])
def serve_figure(request, key):
    if not request.user.is_authenticated:
        try:
            session_invite(request)
        except (PermissionDenied, DjangoValidationError, ValueError, TypeError):
            raise Http404 from None
    figure = get_object_or_404(QuestionFigure, key=key)
    etag = '"' + figure.sha256 + '"'
    tags = parse_etags(request.headers.get("If-None-Match", ""))
    matched = "*" in tags or etag in [tag.removeprefix("W/") for tag in tags]
    if matched:
        response = HttpResponseNotModified()
    else:
        # Only the image-serving path explicitly fetches stored pixels.
        data = QuestionFigure.objects.defer(None).values_list("data", flat=True).get(pk=figure.pk)
        response = HttpResponse(bytes(data))
    response["Content-Type"] = figure.content_type
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Security-Policy"] = "default-src 'none'; sandbox"
    response["Cross-Origin-Resource-Policy"] = "same-origin"
    response["Cache-Control"] = "private, max-age=31536000, immutable"
    response["ETag"] = etag
    return response
