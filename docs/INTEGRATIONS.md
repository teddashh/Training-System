# Upstream integrations and migration

The [upstream feature audit](UPSTREAM-AUDIT.md) records the pinned source, active implementation, regression evidence and gaps for all four reference repositories. Full feature parity has not been achieved. The limitations below describe the current application; they do not remove the remaining workflows from the implementation plan.

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

Yaksh's native YAML export can be converted to a JSON array with `list(yaml.safe_load_all(...))` in a controlled environment with PyYAML. Do not use unsafe YAML loading or execute legacy HookTestCase code. The adapter accepts `mcq`, `mcc`, `string`, `integer`, `float` and `arrange` with whole-number points, strips HTML display tags and validates all questions before creating the entire draft atomically. Unsupported types and fractional points fail the import. Attachments, users, courses and historical results require a separate mapped migration. Do not attach a legacy database directly to the new app.

String testcases preserve their `correct` text, including spaces, line breaks and literal angle brackets. Each requires an explicit `string_check` of `lower` or `exact`; missing/unsupported modes reject the import. Multiple alternatives may use different modes. See [text matching semantics](OPERATIONS.md#text-answer-matching). Example: `{"type":"string","description":"Release phrase","testcase":[{"correct":"Release\nReady","string_check":"exact"},{"correct":"Approved","string_check":"lower"}]}`.

Integer testcases provide alternative `correct` values. Float testcases provide a `correct` value and an individual `error_margin`; an absent or null margin becomes zero. Use strings to preserve exact decimal values through JSON conversion. The active numeric limits and grading rules are documented in [training operations](OPERATIONS.md#integer-numeric-and-ordering-questions).

```json
[
  {
    "type": "integer", "description": "Enter the batch count", "points": 5,
    "testcase": [{"correct": "42"}, {"correct": "43"}]
  },
  {
    "type": "float", "description": "Enter an allowed calibration value", "points": 10,
    "testcase": [
      {"correct": "12.5", "error_margin": "0.05"},
      {"correct": "-12.5", "error_margin": "0.01"}
    ]
  },
  {
    "type": "arrange", "description": "Order the safety procedure", "points": 10,
    "testcase": [{"options": "Maintain"}, {"options": "Isolate"}, {"options": "Verify"}],
    "correct_order": [1, 2, 0]
  }
]
```

Yaksh grades arrange answers by testcase ID order, but its native export omits those IDs and does not guarantee the testcase list order. An operator must review the original answer and add `correct_order` indexes referring to the supplied testcase array. The adapter refuses arrange records without that metadata. Review the resulting draft before publishing. Native YAML/ZIP round-trip and the remaining question evaluators are still incomplete.

## dhodges47 / SCORM-LearningManagementSystem

Source commit: `87a57d9702aa5d9f3befb22b55444d026ba3be51`.

The original `OutermostLMSV5.js` and MIT license remain in `vendor/scorm-reference/`. The modern runtime adapts its SCORM 1.2 `API` and SCORM 2004 `API_1484_11` initialize/get/set/commit/finish surface. Progress messages cross to the authenticated parent origin, which writes to Django. The old .NET Core 2.1/SQL Server application is not deployed.

The new integration adds ZIP path and expansion limits, signed launch tickets, package-scoped content cookies and an isolated content origin. Synchronous SCORM Commit accepts an in-memory buffer; the workspace reports a durable save only after server acknowledgement. Failure remains visible and sets a runtime general exception. Automatic commits run every 15 seconds. This is a single-SCO subset without full sequencing or complete SCORM data-model validation.

## dmmat / Scormly

Source commit: `53c35d2753e89db5f58f07de4d6164be14359fce`.

All 288 tracked upstream files are retained in `vendor/scormly/`, built under `/studio/`, with company integration changes recorded in the audit. `buildScormZip` and `PublishLms` send the selected SCORM 1.2 or 2004 package and editable project ZIP to a manageable course using the signed-in session and CSRF protection. Backups are restricted to the owning instructor/administrator, and older package files are retained. Source retention does not certify every block, storage backend or export workflow inside the company LMS.

To restore editing, download the source project from the course card and open it in Scormly with **Open a project (.zip)**. This is not simultaneous collaborative editing or continuous server synchronization. Projects can still live in a local folder, browser storage or the tab; **Publish to LMS** explicitly uploads content and the editable backup to the company server.

The platform and studio use the same English, Traditional Chinese and Spanish catalog. Existing upstream Ukrainian dictionaries are retained in source, while the company language picker exposes the three requested languages. Exported player text now includes Traditional Chinese, and automatic player language selection can use the LMS preference. Author-written content is preserved.

Scormly builds, upstream unit tests, locale coverage and browser checks for publication, isolated playback/save/resume in both SCORM versions, rich-text sanitation and language continuity run in CI. Imported/pasted HTML is sanitized before insertion into the authenticated editor; published packages run on the isolated origin. A separate audit check ensures feature evidence and retained-source inventories stay current; it is not a completeness certification.

## Visual references

[School-Management-Dashboard](https://github.com/MariemMagdi/School-Management-Dashboard/tree/d249f7d7d3bfac7a652d3f54f5ed19d7b9bfe248) informed the card, chart and table information structure. Its README claims MIT, but the referenced license file is absent at this revision; its code and images were not copied. The audit reviews its database, role pages, calendars, forms and actions, including incomplete writes and static charts. Company equivalents for supervisors, cohorts, attendance, schedules and announcements remain implementation work.

[Evitina](https://www.evitina.tw/) informed dark surfaces, teal accents and geometric visual motifs. The enterprise interface is an original implementation combining these cues with Azure blue. Its CSS/template and logo assets were not copied.
