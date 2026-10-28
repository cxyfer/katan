"""Capture and exercise the public island preview against a production build."""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("board_evidence", ROOT / "scripts/board-3d/verify.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def state(page):
    return page.evaluate("""() => {
      const root = document.querySelector('[data-testid="island-preview"]');
      const surface = document.querySelector('[data-testid="island-preview-surface"]');
      const canvas = surface?.querySelector('canvas');
      const gl = canvas?.getContext('webgl2');
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      return {
        ready: root?.dataset.rendererStatus,
        zoom: Number(surface?.dataset.zoom),
        azimuth: Number(surface?.dataset.azimuth),
        center: [Number(surface?.dataset.centerX), Number(surface?.dataset.centerZ)],
        surface: surface?.getBoundingClientRect().toJSON(),
        viewport: [innerWidth, innerHeight],
        documentWidth: document.documentElement.scrollWidth,
        webgl: !!gl && !gl.isContextLost(),
        renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
        canvas: canvas ? [canvas.width, canvas.height] : null,
      };
    }""")


def settled(page):
    page.wait_for_function(
        "document.querySelector('[data-testid=\"island-preview\"]')?.dataset.rendererStatus === 'ready'"
    )
    page.evaluate("document.fonts.ready")
    page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    out = (ROOT / args.out).resolve()
    allowed = (ROOT / ".tmp", ROOT / "test-results")
    if not any(out.is_relative_to(path) and out != path for path in allowed):
        raise ValueError("--out must be inside .tmp or test-results")
    if out.exists() and any(out.iterdir()):
        raise ValueError("choose a new empty evidence directory")
    out.mkdir(parents=True, exist_ok=True)
    report = {"cases": [], "errors": [], "apiCalls": [], "screenshots": []}
    child = temporary = log = None
    source_hash = runner.tree_hash(list(runner.SOURCE_PATHS))
    report["sourceHash"] = source_hash
    try:
        base, child, temporary, log = runner.start_server(out)
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(ROOT / ".tmp/board-3d-browsers")
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                for width, height in [(1600, 1000), (390, 844)]:
                    context = browser.new_context(viewport={"width": width, "height": height},
                                                  device_scale_factor=1, reduced_motion="reduce",
                                                  has_touch=width < 700)
                    page = context.new_page()
                    page.on("pageerror", lambda error: report["errors"].append(str(error)))
                    page.on("console", lambda message: report["errors"].append(message.text)
                            if message.type == "error" else None)
                    page.on("request", lambda request: report["apiCalls"].append(request.url)
                            if urlparse(request.url).path.startswith("/api/") else None)
                    page.goto(base + "/?preview=island", wait_until="networkidle")
                    settled(page)
                    initial = state(page)
                    assert initial["webgl"] and initial["zoom"] == 1
                    assert initial["documentWidth"] <= width, initial
                    assert initial["surface"]["height"] >= height - 90, initial
                    name = f"island-19-{width}x{height}.png"
                    page.screenshot(path=str(out / name), full_page=True, animations="disabled")
                    report["screenshots"].append(name)
                    page.get_by_test_id("preview-zoom-in").click()
                    page.get_by_test_id("preview-zoom-in").click()
                    settled(page)
                    assert state(page)["zoom"] == 1.5625
                    page.get_by_test_id("preview-rotate-right").click()
                    settled(page)
                    assert state(page)["azimuth"] == 50
                    page.get_by_test_id("preview-rotate-left").click()
                    settled(page)
                    assert state(page)["azimuth"] == 20
                    surface = page.get_by_test_id("island-preview-surface")
                    before = state(page)["center"]
                    rect = surface.bounding_box()
                    page.mouse.move(rect["x"] + rect["width"] * .5, rect["y"] + rect["height"] * .55)
                    page.mouse.down()
                    page.mouse.move(rect["x"] + rect["width"] * .5 + 80,
                                    rect["y"] + rect["height"] * .55 + 35, steps=8)
                    page.mouse.up()
                    settled(page)
                    assert state(page)["center"] != before
                    surface.focus()
                    page.keyboard.press("]")
                    settled(page)
                    assert state(page)["azimuth"] == 50
                    page.keyboard.press("Home")
                    settled(page)
                    assert state(page)["zoom"] == 1 and state(page)["azimuth"] == 20
                    page.get_by_test_id("preview-zoom-in").click()
                    page.get_by_test_id("preview-zoom-in").click()
                    settled(page)
                    if width > 700:
                        name = "island-detail.png"
                        page.screenshot(path=str(out / name), animations="disabled")
                        report["screenshots"].append(name)
                    page.get_by_test_id("preview-fit").click()
                    page.get_by_test_id("preview-topology").select_option("hex-r56")
                    settled(page)
                    assert state(page)["zoom"] == 1
                    name = f"island-30-{width}x{height}.png"
                    page.screenshot(path=str(out / name), full_page=True, animations="disabled")
                    report["screenshots"].append(name)
                    page.get_by_test_id("preview-quality").select_option("low")
                    settled(page)
                    assert state(page)["webgl"]
                    report["cases"].append({"viewport": [width, height], "initial": initial,
                                            "final": state(page), "status": "PASS",
                                            "checked": ["fit", "zoom", "rotate", "drag", "keyboard",
                                                        "19/30 topology", "low quality", "overflow"]})
                    context.close()
            finally:
                browser.close()
        assert not report["errors"], report["errors"]
        assert not report["apiCalls"], "model preview must not use an identity or game API"
        assert source_hash == runner.tree_hash(list(runner.SOURCE_PATHS)), "source changed during capture"
        report["status"] = "PASS"
    except Exception as error:
        report["status"] = "FAIL"
        report["failure"] = str(error)
        raise
    finally:
        runner.stop_server(child, temporary, log)
        (out / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print(json.dumps({"status": report["status"], "out": str(out)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
