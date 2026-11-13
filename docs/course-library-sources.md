# Build the starter course library

The general library contains original introductory scenarios, questions and feedback. Import it as drafts. Review the lessons against your organization's procedures before publishing.

## Choose the collection

The `original` collection combines three source files:

| Source | Courses | Scenario lessons | Topics |
| --- | ---: | ---: | --- |
| [awareness.txt](../content-library/awareness.txt) | 15 | 108 | Security, AI, privacy and governance |
| [developer.txt](../content-library/developer.txt) | 40 | 40 | Git, APIs and secure web development |
| [workplace.txt](../content-library/workplace.txt) | 5 | 15 | Microsoft 365, collaboration and workplace skills |
| Total | 60 | 163 | Original collection |

The build also creates 20 unpublished exam templates. Each starts with two attempts per round, a 24-hour reset after a fully graded failed round, a 15-minute duration and an 80% passing score. Managers can change those settings.

Each course includes formative questions and feedback, a SCORM 2004 single-SCO package and an editable Studio backup. Scenario counts exclude the final knowledge-check lesson. The general collection contains no deployment-specific operating procedures.

## Review sources and rights

RansomLeak public topic directories informed coverage only. The library does not redistribute their lesson bodies, question banks, simulations, images, audio or executable packages. It is independently authored introductory content. Do not treat it as a licensed copy of those courses.

Further-reading links are defined in [build_original_library.py](../scripts/build_original_library.py): CISA Secure Our World, OWASP cheat sheets, Microsoft training, NIST Cybersecurity Framework and European Commission AI/data-protection pages. They are references, not copied passages or endorsements.

The generated player retains Scormly's MIT license in `PLAYER-LICENSE.txt`. `NOTICE.txt` records curriculum provenance. New repository content follows [LICENSE](../LICENSE); upstream source and brand artwork retain their own terms. See [Third-party notices](../THIRD_PARTY_NOTICES.md).

## Build with the default pack

Run from the repository root with Python 3:

```bash
BRAND=default python3 scripts/build_original_library.py --output /tmp/training-starter
```

The script writes course ZIPs, editable-source ZIPs, `catalog.json`, `exams.json` and `NOTICE.txt`. The catalog records source/output hashes. Fixed ZIP timestamps and sorted entries make the same inputs reproducible. This command does not contact a server or publish anything.

## Import drafts

Sign in as a system administrator. Prepare a protected Playwright storage-state file from that session and keep it outside the repository. It contains authentication cookies. The importer requires private file permissions and the expected administrator's numeric ID.

```bash
python3 scripts/import_original_library.py --help
python3 scripts/import_original_library.py \
  --url https://training.example.com/training \
  --auth /private/admin-state.json \
  --packages /tmp/training-starter \
  --record /private/starter-import.json \
  --expected-admin 1 --expected-courses 60 --expected-exams 20
```

Replace the URL, private paths and administrator ID. Include the mount path in `--url`. This command writes to the target workspace. It creates unpublished courses/exams and sends no assignments or notifications.

Keep the record file. It stores created IDs and lets the importer resume without matching existing courses by title. Reuse the same packages, URL and record for a resumed import. Losing the record can lead to duplicate imports. Do not blindly rerun an import against changed or published records.

Review drafts in **Training** and **Exams**, then publish deliberately. General exam templates are not automatically linked to courses. Use [course assessments](OPERATIONS.md#shared-course-assessments-0025) to attach them when appropriate.
