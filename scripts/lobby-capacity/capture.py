#!/usr/bin/env python3
"""Capture lobby capacity and short-handed-start evidence for review.

The script starts the built service on a disposable SQLite database, drives one
four-seat base lobby (three players) and one six-seat paired lobby (five
players), and saves both locales plus a phone viewport. It deliberately uses
the real HTTP API for the guest sessions so the host page only holds the
browser under test; every visible state still comes from a live server.
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
CAPTURES = (
    "01-short-start-4p-zh-Hant",
    "02-short-start-4p-mobile-zh-Hant",
    "03-capacity-3p-zh-Hant",
    "04-capacity-3p-en",
    "05-short-start-6p-zh-Hant",
)


def free_port() -> int:
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        return int(reservation.getsockname()[1])


def start_server(out: Path):
    global BASE
    if not SERVER_ENTRY.is_file() or not (DIST / "index.html").is_file():
        raise SystemExit("built artifacts missing; run pnpm build first")
    temporary = tempfile.TemporaryDirectory(prefix="catan-lobby-capacity-")
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
    child = subprocess.Popen(
        ["node", str(SERVER_ENTRY)],
        cwd=ROOT,
        env=env,
        stdout=log,
        stderr=log,
    )
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


def guest(browser, name: str, code: str):
    context = browser.new_context(locale="zh-TW", reduced_motion="reduce")
    api(context, "POST", "/api/session", {"nickname": name, "locale": "zh-Hant"})
    api(context, "POST", "/api/rooms/join", {"code": code})
    return context


def ready(context, room_id: str) -> None:
    api(context, "POST", f"/api/rooms/{room_id}/ready", {"ready": True})


def open_host(browser, locale: str, nickname: str):
    context = browser.new_context(
        viewport={"width": 1366, "height": 768},
        device_scale_factor=1,
        locale="zh-TW" if locale == "zh-Hant" else "en-US",
        reduced_motion="reduce",
    )
    context.add_init_script(f"localStorage.setItem('catan.locale', {json.dumps(locale)});")
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.set_default_timeout(15_000)
    page.goto(BASE, wait_until="networkidle")
    page.get_by_test_id("nickname-input").fill(nickname)
    page.locator("form button[type=submit]").first.click()
    page.get_by_test_id("create-room").wait_for()
    return context, page, errors


def create_room(page, profile_id: str, capacity: int) -> str:
    page.get_by_test_id("profile-select").select_option(profile_id)
    page.locator("#room-capacity").select_option(str(capacity))
    page.locator("#room-setup").select_option("fixed")
    page.get_by_test_id("create-room").click()
    page.get_by_test_id("room-code").wait_for()
    return page.get_by_test_id("room-code").inner_text().strip()


def settle(page) -> None:
    page.evaluate("() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
    page.wait_for_timeout(350)


def shot(page, out: Path, name: str, width: int, height: int, full_page: bool = True) -> Path:
    page.set_viewport_size({"width": width, "height": height})
    settle(page)
    overflow = page.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
    assert overflow <= 0, f"{name} overflows horizontally by {overflow}px"
    path = out / f"{name}.png"
    page.screenshot(path=str(path), full_page=full_page, animations="disabled")
    print("CAPTURE", path.relative_to(ROOT), flush=True)
    return path


def expect_ready(page, seated: int, capacity: int) -> None:
    expect(page.locator(".lobby__seat-count")).to_have_text(f"{seated}/{capacity}")
    expect(page.get_by_test_id("start-blockers")).to_have_count(0)
    expect(page.get_by_test_id("start-game")).to_be_enabled()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="docs/screenshots/lobby-capacity")
    args = parser.parse_args()
    out = (ROOT / args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    for stale in CAPTURES:
        (out / f"{stale}.png").unlink(missing_ok=True)

    server = None
    playwright = None
    browser = None
    contexts = []
    try:
        server = start_server(out)
        playwright = sync_playwright().start()
        browser = playwright.chromium.launch(headless=True, args=["--no-sandbox"])

        # Four-seat base room, three seated. This is the short-handed case:
        # the room is not full and the server reports no start blockers.
        host_context, host, errors = open_host(browser, "zh-Hant", "海岸領航員")
        contexts.append(host_context)
        code = create_room(host, "base-2025", 4)
        room = api(host_context, "POST", "/api/rooms/join", {"code": code})
        guests = [
            guest(browser, "小美", code),
            guest(browser, "阿明", code),
        ]
        contexts.extend(guests)
        for guest_context in guests:
            ready(guest_context, room["id"])
        host.get_by_test_id("toggle-ready").click()
        expect_ready(host, 3, 4)
        expect(host.get_by_test_id("lobby-capacity")).to_have_value("4")
        expect(host.get_by_test_id("lobby-capacity").locator("option")).to_have_text(["3", "4"])
        shot(host, out, "01-short-start-4p-zh-Hant", 1366, 768)
        shot(host, out, "02-short-start-4p-mobile-zh-Hant", 390, 844)

        # The host lowers the cap to the three seated players. The server
        # clears readiness, so mark everyone ready again and confirm that a
        # three-player table remains startable.
        host.get_by_test_id("lobby-capacity").select_option("3")
        host.get_by_test_id("save-settings").click()
        expect(host.locator(".lobby__seat-count")).to_have_text("3/3")
        expect(host.get_by_test_id("lobby-capacity")).to_have_value("3")
        expect(host.get_by_test_id("save-settings")).to_be_disabled()
        for guest_context in guests:
            ready(guest_context, room["id"])
        host.get_by_test_id("toggle-ready").click()
        expect_ready(host, 3, 3)
        shot(host, out, "03-capacity-3p-zh-Hant", 1366, 768)

        # Same state in English, using the visible locale switch.
        host.get_by_test_id("locale-switch").select_option("en")
        expect(host.get_by_role("heading", name="Room settings")).to_be_visible()
        shot(host, out, "04-capacity-3p-en", 1366, 768)
        assert errors == [], errors

        # Six-seat paired room, five seated.
        paired_context, paired, paired_errors = open_host(browser, "zh-Hant", "六人桌房主")
        contexts.append(paired_context)
        paired_code = create_room(paired, "base-paired-2025", 6)
        paired_room = api(paired_context, "POST", "/api/rooms/join", {"code": paired_code})
        paired_guests = [
            guest(browser, f"夥伴{i + 1}", paired_code) for i in range(4)
        ]
        contexts.extend(paired_guests)
        for guest_context in paired_guests:
            ready(guest_context, paired_room["id"])
        paired.get_by_test_id("toggle-ready").click()
        expect_ready(paired, 5, 6)
        expect(paired.get_by_test_id("lobby-capacity")).to_have_value("6")
        expect(paired.get_by_test_id("lobby-capacity").locator("option")).to_have_text(["5", "6"])
        shot(paired, out, "05-short-start-6p-zh-Hant", 1366, 768)
        assert paired_errors == [], paired_errors
    finally:
        for context in contexts:
            try:
                context.close()
            except Exception:
                pass
        if browser is not None:
            browser.close()
        if playwright is not None:
            playwright.stop()
        if server is not None:
            stop_server(*server)
    print("done", flush=True)


if __name__ == "__main__":
    main()
