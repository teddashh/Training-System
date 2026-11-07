#!/usr/bin/env python3
"""Consistent Compose backups and restoration into a NEW, isolated project.

Database dumps contain executable SQL: restore only archives from trusted operators.
The environment file and Entra/SMTP secrets are deliberately excluded.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
SERVICES = ["web", "scheduler", "api", "content"]


def run(args, **kwargs):
    return subprocess.run(args, cwd=ROOT, check=True, **kwargs)


def compose(project=None):
    args = ["docker", "compose"]
    if project:
        args += ["--project-name", project]
    return args


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def verify(folder):
    manifest = json.loads((folder / "manifest.json").read_text())
    if manifest.get("format") != 1 or set(manifest.get("files", {})) != {
        "database.dump",
        "media.tar.gz",
    }:
        raise ValueError("Unsupported or incomplete backup manifest")
    for filename, expected in manifest["files"].items():
        if digest(folder / filename) != expected:
            raise ValueError(f"Checksum mismatch: {filename}")
    with tarfile.open(folder / "media.tar.gz", "r:gz") as archive:
        for member in archive:
            path = Path(member.name)
            if (
                path.is_absolute()
                or ".." in path.parts
                or not (member.isfile() or member.isdir())
            ):
                raise ValueError(
                    "Media archive contains an unsafe path or unsupported entry"
                )
    return manifest


def backup(folder, project):
    folder.mkdir(mode=0o700, parents=True, exist_ok=False)
    command = compose(project)
    running = run(
        command + ["ps", "--services", "--status", "running"],
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    paused = [service for service in SERVICES if service in running]
    if "db" not in running:
        raise ValueError("The source database must be running")
    try:
        if paused:
            run(command + ["stop", "--timeout", "60", *paused])
        with (folder / "database.dump").open("wb") as output:
            run(
                command
                + [
                    "exec",
                    "-T",
                    "db",
                    "pg_dump",
                    "-U",
                    "training",
                    "-d",
                    "training",
                    "--format=custom",
                    "--no-owner",
                    "--no-acl",
                ],
                stdout=output,
            )
        with (folder / "media.tar.gz").open("wb") as output:
            run(
                command
                + [
                    "run",
                    "--rm",
                    "--no-deps",
                    "-T",
                    "--entrypoint",
                    "tar",
                    "api",
                    "-czf",
                    "-",
                    "-C",
                    "/app/media",
                    ".",
                ],
                stdout=output,
            )
        revision = run(
            ["git", "rev-parse", "HEAD"], capture_output=True, text=True
        ).stdout.strip()
        manifest = {
            "format": 1,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "revision": revision,
            "database": "PostgreSQL 17",
            "files": {
                name: digest(folder / name)
                for name in ("database.dump", "media.tar.gz")
            },
        }
        (folder / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        verify(folder)
    finally:
        if paused:
            run(command + ["start", *paused])
    print(f"Verified backup: {folder}")


def restore(folder, project):
    if not project or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{2,50}", project):
        raise ValueError(
            "Supply a new project name using --project (3–51 lowercase letters, digits, _ or -)"
        )
    manifest = verify(folder)
    # Refuse ALL existing containers/volumes for the destination, including stopped ones.
    for resource in ("container", "volume"):
        existing = run(
            [
                "docker",
                resource,
                "ls",
                "-q",
                "--filter",
                f"label=com.docker.compose.project={project}",
            ],
            capture_output=True,
            text=True,
        ).stdout.strip()
        if existing:
            raise ValueError(
                "Destination project already has containers or volumes. Use a fresh project name."
            )
    for volume in (f"{project}_postgres", f"{project}_media"):
        probe = subprocess.run(
            ["docker", "volume", "inspect", volume],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if probe.returncode == 0:
            raise ValueError(
                "Destination volume already exists. Use a fresh project name."
            )
    command = compose(project)
    print(f"Restoring revision {manifest['revision']} into isolated project {project}")
    run(command + ["up", "-d", "--wait", "db"])
    with (folder / "database.dump").open("rb") as source:
        run(
            command
            + [
                "exec",
                "-T",
                "db",
                "pg_restore",
                "-U",
                "training",
                "-d",
                "training",
                "--no-owner",
                "--no-acl",
                "--exit-on-error",
                "--single-transaction",
            ],
            stdin=source,
        )
    with (folder / "media.tar.gz").open("rb") as source:
        run(
            command
            + [
                "run",
                "--rm",
                "--no-deps",
                "-T",
                "--entrypoint",
                "tar",
                "api",
                "-xzf",
                "-",
                "-C",
                "/app/media",
                "--no-same-owner",
                "--no-same-permissions",
            ],
            stdin=source,
        )
    run(
        command
        + [
            "run",
            "--rm",
            "--no-deps",
            "-T",
            "api",
            "python",
            "manage.py",
            "migrate",
            "--noinput",
        ]
    )
    run(
        command
        + ["run", "--rm", "--no-deps", "-T", "api", "python", "manage.py", "check"]
    )
    print(
        f"Restored into {project}. Web, API, content and scheduler are NOT started. Inspect records and media before routing company traffic."
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["create", "verify", "restore"])
    parser.add_argument("directory", type=Path)
    parser.add_argument(
        "--project",
        help="Source project for create; REQUIRED fresh destination project for restore",
    )
    args = parser.parse_args()
    os.umask(0o077)
    folder = args.directory.expanduser().resolve()
    try:
        if args.action == "create":
            backup(folder, args.project)
        elif args.action == "verify":
            print(json.dumps(verify(folder), indent=2))
        else:
            restore(folder, args.project)
    except (
        OSError,
        ValueError,
        KeyError,
        tarfile.TarError,
        subprocess.CalledProcessError,
    ) as exc:
        print(f"Backup operation failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
