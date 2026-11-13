"""Private scheduled-course materials; filenames never determine storage paths."""
import re
import uuid
import zipfile
from pathlib import Path
from urllib.parse import quote, urlsplit

from django.conf import settings
from django.db import transaction
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from .access import manages_course, views_materials
from .i18n import translate
from .models import Course, CourseMaterial
from .services import audit

MAX_BYTES = 100 * 1024 * 1024
TYPES = {
    '.pdf': 'application/pdf', '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}


def https_url(value):
    try:
        parts = urlsplit(value)
        valid = parts.scheme == 'https' and parts.hostname and not parts.username and not parts.password
        valid = valid and not any(ord(c) < 33 for c in value) and '\\' not in value
        parts.port
    except ValueError:
        valid = False
    if not valid:
        raise ValidationError(translate('Use a valid HTTPS link.'))
    return value


def safe_filename(value):
    value = value.replace('\\', '/').split('/')[-1]
    return re.sub(r'[\x00-\x1f\x7f]', '', value)[:255] or 'material'


def disposition(filename, inline=False):
    return ('inline' if inline else 'attachment') + "; filename=\"material\"; filename*=UTF-8''" + quote(safe_filename(filename), safe='')


def inspect_file(upload):
    ext = Path(upload.name).suffix.lower()
    if ext not in TYPES or not 0 < upload.size <= MAX_BYTES:
        raise ValidationError(translate('Upload a PDF, PPTX, PPT, DOCX or XLSX file up to 100 MB.'))
    signature = upload.read(8)
    valid = (ext == '.pdf' and signature.startswith(b'%PDF-')) or (ext == '.ppt' and signature == b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1')
    if ext in ('.pptx', '.docx', '.xlsx') and signature.startswith(b'PK\x03\x04'):
        try:
            with zipfile.ZipFile(upload) as archive:
                names = set(archive.namelist())
                marker = {'.pptx': 'ppt/presentation.xml', '.docx': 'word/document.xml', '.xlsx': 'xl/workbook.xml'}[ext]
                valid = '[Content_Types].xml' in names and marker in names
        except (zipfile.BadZipFile, OSError):
            valid = False
    upload.seek(0)
    if not valid:
        raise ValidationError(translate('The file contents do not match the file type.'))
    return ext


class MaterialInput(serializers.Serializer):
    title = serializers.CharField(max_length=200)
    url = serializers.URLField(max_length=2000, required=False, allow_blank=True)
    position = serializers.IntegerField(min_value=0, max_value=100000, required=False)

    def validate_url(self, value):
        return https_url(value) if value else value


def material_data(row):
    return {'id': row.pk, 'title': row.title, 'position': row.position,
            'filename': row.filename, 'size': row.size, 'url': row.url,
            'created_by': row.created_by_id, 'created_at': row.created_at,
            'download_url': settings.APP_BASE_PATH + f'/api/courses/{row.course_id}/materials/{row.pk}/download/' if row.file_key else ''}


@api_view(['GET', 'POST', 'PATCH', 'DELETE'])
@transaction.atomic
def materials(request, course_id, material_id=None):
    course = get_object_or_404(Course.objects.select_for_update() if request.method != 'GET' else Course.objects.all(), pk=course_id)
    if request.method == 'GET':
        if not views_materials(request.user, course):
            raise PermissionDenied()
        data = material_data(get_object_or_404(course.materials, pk=material_id)) if material_id else [material_data(row) for row in course.materials.all()]
        return Response(data, headers={'Cache-Control': 'private, no-store'})
    if not manages_course(request.user, course):
        raise PermissionDenied()
    if course.delivery_mode != 'scheduled':
        raise ValidationError(translate('Materials require scheduled sessions.'))
    if (material_id and request.method == 'POST') or (not material_id and request.method in ('PATCH', 'DELETE')):
        raise ValidationError(translate('Choose a valid material.'))
    row = get_object_or_404(CourseMaterial, pk=material_id, course=course) if material_id else None
    if request.method == 'DELETE':
        key, pk = row.file_key, row.pk
        row.delete()
        if key:
            transaction.on_commit(lambda: (Path(settings.MEDIA_ROOT) / 'materials' / key).unlink(missing_ok=True))
        audit(request.user, 'course.material_deleted', pk, {'course': course.pk})
        return Response(status=204)
    if not row and 'order' in request.data:
        order = request.data['order']
        items = list(course.materials.all())
        if (not isinstance(order, list) or any(type(pk) is not int for pk in order)
                or len(order) != len(items) or set(order) != {item.pk for item in items}):
            raise ValidationError(translate('Refresh materials before reordering.'))
        positions = {pk: index for index, pk in enumerate(order)}
        for item in items:
            item.position = positions[item.pk]
        CourseMaterial.objects.bulk_update(items, ['position'])
        audit(request.user, 'course.materials_reordered', course.pk, {'count': len(items)})
        return Response([material_data(item) for item in sorted(items, key=lambda item: item.position)])
    form = MaterialInput(data=request.data, partial=bool(row))
    form.is_valid(raise_exception=True)
    data = form.validated_data
    if len(request.FILES.getlist('file')) > 1:
        raise ValidationError(translate('Provide either one file or one HTTPS link.'))
    upload = request.FILES.get('file')
    if row:
        if upload or 'url' in data:
            raise ValidationError(translate('Delete the material and add a new one to replace its file or link.'))
        for key, value in data.items():
            setattr(row, key, value)
        row.save()
    else:
        if bool(upload) == bool(data.get('url')):
            raise ValidationError(translate('Provide either one file or one HTTPS link.'))
        if 'position' not in data:
            last = course.materials.order_by('-position').first()
            data['position'] = last.position + 1 if last else 0
        row = CourseMaterial(course=course, created_by=request.user, **data)
        path = None
        try:
            if upload:
                ext = inspect_file(upload)
                row.file_key = uuid.uuid4().hex + ext
                row.filename, row.size = safe_filename(upload.name), upload.size
                path = Path(settings.MEDIA_ROOT) / 'materials' / row.file_key
                path.parent.mkdir(parents=True, exist_ok=True)
                with path.open('xb') as output:
                    size = 0
                    for chunk in upload.chunks():
                        size += len(chunk)
                        if size > MAX_BYTES:
                            raise ValidationError(translate('Upload a PDF, PPTX, PPT, DOCX or XLSX file up to 100 MB.'))
                        output.write(chunk)
            row.save()
            audit(request.user, 'course.material_created', row.pk, {'course': course.pk})
        except Exception:
            if path:
                path.unlink(missing_ok=True)
            raise
    if material_id:
        audit(request.user, 'course.material_updated', row.pk, {'course': course.pk})
    return Response(material_data(row), status=200 if material_id else 201)


@api_view(['GET'])
def download_material(request, course_id, material_id):
    row = get_object_or_404(CourseMaterial.objects.select_related('course'), pk=material_id, course_id=course_id)
    if not views_materials(request.user, row.course):
        raise PermissionDenied()
    if not row.file_key:
        raise ValidationError(translate('This material is a link.'))
    path = Path(settings.MEDIA_ROOT) / 'materials' / row.file_key
    if not path.is_file():
        from django.http import Http404
        raise Http404
    ext = Path(row.file_key).suffix
    response = FileResponse(path.open('rb'), content_type=TYPES[ext])
    response['Content-Disposition'] = disposition(row.filename, inline=ext == '.pdf')
    response['X-Content-Type-Options'] = 'nosniff'
    response['Cache-Control'] = 'private, no-store'
    return response
