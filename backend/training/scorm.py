import json
import mimetypes
import shutil
import stat
import zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit, unquote, quote
from defusedxml import ElementTree
from django.conf import settings
from django.core import signing
from django.db import transaction
from django.http import HttpResponse, FileResponse, HttpResponseForbidden
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.clickjacking import xframe_options_exempt
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError, PermissionDenied
from .models import Course, ScormPackage, ScormState, Enrollment
from .services import audit

MAX_BYTES = 100 * 1024 * 1024


def safe_path(path):
    raw = unquote(path)
    p = PurePosixPath(raw)
    if (
        not raw
        or "\\" in raw
        or "\x00" in raw
        or p.is_absolute()
        or ".." in p.parts
        or ":" in raw
    ):
        raise ValidationError("套件含有不安全的檔案路徑。")
    return p.as_posix()


def inspect_package(upload):
    try:
        archive = zipfile.ZipFile(upload)
    except (zipfile.BadZipFile, OSError):
        raise ValidationError("請上傳有效的 SCORM ZIP 套件。")
    files = archive.infolist()
    if len(files) > 2000 or sum(f.file_size for f in files) > MAX_BYTES:
        archive.close()
        raise ValidationError("套件超過 100 MB 或 2,000 個檔案。")
    seen = set()
    try:
        for info in files:
            normalized = safe_path(info.filename)
            if (
                normalized in seen
                or stat.S_ISLNK(info.external_attr >> 16)
                or info.flag_bits & 1
            ):
                raise ValidationError("不接受重複路徑、符號連結或加密檔案。")
            seen.add(normalized)
        manifest_info = archive.getinfo("imsmanifest.xml")
        if manifest_info.file_size > 1024 * 1024:
            raise ValidationError("Manifest 過大。")
        root = ElementTree.fromstring(archive.read("imsmanifest.xml"))
        resources = [
            r
            for r in root.iter()
            if r.tag.split("}")[-1] == "resource"
            and any(
                k.split("}")[-1].lower() == "scormtype" and v.lower() == "sco"
                for k, v in r.attrib.items()
            )
        ]
        if len(resources) != 1:
            raise ValidationError(
                "目前支援單一 SCO；多 SCO／SCORM 2004 sequencing 套件需先重新匯出為單一 SCO。"
            )
        href = resources[0].get("href", "")
        parts = urlsplit(href)
        if parts.scheme or parts.netloc:
            raise ValidationError("教材啟動位置必須位於套件內。")
        path = safe_path(parts.path)
        if path not in seen:
            raise ValidationError("套件缺少啟動檔案。")
        version = next(
            (
                e.text or ""
                for e in root.iter()
                if e.tag.split("}")[-1] == "schemaversion"
            ),
            "1.2",
        )
        title = next(
            (e.text or "" for e in root.iter() if e.tag.split("}")[-1] == "title"),
            "SCORM course",
        )
        return (
            archive,
            ("2004" if "2004" in version or version.startswith("1.3") else "1.2"),
            href,
            title[:200],
        )
    except ValidationError:
        archive.close()
        raise
    except Exception:
        archive.close()
        raise ValidationError("無法解析 imsmanifest.xml；請確認套件格式。")


@api_view(["POST"])
def upload_package(request, course_id):
    course = get_object_or_404(Course, pk=course_id)
    if request.user.role not in ("admin", "instructor") or (
        request.user.role != "admin" and course.owner_id != request.user.id
    ):
        raise PermissionDenied()
    upload = request.FILES.get("file")
    if not upload or upload.size > MAX_BYTES:
        raise ValidationError("請提供小於 100 MB 的 SCORM ZIP。")
    archive, version, launch_path, title = inspect_package(upload)
    package = ScormPackage(
        course=course, version=version, launch_path=launch_path, title=title
    )
    dest = settings.MEDIA_ROOT / "packages" / str(package.id)
    source = request.FILES.get("source")
    source_path = settings.MEDIA_ROOT / "sources" / (str(package.id) + ".zip")
    try:
        if source:
            if source.size > MAX_BYTES:
                raise ValidationError("Source archive exceeds 100 MB.")
            with zipfile.ZipFile(source) as project_zip:
                if (
                    len(project_zip.infolist()) > 2000
                    or sum(i.file_size for i in project_zip.infolist()) > MAX_BYTES
                ):
                    raise ValidationError("Source archive exceeds extraction limits.")
                for info in project_zip.infolist():
                    safe_path(info.filename)
                project = json.loads(project_zip.read("project.json"))
                if not isinstance(project.get("lessons"), list):
                    raise ValidationError("Invalid Scormly project.")
            source.seek(0)
            source_path.parent.mkdir(parents=True, exist_ok=True)
            with source_path.open("wb") as output:
                for chunk in source.chunks():
                    output.write(chunk)
            package.has_source = True
        dest.mkdir(parents=True)
        for info in archive.infolist():
            target = dest / safe_path(info.filename)
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(info) as src, target.open("wb") as output:
                    shutil.copyfileobj(src, output, 64 * 1024)
        package.save()
    except Exception:
        if dest.exists():
            shutil.rmtree(dest)
        source_path.unlink(missing_ok=True)
        raise ValidationError("套件解壓失敗，未建立教材版本。")
    finally:
        archive.close()
    audit(
        request.user,
        "scorm.uploaded",
        package.id,
        {"course": course.id, "version": version},
    )
    return Response(
        {"id": str(package.id), "version": version, "title": title}, status=201
    )


@api_view(["GET"])
def download_source(request, course_id):
    course = get_object_or_404(Course, pk=course_id)
    if request.user.role not in ("admin", "instructor") or (
        request.user.role != "admin" and course.owner_id != request.user.id
    ):
        raise PermissionDenied()
    package = course.packages.order_by("-created_at").first()
    if not package or not package.has_source:
        raise ValidationError("此版本未附 Scormly 原始專案。")
    source_path = settings.MEDIA_ROOT / "sources" / (str(package.id) + ".zip")
    return FileResponse(
        source_path.open("rb"),
        as_attachment=True,
        filename=f"course-{course.id}-project.zip",
        content_type="application/zip",
    )


@api_view(["POST"])
def launch(request, package_id):
    package = get_object_or_404(
        ScormPackage.objects.select_related("course"), pk=package_id
    )
    if (
        not package.course.published
        and request.user.role != "admin"
        and package.course.owner_id != request.user.id
    ):
        raise PermissionDenied()
    Enrollment.objects.get_or_create(user=request.user, course=package.course)
    import secrets

    nonce = secrets.token_urlsafe(24)
    launches = request.session.get("scorm_launches", {})
    launches[str(package.id)] = nonce
    request.session["scorm_launches"] = dict(list(launches.items())[-20:])
    ticket = signing.dumps(
        {"package": str(package.id), "user": request.user.id, "nonce": nonce},
        salt="scorm-launch",
    )
    return Response(
        {
            "url": settings.SCORM_ORIGIN + "/launch?ticket=" + quote(ticket),
            "nonce": nonce,
            "origin": settings.SCORM_ORIGIN,
        }
    )


@api_view(["POST"])
def commit(request, package_id):
    package = get_object_or_404(ScormPackage, pk=package_id)
    expected = request.session.get("scorm_launches", {}).get(str(package_id))
    if not expected or request.data.get("nonce") != expected:
        raise PermissionDenied("播放器工作階段無效。")
    cmi = request.data.get("cmi")
    if not isinstance(cmi, dict) or len(json.dumps(cmi)) > 100000 or len(cmi) > 1000:
        raise ValidationError("SCORM 資料超過限制。")
    if any(
        not isinstance(k, str)
        or not k.startswith("cmi.")
        or not isinstance(v, str)
        or len(v) > 64000
        for k, v in cmi.items()
    ):
        raise ValidationError("SCORM 資料格式不正確。")
    with transaction.atomic():
        ScormState.objects.update_or_create(
            user=request.user, package=package, defaults={"cmi": cmi}
        )
        enrollment = Enrollment.objects.select_for_update().get(
            user=request.user, course=package.course
        )
        complete = (
            cmi.get("cmi.core.lesson_status") in ("passed", "completed")
            or cmi.get("cmi.completion_status") == "completed"
        )
        if complete:
            enrollment.progress = 100
            enrollment.completed_at = enrollment.completed_at or timezone.now()
        elif enrollment.progress < 100:
            enrollment.progress = max(enrollment.progress, 1)
        enrollment.save()
    return Response(
        {"saved_at": timezone.now(), "completed": enrollment.progress == 100}
    )


def protected_headers(response):
    response["Content-Security-Policy"] = (
        f"frame-ancestors 'self' {settings.APP_ORIGIN}; object-src 'none'; base-uri 'self'"
    )
    response["Referrer-Policy"] = "no-referrer"
    response["Cache-Control"] = "no-store"
    return response


@xframe_options_exempt
def content_launch(request):
    try:
        payload = signing.loads(
            request.GET.get("ticket", ""), salt="scorm-launch", max_age=120
        )
    except signing.BadSignature:
        return HttpResponseForbidden("Launch ticket expired or invalid.")
    package = get_object_or_404(ScormPackage, pk=payload["package"])
    state = ScormState.objects.filter(package=package, user_id=payload["user"]).first()
    cmi = state.cmi.copy() if state else {}
    cmi.update(
        {
            "cmi.core.student_id": str(payload["user"]),
            "cmi.learner_id": str(payload["user"]),
            "cmi.core.entry": "resume" if state else "ab-initio",
            "cmi.entry": "resume" if state else "ab-initio",
        }
    )
    config = json.dumps(
        {
            "cmi": cmi,
            "origin": settings.APP_ORIGIN,
            "nonce": payload["nonce"],
            "src": "/packages/" + str(package.id) + "/" + package.launch_path,
        }
    ).replace("<", "\\u003c")
    runtime = (Path(__file__).parent / "scorm_runtime.js").read_text()
    response = HttpResponse(
        '<!doctype html><html><head><meta charset="utf-8"><title>SCORM Player</title>'
        "<style>html,body,iframe{margin:0;width:100%;height:100%;border:0;display:block}body{overflow:hidden}</style></head>"
        f"<body><script>const CONFIG={config};\n{runtime}</script>"
        '<iframe id="sco" title="課程教材" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"></iframe>'
        '<script>document.getElementById("sco").src=CONFIG.src;</script></body></html>'
    )
    cookie = signing.dumps({"package": str(package.id)}, salt="scorm-content")
    response.set_cookie(
        "scorm_access_" + str(package.id),
        cookie,
        path="/packages/" + str(package.id) + "/",
        max_age=8 * 3600,
        httponly=True,
        secure=not settings.DEBUG,
        samesite="Lax",
    )
    return protected_headers(response)


@xframe_options_exempt
def content_file(request, package_id, path):
    try:
        cookie = request.COOKIES.get("scorm_access_" + str(package_id), "")
        payload = signing.loads(cookie, salt="scorm-content", max_age=8 * 3600)
        if payload["package"] != str(package_id):
            raise signing.BadSignature()
        relative = safe_path(path)
    except (signing.BadSignature, ValidationError, KeyError):
        return HttpResponseForbidden("Content access denied.")
    root = (settings.MEDIA_ROOT / "packages" / str(package_id)).resolve()
    target = (root / relative).resolve()
    if not target.is_relative_to(root) or not target.is_file():
        return HttpResponse(status=404)
    return protected_headers(
        FileResponse(
            target.open("rb"),
            content_type=mimetypes.guess_type(target)[0] or "application/octet-stream",
        )
    )
