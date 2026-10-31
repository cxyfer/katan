#!/usr/bin/env python3
"""Capture and time the transient-notice auto-dismissal on the production build.

The harness serves `packages/web/dist` with a real service and the deterministic
four-seat `hex-r2` fixture, but routes the next two `turn.end` commands to a
definite rejection. That renders both a toast and a rejected command receipt,
which lets the run measure their independent deadlines and the turn-change
dismissal.

Run after `pnpm build`:

    python3 scripts/notice-dismiss/capture.py --out test-results/notice-dismiss

The output directory must be new and empty. Copy the five screenshots into
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
TOAST_SECONDS = (5.5, 7.0)
RECEIPT_SECONDS = (7.5, 9.5)
TURN_SWITCH_SECONDS = 1.0


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def capture(out: Path) -> dict:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    source = next(item for item in fixture["boards"] if item["id"] == BOARD_ID)
    result: dict = {"screenshots": [], "timings": {}, "fixture": str(FIXTURE.relative_to(ROOT))}
    server = (None, None, None)
    scenario = None

    def screenshot(name: str) -> None:
        scenario.page.screenshot(path=str(out / name), animations="disabled")
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

            def reject(route):
                request = route.request.post_data_json
                requests.append(request)
                route.fulfill(status=200, json={"ok": True, "data": {
                    "commandId": request["commandId"],
                    "outcome": "rejected",
                    "revision": scenario.snapshot["revision"],
                    "error": {"messageId": "error.E_NOT_YOUR_TURN"},
                    "events": [],
                }})

            page.route("**/api/games/g1/commands", reject)
            page.get_by_test_id("action-rail-toggle").focus()
            page.wait_for_function(
                "document.querySelector('[data-testid=\"action-rail\"]')?.dataset.expanded === 'true'")
            end_turn = page.get_by_test_id("action-endTurn")
            end_turn.scroll_into_view_if_needed()
            end_turn.click()

            status = page.get_by_test_id("command-status")
            page.wait_for_function(
                "document.querySelector('[data-testid=\"command-status\"]')?.dataset.status === 'rejected'")
            page.get_by_test_id("toast").wait_for()
            started = time.monotonic()
            screenshot("01-rejected-and-toast-zh-Hant.png")

            page.get_by_test_id("toast").wait_for(state="detached", timeout=8_000)
            result["timings"]["toastSeconds"] = round(time.monotonic() - started, 3)
            require(TOAST_SECONDS[0] <= result["timings"]["toastSeconds"] <= TOAST_SECONDS[1],
                    f"toast dismissal outside window: {result['timings']['toastSeconds']}")
            screenshot("02-toast-gone-zh-Hant.png")

            status.wait_for(state="detached", timeout=10_000)
            result["timings"]["receiptSeconds"] = round(time.monotonic() - started, 3)
            require(RECEIPT_SECONDS[0] <= result["timings"]["receiptSeconds"] <= RECEIPT_SECONDS[1],
                    f"receipt dismissal outside window: {result['timings']['receiptSeconds']}")
            screenshot("03-both-gone-zh-Hant.png")

            # A second rejection remains visible until the turn itself changes.
            end_turn.click()
            page.wait_for_function(
                "document.querySelector('[data-testid=\"command-status\"]')?.dataset.status === 'rejected'")
            page.get_by_test_id("toast").wait_for()
            screenshot("04-before-turn-change-zh-Hant.png")

            snapshot = copy.deepcopy(scenario.snapshot)
            snapshot["revision"] += 1
            snapshot["view"]["turn"].update(playerId="p2", seat=1)
            switched = time.monotonic()
            scenario.send(snapshot)
            page.wait_for_function("document.querySelector('[data-board-seat=\"p2\"][data-turn=\"true\"]')")
            page.get_by_test_id("toast").wait_for(state="detached", timeout=2_000)
            status.wait_for(state="detached", timeout=2_000)
            result["timings"]["turnSwitchSeconds"] = round(time.monotonic() - switched, 3)
            require(result["timings"]["turnSwitchSeconds"] <= TURN_SWITCH_SECONDS,
                    f"turn change did not clear feedback promptly: {result['timings']['turnSwitchSeconds']}")
            screenshot("05-after-turn-change-zh-Hant.png")

            result["state"] = {
                "toastCount": page.get_by_test_id("toast").count(),
                "receiptCount": page.get_by_test_id("command-status").count(),
                "turnSeat": page.locator('[data-board-seat][data-turn="true"]').first.get_attribute("data-board-seat"),
            }
            require(result["state"] == {"toastCount": 0, "receiptCount": 0, "turnSeat": "p2"},
                    f"unexpected final state: {result['state']}")
            require(len(requests) == 2, f"expected two rejected commands, got {len(requests)}")
            require(not scenario.errors, f"page errors: {scenario.errors}")
            require(not scenario.console_errors, f"console errors: {scenario.console_errors}")
            result["apiRequests"] = requests
            browser.close()
            scenario = None
        return result
    finally:
        if scenario:
            scenario.close()
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
