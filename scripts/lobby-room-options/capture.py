#!/usr/bin/env python3
"""Before/after evidence for moving the setup mode and game order options from
the create form into the room settings, on the production build.

Starts the built service on a disposable SQLite database and drives one host:
the create form, then the lobby right after creating a room. With
`--phase after` it also changes both options in the lobby, saves them and
checks the room API.

Run after `pnpm build`:

    python3 scripts/lobby-room-options/capture.py --phase after --out test-results/lobby-room-options/after

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
TIMEOUT_MS = 60_000


def free_port() -> int:
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        return int(reservation.getsockname()[1])


def start_server(out: Path):
    global BASE
    if not SERVER_ENTRY.is_file() or not (DIST / "index.html").is_file():
        raise SystemExit("built artifacts missing; run pnpm build first")
    temporary = tempfile.TemporaryDirectory(prefix="catan-lobby-room-options-")
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


def api(context, method: str, path: str):
    response = context.request.fetch(BASE + path, method=method)
    payload = response.json()
    if not response.ok or not payload.get("ok"):
        raise AssertionError((method, path, response.status, payload))
    return payload["data"]


def settle(page) -> None:
    page.evaluate("document.fonts.ready")
    page.evaluate("() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
    page.wait_for_timeout(500)


def capture(out: Path, phase: str) -> dict:
    server = (None, None, None)
    files: list[str] = []
    checks: dict = {}
    try:
        server = start_server(out)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, args=["--no-sandbox", "--enable-unsafe-swiftshader"])
            context = browser.new_context(viewport={"width": 1366, "height": 768}, locale="zh-TW",
                                          reduced_motion="reduce", device_scale_factor=1)
            context.add_init_script("localStorage.setItem('catan.locale', 'zh-Hant');")
            page = context.new_page()
            page.set_default_timeout(TIMEOUT_MS)
            errors: list[str] = []
            page.on("pageerror", lambda error: errors.append(str(error)))

            def take(name: str, width: int, height: int) -> None:
                page.set_viewport_size({"width": width, "height": height})
                settle(page)
                overflow = page.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
                assert overflow <= 0, f"{name} overflows horizontally by {overflow}px"
                page.screenshot(path=str(out / f"{name}.png"), full_page=True, animations="disabled")
                files.append(f"{name}.png")
                print("CAPTURE", name, flush=True)

            page.goto(BASE + "/?renderer=svg", wait_until="domcontentloaded")
            page.get_by_test_id("nickname-input").fill("Ada")
            page.locator("form button[type=submit]").first.click()
            page.get_by_test_id("create-room").wait_for()
            expect(page.get_by_test_id("resolved-profile")).to_be_visible()
            checks["createFormHasSetup"] = page.locator("#room-setup").count() > 0
            checks["createFormHasOrder"] = page.locator("#room-order").count() > 0
            take(f"01-create-form-1366x768-zh-Hant-{phase}", 1366, 768)
            take(f"02-create-form-390x844-zh-Hant-{phase}", 390, 844)
            page.set_viewport_size({"width": 1366, "height": 768})

            with page.expect_response(lambda r: r.url.endswith("/api/rooms") and r.request.method == "POST") as created:
                page.get_by_test_id("create-room").click()
            room_id = created.value.json()["data"]["id"]
            page.get_by_test_id("room-code").wait_for()
            checks["lobbyHasSetup"] = page.locator("#lobby-setup").count() > 0
            checks["lobbyHasOrder"] = page.locator("#lobby-order").count() > 0
            take(f"03-lobby-1366x768-zh-Hant-{phase}", 1366, 768)
            take(f"04-lobby-390x844-zh-Hant-{phase}", 390, 844)
            page.set_viewport_size({"width": 1366, "height": 768})

            if phase == "after":
                room = api(context, "GET", f"/api/rooms/{room_id}")
                checks["createdWithDefaults"] = room["setupMode"] == "fixed" and room["orderMode"] == "join"
                page.get_by_test_id("lobby-setup").select_option("variable")
                page.get_by_test_id("lobby-order").select_option("random")
                expect(page.get_by_test_id("save-settings")).to_be_enabled()
                page.get_by_test_id("save-settings").click()
                expect(page.get_by_test_id("save-settings")).to_be_disabled()
                room = api(context, "GET", f"/api/rooms/{room_id}")
                checks["savedFromLobby"] = room["setupMode"] == "variable" and room["orderMode"] == "random"
                take(f"05-lobby-saved-1366x768-zh-Hant-{phase}", 1366, 768)

            assert not errors, f"page errors: {errors}"
            context.close()
            browser.close()
    finally:
        stop_server(*server)
    return {"screenshots": files, "checks": checks}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", choices=["before", "after"], required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    out = (ROOT / args.out).resolve()
    if out.exists() and any(out.iterdir()):
        raise SystemExit(f"{out} must be new and empty")
    out.mkdir(parents=True, exist_ok=True)
    result = capture(out, args.phase)
    (out / "report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result["checks"], ensure_ascii=False, indent=2))
    if args.phase == "after":
        expected = {"createFormHasSetup": False, "createFormHasOrder": False, "lobbyHasSetup": True,
                    "lobbyHasOrder": True, "createdWithDefaults": True, "savedFromLobby": True}
        failed = [name for name, value in expected.items() if result["checks"].get(name) != value]
        assert not failed, f"failed checks: {failed}"


if __name__ == "__main__":
    main()
