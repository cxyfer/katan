#!/usr/bin/env python3
"""Capture Traders & Barbarians boards and panels for review.

Drives the production build (``pnpm build``) with the deterministic board-3d
API/WebSocket fixtures. ``fixtures.mjs`` replaces the game snapshot with a
real rules-engine state per scenario (setup played with seeded placements,
then scenario pieces), so every capture shows engine-projected data:

* each scenario's board in the SVG and 3D renderers, desktop and phone;
* the scenario tool panel (desktop, SVG);
* the mandatory prompt of a scenario choice where the fixture opens one.

``--live`` additionally plays a short real game against the production
server (three guest sessions over HTTP) and captures the scenario panel and
board of that live game, up to the first turn. The scenario-specific actions
(fishing, bridges, wagons, captures, robber rules, ...) are played through the
UI by ``live.py`` for every enabled profile in SVG and 3D.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import re
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
IGNORED_ERRORS = {"loaded asset hash mismatch: /"}


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_fixtures(only: list[str] | None) -> tuple[dict, dict]:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    generated = json.loads(subprocess.run(
        ["node", str(ROOT / "scripts/traders-barbarians/fixtures.mjs"), str(FIXTURE)],
        check=True, capture_output=True, text=True, cwd=ROOT).stdout)
    fixture["profiles"] = generated["profiles"]
    base = next(board for board in fixture["boards"] if board["id"] == "hex-r2")
    boards = {}
    for scenario_id, scenario in generated["scenarios"].items():
        if only and scenario_id not in only:
            continue
        board = copy.deepcopy(base)
        board.update(id=scenario_id, topologyId=scenario["topologyId"], snapshot=scenario["snapshot"])
        board["historySnapshot"] = scenario["snapshot"]
        if isinstance(board.get("room"), dict):
            board["room"]["profileId"] = scenario["profileId"]
        boards[scenario_id] = board
    fixture["boards"] = list(boards.values())
    return fixture, boards


def settle(page):
    page.mouse.move(1, 1)
    page.wait_for_timeout(SETTLE_MS)
    page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")


def open_scenario(browser, base, fixture, board, renderer, viewport, out):
    return board_evidence.Scenario(
        browser, base, SimpleNamespace(renderer=renderer, quality="standard"), fixture, board,
        "zh-Hant" if viewport == "mobile" else "en", VIEWPORTS[viewport], out, initial="snapshot", motion="reduce")


def finish(case, scenario, path):
    case["sha256"] = sha256(path)
    errors = [error for error in scenario.errors if error not in IGNORED_ERRORS]
    require(not errors and not scenario.console_errors and not scenario.failed_responses,
            f"runtime errors: {errors} {scenario.console_errors} {scenario.failed_responses}")
    case["status"] = "PASS"


def board_case(browser, base, fixture, board, renderer, viewport, out, report):
    name = f"{board['id']}-{renderer}-{viewport}"
    case = {"name": name, "kind": "board", "board": board["id"], "renderer": renderer,
            "viewport": VIEWPORTS[viewport], "status": "FAIL"}
    report["cases"].append(case)
    scenario = open_scenario(browser, base, fixture, board, renderer, viewport, out)
    page = scenario.page
    try:
        page.wait_for_function(
            "(renderer) => document.querySelector('[data-testid=\"board\"]')?.dataset.effectiveRenderer === renderer",
            arg=renderer, timeout=40000)
        if renderer == "svg":
            case["svgHexes"] = page.locator('[data-testid^="hex-"]').count()
            case["fishingGrounds"] = page.locator(".tb-ground").count()
        settle(page)
        path = out / f"{name}.png"
        page.screenshot(path=str(path), animations="disabled")
        finish(case, scenario, path)
    except Exception as error:
        case["error"] = str(error)
        page.screenshot(path=str(out / f"{name}-failure.png"), animations="disabled")
    finally:
        scenario.close()


def panel_case(browser, base, fixture, board, out, report):
    name = f"{board['id']}-panel-desktop"
    case = {"name": name, "kind": "panel", "board": board["id"], "status": "FAIL"}
    report["cases"].append(case)
    scenario = open_scenario(browser, base, fixture, board, "svg", "desktop", out)
    page = scenario.page
    try:
        page.get_by_test_id("tool-tab-scenario").click()
        page.get_by_test_id("tb-panel").wait_for(timeout=20000)
        page.wait_for_timeout(SETTLE_MS)
        path = out / f"{name}.png"
        page.screenshot(path=str(path), animations="disabled")
        panel = out / f"{board['id']}-panel-detail.png"
        page.get_by_test_id("tb-panel").screenshot(path=str(panel), animations="disabled")
        case["panelSha256"] = sha256(panel)
        finish(case, scenario, path)
    except Exception as error:
        case["error"] = str(error)
        page.screenshot(path=str(out / f"{name}-failure.png"), animations="disabled")
    finally:
        scenario.close()


LIVE_PROFILES = {
    "tb-fishing": "tb-fishing-2025",
    "tb-rivers": "tb-rivers-2025",
    "tb-merchant-trains": "tb-merchant-trains-2025",
    "tb-barbarian-attack": "tb-barbarian-attack-2025",
    "tb-traders-barbarians": "tb-traders-barbarians-2025",
}


class LiveError(AssertionError):
    pass


def api(request, method, path, body=None):
    response = request.fetch(path, method=method, data=json.dumps(body) if body is not None else None,
                             headers={"Content-Type": "application/json"})
    payload = response.json()
    if not payload.get("ok"):
        raise LiveError(f"{method} {path}: {payload.get('error')}")
    return payload["data"]


def command(request, game_id, revision, cmd, tag):
    receipt = api(request, "POST", f"/api/games/{game_id}/commands",
                  {"commandId": f"{tag}-{revision}", "expectedRevision": revision, "command": cmd})
    if receipt["outcome"] != "accepted":
        raise LiveError(f"{cmd['type']} rejected: {receipt.get('error')}")
    return receipt["revision"]


def live_game(browser, base, profile_id, players=3):
    """Plays a real game's setup over HTTP with seeded-free legal choices; returns contexts and ids."""
    contexts = []
    for index in range(players):
        context = browser.new_context(base_url=base, viewport={"width": 1366, "height": 900}, device_scale_factor=1,
                                      locale="en-US", reduced_motion="reduce", service_workers="block")
        context.add_init_script("localStorage.setItem('catan.locale', 'en');")
        player = api(context.request, "POST", "/api/session", {"nickname": f"Live {index + 1}", "locale": "en"})["player"]
        contexts.append((context, player["id"]))
    host = contexts[0][0].request
    room = api(host, "POST", "/api/rooms", {"visibility": "private", "capacity": players, "profileId": profile_id, "setupMode": "variable"})
    for context, _ in contexts[1:]:
        api(context.request, "POST", "/api/rooms/join", {"code": room["code"]})
    for context, _ in contexts:
        api(context.request, "POST", f"/api/rooms/{room['id']}/ready", {"ready": True})
    game_id = api(host, "POST", f"/api/rooms/{room['id']}/start")["gameId"]
    by_id = {player_id: context for context, player_id in contexts}
    for _ in range(40):
        snapshot = api(host, "GET", f"/api/games/{game_id}")
        view = snapshot["view"]
        if view["turn"]["phase"] != "setup":
            break
        actor = by_id[view["turn"]["playerId"]]
        mine = api(actor.request, "GET", f"/api/games/{game_id}")["view"]
        hints = mine["hints"]
        stage = view["turn"]["setup"]["stage"]
        cmd = ({"type": "setup.placeRoad", "edge": hints["legalRoads"][len(hints["legalRoads"]) // 2]} if stage == "road"
               else {"type": "setup.placeBuilding", "vertex": hints["legalSettlements"][len(hints["legalSettlements"]) // 3]})
        command(actor.request, game_id, snapshot["revision"], cmd, "setup")
    return contexts, by_id, game_id


def live_case(browser, base, scenario_id, out, report):
    name = f"{scenario_id}-live"
    case = {"name": name, "kind": "live", "board": scenario_id, "status": "FAIL"}
    report["cases"].append(case)
    contexts = []
    try:
        contexts, by_id, game_id = live_game(browser, base, LIVE_PROFILES[scenario_id])
        host = contexts[0][0].request
        snapshot = api(host, "GET", f"/api/games/{game_id}")
        actor_id = snapshot["view"]["turn"]["playerId"]
        actor = by_id[actor_id]
        revision = command(actor.request, game_id, snapshot["revision"], {"type": "turn.roll"}, "roll")
        view = api(actor.request, "GET", f"/api/games/{game_id}")["view"]
        case["pendingAfterRoll"] = (view.get("pending") or {}).get("kind")
        if scenario_id == "tb-traders-barbarians" and not view.get("pending"):
            # The end of turn opens the live wagon move with board targets.
            revision = command(actor.request, game_id, revision, {"type": "turn.end"}, "end")
            view = api(actor.request, "GET", f"/api/games/{game_id}")["view"]
            case["pending"] = (view.get("pending") or {}).get("kind")
        page = actor.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(base + "/?renderer=svg", wait_until="networkidle")
        resume = page.get_by_test_id(f"resume-{game_id}")
        if page.get_by_test_id("game-stage").count() == 0:
            page.get_by_role("tab", name=re.compile("Resume|Saved", re.I)).first.click() if page.get_by_role("tab").count() else None
            resume.click()
        page.get_by_test_id("game-stage").wait_for(timeout=30000)
        settle(page)
        board_path = out / f"{name}-board.png"
        page.screenshot(path=str(board_path), animations="disabled")
        page.get_by_test_id("tool-tab-scenario").click()
        page.get_by_test_id("tb-panel").wait_for(timeout=20000)
        page.wait_for_timeout(500)
        panel_path = out / f"{name}-panel.png"
        page.get_by_test_id("tb-panel").screenshot(path=str(panel_path), animations="disabled")
        case["sha256"] = sha256(board_path)
        case["panelSha256"] = sha256(panel_path)
        case["gameId"] = game_id
        require(not errors, f"page errors: {errors}")
        case["status"] = "PASS"
    except Exception as error:
        case["error"] = str(error)
    finally:
        for context, _ in contexts:
            context.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="test-results/traders-barbarians")
    parser.add_argument("--executable-path")
    parser.add_argument("--scenario", action="append", help="limit to scenario ids (repeatable)")
    parser.add_argument("--viewport", choices=("all", *VIEWPORTS), default="all")
    parser.add_argument("--renderer", choices=("all", "svg", "r3f"), default="all")
    parser.add_argument("--live", action="store_true", help="also play real games against the production server")
    parser.add_argument("--live-only", action="store_true", help="only the live-game cases")
    args = parser.parse_args()
    out = board_evidence.output_path(args.out)
    fixture, boards = load_fixtures(args.scenario)
    viewports = list(VIEWPORTS) if args.viewport == "all" else [args.viewport]
    renderers = ["svg", "r3f"] if args.renderer == "all" else [args.renderer]
    report = {"sourceHead": board_evidence.git(["rev-parse", "HEAD"]),
              "buildDigest": board_evidence.build_manifest()[0], "cases": [],
              "limitations": [
                  "Chromium with software WebGL; physical devices, Safari/Firefox and screen readers not run.",
                  "Board/panel cases use deterministic API/WebSocket fixtures carrying rules-engine projections.",
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
            if not args.live_only:
                for board in boards.values():
                    for renderer in renderers:
                        for viewport in viewports:
                            board_case(browser, base, fixture, board, renderer, viewport, out, report)
                    panel_case(browser, base, fixture, board, out, report)
            if args.live or args.live_only:
                for scenario_id in boards:
                    live_case(browser, base, scenario_id, out, report)
            browser.close()
    finally:
        if server[0] is not None:
            board_evidence.stop_server(*server)
    (out / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    failed = [case["name"] for case in report["cases"] if case["status"] == "FAIL"]
    print(json.dumps({"out": str(out), "cases": len(report["cases"]), "failed": failed}, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
