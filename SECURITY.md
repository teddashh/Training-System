# Security scope

The supported runtime is `backend/`, `frontend/`, the integrated `vendor/scormly/`, and the Compose deployment. CI audits the exact active Python lockfile and both JavaScript lockfiles, in addition to authentication, authorization, attempt-budget and browser tests.

`legacy/yaksh/` is an **unsupported archival source tree**, retained byte-for-byte from the upstream commit for migration and attribution. Its old Python and browser dependencies have known vulnerabilities. GitHub Dependabot scans those manifests and will report them. Do not install or deploy those legacy requirements. They are excluded from Docker build contexts and are not dependencies of the modern API. `vendor/scorm-reference/` is a source reference, not an executable service.

The integrated Scormly editor sanitizes rich HTML with DOMPurify before inserting imported content or clipboard HTML into the authenticated authoring page. Only rich-text elements are allowed; executable elements, event handlers and unsafe URL schemes are removed. A browser regression test covers project ZIP import, preview and paste. Published SCORM packages still execute only on the isolated content origin; arbitrary uploaded SCOs must never be hosted on the application origin.

On 2026-11-06, auditing the initial active lockfile identified five advisories against Django REST framework 3.16.1. The active dependency was upgraded to 3.18.3, which includes the relevant upstream fixes. See the [DRF release notes](https://www.django-rest-framework.org/community/release-notes/#3183). This note deliberately distinguishes archived findings from the current deployment; archived alerts have not been dismissed or hidden.

No automated test or dependency audit is a complete security certification. Before using employee data, configure HTTPS, Entra/SMTP, least-privilege infrastructure access, backups, audit retention and company acceptance testing as described in `docs/DEPLOYMENT.md`.

For a suspected vulnerability, use GitHub private vulnerability reporting when available, or contact the repository owner privately. Do not publish live credentials, invite links, employee records or exploitable details in a public issue.
