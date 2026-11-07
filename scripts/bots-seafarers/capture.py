#!/usr/bin/env python3
"""Browser evidence for Seafarers bot seats (v0.4.1 SF-4) on the production build.

Starts the built service on a disposable SQLite database. Every room gets a new
guest session and goes through the real UI:

* a Heading for New Shores room (four seats): the host adds a standard and an
  easy bot from the lobby toolbar. This writes the curated
  `lobby-seafarers.png` (zh-Hant, 1366x900, full page) and an en capture;
* the paired 5–6 player profile (five seats) with two bots, zh-Hant;
* a Cities & Knights room, where adding a bot stays disabled with the
  unsupported note, in both locales;
* with `--table`, the New Shores room is filled with a third bot and started.
  The host's own moves go over the same session's API until a bot owns a ship;
  that step is best effort and records `"timeout"` instead of failing.

`--before` checks a build without SF-4 instead: the New Shores toolbar must be
disabled with the old note, and only lobby captures run (`-before` names).

Run after `pnpm build` in the checkout given by `--root` (default: this one):

    python3 scripts/bots-seafarers/capture.py --out test-results/bots-seafarers --table
    python3 scripts/bots-seafarers/capture.py --out test-results/bots-seafarers-before \\
        --root ../other-checkout --before

The output directory must be new and empty.
"""
from __future__ import annotations

import argparse
import hashlib
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
# 電腦對手不支援規則組合時的提示：SF-4 改成不再提「只會玩基本遊戲」。
NOTE = {
    "after": {
        "zh-Hant": "電腦對手尚未支援這個規則組合。",
        "en": "Bot opponents can't play this ruleset yet.",
    },
    "before": {
        "zh-Hant": "電腦對手只會玩基本遊戲，無法加入使用擴充規則的組合。",
        "en": "Bot opponents only play the base game; this ruleset uses expansion rules they do not know.",
    },
}
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
    child = temporary = log = None
    try:
        temporary = tempfile.TemporaryDirectory(prefix="catan-bots-seafarers-")
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
            # 不依賴呼叫端的 shell：電腦對手必須開啟，本機 HTTP 不能用 Secure cookie。
            "BOTS_ENABLED": "1",
            "COOKIE_SECURE": "0",
            # 縮短思考延遲讓擷取更快；節奏表本身由伺服器測試涵蓋。
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
        raise SystemExit(f"service did not become healthy; see {out / 'server.log'}")
    except BaseException:
        # 啟動失敗時呼叫端拿不到這三個資源：在這裡終止程序（逾時就 kill）、關 log、清暫存目錄。
        stop_server(child, temporary, log)
        raise


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
    page.evaluate("() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
    page.wait_for_timeout(400)


def shot(page, out: Path, result: dict, name: str, width: int, height: int, full_page: bool = False) -> None:
    page.set_viewport_size({"width": width, "height": height})
    settle(page)
    overflow = page.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
    assert overflow <= 0, f"{name} overflows horizontally by {overflow}px"
    path = out / f"{name}.png"
    page.screenshot(path=str(path), full_page=full_page, animations="disabled")
    result["screenshots"][path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    print("CAPTURE", name, flush=True)


def guest(browser, errors: list[str], nickname: str):
    """新的訪客 session，停在首頁的建房表單。"""
    context = browser.new_context(viewport={"width": 1366, "height": 768}, locale="zh-TW", reduced_motion="reduce")
    context.add_init_script("localStorage.setItem('catan.locale', 'zh-Hant');")
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.set_default_timeout(20_000)
    page.goto(BASE + "/?renderer=svg", wait_until="networkidle")
    page.get_by_test_id("nickname-input").fill(nickname)
    page.locator("form button[type=submit]").first.click()
    page.get_by_test_id("create-room").wait_for()
    return context, page


def create_room(page, expansion: str, capacity: int) -> str:
    page.get_by_test_id("expansion-select").select_option(expansion)
    page.locator("#room-capacity").select_option(str(capacity))
    resolved = page.get_by_test_id("resolved-profile").inner_text()
    page.get_by_test_id("create-room").click()
    page.get_by_test_id("room-code").wait_for()
    return resolved


def add_bot(page, level: str, expected: int) -> None:
    page.get_by_test_id("lobby-bot-level").select_option(level)
    page.get_by_test_id("add-bot").click()
    expect(page.locator("[data-bot=true]")).to_have_count(expected)


def set_locale(page, locale: str) -> None:
    page.get_by_test_id("locale-switch").select_option(locale)


def host_move(view: dict, me: str):
    """真人座位的最小合法動作，含 Seafarers 的 gold、setup 船與 Road Building 的船。"""
    hints = view.get("hints") or {}
    sea = (hints.get("modules") or {}).get("seafarers") or {}
    pending = view.get("pending")
    if pending:
        kind = pending["kind"]
        if kind == "discard" and me in pending["waitingFor"]:
            hand = [r for r in RESOURCES for _ in range(next(p for p in view["players"] if p["id"] == me)["resources"][r])]
            return {"type": "pending.discard", "resources": hand[: pending["required"][me]]}
        if kind == "seafarers.gold":
            if (pending.get("responders") or [None])[0] != me:
                return None
            required = sea.get("goldRequired") or 0
            picks = [r for r in RESOURCES for _ in range(view["bank"][r])][:required]
            return {"type": "gold.choose", "resources": picks} if len(picks) == required else None
        if pending.get("actor") != me:
            return None
        if kind == "moveRobber":
            hex_ = next(i for i, t in enumerate(view["board"]["terrain"]) if i != view["board"]["robber"] and t != "sea")
            return {"type": "pending.moveRobber", "hex": hex_}
        if kind == "steal":
            return {"type": "pending.steal", "victim": pending["candidates"][0]}
        if kind == "yearOfPlenty":
            return {"type": "pending.takeResource", "resource": next(r for r in RESOURCES if view["bank"][r] > 0)}
        if kind == "freeRoads":
            if hints.get("legalRoads"):
                return {"type": "build.road", "edge": hints["legalRoads"][0]}
            if sea.get("legalShips"):
                return {"type": "build.ship", "edge": sea["legalShips"][0]}
        return None
    if view["turn"]["playerId"] != me:
        return None
    phase = view["turn"]["phase"]
    if phase == "setup":
        stage = view["turn"]["setup"]["stage"]
        if stage == "building" and hints.get("legalSettlements"):
            return {"type": "setup.placeBuilding", "vertex": hints["legalSettlements"][0]}
        if stage == "road":
            if hints.get("legalRoads"):
                return {"type": "setup.placeRoad", "edge": hints["legalRoads"][0]}
            if sea.get("setupShips"):
                return {"type": "setup.placeShip", "edge": sea["setupShips"][0]}
        return None
    if phase == "preroll" and hints.get("canRoll"):
        return {"type": "turn.roll"}
    if phase == "action" and hints.get("canEndTurn"):
        return {"type": "turn.end"}
    return None


def play_host_until(context, game_id: str, me: str, done, timeout: float) -> dict | None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        snapshot = api(context, "GET", f"/api/games/{game_id}")
        view = snapshot["view"]
        if done(view):
            return snapshot
        command = host_move(view, me)
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
    return None


def new_shores_after(browser, out: Path, result: dict, errors: list[str]):
    context, page = guest(browser, errors, "海岸領航員")
    result["checks"]["newShoresProfile"] = create_room(page, "seafarers", 4)
    expect(page.get_by_test_id("add-bot")).to_be_enabled()
    result["checks"]["newShoresWithoutNote"] = page.get_by_test_id("lobby-bots-unsupported").count() == 0
    add_bot(page, "standard", 1)
    add_bot(page, "easy", 2)
    # 精選集的 lobby-seafarers.png：zh-Hant、1366x900，整頁（含房間設定與規則集）。
    shot(page, out, result, "lobby-seafarers", 1366, 900, full_page=True)
    set_locale(page, "en")
    shot(page, out, result, "sf-lobby-bots-1366x768-en", 1366, 768, full_page=True)
    set_locale(page, "zh-Hant")
    page.set_viewport_size({"width": 1366, "height": 768})
    return context, page


def paired_after(browser, out: Path, result: dict, errors: list[str]) -> None:
    context, page = guest(browser, errors, "雙座領航員")
    result["checks"]["pairedProfile"] = create_room(page, "seafarers", 5)
    expect(page.get_by_test_id("add-bot")).to_be_enabled()
    add_bot(page, "standard", 1)
    add_bot(page, "easy", 2)
    shot(page, out, result, "sf-paired-lobby-bots-1366x768-zh-Hant", 1366, 768, full_page=True)
    context.close()


def new_shores_before(browser, out: Path, result: dict, errors: list[str]) -> None:
    context, page = guest(browser, errors, "海岸領航員")
    result["checks"]["newShoresProfile"] = create_room(page, "seafarers", 4)
    expect(page.get_by_test_id("add-bot")).to_be_disabled()
    expect(page.get_by_test_id("lobby-bots-unsupported")).to_have_text(NOTE["before"]["zh-Hant"])
    shot(page, out, result, "sf-lobby-before-1366x768-zh-Hant", 1366, 768, full_page=True)
    set_locale(page, "en")
    expect(page.get_by_test_id("lobby-bots-unsupported")).to_have_text(NOTE["before"]["en"])
    shot(page, out, result, "sf-lobby-before-1366x768-en", 1366, 768, full_page=True)
    context.close()


def cities_knights(browser, out: Path, result: dict, errors: list[str], mode: str) -> None:
    suffix = "-before" if mode == "before" else ""
    context, page = guest(browser, errors, "城堡騎士")
    result["checks"]["citiesKnightsProfile"] = create_room(page, "citiesKnights", 4)
    expect(page.get_by_test_id("add-bot")).to_be_disabled()
    note = page.get_by_test_id("lobby-bots-unsupported")
    expect(note).to_have_text(NOTE[mode]["zh-Hant"])
    shot(page, out, result, f"ck-lobby-bots-unsupported{suffix}-1366x768-zh-Hant", 1366, 768, full_page=True)
    set_locale(page, "en")
    expect(note).to_have_text(NOTE[mode]["en"])
    shot(page, out, result, f"ck-lobby-bots-unsupported{suffix}-1366x768-en", 1366, 768, full_page=True)
    context.close()


def table_after(context, page, out: Path, result: dict, timeout: float) -> None:
    add_bot(page, "standard", 3)
    session = api(context, "GET", "/api/session")
    me = session["player"]["id"] if "player" in session else session["id"]
    page.get_by_test_id("toggle-ready").click()
    expect(page.get_by_test_id("start-game")).to_be_enabled()
    page.get_by_test_id("start-game").click()
    page.wait_for_url("**", wait_until="networkidle")
    games = api(context, "GET", "/api/games")
    game = (games["games"] if isinstance(games, dict) else games)[0]
    game_id = game["gameId"]
    # /api/games 的 ResumableGameView 使用 playerId（與牌桌 projection 的 id 不同）。
    bots = {p["playerId"] for p in game["players"] if p.get("bot")}
    result["checks"]["tableBots"] = len(bots)

    def bot_ship(view: dict) -> bool:
        roads = view["board"]["roads"]
        return view["turn"]["phase"] != "setup" and any(r and r.get("ship") and r.get("player") in bots for r in roads)

    try:
        snapshot = play_host_until(context, game_id, me, bot_ship, timeout)
    except AssertionError as error:
        # 這一步只是補充證據：真人座位的簡化走法被拒絕時記錄下來，不讓大廳的擷取失敗。
        result["checks"]["tableBotShip"] = f"error: {error}"
        return
    if snapshot is None:
        result["checks"]["tableBotShip"] = "timeout"
        return
    result["checks"]["tableBotShip"] = True
    result["checks"]["tableRevision"] = snapshot["revision"]
    shot(page, out, result, "sf-table-bot-ships-1366x768-zh-Hant", 1366, 768)


def capture(root: Path, out: Path, before: bool, table: bool, table_timeout: float) -> dict:
    mode = "before" if before else "after"
    result: dict = {"mode": mode, "screenshots": {}, "checks": {}}
    try:
        result["root"] = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=root, capture_output=True, text=True, check=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        result["root"] = None
    errors: list[str] = []
    server = (None, None, None)
    try:
        server = start_server(root, out)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, args=["--no-sandbox", "--enable-unsafe-swiftshader"])
            if before:
                new_shores_before(browser, out, result, errors)
                cities_knights(browser, out, result, errors, mode)
            else:
                context, page = new_shores_after(browser, out, result, errors)
                paired_after(browser, out, result, errors)
                cities_knights(browser, out, result, errors, mode)
                if table:
                    table_after(context, page, out, result, table_timeout)
                context.close()
            browser.close()
    finally:
        stop_server(*server)
    result["checks"]["pageErrors"] = errors
    failed = [name for name, value in result["checks"].items() if value is False]
    assert not failed, f"failed checks: {failed}"
    assert not errors, errors
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[2]))
    parser.add_argument("--before", action="store_true", help="check a build without SF-4")
    parser.add_argument("--table", action="store_true", help="also start a New Shores game with three bots")
    parser.add_argument("--table-timeout", type=float, default=240)
    args = parser.parse_args()
    out = Path(args.out).resolve()
    if out.exists() and any(out.iterdir()):
        raise SystemExit(f"{out} must be new and empty")
    out.mkdir(parents=True, exist_ok=True)
    result = capture(Path(args.root).resolve(), out, args.before, args.table and not args.before, args.table_timeout)
    (out / "report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result["checks"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
