#!/usr/bin/env python3
"""Measure table polish against built assets and deterministic API/WS fixtures."""
from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import sys
from itertools import product
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("side_rails", ROOT / "scripts/side-rails/verify.py")
rails = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rails)
board = rails.board_evidence
require, rect, bounded, reachable = rails.require, rails.rect, rails.bounded, rails.reachable
VIEWPORTS = {"desktop": (1366, 768), "mobile": (390, 844),
             "small": (320, 720), "landscape": (844, 390)}
RESOURCES = ("lumber", "brick", "wool", "grain", "ore")


def flush(page):
    # React can finish the state update without advancing the paused clock.
    page.evaluate("() => new Promise(resolve => queueMicrotask(resolve))")


def tick(page, milliseconds):
    page.clock.run_for(milliseconds)
    flush(page)


def clock(page):
    page.clock.install(time=1_800_000_000_000)
    page.clock.pause_at(1_800_000_001_000)


def screenshot(scenario, name, *, animation=False):
    path = scenario.out / f"{name}.png"
    scenario.page.screenshot(path=str(path), animations="allow" if animation else "disabled")
    return path.relative_to(ROOT).as_posix()


def horizontal_fit(locator, label):
    metric = locator.evaluate("""element => {
      const r=element.getBoundingClientRect();
      return {rect:r.toJSON(),clientWidth:element.clientWidth,scrollWidth:element.scrollWidth,
        clientHeight:element.clientHeight,scrollHeight:element.scrollHeight,
        scrollLeft:element.scrollLeft,overflowX:getComputedStyle(element).overflowX};
    }""")
    require(metric["scrollWidth"] <= metric["clientWidth"] + 1,
            f"{label} clips or scrolls horizontally: {metric}")
    require(metric["scrollLeft"] == 0, f"{label} retained horizontal scrolling: {metric}")
    return metric


def tool_forms(scenario):
    page = scenario.page
    trade_tab = page.get_by_test_id("tool-tab-trade")
    exchange_tab = page.get_by_test_id("tool-tab-exchange")
    for tab in (trade_tab, exchange_tab):
        reachable(tab, "tool tab")
        bounded(page, rect(tab), "tool tab")
        require(tab.get_attribute("aria-label"), "tool tab lacks localized name")
    trade_tab.click()
    trade = page.get_by_test_id("trade-panel")
    require(trade.is_visible(), "trade panel did not open")
    require(not page.get_by_test_id("bank-give").is_visible(), "bank form remains in player trade")
    sides = trade.locator(".trade-terms__side")
    require(sides.count() == 2, "give/want must have two fieldsets")
    give_box, want_box = rect(sides.nth(0)), rect(sides.nth(1))
    require(abs(give_box["y"] - want_box["y"]) <= 1 and
            give_box["x"] + give_box["width"] <= want_box["x"] + 1,
            f"give/want are not side by side: {give_box}, {want_box}")
    metrics = {"surface": horizontal_fit(page.locator(".game-tools__surface"), "tool surface"),
               "panel": horizontal_fit(page.get_by_test_id("tool-panel-trade"), "trade scroller"),
               "trade": horizontal_fit(trade, "trade form"),
               "terms": horizontal_fit(trade.locator(".trade-terms"), "give/want grid"),
               "give": give_box, "want": want_box}
    metrics["verticalScrollingRequired"] = metrics["panel"]["scrollHeight"] > metrics["panel"]["clientHeight"] + 1
    if page.viewport_size == {"width": 1366, "height": 768}:
        require(not metrics["verticalScrollingRequired"],
                f"desktop no-offer trade form needs vertical scrolling: {metrics['panel']}")
    bounded(page, rect(page.locator(".game-tools__surface")), "trade surface")
    controls = []
    for side, resource, operation in product(("give", "want"), RESOURCES, ("sub", "add")):
        control = page.get_by_test_id(f"{side}-{operation}-{resource}")
        control.scroll_into_view_if_needed()
        reachable(control, f"{side}-{operation}-{resource}")
        box = rect(control)
        bounded(page, box, "trade quantity control")
        require(box["width"] >= 35 and box["height"] >= 35, f"quantity control too small: {box}")
        controls.append(box)
    require(page.get_by_test_id("give-sub-lumber").is_disabled(), "zero draft can decrement")
    page.get_by_test_id("give-add-lumber").click()
    page.get_by_test_id("want-add-ore").click()
    page.get_by_test_id("offer-to").select_option("p2")
    page.get_by_test_id("create-offer").scroll_into_view_if_needed()
    reachable(page.get_by_test_id("create-offer"), "create player offer")
    screenshot(scenario, "trade")
    exchange_tab.click()
    require(not trade.is_visible(), "trade panel remains visible on exchange tab")
    require(page.get_by_test_id("exchange-panel").is_visible(), "separate exchange panel not visible")
    page.get_by_test_id("bank-give").select_option("grain")
    page.get_by_test_id("bank-receive").select_option("wool")
    metrics["exchange"] = horizontal_fit(page.get_by_test_id("exchange-panel"), "exchange form")
    bounded(page, rect(page.locator(".game-tools__surface")), "exchange surface")
    page.get_by_test_id("bank-submit").scroll_into_view_if_needed()
    reachable(page.get_by_test_id("bank-submit"), "exchange submit")
    require(page.get_by_test_id("bank-submit").is_enabled(), "different resources cannot exchange")
    screenshot(scenario, "exchange")
    trade_tab.click()
    require(page.get_by_test_id("give-lumber").inner_text() == "1", "give draft lost on tab switch")
    require(page.get_by_test_id("want-ore").inner_text() == "1", "want draft lost on tab switch")
    require(page.get_by_test_id("offer-to").input_value() == "p2", "recipient draft lost")
    exchange_tab.click()
    require(page.get_by_test_id("bank-give").input_value() == "grain", "exchange give draft lost")
    require(page.get_by_test_id("bank-receive").input_value() == "wool", "exchange receive draft lost")
    page.get_by_test_id("tool-close").click()
    require(exchange_tab.evaluate("element => document.activeElement === element"), "close lost opener focus")
    exchange_tab.click()
    require(page.get_by_test_id("bank-give").input_value() == "grain", "close/reopen lost exchange draft")
    page.get_by_test_id("bank-receive").select_option("grain")
    require(page.get_by_test_id("bank-submit").is_disabled(), "same-resource exchange remains enabled")
    require(page.get_by_test_id("exchange-panel").get_by_role("alert").is_visible(),
            "same-resource exchange explanation missing")
    page.keyboard.press("Escape")
    require(not page.get_by_test_id("exchange-panel").is_visible(), "Escape did not close tools")
    require(exchange_tab.evaluate("element => document.activeElement === element"), "Escape lost opener focus")
    require(not [call for call in scenario.api_calls if call["method"] != "GET"], "draft edits submitted commands")
    metrics.update(quantityControls=controls, draftsPreserved=True, sameResourceDisabled=True)
    return metrics


def inspection(scenario):
    page = scenario.page
    clock(page)
    checks = []
    page.get_by_test_id("board-surface").focus()
    for kind in ("hex", "vertex", "edge", "harbor"):
        targets = page.locator(f'[data-testid^="inspect-{kind}-"]')
        candidate = next(((targets.nth(i), rails.visible_point(targets.nth(i))) for i in range(targets.count())
                          if rails.visible_point(targets.nth(i))), None)
        require(candidate is not None, f"no reachable {kind} inspection target")
        target, point = candidate
        page.mouse.move(*point)
        tick(page, 999)
        require(page.get_by_role("tooltip").count() == 0, f"{kind} tooltip opened before 1000ms")
        tick(page, 1)
        popup = page.get_by_role("tooltip")
        require(popup.count() == 1 and popup.is_visible(), f"{kind} tooltip not visible at 1000ms")
        bounded(page, rect(popup), f"{kind} tooltip")
        require(popup.inner_text().strip(), "empty tooltip")
        require(target.get_attribute("aria-describedby"), "tooltip target lacks association")
        checks.append({"kind": kind, "target": target.get_attribute("data-testid"),
                       "absentAtMs": 999, "presentAtMs": 1000, "rect": rect(popup)})
        if kind == "hex":
            screenshot(scenario, "tooltip")
            popup.hover()
            tick(page, 200)
            require(popup.is_visible(), "reading tooltip dismissed it")
        page.keyboard.press("Escape")
        require(popup.count() == 0, "Escape did not dismiss inspection")
        page.mouse.move(page.viewport_size["width"] / 2, 4)
        tick(page, 200)
    page.keyboard.press("Tab")
    target.focus()
    tick(page, 999)
    require(page.get_by_role("tooltip").count() == 0, "keyboard tooltip opened before 1000ms")
    tick(page, 1)
    require(page.get_by_role("tooltip").is_visible(), "keyboard tooltip absent at 1000ms")
    page.keyboard.press("Escape")
    page.get_by_test_id("board-surface").focus()
    return {"clockControlled": True, "targets": checks, "keyboardBoundary": [999, 1000]}


def advance(scenario, event_type, params, *, dice=None, gains=None):
    snapshot = copy.deepcopy(scenario.snapshot)
    snapshot["revision"] += 1
    snapshot["view"]["seq"] += 1
    snapshot["view"]["events"].append({"seq": snapshot["view"]["seq"], "type": event_type, "params": params})
    if dice:
        snapshot["view"]["turn"].update(dice=dice, phase="actions")
    if gains:
        player = next(p for p in snapshot["view"]["players"] if p["id"] == "p1")
        for resource, amount in gains.items():
            player["resources"][resource] += amount
            player["handSize"] += amount
    scenario.send(snapshot)
    # WebSocket transport remains asynchronous while the presentation clock is paused.
    scenario.page.wait_for_timeout(40)
    flush(scenario.page)
    return snapshot


def die_faces(locator, values):
    require(locator.count() == len(values), f"wrong die count for {values}")
    metrics = []
    for index, value in enumerate(values):
        face = locator.nth(index)
        require(face.get_attribute("data-value") == str(value), f"die did not reveal {value}")
        pattern = face.locator("svg")
        require(pattern.count() == 1 and pattern.locator("circle").count() == value,
                f"die {value} has incorrect pips")
        face_box, pattern_box = rect(face), rect(pattern)
        interior = face.evaluate("element => ({width:element.clientWidth,height:element.clientHeight})")
        require(abs(interior["width"] - pattern_box["width"]) <= 1 and
                abs(interior["height"] - pattern_box["height"]) <= 1,
                f"pip pattern does not occupy full face: {face_box}, {pattern_box}")
        require(abs(face_box["width"] - face_box["height"]) <= 1, "die is not square")
        require(face.evaluate("element => getComputedStyle(element).overflow") == "hidden", "die pips can escape face")
        metrics.append({"value": value, "rect": face_box, "pattern": pattern_box, "pips": value})
    return metrics


def dice_and_gains(scenario, reduced):
    page = scenario.page
    clock(page)
    require(page.get_by_test_id("hand-gains").count() == 0, "initial hand snapshot replayed resource gains")
    require(page.get_by_test_id("dice-focus").count() == 0, "initial dice snapshot replayed focused roll")
    result = {"reducedMotion": reduced, "dice": [], "initialOverlays": 0}
    for pair in ([1, 6], [2, 5], [3, 4]):
        advance(scenario, "turn.rolled", {"playerId": "p1", "dice": pair, "total": sum(pair)}, dice=pair)
        if reduced:
            require(page.get_by_test_id("dice-focus").count() == 0, "reduced motion retained focused dice")
        else:
            focus = page.get_by_test_id("dice-focus")
            require(focus.count() == 1 and focus.get_attribute("data-phase") == "rolling", "fresh roll did not begin")
            rolling = focus.locator(".die-face")
            require(rolling.count() == 2 and rolling.locator("svg").count() == 12,
                    "rolling dice must cycle all six full-face patterns")
            require(rolling.locator("svg circle").count() == 42, "rolling dice pip cycle incomplete")
            tick(page, 1499)
            require(focus.get_attribute("data-phase") == "rolling", "dice result revealed before 1500ms")
            tick(page, 1)
            require(focus.get_attribute("data-phase") == "result", "dice result absent at 1500ms")
            focused = die_faces(focus.locator(".die-face"), pair)
            require(page.get_by_test_id("dice-announcement").inner_text().strip(), "dice result not announced")
            bounded(page, rect(focus.locator(".dice-presentation__panel")), "focused dice")
            if pair == [1, 6]:
                result["focusedScreenshot"] = screenshot(scenario, "dice-focused", animation=True)
            tick(page, 1000)
            require(focus.count() == 0, "focused dice did not clear after result hold")
            result["dice"].append({"focused": focused})
        compact = page.get_by_test_id("dice-roll-animation")
        compact_result = die_faces(compact.locator(".die-face"), pair)
        require(compact.get_attribute("aria-label"), "compact dice lacks accessible result")
        bounded(page, rect(compact), "compact dice")
        if reduced:
            result["dice"].append({"compact": compact_result})
        else:
            result["dice"][-1]["compact"] = compact_result
    advance(scenario, "production.resolved", {"total": 7, "grants": {"p1": {"lumber": 2, "ore": 1}}},
            gains={"lumber": 2, "ore": 1})
    if reduced:
        require(page.get_by_test_id("hand-gains").count() == 0, "reduced motion retained resource animation")
        result["gainOverlayCount"] = 0
    else:
        gain = page.get_by_test_id("hand-gains")
        require(gain.count() == 1 and gain.locator(".hand-gain").count() == 3, "fresh own resource gains not animated")
        require(gain.get_attribute("aria-hidden") == "true", "decorative gain overlay exposed to accessibility")
        require(gain.evaluate("element => getComputedStyle(element).pointerEvents") == "none",
                "gain overlay can block table controls")
        tick(page, 240)
        # CSS animations use the renderer timeline rather than Playwright's JS clock.
        # Sample their visual geometry at a fixed point independently of GPU speed.
        gain.evaluate("""element => element.getAnimations({subtree:true}).forEach(animation => {
          animation.pause(); animation.currentTime=240;
        })""")
        gain_boxes = [rect(card) for card in gain.locator(".hand-gain").all()]
        for box in gain_boxes:
            bounded(page, box, "falling resource card")
        result["gainScreenshot"] = screenshot(scenario, "hand-gains", animation=True)
        result.update(gainOverlayCount=3, gainRects=gain_boxes)
        tick(page, 1000)
        require(gain.count() == 0, "resource gain overlay did not expire")
        scenario.send(scenario.snapshot)
        tick(page, 100)
        require(gain.count() == 0, "duplicate snapshot replayed resource gains")
        advance(scenario, "production.resolved", {"total": 8, "grants": {"p2": {"wool": 1}}})
        tick(page, 100)
        require(gain.count() == 0, "other player's production animated own hand")
    screenshot(scenario, "compact-dice")
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="test-results/table-ui-polish")
    parser.add_argument("--executable-path", default="/home/usaya/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome")
    parser.add_argument("--renderer", choices=("all", "svg", "r3f"), default="all")
    parser.add_argument("--viewport", choices=("all", *VIEWPORTS), default="all")
    parser.add_argument("--check", choices=("all", "layout", "motion"), default="all")
    args = parser.parse_args()
    out = board.output_path(args.out)
    fixture_path = ROOT / "docs/aegis/work/2026-10-29-board-3d/evidence/fixtures-final.json"
    fixture = json.loads(fixture_path.read_text())
    digest, assets = board.build_manifest()
    report = {"sourceHead": board.git(["rev-parse", "HEAD"]),
              "buildDigest": digest, "assets": assets, "fixtureDigest": board.file_hash(fixture_path),
              "scope": "Built frontend, deterministic API/WebSocket fixtures, Chromium only.",
              "fixtureOverrides": "Synthetic contiguous public event/dice and own-resource gain snapshots.",
              "limitations": ["No real server command execution, physical device, screen reader or other browser engine.",
                              "Clock-controlled timing checks do not measure native animation smoothness."],
              "cases": []}
    server = (None, None, None)
    try:
        from playwright.sync_api import sync_playwright
        base, child, temporary, log = board.start_server(out)
        server = (child, temporary, log)
        with sync_playwright() as api:
            browser = api.chromium.launch(headless=True, executable_path=args.executable_path,
                                          args=["--enable-unsafe-swiftshader"])
            report["browser"] = browser.version
            renderers = ("svg", "r3f") if args.renderer == "all" else (args.renderer,)
            sizes = VIEWPORTS.items() if args.viewport == "all" else [(args.viewport, VIEWPORTS[args.viewport])]
            tasks = [(renderer, name, size, locale, False)
                     for renderer, (name, size), locale in product(renderers, sizes, ("en", "zh-Hant"))]
            tasks += [(renderer, "motion", (390, 844), locale, reduced)
                      for renderer, (locale, reduced) in product(renderers, (("en", False), ("zh-Hant", True)))]
            tasks = [task for task in tasks if args.check == "all" or
                     (task[1] == "motion") == (args.check == "motion")]
            for renderer, name, size, locale, reduced in tasks:
                case_name = f"{renderer}-{name}-{locale}" + ("-reduce" if reduced else "")
                case_out = out / case_name
                case_out.mkdir()
                result = {"name": case_name, "renderer": renderer, "viewport": size, "locale": locale,
                          "status": "FAIL", "checks": {}}
                report["cases"].append(result)
                scenario = None
                try:
                    scenario = board.Scenario(browser, base, SimpleNamespace(renderer=renderer, quality="standard"),
                                              fixture, fixture["boards"][0], locale, size, case_out,
                                              motion="reduce" if reduced else "no-preference", initial="baseline")
                    scenario.page.set_default_timeout(5000)
                    require(scenario.state()["effective"] == renderer, "requested renderer unavailable")
                    if name == "motion":
                        result["activeCheck"] = "diceAndGains"
                        result["checks"]["diceAndGains"] = dice_and_gains(scenario, reduced)
                    else:
                        result["activeCheck"] = "toolForms"
                        result["checks"]["toolForms"] = tool_forms(scenario)
                        result["activeCheck"] = "inspection"
                        result["checks"]["inspection"] = inspection(scenario)
                    result["checks"]["document"] = rails.no_overflow(scenario.page)
                    require(not scenario.errors and not scenario.console_errors and not scenario.unmapped,
                            f"runtime/API errors: {scenario.errors} {scenario.console_errors} {scenario.unmapped}")
                    require(not scenario.failed_responses, f"failed responses: {scenario.failed_responses}")
                    result["status"] = "PASS"
                    result.pop("activeCheck")
                except Exception as error:
                    result["error"] = str(error)
                    if scenario:
                        result["failureScreenshot"] = screenshot(scenario, "failure")
                finally:
                    if scenario:
                        result.update(runtimeErrors=scenario.errors, consoleErrors=scenario.console_errors,
                                      unexpectedApiCalls=scenario.unmapped, assetsVerified=scenario.assets)
                        scenario.close()
                print(json.dumps({key: result[key] for key in ("name", "status", "activeCheck", "error")
                                  if key in result}), flush=True)
            browser.close()
        require(board.build_manifest()[0] == digest, "build changed during verification")
    finally:
        board.stop_server(*server)
        report["passedCases"] = sum(case["status"] == "PASS" for case in report["cases"])
        report["totalCases"] = len(report["cases"])
        (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    return 0 if report["cases"] and all(case["status"] == "PASS" for case in report["cases"]) else 1


if __name__ == "__main__":
    sys.exit(main())
