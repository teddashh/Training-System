# Third-party notices

This repository contains new application code and retained upstream projects. Their licenses remain separate.

| Component | Source / author | Retained terms |
| --- | --- | --- |
| Yaksh / online_test | FOSSEE, IIT Bombay and contributors | Original `legacy/yaksh/LICENSE` retained verbatim with the archived source. The upstream file states BSD and also contains a CC BY-SA 4.0 sentence; this project does not resolve or replace that upstream wording. |
| Scormly | Dmytro Matsiuk / dmmat and contributors | MIT; `vendor/scormly/LICENSE` |
| SCORM-LearningManagementSystem / OutermostLMSV5.js | David Hodges, Outermost Software | MIT; `vendor/scorm-reference/LICENSE.txt` |

New code outside `legacy/` and `vendor/` is licensed under the BSD 3-Clause license in `LICENSE`. Adaptations in `vendor/scormly/` remain under its MIT license. The new SCORM runtime acknowledges David Hodges in its header and retains the original MIT notice in this repository.

`shared/locales/messages.json` includes translations of Scormly interface text. Those derived entries retain Scormly's MIT terms and attribution in `vendor/scormly/LICENSE` alongside the original platform messages.

School-Management-Dashboard and evitina.tw are visual references only; their source code, CSS, logos, and screenshots were not redistributed. Application screenshots in `docs/screenshots/` are generated from this implementation with synthetic data.

Brand packs use local system font stacks. Sign-in PDFs embed Noto Sans TC; its SIL Open Font License is retained in [backend/training/fonts/OFL.txt](backend/training/fonts/OFL.txt). Logo artwork rights and any pack-specific license notes belong in each pack’s README; they do not inherit the application code license. Dependency license information is maintained in each package's metadata and the committed lockfiles.

## Course cover illustrations

The 100 legacy cover assets are original topic-neutral geometric artwork in the
original palette. They contain no logo, painted topic text or topic icons. The UI
overlays the selected organization logo and each course's title separately.
Regenerate using `node frontend/generate-covers.mjs`; stable legacy
asset IDs live in `shared/brand/cover-topics.txt`, while the picker groups the artwork
by visual style. See the selected brand pack’s README for logo rights.
Starter training sources and retained license requirements are documented in
[the starter library guide](docs/course-library-sources.md); course ZIPs are not included in this repository.

`content-library/` contains independently authored scenarios, instructional text
and questions. RansomLeak public topic directories were consulted for coverage;
none of their course packages, lesson bodies, artwork, audio or question banks are
redistributed. Generated packages use the retained MIT Scormly player and include
its license. These are original introductory courses, not licensed copies of the
RansomLeak simulations.
