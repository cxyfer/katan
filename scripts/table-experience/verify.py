"""Exercise the integrated table UI against the production build and public fixtures."""
from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import sys
import time
from itertools import product
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("board_evidence", ROOT / "scripts/board-3d/verify.py")
board_evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(board_evidence)


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def rect(locator):
    return locator.bounding_box()


def center(box):
    return (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)


def toolbar(scenario, report):
    page = scenario.page
    surface = rect(page.get_by_test_id("board-surface"))
    require(surface["x"] >= 0 and surface["x"] + surface["width"] <= page.viewport_size["width"] + 1,
            "map surface extends beyond viewport")
    page.get_by_test_id("reset-view").click()
    settings = page.locator(".board__display-settings")
    settings.locator("summary").click()
    select = page.get_by_test_id("renderer-select")
    require(select.is_visible(), "renderer settings are not visible")
    box = rect(select)
    require(box["x"] >= 0 and box["x"] + box["width"] <= page.viewport_size["width"] + 1,
            "renderer settings extend beyond viewport")
    select.select_option(scenario.args.renderer)
    settings.locator("summary").click()
    scenario.wait_expected_renderer()
    page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
    report.append("bounded map surface, reachable fit control and display settings")


def inspect_map(scenario, report):
    page = scenario.page
    board = page.get_by_test_id("board")
    for kind in ("hex", "vertex", "edge", "harbor"):
        page.get_by_test_id("reset-view").click()
        target = page.locator(f'[data-testid^="inspect-{kind}-"]').first
        target.click()
        page.get_by_test_id("inspection-detail").wait_for()
        require(float(board.get_attribute("data-zoom")) >= 2.2, f"{kind} did not zoom")
        require(target.get_attribute("aria-pressed") == "true", f"{kind} did not select")
        require(page.get_by_test_id("inspection-detail").inner_text().strip(), "empty inspection")
    page.get_by_test_id("reset-view").click()
    require(board.get_attribute("data-zoom") == "1", "fit did not reset zoom")
    require(page.get_by_test_id("inspection-detail").count() == 0, "fit did not close detail")
    surface = page.get_by_test_id("board-surface")
    surface.focus()
    first = page.locator('[data-testid^="inspect-hex-"]').first
    first.focus()
    page.keyboard.press("Enter")
    page.get_by_test_id("inspection-detail").wait_for()
    page.get_by_test_id("reset-view").click()
    point = center(rect(page.locator('[data-testid^="inspect-hex-"]').first))
    page.mouse.move(*point)
    page.mouse.down()
    page.mouse.move(point[0] + 44, point[1] + 30, steps=8)
    page.mouse.up()
    require(page.get_by_test_id("inspection-detail").count() == 0, "drag inspected an element")
    page.get_by_test_id("reset-view").click()
    report.append("map pointer/keyboard inspection, fit and drag suppression")


def scoreboard(scenario, report):
    page = scenario.page
    panel = page.get_by_test_id("players-panel")
    surface = page.get_by_test_id("board-surface")
    before = rect(surface)
    collapsed_width = rect(panel)["width"]
    panel.hover()
    require(panel.get_attribute("data-expanded") == "true", "scoreboard hover did not expand")
    require(panel.get_attribute("data-pinned") == "false", "hover pinned scoreboard")
    after = rect(surface)
    require(before == after, "scoreboard expansion moved board")
    require(abs(rect(panel)["width"] - collapsed_width) < 1, "scoreboard changed width on expansion")
    seats = panel.locator("[data-board-seat]")
    require(seats.count() == len(scenario.snapshot["view"]["players"]), "a player is missing")
    boxes = [rect(seats.nth(index)) for index in range(seats.count())]
    require(max(box["width"] for box in boxes) - min(box["width"] for box in boxes) < 1,
            "player cards have inconsistent widths")
    bounds = rect(panel)
    require(all(box["y"] >= bounds["y"] and box["y"] + box["height"] <= bounds["y"] + bounds["height"]
                for box in boxes), "expanded player cards do not all fit in scoreboard")
    require(panel.evaluate("element => element.scrollWidth <= element.clientWidth"), "scoreboard content overflows horizontally")
    require(panel.locator(".score-mark--medal").count() == 2, "award medals are missing")
    require(panel.locator("dl").count() == 0, "old itemized score list retained")
    require(panel.locator(".score-mark").evaluate_all(
        "marks => marks.every(mark => mark.getAttribute('aria-label') && mark.title)"),
        "score icons lack accessible names or explanations")
    page.screenshot(path=str(scenario.out / f"{scenario.args.renderer}-{page.viewport_size['width']}-scoreboard.png"))
    pin = page.get_by_test_id("players-pin")
    pin.click()
    page.mouse.move(4, 4)
    page.wait_for_timeout(360)
    require(panel.get_attribute("data-expanded") == "true", "pin did not retain details")
    pin.click()
    page.mouse.move(4, 4)
    page.wait_for_timeout(360)
    require(panel.get_attribute("data-expanded") == "false", "unpin did not collapse after leave")
    names = panel.locator(".seat__name")
    require(all(names.nth(i).is_visible() for i in range(names.count())), "collapsed name hidden")
    require(page.get_by_test_id("players-hidden-vp").count() == 1, "private scores leaked")
    report.append({"scoreboard": "same-width icon counters and medals, all seats fit, hover, pin/unpin and privacy",
                   "players": seats.count(), "collapsedWidth": collapsed_width, "expandedWidth": bounds["width"]})


def hand(scenario, report):
    page = scenario.page
    panel = page.get_by_test_id("hand-panel")
    require(panel.get_attribute("data-expanded") == "false", "hand initially expanded")
    box = rect(panel)
    x, _ = center(box)
    require(abs(x - page.viewport_size["width"] / 2) < 2, "hand not horizontally centered")
    require(page.get_by_test_id("hand-toggle").count() == 0, "old deck button retained")
    require(box["height"] <= 80, "collapsed hand is not a small peek")
    page.mouse.move(x, box["y"] + 12)
    page.wait_for_function("document.querySelector('[data-testid=\"hand-panel\"]').dataset.expanded === 'true'")
    page.wait_for_timeout(280)
    card = page.get_by_test_id("resource-wool")
    # 重疊手牌只露出一段卡面；使用實際可命中的區域，避免點在下一張卡的中心。
    point = card.evaluate("""element => {
      const r=element.getBoundingClientRect();
      for(let y=Math.max(0,r.top+8);y<Math.min(innerHeight,r.bottom-8);y+=8)
        for(let x=Math.max(0,r.left+8);x<Math.min(innerWidth,r.right-8);x+=8)
          if(document.elementFromPoint(x,y)?.closest('.hand-fan__card')===element) return [x,y];
      return null;
    }""")
    require(point, "resource card has no reachable face")
    page.mouse.move(*point)
    page.wait_for_timeout(260)
    card_box = rect(card)
    require(card_box["height"] > 170, "hover card did not enlarge")
    require(card_box["y"] >= 0 and card_box["y"] + card_box["height"] <= page.viewport_size["height"] + 1,
            "hovered card clipped by viewport")
    fresh_box = rect(page.get_by_test_id("new-devcards").locator(".development-card").first)
    require(fresh_box and fresh_box["y"] + fresh_box["height"] <= page.viewport_size["height"] + 1,
            "fresh development card did not join expanded fan")
    for box in panel.locator(".hand-fan__card").evaluate_all(
            "cards => cards.map(card => card.getBoundingClientRect().toJSON())"):
        require(box["x"] >= -1 and box["right"] <= page.viewport_size["width"] + 1,
                "expanded hand extends beyond horizontal viewport")
    card.locator("button").focus()
    page.keyboard.press("Escape")
    require(panel.get_attribute("data-expanded") == "false", "Escape did not close hand")
    page.mouse.move(4, 4)
    page.wait_for_timeout(360)
    report.append("centered card peek, held fan, raised card, fresh cards and Escape")


def dice(scenario, report):
    page = scenario.page
    snapshot = copy.deepcopy(scenario.snapshot)
    seq = snapshot["view"]["seq"] + 1
    snapshot["revision"] = max(snapshot["revision"] + 1, seq)
    snapshot["view"]["seq"] = seq
    snapshot["view"]["turn"]["dice"] = [3, 5]
    snapshot["view"]["events"] = [{"seq": seq, "type": "turn.rolled",
                                  "params": {"playerId": "p1", "dice": [3, 5], "total": 8}}]
    started = time.monotonic()
    scenario.send(snapshot)
    focus = page.get_by_test_id("dice-focus")
    focus.wait_for()
    require(focus.get_attribute("data-phase") == "rolling", "result revealed immediately")
    box = rect(focus.locator(".dice-presentation__panel"))
    x, y = center(box)
    require(abs(x - page.viewport_size["width"] / 2) < 2, "dice not horizontally centered")
    require(abs(y - page.viewport_size["height"] / 2) < 2, "dice not vertically centered")
    require(page.get_by_test_id("dice-announcement").inner_text() == "", "result announced too early")
    page.wait_for_function("document.querySelector('[data-testid=\"dice-focus\"]')?.dataset.phase === 'result'")
    elapsed = time.monotonic() - started
    require(1.35 <= elapsed <= 2.2, f"rolling duration outside 1-2 seconds: {elapsed:.3f}s")
    require(all(str(value) in page.get_by_test_id("dice-announcement").inner_text() for value in (3, 5, 8)),
            "wrong authoritative result")
    page.screenshot(path=str(scenario.out / f"{scenario.args.renderer}-{page.viewport_size['width']}-dice-result.png"))
    focus.wait_for(state="detached")
    scenario.send(snapshot)
    page.wait_for_timeout(100)
    require(focus.count() == 0, "same snapshot replayed dice")
    report.append({"dice": "center, delayed result and no replay", "rollingSeconds": round(elapsed, 3)})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--executable-path")
    parser.add_argument("--renderer", choices=("all", "svg", "r3f"), default="all")
    parser.add_argument("--viewport", choices=("all", "desktop", "mobile"), default="all")
    parser.add_argument("--board", choices=("all", "hex-r2", "hex-r56"), default="all")
    args = parser.parse_args()
    out = (ROOT / args.out).resolve()
    require(out.is_relative_to(ROOT / "test-results") and out != ROOT / "test-results", "invalid output")
    require(not out.exists(), "output already exists")
    out.mkdir(parents=True)
    fixture_path = ROOT / "docs/aegis/work/2026-10-29-board-3d/evidence/fixtures-final.json"
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    report = {"fixture": str(fixture_path.relative_to(ROOT)), "cases": [],
              "fixtureOverrides": "Local held cards, p1 road award (+2) and hidden VP (+1), p2 army award (+2), long bilingual names.",
              "limitations": ["Chromium with software WebGL; emulated viewports and pointer input.",
                              "Physical touch devices, screen readers and human visual acceptance not run."]}
    digest, assets = board_evidence.build_manifest()
    report.update(sourceHead=board_evidence.git(["rev-parse", "HEAD"]),
                  sourceDigest=board_evidence.tree_hash([*board_evidence.SOURCE_PATHS, Path(__file__)]),
                  fixtureDigest=board_evidence.file_hash(fixture_path), buildDigest=digest, assets=assets)
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
            renderers = ("svg", "r3f") if args.renderer == "all" else (args.renderer,)
            viewports = [((1366, 900), "en"), ((390, 844), "zh-Hant")]
            if args.viewport != "all":
                viewports = [viewports[0 if args.viewport == "desktop" else 1]]
            boards = [board for board in fixture["boards"] if args.board == "all" or board["id"] == args.board]
            expected_cases = len(renderers) * len(viewports) * len(boards)
            for renderer in renderers:
                for (size, language), fixture_board in product(viewports, boards):
                    board = copy.deepcopy(fixture_board)
                    case_dir = out / board["id"]
                    case_dir.mkdir(exist_ok=True)
                    own = board["snapshot"]["view"]["players"][0]
                    own.update(devCards=["knight", "monopoly"], newDevCards=["victoryPoint"],
                               devCardCount=2, newDevCardCount=1, longestRoadLength=5,
                               publicScore=own["publicScore"] + 2, ownScore=own["publicScore"] + 3)
                    opponent = board["snapshot"]["view"]["players"][1]
                    opponent.update(nickname="小美航海家", playedKnights=3, publicScore=opponent["publicScore"] + 2)
                    board["snapshot"]["view"]["awards"].update(longestRoad=own["id"], largestArmy=opponent["id"])
                    scenario = board_evidence.Scenario(browser, base, SimpleNamespace(renderer=renderer, quality="standard"),
                                                       fixture, board, language, size, case_dir, initial="snapshot",
                                                       motion="no-preference")
                    result = {"board": board["id"], "renderer": renderer, "viewport": size, "locale": language, "checks": []}
                    report["cases"].append(result)
                    scenario.page.set_default_timeout(8000)
                    try:
                        require(scenario.state()["effective"] == renderer, "requested renderer unavailable")
                        require(scenario.page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "horizontal overflow")
                        toolbar(scenario, result["checks"])
                        scoreboard(scenario, result["checks"])
                        hand(scenario, result["checks"])
                        scenario.page.screenshot(path=str(case_dir / f"{renderer}-{size[0]}-collapsed.png"))
                        inspect_map(scenario, result["checks"])
                        dice(scenario, result["checks"])
                        scenario.page.get_by_test_id("players-panel").hover()
                        scenario.page.get_by_test_id("players-pin").click()
                        panel = scenario.page.get_by_test_id("hand-panel")
                        box = rect(panel)
                        scenario.page.mouse.move(box["x"] + box["width"] / 2, box["y"] + 12)
                        scenario.page.wait_for_timeout(280)
                        scenario.page.screenshot(path=str(case_dir / f"{renderer}-{size[0]}-expanded.png"))
                        require(not scenario.errors and not scenario.unmapped, f"runtime/API errors: {scenario.errors} {scenario.unmapped}")
                        result["status"] = "PASS"
                    except Exception as error:
                        result["status"] = "FAIL"
                        result["error"] = str(error)
                        result["layout"] = scenario.page.evaluate("""() => Object.fromEntries([
                          '.screen--game', '.status-strip', '.game-brand__name', '.game__table',
                          '.game__playfield', '.game__messages', '.game__map', '.board',
                          '.board__toolbar', '.board__surface', '[data-testid="reset-view"]',
                          '.players', '.players__heading', '.players .seat-list', '.players .seat'
                        ].map(selector => {
                          const element=document.querySelector(selector), style=getComputedStyle(element);
                          return [selector, {rect:element.getBoundingClientRect().toJSON(), display:style.display,
                            width:style.width, minWidth:style.minWidth, position:style.position,
                            overflowX:style.overflowX, gridTemplateColumns:style.gridTemplateColumns}];
                        }))""")
                        scenario.page.screenshot(path=str(case_dir / f"{renderer}-{size[0]}-failure.png"))
                    finally:
                        result["runtimeErrors"] = scenario.errors
                        result["unexpectedApiCalls"] = scenario.unmapped
                        scenario.close()
                    print(json.dumps(result, ensure_ascii=True), flush=True)
            browser.close()
    finally:
        board_evidence.stop_server(*server)
        (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0 if len(report["cases"]) == expected_cases and all(case.get("status") == "PASS" for case in report["cases"]) else 1


if __name__ == "__main__":
    sys.exit(main())
