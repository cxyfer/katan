"""Supplemental modeled-piece closeups; run from the repository root.

Reuses the approved runner's fixture/service/browser owners. This captures
engineering candidates only, not visual acceptance or performance evidence.
"""

import argparse
import json
import os
from pathlib import Path
import runpy
from types import SimpleNamespace

ROOT = Path.cwd().resolve()
runner = runpy.run_path(str(ROOT / "scripts/board-3d/verify.py"), run_name="board3d_capture")
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--out", required=True)
options = parser.parse_args()
out = runner["output_path"](options.out)
fixture_path = ROOT / ".tmp/board-3d-fixtures-final.json"
fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
build_hash, _ = runner["build_manifest"]()
report = {
    "status": "FAIL", "cases": [], "artifacts": [],
    "sourceSha": runner["git"](["rev-parse", "HEAD"]),
    "sourceHash": runner["tree_hash"](list(runner["SOURCE_PATHS"])),
    "buildHash": build_hash,
    "fixtureHash": runner["file_hash"](fixture_path),
    "captureScriptHash": runner["file_hash"](Path(__file__)),
    "scope": "Closeup candidates, no art/performance acceptance",
}
os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(runner["BROWSERS"])
from playwright.sync_api import sync_playwright

child = temporary = log = None
try:
    base, child, temporary, log = runner["start_server"](out)
    runner["verify_assets"](base, report)
    with sync_playwright() as playwright:
        with playwright.chromium.launch(headless=True, executable_path="C:/Program Files/Google/Chrome/Application/chrome.exe") as browser:
            report["browserVersion"] = browser.version
            scenario = runner["Scenario"](browser, base,
                SimpleNamespace(renderer="r3f", quality="standard"), fixture,
                fixture["boards"][0], "en", (1366, 768), out)
            try:
                scenario.send(fixture["boards"][0]["sequence"][1]["snapshot"])
                scenario.page.wait_for_timeout(900)
                for _ in range(4):
                    scenario.page.get_by_test_id("zoom-in").click()
                scenario.page.wait_for_timeout(300)
                image = scenario.screenshot("modeled-pieces-closeup", viewport=(1366, 768), locale="en")
                report.update(actual=scenario.state(), webgl=scenario.webgl(),
                    errors=scenario.errors, consoleErrors=scenario.console_errors,
                    screenshot=runner["relative"](image), screenshotHash=runner["file_hash"](image))
                report["status"] = "PASS" if report["actual"]["effective"] == "r3f" and report["webgl"].get("available") and not scenario.errors and not scenario.unmapped else "FAIL"
            finally:
                scenario.close()
finally:
    runner["stop_server"](child, temporary, log)
    report["buildUnchanged"] = runner["build_manifest"]()[0] == build_hash
    report["sourceUnchanged"] = runner["tree_hash"](list(runner["SOURCE_PATHS"])) == report["sourceHash"]
    if not report["buildUnchanged"] or not report["sourceUnchanged"]:
        report["status"] = "FAIL"
    (out / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(report["status"])
raise SystemExit(0 if report["status"] == "PASS" else 1)
