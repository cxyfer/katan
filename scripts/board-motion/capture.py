#!/usr/bin/env python3
"""Capture the board motion key frames of #80 (build drops) and #91 (roll hold).

The harness serves `packages/web/dist` with its own temporary service and
mocks the API and WebSocket with the deterministic four-seat `hex-r2` fixture,
so the board receives exactly the snapshots the script sends. Time is driven by
hand: Playwright's fake clock is installed after the table has loaded and only
moves when the script advances it, and CSS animations are paused at a chosen
`currentTime`, so every frame is sampled at a fixed point of the animation
regardless of GPU speed.

* Build drops (#80): the piece nearest to the board centre is removed with a
  snapshot that carries no event, then restored with a `build.settlement` /
  `build.road` event. The board is zoomed in and the frames are cropped around
  the landing point: in the air with a faint shadow, close to the ground with a
  larger, darker shadow, the landing squash, and the settled piece. The SVG board
  is always captured; the 3D diorama is captured when headless Chromium can
  create a WebGL context, otherwise it is recorded as skipped in `report.json`.
* Roll hold (#91): a Cities & Knights barbarian attack is delivered with the
  roll. While the dice presentation runs, the board still shows the pre-roll
  position (active knight, walled city, no robber); once the presentation ends
  the attack result appears. The Cities & Knights module is a hand-built
  projection laid over the fixture, not an engine-played game.

Run after `pnpm build`:

    python3 scripts/board-motion/capture.py --out test-results/board-motion

The output directory must be new and empty. Copy the screenshots into
`docs/screenshots/board-motion/` when updating that review set.
"""
from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import math
import time
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("board_evidence", ROOT / "scripts/board-3d/verify.py")
board = importlib.util.module_from_spec(spec)
spec.loader.exec_module(board)

FIXTURE = ROOT / "docs/aegis/work/2026-10-29-board-3d/evidence/fixtures-final.json"
BOARD_ID = "hex-r2"
DESKTOP = (1366, 768)
ZOOM_STEPS = 4
CLOCK_START = 1_800_000_000_000
CROP = (480, 400)
# p1's first settlement and the road that leaves it (edge 16 joins vertices 14 and 15).
DROP_VERTEX = 14
DROP_EDGE = 16
VIEW_CENTRE = (683, 420)
# The roll frames keep the whole table between the top bar and the hand dock (keeps each PNG under 1 MB).
ROLL_CLIP = {"x": 0, "y": 50, "width": 1366, "height": 660}
# Key frames (ms after the drop starts): in the air, near the ground, landing squash.
BUILDING_FRAMES = {"svg": (120, 280, 340), "r3f": (120, 340)}
ROAD_FRAMES = {"svg": (100, 300), "r3f": (100, 300)}
BUILDING_MS = 640
ROAD_MS = 560
DICE_PRESENTATION_MS = 2500

# Cities & Knights layout laid over the fixture (vertex indices of hex-r2).
CK_KNIGHT = 1
CK_WALLED_CITY = 2
CK_PLAIN_CITY = 4
CK_METROPOLIS = 0


IGNORED_ERRORS = {"loaded asset hash mismatch: /"}


def upgrade_fixture(fixture: dict) -> dict:
    """The fixture predates a few required config and profile fields; fill them so the lobby renders."""
    fixture["config"]["limits"].setdefault("roomCapacityMax", 6)
    fixture["config"].setdefault("bots", {"enabled": False, "levels": []})
    for profile in fixture["profiles"]:
        profile.setdefault("ruleVersion", "base-2025.1")
        profile.setdefault("expansions", [])
        profile.setdefault("variants", [])
        profile.setdefault("requiredBoxes", [])
        profile.setdefault("botSeats", False)
    return fixture


def page_errors(current) -> list[str]:
    return [error for error in current.errors if error not in IGNORED_ERRORS]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def wait_for(page, predicate, message: str, timeout: float = 15.0) -> None:
    """Poll with real time; `wait_for_function` would stall while the fake clock is paused."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        page.wait_for_timeout(50)
    raise AssertionError(message)


def tick(page, milliseconds: int) -> None:
    page.clock.run_for(milliseconds)
    page.evaluate("() => new Promise(resolve => queueMicrotask(resolve))")


def freeze_clock(page) -> None:
    page.clock.install(time=CLOCK_START)
    page.clock.pause_at(CLOCK_START + 1_000)


def pause_animations(page, milliseconds: int) -> None:
    page.evaluate("""time => document.getAnimations().forEach(animation => {
      animation.currentTime = time; animation.pause();
    })""", milliseconds)


def derive(snapshot: dict, events=(), mutate=None) -> dict:
    """A later projection: revision +1 and one numbered event per entry."""
    result = copy.deepcopy(snapshot)
    result["revision"] += 1
    view = result["view"]
    for event_type, params in events:
        view["seq"] += 1
        view["events"].append({"seq": view["seq"], "type": event_type, "params": params})
    if mutate:
        mutate(view)
    return result


def centre(page, kind: str, index: int) -> tuple[float, float]:
    box = page.get_by_test_id(f"inspect-{kind}-{index}").bounding_box()
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def pan_to(page, points: list[tuple[float, float]], target: tuple[float, float]) -> None:
    """Shift-drag the board (pans in both renderers) so the middle of `points` lands on `target`."""
    middle = (sum(x for x, _ in points) / len(points), sum(y for _, y in points) / len(points))
    start = (683, 385)
    page.keyboard.down("Shift")
    page.mouse.move(*start)
    page.mouse.down()
    page.mouse.move(start[0] + target[0] - middle[0], start[1] + target[1] - middle[1], steps=10)
    page.mouse.up()
    page.keyboard.up("Shift")
    # Leave the board so no hover tooltip or hit outline ends up in the crops.
    page.mouse.move(683, 25)
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    page.wait_for_timeout(1000)
    require(page.get_by_test_id("inspection-detail").count() == 0, "a hover tooltip is still open")


def crop_around(point: tuple[float, float], size: tuple[int, int], viewport: tuple[int, int], lift: float) -> dict:
    """A clip centred above the landing point, kept inside the viewport."""
    x = min(max(point[0] - size[0] / 2, 0), viewport[0] - size[0])
    y = min(max(point[1] - lift - size[1] / 2, 0), viewport[1] - size[1])
    return {"x": round(x), "y": round(y), "width": size[0], "height": size[1]}


def ck_module(*, after: bool) -> dict:
    """Hand-built Cities & Knights projection: before and after the barbarians land."""
    module = {
        "barbarian": {"position": 0 if after else 6, "length": 7, "attacks": 1 if after else 0},
        "barbarianStrength": 3, "defenderStrength": 0 if after else 2, "robberActive": after,
        "lastRoll": {"event": "ship", "red": 6, "atSeq": 23} if after else {"event": "science", "red": 2, "atSeq": 10},
        "knights": [
            {"player": "p1", "vertex": CK_KNIGHT, "level": 2, "active": not after, "fresh": False, "promoted": False},
        ],
        "walls": [] if after else [{"vertex": CK_WALLED_CITY, "player": "p2"}],
        "toppled": [CK_WALLED_CITY] if after else [],
        "metropolises": {"science": {"player": "p1", "vertex": CK_METROPOLIS}, "trade": None, "politics": None},
    }
    if after:
        module["lastAttack"] = {
            "atSeq": 25, "barbarians": 3, "defenders": 0, "contributions": {}, "outcome": "barbarians",
            "losers": ["p2", "p3"], "defender": None, "tied": [],
            "pillaged": [{"player": "p2", "vertex": CK_WALLED_CITY}, {"player": "p3", "vertex": CK_PLAIN_CITY}],
        }
    return module


def ck_before(baseline: dict) -> dict:
    """Pre-roll position: p1's turn, a science metropolis, a walled city, an active knight."""
    snapshot = copy.deepcopy(baseline)
    view = snapshot["view"]
    view["board"]["buildings"][CK_METROPOLIS] = {"player": "p1", "city": True}
    view["board"]["buildings"][CK_WALLED_CITY] = {"player": "p2", "city": True}
    view["board"]["buildings"][CK_PLAIN_CITY] = {"player": "p3", "city": True}
    for player in view["players"]:
        if player["id"] == "p2":
            player["cityWalls"] = 1
    view["modules"] = {"citiesKnights": ck_module(after=False)}
    return snapshot


def ck_after(before: dict) -> dict:
    """The roll that brings the barbarians: p2's city topples and loses its wall, p3's city drops to a settlement."""
    def mutate(view: dict) -> None:
        view["turn"].update(phase="action", dice=[2, 6])
        view["hints"].update(canRoll=False, canEndTurn=True)
        view["board"]["buildings"][CK_WALLED_CITY] = {"player": "p2", "city": False}
        view["board"]["buildings"][CK_PLAIN_CITY] = {"player": "p3", "city": False}
        for player in view["players"]:
            if player["id"] == "p2":
                player["cityWalls"] = 0
        view["modules"] = {"citiesKnights": ck_module(after=True)}

    return derive(before, [
        ("turn.rolled", {"playerId": "p1", "dice": [2, 6], "total": 8, "extra": {"event": "ship", "red": 6}}),
        ("ck.eventRolled", {"event": "ship", "red": 6}),
        ("ck.barbariansAdvanced", {"position": 0, "length": 7}),
        ("ck.barbariansAttack", {"barbarians": 3, "defenders": 0, "outcome": "barbarians"}),
        ("ck.cityPillaged", {"playerId": "p2", "vertex": CK_WALLED_CITY, "wallLost": True, "toppled": True}),
        ("ck.cityPillaged", {"playerId": "p3", "vertex": CK_PLAIN_CITY, "wallLost": False, "toppled": False}),
        ("ck.robberEntered", {"hex": view_robber(before)}),
    ], mutate)


def view_robber(snapshot: dict) -> int:
    return snapshot["view"]["board"]["robber"]


def capture(out: Path, renderers: list[str]) -> dict:
    fixture = upgrade_fixture(json.loads(FIXTURE.read_text(encoding="utf-8")))
    source = next(item for item in fixture["boards"] if item["id"] == BOARD_ID)
    baseline = source["baseline"]
    settled_start = source["sequence"][0]["snapshot"]
    result: dict = {"screenshots": [], "renderers": {}, "checks": {}, "fixture": str(FIXTURE.relative_to(ROOT))}
    server = (None, None, None)
    scenario = None

    def shot(page, name: str, clip: dict | None = None) -> None:
        options = {"clip": clip} if clip else {}
        page.screenshot(path=str(out / name), animations="allow", **options)
        result["screenshots"].append(name)

    def open_scenario(browser, base, renderer: str, locale: str, start: dict):
        fixture_source = {**source, "motion-start": start}
        return board.Scenario(
            browser, base, SimpleNamespace(renderer=renderer, quality="standard"), fixture, fixture_source,
            locale, DESKTOP, out, initial="motion-start", motion="no-preference")

    def renderer_ready(current, renderer: str) -> bool:
        state = current.state()
        result["renderers"].setdefault(renderer, {}).update(
            effective=state["effective"], status=state["status"], fallbackReason=state["fallbackReason"])
        return state["effective"] == renderer

    def send_and_wait(current, snapshot: dict, settle_ms: int = 450) -> None:
        current.send(snapshot)
        # The socket stays asynchronous while the fake clock is paused.
        current.page.wait_for_timeout(settle_ms)
        tick(current.page, 0)

    def drops(browser, base, renderer: str) -> None:
        nonlocal scenario
        locale = "zh-Hant"
        scenario = open_scenario(browser, base, renderer, locale, settled_start)
        page = scenario.page
        if not renderer_ready(scenario, renderer):
            result["renderers"][renderer]["skipped"] = "headless Chromium did not create a WebGL context"
            scenario.close()
            scenario = None
            return
        for _ in range(ZOOM_STEPS):
            page.get_by_test_id("zoom-in").click()
        page.wait_for_timeout(900)
        start = scenario.snapshot
        board_state = start["view"]["board"]
        vertex, edge = DROP_VERTEX, DROP_EDGE
        building = board_state["buildings"][vertex]
        road = board_state["roads"][edge]
        require(building and not building["city"] and road and building["player"] == road["player"],
                "the drop pair is no longer a settlement with its own road")
        # Bring the pair to the middle of the board so the whole fall stays on screen.
        pan_to(page, [centre(page, "vertex", vertex), centre(page, "edge", edge)], VIEW_CENTRE)
        vertex_point, edge_point = centre(page, "vertex", vertex), centre(page, "edge", edge)
        require(math.dist(vertex_point, VIEW_CENTRE) < 120, f"the settlement is not near the view centre: {vertex_point}")
        building_clip = crop_around(vertex_point, CROP, DESKTOP, 60)
        road_clip = crop_around(edge_point, CROP, DESKTOP, 50)
        zoom = page.get_by_test_id("board").get_attribute("data-zoom")
        result["checks"][f"{renderer}-drop"] = {"vertex": vertex, "edge": edge, "zoom": zoom,
                                                "buildingClip": building_clip, "roadClip": road_clip}
        freeze_clock(page)

        # Take the two pieces away without any event, so nothing replays.
        def remove(view: dict) -> None:
            view["board"]["buildings"][vertex] = None
            view["board"]["roads"][edge] = None

        removed = derive(start, mutate=remove)
        send_and_wait(scenario, removed)
        tick(page, 50)
        if renderer == "svg":
            require(page.get_by_test_id(f"building-{vertex}").count() == 0, "the settlement was not removed")
            require(page.get_by_test_id(f"road-{edge}").count() == 0, "the road was not removed")

        # Drop the settlement back.
        def place_building(view: dict) -> None:
            view["board"]["buildings"][vertex] = building

        built = derive(removed, [("build.settlement", {"playerId": building["player"], "vertex": vertex})], place_building)
        # CSS animations run on the real timeline: poll for the piece instead of sleeping.
        send_and_wait(scenario, built, 0 if renderer == "svg" else 450)
        if renderer == "svg":
            wait_for(page, lambda: page.locator(".board__building-drop").count() == 1, "the settlement did not start to fall")
            require(page.locator(".board__drop-shadow").count() == 1, "the landing shadow is missing")
        elapsed = 0
        for frame in BUILDING_FRAMES[renderer]:
            if renderer == "svg":
                pause_animations(page, frame)
            else:
                tick(page, frame - elapsed)
                elapsed = frame
            shot(page, f"{renderer}-settlement-drop-t{frame}ms-1366x768-{locale}.png", building_clip)
        tick(page, BUILDING_MS + 400)
        if renderer == "svg":
            wait_for(page, lambda: page.locator(".board__building-drop").count() == 0, "the settlement drop did not end")
        if renderer == "svg":
            shot(page, f"{renderer}-settlement-settled-1366x768-{locale}.png", building_clip)

        # Then the road.
        def place_road(view: dict) -> None:
            view["board"]["roads"][edge] = road

        paved = derive(built, [("build.road", {"playerId": road["player"], "edge": edge, "free": False})], place_road)
        send_and_wait(scenario, paved, 0 if renderer == "svg" else 450)
        if renderer == "svg":
            wait_for(page, lambda: page.locator(".board__road-drop").count() == 1, "the road did not start to fall")
        elapsed = 0
        for frame in ROAD_FRAMES[renderer]:
            if renderer == "svg":
                pause_animations(page, frame)
            else:
                tick(page, frame - elapsed)
                elapsed = frame
            shot(page, f"{renderer}-road-drop-t{frame}ms-1366x768-{locale}.png", road_clip)
        tick(page, ROAD_MS + 400)
        require(not page_errors(scenario), f"page errors: {page_errors(scenario)}")
        result["checks"][f"{renderer}-drop"]["consoleErrors"] = scenario.console_errors
        scenario.close()
        scenario = None

    def roll_hold(browser, base, renderer: str) -> None:
        nonlocal scenario
        locale = "en"
        before = ck_before(baseline)
        after = ck_after(before)
        scenario = open_scenario(browser, base, renderer, locale, before)
        page = scenario.page
        if not renderer_ready(scenario, renderer):
            result["renderers"][renderer]["skipped"] = "headless Chromium did not create a WebGL context"
            scenario.close()
            scenario = None
            return
        if renderer == "r3f":
            # The tilted island is small at the fitted view: zoom in and centre the pillaged cities and the desert.
            pan_to(page, [centre(page, "vertex", CK_WALLED_CITY), centre(page, "vertex", CK_PLAIN_CITY),
                          centre(page, "hex", view_robber(before))], VIEW_CENTRE)
            for _ in range(2):
                page.get_by_test_id("zoom-in").click()
            page.mouse.move(683, 25)
            page.wait_for_timeout(800)
        else:
            page.mouse.move(683, 25)
            page.evaluate("() => document.activeElement && document.activeElement.blur()")
        freeze_clock(page)

        def board_state() -> dict:
            return {
                "knight": page.get_by_test_id(f"knight-{CK_KNIGHT}").get_attribute("data-active"),
                "walledCity": page.get_by_test_id(f"building-{CK_WALLED_CITY}").locator("title").text_content(),
                "wall": page.get_by_test_id(f"wall-{CK_WALLED_CITY}").count(),
                "plainCity": page.get_by_test_id(f"building-{CK_PLAIN_CITY}").locator("title").text_content(),
                "robber": page.get_by_test_id("robber").count(),
            } if renderer == "svg" else {}

        if renderer == "svg":
            pre = board_state()
            require(pre["knight"] == "true" and "City" in pre["walledCity"] and pre["wall"] == 1 and pre["robber"] == 0,
                    f"unexpected pre-roll board: {pre}")
        send_and_wait(scenario, after)
        wait_for(page, lambda: page.get_by_test_id("dice-focus").count() == 1, "the dice presentation did not start")
        tick(page, 900)
        page.get_by_test_id("dice-focus").evaluate(
            "element => element.getAnimations({subtree: true}).forEach(animation => { animation.currentTime = 600; animation.pause(); })")
        rolling = page.get_by_test_id("dice-focus").get_attribute("data-phase")
        held = board_state()
        if renderer == "svg":
            require(held == pre, f"the board changed during the roll presentation: {held} vs {pre}")
        shot(page, f"{renderer}-roll-hold-rolling-1366x768-{locale}.png", ROLL_CLIP)
        tick(page, DICE_PRESENTATION_MS)
        wait_for(page, lambda: page.get_by_test_id("dice-focus").count() == 0, "the dice presentation did not end")
        tick(page, 400)
        released = board_state()
        if renderer == "svg":
            require(released["knight"] == "false" and "Settlement" in released["walledCity"] and released["wall"] == 0
                    and "Settlement" in released["plainCity"] and released["robber"] == 1,
                    f"the attack result is not on the board after the presentation: {released}")
        shot(page, f"{renderer}-roll-hold-released-1366x768-{locale}.png", ROLL_CLIP)
        result["checks"][f"{renderer}-roll-hold"] = {"dicePhase": rolling, "held": held, "released": released}
        require(not page_errors(scenario), f"page errors: {page_errors(scenario)}")
        scenario.close()
        scenario = None

    try:
        base, child, temporary, log = board.start_server(out)
        server = (child, temporary, log)
        from playwright.sync_api import sync_playwright

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, args=["--enable-unsafe-swiftshader", "--no-sandbox"])
            for renderer in renderers:
                drops(browser, base, renderer)
            for renderer in renderers:
                roll_hold(browser, base, renderer)
            browser.close()
        return result
    finally:
        if scenario:
            try:
                scenario.close()
            except Exception:
                # Playwright may already have stopped after a failed assertion;
                # keep the original failure rather than masking it here.
                pass
        if server[0]:
            board.stop_server(*server)
        (out / "report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def output_path(value: str) -> Path:
    path = Path(value)
    path = path if path.is_absolute() else ROOT / path
    if path.exists() and any(path.iterdir()):
        raise SystemExit(f"refusing to overwrite a non-empty directory: {path}")
    path.mkdir(parents=True, exist_ok=True)
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="test-results/board-motion")
    parser.add_argument("--renderers", default="svg,r3f", help="comma-separated: svg, r3f")
    args = parser.parse_args()
    renderers = [item for item in args.renderers.split(",") if item]
    require(set(renderers) <= {"svg", "r3f"} and renderers, f"unknown renderers: {renderers}")
    out = output_path(args.out)
    result = capture(out, renderers)
    print(json.dumps({"out": str(out), **result}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
