#!/usr/bin/env python3
"""Browser evidence for the unified leave dialog and the all-seat save-and-pause
vote, on the production build.

A disposable service runs from the built artifacts with a temporary SQLite
file. Two people and one bot play a base game (rooms are set up over the same
HTTP API the client uses; both people keep the table open in their own browser
context, so the vote reaches the other seat through the live socket). A third
person plays alone against two bots for the solo dialog.

Default (this branch):

* the table with no separate table menu in the bottom-right corner;
* the leave dialog at a table with other people, including "propose saving and
  pausing for everyone", and at a table with only bots;
* the proposer waiting for the vote and the other person voting on it;
* the paused table, readiness to resume, and the leave dialog while paused.

`--before` captures the old table menu and leave dialogs instead; point
`--root` at a built checkout of the base commit for that.

Run after `pnpm build`:

    python3 scripts/leave-dialog/capture.py --out test-results/leave-dialog

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

RESOURCES = ("lumber", "brick", "wool", "grain", "ore")
BASE = ""


def free_port() -> int:
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        return int(reservation.getsockname()[1])


def start_server(root: Path, out: Path):
    global BASE
    dist = root / "packages/web/dist"
    entry = root / "packages/server/dist/server.mjs"
    if not entry.is_file() or not (dist / "index.html").is_file():
        raise SystemExit(f"built artifacts missing under {root}; run pnpm build first")
    temporary = tempfile.TemporaryDirectory(prefix="catan-leave-dialog-")
    log = (out / "server.log").open("w", encoding="utf-8")
    port = free_port()
    env = {
        **os.environ,
        "HOST": "127.0.0.1",
        "PORT": str(port),
        "SQLITE_PATH": str(Path(temporary.name) / "capture.sqlite"),
        "DATABASE_URL": "",
        "DATABASE_SCHEMA": "",
        "WEB_DIST_PATH": str(dist),
        "LOG_LEVEL": "warn",
        "BOT_DELAY_SCALE": "0.25",
    }
    child = subprocess.Popen(["node", str(entry)], cwd=root, env=env, stdout=log, stderr=log)
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


def human_move(view: dict, me: str):
    """最小合法動作：只用來把開局擺放推進到一般回合。"""
    hints = view.get("hints") or {}
    pending = view.get("pending")
    if pending:
        kind = pending["kind"]
        if kind == "discard" and me in pending["waitingFor"]:
            mine = next(p for p in view["players"] if p["id"] == me)["resources"]
            hand = [r for r in RESOURCES for _ in range(mine[r])]
            return {"type": "pending.discard", "resources": hand[: pending["required"][me]]}
        if pending.get("actor") != me:
            return None
        if kind == "moveRobber":
            hex_ = next(i for i, t in enumerate(view["board"]["terrain"]) if i != view["board"]["robber"] and t != "sea")
            return {"type": "pending.moveRobber", "hex": hex_}
        if kind == "steal":
            return {"type": "pending.steal", "victim": pending["candidates"][0]}
        return None
    if view["turn"]["playerId"] != me or view["turn"]["phase"] != "setup":
        return None
    stage = view["turn"]["setup"]["stage"]
    if stage == "building" and hints.get("legalSettlements"):
        return {"type": "setup.placeBuilding", "vertex": hints["legalSettlements"][0]}
    if stage == "road" and hints.get("legalRoads"):
        return {"type": "setup.placeRoad", "edge": hints["legalRoads"][0]}
    return None


def finish_setup(people: list, game_id: str, timeout: float = 120) -> None:
    """people: [(context, playerId)]。電腦座位由伺服器自己下（牌桌頁面開著才會動）。"""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        moved = False
        for context, me in people:
            snapshot = api(context, "GET", f"/api/games/{game_id}")
            view = snapshot["view"]
            if view["turn"]["phase"] != "setup" and not view.get("pending"):
                return
            command = human_move(view, me)
            if command:
                api(context, "POST", f"/api/games/{game_id}/commands", {
                    "commandId": f"capture-{uuid.uuid4()}",
                    "expectedRevision": snapshot["revision"],
                    "command": command,
                })
                moved = True
        if not moved:
            time.sleep(0.25)
    raise AssertionError("opening placement did not finish in time")


class Shots:
    def __init__(self, out: Path, result: dict):
        self.out = out
        self.result = result

    def take(self, page, name: str) -> None:
        page.evaluate("() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        page.wait_for_timeout(500)
        size = page.viewport_size
        file = f"{len(self.result['screenshots']) + 1:02d}-{name}-{size['width']}x{size['height']}-zh-Hant.png"
        page.screenshot(path=str(self.out / file), animations="disabled")
        self.result["screenshots"].append(file)
        print("CAPTURE", file, flush=True)


def person(browser, nickname: str, errors: list[str]):
    context = browser.new_context(viewport={"width": 1366, "height": 768}, locale="zh-TW", reduced_motion="reduce")
    context.add_init_script("localStorage.setItem('catan.locale', 'zh-Hant');")
    player = api(context, "POST", "/api/session", {"nickname": nickname, "locale": "zh-Hant"})["player"]
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(f"{nickname}: {error}"))
    page.set_default_timeout(20_000)
    return context, page, player["id"]


def open_table(page, code: str) -> None:
    """以房間代碼進入（已是成員，等同回到牌桌）；首頁預設分頁就有代碼欄。"""
    page.goto(BASE + "/?renderer=svg", wait_until="networkidle")
    page.get_by_test_id("join-code").fill(code)
    page.get_by_test_id("join-room").click()
    expect(page.get_by_test_id("board-svg")).to_be_visible()
    expect(page.get_by_test_id("connection-state")).to_have_attribute("data-state", "online")


def capture(root: Path, out: Path, before: bool) -> dict:
    result: dict = {"screenshots": [], "checks": {}}
    checks = result["checks"]
    shots = Shots(out, result)
    errors: list[str] = []
    server = (None, None, None)
    try:
        server = start_server(root, out)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, args=["--no-sandbox", "--enable-unsafe-swiftshader"])

            # 兩位真人加一個電腦：多人桌。
            host_ctx, host, host_id = person(browser, "海岸領航員", errors)
            guest_ctx, guest, guest_id = person(browser, "小美", errors)
            room = api(host_ctx, "POST", "/api/rooms", {
                "visibility": "private", "capacity": 3, "profileId": "base-2025", "setupMode": "fixed",
            })
            api(guest_ctx, "POST", "/api/rooms/join", {"code": room["code"]})
            api(host_ctx, "POST", f"/api/rooms/{room['id']}/bots", {"level": "easy"})
            api(host_ctx, "POST", f"/api/rooms/{room['id']}/ready", {"ready": True})
            api(guest_ctx, "POST", f"/api/rooms/{room['id']}/ready", {"ready": True})
            game_id = api(host_ctx, "POST", f"/api/rooms/{room['id']}/start")["gameId"]
            open_table(host, room["code"])
            open_table(guest, room["code"])
            finish_setup([(host_ctx, host_id), (guest_ctx, guest_id)], game_id)
            host.wait_for_timeout(1500)

            # 單人桌：一位真人對兩個電腦。
            solo_ctx, solo, solo_id = person(browser, "獨行旅人", errors)
            solo_room = api(solo_ctx, "POST", "/api/rooms", {
                "visibility": "private", "capacity": 3, "profileId": "base-2025", "setupMode": "fixed",
            })
            api(solo_ctx, "POST", f"/api/rooms/{solo_room['id']}/bots", {"level": "easy"})
            api(solo_ctx, "POST", f"/api/rooms/{solo_room['id']}/bots", {"level": "easy"})
            api(solo_ctx, "POST", f"/api/rooms/{solo_room['id']}/ready", {"ready": True})
            solo_game = api(solo_ctx, "POST", f"/api/rooms/{solo_room['id']}/start")["gameId"]
            open_table(solo, solo_room["code"])
            finish_setup([(solo_ctx, solo_id)], solo_game)
            solo.wait_for_timeout(1500)

            if before:
                shots.take(host, "table")
                host.locator('[data-testid="table-menu"] > summary').click()
                expect(host.get_by_test_id("persistence-bar")).to_be_visible()
                shots.take(host, "table-menu-open")
                host.locator('[data-testid="table-menu"] > summary').click()
                host.get_by_test_id("leave-game").click()
                shots.take(host, "leave-dialog-multi")
                solo.get_by_test_id("leave-game").click()
                shots.take(solo, "leave-dialog-solo")
            else:
                checks["noTableMenu"] = host.get_by_test_id("table-menu").count() == 0
                shots.take(host, "table")

                # 多人桌的離開對話框：保存並離開、提議全桌保存並暫停、退出。
                host.get_by_test_id("leave-game").click()
                expect(host.get_by_test_id("leave-suspend")).to_be_visible()
                checks["identityNoteInDialog"] = host.get_by_test_id("leave-identity").is_visible()
                shots.take(host, "leave-dialog-multi")

                # 單人桌只有保留與結束。
                solo.get_by_test_id("leave-game").click()
                checks["soloHasNoSuspend"] = solo.get_by_test_id("leave-suspend").count() == 0
                shots.take(solo, "leave-dialog-solo")
                solo.get_by_test_id("leave-cancel").click()

                # 提議：提案者留在牌桌等待；另一位真人經由推送看到投票。
                host.get_by_test_id("leave-suspend").click()
                expect(host.get_by_test_id("leave-dialog")).to_have_count(0)
                expect(host.get_by_test_id("suspend-waiting")).to_contain_text("小美")
                checks["proposerStaysAtTable"] = host.get_by_test_id("board-svg").is_visible()
                shots.take(host, "suspend-proposer-waiting")
                expect(guest.get_by_test_id("suspend-approve")).to_be_visible()
                shots.take(guest, "suspend-vote")

                # 全員同意：兩邊都進入暫停，牌桌仍在畫面上（不再黑畫面）。
                guest.get_by_test_id("suspend-approve").click()
                expect(host.get_by_test_id("resume-bar")).to_be_visible()
                expect(guest.get_by_test_id("resume-bar")).to_be_visible()
                checks["tableVisibleWhileSuspended"] = host.get_by_test_id("board-svg").is_visible() \
                    and guest.get_by_test_id("board-svg").is_visible()
                shots.take(host, "suspended")

                # 準備繼續：等待另一位真人。
                host.get_by_test_id("resume-ready").click()
                expect(host.get_by_test_id("resume-waiting")).to_contain_text("小美")
                shots.take(host, "resume-waiting")

                # 暫停中的離開對話框：說明對局維持暫停，不再提供暫停。
                host.get_by_test_id("leave-game").click()
                checks["pausedHasNoSuspend"] = host.get_by_test_id("leave-suspend").count() == 0
                shots.take(host, "leave-dialog-suspended")
                host.get_by_test_id("leave-cancel").click()

                # 手機直屏的暫停橫幅。
                guest.set_viewport_size({"width": 390, "height": 844})
                shots.take(guest, "suspended")

                # 最後一位準備好：對局繼續，橫幅消失。
                guest.set_viewport_size({"width": 1366, "height": 768})
                guest.get_by_test_id("resume-ready").click()
                expect(host.get_by_test_id("resume-bar")).to_have_count(0)
                expect(guest.get_by_test_id("resume-bar")).to_have_count(0)
                checks["resumedForEveryone"] = True
            browser.close()
    finally:
        stop_server(*server)
    checks["noPageErrors"] = not errors
    result["errors"] = errors
    failed = [name for name, value in checks.items() if value is not True]
    assert not failed, f"failed checks: {failed}; errors: {errors}"
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[2]),
                        help="checkout whose built web bundle and server are served")
    parser.add_argument("--before", action="store_true", help="capture the old table menu instead")
    args = parser.parse_args()
    out = Path(args.out).resolve()
    if out.exists() and any(out.iterdir()):
        raise SystemExit(f"{out} must be new and empty")
    out.mkdir(parents=True, exist_ok=True)
    result = capture(Path(args.root).resolve(), out, args.before)
    (out / "report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"checks": result["checks"], "screenshots": result["screenshots"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
