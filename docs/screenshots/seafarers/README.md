# Seafarers captures (Heading for New Shores)

Review captures for phase P1, taken by `scripts/seafarers/capture.py` against
the production build (`pnpm build`, service on `127.0.0.1:3022`, headless
Chromium 145 with software WebGL, zh-Hant, reduced motion). Every state comes
from a real game through the real UI and API; nothing is mocked. The full run
had 35 cases and no page errors (`report.json` lists all of them with their
sha256; this folder keeps a curated subset).

| File | Renderer | Viewport | State |
|---|---|---|---|
| `lobby-seafarers.png` | – | 1366×900 | lobby: Seafarers → Heading for New Shores, ruleset and required boxes |
| `map-3p-svg-desktop.png` | SVG | 1366×900 | 3-player map (SF25 p. 4) during setup; pirate waiting on the frame |
| `map-3p-r3f-desktop.png` | 3D | 1366×900 | the same in 3D |
| `map-4p-svg-desktop.png` | SVG | 1366×900 | 4-player map (SF25 p. 5); setup targets only on the main island |
| `map-4p-r3f-desktop.png` | 3D | 1366×900 | the same in 3D |
| `map-4p-r3f-phone.png` | 3D | 390×844 | phone fit of the 4-player map |
| `map-5p-svg-desktop.png` | SVG | 1366×900 | 5-player game on the SF56-25 map |
| `map-5p-r3f-desktop.png` | 3D | 1366×900 | the same in 3D |
| `map-6p-svg-desktop.png` | SVG | 1366×900 | 5–6 map (SF56-25 p. 4): random main island and ports, fixed small islands |
| `map-6p-r3f-desktop.png` | 3D | 1366×900 | the same in 3D |
| `map-6p-svg-phone.png` | SVG | 390×844 | phone fit of the 5–6 map |
| `live-setup-ship-choice-svg.png` | SVG | 1366×900 | coastal starting settlement: "place a ship instead" switch |
| `live-ship-build-targets-svg.png` | SVG | 1366×900 | build ship: legal sea paths offered |
| `live-ship-move-targets-svg.png` | SVG | 1366×900 | move ship after picking the open ship |
| `live-island-bonus-3d.png` | 3D | 1366×900 | ships, the settlement on the gold island and its +2 tokens |
| `live-pirate-choice-svg.png` | SVG | 1366×900 | 7 rolled: land targets for the robber, sea targets for the pirate |
| `live-pirate-moved-3d.png` | 3D | 1366×900 | the pirate galleon on the sea hex beside the ships |
| `live-gold-chosen-svg.png` | SVG | 1366×900 | gold picker with one ore selected; confirm button fully visible |
| `live-after-gold-svg.png` | SVG | 1366×900 | after the gold choice; seat panel with the island bonus |
| `live-road-building-road-ship-svg.png` | SVG | 1366×900 | Road Building played as one road and one ship |
| `live-road-building-two-ships-svg.png` | SVG | 1366×900 | Road Building played as two ships |
| `live-knight-pirate-choice-svg.png` | SVG | 1366×900 | Knight before the roll: robber or pirate, with the move-to-frame button |

The three development cards for the last cases are a test-only fixture
written into player 1's persisted hand while the harness has the service
stopped; the plays themselves go through the UI.

The base boards are unchanged: `scripts/expansion-platform/capture.py
--cases base --compare docs/screenshots/expansion-platform` reports the four
in-game base captures byte-identical to the P0 references
(`docs/aegis/work/2026-11-01-seafarers/base-compare-report.json`).

Captures are review evidence, not accepted visual baselines; no physical
device, screen reader or human playtest is claimed.
