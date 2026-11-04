#!/usr/bin/env python3
"""Capture the step-by-step startup screen (#79) on the production build.

The harness serves `packages/web/dist` with its own temporary service and holds
or aborts individual requests with Playwright routes, so every step of the boot
screen stays on screen long enough to be photographed:

* static phase (`index.html`, before any script runs): the main bundle is held,
  the stylesheet arrives, so the download step shows its file count and size;
* React phase (`BootScreen`): the bundle is loaded and `/api/session`,
  `/api/games` or `/api/config` is held, so the matching step stays "in
  progress" while the earlier ones are done and the later ones wait;
* a first visit (no session) marks the games step "not needed";
* a request held past 8 s, in both phases, adds the "taking longer than usual"
  hint with a Refresh button;
* an aborted bundle leaves the static screen on a failed download step, and an
  aborted stylesheet keeps the React boot screen on its failure notice instead
  of showing an unstyled table.

Run after `pnpm build`:

    python3 scripts/boot-progress/capture.py --out test-results/boot-progress

The output directory must be new and empty. Copy the screenshots into
`docs/screenshots/boot-progress/` when updating that review set.
"""
from __future__ import annotations

import argparse
import base64
import importlib.util
import json
import re
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("board_evidence", ROOT / "scripts/board-3d/verify.py")
board = importlib.util.module_from_spec(spec)
spec.loader.exec_module(board)

DESKTOP = (1366, 768)
MOBILE = (390, 844)
LOCALES = {"zh-Hant": "zh-TW", "en": "en-US"}
MAIN_JS = re.compile(r"/assets/index-[^/]+\.js$")
MAIN_CSS = re.compile(r"/assets/index-[^/]+\.css$")
SLOW_SECONDS = 8.0

STATIC_STEPS = """() => Object.fromEntries(Array.from(document.querySelectorAll('#boot [data-step]'))
  .map(item => [item.dataset.step, item.dataset.status]))"""
REACT_STEPS = """() => Object.fromEntries(Array.from(document.querySelectorAll('[data-testid^="boot-step-"]'))
  .map(item => [item.dataset.testid.slice('boot-step-'.length), item.dataset.status]))"""
STATIC_PERCENT = "document.querySelector('#boot .boot__bar')?.getAttribute('aria-valuenow')"
REACT_PERCENT = "document.querySelector('[data-testid=\"boot-progress\"]')?.getAttribute('aria-valuenow')"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


class Gate:
    """Holds matching requests until `release()`, then lets them through unchanged."""

    def __init__(self) -> None:
        self.held: list = []
        self.released = False

    def __call__(self, route) -> None:
        if route.request.method != "GET" or self.released:
            route.continue_()
        else:
            self.held.append(route)

    def release(self) -> None:
        self.released = True
        for route in self.held:
            try:
                route.continue_()
            except Exception:
                # The page may already be closed; a held request has nothing left to deliver.
                pass
        self.held.clear()


def abort(route) -> None:
    route.abort("failed")


def capture(out: Path) -> dict:
    result: dict = {"screenshots": [], "states": {}, "consoleErrors": []}
    server = (None, None, None)

    def screenshot(page, name: str, held_bundle: bool = False) -> None:
        if held_bundle:
            # While the bundle request is still open the page never settles and
            # Page.screenshot waits for it; the DevTools capture does not.
            page.add_style_tag(content="*, *::before, *::after { animation: none !important; transition: none !important; }")
            page.wait_for_timeout(300)
            data = page.context.new_cdp_session(page).send("Page.captureScreenshot", {"format": "png"})["data"]
            (out / name).write_bytes(base64.b64decode(data))
        else:
            page.screenshot(path=str(out / name), animations="disabled")
        result["screenshots"].append(name)

    try:
        base, child, temporary, log = board.start_server(out)
        server = (child, temporary, log)
        from playwright.sync_api import sync_playwright

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, args=["--no-sandbox"])
            page_errors: list[str] = []

            def open_page(locale: str, size: tuple[int, int], storage_state=None):
                context = browser.new_context(
                    viewport={"width": size[0], "height": size[1]}, locale=LOCALES[locale],
                    device_scale_factor=1, service_workers="block", storage_state=storage_state)
                page = context.new_page()
                page.set_default_timeout(30_000)
                page.on("pageerror", lambda error: page_errors.append(str(error)))
                page.on("console", lambda message: message.type == "error"
                        and result["consoleErrors"].append(f"{message.location.get('url', '')}: {message.text}"))
                return context, page

            def hold(page, pattern, gate=None):
                gate = gate or Gate()
                page.route(pattern, gate)
                return gate

            def react_ready(page, percent: int) -> None:
                page.wait_for_function(f"{REACT_PERCENT} === '{percent}'")

            def name(slug: str, size: tuple[int, int], locale: str) -> str:
                return f"{slug}-{size[0]}x{size[1]}-{locale}.png"

            # A signed-in browser profile for the "looking for your games" step.
            context, page = open_page("zh-Hant", DESKTOP)
            page.goto(base + "/")
            page.get_by_test_id("nickname-input").fill("海岸領航員")
            page.locator("form button[type=submit]").click()
            page.get_by_test_id("create-room").wait_for()
            signed_in = context.storage_state()
            context.close()

            # 1. Static phase: the bundle is held, the stylesheet has arrived.
            for locale, size in (("zh-Hant", DESKTOP), ("en", MOBILE)):
                context, page = open_page(locale, size)
                hold(page, MAIN_JS)
                page.goto(base + "/", wait_until="commit")
                page.locator("#boot .boot__detail:not([hidden])").wait_for()
                steps = page.evaluate(STATIC_STEPS)
                percent = page.evaluate(STATIC_PERCENT)
                detail = page.locator("#boot .boot__detail").inner_text()
                require(steps["assets"] == "active" and set(list(steps.values())[1:]) == {"pending"},
                        f"unexpected static steps: {steps}")
                require(percent == "20", f"one of two assets loaded should read 20%: {percent}")
                result["states"][name("assets-downloading", size, locale)] = {"steps": steps, "percent": percent, "detail": detail}
                screenshot(page, name("assets-downloading", size, locale), held_bundle=True)
                context.close()

            # 2. React phase: every request is held, so only the download step is done.
            context, page = open_page("en", DESKTOP)
            gates = [hold(page, f"**/api/{path}") for path in ("config", "session", "profiles")]
            page.goto(base + "/")
            react_ready(page, 40)
            steps = page.evaluate(REACT_STEPS)
            require(steps == {"assets": "done", "config": "active", "session": "pending",
                              "profiles": "pending", "games": "pending"}, f"unexpected steps: {steps}")
            result["states"][name("requests-waiting", DESKTOP, "en")] = {"steps": steps, "percent": 40}
            screenshot(page, name("requests-waiting", DESKTOP, "en"))
            for gate in gates:
                gate.release()
            context.close()

            # 3. Only the session request is held.
            for locale, size in (("zh-Hant", DESKTOP), ("en", MOBILE)):
                context, page = open_page(locale, size)
                gate = hold(page, "**/api/session")
                page.goto(base + "/")
                react_ready(page, 70)
                steps = page.evaluate(REACT_STEPS)
                require(steps == {"assets": "done", "config": "done", "session": "active",
                                  "profiles": "done", "games": "pending"}, f"unexpected steps: {steps}")
                result["states"][name("session-pending", size, locale)] = {"steps": steps, "percent": 70}
                screenshot(page, name("session-pending", size, locale))
                gate.release()
                context.close()

            # 4. A signed-in player: the games request is the last one.
            context, page = open_page("en", DESKTOP, signed_in)
            gate = hold(page, "**/api/games")
            page.goto(base + "/")
            react_ready(page, 85)
            steps = page.evaluate(REACT_STEPS)
            require(steps == {"assets": "done", "config": "done", "session": "done",
                              "profiles": "done", "games": "active"}, f"unexpected steps: {steps}")
            result["states"][name("games-pending", DESKTOP, "en")] = {"steps": steps, "percent": 85}
            screenshot(page, name("games-pending", DESKTOP, "en"))
            gate.release()
            context.close()

            # 5. A first visit: no session, so the games step is skipped while the config request is held.
            context, page = open_page("zh-Hant", MOBILE)
            gate = hold(page, "**/api/config")
            page.goto(base + "/")
            react_ready(page, 85)
            steps = page.evaluate(REACT_STEPS)
            require(steps == {"assets": "done", "config": "active", "session": "done",
                              "profiles": "done", "games": "skipped"}, f"unexpected steps: {steps}")
            result["states"][name("first-visit-games-skipped", MOBILE, "zh-Hant")] = {"steps": steps, "percent": 85}
            screenshot(page, name("first-visit-games-skipped", MOBILE, "zh-Hant"))
            gate.release()
            context.close()

            # 6. Slow hint in the static phase (bundle still held after 8 s).
            context, page = open_page("zh-Hant", DESKTOP)
            hold(page, MAIN_JS)
            started = time.monotonic()
            page.goto(base + "/", wait_until="commit")
            page.locator("#boot .boot__slow:not([hidden])").wait_for(timeout=20_000)
            waited = time.monotonic() - started
            require(waited >= SLOW_SECONDS - 1, f"slow hint appeared too early: {waited:.2f}s")
            result["states"][name("slow-hint-assets", DESKTOP, "zh-Hant")] = {
                "secondsToHint": round(waited, 2), "steps": page.evaluate(STATIC_STEPS)}
            screenshot(page, name("slow-hint-assets", DESKTOP, "zh-Hant"), held_bundle=True)
            context.close()

            # 7. Slow hint in the React phase (session request still held after 8 s).
            context, page = open_page("en", DESKTOP)
            hold(page, "**/api/session")
            started = time.monotonic()
            page.goto(base + "/")
            page.get_by_test_id("boot-slow").wait_for(timeout=20_000)
            waited = time.monotonic() - started
            require(waited >= SLOW_SECONDS - 1, f"slow hint appeared too early: {waited:.2f}s")
            react_ready(page, 70)
            result["states"][name("slow-hint-session", DESKTOP, "en")] = {
                "secondsToHint": round(waited, 2), "steps": page.evaluate(REACT_STEPS)}
            screenshot(page, name("slow-hint-session", DESKTOP, "en"))
            context.close()

            # 8. The bundle fails to download: the static screen marks the step failed and offers Refresh.
            for locale, size in (("zh-Hant", DESKTOP), ("en", MOBILE)):
                context, page = open_page(locale, size)
                page.route(MAIN_JS, abort)
                page.goto(base + "/", wait_until="commit")
                page.locator("#boot[data-failed]").wait_for()
                page.locator("#boot .boot__slow:not([hidden])").wait_for()
                steps = page.evaluate(STATIC_STEPS)
                require(steps["assets"] == "failed", f"download step is not marked failed: {steps}")
                require(page.locator("#boot .boot__reload").is_visible(), "refresh button is not offered")
                result["states"][name("bundle-failed", size, locale)] = {
                    "steps": steps, "percent": page.evaluate(STATIC_PERCENT),
                    "htmlBootFailed": page.evaluate("document.documentElement.hasAttribute('data-boot-failed')")}
                screenshot(page, name("bundle-failed", size, locale))
                context.close()

            # 9. Only the stylesheet fails: React still mounts but stays on the failure notice.
            context, page = open_page("en", DESKTOP)
            page.route(MAIN_CSS, abort)
            page.goto(base + "/", wait_until="commit")
            page.get_by_test_id("boot-failed").wait_for()
            page.wait_for_function(f"{REACT_PERCENT} === '100'")
            steps = page.evaluate(REACT_STEPS)
            require(steps["assets"] == "failed", f"download step is not marked failed: {steps}")
            require(page.get_by_test_id("boot-screen").get_attribute("data-failed") is not None,
                    "boot screen did not stay on the failure notice")
            page.wait_for_timeout(1500)
            require(page.get_by_test_id("boot-screen").is_visible(), "the app left the boot screen without its stylesheet")
            result["states"][name("stylesheet-failed", DESKTOP, "en")] = {"steps": steps, "percent": 100}
            screenshot(page, name("stylesheet-failed", DESKTOP, "en"))
            context.close()

            require(not page_errors, f"page errors: {page_errors}")
            browser.close()
        return result
    finally:
        if server[0]:
            board.stop_server(*server)
        (out / "report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def output_path(value: str) -> Path:
    path = Path(value)
    path = path if path.is_absolute() else ROOT / path
    if path.exists() and any(path.iterdir()):
        raise SystemExit(f"refusing to overwrite a non-empty directory: {path}")
    path.mkdir(parents=True, exist_ok=True)
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="test-results/boot-progress")
    args = parser.parse_args()
    out = output_path(args.out)
    result = capture(out)
    print(json.dumps({"out": str(out), **result}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
