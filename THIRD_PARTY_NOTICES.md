# Third-party notices

This repository contains new enterprise application code and retained upstream projects. Their licenses remain separate.

| Component | Source / author | Retained terms |
| --- | --- | --- |
| Yaksh / online_test | FOSSEE, IIT Bombay and contributors | Original `legacy/yaksh/LICENSE` and Git history retained verbatim. The upstream file states BSD and also contains a CC BY-SA 4.0 sentence; this project does not resolve or replace that upstream wording. |
| Scormly | Dmytro Matsiuk / dmmat and contributors | MIT; `vendor/scormly/LICENSE` |
| SCORM-LearningManagementSystem / OutermostLMSV5.js | David Hodges, Outermost Software | MIT; `vendor/scorm-reference/LICENSE.txt` |

New code outside `legacy/` and `vendor/` is licensed under the BSD 3-Clause license in `LICENSE`. Adaptations in `vendor/scormly/` remain under its MIT license. The new SCORM runtime acknowledges David Hodges in its header and retains the original MIT notice in this repository.

School-Management-Dashboard and evitina.tw are visual references only; their source code, CSS, logos, and screenshots were not redistributed. Application screenshots in `docs/screenshots/` are generated from this implementation with synthetic data.

Fonts are requested from Google Fonts with system fallbacks. For deployments requiring no external font requests, remove the import in `frontend/src/style.css` or serve licensed font files internally. Dependency license information is maintained in each package's metadata and the committed lockfiles.
