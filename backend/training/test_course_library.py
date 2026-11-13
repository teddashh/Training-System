import io
import json
import zipfile
from contextlib import chdir
from pathlib import Path
from tempfile import TemporaryDirectory
from django.test import TestCase, override_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient
from .models import Course, Enrollment, ScormPackage, User
from .scorm_progress import progress_percent


def pptx():
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as z:
        z.writestr(
            "ppt/presentation.xml",
            '<p:presentation xmlns:p="urn:example" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId r:id="r2"/><p:sldId r:id="r1"/></p:sldIdLst></p:presentation>',
        )
        z.writestr(
            "ppt/_rels/presentation.xml.rels",
            '<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/><Relationship Id="r2" Target="slides/slide2.xml"/></Relationships>',
        )
        for n, text in [(1, "Second slide"), (2, "First slide")]:
            z.writestr(
                f"ppt/slides/slide{n}.xml",
                f'<slide xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>{text}</a:t></a:r></a:p></slide>',
            )
    return data.getvalue()


@override_settings(DEBUG=True)
class CourseLibraryTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user("library-admin", role="admin")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_cover_catalog_roundtrip_and_unknown_cover_rejected(self):
        response = self.client.post(
            "/api/courses/",
            {"title": "Safety", "cover": "ladder-safety"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        url = f"/api/courses/{response.data['id']}/"
        self.assertEqual(self.client.get(url).data["cover"], "ladder-safety")
        self.assertEqual(
            self.client.patch(url, {"cover": "../../other"}, format="json").status_code,
            400,
        )

    def test_scene_cover_roundtrip(self):
        response = self.client.post(
            "/api/courses/",
            {"title": "Plant training", "cover": "scene-plant-skyline"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        url = f"/api/courses/{response.data['id']}/"
        self.assertEqual(self.client.get(url).data["cover"], "scene-plant-skyline")
        response = self.client.patch(url, {"cover": "scene-learning-classroom"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.client.get(url).data["cover"], "scene-learning-classroom")

    def test_real_progress_monotonic_separate_from_scores_and_completion(self):
        course = Course.objects.create(title="Course", owner=self.admin, published=True)
        package = ScormPackage.objects.create(
            course=course, title="Content", version="2004", launch_path="index.html"
        )
        launch = self.client.post(
            f"/api/scorm/{package.id}/launch/", {}, format="json"
        ).data

        def commit(cmi):
            return self.client.post(
                f"/api/scorm/{package.id}/commit/",
                {"nonce": launch["nonce"], "cmi": cmi},
                format="json",
            ).data

        unknown = commit({"cmi.score.raw": "90", "cmi.completion_status": "incomplete"})
        self.assertFalse(unknown["progress_known"])
        self.assertFalse(unknown["completed"])
        self.assertEqual(commit({"cmi.progress_measure": ".35"})["progress"], 35)
        self.assertEqual(commit({"cmi.progress_measure": ".1"})["progress"], 35)
        self.assertEqual(commit({"cmi.progress_measure": "1"})["progress"], 99)
        self.assertFalse(Enrollment.objects.get(course=course).completed_at)
        self.assertEqual(
            commit({"cmi.completion_status": "completed"})["progress"], 100
        )
        self.assertEqual(commit({"cmi.progress_measure": ".2"})["progress"], 100)

    def test_invalid_measures_are_unknown_and_not_exam_scores(self):
        for value in ["", "NaN", "Infinity", "-1", "1.5", "not a number"]:
            self.assertIsNone(progress_percent({"cmi.progress_measure": value}))
        self.assertIsNone(progress_percent({"cmi.core.score.raw": "98"}))
        self.assertEqual(progress_percent({"cmi.progress_measure": "0.125"}), 13)

    def test_pptx_uses_presentation_order_and_requires_author_role(self):
        # Production and management commands may start outside the backend directory.
        with TemporaryDirectory() as directory, chdir(directory):
            response = self.client.post(
                "/api/documents/convert/",
                {"file": SimpleUploadedFile("slides.pptx", pptx())},
                format="multipart",
            )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            [p["text"] for p in response.data["pages"]], ["First slide", "Second slide"]
        )
        learner = User.objects.create_user("reader")
        self.client.force_authenticate(learner)
        self.assertEqual(
            self.client.post(
                "/api/documents/convert/",
                {"file": SimpleUploadedFile("slides.pptx", pptx())},
                format="multipart",
            ).status_code,
            403,
        )

    def test_document_errors_are_actionable_and_no_silent_blank_course(self):
        for filename, data in [("bad.pdf", b"not a PDF"), ("slides.ppt", pptx())]:
            response = self.client.post(
                "/api/documents/convert/",
                {"file": SimpleUploadedFile(filename, data)},
                format="multipart",
            )
            self.assertEqual(response.status_code, 400, response.data)

    def test_pdf_text_keeps_page_numbers_and_rejects_scanned_only_document(self):
        from pypdf import PdfWriter
        from pypdf.generic import NameObject, DictionaryObject, DecodedStreamObject

        writer = PdfWriter()
        page = writer.add_blank_page(612, 792)
        font = DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"),
                NameObject("/BaseFont"): NameObject("/Helvetica"),
            }
        )
        page[NameObject("/Resources")] = DictionaryObject(
            {
                NameObject("/Font"): DictionaryObject(
                    {NameObject("/F1"): writer._add_object(font)}
                )
            }
        )
        stream = DecodedStreamObject()
        stream.set_data(b"BT /F1 12 Tf 50 700 Td (Document source text) Tj ET")
        page[NameObject("/Contents")] = writer._add_object(stream)
        writer.add_blank_page(612, 792)
        output = io.BytesIO()
        writer.write(output)
        response = self.client.post(
            "/api/documents/convert/",
            {"file": SimpleUploadedFile("training.pdf", output.getvalue())},
            format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            response.data["pages"], [{"number": 1, "text": "Document source text"}]
        )
        self.assertEqual(response.data["skipped_pages"], [2])
        writer = PdfWriter()
        writer.add_blank_page(612, 792)
        output = io.BytesIO()
        writer.write(output)
        response = self.client.post(
            "/api/documents/convert/",
            {"file": SimpleUploadedFile("scan.pdf", output.getvalue())},
            format="multipart",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("OCR", str(response.data))
