#!/usr/bin/env python3
"""Validate reviewed upstream evidence and render its human-readable report.

This checks inventory integrity, not feature completeness or test execution.
Use --require-complete to enforce the separate feature-parity acceptance gate.
"""

import argparse
import ast
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import quote
import warnings

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "docs/audit/upstream-features.json"
REPORT = ROOT / "docs/UPSTREAM-AUDIT.md"
STATUSES = {
    "implemented": "Implemented with the cited scope and regression evidence",
    "partial": "Some behavior exists; the assessment describes missing behavior",
    "missing": "No equivalent active workflow",
    "retained": "Source retained; full integration acceptance has not been recorded",
    "unverified": "Claim requires additional operational acceptance",
    "upstream_incomplete": "Source itself does not deliver the complete capability",
    "upstream_placeholder": "Source contains a placeholder, not a working workflow",
}
ROUTE_FILES = [
    "yaksh/urls.py", "grades/urls.py", "stats/urls.py", "api/urls.py",
    "upload/urls.py", "online_test/urls.py",
]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def safe_relative(path):
    parsed = Path(path)
    require(not parsed.is_absolute() and ".." not in parsed.parts, f"Unsafe path: {path}")
    return parsed


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def routes():
    found = []
    for path in ROUTE_FILES:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", SyntaxWarning)
            tree = ast.parse((ROOT / "legacy/yaksh" / path).read_text())
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name):
                continue
            if node.func.id not in ("url", "path") or len(node.args) < 2:
                continue
            target = node.args[1]
            if isinstance(target, ast.Call) and isinstance(target.func, ast.Attribute) and target.func.attr == "as_view":
                target = target.func.value
            if isinstance(target, ast.Attribute):
                found.append((path, node.lineno, ast.unparse(target)))
    return found


def validate(data, upstream_root=None):
    require(data["schema"] == 1, "Unsupported audit schema")
    require(re.fullmatch(r"[0-9a-f]{40}", data["baseline"]), "Baseline must be pinned")
    ids = set()
    for name, repo in data["repositories"].items():
        require(re.fullmatch(r"[\w.-]+/[\w.-]+", repo["repository"]), f"Bad repository: {name}")
        require(re.fullmatch(r"[0-9a-f]{40}", repo["revision"]), f"Unpinned source: {name}")
    for feature in data["features"]:
        key = feature["id"]
        require(key not in ids, f"Duplicate feature: {key}")
        ids.add(key)
        require(feature["repository"] in data["repositories"], f"Unknown repository: {key}")
        require(feature["status"] in STATUSES, f"Unknown status: {key}")
        require(feature["source"] and feature["assessment"], f"Missing assessment/source: {key}")
        for source in feature["source"]:
            safe_relative(source["path"])
            require(isinstance(source["line"], int) and source["line"] > 0, f"Bad source line: {key}")
        if feature["status"] == "implemented":
            require(feature["implementation"] and feature["verification"], f"Implemented without evidence: {key}")
        for ref in feature["implementation"] + feature["verification"]:
            path, _, selector = ref.partition("::")
            local = ROOT / safe_relative(path)
            require(local.is_file(), f"Missing local evidence: {key}: {ref}")
            if selector:
                require(selector in local.read_text(), f"Missing test selector: {key}: {ref}")

    declared = data["yaksh_routes"]
    require(routes() == [(r["path"], r["line"], r["target"]) for r in declared], "Yaksh route inventory changed; review all route declarations")
    features = {f["id"]: f for f in data["features"]}
    for route in declared:
        feature = features.get(route["feature"])
        require(feature and feature["repository"] == "yaksh", f"Unmapped Yaksh route: {route}")
        symbol = route["target"].removeprefix("views.")
        key = route["path"].split("/")[0] + ":" + symbol
        require(key in feature["routes"], f"Route assigned to wrong feature: {key}")

    course = (ROOT / "vendor/scormly/src/types/course.ts").read_text()
    union = course.split("export type BlockType =", 1)[1].split("/**", 1)[0]
    blocks = re.findall(r"\| '([^']+)'", union)
    require(blocks == data["studio_blocks"], "Scormly block inventory changed; review new/removed block types")
    reviewed = [f["feature"].removeprefix("Authoring block: ") for f in data["features"] if f["id"].startswith("B")]
    require(blocks == reviewed, "Not every Scormly block has a feature assessment")
    seen = set()
    for entry in data["studio_files"]:
        require(entry["path"] not in seen, f"Duplicate studio file: {entry['path']}")
        seen.add(entry["path"])
        local = ROOT / "vendor/scormly" / safe_relative(entry["path"])
        require(local.is_file(), f"Upstream studio file removed: {entry['path']}")
        require(re.fullmatch(r"[0-9a-f]{64}", entry["source_sha256"]), "Invalid source hash")
        require(digest(local) == entry["local_sha256"], f"Studio evidence changed: {entry['path']}; review then run --refresh-studio --write")

    if upstream_root:
        roots = {"yaksh": ROOT / "legacy/yaksh", "scorm": upstream_root / "scorm-lms",
                 "studio": upstream_root / "scormly", "dashboard": upstream_root / "dashboard"}
        for name in ("scorm", "studio", "dashboard"):
            revision = subprocess.check_output(["git", "-C", str(roots[name]), "rev-parse", "HEAD"], text=True).strip()
            require(revision == data["repositories"][name]["revision"], f"Wrong upstream checkout: {name}")
        for feature in data["features"]:
            for source in feature["source"]:
                path = roots[feature["repository"]] / source["path"]
                require(path.is_file(), f"Upstream reference missing: {path}")
                require(source["line"] <= len(path.read_text(errors="replace").splitlines()), f"Source line out of range: {path}")
        tracked = subprocess.check_output(["git", "-C", str(roots["studio"]), "ls-files", "-z"], text=True).split("\0")
        files = {p for p in tracked if p and (roots["studio"] / p).is_file()}
        require(files == seen, "Scormly inventory does not match every upstream tracked file")
        for entry in data["studio_files"]:
            require(digest(roots["studio"] / entry["path"]) == entry["source_sha256"], f"Wrong upstream file hash: {entry['path']}")


def cell(text):
    return str(text).replace("|", "\\|").replace("\n", " ")


def source_link(data, repository, source):
    repo = data["repositories"][repository]
    url = f"https://github.com/{repo['repository']}/blob/{repo['revision']}/{quote(source['path'])}#L{source['line']}"
    return f"[{cell(source['path'])}:{source['line']}]({url})"


def local_link(ref):
    path, _, selector = ref.partition("::")
    label = selector or path
    return f"[{cell(label)}](../{quote(path)})"


def render(data):
    features = data["features"]
    counts = Counter(f["status"] for f in features)
    identical = sum(f["source_sha256"] == f["local_sha256"] for f in data["studio_files"])
    lines = [
        "# Upstream feature audit", "",
        "**Full upstream feature parity has not been achieved.** The supported application contains tested enterprise workflows, but archiving Yaksh or retaining Scormly source does not mean every upstream workflow is integrated.", "",
        f"Source audit: {data['audited_on']}. Starting application revision: `{data['baseline']}`. Assessments below include the fixes recorded in this report.", "",
        "This is a source review of routes, models, controllers, editors, exported players and tests at four pinned revisions. It inventories discoverable feature groups; it is not a certification of every execution path, browser, accessibility requirement or SCORM standard. Test links identify relevant regression coverage, not proof of uncited behaviors.", "",
        "## Sources and coverage", "",
        "| Source | Pinned revision | Feature groups |", "| --- | --- | ---: |",
    ]
    for name, repo in data["repositories"].items():
        lines.append(f"| [{repo['repository']}](https://github.com/{repo['repository']}) | [{repo['revision'][:12]}](https://github.com/{repo['repository']}/tree/{repo['revision']}) | {sum(f['repository'] == name for f in features)} |")
    lines += ["", f"Coverage anchors: **{len(features)} feature groups**, **{len(data['yaksh_routes'])} Yaksh route declarations**, **{len(data['studio_blocks'])} Scormly block types**, and **{len(data['studio_files'])} retained Scormly source files** ({identical} byte-identical; {len(data['studio_files']) - identical} modified). These counts describe inspection coverage, not a completion percentage.", "",
              "| Status | Count | Meaning |", "| --- | ---: | --- |"]
    for status, meaning in STATUSES.items():
        lines.append(f"| {status} | {counts[status]} | {meaning} |")
    lines += ["", "## Findings that affect acceptance", "",
        "- **Yaksh:** integer, numeric-with-tolerance, ordering and configurable text assessments, shared retry intervals, sequential navigation, response visibility, private instructor previews and live monitoring, saved-answer inspection, audited extensions/reopening and reviewed marks CSV imports now have end-to-end acceptance. The active application still lacks programming/file assessments, enrollment approvals, native course modules and prerequisites, weighted course grading, forums, bulk automatic regrading. Exact legacy API compatibility is also incomplete.",
        "- **SCORM LMS:** the current single-SCO runtime persists learning state, but lacks the source's complete typed data model, cumulative time handling, manifest-backed context and session reporting. The source demo itself does not implement full SCORM 2004 sequencing.",
        "- **Scormly:** all tracked source files and all 32 block types are retained. Many capabilities still need individual authoring → export → LMS interaction acceptance. Local folders, OPFS and cmi5/LRS behavior need separate environment checks.",
        "- **School dashboard:** several advertised workflows are placeholders. Only subject/class/teacher write actions are implemented upstream; most other forms log to the console, and most generic delete mappings point to subject deletion. Finance and performance examples contain fixed values. Company attendance, cohorts, supervisor relationships, schedules and announcements remain missing.",
        "- **Company mapping:** school parents/classes/schedules are interpreted as supervisors/training cohorts/training sessions. This preserves the useful workflows in company terminology; no school reference code or assets are copied. The dashboard README claims MIT, but the referenced license file is absent at the pinned revision.",
        "- **Visual reference:** Evitina and M365/Azure inform the original theme. Evitina's CSS/templates/assets and its unrelated commercial service features are not imported.",
        "- **Peach1:** live Entra/Graph, SMTP, infrastructure and realistic workload acceptance remain deployment-stage work. Unit tests do not certify tenant configuration or 500+ concurrent learners.", "",
        "## Remediations verified during this audit", "",
    ]
    lines.extend(f"- {item}" for item in data.get("remediations", []))
    lines += ["", "## Recorded verification", "",
              "These are recorded local results for the audit changes. They do not replace the per-feature acceptance gaps below. GitHub Actions reruns the repository checks for published commits.", "",
              "| Check | Result |", "| --- | --- |"]
    for check in data.get("validation", []):
        lines.append(f"| {cell(check['check'])} | {cell(check['result'])} |")
    lines += ["", "## Remaining implementation work", "",
        "The following are required completion workstreams, not exclusions. Each must update the feature assessments and add acceptance evidence before being called complete.", "",
        "1. **Learning structure:** modules, lessons/files/video, prerequisites, enrollment approvals, course instructors/TAs, deep cloning, import/export, progress and weighted course grades (Y07–Y21).",
        "2. **Assessment parity:** file/code responses, sandboxed evaluators, partial credit, native question imports, special attempts, mixed pools, practice and bulk regrading (unresolved rows in Y22–Y47; Y24, Y25, Y26, Y36, Y37, Y43, Y45 and Y46 are implemented).",
        "3. **SCORM data model:** manifest context and launch selection, typed/version-specific APIs, entry/exit, cumulative time, preferences, objectives/interactions and session reporting (S02, S04, S06–S20).",
        "4. **Authoring acceptance:** exercise every block in editor, preview and published player; verify project round-trip, undo, storage, accessibility, responsive layouts and cmi5 against a real LRS (B01–B32, A01–A23).",
        "5. **Company training operations:** supervisor relationships, cohorts/capacity, sessions, attendance, calendars, announcements and scoped profile/transcript views (D03, D06–D14, D16, D20).",
        "6. **Final acceptance:** all unresolved feature rows need implemented evidence or an explicit scope decision; then run live identity, migration, browser/accessibility and workload acceptance on Peach1. No source placeholder is counted as an implemented feature.", "",
    ]
    for name, repo in data["repositories"].items():
        lines += [f"## {repo['repository']}", "", "| ID / feature | Status | Pinned source | Active implementation / regression evidence | Assessment |", "| --- | --- | --- | --- | --- |"]
        for feature in features:
            if feature["repository"] != name:
                continue
            sources = "<br>".join(source_link(data, name, s) for s in feature["source"])
            refs = list(dict.fromkeys(feature["implementation"] + feature["verification"]))
            evidence = "<br>".join(local_link(ref) for ref in refs) or "—"
            lines.append(f"| <a id=\"{feature['id'].lower()}\"></a>**{feature['id']}** {cell(feature['feature'])} | {feature['status']} | {sources} | {evidence} | {cell(feature['assessment'])} |")
        lines.append("")
    lines += ["## Yaksh route coverage", "", "Every concrete route declaration in the six URL modules is mapped below, including parameterized variants and administration. Include/static routing helpers are not business workflows.", "", "<details>", "<summary>Expand the complete route inventory</summary>", "", "| Source declaration | Handler | Feature |", "| --- | --- | --- |"]
    for route in data["yaksh_routes"]:
        lines.append(f"| {source_link(data, 'yaksh', route)} | `{route['target']}` | [{route['feature']}](#{route['feature'].lower()}) |")
    lines += ["", "</details>", "", "## Maintain this evidence", "",
        "The [machine-readable inventory](audit/upstream-features.json) is the reviewed source of this report. The check below validates local evidence paths, test selectors, route coverage, block coverage, retained source hashes and generated-document consistency. It does **not** execute those tests or claim feature parity.", "", "```bash",
        "python3 scripts/check_upstream_audit.py",
        "# After reviewing an intentional change to retained Scormly source:",
        "python3 scripts/check_upstream_audit.py --refresh-studio --write",
        "# Optional: verify links/hashes against exact upstream checkouts:",
        "# <directory> contains scorm-lms/, scormly/ and dashboard/",
        "python3 scripts/check_upstream_audit.py --upstream-root <directory>",
        "# Separate acceptance gate: intentionally fails while parity is incomplete.",
        "python3 scripts/check_upstream_audit.py --require-complete", "```", "",
        "CI checks inventory integrity. The separate completeness gate rejects every status other than `implemented`, including upstream placeholders that still require an explicit scope decision. Regenerate this report with `--write` after editing assessments. Do not relabel retained source as implemented without workflow acceptance evidence.", ""]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="Regenerate the report")
    parser.add_argument("--refresh-studio", action="store_true", help="Record reviewed local file hashes; requires --write")
    parser.add_argument("--upstream-root", type=Path, help="Directory containing pinned upstream checkouts")
    parser.add_argument("--require-complete", action="store_true", help="Fail if any feature remains unresolved")
    args = parser.parse_args()
    require(not args.refresh_studio or args.write, "--refresh-studio requires --write")
    data = json.loads(MANIFEST.read_text())
    if args.refresh_studio:
        for entry in data["studio_files"]:
            entry["local_sha256"] = digest(ROOT / "vendor/scormly" / safe_relative(entry["path"]))
    validate(data, args.upstream_root)
    report = render(data)
    if args.write:
        if args.refresh_studio:
            MANIFEST.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
        REPORT.write_text(report)
    else:
        require(REPORT.is_file() and REPORT.read_text() == report, "Audit report is stale; run --write")
    unresolved = [f["id"] for f in data["features"] if f["status"] != "implemented"]
    print(f"Audit inventory valid: {len(data['features'])} features, {len(data['yaksh_routes'])} routes, {len(data['studio_blocks'])} blocks, {len(data['studio_files'])} retained files.")
    print(f"Feature parity remains incomplete: {len(unresolved)} feature groups require implementation, acceptance or an explicit scope decision.")
    if args.require_complete and unresolved:
        print("Unresolved: " + ", ".join(unresolved), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        print(f"Audit check failed: {error}", file=sys.stderr)
        sys.exit(1)
