#!/usr/bin/env python3
"""Capture review screenshots of entry, lobby and table against built assets."""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("board3d", ROOT / "scripts/board-3d/verify.py")
board = importlib.util.module_from_spec(spec)
spec.loader.exec_module(board)

VIEWPORTS = {"desktop": (1366, 768), "wide": (1600, 900), "mobile": (390, 844), "landscape": (844, 390)}


def settle(page, ms=400):
    page.evaluate("document.fonts.ready")
    page.wait_for_timeout(ms)


def pregame(browser, base, out, locale, name, size):
    context = browser.new_context(viewport={"width": size[0], "height": size[1]}, device_scale_factor=1,
                                  locale="zh-TW" if locale == "zh-Hant" else "en-US", reduced_motion="reduce")
    context.add_init_script(f"localStorage.setItem('catan.locale', {json.dumps(locale)});")
    page = context.new_page()
    page.goto(base + "/", wait_until="networkidle")
    settle(page)
    page.screenshot(path=str(out / f"entry-{name}-{locale}.png"))
    page.get_by_test_id("nickname-input").fill("浮浮酱" if locale == "zh-Hant" else "Captain Nyan")
    page.locator("form button[type=submit]").first.click()
    page.wait_for_load_state("networkidle")
    settle(page)
    page.screenshot(path=str(out / f"home-{name}-{locale}.png"), full_page=True)
    create = page.get_by_test_id("create-room")
    if create.count():
        create.click()
        page.wait_for_load_state("networkidle")
        settle(page, 800)
        page.screenshot(path=str(out / f"lobby-{name}-{locale}.png"), full_page=True)
    context.close()


def table(browser, base, fixture, out, renderer, locale, name, size, extras):
    scenario = board.Scenario(browser, base, SimpleNamespace(renderer=renderer, quality="standard"),
                              fixture, fixture["boards"][0], locale, size, out, motion="reduce")
    page = scenario.page
    settle(page, 1200 if renderer == "r3f" else 300)
    prefix = f"table-{renderer}-{name}-{locale}"
    page.screenshot(path=str(out / f"{prefix}.png"))
    if extras:
        for label, selector in (("rail", "[data-testid=players-toggle]"),
                                ("actions", "[data-testid=action-rail-toggle]")):
            toggle = page.locator(selector).first
            if toggle.count():
                toggle.click()
                settle(page)
                page.screenshot(path=str(out / f"{prefix}-{label}.png"))
                page.keyboard.press("Escape")
                settle(page)
        for tool in page.locator(".game-tools__tabs button").all()[:6]:
            text = (tool.inner_text() or "tool").strip().split("\n")[0][:12]
            tool.click()
            settle(page)
            page.screenshot(path=str(out / f"{prefix}-tool-{text}.png"))
            page.keyboard.press("Escape")
            settle(page)
        hand = page.locator(".hand-fan").first
        if hand.count():
            hand.hover(force=True)
            settle(page)
            page.screenshot(path=str(out / f"{prefix}-hand.png"))
    scenario.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="test-results/ui-refresh")
    parser.add_argument("--executable-path", default=str(Path.home() / ".cache/ms-playwright/chromium-1208/chrome-linux64/chrome"))
    parser.add_argument("--renderer", choices=("svg", "r3f"), default="r3f")
    parser.add_argument("--only", choices=("all", "pregame", "table"), default="all")
    args = parser.parse_args()
    out = board.output_path(args.out)
    fixture = json.loads((ROOT / "docs/aegis/work/2026-10-29-board-3d/evidence/fixtures-final.json").read_text())
    base, child, temporary, log = board.start_server(out)
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as api:
            browser = api.chromium.launch(headless=True, executable_path=args.executable_path,
                                          args=["--enable-unsafe-swiftshader"])
            for name, size in VIEWPORTS.items():
                for locale in ("zh-Hant", "en"):
                    if args.only in ("all", "pregame") and name != "wide":
                        pregame(browser, base, out, locale, name, size)
                    if args.only in ("all", "table"):
                        table(browser, base, fixture, out, args.renderer, locale, name, size,
                              extras=locale == "zh-Hant" or name == "desktop")
                    print(name, locale, flush=True)
            browser.close()
    finally:
        board.stop_server(child, temporary, log)


if __name__ == "__main__":
    main()
