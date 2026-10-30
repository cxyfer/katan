#!/usr/bin/env python3
"""Measure the production side rails with deterministic public board fixtures."""
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
VIEWPORTS = {"desktop": ((1366, 900), "en"), "mobile": ((390, 844), "zh-Hant"),
             "landscape": ((844, 390), "zh-Hant")}


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def rect(locator):
    box = locator.bounding_box()
    require(box is not None, f"missing rectangle: {locator}")
    return box


def same_rect(before, after, message, keys=("x", "y", "width", "height")):
    require(all(abs(before[key] - after[key]) <= 1 for key in keys),
            f"{message}: {before} -> {after}")


def settle(page):
    page.wait_for_timeout(380)
    page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")


def expanded(page, test_id, value):
    try:
        page.wait_for_function(
            "([id, value]) => document.querySelector(`[data-testid=\"${id}\"]`)?.dataset.expanded === value",
            arg=[test_id, str(value).lower()])
    except Exception as error:
        actual = page.get_by_test_id(test_id).get_attribute("data-expanded")
        raise AssertionError(f"{test_id} expected expanded={value}, actual={actual}") from error
    settle(page)


def bounded(page, box, label):
    width, height = page.viewport_size.values()
    require(box["x"] >= -1 and box["y"] >= -1 and
            box["x"] + box["width"] <= width + 1 and
            box["y"] + box["height"] <= height + 1, f"{label} outside viewport: {box}")


def reachable(locator, label):
    require(locator.is_visible(), f"{label} is hidden")
    hit = locator.evaluate("""element => {
      const r=element.getBoundingClientRect();
      const x=r.left+r.width/2, y=r.top+r.height/2;
      const top=document.elementFromPoint(x,y);
      return {reachable:x>=0 && y>=0 && x<innerWidth && y<innerHeight &&
        !!top && (element===top || element.contains(top)), point:[x,y],
        top:top?.outerHTML.slice(0,300)};
    }""")
    require(hit["reachable"], f"{label} is covered or clipped: {hit}")


def visible_point(locator):
    return locator.evaluate("""element => {
      const r=element.getBoundingClientRect();
      for(let y=Math.max(0,r.top+4);y<Math.min(innerHeight,r.bottom-4);y+=8)
        for(let x=Math.max(0,r.left+4);x<Math.min(innerWidth,r.right-4);x+=8) {
          const top=document.elementFromPoint(x,y);
          if(top && (top===element || element.contains(top))) return [x,y];
        }
      return null;
    }""")


def no_overflow(page):
    size = page.evaluate("""() => ({
      width:document.documentElement.scrollWidth, height:document.documentElement.scrollHeight,
      viewportWidth:innerWidth, viewportHeight:innerHeight, x:scrollX, y:scrollY
    })""")
    require(size["width"] <= size["viewportWidth"] + 1, f"horizontal document overflow: {size}")
    require(size["height"] <= size["viewportHeight"] + 1, f"vertical document overflow: {size}")
    require(size["x"] == 0 and size["y"] == 0, f"document scrolled: {size}")
    return size


def layout(page):
    return page.evaluate("""() => Object.fromEntries([
      '.screen--game', '.status-strip', '.game__table', '.game__map', '.board',
      '.board__toolbar', '.board__surface', '.players', '.players .seat-list',
      '.action-rail', '.action-rail__content', '.game__dock'
    ].map(selector => {
      const element=document.querySelector(selector);
      if(!element) return [selector,null];
      const style=getComputedStyle(element);
      return [selector,{rect:element.getBoundingClientRect().toJSON(),
        position:style.position,overflowX:style.overflowX,overflowY:style.overflowY,
        scrollHeight:element.scrollHeight,clientHeight:element.clientHeight,
        clipPath:style.clipPath}];
    }))""")


def geometry(scenario):
    page = scenario.page
    left = page.get_by_test_id("players-panel")
    right = page.get_by_test_id("action-rail")
    table = rect(page.locator(".game__table"))
    board = rect(page.get_by_test_id("board"))
    surface = rect(page.get_by_test_id("board-surface"))
    toolbar = rect(page.locator(".board__toolbar"))
    boxes = {"left": rect(left), "right": rect(right)}
    for name, box in boxes.items():
        bounded(page, box, name)
        require(abs(box["y"] + box["height"] / 2 - (table["y"] + table["height"] / 2)) <= 2,
                f"{name} rail is not vertically centered in table")
    require(page.locator(".board__toolbar").evaluate("el => getComputedStyle(el).position") == "absolute",
            "board toolbar still consumes layout height")
    require(abs(surface["y"] - board["y"]) <= 2, "board surface starts below a toolbar row")
    require(surface["height"] >= board["height"] - 2, "board toolbar reduces surface height")
    require(board["height"] >= table["height"] * .75, "board consumes too little table height")
    return {"rails": boxes, "table": table, "board": board, "surface": surface,
            "toolbar": toolbar, "document": no_overflow(page)}


def turn_flag(page):
    flag = page.get_by_test_id("seat-turn-flag")
    require(flag.count() == 1 and flag.is_visible(), "current-turn flag is missing or duplicated")
    row = page.locator('[data-board-seat][data-turn="true"]')
    row.scroll_into_view_if_needed()
    settle(page)
    box, flag_box = rect(row), rect(flag)
    require(abs(flag_box["y"] + flag_box["height"] / 2 - box["y"] - box["height"] / 2) <= 1,
            "turn flag not vertically centered on row")
    require(flag_box["x"] + flag_box["width"] >= box["x"] + box["width"] - 1,
            "turn flag does not reach row right edge")
    require(flag.evaluate("""element => {
      const before=element.style.pointerEvents;
      element.style.pointerEvents='auto';
      try {
        const r=element.getBoundingClientRect();
        return [r.left+r.width/2,r.right-3].every(x => {
          const top=document.elementFromPoint(x,r.top+r.height/2);
          return !!top && (top===element || element.contains(top));
        });
      } finally { element.style.pointerEvents=before; }
    }"""), "turn flag right edge is clipped or covered")
    return flag_box


def left_rail(scenario):
    page = scenario.page
    panel = page.get_by_test_id("players-panel")
    page.mouse.move(page.viewport_size["width"] / 2, 4)
    page.get_by_test_id("board-surface").focus()
    settle(page)
    expanded(page, "players-panel", False)
    rows = panel.locator("[data-board-seat]")
    require(rows.count() == len(scenario.snapshot["view"]["players"]), "player count differs from fixture")
    before = [rect(rows.nth(i)) for i in range(rows.count())]
    panel_before = rect(panel)
    require(panel.locator(".seat__identity:not([hidden])").count() == 0, "collapsed rail retained names")
    require(not page.get_by_test_id("players-pin").is_visible(), "collapsed rail retained pin control")
    surface_before = rect(page.get_by_test_id("board-surface"))
    flag_before = turn_flag(page)
    panel.locator(".players__toggle").hover()
    expanded(page, "players-panel", True)
    expanded_box = rect(panel)
    after = [rect(rows.nth(i)) for i in range(rows.count())]
    same_rect(panel_before, rect(panel), "left rail anchor moved on hover", keys=("x",))
    require(rect(panel)["width"] >= panel_before["width"] + 100, "left rail did not expand in width")
    require(panel_before["width"] <= 70, "collapsed rail is not compact")
    require(panel.locator(".seat__identity:not([hidden])").count() == rows.count(), "expanded names hidden")
    same_rect(surface_before, rect(page.get_by_test_id("board-surface")), "left hover moved map")
    for index, (old, new) in enumerate(zip(before, after)):
        same_rect(old, new, f"player row {index} changed height", keys=("height",))
    flag_after = turn_flag(page)
    require(flag_after["x"] > flag_before["x"] + 100, "turn flag did not follow expanded edge")
    require(panel.locator(".players__details:not([hidden])").count() == rows.count(),
            "expanded scoreboard details missing")
    require(panel.get_by_test_id("players-hidden-vp").count() == 1, "private scores leaked")
    require(panel.locator(".score-mark--medal").count() == 2, "award medals missing")
    reached = []
    for row in rows.all():
        row.scroll_into_view_if_needed()
        require(visible_point(row), f"player {row.get_attribute('data-board-seat')} cannot be reached")
        reached.append({"player": row.get_attribute("data-board-seat"), "rect": rect(row)})
    panel.get_by_test_id("seat-list").evaluate("element => { element.scrollTop=0; }")
    pin = page.get_by_test_id("players-pin")
    pin.click()
    page.mouse.move(page.viewport_size["width"] / 2, 4)
    settle(page)
    require(panel.get_attribute("data-pinned") == "true", "pin not retained")
    expanded(page, "players-panel", True)
    panel.get_by_test_id("players-toggle").focus()
    page.keyboard.press("Escape")
    expanded(page, "players-panel", False)
    require(panel.get_attribute("data-pinned") == "false", "Escape did not unpin")
    page.keyboard.press("Enter")
    expanded(page, "players-panel", True)
    page.keyboard.press("Escape")
    expanded(page, "players-panel", False)
    page.get_by_test_id("board-surface").focus()
    settle(page)
    return {"collapsed": panel_before, "expanded": expanded_box,
            "rowsBefore": before, "rowsAfter": after, "flagBefore": flag_before,
            "flagAfter": flag_after, "reachableRows": reached,
            "keyboard": "focus opens; Escape closes and restores toggle"}



def inspection_hover(scenario):
    page = scenario.page
    board = page.get_by_test_id("board")
    require(page.get_by_test_id("board-inspection").count() == 0, "explorer component retained")
    checks = []
    for kind in ("hex", "vertex", "edge", "harbor"):
        page.get_by_test_id("reset-view").click()
        page.mouse.move(page.viewport_size["width"] / 2, 4)
        page.get_by_test_id("board-surface").focus()
        targets = page.locator(f'[data-testid^="inspect-{kind}-"]')
        candidate = next(((targets.nth(i), visible_point(targets.nth(i))) for i in range(targets.count())
                          if visible_point(targets.nth(i))), None)
        require(candidate is not None, f"no reachable {kind} inspection target")
        target, point = candidate
        initial_zoom = board.get_attribute("data-zoom")
        page.mouse.move(*point)
        page.wait_for_timeout(700)
        require(page.get_by_role("tooltip").count() == 0, f"{kind} tooltip opened too early")
        popup = page.get_by_role("tooltip")
        popup.wait_for()
        require(popup.inner_text().strip(), "empty inspection tooltip")
        require(board.get_attribute("data-zoom") == initial_zoom, "hover changed zoom")
        bounded(page, rect(popup), "inspection tooltip")
        placement = popup.evaluate("""(element, id) => {
          const a=document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect();
          const b=element.getBoundingClientRect();
          const canFit=a.right+12+b.width<=innerWidth-8 || a.left-12-b.width>=8 ||
            a.bottom+12+b.height<=innerHeight-8 || a.top-12-b.height>=8;
          return {canFit, apart:b.left>=a.right || b.right<=a.left || b.top>=a.bottom || b.bottom<=a.top};
        }""", target.get_attribute("data-testid"))
        require(not placement["canFit"] or placement["apart"], "tooltip covers its element despite available room")
        checks.append({"kind": kind, "target": target.get_attribute("data-testid"), "tooltip": rect(popup)})
        if kind == "hex":
            page.screenshot(path=str(scenario.out / "hover-tooltip.png"), animations="disabled")
            popup.hover()
            page.wait_for_timeout(250)
            require(popup.is_visible(), "tooltip disappeared while reading it")
            page.keyboard.press("Escape")
            require(popup.count() == 0, "Escape did not dismiss tooltip")
            page.mouse.click(*point)
            page.wait_for_timeout(1700)
            require(board.get_attribute("data-zoom") == initial_zoom, "click changed zoom")
            require(popup.count() == 0, "click focused an inspection popup")
        page.mouse.move(page.viewport_size["width"] / 2, 4)
        page.get_by_test_id("board-surface").focus()
        page.wait_for_timeout(200)
        require(popup.count() == 0, "tooltip remained after leaving")
    target = page.locator('[data-testid^="inspect-hex-"]').first
    page.keyboard.press("Tab")
    target.focus()
    page.wait_for_timeout(900)
    require(page.get_by_role("tooltip").count() == 0, "keyboard tooltip opened too early")
    page.get_by_role("tooltip").wait_for()
    require(target.get_attribute("aria-describedby"), "keyboard target lacks tooltip association")
    page.keyboard.press("Escape")
    require(page.get_by_role("tooltip").count() == 0, "keyboard Escape did not close tooltip")
    page.get_by_test_id("board-surface").focus()
    page.get_by_test_id("toggle-fullscreen").click()
    page.wait_for_function("() => !!document.fullscreenElement")
    settle(page)
    page.keyboard.press("Tab")
    target.focus()
    page.get_by_role("tooltip").wait_for()
    require(page.get_by_role("tooltip").evaluate("element => document.fullscreenElement.contains(element)"),
            "fullscreen tooltip is outside fullscreen host")
    bounded(page, rect(page.get_by_role("tooltip")), "fullscreen tooltip")
    page.keyboard.press("Escape")
    page.evaluate("() => document.fullscreenElement ? document.exitFullscreen() : Promise.resolve()")
    settle(page)
    page.get_by_test_id("board-surface").focus()
    return {"delayMs": 1000, "elements": checks, "keyboard": "delayed focus and Escape", "fullscreen": True}


def right_rail(scenario):
    page = scenario.page
    panel = page.get_by_test_id("action-rail")
    toggle = page.get_by_test_id("action-rail-toggle")
    before = rect(panel)
    surface_before = rect(page.get_by_test_id("board-surface"))
    peek = toggle.evaluate("""element => {
      const r=element.getBoundingClientRect();
      return [r.right-12,r.top+r.height/2];
    }""")
    page.mouse.move(*peek)
    expanded(page, "action-rail", True)
    same_rect(before, rect(panel), "right rail changed size or position on hover")
    same_rect(surface_before, rect(page.get_by_test_id("board-surface")), "right hover moved map")
    page.wait_for_function("""() =>
      getComputedStyle(document.querySelector('.action-rail__content')).clipPath === 'inset(0px)'""")
    clips = panel.locator(".action-rail__content").evaluate(
        "element => getComputedStyle(element).clipPath")
    require(clips == "inset(0px)", f"right rail did not reveal full content: {clips}")
    page.mouse.move(page.viewport_size["width"] / 2, 4)
    expanded(page, "action-rail", False)
    toggle.focus()
    expanded(page, "action-rail", True)
    page.keyboard.press("Escape")
    expanded(page, "action-rail", False)
    require(toggle.evaluate("element => document.activeElement===element"), "Escape lost rail focus")
    page.keyboard.press("Tab")
    expanded(page, "action-rail", True)
    focused = page.locator(":focus")
    require(focused.count() == 1 and panel.evaluate(
        "element => element.contains(document.activeElement)"), "Tab left available rail actions")
    reachable(focused, "keyboard focused action")
    page.keyboard.press("Escape")
    expanded(page, "action-rail", False)
    page.keyboard.press("Enter")
    expanded(page, "action-rail", True)
    controls = []
    for button in panel.locator(".action-list__button").all():
        if not button.is_visible():
            continue
        button.scroll_into_view_if_needed()
        reachable(button, button.get_attribute("data-testid"))
        bounded(page, rect(button), "action control")
        controls.append({"id": button.get_attribute("data-testid"), "enabled": button.is_enabled(),
                         "rect": rect(button), "name": button.inner_text().strip()})
    page.keyboard.press("Escape")
    expanded(page, "action-rail", False)
    page.get_by_test_id("board-surface").focus()
    settle(page)
    return {"collapsed": before, "expanded": rect(panel), "controls": controls,
            "keyboard": "focus/Enter opens; Escape closes and restores toggle"}


def map_controls(scenario):
    page = scenario.page
    board = page.get_by_test_id("board")
    for name in ("zoom-in", "zoom-out", "reset-view", "board-display-settings"):
        reachable(page.get_by_test_id(name), name)
        bounded(page, rect(page.get_by_test_id(name)), name)
    page.get_by_test_id("zoom-in").click()
    require(float(board.get_attribute("data-zoom")) > 1, "zoom in did not change map")
    page.get_by_test_id("reset-view").click()
    require(float(board.get_attribute("data-zoom")) == 1, "fit did not reset map")
    if scenario.args.renderer == "r3f":
        before = float(board.get_attribute("data-camera-azimuth"))
        for name in ("rotate-left", "rotate-right"):
            reachable(page.get_by_test_id(name), name)
            page.get_by_test_id(name).click()
        require(float(board.get_attribute("data-camera-azimuth")) == before, "rotation controls not inverse")
    menu = page.get_by_test_id("board-display-settings")
    menu.click()
    settings = page.locator(".board__display-settings-panel")
    bounded(page, rect(settings), "display settings")
    reachable(page.get_by_test_id("renderer-select"), "renderer select")
    if scenario.args.renderer == "r3f":
        slider = page.get_by_test_id("camera-elevation")
        slider.focus()
        before = float(slider.input_value())
        page.keyboard.press("ArrowRight")
        require(float(slider.input_value()) > before, "camera elevation keyboard control failed")
    menu.click()
    return {"settings": rect(settings) if settings.is_visible() else "closed",
            "document": no_overflow(page)}


def touch(scenario):
    page = scenario.page
    if not scenario.context.browser:
        raise AssertionError("browser context missing")
    left = page.get_by_test_id("players-panel")
    right = page.get_by_test_id("action-rail")
    page.mouse.move(page.viewport_size["width"] / 2, 4)
    page.get_by_test_id("board-surface").focus()
    settle(page)
    scenario.touch_step = "players-first-tap-opens"
    page.get_by_test_id("players-toggle").tap()
    expanded(page, "players-panel", True)
    scenario.touch_step = "players-second-tap-closes"
    page.get_by_test_id("players-toggle").tap()
    expanded(page, "players-panel", False)
    toggle = page.get_by_test_id("action-rail-toggle")
    box = rect(toggle)
    scenario.touch_step = "actions-first-toggle-tap-opens"
    page.touchscreen.tap(box["x"] + box["width"] - 12, box["y"] + box["height"] / 2)
    expanded(page, "action-rail", True)
    scenario.touch_step = "actions-second-toggle-tap-closes"
    toggle.tap()
    expanded(page, "action-rail", False)
    action = page.get_by_test_id("action-build.road")
    if action.is_enabled():
        scenario.touch_step = "collapsed-action-first-tap-reveals"
        action.scroll_into_view_if_needed()
        box = rect(action)
        page.touchscreen.tap(box["x"] + box["width"] - 18, box["y"] + box["height"] / 2)
        expanded(page, "action-rail", True)
        require("action-list__button--armed" not in (action.get_attribute("class") or ""),
                "first touch on collapsed action submitted or armed it")
        scenario.touch_step = "revealed-action-second-tap-arms"
        action.tap()
        require("action-list__button--armed" in (action.get_attribute("class") or ""),
                "second touch did not arm revealed action")
        require(page.get_by_test_id("open-target-picker").is_visible(), "selected action lost target access")
        reachable(page.get_by_test_id("open-target-picker"), "armed action target picker")
    scenario.touch_step = "actions-Escape-closes"
    page.keyboard.press("Escape")
    if right.get_attribute("data-expanded") == "true":
        page.keyboard.press("Escape")
    expanded(page, "action-rail", False)
    return {"players": left.get_attribute("data-expanded"),
            "actions": right.get_attribute("data-expanded"),
            "commandsSubmitted": [call for call in scenario.api_calls if call["method"] != "GET"]}


def receipt_feedback(scenario):
    page = scenario.page
    requests = []

    def command(route):
        request = route.request.post_data_json
        requests.append(request)
        if len(requests) == 1:
            route.abort("timedout")
            return
        route.fulfill(status=200, json={"ok": True, "data": {
            "commandId": request["commandId"], "outcome": "accepted",
            "revision": scenario.snapshot["revision"], "events": [],
        }})

    page.route("**/api/games/g1/commands", command)
    page.get_by_test_id("action-rail-toggle").focus()
    expanded(page, "action-rail", True)
    action = page.get_by_test_id("action-endTurn")
    action.scroll_into_view_if_needed()
    action.click()
    status = page.get_by_test_id("command-status")
    page.wait_for_function("document.querySelector('[data-testid=\"command-status\"]')?.dataset.status === 'unknown'")
    resolve = page.get_by_test_id("command-resolve")
    resolve.scroll_into_view_if_needed()
    reachable(resolve, "unknown receipt resolve button")
    bounded(page, rect(resolve), "unknown receipt resolve button")
    require(page.get_by_test_id("command-retry").count() == 0, "unknown receipt offered a new retry")
    page.screenshot(path=str(scenario.out / "unknown-receipt.png"), animations="disabled")
    resolve.click()
    page.wait_for_function("document.querySelector('[data-testid=\"command-status\"]')?.dataset.status === 'accepted'")
    started = time.monotonic()
    require(status.locator("button").count() == 0, "accepted receipt retained a dismiss button")
    require(len(requests) == 2 and requests[0]["commandId"] == requests[1]["commandId"],
            "unknown receipt resolution did not replay the original command")
    bounded(page, rect(status), "accepted receipt")
    page.screenshot(path=str(scenario.out / "accepted-receipt.png"), animations="disabled")
    status.wait_for(state="detached", timeout=6000)
    elapsed = time.monotonic() - started
    require(3.4 <= elapsed <= 5, f"accepted receipt dismissal outside four-second interval: {elapsed:.3f}")
    page.unroute("**/api/games/g1/commands", command)
    return {"unknownResolveReachable": True, "sameCommandReplayed": True,
            "acceptedDismissSeconds": round(elapsed, 3), "acceptedButtons": 0,
            "injectedFailure": "first command transport timed out; replay returned accepted fixture receipt",
            "requests": [{"command": item["command"], "expectedRevision": item["expectedRevision"]}
                         for item in requests]}


def review_collisions(scenario):
    page = scenario.page
    left = page.get_by_test_id("players-panel")
    right = page.get_by_test_id("action-rail")
    left_toggle = page.get_by_test_id("players-toggle")
    right_toggle = page.get_by_test_id("action-rail-toggle")
    narrow = page.viewport_size["width"] <= 649
    if narrow:
        expanded(page, "players-panel", False)
        require(left.get_attribute("data-pinned") == "false", "opening actions retained player pin")
        turn_flag(page)
        left_toggle.focus()
        expanded(page, "players-panel", True)
        expanded(page, "action-rail", False)
        turn_flag(page)
        right_toggle.focus()
        expanded(page, "action-rail", True)
        expanded(page, "players-panel", False)
        left_toggle.tap()
        expanded(page, "players-panel", True)
        expanded(page, "action-rail", False)
        page.get_by_test_id("players-pin").tap()
        require(left.get_attribute("data-pinned") == "true", "touch pin failed")
        right_toggle.tap()
        expanded(page, "action-rail", True)
        expanded(page, "players-panel", False)
        require(left.get_attribute("data-pinned") == "false", "touch opening actions retained pin")
        turn_flag(page)
    else:
        expanded(page, "players-panel", True)
        expanded(page, "action-rail", True)
    page.mouse.move(page.viewport_size["width"] / 2, 4)
    page.keyboard.press("Escape")
    page.get_by_test_id("board-surface").focus()
    expanded(page, "action-rail", False)
    right_toggle.click()
    expanded(page, "action-rail", True)
    hand = page.get_by_test_id("hand-panel")
    hand.focus()
    expanded(page, "hand-panel", True)
    expanded(page, "action-rail", True)
    hand_box, rail_box = rect(hand), rect(right)
    if narrow:
        require(rail_box["y"] + rail_box["height"] <= hand_box["y"],
                f"action rail overlaps expanded hand: {rail_box} vs {hand_box}")
        reachable(right_toggle, "action toggle above expanded hand")
        bounded(page, rail_box, "action rail above expanded hand")
    reachable(hand.locator(".hand-fan__close"), "expanded hand close")
    require(visible_point(hand.locator(".development-card__inspect").last),
            "rightmost development card is covered")
    page.screenshot(path=str(scenario.out / "hand-expanded.png"), animations="disabled")
    page.keyboard.press("Escape")
    expanded(page, "hand-panel", False)
    page.get_by_test_id("board-surface").focus()
    settle(page)
    resized = False
    if page.viewport_size["width"] > 900:
        original_size = dict(page.viewport_size)
        left_toggle.focus()
        expanded(page, "players-panel", True)
        page.get_by_test_id("players-pin").click()
        right_toggle.focus()
        expanded(page, "action-rail", True)
        page.set_viewport_size({"width": 390, "height": 844})
        expanded(page, "players-panel", False)
        expanded(page, "action-rail", True)
        require(left.get_attribute("data-pinned") == "false", "resize retained overlapping pin")
        page.set_viewport_size(original_size)
        settle(page)
        resized = True
    return {"narrowExclusive": narrow, "resizeExclusive": resized,
            "hand": hand_box, "actions": rail_box}


def other_turn_flags(scenario):
    page = scenario.page
    if page.viewport_size["width"] > 649:
        return []
    left = page.get_by_test_id("players-panel")
    toggle = page.get_by_test_id("action-rail-toggle")
    checked = []
    players = scenario.snapshot["view"]["players"]
    for player in (players[1], players[-1]):
        snapshot = copy.deepcopy(scenario.snapshot)
        snapshot["revision"] += 1
        snapshot["view"]["turn"].update(playerId=player["id"], seat=player["seat"])
        scenario.send(snapshot)
        page.locator(f'[data-board-seat="{player["id"]}"][data-turn="true"]').wait_for()
        toggle.focus()
        expanded(page, "action-rail", True)
        expanded(page, "players-panel", False)
        checked.append({"seat": player["seat"], "flag": turn_flag(page)})
        require(page.get_by_test_id("seat-turn-flag").evaluate(
            "element => getComputedStyle(element).pointerEvents === 'none'"),
            "floating turn flag blocks actions below it")
    page.screenshot(path=str(scenario.out / "other-turn-flag.png"), animations="disabled")
    return checked


def fixture_board(source):
    board = copy.deepcopy(source)
    own, opponent = board["snapshot"]["view"]["players"][:2]
    own.update(devCards=["knight", "monopoly"], newDevCards=["victoryPoint"],
               devCardCount=2, newDevCardCount=1, longestRoadLength=5,
               publicScore=own["publicScore"] + 2, ownScore=own["publicScore"] + 3)
    opponent.update(nickname="小美航海家", playedKnights=3, publicScore=opponent["publicScore"] + 2)
    board["snapshot"]["view"]["awards"].update(longestRoad=own["id"], largestArmy=opponent["id"])
    return board


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="test-results/side-rails")
    parser.add_argument("--executable-path")
    parser.add_argument("--renderer", choices=("all", "svg", "r3f"), default="all")
    parser.add_argument("--viewport", choices=("all", *VIEWPORTS), default="all")
    parser.add_argument("--board", choices=("all", "hex-r2", "hex-r56"), default="all")
    args = parser.parse_args()
    out = board_evidence.output_path(args.out)
    fixture_path = ROOT / "docs/aegis/work/2026-10-29-board-3d/evidence/fixtures-final.json"
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    digest, assets = board_evidence.build_manifest()
    paths = [*board_evidence.SOURCE_PATHS, Path(__file__)]
    report = {
        "sourceHead": board_evidence.git(["rev-parse", "HEAD"]),
        "sourceDigest": board_evidence.tree_hash(paths), "buildDigest": digest, "assets": assets,
        "fixture": str(fixture_path.relative_to(ROOT)), "fixtureDigest": board_evidence.file_hash(fixture_path),
        "fixtureOverrides": "Held devcards, road/army medals, self hidden VP, bilingual opponent nickname.",
        "limitations": ["Chromium software WebGL and emulated touch; physical devices and screen readers not run.",
                        "Production frontend with deterministic API/WebSocket fixtures; live server commands not exercised."],
        "cases": [],
    }
    server = (None, None, None)
    expected_cases = 0
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
            viewports = list(VIEWPORTS.items()) if args.viewport == "all" else [(args.viewport, VIEWPORTS[args.viewport])]
            boards = [board for board in fixture["boards"] if args.board in ("all", board["id"])]
            expected_cases = len(renderers) * len(viewports) * len(boards)
            for renderer, (viewport, (size, language)), source in product(renderers, viewports, boards):
                name = f"{renderer}-{viewport}-{source['id']}"
                case_dir = out / name
                case_dir.mkdir()
                result = {"name": name, "renderer": renderer, "viewport": size, "locale": language,
                          "players": len(source["snapshot"]["view"]["players"]), "checks": {}, "status": "FAIL"}
                report["cases"].append(result)
                scenario = None
                try:
                    scenario = board_evidence.Scenario(
                        browser, base, SimpleNamespace(renderer=renderer, quality="standard"),
                        fixture, fixture_board(source), language, size, case_dir,
                        initial="snapshot", motion="no-preference")
                    page = scenario.page
                    page.set_default_timeout(8000)
                    require(scenario.state()["effective"] == renderer, "requested renderer unavailable")
                    settle(page)
                    result["activeCheck"] = "geometry"
                    result["checks"]["geometry"] = geometry(scenario)
                    page.screenshot(path=str(case_dir / "collapsed.png"), animations="disabled")
                    result["activeCheck"] = "left"
                    result["checks"]["left"] = left_rail(scenario)
                    result["activeCheck"] = "right"
                    result["checks"]["right"] = right_rail(scenario)
                    result["activeCheck"] = "inspectionHover"
                    result["checks"]["inspectionHover"] = inspection_hover(scenario)
                    result["activeCheck"] = "mapControls"
                    result["checks"]["mapControls"] = map_controls(scenario)
                    if size[0] < 900:
                        result["activeCheck"] = "touch"
                        result["checks"]["touch"] = touch(scenario)
                    result["activeCheck"] = "expandedEvidence"
                    page.get_by_test_id("players-toggle").focus()
                    expanded(page, "players-panel", True)
                    page.get_by_test_id("players-pin").click()
                    page.get_by_test_id("action-rail-toggle").focus()
                    expanded(page, "action-rail", True)
                    page.screenshot(path=str(case_dir / "expanded.png"), animations="disabled")
                    result["activeCheck"] = "reviewCollisions"
                    result["checks"]["reviewCollisions"] = review_collisions(scenario)
                    if renderer == "svg" and source["id"] == "hex-r2":
                        result["activeCheck"] = "receiptFeedback"
                        result["checks"]["receiptFeedback"] = receipt_feedback(scenario)
                    result["activeCheck"] = "otherTurnFlags"
                    result["checks"]["otherTurnFlags"] = other_turn_flags(scenario)
                    result["checks"]["finalDocument"] = no_overflow(page)
                    require(not scenario.errors and not scenario.unmapped,
                            f"runtime/API errors: {scenario.errors} {scenario.unmapped}")
                    require(not scenario.failed_responses, f"failed responses: {scenario.failed_responses}")
                    result["status"] = "PASS"
                    result.pop("activeCheck")
                except Exception as error:
                    result["error"] = str(error)
                    if scenario and hasattr(scenario, "touch_step"):
                        result["touchSubstep"] = scenario.touch_step
                    if scenario:
                        result["layout"] = layout(scenario.page)
                        scenario.page.screenshot(path=str(case_dir / "failure.png"), animations="disabled")
                finally:
                    if scenario:
                        result["runtimeErrors"] = scenario.errors
                        result["consoleErrors"] = scenario.console_errors
                        result["unexpectedApiCalls"] = scenario.unmapped
                        result["assetsVerified"] = scenario.assets
                        scenario.close()
                print(json.dumps({key: result[key] for key in ("name", "status", "activeCheck", "touchSubstep", "error") if key in result}), flush=True)
            browser.close()
        report["sourceDigestAfter"] = board_evidence.tree_hash(paths)
        require(report["sourceDigestAfter"] == report["sourceDigest"], "source changed during verification")
        require(board_evidence.build_manifest()[0] == digest, "build changed during verification")
    finally:
        board_evidence.stop_server(*server)
        report["expectedCases"] = expected_cases
        report["passedCases"] = sum(item["status"] == "PASS" for item in report["cases"])
        (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0 if len(report["cases"]) == expected_cases and all(item["status"] == "PASS" for item in report["cases"]) else 1


if __name__ == "__main__":
    sys.exit(main())
