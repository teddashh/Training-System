import base64
import hashlib
import io
import json
from copy import deepcopy
from datetime import timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from PIL import Image, PngImagePlugin
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.db.models.deletion import ProtectedError
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient
from django.core.files.uploadedfile import SimpleUploadedFile

from .figures import MAX_INPUT, process_figure
from .models import Attempt, AuditEvent, BankQuestion, Exam, Identity, Invitation, Question, QuestionFigure, User
from .serializers import BankQuestionSerializer, QuestionSerializer
from .services import hash_token, public_attempt
from .management.commands.import_yaksh import convert_question


def image_bytes(fmt="PNG", size=(12, 8), mode="RGB", **kwargs):
    image = Image.new(mode, size, 0)
    output = io.BytesIO()
    image.save(output, format=fmt, **kwargs)
    return output.getvalue()


def question_data(**changes):
    return {"description": "Synthetic context\nSecond line\n\nWhich route is available?",
            "type": "single", "options": ["Route A", "Route B"], "solution": [0],
            "points": 10, **changes}


class FigureProcessingTests(TestCase):
    def test_png_text_exif_and_transparency_are_sanitized(self):
        info = PngImagePlugin.PngInfo()
        info.add_text("Comment", "Synthetic metadata")
        info.add_itxt("XML:com.adobe.xmp", "Synthetic XMP")
        exif = Image.Exif()
        exif[270] = "Synthetic description"
        raw = image_bytes(mode="RGBA", pnginfo=info, exif=exif)
        figure = process_figure(raw)
        self.assertNotEqual(bytes(figure.data), raw)
        with Image.open(io.BytesIO(figure.data)) as clean:
            self.assertEqual(clean.format, "PNG")
            self.assertEqual(clean.mode, "RGBA")
            self.assertEqual(clean.info, {})
            self.assertEqual(dict(clean.getexif()), {})
        self.assertEqual(figure.content_type, "image/png")

    def test_jpeg_exif_gps_orientation_and_comments_are_removed(self):
        exif = Image.Exif()
        exif[274] = 6
        exif[34853] = {1: "N", 2: (1.0, 0.0, 0.0), 3: "E", 4: (1.0, 0.0, 0.0)}
        raw = image_bytes("JPEG", exif=exif, comment=b"Synthetic comment")
        with Image.open(io.BytesIO(raw)) as source:
            self.assertIn(34853, source.getexif())
        figure = process_figure(raw)
        self.assertEqual((figure.width, figure.height), (8, 12))
        with Image.open(io.BytesIO(figure.data)) as clean:
            self.assertEqual(clean.format, "JPEG")
            self.assertEqual(clean.mode, "RGB")
            self.assertEqual(dict(clean.getexif()), {})
            self.assertNotIn("comment", clean.info)
            self.assertNotIn("xmp", clean.info)
        self.assertEqual(figure.content_type, "image/jpeg")

    def test_cmyk_becomes_rgb(self):
        figure = process_figure(image_bytes("JPEG", mode="CMYK"))
        with Image.open(io.BytesIO(figure.data)) as clean:
            self.assertEqual(clean.mode, "RGB")
            self.assertNotIn("adobe", clean.info)

    def test_webp_metadata_is_removed(self):
        exif = Image.Exif()
        exif[270] = "Synthetic description"
        raw = image_bytes("WEBP", exif=exif, xmp=b"Synthetic XMP", icc_profile=b"Synthetic ICC")
        figure = process_figure(raw)
        with Image.open(io.BytesIO(figure.data)) as clean:
            self.assertEqual(clean.format, "WEBP")
            for key in ("exif", "xmp", "icc_profile", "comment"):
                self.assertNotIn(key, clean.info)
        self.assertEqual(figure.content_type, "image/webp")

    def test_deduplication_uses_stored_bytes_and_preserves_creator(self):
        owner = User.objects.create_user("figure-creator")
        info = PngImagePlugin.PngInfo()
        info.add_text("Comment", "Different metadata")
        first = process_figure(image_bytes(), created_by=owner)
        second = process_figure(image_bytes(pnginfo=info))
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(second.created_by, owner)
        self.assertEqual(first.size, len(first.data))
        self.assertEqual(first.sha256, hashlib.sha256(first.data).hexdigest())
        self.assertRegex(first.key, r"^[A-Za-z0-9_-]{43}$")
        self.assertEqual(QuestionFigure.objects.count(), 1)

    def test_unsupported_gif_svg_and_garbage_are_rejected(self):
        for raw in (image_bytes("GIF"), b'<svg xmlns="http://www.w3.org/2000/svg"/>', b"not an image", b""):
            with self.subTest(kind=raw[:6]), self.assertRaises(ValidationError):
                process_figure(raw)
        self.assertEqual(QuestionFigure.objects.count(), 0)

    def test_animation_is_rejected_in_all_supported_containers(self):
        for fmt in ("GIF", "PNG", "WEBP"):
            with self.subTest(fmt=fmt):
                output = io.BytesIO()
                Image.new("RGB", (12, 8), "black").save(output, format=fmt, save_all=True,
                    append_images=[Image.new("RGB", (12, 8), "white")], duration=100, loop=0)
                with self.assertRaises(ValidationError):
                    process_figure(output.getvalue())

    def test_invalid_crc_and_truncated_pixels_are_rejected(self):
        png = bytearray(image_bytes())
        png[-5] ^= 1
        for raw in (bytes(png), image_bytes("JPEG")[:-20], image_bytes("WEBP")[:-10]):
            with self.subTest(length=len(raw)), self.assertRaises(ValidationError):
                process_figure(raw)

    def test_input_dimension_and_pixel_limits(self):
        for raw in (b"x" * (MAX_INPUT + 1), image_bytes(size=(4097, 1)),
                    image_bytes(size=(1, 4097)), image_bytes(size=(4001, 4000))):
            with self.subTest(length=len(raw)), self.assertRaises(ValidationError):
                process_figure(raw)
        self.assertEqual(QuestionFigure.objects.count(), 0)

    def test_dimensions_are_checked_before_decoding(self):
        raw = image_bytes(size=(4097, 2))
        with patch.object(PngImagePlugin.PngImageFile, "load", side_effect=AssertionError("Decoded oversized image")):
            with self.assertRaises(ValidationError):
                process_figure(raw)

    def test_decompression_bomb_warning_and_error_are_rejected(self):
        raw = image_bytes()
        for limit in (60, 1):
            with self.subTest(limit=limit), patch.object(Image, "MAX_IMAGE_PIXELS", limit):
                with self.assertRaises(ValidationError):
                    process_figure(raw)

    def test_figures_cannot_be_edited_or_deleted_even_if_unreferenced(self):
        figure = process_figure(image_bytes())
        with self.assertRaises(ValueError):
            figure.save()
        with self.assertRaises(ValueError):
            figure.delete()
        with self.assertRaises(ValueError):
            QuestionFigure.objects.all().delete()
        with self.assertRaises(ValueError):
            QuestionFigure.objects.filter(pk=figure.pk).update(data=b"changed")
        self.assertEqual(QuestionFigure.objects.count(), 1)

    def test_creator_deletion_only_clears_attribution(self):
        owner = User.objects.create_user("temporary-creator")
        figure = process_figure(image_bytes(), created_by=owner)
        owner.delete()
        figure.refresh_from_db()
        self.assertIsNone(figure.created_by)
        self.assertTrue(figure.data)


@override_settings(DEBUG=True)
class FigureAPITests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user("figure-admin", role="admin")
        self.instructor = User.objects.create_user("figure-instructor", role="instructor")
        self.learner = User.objects.create_user("figure-learner")
        self.figure = process_figure(image_bytes())
        self.client = APIClient()
        self.url = f"/api/question-figures/{self.figure.key}/"
        self.exam = Exam.objects.create(title="Synthetic figures", owner=self.admin, published=True)
        self.question = Question.objects.create(exam=self.exam, **question_data(), figure=self.figure,
                                               figure_alt="Two synthetic routes", figure_caption="Route diagram")

    def invitation(self, **kwargs):
        return Invitation.objects.create(exam=self.exam, identity=Identity.objects.create(key="email:guest@corp.example.com"),
            token_hash=hash_token("synthetic-figure-token"), created_by=self.admin,
            expires_at=timezone.now() + timedelta(days=1), **kwargs)

    def guest_session(self, invitation):
        session = self.client.session
        session["guest_invitation"] = str(invitation.pk)
        session.save()

    def upload(self, raw=None, **headers):
        return self.client.post("/api/question-figures/", {"file": SimpleUploadedFile(
            "synthetic.svg", image_bytes() if raw is None else raw, content_type="text/plain")}, **headers)

    def test_upload_permission_reuses_question_edit_roles_and_audits(self):
        for user, status in ((None, 403), (self.learner, 403), (self.instructor, 200), (self.admin, 200)):
            self.client.force_authenticate(user)
            response = self.upload()
            self.assertEqual(response.status_code, status, response.content)
            if status == 200:
                self.assertEqual(set(response.data), {"key", "width", "height", "content_type", "size"})
                self.assertEqual(response.data["key"], self.figure.key)
        events = AuditEvent.objects.filter(action="question_figure.upload")
        self.assertEqual(events.count(), 2)
        self.assertEqual(events.last().target, str(self.figure.pk))
        self.assertEqual(events.last().detail, {})

    def test_invalid_upload_and_missing_file_are_translated_400(self):
        self.client.force_authenticate(self.admin)
        response = self.upload(b"garbage", HTTP_ACCEPT_LANGUAGE="es")
        self.assertEqual(response.status_code, 400)
        self.assertIn("Elija", str(response.data))
        self.assertEqual(self.client.post("/api/question-figures/", {}).status_code, 400)
        self.assertFalse(AuditEvent.objects.filter(action="question_figure.upload").exists())

    @override_settings(APP_BASE_PATH="/training", FORCE_SCRIPT_NAME="/training")
    def test_authenticated_serving_headers_etags_and_key_only_api(self):
        self.client.force_authenticate(self.learner)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, bytes(self.figure.data))
        headers = {"Content-Type": "image/png", "X-Content-Type-Options": "nosniff",
                   "Content-Security-Policy": "default-src 'none'; sandbox",
                   "Cross-Origin-Resource-Policy": "same-origin",
                   "Cache-Control": "private, max-age=31536000, immutable",
                   "ETag": f'"{self.figure.sha256}"'}
        for name, value in headers.items():
            self.assertEqual(response[name], value)
        for tag in (headers["ETag"], "W/" + headers["ETag"], '*', '"other", ' + headers["ETag"]):
            cached = self.client.get(self.url, HTTP_IF_NONE_MATCH=tag)
            self.assertEqual(cached.status_code, 304)
            self.assertEqual(cached.content, b"")
            for name, value in headers.items():
                self.assertEqual(cached[name], value)
        self.assertEqual(self.client.get(self.url, HTTP_IF_NONE_MATCH='"other"').status_code, 200)
        self.assertEqual(set(QuestionSerializer(self.question).data["figure"]), {"key", "width", "height"})

    def test_anonymous_unknown_and_conditional_requests_are_404(self):
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.assertEqual(self.client.get(self.url, HTTP_IF_NONE_MATCH="*").status_code, 404)
        self.client.force_authenticate(self.learner)
        self.assertEqual(self.client.get("/api/question-figures/unknown/").status_code, 404)

    def test_active_guest_session_can_view_but_revoked_or_expired_cannot(self):
        invitation = self.invitation()
        self.guest_session(invitation)
        self.assertEqual(self.client.get(self.url).status_code, 200)
        invitation.revoked = True
        invitation.save()
        self.assertEqual(self.client.get(self.url, HTTP_IF_NONE_MATCH="*").status_code, 404)
        invitation.revoked = False
        invitation.expires_at = timezone.now() - timedelta(seconds=1)
        invitation.save()
        self.assertEqual(self.client.get(self.url).status_code, 404)

    def test_unverified_and_malformed_guest_sessions_are_404(self):
        invitation = self.invitation(require_email_verification=True)
        self.guest_session(invitation)
        self.assertEqual(self.client.get(self.url).status_code, 404)
        session = self.client.session
        session["guest_verified_invitation"] = str(invitation.pk)
        session.save()
        self.assertEqual(self.client.get(self.url).status_code, 200)
        session["guest_invitation"] = "not-a-uuid"
        session.save()
        self.assertEqual(self.client.get(self.url).status_code, 404)

    def test_serializer_rules_for_exam_and_bank_questions(self):
        for cls in (QuestionSerializer, BankQuestionSerializer):
            with self.subTest(serializer=cls.__name__):
                for alt in ("", "   "):
                    serializer = cls(data=question_data(figure=self.figure.key, figure_alt=alt))
                    self.assertFalse(serializer.is_valid())
                    self.assertIn("figure_alt", serializer.errors)
                serializer = cls(data=question_data(figure="unknown", figure_alt="Route"))
                self.assertFalse(serializer.is_valid())
                self.assertIn("figure", serializer.errors)
                serializer = cls(data=question_data(figure=self.figure.key, figure_alt="Route", figure_caption="Map"))
                self.assertTrue(serializer.is_valid(), serializer.errors)
                obj = serializer.save(**({"exam": self.exam} if cls == QuestionSerializer else {"owner": self.admin}))
                partial = cls(obj, data={"figure_alt": " "}, partial=True)
                self.assertFalse(partial.is_valid())
                partial = cls(obj, data={"points": 20}, partial=True)
                self.assertTrue(partial.is_valid(), partial.errors)
                partial.save()
                self.assertEqual(partial.data["figure"]["key"], self.figure.key)
                removed = cls(obj, data={"figure": None, "figure_alt": "stale", "figure_caption": "stale"}, partial=True)
                self.assertTrue(removed.is_valid(), removed.errors)
                obj = removed.save()
                self.assertIsNone(obj.figure)
                self.assertEqual((obj.figure_alt, obj.figure_caption), ("", ""))

    def test_learner_and_guest_snapshots_freeze_figures_without_exposing_answers(self):
        for guest in (False, True):
            with self.subTest(guest=guest):
                if guest:
                    self.client.force_authenticate(None)
                    self.guest_session(self.invitation())
                    response = self.client.post("/api/guest/exam/")
                else:
                    self.client.force_authenticate(self.learner)
                    response = self.client.post(f"/api/exams/{self.exam.pk}/start/")
                self.assertEqual(response.status_code, 200, response.content)
                attempt = Attempt.objects.get(pk=response.data["id"])
                before = response.data["questions"][0]
                self.assertEqual(before["figure"], {"key": self.figure.key, "width": 12, "height": 8,
                    "alt": "Two synthetic routes", "caption": "Route diagram"})
                for hidden in ("solution", "answer_tolerances", "answer_matching"):
                    self.assertNotIn(hidden, before)
                replacement = process_figure(image_bytes(size=(10, 10)))
                self.question.figure = replacement
                self.question.figure_alt = "Changed route"
                self.question.save()
                resumed = self.client.get(f"/api/attempts/{attempt.pk}/")
                self.assertEqual(resumed.data["questions"][0], before)
                self.assertEqual(self.client.get(self.url).status_code, 200)
                self.question.figure = self.figure
                self.question.figure_alt = "Two synthetic routes"
                self.question.save()
                # Older snapshots remain usable without a figure member.
                attempt.snapshot[0].pop("figure")
                attempt.save(update_fields=["snapshot"])
                self.assertNotIn("figure", public_attempt(attempt)["questions"][0])

    def test_figures_reach_preview_review_evidence_and_insights(self):
        self.client.force_authenticate(self.admin)
        preview = self.client.post(f"/api/exams/{self.exam.pk}/previews/", {"mode": "unrestricted"}, format="json")
        self.assertEqual(preview.status_code, 201, preview.content)
        self.assertEqual(preview.data["questions"][0]["figure"]["key"], self.figure.key)
        response = self.client.post(f"/api/exams/{self.exam.pk}/start/")
        attempt_id = response.data["id"]
        response = self.client.post(f"/api/attempts/{attempt_id}/", {
            "answers": {str(self.question.pk): 0}, "answer_revision": 0}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        for url in (f"/api/attempts/{attempt_id}/", f"/api/results/{attempt_id}/review/",
                    f"/api/attempts/{attempt_id}/inspection/"):
            result = self.client.get(url)
            self.assertEqual(result.status_code, 200, result.content)
            self.assertEqual(result.data["questions"][0]["figure"]["key"], self.figure.key)
        insights = self.client.get(f"/api/exams/{self.exam.pk}/insights/")
        self.assertEqual(insights.status_code, 200, insights.content)
        self.assertEqual(insights.data["questions"][0]["figure"]["key"], self.figure.key)

    def test_analysis_separates_changed_figures_and_accepts_old_snapshots(self):
        from .reporting import question_variant
        original = question_data(id=self.question.pk)
        old_variant = question_variant(original)
        self.assertEqual(old_variant, question_variant({**original, "figure": None}))
        with_figure = {**original, "figure": {"key": self.figure.key, "alt": "Route", "caption": "Map"}}
        self.assertNotEqual(old_variant, question_variant(with_figure))
        self.assertNotEqual(question_variant(with_figure), question_variant({
            **with_figure, "figure": {**with_figure["figure"], "key": "changed"}}))

    def test_api_copies_between_bank_and_exam_keep_figure(self):
        self.client.force_authenticate(self.admin)
        data = question_data(figure=self.figure.key, figure_alt="Route", figure_caption="Map")
        bank = self.client.post("/api/question-bank/", data, format="json")
        self.assertEqual(bank.status_code, 201, bank.content)
        copied = {**bank.data, "figure": bank.data["figure"]["key"]}
        exam = self.client.post("/api/exams/", {"title": "Copied figure", "questions": [copied]}, format="json")
        self.assertEqual(exam.status_code, 201, exam.content)
        copied_back = {**exam.data["questions"][0], "figure": exam.data["questions"][0]["figure"]["key"]}
        bank_again = self.client.post("/api/question-bank/", copied_back, format="json")
        self.assertEqual(bank_again.status_code, 201, bank_again.content)
        for result in (bank.data, exam.data["questions"][0], bank_again.data):
            self.assertEqual(result["figure"]["key"], self.figure.key)
            self.assertEqual((result["figure_alt"], result["figure_caption"]), ("Route", "Map"))

    def test_legacy_import_preserves_optional_figure(self):
        data = convert_question({"type": "mcq", "description": "Synthetic imported route", "points": 10,
            "testcase": [{"options": "Route A", "correct": True}, {"options": "Route B", "correct": False}],
            "figure": self.figure.key, "figure_alt": "Route", "figure_caption": "Map"})
        self.assertEqual(data["figure"], self.figure)
        self.assertEqual(data["figure_alt"], "Route")
        self.assertEqual(data["figure_caption"], "Map")

    def assert_no_blob_selects(self, queries):
        for query in queries:
            self.assertNotIn('"training_questionfigure"."data"', query["sql"])

    def test_exam_detail_and_bank_list_queries_are_constant_and_blob_free(self):
        self.client.force_authenticate(self.admin)
        BankQuestion.objects.create(owner=self.admin, **question_data(), figure=self.figure, figure_alt="Route")
        urls = (f"/api/exams/{self.exam.pk}/", "/api/question-bank/")
        baseline = {}
        for url in urls:
            with CaptureQueriesContext(connection) as queries:
                response = self.client.get(url)
                self.assertEqual(response.status_code, 200, response.content)
            self.assert_no_blob_selects(queries)
            baseline[url] = len(queries)
        for index in range(7):
            figure = process_figure(image_bytes(size=(20 + index, 8)))
            Question.objects.create(exam=self.exam, **question_data(), figure=figure, figure_alt="Route")
            BankQuestion.objects.create(owner=self.admin, **question_data(), figure=figure, figure_alt="Route")
        for url in urls:
            with CaptureQueriesContext(connection) as queries:
                response = self.client.get(url)
                self.assertEqual(response.status_code, 200, response.content)
                questions = response.data["questions"] if url == urls[0] else response.data
                self.assertEqual(len(questions), 8)
                self.assertTrue(all(q["figure"]["key"] for q in questions))
            self.assert_no_blob_selects(queries)
            self.assertEqual(len(queries), baseline[url], [q["sql"] for q in queries])

    def test_default_base_and_lazy_managers_and_dedup_defer_blobs(self):
        self.assertIs(QuestionFigure._base_manager, QuestionFigure.objects)
        with CaptureQueriesContext(connection) as queries:
            for manager in (QuestionFigure.objects, QuestionFigure._base_manager):
                self.assertIn("data", manager.get(pk=self.figure.pk).get_deferred_fields())
            question = Question.objects.get(pk=self.question.pk)
            self.assertEqual(question.figure.key, self.figure.key)
            self.assertIn("data", question.figure.get_deferred_fields())
            duplicate = process_figure(image_bytes())
            self.assertEqual(duplicate.pk, self.figure.pk)
            self.assertIn("data", duplicate.get_deferred_fields())
            with self.assertRaises(ValueError):
                duplicate.save()
            with self.assertRaises(ValueError):
                QuestionFigure.objects.filter(pk=duplicate.pk).update(width=1)
        self.assert_no_blob_selects(queries)

    def test_direct_serialization_snapshots_reviews_and_copies_defer_blobs(self):
        from .services import question_snapshot
        self.client.force_authenticate(self.admin)
        with CaptureQueriesContext(connection) as queries:
            self.assertEqual(QuestionSerializer(self.exam.questions, many=True).data[0]["figure"]["key"], self.figure.key)
            self.assertEqual(question_snapshot(self.exam)[0]["figure"]["key"], self.figure.key)
            bank = self.client.post("/api/question-bank/", question_data(
                figure=self.figure.key, figure_alt="Route"), format="json")
            self.assertEqual(bank.status_code, 201)
            edited = self.client.patch(f"/api/exams/{self.exam.pk}/", {"questions": [question_data(
                figure=self.figure.key, figure_alt="Changed route")]}, format="json")
            self.assertEqual(edited.status_code, 200)
            self.assertEqual(edited.data["questions"][0]["figure_alt"], "Changed route")
            preview = self.client.post(f"/api/exams/{self.exam.pk}/previews/", {"mode": "unrestricted"}, format="json")
            self.assertEqual(preview.status_code, 201)
            started = self.client.post(f"/api/exams/{self.exam.pk}/start/")
            self.assertEqual(started.status_code, 200)
            attempt_id = started.data["id"]
            submitted = self.client.post(f"/api/attempts/{attempt_id}/", {"answers": {}, "answer_revision": 0}, format="json")
            self.assertEqual(submitted.status_code, 200)
            for url in (f"/api/attempts/{attempt_id}/", f"/api/results/{attempt_id}/review/",
                        f"/api/attempts/{attempt_id}/inspection/"):
                self.assertEqual(self.client.get(url).status_code, 200)
        self.assert_no_blob_selects(queries)

    def test_serving_loads_bytes_explicitly_only_for_uncached_responses(self):
        self.client.force_authenticate(self.learner)
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(any('"training_questionfigure"."data"' in q["sql"] for q in queries))
        with CaptureQueriesContext(connection) as queries:
            cached = self.client.get(self.url, HTTP_IF_NONE_MATCH=response["ETag"])
        self.assertEqual(cached.status_code, 304)
        self.assert_no_blob_selects(queries)

    def test_alt_text_accepts_2000_characters_and_rejects_2001(self):
        for cls in (QuestionSerializer, BankQuestionSerializer):
            with self.subTest(serializer=cls.__name__):
                for length in (1000, 2000, 2001):
                    serializer = cls(data=question_data(figure=self.figure.key, figure_alt="x" * length))
                    self.assertEqual(serializer.is_valid(), length <= 2000, serializer.errors)
                    if length <= 2000:
                        obj = serializer.save(**({"exam": self.exam} if cls == QuestionSerializer else {"owner": self.admin}))
                        self.assertEqual(len(obj.figure_alt), length)
                    else:
                        self.assertIn("figure_alt", serializer.errors)

    def test_model_relationships_protect_figures(self):
        from django.db.models.deletion import Collector
        with self.assertRaises(ProtectedError):
            Collector(using="default").collect([self.figure])
        self.question.delete()
        self.assertTrue(QuestionFigure.objects.filter(pk=self.figure.pk).exists())


class ExamBundleTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("bundle-owner", email="owner@corp.example.com", role="instructor")
        self.bundle = {"format": "exam-bundle/1", "exam": {"title": "Synthetic bundle", "audience": "invitation",
                       "questions_per_attempt": 2},
            "figures": {"topology": {"data": base64.b64encode(image_bytes()).decode()}},
            "questions": [question_data(figure="topology", figure_alt="Routes", figure_caption="Map", position=20),
                          question_data(description="Second synthetic question", figure="topology", figure_alt="Routes", points=20, position=0)]}

    def run_bundle(self, bundle=None, **options):
        output = io.StringIO()
        with patch("sys.stdin", io.StringIO(json.dumps(self.bundle if bundle is None else bundle))):
            call_command("import_exam_bundle", "-", owner=self.owner.email, stdout=output, **options)
        return output.getvalue()

    def assert_empty(self):
        for model in (Exam, Question, QuestionFigure, AuditEvent):
            self.assertEqual(model.objects.count(), 0, model.__name__)

    def test_course_audience_bundle_import_without_member_lists(self):
        self.bundle['exam']['audience'] = 'course'
        self.run_bundle()
        exam = Exam.objects.get()
        self.assertEqual(exam.audience, 'course')
        self.assertFalse(exam.published)
        self.assertFalse(exam.courses.exists())

    def test_create_ordered_unpublished_exam_shared_figures_and_audit(self):
        output = self.run_bundle()
        exam = Exam.objects.get()
        self.assertFalse(exam.published)
        self.assertIsNone(exam.course)
        self.assertEqual(exam.owner, self.owner)
        self.assertEqual(exam.audience, "invitation")
        questions = list(exam.questions.all())
        self.assertEqual([q.description for q in questions], [q["description"] for q in self.bundle["questions"]])
        self.assertEqual([q.position for q in questions], [0, 1])
        self.assertEqual(questions[0].figure_id, questions[1].figure_id)
        self.assertEqual(QuestionFigure.objects.count(), 1)
        event = AuditEvent.objects.get(action="exam.import")
        self.assertEqual(event.actor, self.owner)
        self.assertEqual(event.detail, {"source": "bundle", "questions": 2})
        self.assertEqual(event.target, str(exam.pk))
        for value in (f"Exam id: {exam.pk}", "questions: 2", "total points: 30", "figures: 1"):
            self.assertIn(value, output)
        self.assertNotIn("synthetic question", output)
        self.assertNotIn(self.bundle["figures"]["topology"]["data"], output)

    def test_import_preserves_essay_guide_and_long_alt_and_clears_nonessay_guide(self):
        guide = "Award points for the route and explanation.\nAccept equivalent reasoning."
        self.bundle["questions"][0].update(type="essay", options=[], solution=[],
                                           grading_guide=guide, figure_alt="x" * 2000)
        self.bundle["questions"][1]["grading_guide"] = "Not an essay"
        output = self.run_bundle()
        first, second = Exam.objects.get().questions.all()
        self.assertEqual(first.grading_guide, guide)
        self.assertEqual(len(first.figure_alt), 2000)
        self.assertEqual(second.grading_guide, "")
        self.assertNotIn(guide, output)

    def test_import_rejects_overlong_guide_atomically(self):
        self.bundle["questions"][0].update(type="essay", options=[], solution=[], grading_guide="x" * 5001)
        with self.assertRaises(CommandError):
            self.run_bundle()
        self.assert_empty()

    def test_second_run_is_noop(self):
        self.run_bundle()
        before = (Exam.objects.count(), Question.objects.count(), QuestionFigure.objects.count(), AuditEvent.objects.count())
        self.assertIn("Nothing was changed", self.run_bundle())
        self.assertEqual(before, (Exam.objects.count(), Question.objects.count(), QuestionFigure.objects.count(), AuditEvent.objects.count()))

    def test_repeated_title_uses_api_whitespace_normalization(self):
        self.bundle["exam"]["title"] = "  Synthetic bundle  "
        self.run_bundle()
        self.assertIn("Nothing was changed", self.run_bundle())
        self.assertEqual(Exam.objects.count(), 1)

    def test_dry_run_validates_then_rolls_back(self):
        self.assertIn("Dry run", self.run_bundle(dry_run=True))
        self.assert_empty()

    def test_invalid_last_question_rolls_back_figures_and_exam(self):
        self.bundle["questions"][-1]["solution"] = [9]
        for dry_run in (False, True):
            with self.assertRaises(CommandError):
                self.run_bundle(dry_run=dry_run)
            self.assert_empty()

    def test_exam_unknown_published_and_list_audiences_rejected(self):
        for change in ({"published": False}, {"unknown": 1}, {"course": 1}, {"allowed_users": []},
                       {"audience": "people"}, {"audience": "groups"}, {"audience": "departments"},
                       {"audience": "invalid"}, {"duration_minutes": 0}):
            with self.subTest(change=change):
                bundle = deepcopy(self.bundle)
                bundle["exam"].update(change)
                with self.assertRaises(CommandError):
                    self.run_bundle(bundle)
                self.assert_empty()

    def test_figure_and_question_errors_are_atomic(self):
        for change in ({"unknown": True}, {"figure": "missing"}, {"figure": {}}, {"figure_alt": ""},
                       {"figure_caption": "x" * 301}, {"figure_alt": "x" * 2001}):
            with self.subTest(change=change):
                bundle = deepcopy(self.bundle)
                bundle["questions"][-1].update(change)
                with self.assertRaises(CommandError):
                    self.run_bundle(bundle)
                self.assert_empty()
        for encoded in ("not base64!", base64.b64encode(b"garbage").decode()):
            self.bundle["figures"]["bad"] = {"data": encoded}
            with self.assertRaises(CommandError):
                self.run_bundle()
            self.assert_empty()

    def test_owner_must_be_active_editor(self):
        for role, active in (("learner", True), ("instructor", False)):
            self.owner.role, self.owner.is_active = role, active
            self.owner.save()
            with self.assertRaises(CommandError):
                self.run_bundle()
            self.assert_empty()

    def test_file_path_and_username_owner(self):
        # Keep temporary artifacts inside this checkout.
        with TemporaryDirectory(dir=Path(__file__).resolve().parents[2]) as directory:
            source = Path(directory) / "bundle.json"
            source.write_text(json.dumps(self.bundle))
            call_command("import_exam_bundle", str(source), owner=self.owner.username, stdout=io.StringIO())
        self.assertEqual(Exam.objects.count(), 1)
