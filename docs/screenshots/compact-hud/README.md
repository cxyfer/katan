# Compact landscape HUD and save state

Review captures for the floating HUD on short landscape phones (#89) and for the
save state that stays visible in that layout (#90). They were rendered from
commit `a200840` on 2026-11-04.

Captured from the production build (`pnpm build`) in headless Chromium with
device scale factor 1 and reduced motion. The script starts a disposable
service and serves the deterministic four-seat `hex-r2` fixture (the table API
and WebSocket are answered from the fixture, as in `scripts/notice-dismiss`).
Phones are emulated with touch so the `(pointer: coarse)` part of the
compact-landscape query matches. The save pass holds the save request and then
answers with a failed receipt.

| File | Locale | Viewport | State |
|---|---|---|---|
| `01-desktop-reference-1366x768-en.png` | en | 1366×768 | Regular layout for reference; header and tool band unchanged |
| `02-floating-hud-844x390-en.png` | en | 844×390 | Header as a floating control cluster top right, tool band bottom left, board full height |
| `03-action-rail-open-844x390-en.png` | en | 844×390 | Action rail open above the HUD |
| `04-target-picker-above-hud-844x390-en.png` | en | 844×390 | Target list open while the robber must move; picker sits above the HUD |
| `05-save-pending-844x390-en.png` | en | 844×390 | Save request held: "Save pending…" in the status strip, menu closed |
| `06-save-failed-844x390-en.png` | en | 844×390 | Failed receipt: "Save failed" stays in the status strip, menu closed |
| `07-floating-hud-740x360-zh-Hant.png` | zh-Hant | 740×360 | Compact landscape HUD in Traditional Chinese |
| `08-save-failed-740x360-zh-Hant.png` | zh-Hant | 740×360 | Failed receipt visible with the menu closed |
| `09-save-failed-menu-open-740x360-zh-Hant.png` | zh-Hant | 740×360 | Table menu open, failed save reported inside it |
| `10-floating-hud-568x320-en.png` | en | 568×320 | The shortest supported landscape size |
| `11-save-failed-568x320-en.png` | en | 568×320 | Failed receipt at the shortest size |

The script asserts the compact layout is active, the status strip is absolutely
positioned, the board takes the full viewport height, the page does not scroll,
the table menu stays inside the viewport, the target picker is above the HUD,
and the save state is visible while the menu is closed.

## Reproduce

```sh
pnpm build
python3 scripts/compact-hud/capture.py --out test-results/compact-hud
```

The output directory must be new and empty. Copy the PNGs from there into this
one.
