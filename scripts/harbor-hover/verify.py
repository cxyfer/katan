#!/usr/bin/env python3
"""Verify harbour hover details over the diorama pier, plaque and boat.

The 3D harbour used to expose only a small square around its plaque; the ends
of the visible pier and the moored boat could not be hovered. This runner
drives the production build with deterministic board fixtures and probes the
far end of each rendered harbour footprint, then records the tooltip.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from itertools import product
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("board_evidence", ROOT / "scripts/board-3d/verify.py")
board_evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(board_evidence)

VIEWPORTS = {"desktop": (1366, 900), "mobile": (390, 844)}
FIXTURE = ROOT / "docs/aegis/work/2026-10-29-board-3d/evidence/fixtures-final.json"
DELAY_MS = 1000


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def rect(locator):
    box = locator.bounding_box()
    require(box is not None, f"missing rectangle: {locator}")
    return box


def bounded(page, box, label):
    width, height = page.viewport_size.values()
    require(box["x"] >= -1 and box["y"] >= -1 and
            box["x"] + box["width"] <= width + 1 and
            box["y"] + box["height"] <= height + 1,
            f"{label} outside viewport: {box}")


def harbor_probe(page, target, renderer):
    """Return an exposed point over the rendered harbour footprint, or None."""
    if renderer == "svg":
        return target.evaluate("""element => {
          const box = element.getBoundingClientRect();
          for (let y = Math.max(0, box.top + 3); y < Math.min(innerHeight, box.bottom - 3); y += 5) {
            for (let x = Math.max(0, box.left + 3); x < Math.min(innerWidth, box.right - 3); x += 5) {
              const top = document.elementFromPoint(x, y);
              if (top === element || element.contains(top)) return [x, y];
            }
          }
          return null;
        }""")
    return target.evaluate(r"""element => {
      const svg = element.ownerSVGElement;
      const frame = svg.getBoundingClientRect();
      const values = element.getAttribute('points').trim().split(/[\s,]+/).map(Number);
      const corners = [];
      for (let index = 0; index < values.length; index += 2) corners.push([values[index], values[index + 1]]);
      if (corners.length !== 5) throw new Error('harbour polygon needs five corners');
      const near = [(corners[0][0] + corners[4][0]) / 2, (corners[0][1] + corners[4][1]) / 2];
      const far = [(corners[1][0] + corners[2][0]) / 2, (corners[1][1] + corners[2][1]) / 2];
      const boatNear = [corners[1][0] + (corners[2][0] - corners[1][0]) * 0.85,
                        corners[1][1] + (corners[2][1] - corners[1][1]) * 0.85];
      const boat = [(boatNear[0] + corners[3][0]) / 2, (boatNear[1] + corners[3][1]) / 2];
      // Probe the boat lobe first, then fall back along the pier centre when
      // stage UI covers that side of the harbour.
      for (const [x0, y0] of [boat, [(near[0] + far[0]) / 2, (near[1] + far[1]) / 2],
                              [near[0] + (far[0] - near[0]) * 0.35, near[1] + (far[1] - near[1]) * 0.35]]) {
        const x = frame.left + x0, y = frame.top + y0;
        if (x < 4 || y < 4 || x >= innerWidth - 4 || y >= innerHeight - 4) continue;
        const top = document.elementFromPoint(x, y);
        if (top === element || element.contains(top)) return [x, y];
      }
      return null;
    }""")


def verify_case(page, source, renderer, language, case_dir):
    board = source["snapshot"]["view"]["board"]
    require(board.get("harbors"), "fixture board has no harbours")
    if renderer == "r3f":
        page.wait_for_function("document.querySelector('[data-testid=\"board\"]')?.dataset.effectiveRenderer === 'r3f'")
    page.wait_for_timeout(500)
    checked = []
    for harbor in board["harbors"]:
        target = page.get_by_test_id(f"inspect-harbor-{harbor['edge']}")
        require(target.count() == 1, f"missing harbour inspection target {harbor['edge']}")
        expected_tag = "polygon" if renderer == "r3f" else "rect"
        require(target.evaluate("element => element.tagName.toLowerCase()") == expected_tag,
                f"harbour {harbor['edge']} should be a {expected_tag}")
        point = harbor_probe(page, target, renderer)
        if point is None:
            continue
        page.mouse.move(8, 8)
        page.wait_for_timeout(240)
        page.mouse.move(*point)
        page.wait_for_timeout(450)
        require(page.get_by_role("tooltip").count() == 0, f"harbour {harbor['edge']} opened too early")
        page.wait_for_timeout(700)
        popup = page.get_by_role("tooltip")
        if popup.count() == 0:
            page.mouse.move(8, 8)
            page.wait_for_timeout(240)
            continue
        text = popup.inner_text().strip()
        require(text, "empty harbour tooltip")
        title = (f"路徑 {harbor['edge']} 上的港口" if language == "zh-Hant"
                 else f"Harbour at path {harbor['edge']}")
        require(title in text, f"harbour {harbor['edge']} tooltip title missing: {text[:120]}")
        require(target.get_attribute("aria-describedby") == popup.get_attribute("id"),
                "harbour target lacks its tooltip association")
        bounded(page, rect(popup), f"harbour {harbor['edge']} tooltip")
        # The visible boat/pier end must be hoverable, not only the plaque.
        under = page.evaluate("([x,y]) => { const t=document.elementFromPoint(x,y); return t?.dataset?.testid ?? null; }", point)
        require(under == f"inspect-harbor-{harbor['edge']}",
                f"harbour {harbor['edge']} far end is covered by {under}")
        checked.append({"edge": harbor["edge"], "type": harbor["type"], "point": point,
                        "tooltip": {"x": rect(popup)["x"], "y": rect(popup)["y"]}})
        page.screenshot(path=str(case_dir / f"harbour-{harbor['edge']}-hover.png"), animations="disabled")
        target_box, tooltip_box = rect(target), rect(popup)
        viewport = page.viewport_size
        left = max(0, min(target_box["x"], tooltip_box["x"]) - 24)
        top = max(0, min(target_box["y"], tooltip_box["y"]) - 24)
        right = min(viewport["width"], max(target_box["x"] + target_box["width"],
                                           tooltip_box["x"] + tooltip_box["width"]) + 24)
        bottom = min(viewport["height"], max(target_box["y"] + target_box["height"],
                                             tooltip_box["y"] + tooltip_box["height"]) + 24)
        page.screenshot(path=str(case_dir / f"harbour-{harbor['edge']}-hover-detail.png"),
                        clip={"x": left, "y": top, "width": right - left, "height": bottom - top},
                        animations="disabled")
        page.mouse.move(8, 8)
        page.wait_for_timeout(240)
        require(page.get_by_role("tooltip").count() == 0, f"harbour {harbor['edge']} tooltip stayed after leaving")
        break
    require(checked, f"no reachable harbour target with the {renderer} renderer")
    # Keyboard access uses the same public target and delayed description.
    target = page.get_by_test_id(f"inspect-harbor-{checked[0]['edge']}")
    target.focus()
    page.wait_for_timeout(DELAY_MS - 150)
    require(page.get_by_role("tooltip").count() == 0, "harbour keyboard tooltip opened too early")
    page.get_by_role("tooltip").wait_for()
    require(target.get_attribute("aria-describedby"), "harbour keyboard target lacks tooltip association")
    page.keyboard.press("Escape")
    require(page.get_by_role("tooltip").count() == 0, "Escape did not dismiss the harbour tooltip")
    return {"harbours": checked, "keyboard": "focus opens after one second; Escape dismisses"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="test-results/harbor-hover")
    parser.add_argument("--executable-path")
    parser.add_argument("--renderer", choices=("all", "svg", "r3f"), default="all")
    parser.add_argument("--viewport", choices=("all", *VIEWPORTS), default="desktop")
    parser.add_argument("--board", choices=("hex-r2", "hex-r56"), default="hex-r2")
    args = parser.parse_args()
    out = board_evidence.output_path(args.out)
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    source = next((board for board in fixture["boards"] if board["id"] == args.board), None)
    require(source is not None, f"board {args.board} not found in fixture")
    renderers = ("svg", "r3f") if args.renderer == "all" else (args.renderer,)
    viewports = list(VIEWPORTS.items()) if args.viewport == "all" else [(args.viewport, VIEWPORTS[args.viewport])]
    digest, assets = board_evidence.build_manifest()
    paths = [*board_evidence.SOURCE_PATHS, Path(__file__)]
    report = {"sourceHead": board_evidence.git(["rev-parse", "HEAD"]),
              "sourceDigest": board_evidence.tree_hash(paths),
              "buildDigest": digest, "assets": assets, "fixture": str(FIXTURE.relative_to(ROOT)),
              "cases": [], "limitations": [
                  "Chromium software WebGL; physical devices and screen readers not run.",
                  "Deterministic API/WebSocket fixtures, not a live game server.",
                  "The served index.html differs from dist by the OG-image origin placeholder; JS/CSS remain byte-identical.",
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
            for renderer, (viewport, size) in product(renderers, viewports):
                case_dir = out / f"{renderer}-{viewport}"
                case_dir.mkdir()
                scenario = board_evidence.Scenario(
                    browser, base, SimpleNamespace(renderer=renderer, quality="standard"),
                    fixture, source, "zh-Hant", size, case_dir, initial="snapshot", motion="no-preference")
                page = scenario.page
                try:
                    page.wait_for_function(
                        "(renderer) => document.querySelector('[data-testid=\"board\"]')?.dataset.effectiveRenderer === renderer",
                        arg=renderer)
                    require(scenario.state()["effective"] == renderer, "requested renderer unavailable")
                    case = {"renderer": renderer, "viewport": size, "status": "FAIL"}
                    report["cases"].append(case)
                    case["checks"] = verify_case(page, source, renderer, "zh-Hant", case_dir)
                    page.screenshot(path=str(case_dir / "harbour-hover.png"), animations="disabled")
                    # The production server replaces the OG-image origin placeholder in
                    # index.html, so the harness's byte-for-byte index hash differs by
                    # design. JS/CSS hashes and runtime errors remain checked.
                    unexpected_errors = [error for error in scenario.errors
                                         if error != "loaded asset hash mismatch: /"]
                    require(not unexpected_errors and not scenario.unmapped,
                            f"runtime/API errors: {unexpected_errors} {scenario.unmapped}")
                    case["status"] = "PASS"
                except Exception as error:
                    case = next((item for item in report["cases"] if item["viewport"] == size and
                                 item["renderer"] == renderer), None)
                    if case is not None:
                        case["error"] = str(error)
                    page.screenshot(path=str(case_dir / "failure.png"), animations="disabled")
                    raise
                finally:
                    scenario.close()
            browser.close()
        report["sourceDigestAfter"] = board_evidence.tree_hash(paths)
        require(report["sourceDigestAfter"] == report["sourceDigest"], "source changed during verification")
        require(board_evidence.build_manifest()[0] == digest, "build changed during verification")
    finally:
        board_evidence.stop_server(*server)
        (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                                         encoding="utf-8")
    return 0 if all(case["status"] == "PASS" for case in report["cases"]) else 1


if __name__ == "__main__":
    raise SystemExit(main())
