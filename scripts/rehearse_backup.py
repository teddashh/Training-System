#!/usr/bin/env python3
"""Rehearse database/media recovery using disposable synthetic Compose projects."""

import contextlib
from pathlib import Path
import subprocess
import tempfile
import uuid

from backup import backup, compose, restore, run


def main():
    source = "training-backup-test-" + uuid.uuid4().hex[:8]
    target = source + "-restored"
    projects = [source, target]
    with tempfile.TemporaryDirectory(prefix="training-backup-test-") as temporary:
        folder = Path(temporary) / "snapshot"
        try:
            run(compose(source) + ["build", "api"])
            run(compose(source) + ["up", "-d", "--wait", "api"])
            fixture = (
                "from pathlib import Path; from django.conf import settings; "
                "from training.models import User, Course, LearningAssignment; "
                "u=User.objects.create_user('backup-fixture',role='admin'); "
                "c=Course.objects.create(owner=u,title='Restore verification',published=True); "
                "LearningAssignment.objects.create(user=u,course=c,created_by=u); "
                "p=Path(settings.MEDIA_ROOT)/'recovery-fixture.txt'; p.write_text('Synthetic course content')"
            )
            run(
                compose(source)
                + ["exec", "-T", "api", "python", "manage.py", "shell", "-c", fixture]
            )
            backup(folder, source)
            restore(folder, target)
            verification = (
                "from pathlib import Path; from django.conf import settings; "
                "from training.models import User, Course, LearningAssignment; "
                "assert User.objects.filter(username='backup-fixture',role='admin').count()==1; "
                "assert Course.objects.filter(title='Restore verification').count()==1; "
                "assert LearningAssignment.objects.count()==1; "
                "assert (Path(settings.MEDIA_ROOT)/'recovery-fixture.txt').read_text()=='Synthetic course content'"
            )
            run(
                compose(target)
                + [
                    "run",
                    "--rm",
                    "--no-deps",
                    "-T",
                    "api",
                    "python",
                    "manage.py",
                    "shell",
                    "-c",
                    verification,
                ]
            )
            # A repeated restore must refuse to overwrite the existing destination.
            try:
                restore(folder, target)
            except ValueError as exc:
                if "Destination project already" not in str(exc):
                    raise
            else:
                raise AssertionError("Restore did not protect the existing project")
            running = run(
                compose(source) + ["ps", "--services", "--status", "running"],
                capture_output=True,
                text=True,
            ).stdout.splitlines()
            if "api" not in running:
                raise AssertionError("Backup did not restart the source API")
            print(
                "Backup rehearsal passed: database, assignment and media restored; source restarted; existing destination protected."
            )
        finally:
            for project in projects:
                with contextlib.suppress(subprocess.CalledProcessError):
                    run(compose(project) + ["down", "--volumes", "--remove-orphans"])


if __name__ == "__main__":
    main()
