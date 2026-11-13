# Training System

Self-hosted training, course authoring and assessment for an organization.

[繁體中文](docs/README.zh-TW.md) · [Español](docs/README.es.md)

![Training dashboard](docs/screenshots/dashboard.png)

## What you can do

- Learn: take courses, resume SCORM lessons and track required training.
- Author: build lessons in Studio, import document text or upload SCORM packages.
- Run sessions: schedule training, register people and record attendance.
- Assess: create exams, reuse questions and review written answers.
- Report: view completion, exam results and question analysis; export records.
- Administer: manage people, roles, organization settings, sign-in and e-mail.

## Quick start

Install Docker Engine and Compose v2. From the repository root:

```bash
cp .env.example .env
chmod 600 .env
```

Edit `.env`: replace `SECRET_KEY` and `POSTGRES_PASSWORD` with separate random values. Keep `DEBUG=true` for this local trial and set `DEMO_MODE=false`. Leave provider credentials empty.

```bash
docker compose up --build -d --wait
docker compose exec api python manage.py createsuperuser --username training-admin
docker compose exec api python manage.py shell -c "from training.models import User; u=User.objects.get(username='training-admin'); u.role='admin'; u.save(update_fields=['role'])"
```

Enter your administrator e-mail and password at the prompts. The last command grants the platform **Super administrator** role to that account.

Open <http://localhost:8080> and sign in. Open **Settings** in the sidebar, then the **Settings** tab, to set organization name/logo, interface languages, sign-in and e-mail. Save, then use **Send test email to me** if e-mail is enabled.

This is a local trial. Follow [Getting started](docs/GETTING-STARTED.md) for the first workflow and [Deployment](docs/DEPLOYMENT.md) for HTTPS and production setup.

## Make it yours

Set the organization name and upload a logo in Settings. Choose English, Traditional Chinese or Spanish as the allowed interface languages. Authored content keeps its original language.

Choose Microsoft Entra ID, Google Workspace, or local accounts with passwords and e-mail codes. Codes require working e-mail. Choose SMTP server, Microsoft 365 mailbox or Off for e-mail.

Server-configured values show **Set by the server**. Use `BRAND` packs to change colors at build time; see [the brand guide](DESIGN.md#brand-packs).

![Organization settings](docs/screenshots/settings.png)
![Sign-in settings](docs/screenshots/settings-sign-in.png)

## Screens

[Courses](docs/screenshots/courses.png) · [Studio](docs/screenshots/studio.png) · [Sessions](docs/screenshots/sessions.png) · [Exam](docs/screenshots/exam.png) · [Insights](docs/screenshots/insights.png) · [Mobile](docs/screenshots/mobile.png)

## Documentation

| Guide | Use it to |
| --- | --- |
| [Getting started](docs/GETTING-STARTED.md) | Set up the first training workflow |
| [Deployment](docs/DEPLOYMENT.md) | Install, configure, back up and upgrade |
| [Operations](docs/OPERATIONS.md) | Manage people, courses, sessions, exams and reports |
| [Starter library](docs/course-library-sources.md) | Build and import 60 draft courses |
| [Integrations](docs/INTEGRATIONS.md) / [API](docs/SIMPLE-TRAINING-API.md) | Review source integration and API contracts |
| [Security](SECURITY.md) / [Design](DESIGN.md) | Review trust boundaries and brand packs |
| [Upstream audit](docs/UPSTREAM-AUDIT.md) | Check implemented features and remaining gaps |

## Development

Use Python 3.13 and Node.js 24:

```bash
python3.13 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
npm ci --prefix frontend
npm ci --prefix vendor/scormly
DEBUG=true .venv/bin/python backend/manage.py check
python3 scripts/check_upstream_audit.py
```

The [local development guide](docs/DEPLOYMENT.md#develop-locally) covers migrations and service startup. Checks include Django tests, both frontend builds, frontend unit tests and Studio tests. PostgreSQL is needed for concurrency checks; browser workflows need an isolated running test workspace.

## Status and limits

This is a single-organization workspace. Upstream feature parity is incomplete; the audit records the remaining work. Test sign-in, mail, restore and expected load in your deployment.

SCORM supports a single-SCO 1.2/2004 runtime subset, without multi-SCO sequencing or full certification. The LMS does not import cmi5 or provide an xAPI LRS. Exams do not support proctoring, file-upload answers or an isolated programming sandbox. Document import extracts text, without OCR or slide layouts.

## License

New code uses [BSD 3-Clause](LICENSE). Retained upstream source keeps its own license; see [Third-party notices](THIRD_PARTY_NOTICES.md).

[FOSSEE Yaksh](https://github.com/FOSSEE/online_test) provides the retained assessment source and migration foundation.

[Scormly](https://github.com/dmmat/Scormly) provides the integrated course editor and exported player.
