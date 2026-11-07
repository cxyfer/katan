# Compact landscape HUD and save state

Review captures for the floating HUD on short landscape phones (#89) and for the
save state that stays visible in that layout (#90). They were rendered from
commit `11010a8` on 2026-11-07, after saving moved from the table menu into the
leave dialog and the save state in this layout became a pill with its own
backdrop, like the connection state, so it reads over the board.

Captured from the production build (`pnpm build`) in headless Chromium with
device scale factor 1 and reduced motion. The script starts a disposable
service and serves the deterministic four-seat `hex-r2` fixture (the table API
and WebSocket are answered from the fixture, as in `scripts/notice-dismiss`).
Phones are emulated with touch so the `(pointer: coarse)` part of the
compact-landscape query matches. The save pass holds the save request and then
answers with a failed receipt. The save starts from the leave dialog, which
stays open (and cannot be closed) while the request is held. The fixture does
not load the room, so the dialog only offers Save and leave; at these heights
its contents scroll inside the dialog box.

| File | Locale | Viewport | State |
|---|---|---|---|
| `01-desktop-reference-1366x768-en.png` | en | 1366×768 | Regular layout for reference; header and tool band unchanged |
| `02-floating-hud-844x390-en.png` | en | 844×390 | Header as a floating control cluster top right, tool band bottom left, board full height |
| `03-action-rail-open-844x390-en.png` | en | 844×390 | Action rail open above the HUD |
| `04-target-picker-above-hud-844x390-en.png` | en | 844×390 | Target list open while the robber must move; picker sits above the HUD |
| `05-save-pending-844x390-en.png` | en | 844×390 | Save request held from the leave dialog: "Save pending…" on its button and the working note |
| `06-save-failed-844x390-en.png` | en | 844×390 | Failed receipt after closing the dialog: "Save failed" stays in the status strip as a red pill on a dark backdrop |
| `07-floating-hud-740x360-zh-Hant.png` | zh-Hant | 740×360 | Compact landscape HUD in Traditional Chinese |
| `08-save-failed-dialog-open-740x360-zh-Hant.png` | zh-Hant | 740×360 | Leave dialog still open, failed save reported inside it |
| `09-save-failed-740x360-zh-Hant.png` | zh-Hant | 740×360 | Failed receipt visible after the dialog is closed |
| `10-floating-hud-568x320-en.png` | en | 568×320 | The shortest supported landscape size |
| `11-save-failed-568x320-en.png` | en | 568×320 | Failed receipt at the shortest size |

The script asserts the compact layout is active, the status strip is absolutely
positioned, the board takes the full viewport height, the page does not scroll,
the leave button stays inside the viewport, the target picker is above the HUD,
the save state is visible while the save is pending, and "Save failed" stays
visible in the status strip after the dialog is closed, at a font size of at
least 10px on a backdrop that is not transparent.

## Reproduce

```sh
pnpm build
python3 scripts/compact-hud/capture.py --out test-results/compact-hud
```

The output directory must be new and empty. Copy the PNGs from there into this
one.
