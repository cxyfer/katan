# Explorers & Pirates captures

Review captures for phase P6, taken by `scripts/explorers-pirates/capture.py`.
The harness ran against the production build (`pnpm build`, service on
`127.0.0.1:3064`) in headless Chromium 145 with software WebGL and reduced
motion. Player 1 used zh-Hant; the other seats used English.

Each mission was played to its result by real players in the browser:

- The fixture bot (`epBotStep`, served by `scripts/explorers-pirates/bot.mjs`) picks every move.
- Other seats send their moves through the HTTP API.
- Player 1 makes each command type through the UI: in one renderer, and reaches it in the other.
- Nothing is mocked.

The full run had 32 cases and no page errors. `report.json` lists all of them with their sha256, plus per-mission command counts and UI coverage. This folder keeps a curated subset.

| Mission | Players | Steps | Winner | Player 1 via API only |
|---|---|---|---|---|
| Land Ho! (`ep-land-ho-2025`) | 4 | 309 | 8 VP | – |
| Pirate Lairs (`ep-pirate-lairs-2025`) | 3 | 697 | 12 VP | – |
| Fish for Catan (`ep-fish-2025`) | 3 | 925 | 15 VP | – |
| Spices for Catan (`ep-spices-2025`) | 4 | 1139 | 15 VP | – |
| Explorers & Pirates (`ep-full-2025`) | 3 | 727 | 17 VP | – |

Across the five missions, 33 command types came up:

- the 27 `ep.*` commands;
- `turn.roll`, `turn.end`, `build.road` and `build.settlement`;
- `trade.bank`, through the exchange panel at 3:1;
- `pending.discard`.

Every one ran through the UI in SVG and was reached in 3D, and 25 also ran in 3D. The fixture bot never picks three moves: `ep.sellForGold`, `ep.unload` and `ep.swap`. The harness makes them through the prompt the first time each is offered.

| File | Renderer | Viewport | State |
|---|---|---|---|
| `land-ho-lobby.png` | – | 1366×900 | lobby on the room page, all four seats ready, before the start (re-captured from `369b7fe`, 2026-11-08): Explorers & Pirates → Land Ho!, no bot seated; bot note 「電腦對手尚未支援這個規則組合。」 |
| `land-ho-start-svg.png` | SVG | 1366×900 | Land Ho! printed start: the starting island, harbour settlements and ships; parrot and goose fog |
| `land-ho-start-r3f.png` | 3D | 1366×900 | the same in 3D: fog banks with region markers, ships and harbour flags |
| `land-ho-movement-svg.png` | SVG | 1366×900 | Movement phase prompt: per-ship sail, found and extra-move buttons |
| `land-ho-final-svg.png` | SVG | 1366×900 | result: explored islands and the remaining fog on the final board |
| `pirate-lairs-start-svg.png` | SVG | 1366×900 | Pirate Lairs, variable setup: marked harbour intersections on the starting island |
| `pirate-lairs-start-r3f.png` | 3D | 1366×900 | the same in 3D |
| `fish-start-svg.png` | SVG | 1366×900 | Fish for Catan map with the Council of Catan and fog |
| `fish-start-svg-phone.png` | SVG | 390×844 | phone layout of the same |
| `fish-start-r3f-phone.png` | 3D | 390×844 | phone layout in 3D |
| `spices-start-svg.png` | SVG | 1366×900 | Spices for Catan map |
| `explorers-pirates-start-svg.png` | SVG | 1366×900 | full Explorers & Pirates map (EP25), variable setup |
| `explorers-pirates-start-r3f.png` | 3D | 1366×900 | the same in 3D |
| `explorers-pirates-movement-svg.png` | SVG | 1366×900 | Movement phase with cargo actions (unload settler, swap with the harbour) and a player's pirate ship with its owner flag |
| `explorers-pirates-final-r3f.png` | 3D | 1366×900 | result of the full mission: 17 VP |

The result screen keeps the shared statistics table, whose columns are cities, longest road and knights. The E&P score breakdown is in the players panel during play.
