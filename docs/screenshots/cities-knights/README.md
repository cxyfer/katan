# Cities & Knights captures (core rules)

Review captures for phase P2, taken by `scripts/cities-knights/capture.py`
against the production build (`pnpm build`, service on `127.0.0.1`, headless
Chromium 145 with software WebGL, zh-Hant, reduced motion). Every state comes
from a real game through the real UI and API, plus the test-only fixtures
listed below. The full run had 14 cases and no page errors (`report.json`
lists all of them with their sha256).

The `ck-*` profiles are implemented but disabled until progress-card effects
land (P3), so the lobby does not offer them (case `lobby-no-cities-knights`
asserts this). The harness takes a test-only path: it creates a base room over
the API, readies every seat, stops the service, rewrites the room's
`profile_id` in its private SQLite file and starts the service again. The game
then starts normally.

| File | Renderer | Viewport | State |
|---|---|---|---|
| `live-knight-recruit-svg.png` | SVG | 1366×900 | recruit a knight: free intersections on own routes, knight preview |
| `live-wall-target-svg.png` | SVG | 1366×900 | city wall: own cities without a wall |
| `live-panel-svg.png` | SVG | 1366×900 | C&K panel: barbarian track, event roll, improvement chart, progress hand (shown, not playable) |
| `live-knight-move-targets-svg.png` | SVG | 1366×900 | move a knight, second step: reachable intersections |
| `live-board-3d.png` | 3D | 1366×900 | knight, wall and city in the diorama |
| `live-board-svg-phone.png` | SVG | 390×844 | phone table with the C&K status badge |
| `live-board-r3f-phone.png` | 3D | 390×844 | the same in 3D |
| `live-panel-phone.png` | – | 390×844 | phone: C&K panel |
| `live-pillage-prompt-svg.png` | SVG | 1366×900 | barbarians won: the weakest defender picks the city to pillage |
| `live-attack-svg.png` | SVG | 1366×900 | attack result, 5 vs 1 (barbarians) |
| `live-after-attack-3d.png` | 3D | 1366×900 | after the first attack: the robber is on the desert |
| `map-6p-svg-desktop.png` | SVG | 1366×900 | `ck-paired-2025` board during setup |
| `map-6p-r3f-desktop.png` | 3D | 1366×900 | the same in 3D |

Test-only fixtures, each written into the persisted snapshot while the
service is stopped: player 1 gets a city, cards and two progress cards after
setup; when no road reaches a free intersection beside the knight, a road is
laid next to it; the barbarian ship is moved one space before the attack and
player 2 is given a second city, so the pillage choice is a real prompt. The
recruit, activation, wall, improvement, knight move and pillage choice go
through the UI; other seats are played over the API by a simple bot.

The base boards are unchanged: `scripts/expansion-platform/capture.py
--cases base --compare docs/screenshots/expansion-platform` reports the four
in-game base captures byte-identical to the P0 references
(`docs/aegis/work/2026-11-02-cities-knights-core/base-compare-report.json`).

Captures are review evidence, not accepted visual baselines; no physical
device, screen reader or human playtest is claimed.
