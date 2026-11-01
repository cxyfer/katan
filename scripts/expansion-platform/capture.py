#!/usr/bin/env python3
"""Capture base and archipelago boards for the expansion-platform phase.

Drives the production build (``pnpm build``) with the deterministic board-3d
API/WebSocket fixtures and records full-viewport screenshots of:

* the in-game hex-r2 and hex-r56 boards in the SVG and 3D renderers (desktop
  and phone), to compare base visuals before/after the generic renderer;
* an in-game sample archipelago (sea frame, four islands, gold, marked
  harbours) built by ``fixtures.mjs`` from the rules package;
* the ``?preview=island`` and ``?preview=archipelago`` model previews.

``--compare DIR`` diffs every capture that also exists in an earlier run and
records the changed-pixel count per image in ``report.json``.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import subprocess
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("board_evidence", ROOT / "scripts/board-3d/verify.py")
board_evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(board_evidence)

VIEWPORTS = {"desktop": (1366, 900), "mobile": (390, 844)}
FIXTURE = ROOT / "docs/aegis/work/2026-10-29-board-3d/evidence/fixtures-final.json"
SETTLE_MS = 1500
# Runtime noise the board-3d harness also ignores: the production server
# rewrites the OG-image origin in index.html, so its harness hash differs.
IGNORED_ERRORS = {"loaded asset hash mismatch: /"}


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_fixtures() -> tuple[dict, dict]:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    generated = json.loads(subprocess.run(
        ["node", str(ROOT / "scripts/expansion-platform/fixtures.mjs"), str(FIXTURE)],
        check=True, capture_output=True, text=True, cwd=ROOT).stdout)
    fixture["profiles"] = generated["profiles"]
    base = next(board for board in fixture["boards"] if board["id"] == "hex-r2")
    archipelago = copy.deepcopy(base)
    archipelago.update(id="sample-archipelago", topologyId="sample-archipelago",
                       snapshot=generated["archipelago"]["snapshot"])
    fixture["boards"].append(archipelago)
    for board in fixture["boards"]:
        board.setdefault("snapshot", board.get("historySnapshot"))
    return fixture, {board["id"]: board for board in fixture["boards"]}


def settle(page):
    # Park the pointer outside the board so no hover detail is open.
    page.mouse.move(1, 1)
    page.wait_for_timeout(SETTLE_MS)
    page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")


def game_case(browser, base, fixture, board, renderer, viewport, out, report):
    name = f"game-{board['id']}-{renderer}-{viewport}"
    case = {"name": name, "kind": "game", "board": board["id"], "renderer": renderer,
            "viewport": VIEWPORTS[viewport], "status": "FAIL"}
    report["cases"].append(case)
    scenario = board_evidence.Scenario(
        browser, base, SimpleNamespace(renderer=renderer, quality="standard"), fixture, board,
        "zh-Hant", VIEWPORTS[viewport], out, initial="snapshot", motion="reduce")
    page = scenario.page
    try:
        page.wait_for_function(
            "(renderer) => document.querySelector('[data-testid=\"board\"]')?.dataset.effectiveRenderer === renderer",
            arg=renderer)
        state = scenario.state()
        case["effective"] = state.get("effective")
        if renderer == "svg":
            hexes = page.locator('[data-testid^="hex-"]').count()
            case["svgHexes"] = hexes
            require(hexes == len(board["snapshot"]["view"]["board"]["terrain"]), "SVG hex count mismatch")
        settle(page)
        path = out / f"{name}.png"
        page.screenshot(path=str(path), animations="disabled")
        case["sha256"] = sha256(path)
        errors = [error for error in scenario.errors if error not in IGNORED_ERRORS]
        require(not errors and not scenario.console_errors and not scenario.failed_responses,
                f"runtime errors: {errors} {scenario.console_errors} {scenario.failed_responses}")
        case["unmappedApi"] = scenario.unmapped
        case["status"] = "PASS"
    except Exception as error:
        case["error"] = str(error)
        page.screenshot(path=str(out / f"{name}-failure.png"), animations="disabled")
    finally:
        scenario.close()


def preview_case(browser, base, preview, topology, viewport, out, report):
    name = f"preview-{preview}-{topology or 'default'}-{viewport}"
    case = {"name": name, "kind": "preview", "preview": preview, "topology": topology,
            "viewport": VIEWPORTS[viewport], "status": "FAIL"}
    report["cases"].append(case)
    width, height = VIEWPORTS[viewport]
    context = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=1,
                                  reduced_motion="reduce", service_workers="block")
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    try:
        page.goto(f"{base}/?preview={preview}", wait_until="networkidle")
        root = page.get_by_test_id("island-preview")
        if root.count() == 0:
            case["status"] = "UNAVAILABLE"
            case["detail"] = "this build has no such preview"
            return
        if topology:
            page.get_by_test_id("preview-topology").select_option(topology)
        page.wait_for_function(
            "() => ['ready', 'failed'].includes(document.querySelector('[data-testid=\"island-preview\"]')?.dataset.rendererStatus)",
            timeout=30000)
        case["rendererStatus"] = root.get_attribute("data-renderer-status")
        case["previewTopology"] = page.get_by_test_id("preview-topology").input_value()
        settle(page)
        path = out / f"{name}.png"
        page.screenshot(path=str(path), animations="disabled")
        case["sha256"] = sha256(path)
        require(case["rendererStatus"] == "ready", "3D preview did not become ready")
        require(not errors, f"page errors: {errors}")
        case["status"] = "PASS"
    except Exception as error:
        case["error"] = str(error)
    finally:
        context.close()


def compare(out: Path, before: Path, report: dict) -> None:
    from PIL import Image, ImageChops
    results = []
    for after_path in sorted(out.glob("*.png")):
        before_path = before / after_path.name
        if not before_path.exists():
            continue
        a, b = Image.open(before_path).convert("RGB"), Image.open(after_path).convert("RGB")
        if a.size != b.size:
            results.append({"image": after_path.name, "sizeChanged": [a.size, b.size]})
            continue
        diff = ImageChops.difference(a, b)
        changed = sum(1 for pixel in diff.getdata() if max(pixel) > 8)
        results.append({"image": after_path.name, "identicalBytes": sha256(before_path) == sha256(after_path),
                        "changedPixels": changed, "totalPixels": a.size[0] * a.size[1],
                        "maxChannelDelta": max(max(band) for band in diff.getextrema())})
    report["comparison"] = {"before": str(before), "images": results}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="test-results/expansion-platform")
    parser.add_argument("--executable-path")
    parser.add_argument("--cases", choices=("base", "all"), default="all",
                        help="base: only boards that exist before the platform change")
    parser.add_argument("--viewport", choices=("all", *VIEWPORTS), default="all")
    parser.add_argument("--compare", help="earlier output directory to diff against")
    args = parser.parse_args()
    out = board_evidence.output_path(args.out)
    fixture, boards = load_fixtures()
    viewports = list(VIEWPORTS) if args.viewport == "all" else [args.viewport]
    report = {"sourceHead": board_evidence.git(["rev-parse", "HEAD"]),
              "buildDigest": board_evidence.build_manifest()[0], "cases": [],
              "limitations": [
                  "Chromium with software WebGL; physical devices, Safari/Firefox and screen readers not run.",
                  "Deterministic API/WebSocket fixtures (board-3d fixtures-final.json plus fixtures.mjs), not a live game.",
              ]}
    server = (None, None, None)
    try:
        from playwright.sync_api import sync_playwright
        base, child, temporary, log = board_evidence.start_server(out)
        server = (child, temporary, log)
        with sync_playwright() as api:
            options = {"headless": True, "args": ["--enable-unsafe-swiftshader"]}
            if args.executable_path:
                options["executable_path"] = args.executable_path
            browser = api.chromium.launch(**options)
            report["browser"] = browser.version
            ids = ["hex-r2", "hex-r56"] + (["sample-archipelago"] if args.cases == "all" else [])
            for board_id in ids:
                for renderer in ("svg", "r3f"):
                    for viewport in viewports:
                        game_case(browser, base, fixture, boards[board_id], renderer, viewport, out, report)
            previews = [("island", None), ("island", "hex-r56")]
            if args.cases == "all":
                previews.append(("archipelago", None))
            for preview, topology in previews:
                for viewport in viewports:
                    preview_case(browser, base, preview, topology, viewport, out, report)
            browser.close()
    finally:
        if server[0] is not None:
            board_evidence.stop_server(*server)
    if args.compare:
        compare(out, (ROOT / args.compare).resolve(), report)
    (out / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    failed = [case["name"] for case in report["cases"] if case["status"] == "FAIL"]
    print(json.dumps({"out": str(out), "cases": len(report["cases"]), "failed": failed}, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
