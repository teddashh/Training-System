# Upstream integrations and migration

## FOSSEE / online_test (Yaksh)

Source commit: `336fc050cce6eab6d45475297d19f3b659491d48`.

The repository retains Yaksh Git history and its original tree in `legacy/yaksh/`. The new enterprise model builds on question, quiz, question-paper, answer-paper and grading concepts, with optional course association and stable identities, attempt budgets and invitations. The archived Django 3.1 application and code-server are not started by the supported deployment; compatibility with all legacy APIs is not claimed.

Example `questions.json` for migration:

```json
[
  {
    "summary": "Security",
    "type": "mcq",
    "description": "What should you do with a suspicious email?",
    "points": 10,
    "testcase": [
      {"test_case_type": "mcqtestcase", "options": "Report it to IT", "correct": true},
      {"test_case_type": "mcqtestcase", "options": "Send your password", "correct": false}
    ]
  }
]
```

```bash
DEBUG=true .venv/bin/python backend/manage.py import_yaksh questions.json \
  --owner demo.admin --title 'Legacy question-bank review'
```

Yaksh's native YAML export can be converted to a JSON array with `list(yaml.safe_load_all(...))` in a controlled environment with PyYAML. Do not use unsafe YAML loading or execute legacy HookTestCase code. The adapter accepts `mcq`/`mcc` with integer points, strips HTML display tags and validates options/solutions before creating the entire draft. Other question types, attachments, users, courses and historical results require a separate mapped migration. Do not attach a legacy database directly to the new app.

## dhodges47 / SCORM-LearningManagementSystem

Source commit: `87a57d9702aa5d9f3befb22b55444d026ba3be51`.

The original `OutermostLMSV5.js` and MIT license remain in `vendor/scorm-reference/`. The modern runtime adapts its SCORM 1.2 `API` and SCORM 2004 `API_1484_11` initialize/get/set/commit/finish surface. Progress messages cross to the authenticated parent origin, which writes to Django. The old .NET Core 2.1/SQL Server application is not deployed.

The new integration adds ZIP path and expansion limits, signed launch tickets, package-scoped content cookies and an isolated content origin. Synchronous SCORM Commit accepts an in-memory buffer; the workspace reports a durable save only after server acknowledgement. Failure remains visible and sets a runtime general exception. Automatic commits run every 15 seconds. This is a single-SCO subset without full sequencing or complete SCORM data-model validation.

## dmmat / Scormly

Source commit: `53c35d2753e89db5f58f07de4d6164be14359fce`.

The complete MIT source is in `vendor/scormly/`, built under `/studio/`. `buildScormZip` and `PublishLms` send a SCORM 1.2 package and editable project ZIP to a selected course using the signed-in session and CSRF protection. Backups are restricted to the owning instructor/administrator, and older package files are retained.

To restore editing, download the source project from the course card and open it in Scormly with **Open a project (.zip)**. This is not simultaneous collaborative editing or continuous server synchronization. Projects can still live in a local folder, browser storage or the tab; **Publish to LMS** explicitly uploads content and the editable backup to the company server.

The platform and studio use the same English, Traditional Chinese and Spanish catalog. Existing upstream Ukrainian dictionaries are retained in source, while the company language picker exposes the three requested languages. Exported player text now includes Traditional Chinese, and automatic player language selection can use the LMS preference. Author-written content is preserved.

Scormly builds, upstream unit tests, locale coverage and browser checks for publication, rich-text sanitation and language continuity run in CI. Imported/pasted HTML is sanitized before insertion into the authenticated editor; published packages run on the isolated origin.

## Visual references

[School-Management-Dashboard](https://github.com/MariemMagdi/School-Management-Dashboard) informed the card, chart and table information structure. Its repository did not provide an explicit license, so its code and images were not copied.

[Evitina](https://www.evitina.tw/) informed dark surfaces, teal accents and geometric visual motifs. The enterprise interface is an original implementation combining these cues with Azure blue. Its CSS/template and logo assets were not copied.
