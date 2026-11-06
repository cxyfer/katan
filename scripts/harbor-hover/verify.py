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


def harbor_probe(page, target, renderer, plaque_id):
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
    return target.evaluate(r"""(element, plaqueId) => {
      const raw = element.getAttribute('data-harbor-probe');
      if (!raw) return null;
      const [x, y] = raw.split(',').map(Number);
      if (![x, y].every(Number.isFinite)) return null;
      if (x < 4 || y < 4 || x >= innerWidth - 4 || y >= innerHeight - 4) return null;
      const top = document.elementFromPoint(x, y);
      if (top === element || element.contains(top) || top?.dataset?.testid === plaqueId) return [x, y];
      return null;
    }""", plaque_id)


def settle_board(page):
    """Wait for the responsive board surface to stop changing size/position."""
    page.wait_for_timeout(350)
    page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
    previous = None
    for _ in range(10):
        box = page.get_by_test_id("board-surface").bounding_box()
        require(box is not None, "board surface has no box")
        key = tuple(round(box[item], 2) for item in ("x", "y", "width", "height"))
        if key == previous:
            return
        previous = key
        page.wait_for_timeout(120)


def settle_harbours(page):
    """Wait for projected harbour footprints and plaques to stop moving."""
    previous = None
    for _ in range(20):
        current = page.evaluate("""() => [
          ...document.querySelectorAll('[data-testid$="-footprint"]'),
          ...document.querySelectorAll('[data-testid^="inspect-harbor-"]:not([data-testid$="-footprint"])'),
        ].map(element => {
          const box = element.getBoundingClientRect();
          return [element.dataset.testid, element.dataset.harborProbe ?? '',
            box.x.toFixed(1), box.y.toFixed(1), box.width.toFixed(1), box.height.toFixed(1)].join(':');
        }).join('|')""")
        if current == previous:
            return
        previous = current
        page.wait_for_timeout(120)


def harbour_title_ok(title, language):
    # 港口以沿岸地塊的資源與點數命名（例如「羊毛（2）沿岸的港口」），不再顯示路徑編號。
    if language == "zh-Hant":
        return title.endswith("的港口") and "路徑" not in title
    return title.startswith("Harbour on ") and " path " not in title


def assert_tooltip(page, edge, language, plaque):
    popup = page.get_by_role("tooltip")
    require(popup.count() == 1, f"harbour {edge} tooltip missing")
    text = popup.inner_text().strip()
    require(text, f"harbour {edge} empty tooltip")
    require(harbour_title_ok(text.splitlines()[0].strip(), language),
            f"harbour {edge} tooltip title missing: {text[:120]}")
    require(plaque.get_attribute("aria-label"), f"harbour {edge} plaque lacks its accessible name")
    bounded(page, rect(popup), f"harbour {edge} tooltip")
    return popup


def screenshot_detail(page, edge, target, popup, case_dir):
    page.screenshot(path=str(case_dir / f"harbour-{edge}-hover.png"), animations="disabled")
    target_box, tooltip_box = rect(target), rect(popup)
    viewport = page.viewport_size
    left = max(0, min(target_box["x"], tooltip_box["x"]) - 24)
    top = max(0, min(target_box["y"], tooltip_box["y"]) - 24)
    right = min(viewport["width"], max(target_box["x"] + target_box["width"],
                                       tooltip_box["x"] + tooltip_box["width"]) + 24)
    bottom = min(viewport["height"], max(target_box["y"] + target_box["height"],
                                         tooltip_box["y"] + tooltip_box["height"]) + 24)
    page.screenshot(path=str(case_dir / f"harbour-{edge}-hover-detail.png"),
                    clip={"x": left, "y": top, "width": right - left, "height": bottom - top},
                    animations="disabled")


def hover_harbour(page, harbor, plaque, target, renderer, language):
    target_id = target.get_attribute("data-testid")
    plaque_id = plaque.get_attribute("data-testid")
    via = "token" if renderer == "svg" else "footprint"
    last_error = "no attempt"
    for attempt in range(1, 3):
        page.mouse.move(8, 8)
        page.keyboard.press("Escape")
        page.wait_for_timeout(160)
        point = None
        under = None
        # The inspection layer can mount a frame or two after the board reports
        # the 3D renderer. Wait until the exact probe point is over this harbour
        # (or its plaque) before starting the one-second hover timer.
        for _ in range(15):
            point = harbor_probe(page, target, renderer, plaque_id)
            if point is not None:
                under = page.evaluate(
                    "([x,y]) => { const t=document.elementFromPoint(x,y); return t?.dataset?.testid ?? null; }",
                    point)
                if under in {target_id, plaque_id}:
                    break
            page.wait_for_timeout(100)
        if point is None or under not in {target_id, plaque_id}:
            last_error = f"probe covered by {under}"
            continue
        page.mouse.move(8, 8)
        page.wait_for_timeout(240)
        page.mouse.move(*point)
        page.wait_for_timeout(180)
        fresh = harbor_probe(page, target, renderer, plaque_id)
        if fresh is not None and (abs(fresh[0] - point[0]) > 0.5 or abs(fresh[1] - point[1]) > 0.5):
            point = fresh
            page.mouse.move(*point)
            page.wait_for_timeout(180)
        # Re-enter once: a layer that mounted after the first move can otherwise
        # leave a tile timer pending under the stationary pointer.
        page.mouse.move(point[0] + 1, point[1] + 1)
        page.wait_for_timeout(40)
        page.mouse.move(*point)
        page.wait_for_timeout(450)
        if page.get_by_role("tooltip").count() != 0:
            last_error = "tooltip opened too early"
            continue
        page.wait_for_timeout(700)
        popup = page.get_by_role("tooltip")
        if popup.count() == 0:
            last_error = "tooltip missing"
            continue
        try:
            popup = assert_tooltip(page, harbor["edge"], language, plaque)
        except AssertionError as error:
            last_error = str(error)
            continue
        under = page.evaluate("([x,y]) => { const t=document.elementFromPoint(x,y); return t?.dataset?.testid ?? null; }", point)
        if under not in {target_id, plaque_id}:
            last_error = f"probe covered by {under}"
            continue
        return {"edge": harbor["edge"], "type": harbor["type"], "via": via, "point": point,
                "attempts": attempt, "tooltip": {"x": rect(popup)["x"], "y": rect(popup)["y"]}}
    raise AssertionError(f"harbour {harbor['edge']} hover failed: {last_error}")


def verify_case(page, source, renderer, language, size, case_dir):
    board = source["snapshot"]["view"]["board"]
    require(board.get("harbors"), "fixture board has no harbours")
    if renderer == "r3f":
        page.wait_for_function("document.querySelector('[data-testid=\"board\"]')?.dataset.effectiveRenderer === 'r3f'")
    settle_board(page)
    settle_harbours(page)
    page.keyboard.press("Escape")
    mobile = size[0] < 900
    checked = []
    if mobile:
        # Touch viewports have no hover. Verify that every plaque remains the
        # keyboard-reachable harbour target and opens the same delayed tooltip.
        for harbor in board["harbors"]:
            plaque = page.get_by_test_id(f"inspect-harbor-{harbor['edge']}")
            require(plaque.count() == 1, f"missing harbour plaque {harbor['edge']}")
            plaque.focus()
            page.wait_for_timeout(DELAY_MS - 150)
            require(page.get_by_role("tooltip").count() == 0, f"harbour {harbor['edge']} focus opened too early")
            page.get_by_role("tooltip").wait_for()
            popup = assert_tooltip(page, harbor["edge"], language, plaque)
            require(plaque.get_attribute("aria-describedby") == popup.get_attribute("id"),
                    f"harbour {harbor['edge']} focus target lacks tooltip association")
            checked.append({"edge": harbor["edge"], "type": harbor["type"], "via": "focus",
                            "tooltip": {"x": rect(popup)["x"], "y": rect(popup)["y"]}})
            if len(checked) == 1:
                screenshot_detail(page, harbor["edge"], plaque, popup, case_dir)
            page.keyboard.press("Escape")
            require(page.get_by_role("tooltip").count() == 0, f"harbour {harbor['edge']} Escape failed")
        require(len(checked) == len(board["harbors"]), "not every mobile harbour was checked")
        return {"harbours": checked, "mode": "focus", "keyboard": "every plaque opens and Escape closes"}

    for harbor in board["harbors"]:
        plaque = page.get_by_test_id(f"inspect-harbor-{harbor['edge']}")
        require(plaque.count() == 1, f"missing harbour inspection target {harbor['edge']}")
        target = (page.get_by_test_id(f"inspect-harbor-{harbor['edge']}-footprint")
                  if renderer == "r3f" else plaque)
        expected_tag = "polygon" if renderer == "r3f" else "rect"
        require(target.evaluate("element => element.tagName.toLowerCase()") == expected_tag,
                f"harbour {harbor['edge']} should be a {expected_tag}")
        result = hover_harbour(page, harbor, plaque, target, renderer, language)
        require(result is not None, f"harbour {harbor['edge']} hover produced no tooltip")
        checked.append(result)
        if len(checked) == 1:
            screenshot_detail(page, harbor["edge"], target,
                              page.get_by_role("tooltip"), case_dir)
        page.mouse.move(8, 8)
        page.wait_for_timeout(240)
        require(page.get_by_role("tooltip").count() == 0, f"harbour {harbor['edge']} tooltip stayed after leaving")
    require(len(checked) == len(board["harbors"]), "not every harbour was checked")

    return {"harbours": checked, "mode": "hover" if not mobile else "focus",
            "keyboard": "each plaque opens and Escape closes"}


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
                    case["checks"] = verify_case(page, source, renderer, "zh-Hant", size, case_dir)
                    page.screenshot(path=str(case_dir / "harbour-hover.png"), animations="disabled")
                    # The production server replaces the OG-image origin placeholder in
                    # index.html, so the harness's byte-for-byte index hash differs by
                    # design. JS/CSS hashes and runtime errors remain checked.
                    unexpected_errors = [error for error in scenario.errors
                                         if error != "loaded asset hash mismatch: /"]
                    require(not unexpected_errors and not scenario.unmapped and
                            not scenario.console_errors and not scenario.failed_responses and
                            not scenario.blocked_assets and not scenario.debugger_exceptions,
                            f"runtime/API errors: {unexpected_errors} {scenario.unmapped} "
                            f"{scenario.console_errors} {scenario.failed_responses} "
                            f"{scenario.blocked_assets} {scenario.debugger_exceptions}")
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
