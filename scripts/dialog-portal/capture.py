#!/usr/bin/env python3
"""Browser evidence for dialogs portalled out of the table panels (#92) on the
production build.

`Dialog` used to render inside its caller. The trade settle dialog sits in the
trade panel, whose container query and the clipped tool surface (and the
`translate` on `.game-tools`) made the fixed backdrop anchor to the panel, so the
dialog landed below it and could not be clicked. It is now portalled to
`document.body` (or the fullscreen element). The settle dialog is the only
dialog opened from inside a table panel; the lobby's add-bot dialog uses the same
component but was never inside a clipping ancestor.

The harness serves `packages/web/dist` with a real service and the deterministic
four-seat `hex-r2` fixture (the table API and WebSocket are answered from the
fixture, as in scripts/notice-dismiss). The host has proposed a table-wide offer
that another player consented to, so "Settle" opens the dialog. For each
viewport the run asserts that the backdrop is a child of `<body>` covering the
whole viewport, that the dialog is fully on screen and outside the panel, that
its confirm button is the topmost element at its centre, and that confirming
sends `trade.settle` for the chosen counterparty. Viewports: 1366x768 desktop
(both locales) and touch-emulated short landscape phones 844x390 and 667x375.

Run after `pnpm build`:

    python3 scripts/dialog-portal/capture.py --out test-results/dialog-portal

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
PHONE_SCALE = 2
COMMANDS_PATH = "/api/games/g1/commands"

# 2026-10-29 的 fixture 早於 profile 改版；補上 ProfileView 現行必填欄位。
PROFILE_DEFAULTS = {
    "ruleVersion": "2025",
    "expansions": [],
    "variants": [],
    "requiredBoxes": ["base"],
    "botSeats": True,
}

DIALOG_FACTS = """() => {
  const dialog = document.querySelector('[data-testid="settle-dialog"]');
  const backdrop = dialog.closest('.dialog-backdrop');
  const box = (element) => { const r = element.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; };
  const confirm = document.querySelector('[data-testid="confirm-settle"]').getBoundingClientRect();
  const top = document.elementFromPoint(confirm.left + confirm.width / 2, confirm.top + confirm.height / 2);
  const cancel = document.querySelector('[data-testid="cancel-settle"]').getBoundingClientRect();
  const topCancel = document.elementFromPoint(cancel.left + cancel.width / 2, cancel.top + cancel.height / 2);
  return {
    backdropIsBodyChild: backdrop.parentElement === document.body,
    insidePanel: !!dialog.closest('.trade-panel, .game-tools__surface, .game-tools'),
    backdrop: box(backdrop), dialog: box(dialog), viewport: { width: innerWidth, height: innerHeight },
    confirmReachable: !!top && dialog.contains(top),
    cancelReachable: !!topCancel && dialog.contains(topCancel),
    terms: document.querySelector('[data-testid="settle-dialog-terms"]').textContent,
  };
}"""


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
    temporary = tempfile.TemporaryDirectory(prefix="catan-dialog-portal-")
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
        self.commands: list[dict] = []
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

    def settle(self, ms: int = 500) -> None:
        self.page.evaluate("document.fonts.ready")
        self.page.evaluate("() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        self.page.wait_for_timeout(ms)

    def route_api(self, route) -> None:
        request = route.request
        path = urlparse(request.url).path
        board = self.board
        data = None
        if path == COMMANDS_PATH and request.method == "POST":
            body = request.post_data_json
            self.commands.append(body)
            route.fulfill(status=200, json={"ok": True, "data": {
                "commandId": body["commandId"], "outcome": "accepted", "revision": self.snapshot["revision"], "events": [],
            }})
            return
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


def consented_offer(view: dict) -> None:
    """The host (p1) offers 1 wool for 1 ore to the table; p2 consented and p3 is interested."""
    view["offers"] = [{
        "id": "offer-1", "revision": 1, "from": "p1", "to": "all",
        "give": {"wool": 1}, "want": {"ore": 1},
        "windowId": view["windowId"], "status": "open",
        "responses": {"p2": "consented", "p3": "interested"},
        "agreedWith": None, "createdSeq": 3,
    }]


class Shots:
    def __init__(self, out: Path, files: list[str]):
        self.out = out
        self.files = files

    def take(self, table: Table, name: str) -> None:
        table.settle()
        table.page.screenshot(path=str(self.out / f"{name}.png"), animations="disabled")
        self.files.append(f"{name}.png")
        print("CAPTURE", name, flush=True)


def open_trade_panel(table: Table) -> None:
    page = table.page
    table.mutate(consented_offer)
    page.get_by_test_id("tool-tab-trade").click()
    page.get_by_test_id("offer-offer-1").wait_for()
    page.get_by_test_id("counterparty-offer-1").select_option("p2")
    # 提案清單在「新提案」表單下方，先捲到提案與 Settle 按鈕再截圖。
    page.get_by_test_id("settle-offer-1").scroll_into_view_if_needed()


def open_settle_dialog(table: Table, checks: dict, label: str) -> dict:
    page = table.page
    page.get_by_test_id("settle-offer-1").click()
    page.get_by_test_id("settle-dialog").wait_for()
    table.settle()
    facts = page.evaluate(DIALOG_FACTS)
    viewport = facts["viewport"]
    backdrop, dialog = facts["backdrop"], facts["dialog"]
    facts["backdropCoversViewport"] = abs(backdrop["x"]) < 1 and abs(backdrop["y"]) < 1 \
        and abs(backdrop["width"] - viewport["width"]) < 1 and abs(backdrop["height"] - viewport["height"]) < 1
    facts["dialogInsideViewport"] = dialog["x"] >= 0 and dialog["y"] >= 0 \
        and dialog["x"] + dialog["width"] <= viewport["width"] + 0.5 and dialog["y"] + dialog["height"] <= viewport["height"] + 0.5
    checks[f"{label}Dialog"] = facts
    assert facts["backdropIsBodyChild"], f"{label}: backdrop is not a child of <body>: {facts}"
    assert not facts["insidePanel"], f"{label}: dialog is still inside the trade panel: {facts}"
    assert facts["backdropCoversViewport"], f"{label}: backdrop does not cover the viewport: {facts}"
    assert facts["dialogInsideViewport"], f"{label}: dialog leaves the viewport: {facts}"
    assert facts["confirmReachable"] and facts["cancelReachable"], f"{label}: dialog buttons are covered: {facts}"
    return facts


def confirm_settlement(table: Table, checks: dict, label: str) -> None:
    before = len(table.commands)
    table.page.get_by_test_id("confirm-settle").click()
    expect(table.page.get_by_test_id("settle-dialog")).to_have_count(0)
    deadline = time.monotonic() + 10
    while len(table.commands) == before and time.monotonic() < deadline:
        table.page.wait_for_timeout(100)
    command = table.commands[-1]["command"] if len(table.commands) > before else None
    checks[f"{label}ConfirmSent"] = command == {"type": "trade.settle", "offerId": "offer-1", "counterparty": "p2"}


def capture(out: Path) -> dict:
    result: dict = {"screenshots": [], "checks": {}}
    files = result["screenshots"]
    checks = result["checks"]
    shots = Shots(out, files)
    server = (None, None, None)
    try:
        server = start_server(out)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, args=["--no-sandbox", "--enable-unsafe-swiftshader"])

            # 桌機：先看面板，再開對話框；英文、繁體中文各一張。
            table = Table(browser, "en", (1366, 768), touch=False)
            try:
                table.open()
                open_trade_panel(table)
                shots.take(table, "01-trade-panel-consented-offer-1366x768-en")
                open_settle_dialog(table, checks, "desktop")
                shots.take(table, "02-settle-dialog-1366x768-en")
                table.page.get_by_test_id("cancel-settle").click()
                expect(table.page.get_by_test_id("settle-dialog")).to_have_count(0)
                table.page.get_by_test_id("locale-switch-game").select_option("zh-Hant")
                table.page.get_by_test_id("counterparty-offer-1").select_option("p2")
                open_settle_dialog(table, checks, "desktopZh")
                shots.take(table, "03-settle-dialog-1366x768-zh-Hant")
                confirm_settlement(table, checks, "desktop")
                assert not table.errors, table.errors
            finally:
                table.close()

            # 短橫屏手機（觸控模擬）：面板與對話框都要完整落在視窗內。
            for size, locale in (((844, 390), "en"), ((667, 375), "zh-Hant")):
                label = f"phone{size[0]}"
                table = Table(browser, locale, size, touch=True)
                try:
                    table.open()
                    checks[f"{label}Compact"] = table.page.get_by_test_id("game-stage").get_attribute("data-layout") == "compact-landscape"
                    open_trade_panel(table)
                    if locale == "en":
                        shots.take(table, f"{len(files) + 1:02d}-trade-panel-consented-offer-{size[0]}x{size[1]}-{locale}")
                    open_settle_dialog(table, checks, label)
                    shots.take(table, f"{len(files) + 1:02d}-settle-dialog-{size[0]}x{size[1]}-{locale}")
                    confirm_settlement(table, checks, label)
                    assert not table.errors, table.errors
                finally:
                    table.close()
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
    print(json.dumps(result["checks"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
