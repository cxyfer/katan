#!/usr/bin/env python3
"""Browser evidence for the random game order (#66) and the bot mark beside the
avatar in the players rail (#78), on the production build.

Starts the built service on a disposable SQLite database and drives one host
through the real UI:

* the create form with the new "Game order" field set to "Random draw";
* the lobby before the draw (seats still in join order, host-only order
  setting, switching the setting and saving it);
* the started table after the draw: the players rail lists the drawn order,
  with each bot's mark outside the avatar's bottom-right corner in both rail
  states (collapsed, expanded) on desktop and on a phone, and the chat seat
  number matches the scoreboard order.

The draw is random, so a run whose draw happens to equal the join order is
discarded and repeated with a fresh session (at most MAX_ATTEMPTS times).

Run after `pnpm build`:

    python3 scripts/lobby-order-bots/capture.py --out test-results/lobby-order-bots

The output directory must be new and empty.
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.request import urlopen

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "packages/web/dist"
SERVER_ENTRY = ROOT / "packages/server/dist/server.mjs"
BASE = ""
HOST_NAME = "Ada"
MAX_ATTEMPTS = 8
TIMEOUT_MS = 60_000


def free_port() -> int:
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        return int(reservation.getsockname()[1])


def start_server(out: Path):
    global BASE
    if not SERVER_ENTRY.is_file() or not (DIST / "index.html").is_file():
        raise SystemExit("built artifacts missing; run pnpm build first")
    temporary = tempfile.TemporaryDirectory(prefix="catan-lobby-order-bots-")
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
        # 縮短思考延遲讓擷取更快；節奏表本身由伺服器測試涵蓋。
        "BOT_DELAY_SCALE": "0.25",
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


def api(context, method: str, path: str, data=None):
    response = context.request.fetch(BASE + path, method=method, data=data)
    payload = response.json()
    if not response.ok or not payload.get("ok"):
        raise AssertionError((method, path, response.status, payload))
    return payload["data"]


def settle(page) -> None:
    page.evaluate("document.fonts.ready")
    page.evaluate("() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
    page.wait_for_timeout(500)


class Shots:
    def __init__(self, page, out: Path):
        self.page = page
        self.out = out
        self.files: list[str] = []

    def take(self, name: str, width: int, height: int, full_page: bool = False) -> None:
        self.page.set_viewport_size({"width": width, "height": height})
        settle(self.page)
        overflow = self.page.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
        assert overflow <= 0, f"{name} overflows horizontally by {overflow}px"
        self.page.screenshot(path=str(self.out / f"{name}.png"), full_page=full_page, animations="disabled")
        self.files.append(f"{name}.png")
        print("CAPTURE", name, flush=True)


def seat_order(context, room_id: str) -> list[dict]:
    members = api(context, "GET", f"/api/rooms/{room_id}")["members"]
    return sorted(members, key=lambda member: member["seat"])


def attempt(browser, out: Path, number: int) -> dict | None:
    """One full pass with a fresh session; None when the draw equalled the join order."""
    context = browser.new_context(viewport={"width": 1366, "height": 768}, locale="zh-TW",
                                  reduced_motion="reduce", device_scale_factor=1)
    context.add_init_script("localStorage.setItem('catan.locale', 'zh-Hant');")
    page = context.new_page()
    page.set_default_timeout(TIMEOUT_MS)
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    shots = Shots(page, out)
    checks: dict = {}
    try:
        page.goto(BASE + "/?renderer=svg", wait_until="domcontentloaded")
        page.get_by_test_id("nickname-input").fill(HOST_NAME)
        page.locator("form button[type=submit]").first.click()
        page.get_by_test_id("create-room").wait_for()

        # 建房表單：四人房，遊戲順序選「隨機抽出」。
        page.locator("#room-capacity").select_option("4")
        expect(page.get_by_test_id("resolved-profile")).to_be_visible()
        page.get_by_test_id("room-order").select_option("random")
        assert page.get_by_test_id("room-order").input_value() == "random"
        shots.take("01-create-form-order-random-1366x768-zh-Hant", 1366, 768, full_page=True)
        page.get_by_test_id("locale-switch").select_option("en")
        shots.take("02-create-form-order-random-1366x768-en", 1366, 768, full_page=True)

        with page.expect_response(lambda r: r.url.endswith("/api/rooms") and r.request.method == "POST") as created:
            page.get_by_test_id("create-room").click()
        room_id = created.value.json()["data"]["id"]
        page.get_by_test_id("room-code").wait_for()
        expect(page.get_by_test_id("lobby-order")).to_have_value("random")

        # 三個電腦補滿座位：兩個預設名稱、一個自訂名稱。
        page.get_by_test_id("lobby-bot-level").select_option("standard")
        page.get_by_test_id("add-bot").click()
        expect(page.locator("[data-bot=true]")).to_have_count(1)
        page.get_by_test_id("add-bot-named").click()
        page.get_by_test_id("bot-name").fill("Robo")
        page.get_by_test_id("confirm-add-bot").click()
        expect(page.locator("[data-bot=true]")).to_have_count(2)
        page.get_by_test_id("add-bot").click()
        expect(page.locator("[data-bot=true]")).to_have_count(3)

        before = seat_order(context, room_id)
        join_names = [member["nickname"] for member in before]
        checks["orderModeIsRandom"] = api(context, "GET", f"/api/rooms/{room_id}")["orderMode"] == "random"
        checks["lobbySeatsInJoinOrder"] = [member["seat"] for member in before] == [0, 1, 2, 3] and before[0]["nickname"] == HOST_NAME
        checks["lobbyHostOnlyOrderSetting"] = page.get_by_test_id("lobby-order").is_enabled()

        # 抽籤前的大廳：座位仍是進房順序。
        shots.take("03-lobby-before-draw-1366x768-en", 1366, 768, full_page=True)
        page.get_by_test_id("locale-switch").select_option("zh-Hant")
        shots.take("04-lobby-before-draw-1366x768-zh-Hant", 1366, 768, full_page=True)
        shots.take("05-lobby-before-draw-390x844-zh-Hant", 390, 844, full_page=True)
        page.set_viewport_size({"width": 1366, "height": 768})

        # 房主可在開局前改回「依進房順序」並保存，再切回隨機。
        page.get_by_test_id("lobby-order").select_option("join")
        expect(page.get_by_test_id("save-settings")).to_be_enabled()
        page.get_by_test_id("save-settings").click()
        expect(page.get_by_test_id("save-settings")).to_be_disabled()
        checks["orderSwitchedToJoin"] = api(context, "GET", f"/api/rooms/{room_id}")["orderMode"] == "join"
        page.get_by_test_id("locale-switch").select_option("en")
        shots.take("06-lobby-order-saved-as-join-1366x768-en", 1366, 768, full_page=True)
        page.get_by_test_id("lobby-order").select_option("random")
        page.get_by_test_id("save-settings").click()
        expect(page.get_by_test_id("save-settings")).to_be_disabled()
        assert api(context, "GET", f"/api/rooms/{room_id}")["orderMode"] == "random"

        page.get_by_test_id("toggle-ready").click()
        expect(page.get_by_test_id("start-game")).to_be_enabled()
        page.get_by_test_id("start-game").click()
        page.get_by_test_id("players-panel").wait_for()
        game = api(context, "GET", "/api/games")["games"][0]
        game_id = game["gameId"]
        snapshot = api(context, "GET", f"/api/games/{game_id}")
        drawn = sorted(snapshot["view"]["players"], key=lambda player: player["seat"])
        drawn_names = [player["nickname"] for player in drawn]
        if drawn_names == join_names:
            print(f"attempt {number}: the draw equalled the join order, retrying", flush=True)
            return None

        # 房間成員的座位與計分板同序（聊天訊息也用這個座位）。
        after = {member["playerId"]: member["seat"] for member in seat_order(context, room_id)}
        checks["roomSeatsMatchScoreboard"] = all(after[player["id"]] == player["seat"] for player in drawn)
        checks["drawnOrderDiffersFromJoinOrder"] = drawn_names != join_names
        checks["joinOrder"] = join_names
        checks["drawnOrder"] = drawn_names
        rail_names = page.locator("[data-testid=seat-list] [data-board-seat] .seat__name").evaluate_all(
            "(nodes) => nodes.map((node) => node.getAttribute('title'))")
        checks["railFollowsDrawnOrder"] = rail_names == drawn_names

        page.set_viewport_size({"width": 1366, "height": 768})
        page.get_by_test_id("locale-switch-game").select_option("en")
        page.mouse.move(700, 400)
        expect(page.locator("[data-bot=true]")).to_have_count(3)
        marks = page.locator("[data-testid^=seat-bot-mark-]")
        checks["botMarkCount"] = marks.count() == 3

        def bot_mark_outside_avatar() -> bool:
            # 標記的中心點必須落在頭像右緣之外（#78：不再蓋住名字縮寫）。
            return page.evaluate("""() => Array.from(document.querySelectorAll('[data-testid^="seat-bot-mark-"]')).every((mark) => {
              const avatar = mark.closest('.seat__swatch').getBoundingClientRect();
              const box = mark.getBoundingClientRect();
              return box.left + box.width / 2 > avatar.right - 1 && box.top + box.height / 2 > avatar.top + avatar.height / 2;
            })""")

        def names_on_one_line() -> bool:
            # 展開時名稱不被電腦標記擠成兩行。
            return page.evaluate("""() => Array.from(document.querySelectorAll('[data-testid="seat-list"] .seat__name')).every((name) => {
              const lineHeight = parseFloat(getComputedStyle(name).lineHeight) || parseFloat(getComputedStyle(name).fontSize) * 1.3;
              return name.getBoundingClientRect().height <= lineHeight * 1.2;
            })""")

        # 收合的玩家欄（預設）：頭像旁的電腦標記。
        shots.take("07-table-rail-collapsed-after-draw-1366x768-en", 1366, 768)
        checks["botMarkOutsideAvatarCollapsed"] = bot_mark_outside_avatar()

        # 展開並釘住玩家欄：順序即抽籤結果。
        # 滑鼠移入即預覽展開，直接點 toggle 會把剛展開的面板收回。
        page.get_by_test_id("players-panel").hover()
        expect(page.get_by_test_id("players-pin")).to_be_visible()
        page.get_by_test_id("players-pin").click()
        page.mouse.move(700, 400)
        expect(page.get_by_test_id("players-panel")).to_have_attribute("data-expanded", "true")
        shots.take("08-table-rail-expanded-after-draw-1366x768-en", 1366, 768)
        checks["botMarkOutsideAvatarExpanded"] = bot_mark_outside_avatar()
        checks["botNamesOneLineExpanded"] = names_on_one_line()

        # 聊天訊息的座位號與計分板一致。
        page.get_by_test_id("tool-tab-chat").click()
        page.get_by_test_id("chat-input").fill("Seat order check")
        page.get_by_test_id("chat-send").click()
        message = page.locator(".chat__message--player").first
        message.wait_for()
        host_seat = next(player["seat"] for player in drawn if player["nickname"] == HOST_NAME)
        checks["chatSeatMatchesScoreboard"] = f"{HOST_NAME} · {host_seat + 1}" in message.locator(".chat__meta").inner_text()
        shots.take("09-table-chat-seat-after-draw-1366x768-en", 1366, 768)
        page.get_by_test_id("tool-close").click()

        page.get_by_test_id("locale-switch-game").select_option("zh-Hant")
        page.mouse.move(700, 400)
        shots.take("10-table-rail-expanded-after-draw-1366x768-zh-Hant", 1366, 768)

        # 手機直屏：同一桌，玩家欄展開。
        page.set_viewport_size({"width": 390, "height": 844})
        settle(page)
        if page.get_by_test_id("players-panel").get_attribute("data-expanded") != "true":
            page.get_by_test_id("players-toggle").click()
            expect(page.get_by_test_id("players-pin")).to_be_visible()
            page.get_by_test_id("players-pin").click()
            page.mouse.move(200, 500)
        expect(page.get_by_test_id("players-panel")).to_have_attribute("data-expanded", "true")
        shots.take("11-table-rail-expanded-after-draw-390x844-zh-Hant", 390, 844)
        checks["botMarkOutsideAvatarPhone"] = bot_mark_outside_avatar()
        checks["botNamesOneLinePhone"] = names_on_one_line()

        assert not errors, f"page errors: {errors}"
        checks["pageErrors"] = errors
        checks["attempts"] = number
        return {"screenshots": shots.files, "checks": checks}
    finally:
        context.close()


def capture(out: Path) -> dict:
    server = (None, None, None)
    try:
        server = start_server(out)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, args=["--no-sandbox", "--enable-unsafe-swiftshader"])
            result = None
            for number in range(1, MAX_ATTEMPTS + 1):
                for stale in out.glob("*.png"):
                    stale.unlink()
                result = attempt(browser, out, number)
                if result is not None:
                    break
            browser.close()
        assert result is not None, f"the random draw matched the join order in all {MAX_ATTEMPTS} attempts"
    finally:
        stop_server(*server)
    failed = [name for name, value in result["checks"].items() if value is False]
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
