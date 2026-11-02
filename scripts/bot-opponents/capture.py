#!/usr/bin/env python3
"""Browser evidence for computer opponents (SPEC §4.9) on the production build.

Starts the built service on a disposable SQLite database and drives one host
through the real UI:

* the create form without any bot fields, at the 1366x768 landscape fit from #42;
* a room where the host sets the bot count to two, then three with one removed
  (both locales, plus a phone viewport);
* a started table where the bots place, roll and play while the host's own
  moves are sent over the same browser session's API;
* bots stop while no person has the table open and continue on return.

Run after `pnpm build`:

    python3 scripts/bot-opponents/capture.py --out test-results/bot-opponents

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
import uuid
from pathlib import Path
from urllib.request import urlopen

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "packages/web/dist"
SERVER_ENTRY = ROOT / "packages/server/dist/server.mjs"
RESOURCES = ("lumber", "brick", "wool", "grain", "ore")
BASE = ""


def free_port() -> int:
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        return int(reservation.getsockname()[1])


def start_server(out: Path):
    global BASE
    if not SERVER_ENTRY.is_file() or not (DIST / "index.html").is_file():
        raise SystemExit("built artifacts missing; run pnpm build first")
    temporary = tempfile.TemporaryDirectory(prefix="catan-bot-opponents-")
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
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise SystemExit(f"service exited {child.returncode}; see {out / 'server.log'}")
        try:
            with urlopen(BASE + "/healthz", timeout=1) as response:
                if response.status == 200:
                    return child, temporary, log
        except OSError:
            time.sleep(0.15)
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
    log.close()
    temporary.cleanup()


def api(context, method: str, path: str, data=None):
    response = context.request.fetch(BASE + path, method=method, data=data)
    payload = response.json()
    if not response.ok or not payload.get("ok"):
        raise AssertionError((method, path, response.status, payload))
    return payload["data"]


def settle(page) -> None:
    page.evaluate("() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
    page.wait_for_timeout(400)


def shot(page, out: Path, result: dict, name: str, width: int, height: int, full_page: bool = False) -> None:
    page.set_viewport_size({"width": width, "height": height})
    settle(page)
    overflow = page.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
    assert overflow <= 0, f"{name} overflows horizontally by {overflow}px"
    page.screenshot(path=str(out / f"{name}.png"), full_page=full_page, animations="disabled")
    result["screenshots"].append(f"{name}.png")
    print("CAPTURE", name, flush=True)


def human_move(view: dict, me: str):
    """與保底策略相同的最小合法動作。"""
    hints = view.get("hints") or {}
    pending = view.get("pending")
    if pending:
        kind = pending["kind"]
        if kind == "discard" and me in pending["waitingFor"]:
            hand = [r for r in RESOURCES for _ in range(next(p for p in view["players"] if p["id"] == me)["resources"][r])]
            return {"type": "pending.discard", "resources": hand[: pending["required"][me]]}
        if pending.get("actor") != me:
            return None
        if kind == "moveRobber":
            hex_ = next(i for i, t in enumerate(view["board"]["terrain"]) if i != view["board"]["robber"] and t != "sea")
            return {"type": "pending.moveRobber", "hex": hex_}
        if kind == "steal":
            return {"type": "pending.steal", "victim": pending["candidates"][0]}
        if kind == "yearOfPlenty":
            return {"type": "pending.takeResource", "resource": next(r for r in RESOURCES if view["bank"][r] > 0)}
        if kind == "freeRoads" and hints.get("legalRoads"):
            return {"type": "build.road", "edge": hints["legalRoads"][0]}
        return None
    if view["turn"]["playerId"] != me:
        return None
    phase = view["turn"]["phase"]
    if phase == "setup":
        stage = view["turn"]["setup"]["stage"]
        if stage == "building" and hints.get("legalSettlements"):
            return {"type": "setup.placeBuilding", "vertex": hints["legalSettlements"][0]}
        if stage == "road" and hints.get("legalRoads"):
            return {"type": "setup.placeRoad", "edge": hints["legalRoads"][0]}
        return None
    if phase == "preroll" and hints.get("canRoll"):
        return {"type": "turn.roll"}
    if phase == "action" and hints.get("canEndTurn"):
        return {"type": "turn.end"}
    return None


def play_host_until(context, game_id: str, me: str, done, timeout: float = 120) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        snapshot = api(context, "GET", f"/api/games/{game_id}")
        view = snapshot["view"]
        if done(view):
            return snapshot
        command = human_move(view, me)
        if command:
            receipt = api(context, "POST", f"/api/games/{game_id}/commands", {
                "commandId": f"capture-{uuid.uuid4()}",
                "expectedRevision": snapshot["revision"],
                "command": command,
            })
            if receipt["outcome"] != "accepted":
                assert receipt["error"]["messageId"] == "error.E_STALE_REVISION", receipt
        else:
            time.sleep(0.2)
    raise AssertionError("table did not reach the expected state in time")


def capture(out: Path) -> dict:
    result: dict = {"screenshots": [], "checks": {}}
    server = (None, None, None)
    try:
        server = start_server(out)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, args=["--no-sandbox", "--enable-unsafe-swiftshader"])
            context = browser.new_context(viewport={"width": 1366, "height": 768}, locale="zh-TW", reduced_motion="reduce")
            context.add_init_script("localStorage.setItem('catan.locale', 'zh-Hant');")
            page = context.new_page()
            errors: list[str] = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.set_default_timeout(20_000)
            page.goto(BASE + "/?renderer=svg", wait_until="networkidle")
            page.get_by_test_id("nickname-input").fill("海岸領航員")
            page.locator("form button[type=submit]").first.click()
            page.get_by_test_id("create-room").wait_for()

            # 建房表單：4 人房，不詢問電腦數量。
            page.get_by_test_id("profile-select").select_option("base-2025")
            page.locator("#room-capacity").select_option("4")
            assert page.get_by_test_id("room-bots").count() == 0
            assert page.get_by_test_id("room-bot-level").count() == 0
            create_box = page.get_by_test_id("create-room").bounding_box()
            result["checks"]["createButtonVisibleAt1366x768"] = bool(create_box) and create_box["y"] + create_box["height"] <= 768
            shot(page, out, result, "01-create-form-zh-Hant", 1366, 768)
            page.get_by_test_id("create-room").click()
            page.get_by_test_id("room-code").wait_for()
            expect(page.locator("[data-bot=true]")).to_have_count(0)

            # 房間：把電腦數量調到 2，再調到滿座的 3，並個別移除一個。
            page.get_by_test_id("lobby-bot-level").select_option("standard")
            page.get_by_test_id("lobby-bot-count").select_option("2")
            expect(page.locator("[data-bot=true]")).to_have_count(2)
            page.get_by_test_id("lobby-bot-level").select_option("easy")
            page.get_by_test_id("lobby-bot-count").select_option("3")
            expect(page.locator("[data-bot=true]")).to_have_count(3)
            expect(page.get_by_test_id("lobby-bot-count")).to_have_value("3")
            shot(page, out, result, "02-lobby-full-zh-Hant", 1366, 768, full_page=True)
            shot(page, out, result, "03-lobby-full-phone-zh-Hant", 390, 844, full_page=True)
            page.set_viewport_size({"width": 1366, "height": 768})
            first_bot = page.locator("[data-testid^=remove-bot-]").first
            first_bot.click()
            expect(page.locator("[data-bot=true]")).to_have_count(2)
            page.get_by_test_id("lobby-bot-count").select_option("3")
            expect(page.locator("[data-bot=true]")).to_have_count(3)
            page.get_by_test_id("locale-switch").select_option("en")
            shot(page, out, result, "04-lobby-full-en", 1366, 768, full_page=True)

            session = api(context, "GET", "/api/session")
            me = session["player"]["id"] if "player" in session else session["id"]
            page.get_by_test_id("toggle-ready").click()
            expect(page.get_by_test_id("start-game")).to_be_enabled()
            page.get_by_test_id("start-game").click()
            page.wait_for_url("**", wait_until="networkidle")
            games = api(context, "GET", "/api/games")
            game = (games["games"] if isinstance(games, dict) else games)[0]
            game_id = game["gameId"]
            room_id = game["roomId"]
            result["checks"]["resumeListMarksBots"] = sum(1 for p in game["players"] if p.get("bot")) == 3

            # 設置階段結束、Bot 已擲過骰：頁面開著（有 live socket）時 Bot 會自己推進。
            snapshot = play_host_until(
                context, game_id, me,
                lambda view: view["turn"]["phase"] != "setup" and view["turn"]["playerId"] != me and view["turn"]["dice"] is not None,
            )
            result["checks"]["botsPlacedDuringSetup"] = all(
                sum(1 for b in snapshot["view"]["board"]["buildings"] if b and b["player"] == p["id"]) >= 2
                for p in snapshot["view"]["players"]
            )
            shot(page, out, result, "05-table-bot-turn-en", 1366, 768)
            page.get_by_test_id("locale-switch-game").select_option("zh-Hant")
            snapshot = play_host_until(
                context, game_id, me,
                lambda view: view["turn"]["playerId"] != me and view["turn"]["phase"] == "action",
            )
            shot(page, out, result, "06-table-bot-turn-zh-Hant", 1366, 768)
            shot(page, out, result, "07-table-bot-turn-phone-zh-Hant", 390, 844)

            # 關掉頁面：沒有真人在線，Bot 不再推進。
            page.close()
            time.sleep(1.5)
            paused_at = api(context, "GET", f"/api/games/{game_id}")["revision"]
            time.sleep(4)
            result["checks"]["botsPauseWithoutPeople"] = api(context, "GET", f"/api/games/{game_id}")["revision"] == paused_at

            # 從首頁的「繼續對局」回來：重新訂閱房間，Bot 繼續。
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(BASE + "/?renderer=svg", wait_until="networkidle")
            page.set_viewport_size({"width": 1366, "height": 768})
            page.locator("#home-tab-resume").click()
            expect(page.get_by_test_id("resume-list")).to_contain_text("（電腦）")
            shot(page, out, result, "08-home-resume-zh-Hant", 1366, 768, full_page=True)
            page.get_by_test_id(f"resume-{game_id}").click()
            resumed_from = api(context, "GET", f"/api/games/{game_id}")["revision"]
            play_host_until(
                context, game_id, me,
                lambda view: api(context, "GET", f"/api/games/{game_id}")["revision"] >= resumed_from + 6,
                timeout=60,
            )
            result["checks"]["botsContinueAfterResume"] = True
            result["checks"]["pageErrors"] = errors
            result["checks"]["roomId"] = room_id
            browser.close()
    finally:
        stop_server(*server)
    failed = [name for name, value in result["checks"].items() if value is False]
    assert not failed, f"failed checks: {failed}"
    assert not result["checks"].get("pageErrors"), result["checks"]["pageErrors"]
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
