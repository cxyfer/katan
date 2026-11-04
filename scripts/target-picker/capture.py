#!/usr/bin/env python3
"""Browser evidence for the compact target picker (#85) on the production build.

Starts the built service on a disposable SQLite database and drives one host
through the real UI to the first initial-placement turn (join order, so the
host places first and all 54 intersections are legal targets), then:

* opens the picker from the board toolbar's "List targets" button (no anchor);
* zooms out until several intersections sit within one touch target of each
  other, clicks one so the ambiguity picker opens beside the clicked point;
* dismisses it by clicking the empty board (no target is selected and the click
  is not forwarded to the target underneath);
* repeats the ambiguity picker on a short landscape phone (844x390) and a
  portrait phone (390x844), both with touch emulation.

Moving the robber needs a rolled 7, which a real service cannot be told to
produce, so the picker is shown for the initial placement instead.

The 1366x768 board keeps at least 51.5 CSS px between neighbouring
intersections even at the 0.7 minimum zoom, which is more than the 44 px hit
target, so no ambiguity picker can open there. The overlapping-target shots are
therefore taken in a 1366x640 window (42.9 px at minimum zoom) and on phones.

Run after `pnpm build`:

    python3 scripts/target-picker/capture.py --out test-results/target-picker

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
TIMEOUT_MS = 60_000
# 與 BoardTargetOverlay 相同的消歧規則：兩軸都在 44px 內，或距離小於 30px。
HIT_PX = 44
AMBIGUITY_PX = 30

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
  return pool[0] ? { x: pool[0].x, y: pool[0].y, size: pool[0].size, index: pool[0].index } : null;
}""" % (HIT_PX, AMBIGUITY_PX)

# 棋盤上沒有目標按鈕、也不在工具列與選擇器內的空白點。
EMPTY_BOARD_POINT = """() => {
  const board = document.querySelector('[data-testid="board"]').getBoundingClientRect();
  const targets = Array.from(document.querySelectorAll('button[data-target-kind]')).map((button) => {
    const box = button.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  });
  let best = null;
  for (let y = board.top + 20; y < board.bottom - 20; y += 12) {
    for (let x = board.left + 20; x < board.right - 20; x += 12) {
      const top = document.elementFromPoint(x, y);
      if (!top || top.closest('button, .target-picker, .board__toolbar, summary, details, a, input, select, textarea')) continue;
      if (!top.closest('[data-testid="board"]')) continue;
      const clearance = Math.min(...targets.map((target) => Math.hypot(target.x - x, target.y - y)));
      if (!best || clearance > best.clearance) best = { x, y, clearance };
    }
  }
  return best;
}"""


def free_port() -> int:
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        return int(reservation.getsockname()[1])


def start_server(out: Path):
    global BASE
    if not SERVER_ENTRY.is_file() or not (DIST / "index.html").is_file():
        raise SystemExit("built artifacts missing; run pnpm build first")
    temporary = tempfile.TemporaryDirectory(prefix="catan-target-picker-")
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


def settle(page, ms: int = 500) -> None:
    page.evaluate("document.fonts.ready")
    page.evaluate("() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
    page.wait_for_timeout(ms)


class Shots:
    def __init__(self, page, out: Path, files: list[str]):
        self.page = page
        self.out = out
        self.files = files

    def take(self, name: str) -> None:
        settle(self.page)
        self.page.screenshot(path=str(self.out / f"{name}.png"), animations="disabled")
        self.files.append(f"{name}.png")
        print("CAPTURE", name, flush=True)


def picker_facts(page) -> dict:
    """Geometry of the open picker, asserted to be compact and fully on screen."""
    picker = page.locator(".target-picker")
    picker.wait_for()
    box = picker.bounding_box()
    viewport = page.viewport_size
    facts = {
        "box": {key: round(value, 1) for key, value in box.items()},
        "options": page.locator(".target-picker__list button").count(),
        "hasCloseButton": page.get_by_test_id("target-picker-close").count() == 1,
        "insideViewport": box["x"] >= 0 and box["y"] >= 0
        and box["x"] + box["width"] <= viewport["width"] + 0.5 and box["y"] + box["height"] <= viewport["height"] + 0.5,
        "compact": box["width"] <= 281 and box["height"] <= 261,
    }
    assert facts["insideViewport"], f"picker leaves the viewport: {facts}"
    assert facts["compact"], f"picker is not compact: {facts}"
    assert facts["hasCloseButton"], "picker has no close button"
    return facts


def open_ambiguous_picker(page, checks: dict, label: str, zoom_out: bool = False) -> dict:
    """Click an intersection that has neighbours within one touch target."""
    found = None
    for _ in range(9 if zoom_out else 1):
        found = page.evaluate(DENSE_TARGET)
        if found and found["size"] >= 3:
            break
        if not zoom_out or not page.get_by_test_id("zoom-out").is_enabled():
            break
        page.get_by_test_id("zoom-out").click()
        page.wait_for_timeout(300)
    assert found and found["size"] >= 2, f"{label}: no ambiguous intersections on screen: {found}"
    page.mouse.click(found["x"], found["y"])
    facts = picker_facts(page)
    facts["clickedIndex"] = found["index"]
    facts["clusterSize"] = found["size"]
    checks[f"{label}Picker"] = facts
    return facts


def dismiss_by_outside_click(page, checks: dict, label: str) -> None:
    point = page.evaluate(EMPTY_BOARD_POINT)
    assert point, f"{label}: no empty board point to click"
    page.mouse.click(point["x"], point["y"])
    expect(page.locator(".target-picker")).to_have_count(0)
    page.wait_for_timeout(300)
    # 外部點擊只關閉選擇器，不選取任何目標。
    checks[f"{label}DismissedWithoutSelection"] = page.get_by_test_id("selection-preview").count() == 0


def start_game(context, page) -> str:
    page.goto(BASE + "/?renderer=svg", wait_until="domcontentloaded")
    page.get_by_test_id("nickname-input").fill(HOST_NAME)
    page.locator("form button[type=submit]").first.click()
    page.get_by_test_id("create-room").wait_for()
    page.locator("#room-capacity").select_option("4")
    expect(page.get_by_test_id("resolved-profile")).to_be_visible()
    page.get_by_test_id("create-room").click()
    page.get_by_test_id("room-code").wait_for()
    page.get_by_test_id("lobby-bot-level").select_option("standard")
    for count in (1, 2, 3):
        page.get_by_test_id("add-bot").click()
        expect(page.locator("[data-bot=true]")).to_have_count(count)
    page.get_by_test_id("toggle-ready").click()
    expect(page.get_by_test_id("start-game")).to_be_enabled()
    page.get_by_test_id("start-game").click()
    page.get_by_test_id("setup-guide").wait_for()
    game = api(context, "GET", "/api/games")["games"][0]
    return game["gameId"]


def wait_for_targets(page) -> None:
    page.wait_for_function("document.querySelectorAll('button[data-target-kind=\"vertex\"]').length >= 20")


def phone_pass(browser, storage, game_id: str, out: Path, files: list[str], checks: dict, *, label: str, viewport: tuple[int, int], locale: str) -> None:
    """A touch-emulated phone resuming the same table (same session cookie)."""
    context = browser.new_context(
        storage_state=storage,
        viewport={"width": viewport[0], "height": viewport[1]},
        locale="zh-TW" if locale == "zh-Hant" else "en-US",
        reduced_motion="reduce",
        has_touch=True,
        is_mobile=True,
        device_scale_factor=1,
    )
    context.add_init_script(f"localStorage.setItem('catan.locale', '{locale}');")
    page = context.new_page()
    page.set_default_timeout(TIMEOUT_MS)
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    try:
        page.goto(BASE + "/?renderer=svg", wait_until="domcontentloaded")
        page.locator("#home-tab-resume").click()
        page.get_by_test_id(f"resume-{game_id}").click()
        page.get_by_test_id("board").wait_for(state="visible")
        wait_for_targets(page)
        checks[f"{label}Coarse"] = page.evaluate("matchMedia('(pointer: coarse)').matches")
        open_ambiguous_picker(page, checks, label)
        Shots(page, out, files).take(f"0{len(files) + 1}-ambiguous-picker-{viewport[0]}x{viewport[1]}-{locale}")
        dismiss_by_outside_click(page, checks, label)
        assert not errors, f"{label} page errors: {errors}"
    finally:
        context.close()


def capture(out: Path) -> dict:
    result: dict = {"screenshots": [], "checks": {}}
    files = result["screenshots"]
    checks = result["checks"]
    server = (None, None, None)
    try:
        server = start_server(out)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, args=["--no-sandbox", "--enable-unsafe-swiftshader"])
            context = browser.new_context(viewport={"width": 1366, "height": 768}, locale="en-US", reduced_motion="reduce")
            context.add_init_script("localStorage.setItem('catan.locale', 'en');")
            page = context.new_page()
            page.set_default_timeout(TIMEOUT_MS)
            errors: list[str] = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            shots = Shots(page, out, files)

            game_id = start_game(context, page)
            wait_for_targets(page)
            view = api(context, "GET", f"/api/games/{game_id}")["view"]
            session = api(context, "GET", "/api/session")
            me = session["player"]["id"] if "player" in session else session["id"]
            checks["hostPlacesFirst"] = view["turn"]["phase"] == "setup" and view["turn"]["playerId"] == me
            checks["legalIntersections"] = len(view["hints"]["legalSettlements"])

            # 1. 工具列的「列出目標」：沒有錨點，貼在工具列下方。
            page.get_by_test_id("open-target-picker").click()
            checks["listPicker"] = picker_facts(page)
            shots.take("01-target-list-1366x768-en")
            # 再按一次切換關閉，不會被外部點擊關閉後立刻重開。
            page.get_by_test_id("open-target-picker").click()
            expect(page.locator(".target-picker")).to_have_count(0)

            # 1366x768 在最小縮放仍有 51.5px 間距，放大到 44px 判定外，
            # 因此改用同寬但較矮的視窗，讓縮小後交點真的落進同一個觸控範圍。
            page.set_viewport_size({"width": 1366, "height": 640})
            wait_for_targets(page)

            # 2. 縮小棋盤讓相鄰交叉點落在同一個觸控範圍內，點擊後選擇器貼近點擊處。
            open_ambiguous_picker(page, checks, "desktop", zoom_out=True)
            shots.take("02-ambiguous-picker-1366x640-en")
            # 3. 點空白處關閉，不選取、也不把這次點擊轉給下面的目標。
            dismiss_by_outside_click(page, checks, "desktop")
            shots.take("03-dismissed-by-outside-click-1366x640-en")

            # 4. 繁體中文的同一個選擇器。
            page.get_by_test_id("locale-switch-game").select_option("zh-Hant")
            open_ambiguous_picker(page, checks, "desktopZh")
            shots.take("04-ambiguous-picker-1366x640-zh-Hant")
            dismiss_by_outside_click(page, checks, "desktopZh")
            checks["pageErrors"] = errors
            assert not errors, f"page errors: {errors}"

            # 5. 手機：短橫屏與直屏，觸控模擬，沿用同一個 session。
            storage = context.storage_state()
            phone_pass(browser, storage, game_id, out, files, checks, label="phoneLandscape", viewport=(844, 390), locale="en")
            phone_pass(browser, storage, game_id, out, files, checks, label="phonePortrait", viewport=(390, 844), locale="zh-Hant")
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
