#!/usr/bin/env python3
"""Browser evidence for Seafarers + Cities & Knights bot seats (v0.4.3 SFCK-G) on the production build.

Starts the built service on a disposable SQLite database. Every room gets a new
guest session and goes through the real UI:

* a `sf-ck-new-shores-2025` room (four seats): the host picks the "Cities &
  Knights + Seafarers" expansion set, sees the bot toolbar offering easy and
  standard only (hard plays the base game only) and adds a standard and an easy
  bot. Writes `sfck-lobby-bots-1366x900-{zh-Hant,en}.png` (full page) and
  `sfck-lobby-bots-hard-unavailable-zh-Hant.png` (the toolbar with the hard note);
* a `sf-ck-new-shores-paired-2025` room (five seats) with two bots, zh-Hant;
* with `--table`, the four-seat room is filled with a third bot and started. The
  host's own moves go over the same session's API until a bot owns a ship, a
  knight or a city improvement. The run fails unless three bots are seated, one
  of those three things is seen (a `"timeout"` or `"error: ..."` in
  `tableBotProgress` counts as a failure) and the table screenshot is written.

`--before` checks a build without SFCK-G instead: the combined toolbar must be
disabled with the unsupported note, and only the lobby captures run (`-before`
names).

Every capture is listed with its sha256 in `report.json`.

Run after `pnpm build` in the checkout given by `--root` (default: this one):

    python3 scripts/bots-seafarers-cities-knights/capture.py --out test-results/bots-seafarers-cities-knights --table
    python3 scripts/bots-seafarers-cities-knights/capture.py --out test-results/bots-seafarers-cities-knights-before \\
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
# 電腦對手不支援這個規則組合時的提示（SF-4 起沒有改過）；SFCK-G 之前的組合房間就是這個狀態。
NOTE = {
    "zh-Hant": "電腦對手尚未支援這個規則組合。",
    "en": "Bot opponents can't play this ruleset yet.",
}
HARD_NOTE = {
    "zh-Hant": "困難電腦只支援基本版。",
    "en": "Hard bots play the base game only.",
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
        temporary = tempfile.TemporaryDirectory(prefix="catan-bots-seafarers-cities-knights-")
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


def record(path: Path, result: dict, name: str) -> None:
    result["screenshots"][path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    print("CAPTURE", name, flush=True)


def shot(page, out: Path, result: dict, name: str, width: int, height: int, full_page: bool = False) -> None:
    page.set_viewport_size({"width": width, "height": height})
    settle(page)
    overflow = page.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
    assert overflow <= 0, f"{name} overflows horizontally by {overflow}px"
    path = out / f"{name}.png"
    page.screenshot(path=str(path), full_page=full_page, animations="disabled")
    record(path, result, name)


def shot_element(page, locator, out: Path, result: dict, name: str, width: int, height: int) -> None:
    """只截取受影響的區域（大廳的電腦對手工具列）。"""
    page.set_viewport_size({"width": width, "height": height})
    settle(page)
    path = out / f"{name}.png"
    locator.screenshot(path=str(path), animations="disabled")
    record(path, result, name)


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


# 組合的 key 是排序後的擴充 id（`state/rulesets.ts`）；兩個擴充一起選才會解析成 sf-ck。
COMBINED = "citiesKnights+seafarers"


def has_both_expansions(resolved: str) -> bool:
    """選錯組合（例如只有 C&K）會讓案例默默驗到另一個規則集。"""
    return "航海家" in resolved and "城市與騎士" in resolved


def create_room(page, expansion: str, capacity: int) -> tuple[str, str]:
    """建房並回傳（畫面上解析出的規則組合文字，伺服器回傳的 profileId）。"""
    page.get_by_test_id("expansion-select").select_option(expansion)
    page.locator("#room-capacity").select_option(str(capacity))
    resolved = page.get_by_test_id("resolved-profile").inner_text()
    with page.expect_response(lambda r: r.url.endswith("/api/rooms") and r.request.method == "POST") as created:
        page.get_by_test_id("create-room").click()
    page.get_by_test_id("room-code").wait_for()
    payload = created.value.json()
    assert payload.get("ok"), payload
    return resolved, payload["data"]["profileId"]


def add_bot(page, level: str, expected: int) -> None:
    page.get_by_test_id("lobby-bot-level").select_option(level)
    page.get_by_test_id("add-bot").click()
    expect(page.locator("[data-bot=true]")).to_have_count(expected)


def set_locale(page, locale: str) -> None:
    page.get_by_test_id("locale-switch").select_option(locale)


def bot_levels_offered(page) -> list[str]:
    return page.eval_on_selector_all("[data-testid=lobby-bot-level] option", "els => els.map((e) => e.value)")


def host_move(view: dict, me: str):
    """真人座位的最小合法動作：放置（含 setup 船）、擲骰、結束回合，加上 base、Seafarers 與 C&K 的待決回應。"""
    hints = view.get("hints") or {}
    modules = hints.get("modules") or {}
    sea = modules.get("seafarers") or {}
    bandit = (modules.get("seafarersCitiesKnights") or {}).get("bandit")
    pending = view.get("pending")
    self_view = next(p for p in view["players"] if p["id"] == me)
    if pending:
        kind = pending["kind"]
        if kind == "discard" and me in pending["waitingFor"]:
            # 資源在前、commodity 在後；C&K 的棄牌可以混合兩者。
            hand = [r for r in RESOURCES for _ in range(self_view["resources"][r])]
            hand += [c for c, n in (self_view.get("commodities") or {}).items() for _ in range(n)]
            return {"type": "pending.discard", "resources": hand[: pending["required"][me]]}
        if kind == "seafarers.gold":
            if (pending.get("responders") or [None])[0] != me:
                return None
            required = sea.get("goldRequired") or 0
            picks = [r for r in RESOURCES for _ in range(view["bank"][r])][:required]
            return {"type": "gold.choose", "resources": picks} if len(picks) == required else None
        if kind.startswith("citiesKnights."):
            if (pending.get("responders") or [None])[0] != me:
                return None
            data = pending.get("data") or {}
            if kind == "citiesKnights.pillage":
                cities = (data.get("cities") or {}).get(me) or []
                return {"type": "barbarians.pillage", "vertex": cities[0]} if cities else None
            if kind == "citiesKnights.scienceBonus":
                return {"type": "science.take", "resource": None}
            if kind == "citiesKnights.progressDiscard":
                need = (data.get("required") or {}).get(me) or 0
                cards = self_view.get("progressCards") or []
                return {"type": "progress.discard", "cards": cards[:need]} if len(cards) >= need else None
            if kind == "citiesKnights.defenderDraw":
                decks = data.get("decks") or []
                return {"type": "barbarians.chooseDeck", "track": decks[0]} if decks else None
            return None
        if pending.get("actor") != me:
            return None
        if kind == "moveRobber":
            terrain = view["board"]["terrain"]
            if bandit == "pirate":
                # 追擊海盜之後的 frame 只收海格或 null。
                hex_ = next(i for i, t in enumerate(terrain) if t == "sea" and i != view["board"]["pirate"])
            else:
                hex_ = next(i for i, t in enumerate(terrain) if i != view["board"]["robber"] and t != "sea")
            return {"type": "pending.moveRobber", "hex": hex_}
        if kind == "steal":
            return {"type": "pending.steal", "victim": pending["candidates"][0]}
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
    if phase == "action":
        excess = (modules.get("citiesKnights") or {}).get("progressExcess") or 0
        cards = self_view.get("progressCards") or []
        if excess > 0 and len(cards) >= excess:
            return {"type": "progress.discard", "cards": cards[:excess]}
        if hints.get("canEndTurn"):
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


def sfck_after(browser, out: Path, result: dict, errors: list[str]):
    context, page = guest(browser, errors, "航海騎士")
    resolved, profile_id = create_room(page, COMBINED, 4)
    result["checks"]["sfckProfile"] = profile_id == "sf-ck-new-shores-2025"
    result["resolved"]["sfck"] = resolved
    result["checks"]["sfckResolved"] = has_both_expansions(resolved)
    expect(page.get_by_test_id("add-bot")).to_be_enabled()
    result["checks"]["sfckWithoutNote"] = page.get_by_test_id("lobby-bots-unsupported").count() == 0
    # hard 只有基本版：下拉只有 easy 與 standard，工具列說明原因。
    levels = bot_levels_offered(page)
    result["checks"]["sfckLevels"] = levels
    result["checks"]["sfckHardUnavailable"] = levels == ["easy", "standard"]
    expect(page.get_by_test_id("lobby-bots-hard-base-only")).to_have_text(HARD_NOTE["zh-Hant"])
    shot_element(
        page, page.get_by_test_id("lobby-bots"), out, result, "sfck-lobby-bots-hard-unavailable-zh-Hant", 1366, 900,
    )
    add_bot(page, "standard", 1)
    add_bot(page, "easy", 2)
    badges = page.locator("[data-testid^=bot-badge-]")
    expect(badges).to_have_count(2)
    result["checks"]["sfckBotBadges"] = badges.all_inner_texts()
    shot(page, out, result, "sfck-lobby-bots-1366x900-zh-Hant", 1366, 900, full_page=True)
    set_locale(page, "en")
    expect(page.get_by_test_id("lobby-bots-hard-base-only")).to_have_text(HARD_NOTE["en"])
    shot(page, out, result, "sfck-lobby-bots-1366x900-en", 1366, 900, full_page=True)
    set_locale(page, "zh-Hant")
    page.set_viewport_size({"width": 1366, "height": 768})
    return context, page


def paired_after(browser, out: Path, result: dict, errors: list[str]) -> None:
    context, page = guest(browser, errors, "雙座航海騎士")
    resolved, profile_id = create_room(page, COMBINED, 5)
    result["checks"]["pairedProfile"] = profile_id == "sf-ck-new-shores-paired-2025"
    result["resolved"]["paired"] = resolved
    result["checks"]["pairedResolved"] = has_both_expansions(resolved)
    expect(page.get_by_test_id("add-bot")).to_be_enabled()
    add_bot(page, "standard", 1)
    add_bot(page, "easy", 2)
    shot(page, out, result, "sfck-paired-lobby-bots-1366x900-zh-Hant", 1366, 900, full_page=True)
    context.close()


def sfck_before(browser, out: Path, result: dict, errors: list[str]) -> None:
    context, page = guest(browser, errors, "航海騎士")
    resolved, profile_id = create_room(page, COMBINED, 4)
    result["checks"]["sfckProfile"] = profile_id == "sf-ck-new-shores-2025"
    result["resolved"]["sfck"] = resolved
    result["checks"]["sfckResolved"] = has_both_expansions(resolved)
    expect(page.get_by_test_id("add-bot")).to_be_disabled()
    note = page.get_by_test_id("lobby-bots-unsupported")
    expect(note).to_have_text(NOTE["zh-Hant"])
    shot(page, out, result, "sfck-lobby-bots-before-1366x900-zh-Hant", 1366, 900, full_page=True)
    set_locale(page, "en")
    expect(note).to_have_text(NOTE["en"])
    shot(page, out, result, "sfck-lobby-bots-before-1366x900-en", 1366, 900, full_page=True)
    context.close()


def table_after(context, page, out: Path, result: dict, timeout: float) -> None:
    add_bot(page, "standard", 3)
    session = api(context, "GET", "/api/session")
    me = session["player"]["id"] if "player" in session else session["id"]
    page.get_by_test_id("toggle-ready").click()
    expect(page.get_by_test_id("start-game")).to_be_enabled()
    page.get_by_test_id("start-game").click()
    # 等牌桌真的出現：開局請求與換頁是非同步的，網址比對會在點擊後立刻成立。
    page.get_by_test_id("game-stage").wait_for(timeout=60_000)
    games = api(context, "GET", "/api/games")
    game = (games["games"] if isinstance(games, dict) else games)[0]
    game_id = game["gameId"]
    # /api/games 的 ResumableGameView 使用 playerId（與牌桌 projection 的 id 不同）。
    bots = {p["playerId"] for p in game["players"] if p.get("bot")}
    result["checks"]["tableBots"] = len(bots)
    # --table 要求三個 bot 都入座，否則等於驗了另一個局面。
    result["checks"]["tableBotsSeated"] = len(bots) == 3
    found: dict = {}
    started = time.monotonic()

    def bot_progress(view: dict) -> bool:
        """船與騎士在棋盤上看得見，先等它們；等到一半的時限還沒有，改良也算（只在 C&K 面板與玩家列看得到）。"""
        if view["turn"]["phase"] == "setup":
            return False
        ships = [r for r in view["board"]["roads"] if r and r.get("ship") and r.get("player") in bots]
        knights = [k for k in ((view.get("modules") or {}).get("citiesKnights") or {}).get("knights", []) if k["player"] in bots]
        improved = [p["id"] for p in view["players"] if p["id"] in bots and sum((p.get("improvements") or {}).values()) > 0]
        found["ships"] = len(ships)
        found["knights"] = len(knights)
        found["improvedBots"] = len(improved)
        return bool(ships) or bool(knights) or (bool(improved) and time.monotonic() - started > timeout / 2)

    try:
        snapshot = play_host_until(context, game_id, me, bot_progress, timeout)
    except AssertionError as error:
        # 真人座位的簡化走法被拒絕：記錄原因，並讓 `tableProgress` 失敗（--table 就是要看到 bot 的進展）。
        result["checks"]["tableBotProgress"] = f"error: {error}"
        result["checks"]["tableProgress"] = False
        return
    if snapshot is None:
        result["checks"]["tableBotProgress"] = "timeout"
        result["checks"]["tableProgress"] = False
        return
    kind = "ships" if found.get("ships") else "knights" if found.get("knights") else "improvement"
    result["checks"]["tableBotProgress"] = kind
    # 船、騎士、改良至少要看到一種。
    result["checks"]["tableProgress"] = bool(found.get("ships") or found.get("knights") or found.get("improvedBots"))
    result["checks"]["tableRevision"] = snapshot["revision"]
    result["checks"]["tableBotShips"] = found.get("ships")
    result["checks"]["tableBotKnights"] = found.get("knights")
    result["checks"]["tableBotsImproved"] = found.get("improvedBots")
    name = f"sfck-table-bot-{kind}-1366x768-zh-Hant"
    shot(page, out, result, name, 1366, 768)
    result["checks"]["tableShot"] = (out / f"{name}.png").is_file()


def capture(root: Path, out: Path, before: bool, table: bool, table_timeout: float) -> dict:
    mode = "before" if before else "after"
    result: dict = {"mode": mode, "screenshots": {}, "checks": {}, "resolved": {}}
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
                sfck_before(browser, out, result, errors)
            else:
                context, page = sfck_after(browser, out, result, errors)
                paired_after(browser, out, result, errors)
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
    parser.add_argument("--before", action="store_true", help="check a build without SFCK-G")
    parser.add_argument("--table", action="store_true", help="also start a sf-ck-new-shores-2025 game with three bots")
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
