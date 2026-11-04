# Board build drops and roll hold

Key frames of the build-drop animation and of the board during the dice
presentation. They were taken from the production build at `a200840` on
2026-11-04, with a temporary service and the deterministic four-seat `hex-r2`
fixture. The API and WebSocket are mocked with that fixture, the page clock is
paused, and CSS animations are frozen at the listed time, so each frame is
sampled at a fixed point regardless of GPU speed.

The drop frames remove and restore the piece nearest the board centre with
snapshot events. The board is zoomed in and the PNGs are 480×400 crops around
the landing point, not full-table captures. Both the SVG board and the 3D (r3f)
board are shown. The roll frames keep the table between the top bar and the hand
dock, so each PNG is a 1366×660 crop.

| File | Locale | Viewport | State |
|---|---|---|---|
| `svg-settlement-drop-t120ms-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | SVG, settlement 120 ms in: red-roofed piece in the air above the wheat/forest/sheep intersection, faint shadow below |
| `svg-settlement-drop-t280ms-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | SVG, settlement 280 ms in: near the ground, larger and darker shadow on the forest hex |
| `svg-settlement-drop-t340ms-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | SVG, settlement 340 ms in: landing squash, shadow tight under the base |
| `svg-settlement-settled-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | SVG, the same settlement at rest on the intersection |
| `svg-road-drop-t100ms-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | SVG, road 100 ms in: red road tilted in the air above its edge, shadow on the wheat hex |
| `svg-road-drop-t300ms-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | SVG, road 300 ms in: the road meets the edge between the wheat and forest hexes |
| `r3f-settlement-drop-t120ms-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | 3D, settlement 120 ms in: the red-roofed piece is lifted high above its intersection |
| `r3f-settlement-drop-t340ms-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | 3D, settlement 340 ms in: the piece has landed on the forest-edge intersection |
| `r3f-road-drop-t100ms-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | 3D, road 100 ms in: red road floating above the wheat field |
| `r3f-road-drop-t300ms-1366x768-zh-Hant.png` | zh-Hant | 1366×768 | 3D, road 300 ms in: the road is on its edge beside the forest |
| `svg-roll-hold-rolling-1366x768-en.png` | en | 1366×768 | SVG, dice overlay Rolling…: pre-roll board with the walled city and wall intact and no robber on the desert |
| `svg-roll-hold-released-1366x768-en.png` | en | 1366×768 | SVG, presentation over: Your turn / End turn; the barbarian result has reduced both cities to settlements, removed the wall, and placed the robber on the desert |
| `r3f-roll-hold-rolling-1366x768-en.png` | en | 1366×768 | 3D, dice overlay Rolling…: the same pre-roll position, robber absent |
| `r3f-roll-hold-released-1366x768-en.png` | en | 1366×768 | 3D, Your turn / End turn with the robber now on the desert and the cities downgraded |

## Note on the Cities & Knights data

The #91 roll state is a hand-built Cities & Knights projection laid over the
`hex-r2` fixture, not a game played by the rules engine. The pre-roll and
post-attack pieces, walls, knight and barbarian values are supplied by the
capture script; the frames only demonstrate that the board does not change while
the dice presentation runs.

## Reproduce

After `pnpm build` (the output directory must be new and empty):

```sh
python3 scripts/board-motion/capture.py --out test-results/board-motion
```

The script asserts the drop vertex and edge, the clip positions, and the
pre-roll/post-roll Cities & Knights values. It records the effective renderer
and any skipped 3D pass in `report.json`; if headless Chromium cannot create a
WebGL context, the r3f frames are skipped there.

## Limitations

The 3D frames are headless-Chromium WebGL output (SwiftShader where needed), so
they show shapes and shadows, not GPU frame time. The crops omit the surrounding
table on purpose, and the Cities & Knights state is a fixture projection rather
than an engine-played game.
