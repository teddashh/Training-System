"""Backup validation tests; never contact Docker or a company database."""

import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "training_backup", Path(__file__).with_name("backup.py")
)
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupValidationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.folder = Path(self.directory.name)
        (self.folder / "database.dump").write_bytes(b"synthetic dump")

    def make_archive(self, name="course/index.html", kind=tarfile.REGTYPE):
        with tarfile.open(self.folder / "media.tar.gz", "w:gz") as archive:
            member = tarfile.TarInfo(name)
            member.type = kind
            if kind == tarfile.REGTYPE:
                member.size = 4
                archive.addfile(member, io.BytesIO(b"test"))
            else:
                member.linkname = "/outside"
                archive.addfile(member)
        manifest = {
            "format": 1,
            "files": {
                name: backup.digest(self.folder / name)
                for name in ["database.dump", "media.tar.gz"]
            },
        }
        (self.folder / "manifest.json").write_text(json.dumps(manifest))

    def test_valid_archive_and_corruption_detection(self):
        self.make_archive()
        self.assertEqual(backup.verify(self.folder)["format"], 1)
        (self.folder / "database.dump").write_bytes(b"corrupted")
        with self.assertRaisesRegex(ValueError, "Checksum"):
            backup.verify(self.folder)

    def test_path_traversal_absolute_paths_and_links_are_rejected(self):
        for name, kind in [
            ("../outside", tarfile.REGTYPE),
            ("/outside", tarfile.REGTYPE),
            ("link", tarfile.SYMTYPE),
            ("hardlink", tarfile.LNKTYPE),
        ]:
            with self.subTest(name=name):
                self.make_archive(name, kind)
                with self.assertRaisesRegex(ValueError, "unsafe"):
                    backup.verify(self.folder)

    def test_incomplete_backup_is_rejected(self):
        self.make_archive()
        (self.folder / "manifest.json").write_text('{"format": 1, "files": {}}')
        with self.assertRaisesRegex(ValueError, "incomplete"):
            backup.verify(self.folder)


if __name__ == "__main__":
    unittest.main()
