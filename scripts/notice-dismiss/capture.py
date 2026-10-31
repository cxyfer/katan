#!/usr/bin/env python3
"""Capture and time the transient-notice behaviour on the production build.

The harness serves `packages/web/dist` with a real service and the deterministic
four-seat `hex-r2` fixture, and routes `turn.end` commands to scripted outcomes:

* a definite rejection, which shows only the command receipt (the reason and
  retry live there; no duplicate toast) with an 8 s countdown ring around its
  close control;
* hovering the receipt holds the deadline and greys the ring; leaving resumes
  the remaining time; the receipt then fades out;
* a second rejection fades out as soon as the turn changes;
* a transport failure shows the network toast (top centre on the table, 6 s
  ring) and the unknown-outcome receipt, which has no countdown and stays.

Run after `pnpm build`:

    python3 scripts/notice-dismiss/capture.py --out test-results/notice-dismiss

The output directory must be new and empty. Copy the screenshots into
`docs/screenshots/notice-dismiss/` when updating that review set.
"""
from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import time
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("board_evidence", ROOT / "scripts/board-3d/verify.py")
board = importlib.util.module_from_spec(spec)
spec.loader.exec_module(board)

FIXTURE = ROOT / "docs/aegis/work/2026-10-29-board-3d/evidence/fixtures-final.json"
BOARD_ID = "hex-r2"
EXIT_SECONDS = 0.18
HOLD_SECONDS = 3.0
TOAST_SECONDS = (6.0, 7.2)
TURN_SWITCH_SECONDS = 1.0

RING = """() => Array.from(document.querySelectorAll('[data-testid="notice-countdown"]')).map(element => {
  const style = getComputedStyle(element);
  const duration = style.animationDuration.endsWith('ms')
    ? parseFloat(style.animationDuration) : parseFloat(style.animationDuration) * 1000;
  const total = 100;
  const offset = parseFloat(style.strokeDashoffset) || 0;
  return {owner: element.closest('[data-testid]:not([data-testid="notice-countdown"]):not([data-testid="notice-dismiss"])')?.dataset.testid,
          durationMs: duration, play: style.animationPlayState, paused: element.dataset.paused,
          remaining: Math.round((total - offset) / total * 100) / 100};
})"""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def capture(out: Path) -> dict:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    source = next(item for item in fixture["boards"] if item["id"] == BOARD_ID)
    result: dict = {"screenshots": [], "timings": {}, "rings": {}, "fixture": str(FIXTURE.relative_to(ROOT))}
    server = (None, None, None)
    scenario = None

    def screenshot(name: str) -> None:
        scenario.page.screenshot(path=str(out / name), animations="allow")
        result["screenshots"].append(name)

    try:
        base, child, temporary, log = board.start_server(out)
        server = (child, temporary, log)
        from playwright.sync_api import sync_playwright

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, args=["--enable-unsafe-swiftshader"])
            scenario = board.Scenario(
                browser, base, SimpleNamespace(renderer="svg", quality="standard"),
                fixture, source, "zh-Hant", (1366, 768), out,
                initial="snapshot", motion="no-preference",
            )
            page = scenario.page
            page.set_default_timeout(10_000)
            requests = []
            outcome = {"mode": "reject"}

            def route_command(route):
                request = route.request.post_data_json
                requests.append({"mode": outcome["mode"], **request})
                if outcome["mode"] == "network":
                    route.abort("connectionfailed")
                    return
                route.fulfill(status=200, json={"ok": True, "data": {
                    "commandId": request["commandId"],
                    "outcome": "rejected",
                    "revision": scenario.snapshot["revision"],
                    "error": {"messageId": "error.E_NOT_YOUR_TURN"},
                    "events": [],
                }})

            def rings() -> list[dict]:
                return page.evaluate(RING)

            def wait_status(value: str) -> None:
                page.wait_for_function(
                    f"document.querySelector('[data-testid=\"command-status\"]')?.dataset.status === '{value}'")

            page.route("**/api/games/g1/commands", route_command)
            page.get_by_test_id("action-rail-toggle").focus()
            page.wait_for_function(
                "document.querySelector('[data-testid=\"action-rail\"]')?.dataset.expanded === 'true'")
            end_turn = page.get_by_test_id("action-endTurn")
            end_turn.scroll_into_view_if_needed()
            status = page.get_by_test_id("command-status")
            toast = page.get_by_test_id("toast")

            # 1. A rejection shows one receipt with its reason, retry and an 8 s ring.
            end_turn.click()
            wait_status("rejected")
            started = time.monotonic()
            page.mouse.move(230, 420)
            require(toast.count() == 0, "a rejection must not raise a duplicate toast")
            require("目前不是你的回合" in status.inner_text(), "receipt does not carry the rejection reason")
            require(page.get_by_test_id("command-retry").is_visible(), "retry is not visible in the receipt")
            box = page.get_by_test_id("command-retry").bounding_box()
            stack = page.locator(".game__messages").bounding_box()
            require(box["y"] + box["height"] <= stack["y"] + stack["height"] + 1,
                    f"retry control is clipped by the message stack: {box} vs {stack}")
            initial = rings()
            require(len(initial) == 1 and abs(initial[0]["durationMs"] - 8000) < 1,
                    f"expected one eight-second ring: {initial}")
            require(initial[0]["play"] == "running", f"ring is not running: {initial}")
            page.wait_for_timeout(1500)
            result["rings"]["rejected"] = rings()
            screenshot("01-rejected-receipt-zh-Hant.png")

            # 2. Hover holds the deadline and greys the ring.
            status.hover()
            hovered_at = time.monotonic()
            page.wait_for_timeout(HOLD_SECONDS * 1000)
            held = rings()
            require(held and held[0]["paused"] == "true" and held[0]["play"] == "paused",
                    f"hover did not hold the ring: {held}")
            require(status.count() == 1, "receipt vanished under the pointer")
            result["rings"]["hovered"] = held
            screenshot("02-hover-holds-zh-Hant.png")

            # 3. Leaving resumes the remaining time; the receipt fades out.
            page.mouse.move(230, 420)
            resumed = time.monotonic()
            before_hover = hovered_at - started
            status.wait_for(state="detached", timeout=12_000)
            after_resume = time.monotonic() - resumed
            expected = 8.0 - before_hover + EXIT_SECONDS
            result["timings"]["rejected"] = {
                "beforeHoverSeconds": round(before_hover, 3),
                "heldSeconds": round(resumed - hovered_at, 3),
                "afterResumeSeconds": round(after_resume, 3),
                "expectedAfterResumeSeconds": round(expected, 3),
            }
            require(abs(after_resume - expected) <= 0.6,
                    f"remaining time was not preserved across the hover: {result['timings']['rejected']}")
            require(not rings(), "countdown ring remained after the receipt cleared")

            # 4. A second rejection fades out with the turn change.
            end_turn.click()
            wait_status("rejected")
            page.mouse.move(230, 420)
            page.wait_for_timeout(600)
            require(len(rings()) == 1, "second rejection did not restore the ring")
            screenshot("03-before-turn-change-zh-Hant.png")
            snapshot = copy.deepcopy(scenario.snapshot)
            snapshot["revision"] += 1
            snapshot["view"]["windowId"] += 1
            snapshot["view"]["turn"].update(playerId="p2", seat=1)
            switched = time.monotonic()
            scenario.send(snapshot)
            page.wait_for_function("document.querySelector('[data-board-seat=\"p2\"][data-turn=\"true\"]')")
            status.wait_for(state="detached", timeout=2_000)
            result["timings"]["turnSwitchSeconds"] = round(time.monotonic() - switched, 3)
            require(result["timings"]["turnSwitchSeconds"] <= TURN_SWITCH_SECONDS,
                    f"turn change did not clear feedback promptly: {result['timings']['turnSwitchSeconds']}")
            screenshot("04-after-turn-change-zh-Hant.png")

            # 5. A transport failure: network toast (6 s ring) + unknown receipt (no ring, stays).
            snapshot = copy.deepcopy(scenario.snapshot)
            snapshot["revision"] += 1
            snapshot["view"]["windowId"] += 1
            snapshot["view"]["turn"].update(playerId="p1", seat=0)
            scenario.send(snapshot)
            page.wait_for_function("document.querySelector('[data-board-seat=\"p1\"][data-turn=\"true\"]')")
            outcome["mode"] = "network"
            end_turn.click()
            wait_status("unknown")
            toast.wait_for()
            toast_started = time.monotonic()
            page.mouse.move(230, 420)
            require(toast.get_attribute("data-tone") == "error", "network toast is not marked as an error")
            toast_box = toast.bounding_box()
            require(abs(toast_box["x"] + toast_box["width"] / 2 - 683) < 4 and toast_box["y"] < 120,
                    f"table toast is not top-centre: {toast_box}")
            network = rings()
            require([item["owner"] for item in network] == ["toast"]
                    and abs(network[0]["durationMs"] - 6000) < 1,
                    f"expected only the six-second toast ring: {network}")
            require(page.get_by_test_id("command-resolve").is_visible(), "unknown receipt lost its resolve action")
            page.wait_for_timeout(1500)
            result["rings"]["network"] = rings()
            screenshot("05-network-toast-and-unknown-zh-Hant.png")
            toast.wait_for(state="detached", timeout=9_000)
            result["timings"]["toastSeconds"] = round(time.monotonic() - toast_started, 3)
            require(TOAST_SECONDS[0] <= result["timings"]["toastSeconds"] <= TOAST_SECONDS[1],
                    f"toast dismissal outside window: {result['timings']['toastSeconds']}")
            page.wait_for_timeout(2500)
            require(status.get_attribute("data-status") == "unknown", "unknown receipt did not stay")
            screenshot("06-unknown-stays-zh-Hant.png")

            result["state"] = {
                "toastCount": toast.count(),
                "receiptStatus": status.get_attribute("data-status"),
                "rings": len(rings()),
            }
            require(result["state"] == {"toastCount": 0, "receiptStatus": "unknown", "rings": 0},
                    f"unexpected final state: {result['state']}")
            require([item["mode"] for item in requests] == ["reject", "reject", "network"],
                    f"unexpected command requests: {requests}")
            require(not scenario.errors, f"page errors: {scenario.errors}")
            result["consoleErrors"] = scenario.console_errors
            result["apiRequests"] = requests
            scenario.close()
            scenario = None
            browser.close()
        return result
    finally:
        if scenario:
            try:
                scenario.close()
            except Exception:
                # Playwright may already have stopped after a failed assertion;
                # keep the original failure rather than masking it here.
                pass
        if server[0]:
            board.stop_server(*server)
        (out / "report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="test-results/notice-dismiss")
    args = parser.parse_args()
    out = board.output_path(args.out)
    result = capture(out)
    print(json.dumps({"out": str(out), **result}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
