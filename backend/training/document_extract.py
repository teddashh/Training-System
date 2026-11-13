"""Bounded, text-only document reader, executed in a short-lived subprocess."""

import json
import posixpath
import sys
import zipfile
from pathlib import Path
from defusedxml import ElementTree as ET

MAX_PAGES = 50
MAX_TEXT = 500000


def extract(path):
    path = Path(path)
    pages = []
    if path.suffix == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(path)
        if reader.is_encrypted:
            raise ValueError("Use a PDF without a password.")
        if len(reader.pages) > MAX_PAGES:
            raise ValueError("Import at most 50 pages or slides at a time.")
        for page in reader.pages:
            contents = page.get_contents()
            if contents is not None and len(contents.get_data()) > 10_000_000:
                raise ValueError("A PDF page is too complex to import.")
            pages.append(page.extract_text() or "")
    elif path.suffix == ".pptx":
        with zipfile.ZipFile(path) as archive:
            if (
                len(archive.infolist()) > 5000
                or sum(i.file_size for i in archive.infolist()) > 150_000_000
            ):
                raise ValueError("The presentation is too large to import.")

            def xml(name):
                if archive.getinfo(name).file_size > 5_000_000:
                    raise ValueError("A presentation page is too large to import.")
                return ET.fromstring(archive.read(name))

            rels = {
                r.attrib["Id"]: r.attrib.get("Target", "")
                for r in xml("ppt/_rels/presentation.xml.rels")
                if r.attrib.get("TargetMode") != "External"
            }
            slides = xml("ppt/presentation.xml").findall(".//{*}sldId")
            if len(slides) > MAX_PAGES:
                raise ValueError("Import at most 50 pages or slides at a time.")
            for slide in slides:
                rid = slide.attrib.get(
                    "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
                )
                name = posixpath.normpath(posixpath.join("ppt", rels.get(rid, "")))
                if not name.startswith("ppt/slides/") or not name.endswith(".xml"):
                    raise ValueError("The presentation has an invalid slide reference.")
                root = xml(name)
                pages.append(
                    "\n".join(
                        "".join(p.itertext())
                        for p in root.findall(
                            ".//{http://schemas.openxmlformats.org/drawingml/2006/main}p"
                        )
                    )
                )
    else:
        raise ValueError("Choose a PDF or PPTX file.")
    if sum(len(p) for p in pages) > MAX_TEXT or any(len(p) > 20000 for p in pages):
        raise ValueError(
            "The document contains too much text. Split it into smaller files."
        )
    if not any(p.strip() for p in pages):
        raise ValueError("No readable text found. Scanned PDFs need OCR before import.")
    return {
        "pages": [
            {"number": i + 1, "text": text.strip()}
            for i, text in enumerate(pages)
            if text.strip()
        ],
        "page_count": len(pages),
        "skipped_pages": [i + 1 for i, text in enumerate(pages) if not text.strip()],
    }


if __name__ == "__main__":
    import resource

    resource.setrlimit(resource.RLIMIT_AS, (1_000_000_000, 1_000_000_000))
    resource.setrlimit(resource.RLIMIT_CPU, (20, 20))
    try:
        print(json.dumps(extract(sys.argv[1])))
    except Exception as error:
        print(
            json.dumps(
                {
                    "error": str(error)
                    if isinstance(error, ValueError)
                    else "The document could not be read. Export it again as PDF or PPTX."
                }
            )
        )
        sys.exit(1)
