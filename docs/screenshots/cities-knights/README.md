# Cities & Knights captures (core rules and progress cards)

Review captures for phase P2, taken by `scripts/cities-knights/capture.py`
against the production build (`pnpm build`, service on `127.0.0.1`, headless
Chromium 145 with software WebGL, zh-Hant, reduced motion). Every state comes
from a real game through the real UI and API, plus the test-only fixtures
listed below. The full run had 14 cases and no page errors (`report.json`
lists all of them with their sha256).

The core captures (`live-*`, `map-*`) were taken in P2, when the `ck-*`
profiles were still disabled; `capture.py` has since been moved to the lobby
path (it creates the room through the lobby and asserts the lobby offers both
profiles). The progress-card captures (`progress-*`, below) come from
`progress.py` and always use the lobby.

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

## Progress cards and the merchant (P3)

Taken by `scripts/cities-knights/progress.py` against `pnpm build`
(service `127.0.0.1:3032`, headless Chromium with software WebGL, zh-Hant,
reduced motion). The complete run had 50 cases and no errors, and its
assertion that all 23 playable card types were played through the UI passed;
after a stylesheet fix to the responder prompts the trade and politics stages
were re-run (17 cases, no errors) and their captures replace the earlier
ones. `report-progress.json` lists the curated captures with their sha256;
the other 28 files of the run (SVG/3D × desktop/phone for every board-target
card) are reproducible with the script and not committed.

| File | Renderer | Viewport | State |
|---|---|---|---|
| `progress-hand-preroll-svg.png` | SVG | 1366×900 | hand before the roll: Alchemy playable, the others say "after the roll" |
| `progress-alchemy-dice-svg.png` | SVG | 1366×900 | Alchemy: the two production dice chosen before the roll |
| `progress-crane-choice-svg.png` | SVG | 1366×900 | Crane: pick the improvement track |
| `progress-invention-choice-svg.png` | SVG | 1366×900 | Invention: two number discs to swap |
| `progress-hand-trade-svg.png` | SVG | 1366×900 | trade hand with the 2:1 and merchant status |
| `progress-harbor-offers-svg.png` | SVG | 1366×900 | Commercial Harbor: one offer per player |
| `progress-harbor-answer-svg.png` | SVG | 1366×900 | the offered player picks the commodity to give back |
| `progress-guild-dues-pick-svg.png` | SVG | 1366×900 | Guild Dues: the richer player's hand is shown to the taker, who takes 2 cards |
| `progress-espionage-peek-svg.png` | SVG | 1366×900 | Espionage: only the spy sees the target's progress cards |
| `progress-sabotage-prompt-svg.png` | SVG | 1366×900 | Sabotage: an affected player chooses the discard |
| `progress-wedding-prompt-svg.png` | SVG | 1366×900 | Wedding: a richer player chooses the cards to give |
| `progress-victory-cards-svg.png` | SVG | 1366×900 | Printing and Constitution are revealed when drawn and score at once |
| `progress-merchant-target-svg-desktop.png` | SVG | 1366×900 | Merchant: legal hexes |
| `progress-merchant-placed-svg-desktop.png` | SVG | 1366×900 | the merchant on its hex in the owner's colour |
| `progress-merchant-placed-r3f-desktop.png` | 3D | 1366×900 | the merchant figure in the diorama |
| `progress-treason-remove-svg-desktop.png` | SVG | 1366×900 | Treason: the chosen player removes one of their knights |
| `progress-diplomacy-rebuild-svg-desktop.png` | SVG | 1366×900 | Diplomacy: the removed own road may be rebuilt for free |
| `progress-diplomacy-rebuild-r3f-desktop.png` | 3D | 1366×900 | the same in 3D |
| `progress-hand-board-svg-phone.png` | SVG | 390×844 | phone: the hand sheet with board-target cards |
| `progress-merchant-placed-svg-phone.png` | SVG | 390×844 | phone: the merchant |
| `progress-merchant-placed-r3f-phone.png` | 3D | 390×844 | phone: the merchant in 3D |
| `progress-engineering-target-r3f-phone.png` | 3D | 390×844 | phone: Engineering, free wall sites |

All 23 playable card types are played through the UI (hand button, board
target or form, prompt answers) in the SVG renderer on desktop. The renderer
only changes how a board target is chosen, so the seven board-target cards
(Merchant, Taxation, Engineering, Medicine, Treason, Intrigue, Diplomacy) are
also played in the 3D renderer on desktop, and Merchant, Engineering, Treason
and Diplomacy in both renderers on a 390×844 phone. The cards without a board
target use the same hand panel in every renderer and are not repeated in 3D or
on the phone. The other seats are played over the API by a simple bot, and the
cards are put into hands by test-only fixtures written into the persisted
snapshot while the service is stopped (`standard_fixture` in `progress.py`).
Responder prompts are captured from the responder's own page.

Captures are review evidence, not accepted visual baselines; no physical
device, screen reader or human playtest is claimed.
