#!/usr/bin/env python3
"""Browser evidence for the clipping and overlap fixes in #101-#104, on the production build.

Starts the built service on a disposable SQLite database, seats three humans
(one of them with a 24-character nickname, as in `scripts/screenshots/`) and
drives the host through the real UI:

* #101 the lobby's room-settings plaque: both selects must show their widest
  option ("Random draw", "依進房順序") at 1366x768, at the stacked 1024x768 and
  844x390 layouts, in the single-column 740x360 landscape layout and on a
  390x844 phone, in both locales;
* #103 the ambiguity target picker during the host's first initial placement:
  at 1366x640 (three overlapping targets) and on a touch-emulated 390x844 phone,
  every row is fully visible and none is covered by the resource strip;
* #104 the "Rotate to landscape" hint: hidden on a touch-emulated 568x320
  landscape phone, still shown on a 390x844 portrait phone;
* #102 the post-game overview table at 1366x768: headers wrap, the clipped right
  edge shows the scroll cue, and scrolling to the end reveals every column.

The rest of the game (after the picker shots) is played through the API, not
the UI, to reach the result screen.

Run after `pnpm build`:

    python3 scripts/layout-clipping/capture.py --out test-results/layout-clipping

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
BASE = ""
NAMES = ["海岸領航員", "小美", "ABCDEFGHIJKLMNOPQRSTUVWX"]
RESOURCES = ["lumber", "brick", "wool", "grain", "ore"]
TIMEOUT_MS = 60_000
# 與 BoardTargetOverlay 相同的消歧規則：兩軸都在 44px 內，或距離小於 30px。
HIT_PX = 44
AMBIGUITY_PX = 30

# 每個選單的實際寬度與最寬選項所需寬度（max-content），以及標籤是否被擠到選單上方。
SELECT_FACTS = """() => Array.from(document.querySelectorAll('#lobby-capacity, #lobby-order')).map((select) => {
  const actual = select.getBoundingClientRect().width;
  const saved = select.getAttribute('style');
  select.style.width = 'max-content';
  select.style.minWidth = '0';
  select.style.maxWidth = 'none';
  const needed = select.getBoundingClientRect().width;
  if (saved === null) select.removeAttribute('style'); else select.setAttribute('style', saved);
  const label = document.querySelector(`label[for="${select.id}"]`).getBoundingClientRect();
  const plaque = select.closest('.plaque').getBoundingClientRect();
  const box = select.getBoundingClientRect();
  return {
    id: select.id,
    value: select.options[select.selectedIndex].text,
    width: Math.round(actual),
    needed: Math.round(needed),
    fits: actual + 0.5 >= needed,
    insidePlaque: box.left >= plaque.left - 0.5 && box.right <= plaque.right + 0.5,
    labelAbove: label.bottom <= box.top + 1,
  };
})"""

# 找出棋盤上最適合示範的密集目標：群集內至少 3 個、最靠近棋盤中心，且該點上方確實是目標按鈕。
DENSE_TARGET = """() => {
  const hit = %d, near = %d;
  const buttons = Array.from(document.querySelectorAll('button[data-target-kind="vertex"]'));
  const points = buttons.map((button) => {
    const box = button.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2, index: Number(button.dataset.targetIndex) };
  }).filter((point) => point.x > 0 && point.y > 0 && point.x < innerWidth && point.y < innerHeight);
  const surface = (document.querySelector('[data-testid="board"]') || document.body).getBoundingClientRect();
  const centre = { x: surface.left + surface.width / 2, y: surface.top + surface.height / 2 };
  const ambiguous = (a, b) => (Math.abs(a.x - b.x) < hit && Math.abs(a.y - b.y) < hit) || Math.hypot(a.x - b.x, a.y - b.y) < near;
  const scored = points.map((point) => {
    const top = document.elementFromPoint(point.x, point.y);
    return {
      ...point,
      size: points.filter((other) => ambiguous(point, other)).length,
      onTarget: !!top && !!top.closest('button[data-target-kind]'),
      away: Math.hypot(point.x - centre.x, point.y - centre.y),
    };
  }).filter((point) => point.onTarget);
  const best = Math.min(3, Math.max(0, ...scored.map((point) => point.size)));
  const pool = scored.filter((point) => point.size >= best);
  pool.sort((a, b) => a.away - b.away);
  return pool[0] ? { x: pool[0].x, y: pool[0].y, size: pool[0].size } : null;
}""" % (HIT_PX, AMBIGUITY_PX)

# 每一列是否完整落在清單可視範圍內，以及列中心點最上層的元素是否仍屬於選擇器。
PICKER_FACTS = """() => {
  const picker = document.querySelector('.target-picker');
  const list = picker.querySelector('.target-picker__list');
  const view = list.getBoundingClientRect();
  const box = picker.getBoundingClientRect();
  const tally = document.querySelector('.game__dock .resource-tally');
  const rows = Array.from(list.querySelectorAll('button')).map((button) => {
    const row = button.getBoundingClientRect();
    const hit = document.elementFromPoint(row.left + row.width / 2, row.top + row.height / 2);
    return {
      fullyVisible: row.top >= view.top - 0.5 && row.bottom <= view.bottom + 0.5 && row.bottom <= innerHeight,
      covered: !hit || !picker.contains(hit),
    };
  });
  return {
    box: { top: Math.round(box.top), bottom: Math.round(box.bottom), left: Math.round(box.left), right: Math.round(box.right) },
    resourceStripTop: tally ? Math.round(tally.getBoundingClientRect().top) : null,
    zIndex: getComputedStyle(picker).zIndex,
    options: rows.length,
    listScrolls: list.scrollHeight > list.clientHeight + 1,
    scrollCue: picker.hasAttribute('data-more-below'),
    allRowsVisible: rows.every((row) => row.fullyVisible),
    coveredRows: rows.filter((row) => row.covered).length,
  };
}"""

HINT_FACTS = """() => {
  const hint = document.querySelector('.game__orientation');
  const style = getComputedStyle(hint);
  return { display: style.display, visible: style.display !== 'none' && hint.getBoundingClientRect().height > 0,
    orientation: matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape' };
}"""

TABLE_FACTS = """() => {
  const table = document.querySelector('[data-testid="stats-table-overview"]');
  const scroller = table.parentElement;
  const frame = scroller.parentElement;
  const heads = Array.from(table.querySelectorAll('thead th'));
  // 標題文字實際排成幾行：以文字範圍的各行矩形頂端計數。
  const lines = (th) => {
    const range = document.createRange();
    range.selectNodeContents(th);
    return new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top))).size;
  };
  return {
    scrollWidth: scroller.scrollWidth,
    clientWidth: scroller.clientWidth,
    scrollLeft: Math.round(scroller.scrollLeft),
    overflowEnd: frame.hasAttribute('data-overflow-end'),
    overflowStart: frame.hasAttribute('data-overflow-start'),
    role: scroller.getAttribute('role'),
    label: scroller.getAttribute('aria-label'),
    tabIndex: scroller.tabIndex,
    wrappedHeaders: heads.filter((th) => lines(th) > 1).map((th) => th.textContent),
    lastHeader: heads[heads.length - 1].textContent,
    lastHeaderVisible: (() => {
      const last = heads[heads.length - 1].getBoundingClientRect();
      const view = scroller.getBoundingClientRect();
      return last.left >= view.left - 0.5 && last.right <= view.right + 0.5;
    })(),
  };
}"""


def free_port() -> int:
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        return int(reservation.getsockname()[1])


def start_server(out: Path):
    global BASE
    if not SERVER_ENTRY.is_file() or not (DIST / "index.html").is_file():
        raise SystemExit("built artifacts missing; run pnpm build first")
    temporary = tempfile.TemporaryDirectory(prefix="catan-layout-clipping-")
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


def api(context, method: str, path: str, data=None):
    response = context.request.fetch(BASE + path, method=method, data=data)
    payload = response.json()
    if not response.ok or not payload.get("ok"):
        raise AssertionError((method, path, response.status, payload))
    return payload["data"]


def send(context, game_id: str, revision: int, command: dict) -> bool:
    # 被拒絕的指令回傳 False，由呼叫端改試下一個候選
    response = context.request.post(
        f"{BASE}/api/games/{game_id}/commands",
        data={"commandId": str(uuid.uuid4()), "expectedRevision": revision, "command": command},
    )
    payload = response.json()
    return bool(payload.get("ok")) and payload["data"]["outcome"] == "accepted"


def turn_candidates(view: dict, me: str) -> list[dict]:
    # 與 scripts/screenshots/capture-current.py 相同的簡單策略；初始放置也改走 API
    hints = view["hints"]
    if view["turn"]["phase"] == "setup":
        if view["turn"]["setup"]["stage"] == "road":
            return [{"type": "setup.placeRoad", "edge": edge} for edge in hints["legalRoads"][:3]]
        return [{"type": "setup.placeBuilding", "vertex": vertex} for vertex in hints["legalSettlements"][:3]]
    if hints["canRoll"]:
        return [{"type": "turn.roll"}]
    own = next(player for player in view["players"] if player["id"] == me)
    resources = own["resources"]
    moves = [{"type": "build.city", "vertex": vertex} for vertex in hints["legalCities"]]
    moves += [{"type": "build.settlement", "vertex": vertex} for vertex in hints["legalSettlements"]]
    moves.append({"type": "build.devCard"})
    if not hints["legalSettlements"] and hints["legalRoads"]:
        moves.append({"type": "build.road", "edge": hints["legalRoads"][0]})
    for give in RESOURCES:
        if resources[give] >= hints["bankRates"][give]:
            receive = min((r for r in RESOURCES if r != give), key=lambda r: resources[r])
            moves.append({"type": "trade.bank", "give": give, "receive": receive})
    moves.append({"type": "turn.end"})
    return moves


def play_to_result(contexts, identity: list[str], game_id: str, limit: int = 6000) -> int:
    # 每一步只送出一個被接受的指令，再重新讀取狀態，避免 expectedRevision 過期
    path = f"/api/games/{game_id}"
    by_id = dict(zip(identity, contexts))
    for step in range(limit):
        snapshot = api(contexts[0], "GET", path)
        view, revision = snapshot["view"], snapshot["revision"]
        if view["result"]:
            return step
        pending = view["pending"]
        if pending is None:
            turn_id = view["turn"]["playerId"]
            candidates = [(by_id[turn_id], move) for move in turn_candidates(api(by_id[turn_id], "GET", path)["view"], turn_id)]
        elif pending["kind"] == "discard":
            candidates = []
            for pid in pending["waitingFor"]:
                own = api(by_id[pid], "GET", path)["view"]
                resources = next(player for player in own["players"] if player["id"] == pid)["resources"]
                pool = [r for r in RESOURCES for _ in range(resources[r])]
                candidates.append((by_id[pid], {"type": "pending.discard", "resources": pool[: pending["required"][pid]]}))
        elif pending["kind"] == "moveRobber":
            candidates = [(by_id[pending["actor"]], {"type": "pending.moveRobber", "hex": hex_}) for hex_ in range(40)]
        elif pending["kind"] == "steal":
            candidates = [(by_id[pending["actor"]], {"type": "pending.steal", "victim": victim}) for victim in pending["candidates"]]
        elif pending["kind"] == "yearOfPlenty":
            candidates = [(by_id[pending["actor"]], {"type": "pending.takeResource", "resource": r}) for r in RESOURCES]
        elif pending["kind"] == "freeRoads":
            actor_view = api(by_id[pending["actor"]], "GET", path)["view"]
            candidates = [(by_id[pending["actor"]], {"type": "build.road", "edge": edge}) for edge in actor_view["hints"]["legalRoads"]]
        else:
            raise AssertionError(f"unhandled pending kind at step {step}: {pending}")
        if not any(send(context, game_id, revision, command) for context, command in candidates):
            raise AssertionError(f"no legal move at step {step}: pending={pending} turn={view['turn']}")
    raise AssertionError(f"game did not finish within {limit} steps")


def settle(page, ms: int = 400) -> None:
    page.evaluate("document.fonts.ready")
    page.evaluate("() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
    page.wait_for_timeout(ms)


class Shots:
    def __init__(self, out: Path, files: list[str]):
        self.out = out
        self.files = files

    def take(self, page, name: str, selector: str | None = None) -> None:
        settle(page)
        path = str(self.out / f"{name}.png")
        if selector:
            page.locator(selector).first.screenshot(path=path, animations="disabled")
        else:
            page.screenshot(path=path, animations="disabled")
        self.files.append(f"{name}.png")
        print("CAPTURE", name, flush=True)


def set_locale(page, locale: str) -> None:
    page.locator("[data-testid=locale-switch-game], [data-testid=locale-switch]").first.select_option(locale)
    settle(page, 200)


def lobby_pass(page, shots: Shots, checks: dict) -> None:
    """#101: the room-settings selects at every lobby layout, in both locales."""
    layouts = [
        ((1366, 768), "en", "random", True),
        ((1366, 768), "zh-Hant", "join", True),
        ((1024, 768), "en", "random", True),
        ((844, 390), "en", "random", True),
        ((740, 360), "en", "random", True),
        ((390, 844), "zh-Hant", "join", True),
        # 只檢查、不拍攝的其他組合
        ((1366, 768), "en", "join", False),
        ((1366, 768), "zh-Hant", "random", False),
        ((1100, 700), "zh-Hant", "join", False),
        ((900, 600), "zh-Hant", "join", False),
        ((812, 375), "en", "random", False),
        ((640, 360), "zh-Hant", "join", False),
        ((390, 844), "en", "random", False),
        ((768, 1024), "en", "random", False),
    ]
    results = []
    for (width, height), locale, order, capture in layouts:
        page.set_viewport_size({"width": width, "height": height})
        set_locale(page, locale)
        page.get_by_test_id("lobby-order").select_option(order)
        page.locator(".lobby-settings").scroll_into_view_if_needed()
        settle(page, 150)
        facts = page.evaluate(SELECT_FACTS)
        columns = page.evaluate("getComputedStyle(document.querySelector('.lobby__layout')).gridTemplateColumns.split(' ').length")
        results.append({"viewport": f"{width}x{height}", "locale": locale, "order": order, "columns": columns, "selects": facts})
        if capture:
            shots.take(page, f"101-lobby-settings-{width}x{height}-{locale}", ".lobby-settings")
    checks["lobbySelects"] = results
    checks["lobbySelectsFit"] = all(s["fits"] and s["insidePlaque"] for row in results for s in row["selects"])
    # 窄於 820px 的橫屏改用單欄捲動版面。
    checks["narrowLandscapeSingleColumn"] = all(row["columns"] == 1 for row in results if row["viewport"] in ("740x360", "640x360", "812x375"))
    page.get_by_test_id("lobby-order").select_option("join")
    page.set_viewport_size({"width": 1366, "height": 768})
    set_locale(page, "en")
    shots.take(page, "101-lobby-1366x768-en")
    page.get_by_test_id("save-settings").click()
    expect(page.get_by_test_id("save-settings")).to_be_disabled()


def wait_for_targets(page) -> None:
    page.wait_for_function("document.querySelectorAll('button[data-target-kind=\"vertex\"]').length >= 20")


def open_ambiguous_picker(page, zoom_out: bool) -> dict:
    found = None
    for _ in range(9 if zoom_out else 1):
        found = page.evaluate(DENSE_TARGET)
        if found and found["size"] >= 3:
            break
        if not zoom_out or not page.get_by_test_id("zoom-out").is_enabled():
            break
        page.get_by_test_id("zoom-out").click()
        page.wait_for_timeout(300)
    assert found and found["size"] >= 2, f"no ambiguous intersections on screen: {found}"
    page.mouse.click(found["x"], found["y"])
    page.locator(".target-picker").wait_for()
    settle(page, 300)
    facts = page.evaluate(PICKER_FACTS)
    facts["clusterSize"] = found["size"]
    return facts


def phone_context(browser, storage, viewport: tuple[int, int], locale: str):
    context = browser.new_context(
        storage_state=storage,
        viewport={"width": viewport[0], "height": viewport[1]},
        locale="zh-TW" if locale == "zh-Hant" else "en-US",
        reduced_motion="reduce",
        has_touch=True,
        is_mobile=True,
        device_scale_factor=1,
    )
    context.add_init_script(f"localStorage.setItem('catan.locale', {json.dumps(locale)});")
    page = context.new_page()
    page.set_default_timeout(TIMEOUT_MS)
    return context, page


def resume_table(page, game_id: str) -> None:
    page.goto(BASE + "/?renderer=svg", wait_until="domcontentloaded")
    page.locator("#home-tab-resume").click()
    page.get_by_test_id(f"resume-{game_id}").click()
    page.get_by_test_id("board").wait_for(state="visible")
    wait_for_targets(page)


def table_pass(browser, host, storage, game_id: str, shots: Shots, checks: dict, errors: list[str]) -> None:
    """#103 picker on desktop and a portrait phone; #104 orientation hint on phones."""
    host.set_viewport_size({"width": 1366, "height": 640})
    set_locale(host, "en")
    wait_for_targets(host)
    checks["desktopPicker"] = open_ambiguous_picker(host, zoom_out=True)
    shots.take(host, "103-ambiguous-picker-1366x640-en")
    host.keyboard.press("Escape")
    expect(host.locator(".target-picker")).to_have_count(0)

    context, phone = phone_context(browser, storage, (390, 844), "zh-Hant")
    phone.on("pageerror", lambda error: errors.append(f"390x844: {error}"))
    try:
        resume_table(phone, game_id)
        checks["portraitHint"] = phone.evaluate(HINT_FACTS)
        checks["portraitPicker"] = open_ambiguous_picker(phone, zoom_out=False)
        shots.take(phone, "103-ambiguous-picker-390x844-zh-Hant")
        phone.get_by_test_id("target-picker-close").click()
        expect(phone.locator(".target-picker")).to_have_count(0)
        shots.take(phone, "104-table-portrait-hint-390x844-zh-Hant")
    finally:
        context.close()

    context, phone = phone_context(browser, storage, (568, 320), "en")
    phone.on("pageerror", lambda error: errors.append(f"568x320: {error}"))
    try:
        resume_table(phone, game_id)
        checks["landscapeHint"] = phone.evaluate(HINT_FACTS)
        checks["compactLayout"] = phone.get_by_test_id("game-stage").get_attribute("data-layout")
        shots.take(phone, "104-table-no-hint-568x320-en")
    finally:
        context.close()

    for label in ("desktopPicker", "portraitPicker"):
        facts = checks[label]
        checks[f"{label}AllRowsVisible"] = facts["allRowsVisible"] and not facts["listScrolls"]
        checks[f"{label}NotCovered"] = facts["coveredRows"] == 0
    checks["hintShownInPortrait"] = checks["portraitHint"]["visible"]
    checks["hintHiddenInLandscape"] = not checks["landscapeHint"]["visible"]


def result_pass(host, shots: Shots, checks: dict) -> None:
    """#102: the overview table on the result screen at 1366x768."""
    host.set_viewport_size({"width": 1366, "height": 768})
    expect(host.get_by_test_id("result-screen")).to_be_visible(timeout=TIMEOUT_MS)
    table = host.get_by_test_id("stats-table-overview")
    scroller = table.locator("xpath=..")
    for locale in ("en", "zh-Hant"):
        set_locale(host, locale)
        scroller.evaluate("(element) => { element.scrollLeft = 0; }")
        settle(host, 300)
        before = host.evaluate(TABLE_FACTS)
        shots.take(host, f"102-result-overview-1366x768-{locale}")
        scroller.evaluate("(element) => { element.scrollLeft = element.scrollWidth; }")
        settle(host, 300)
        after = host.evaluate(TABLE_FACTS)
        shots.take(host, f"102-result-overview-scrolled-1366x768-{locale}", "[data-testid=game-stats]")
        checks[f"overview-{locale}"] = {"before": before, "after": after}
        overflowing = before["scrollWidth"] > before["clientWidth"]
        checks[f"overview-{locale}-cueWhileClipped"] = (not overflowing) or (before["overflowEnd"] and before["role"] == "region" and before["tabIndex"] == 0)
        checks[f"overview-{locale}-lastColumnReachable"] = after["lastHeaderVisible"] and not after["overflowEnd"]
    scroller.evaluate("(element) => { element.scrollLeft = 0; }")


def capture(out: Path) -> dict:
    result: dict = {"screenshots": [], "checks": {}}
    files = result["screenshots"]
    checks = result["checks"]
    server = (None, None, None)
    errors: list[str] = []
    try:
        server = start_server(out)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, args=["--no-sandbox", "--enable-unsafe-swiftshader"])
            contexts = [
                browser.new_context(viewport={"width": 1366, "height": 768}, locale="en-US", reduced_motion="reduce")
                for _ in NAMES
            ]
            pages = []
            for context, name in zip(contexts, NAMES):
                context.add_init_script("localStorage.setItem('catan.locale', 'en');")
                page = context.new_page()
                page.set_default_timeout(TIMEOUT_MS)
                page.on("pageerror", lambda error, who=name: errors.append(f"{who}: {error}"))
                page.goto(BASE + "/?renderer=svg", wait_until="domcontentloaded")
                page.get_by_test_id("nickname-input").fill(name)
                page.locator("form button[type=submit]").first.click()
                page.get_by_test_id("create-room").wait_for()
                pages.append(page)
            host = pages[0]
            shots = Shots(out, files)

            host.locator("#room-capacity").select_option("3")
            host.get_by_test_id("room-order").select_option("random")
            host.get_by_test_id("create-room").click()
            code = host.get_by_test_id("room-code").inner_text()
            lobby_pass(host, shots, checks)

            for page in pages[1:]:
                page.locator("#join-code").fill(code)
                page.get_by_test_id("join-room").click()
                expect(page.get_by_test_id("toggle-ready")).to_be_visible()
            for page in pages:
                page.get_by_test_id("toggle-ready").click()
            expect(host.get_by_test_id("start-game")).to_be_enabled()
            host.get_by_test_id("start-game").click()
            host.get_by_test_id("setup-guide").wait_for()

            identity = [api(context, "GET", "/api/session")["player"]["id"] for context in contexts]
            game_id = api(contexts[0], "GET", "/api/games")["games"][0]["gameId"]
            view = api(contexts[0], "GET", f"/api/games/{game_id}")["view"]
            # 依進房順序：房主先放，所有交叉點都是合法目標。
            checks["hostPlacesFirst"] = view["turn"]["phase"] == "setup" and view["turn"]["playerId"] == identity[0]
            table_pass(browser, host, contexts[0].storage_state(), game_id, shots, checks, errors)

            checks["playedSteps"] = play_to_result(contexts, identity, game_id)
            result_pass(host, shots, checks)
            checks["pageErrors"] = errors
            browser.close()
    finally:
        stop_server(*server)
    failed = [name for name, value in checks.items() if value is False]
    if errors:
        failed.append("pageErrors")
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
    try:
        result = capture(out)
    except AssertionError as error:
        print(f"FAILED: {error}", flush=True)
        raise
    (out / "report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in result["checks"].items() if isinstance(value, bool)}, indent=2))


if __name__ == "__main__":
    main()
