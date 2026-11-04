#!/usr/bin/env python3
"""Browser evidence for the floating HUD on short landscape phones (#89) and for
the save state that stays visible in that layout (#90), on the production build.

The harness serves `packages/web/dist` with a real service and the deterministic
four-seat `hex-r2` fixture (the table API and WebSocket are answered from the
fixture, as in scripts/notice-dismiss). Phones are emulated with touch so the
`(pointer: coarse)` part of the compact-landscape query matches:

* 1366x768 desktop for reference (header and tool band stay as they are);
* 844x390, 740x360 and 568x320: the header becomes a floating control cluster at
  the top right, the tool band floating icon buttons at the bottom left, and the
  board takes the full height;
* the action rail and the target-list popover stay tappable above the HUD;
* the save request is held and then answered with a failed receipt: "saving" and
  "save failed" stay visible in the status strip while the table menu is closed
  (they are the only save states shown in this layout).

Run after `pnpm build`:

    python3 scripts/compact-hud/capture.py --out test-results/compact-hud

The output directory must be new and empty.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import socket
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import urlopen

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "packages/web/dist"
SERVER_ENTRY = ROOT / "packages/server/dist/server.mjs"
FIXTURE = ROOT / "docs/aegis/work/2026-10-29-board-3d/evidence/fixtures-final.json"
BOARD_ID = "hex-r2"
BASE = ""
TIMEOUT_MS = 60_000
PHONE_SCALE = 1
SAVE_PATH = "/api/games/g1/save"

# 2026-10-29 的 fixture 早於 profile 改版；補上 ProfileView 現行必填欄位。
PROFILE_DEFAULTS = {
    "ruleVersion": "2025",
    "expansions": [],
    "variants": [],
    "requiredBoxes": ["base"],
    "botSeats": True,
}


def free_port() -> int:
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        return int(reservation.getsockname()[1])


def fixture_profiles(fixture: dict) -> list[dict]:
    return [{**PROFILE_DEFAULTS, **profile} for profile in fixture["profiles"]]


def start_server(out: Path):
    global BASE
    if not SERVER_ENTRY.is_file() or not (DIST / "index.html").is_file():
        raise SystemExit("built artifacts missing; run pnpm build first")
    temporary = tempfile.TemporaryDirectory(prefix="catan-compact-hud-")
    log = (out / "server.log").open("w", encoding="utf-8")
    port = free_port()
    env = {
        **os.environ,
        "HOST": "127.0.0.1",
        "PORT": str(port),
        "SQLITE_PATH": str(Path(temporary.name) / "capture.sqlite"),
        "DATABASE_URL": "",
        "DATABASE_SCHEMA": "",
        "WEB_DIST_PATH": str(DIST),
        "LOG_LEVEL": "warn",
    }
    child = subprocess.Popen(["node", str(SERVER_ENTRY)], cwd=ROOT, env=env, stdout=log, stderr=log)
    BASE = f"http://127.0.0.1:{port}"
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise SystemExit(f"service exited {child.returncode}; see {out / 'server.log'}")
        try:
            with urlopen(BASE + "/healthz", timeout=2) as response:
                if response.status == 200:
                    return child, temporary, log
        except OSError:
            time.sleep(0.25)
    child.terminate()
    raise SystemExit(f"service did not become healthy; see {out / 'server.log'}")


def stop_server(child, temporary, log) -> None:
    if child is not None and child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=8)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=5)
    if log is not None:
        log.close()
    if temporary is not None:
        temporary.cleanup()


class Table:
    """One browser context on the fixture table; the API and socket are answered locally."""

    def __init__(self, browser, locale: str, size: tuple[int, int], *, touch: bool):
        self.fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        self.board = next(item for item in self.fixture["boards"] if item["id"] == BOARD_ID)
        self.snapshot = copy.deepcopy(self.board["snapshot"])
        self.sockets: list = []
        self.errors: list[str] = []
        self.overrides: dict = {}
        options = {
            "viewport": {"width": size[0], "height": size[1]},
            "locale": "zh-TW" if locale == "zh-Hant" else "en-US",
            "reduced_motion": "reduce",
            "service_workers": "block",
        }
        if touch:
            options.update(has_touch=True, is_mobile=True, device_scale_factor=PHONE_SCALE)
        self.context = browser.new_context(**options)
        self.context.add_init_script(f"localStorage.setItem('catan.locale', {json.dumps(locale)});")
        self.context.route("**/api/**", self.route_api)
        self.context.route_web_socket("**/ws", self.connect_socket)
        self.page = self.context.new_page()
        self.page.set_default_timeout(TIMEOUT_MS)
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))

    def open(self) -> None:
        self.page.goto(BASE + "/?renderer=svg", wait_until="domcontentloaded")
        self.page.locator("#home-tab-resume").click()
        self.page.get_by_test_id("resume-g1").click()
        self.page.get_by_test_id("board").wait_for(state="visible")
        self.page.wait_for_function("document.querySelector('[data-testid=\"board\"]')?.dataset.effectiveRenderer === 'svg'")
        self.settle()
        # 指標留在棋盤中央會展開手牌扇形並顯示 hex 提示，遮住浮動 HUD。
        self.page.mouse.move(2, 2)
        self.settle()

    def settle(self, ms: int = 500) -> None:
        self.page.evaluate("document.fonts.ready")
        self.page.evaluate("() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        self.page.wait_for_timeout(ms)

    def route_api(self, route) -> None:
        request = route.request
        path = urlparse(request.url).path
        handler = self.overrides.get((request.method, path))
        if handler:
            handler(route)
            return
        board = self.board
        data = None
        if path == "/api/config":
            data = self.fixture["config"]
        elif path == "/api/session":
            data = {"player": self.fixture["identity"]}
        elif path == "/api/profiles":
            data = {"profiles": fixture_profiles(self.fixture)}
        elif path == "/api/rooms":
            data = {"rooms": []}
        elif path == "/api/games":
            data = {"games": board["games"]}
        elif path in ("/api/rooms/r1", "/api/games/g1/resume"):
            data = board["room"]
        elif path == "/api/games/g1":
            data = self.snapshot
        elif path == "/api/games/g1/events":
            data = {"events": self.snapshot["view"]["events"], "revision": self.snapshot["revision"]}
        elif path == "/api/rooms/r1/chat":
            data = {"messages": [], "nextSeq": 0, "hasMore": False}
        else:
            route.fulfill(status=501, json={"ok": False, "error": {"code": "E_INVALID_COMMAND", "messageId": "error.E_INVALID_COMMAND"}})
            return
        route.fulfill(status=200, json={"ok": True, "data": data})

    def connect_socket(self, socket_route) -> None:
        self.sockets.append(socket_route)
        socket_route.on_message(lambda _message: None)

    def mutate(self, change) -> None:
        snapshot = copy.deepcopy(self.snapshot)
        snapshot["revision"] += 1
        snapshot["view"]["windowId"] += 1
        change(snapshot["view"])
        self.snapshot = snapshot
        if not self.sockets:
            raise RuntimeError("fixture WebSocket was not connected")
        for socket_route in self.sockets:
            socket_route.send(json.dumps({"type": "snapshot", "payload": snapshot}, separators=(",", ":")))

    def close(self) -> None:
        self.context.close()


def move_robber(view: dict) -> None:
    view["pending"] = {"kind": "moveRobber", "actor": "p1", "cause": "seven", "pirate": False}
    view["hints"]["pendingKind"] = "moveRobber"


def clear_pending(view: dict) -> None:
    view["pending"] = None
    view["hints"]["pendingKind"] = None


class Shots:
    def __init__(self, out: Path, files: list[str]):
        self.out = out
        self.files = files

    def take(self, table: Table, name: str) -> None:
        table.settle()
        table.page.screenshot(path=str(self.out / f"{name}.png"), animations="disabled")
        self.files.append(f"{name}.png")
        print("CAPTURE", name, flush=True)


def layout_facts(table: Table, size: tuple[int, int]) -> dict:
    page = table.page
    facts = page.evaluate("""() => {
      const stage = document.querySelector('[data-testid="game-stage"]');
      const strip = document.querySelector('[data-testid="status-strip"]').getBoundingClientRect();
      const map = document.querySelector('.game__map').getBoundingClientRect();
      const menu = document.querySelector('[data-testid="table-menu"] > summary').getBoundingClientRect();
      return {
        layout: stage.dataset.layout || null,
        coarse: matchMedia('(pointer: coarse)').matches,
        stripPosition: getComputedStyle(document.querySelector('[data-testid="status-strip"]')).position,
        stripRight: Math.round(innerWidth - strip.right), stripTop: Math.round(strip.top), stripHeight: Math.round(strip.height),
        mapHeight: Math.round(map.height), innerHeight, innerWidth,
        pageOverflowX: document.documentElement.scrollWidth - innerWidth,
        pageOverflowY: document.documentElement.scrollHeight - innerHeight,
        menuInside: menu.left >= 0 && menu.top >= 0 && menu.right <= innerWidth + 0.5 && menu.bottom <= innerHeight + 0.5,
      };
    }""")
    if size[0] > 1000:
        assert facts["layout"] is None, f"desktop must keep the regular layout: {facts}"
        return facts
    assert facts["coarse"], f"touch emulation did not give (pointer: coarse): {facts}"
    assert facts["layout"] == "compact-landscape", f"compact layout not active at {size}: {facts}"
    assert facts["stripPosition"] == "absolute", f"status strip is not floating: {facts}"
    assert facts["mapHeight"] == facts["innerHeight"], f"board does not take the full height: {facts}"
    assert facts["pageOverflowX"] <= 0 and facts["pageOverflowY"] <= 0, f"page scrolls: {facts}"
    assert facts["menuInside"], f"menu button leaves the viewport: {facts}"
    return facts


def visible_box(page, test_id: str):
    locator = page.get_by_test_id(test_id)
    if locator.count() == 0 or not locator.is_visible():
        return None
    return locator.bounding_box()


def save_failure_pass(table: Table, shots: Shots, checks: dict, label: str, size: tuple[int, int], locale: str, *,
                      pending_shot: bool = False, menu_shot: bool = False) -> None:
    """Hold the save request, then answer with a failed receipt."""
    page = table.page
    held: list = []
    table.overrides[("POST", SAVE_PATH)] = held.append
    checks[f"{label}IdleHidden"] = visible_box(page, "save-state") is None
    page.get_by_test_id("table-menu").locator("summary").click()
    page.get_by_test_id("save-and-leave").click()
    expect(page.get_by_test_id("save-state")).to_have_attribute("data-state", "pending")
    page.get_by_test_id("table-menu").locator("summary").click()
    expect(page.get_by_test_id("table-menu")).not_to_have_attribute("open", "")
    pending = visible_box(page, "save-state")
    checks[f"{label}PendingVisibleWithMenuClosed"] = pending is not None
    if pending_shot:
        shots.take(table, f"{len(shots.files) + 1:02d}-save-pending-{size[0]}x{size[1]}-{locale}")
    deadline = time.monotonic() + 20
    while not held and time.monotonic() < deadline:
        page.wait_for_timeout(100)
    assert held, "the save request never reached the held route"
    request = held.pop()
    request.fulfill(status=200, json={"ok": True, "data": {
        "requestId": request.request.post_data_json["requestId"],
        "gameId": "g1",
        "revision": table.snapshot["revision"],
        "savedAt": "2026-11-04T00:00:00.000Z",
        "outcome": "failed",
        "error": {"messageId": "error.E_SAVE_FAILED"},
    }})
    expect(page.get_by_test_id("save-state")).to_have_attribute("data-state", "failed")
    box = visible_box(page, "save-state")
    viewport = page.viewport_size
    checks[f"{label}FailedVisibleWithMenuClosed"] = box is not None and box["x"] >= 0 and box["y"] >= 0 \
        and box["x"] + box["width"] <= viewport["width"] + 0.5 and box["y"] + box["height"] <= viewport["height"] + 0.5
    # 失敗訊息不能只躲在收合的選單裡。
    checks[f"{label}MenuClosed"] = page.get_by_test_id("table-menu").get_attribute("open") is None
    shots.take(table, f"{len(shots.files) + 1:02d}-save-failed-{size[0]}x{size[1]}-{locale}")
    if menu_shot:
        page.get_by_test_id("table-menu").locator("summary").click()
        expect(page.get_by_test_id("save-failed")).to_be_visible()
        shots.take(table, f"{len(shots.files) + 1:02d}-save-failed-menu-open-{size[0]}x{size[1]}-{locale}")
        page.get_by_test_id("table-menu").locator("summary").click()


def capture(out: Path) -> dict:
    result: dict = {"screenshots": [], "checks": {}, "layout": {}}
    files = result["screenshots"]
    checks = result["checks"]
    shots = Shots(out, files)
    server = (None, None, None)
    try:
        server = start_server(out)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, args=["--no-sandbox", "--enable-unsafe-swiftshader"])

            # 桌機對照：標題列與工具帶維持原樣。
            desktop = Table(browser, "en", (1366, 768), touch=False)
            try:
                desktop.open()
                result["layout"]["desktop1366x768"] = layout_facts(desktop, (1366, 768))
                shots.take(desktop, "01-desktop-reference-1366x768-en")
                assert not desktop.errors, desktop.errors
            finally:
                desktop.close()

            # 844x390（英文）：浮動 HUD、行動側欄、目標清單、儲存狀態。
            phone = Table(browser, "en", (844, 390), touch=True)
            try:
                phone.open()
                result["layout"]["phone844x390"] = layout_facts(phone, (844, 390))
                shots.take(phone, "02-floating-hud-844x390-en")
                phone.page.get_by_test_id("action-rail-toggle").click()
                phone.page.wait_for_function(
                    "document.querySelector('[data-testid=\"action-rail\"]')?.dataset.expanded === 'true'")
                shots.take(phone, "03-action-rail-open-844x390-en")
                phone.page.get_by_test_id("action-rail-toggle").click()
                phone.mutate(move_robber)
                phone.page.get_by_test_id("open-target-picker").click()
                picker = phone.page.locator(".target-picker")
                picker.wait_for()
                box = picker.bounding_box()
                checks["targetPickerInsideViewport"] = box["x"] >= 0 and box["y"] >= 0 \
                    and box["x"] + box["width"] <= 844.5 and box["y"] + box["height"] <= 390.5
                # 選擇器疊在浮動 HUD 之上：它的中心點拿到的是選擇器本身。
                checks["targetPickerAboveHud"] = phone.page.evaluate(
                    "([x, y]) => !!document.elementFromPoint(x, y)?.closest('.target-picker')",
                    [box["x"] + box["width"] / 2, box["y"] + 12])
                shots.take(phone, "04-target-picker-above-hud-844x390-en")
                phone.page.get_by_test_id("target-picker-close").click()
                phone.mutate(clear_pending)
                save_failure_pass(phone, shots, checks, "phone844", (844, 390), "en", pending_shot=True)
                assert not phone.errors, phone.errors
            finally:
                phone.close()

            # 740x360（繁體中文）：儲存失敗，選單開著與收起各一張。
            phone = Table(browser, "zh-Hant", (740, 360), touch=True)
            try:
                phone.open()
                result["layout"]["phone740x360"] = layout_facts(phone, (740, 360))
                shots.take(phone, f"{len(files) + 1:02d}-floating-hud-740x360-zh-Hant")
                save_failure_pass(phone, shots, checks, "phone740", (740, 360), "zh-Hant", menu_shot=True)
                assert not phone.errors, phone.errors
            finally:
                phone.close()

            # 568x320（英文）：最矮的尺寸。
            phone = Table(browser, "en", (568, 320), touch=True)
            try:
                phone.open()
                result["layout"]["phone568x320"] = layout_facts(phone, (568, 320))
                shots.take(phone, f"{len(files) + 1:02d}-floating-hud-568x320-en")
                save_failure_pass(phone, shots, checks, "phone568", (568, 320), "en")
                assert not phone.errors, phone.errors
            finally:
                phone.close()
            browser.close()
    finally:
        stop_server(*server)
    failed = [name for name, value in checks.items() if value is False]
    assert not failed, f"failed checks: {failed}"
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    out = (ROOT / args.out).resolve()
    if out.exists() and any(out.iterdir()):
        raise SystemExit(f"{out} must be new and empty")
    out.mkdir(parents=True, exist_ok=True)
    result = capture(out)
    (out / "report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"checks": result["checks"], "layout": result["layout"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
