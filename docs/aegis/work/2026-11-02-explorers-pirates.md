# Explorers & Pirates (P6)

Advisory work record for phase P6 of
[the expansions roadmap](../plans/2026-11-01-expansions-roadmap.md). Branch
`feat/explorers-pirates`, stacked on `feat/seafarers` @ `29acbfc` (PR #63).
Explorers & Pirates (E&P) reuses the Seafarers sea rendering only; its rules
are separate and the two expansions are never combined.

## Sources (accessed 2026-11-02)

| Id | Edition | Publication | File | SHA-256 | Pages used |
|---|---|---|---|---|---|
| EP25 | CATAN – Explorers & Pirates, 2025 rulebook (`v6.251001`, PDF created 2025-03-11) | CN3085 | [`CN3085 CATAN – E&P Rulebook.pdf`](https://www.catan.com/sites/default/files/2025-04/CN3085%20CATAN%20%E2%80%93%20E%26P%20Rulebook.pdf) (16 pp.) | `3b337981de81a45d1052e0459909c693156f47152b46761438659653bc308dba` | 2–5 (components), 6–7 (full-game map and setup), 8–12 (turn, production, 7, trade, build, movement, tribute, chase, load, explore, settler), 13–15 (missions: pirate lairs, fish, spices; victory) |
| EP25-M | CATAN – Explorers & Pirates, 2025 Mission Guide (`v6.251001`) | CN3085 | [`CN3085 CATAN – E&P Missions.pdf`](https://www.catan.com/sites/default/files/2025-04/CN3085%20CATAN%20%E2%80%93%20E%26P%20Missions.pdf) (20 pp.) | `6414208f21fd75b5f43b1b23b32959a343e09174b71163aa416e38e52a52f746` | 2 (scenario list, CATAN components kept/returned), 3 (common setup, turn overview), 4–7 Land Ho!, 8–13 Pirate Lairs, 14–15 Fish for Catan, 16–18 Spices for Catan |

Both files were downloaded twice into fresh directories outside the
repository (hashes identical), rendered with PyMuPDF 1.24.14 and read as
images; text was extracted for search only. No code from the downloads was
executed. A 2020 English rulebook of the previous edition was consulted only
to understand intent where CN3085 is silent; it is not a rule source and
every place it was used is marked "interpretation" below.

Out of scope and deferred (roadmap): CN3086 5–6 player rules, the C&K and
T&B combination PDFs, and the 2-player variants printed in EP25/EP25-M.

## Scenario list and victory (EP25-M p. 2; EP25 p. 15)

| # | Mission set | Profile | Pages | Target | Adds |
|---|---|---|---|---|---|
| 1 | Land Ho! | `ep-land-ho-2025` | EP25-M pp. 4–7 | 8 VP | harbour settlements, ships with cargo, settlers, exploration, gold |
| 2 | Pirate Lairs | `ep-pirate-lairs-2025` | EP25-M pp. 8–13 | 12 VP | crews, pirate ships, tribute, chase, gold fields, pirate lairs mission |
| 3 | Fish for Catan | `ep-fish-2025` | EP25-M pp. 14–15 | 15 VP | Council of Catan, fish shoals, fish hauls, fish mission |
| 4 | Spices for Catan | `ep-spices-2025` | EP25-M pp. 16–18 | 15 VP | spice farms, spice sacks, spice abilities, spice mission (no gold fields) |
| 5 | Explorers & Pirates | `ep-full-2025` | EP25 pp. 6–15 | 17 VP | all three missions together |

Each mission "uses all rules from" the previous one. A player with the target
or more VP at any point during their own turn wins immediately.

## Components (EP25 pp. 2–5; EP25-M p. 2)

- From CATAN: 14 terrain hexes (2 hills, 4 forests, 3 pastures, 2 fields,
  3 mountains), number discs 3, 3, 4, 4, 5, 6, 6, 8, 8, 9, 10, 10, 11, 11, 12,
  95 resource cards (19 each), 15 roads and 5 settlements per colour. The
  development cards, bonus VP tiles (Longest Road, Largest Army), cities,
  robber, desert and the 2, one 5 and one 9 disc are returned. The CATAN frame
  is turned over: no ports.
- Per colour: 4 harbour settlements, 3 ships, 2 settlers, 9 crews, 1 pirate
  ship, mission markers.
- 6 pirate lair tokens, 6 fish hauls, 24 spice sacks, 76 coins (36 of value 3
  and 40 of value 1 = 148 gold), 3 bonus VP tiles (Greatest Pirate Scourge,
  Best Fisher, Greatest Spice Merchant), 1 Council of Catan hex, 23 sea hexes,
  8 sea frame pieces, 3 mission-track frame pieces.
- 17 parrot hexes: 1 hill, 1 forest, 1 pasture, 1 field, 2 mountains, 2 seas,
  3 gold fields, 3 fish shoals (1, 2, 3), 3 spice farms (Swift Voyage, Fast
  Gold, Pirate Bonus 5); parrot discs 3, 4, 5, 6, 9, 10.
- 17 goose hexes: 1 hill, 1 forest, 1 pasture, 2 fields, 1 mountain, 2 seas,
  3 gold fields, 3 fish shoals (4, 5, 6), 3 spice farms (Swift Voyage, Fast
  Gold, Pirate Bonus 4); goose discs 4, 5, 8, 9, 10, 11.
- One sea frame piece carries a printed pasture hex: it is the fixed pasture
  `6` at the west tip of the starting island in every map. This reconciles the
  "14 land" of the hex tables with the 15 starting-island hexes on the maps.

## Rule clauses (paraphrased)

| Clause | Source |
|---|---|
| Turn = Production, Action, Movement; no trading or building in the Movement phase | EP25-M p. 3, EP25 p. 8 |
| Each player starts with 2 gold | EP25-M p. 3 |
| Production: settlement and harbour settlement 1 resource each; a player who receives nothing gets 1 gold | EP25-M p. 5, EP25 p. 8 |
| 7: everyone with more than 7 cards discards half rounded down; Land Ho! has no robber or pirate and no theft | EP25-M p. 5 |
| Trade: domestic trades may include coins; supply 3:1 (3 of a kind → 1 other resource or 1 gold); twice per turn 2 gold → 1 resource | EP25-M p. 5, EP25 p. 9 |
| Roads and settlements only on explored land, never on edges/intersections shared with an unexplored hex | EP25-M p. 5, EP25 p. 9 |
| Harbour settlement (2 grain + 2 ore): replaces an own coastal settlement, 2 VP, at most 4; holds 1 large (settler, fish haul) or 2 small pieces (crews, spice sacks); in Land Ho! 1 settler | EP25-M p. 6, EP25 p. 9 |
| Ship (lumber + wool): on an empty sea edge next to an own harbour settlement, not on an edge of an unexplored hex; with none in supply, return one from the board with its cargo, then build; holds 1 large or 2 small | EP25-M p. 6, EP25 p. 9 |
| Settler (settlement cost) and crew (wool + ore): onto an empty harbour slot or an empty slot of an own ship next to a harbour settlement; if all are full a piece may be returned to make room | EP25-M p. 6, EP25 p. 10 |
| Ships move along continuous sea edges, 4 MP each; 1 wool → that ship 6 MP; up to 2 ships per edge; may pass ships, must end on an edge with at most 1 other ship; finish one ship before the next | EP25-M p. 6, EP25 p. 10 |
| Load/unload harbour ↔ adjacent ship, swap, no MP, mid-move allowed; pieces may move between a ship and an explored hex when one ship end touches the hex | EP25-M p. 6, EP25 p. 11 |
| Explore: a ship next to an intersection of an unexplored hex flips it; this ends that ship's movement. Land: disc from the matching stack; gold field: face-down lair token; spice farm: 1 spice sack per player; fish shoal / sea: nothing. Take 1 matching resource, otherwise 2 gold | EP25-M p. 7, EP25 p. 12 |
| Settler ship next to a land intersection: return ship and settler, place a settlement there; distance rule applies | EP25-M p. 7, EP25 p. 12 |
| Pirate (from Pirate Lairs): the 7-roller places their own pirate ship (none on board), moves it (own on board) or returns an opponent's and places their own; never next to the starting island, on the frame or on the Council; steals 1 random resource from a player with a ship on that hex (choice if several); a victim without resources may lose 1 gold instead; a pirate placed on a shoal with a fish haul removes it | EP25 p. 8, EP25-M pp. 9–10, 15 |
| Tribute: 1 gold per ship, once per turn, for moving onto, off or along edges of a hex holding an opponent's pirate; none for building | EP25 p. 10 |
| Chase: a ship that has not moved and has an end at an intersection of the pirate's hex rolls 1 die; a 6 chases it and activates the roller's pirate ship; the ship may move afterwards | EP25 p. 11 |
| Gold fields: unbuildable until the lair is captured; then 2 gold per building | EP25 pp. 8–9, 13 |
| Pirate lairs: 3 crews (any players) capture a lair, resolved after the active player's movement: clockwise from the active player each involved player +2 gold and +1 track; each rolls 1 die + own crews there; highest is hero (tie: more crews; still tied: those reroll); hero +1 track and returns 1 crew; the token flips to its number | EP25 p. 13, EP25-M pp. 11–12 |
| Fish: once in the Movement phase, before or after moving a ship, roll 1 die; on an explored shoal's number place a fish haul there unless one is there, the pirate is there or the supply is empty; deliver at a Council anchor → +1 fish track | EP25 p. 14, EP25-M p. 15 |
| Spices: unload 1 crew onto a spice farm (stays forever, 1 per player per farm) to load 1 spice sack (1 per player per farm); deliver at a Council anchor → +1 per sack; the crew grants the farm's ability (Swift Voyage +1 MP, both +2; Pirate Bonus chase also on its number, both 4–6; Fast Gold once per Action phase 1 resource → 1 gold, both twice) | EP25 p. 14, EP25-M pp. 17–18 |
| Council of Catan: a sea hex with anchors at its top and bottom intersections; land may touch it; no pirate | EP25 pp. 4, 7, EP25-M p. 17 |
| Mission tracks: moving onto an occupied space stacks on top; VP are the printed values next to the marker; the furthest marker holds the 1-VP bonus tile; on a tie the marker at the bottom keeps it | EP25 p. 13, EP25-M p. 9 |
| Variable setup (from Pirate Lairs): snake order; round 1 a harbour settlement on a marked intersection, round 2 a settlement on the starting island; then, in order, each places a road next to that settlement and a ship with a settler next to the harbour settlement; starting resources: 1 per hex next to the settlement | EP25 p. 7, EP25-M p. 9 |

## Mission tracks (EP25 pp. 4, 13–14)

Space values after the start space: Pirate Lairs 1, 1, 2, 2, 2, 3, 3; Fish
1, 1, 2, 2, 2, 3, 3; Spices 1, 1, 2, 2, 3, 3. VP for a marker = the value of its
space; the bonus tile (1 VP) goes to the furthest marker.

## Map transcription

Rendered maps were fitted with a pointy-top axial lattice (`q` to the east,
`r` downwards, `r = 0` the middle row; `(0, 0)` is the hex east of the `8` at
the east tip of the starting island). Every cell was read from the overlay.

Common starting-island cells and discs (all maps): `(0,-3) 11`, `(1,-3) 9`,
`(-1,-2) 3`, `(0,-2) 8`, `(-2,-1) 4`, `(-1,-1) 10`, `(-3,0) 6` (fixed pasture
on the frame piece), `(-2,0) 12`, `(-1,0) 8`, `(-3,1) 10`, `(-2,1) 4`,
`(-3,2) 11`, `(-2,2) 6`, `(-3,3) 3`, `(-2,3) 5`.

| Map | Seas faceup | Parrot region | Goose region | Council |
|---|---|---|---|---|
| Land Ho! (EP25-M p. 4) | 19: `(2,-3) (3,-3) (1,-2) (2,-2) (0,-1) (1,-1) (3,-1) (0,0)…(4,0) (-1,1) (0,1) (2,1) (-1,2) (0,2) (-1,3) (0,3)` | 8: `(4,-3) (5,-3) (3,-2) (4,-2) (5,-2) (2,-1) (4,-1) (5,-1)` | 8: `(1,1) (3,1) (4,1) (1,2) (2,2) (3,2) (1,3) (2,3)` | — |
| Pirate Lairs (EP25-M p. 8) | 20: `(2,-3) (3,-3) (1,-2) (2,-2) (0,-1) (1,-1) (4,-1) (0,0)…(5,0) (-1,1) (0,1) (3,1) (-1,2) (0,2) (-1,3) (0,3)` | 11: `(4..6,-3) (3..6,-2) (2,-1) (3,-1) (5,-1) (6,-1)` | 11: `(1,1) (2,1) (4,1) (5,1) (1..4,2) (1..3,3)` | — |
| Fish for Catan (EP25-M p. 14) | 19 (Lairs grid, `(0,0)` is the Council) | 11 (Lairs cells) | 11 (Lairs cells) | `(0,0)` — interpretation, see below |
| Spices for Catan (EP25-M p. 16) | 22: `(2,-3) (3,-3) (1,-2) (2,-2) (0,-1) (1,-1) (4,-1) (6,-1) (1,0)…(7,0) (-1,1) (0,1) (3,1) (5,1) (-1,2) (0,2) (-1,3) (0,3)` | 13: `(4..7,-3) (3..7,-2) (2,-1) (3,-1) (5,-1) (7,-1)` | 13: `(1,1) (2,1) (4,1) (6,1) (1..5,2) (1..4,3)` | `(0,0)` |
| Explorers & Pirates (EP25 pp. 6–7) | 23: `(2,-3) (3,-3) (1,-2) (2,-2) (0,-1) (1,-1) (4,-1) (6,-1) (1,0)…(7,0) (-1,1) (0,1) (3,1) (5,1) (-1,2) (0,2) (-1,3) (0,3)` | 16: `(4..8,-3) (3..8,-2) (2,-1) (3,-1) (5,-1) (7,-1) (8,-1)` | 16: `(1,1) (2,1) (4,1) (6,1) (7,1) (1..6,2) (1..5,3)` | `(0,0)` |

The cell at the east end of the middle row (`(5,0)`, `(6,0)`, `(8,0)` / Spices
`(8,0)`) is a hex-shaped frame bump, not a playable hex.

Region contents (hex tables):

| Map | Parrot | Goose |
|---|---|---|
| Land Ho! | 2 sea, hill, forest, pasture, field, 2 mountains | 2 sea, hill, forest, pasture, 2 fields, mountain |
| Pirate Lairs | Land Ho! parrot + 3 gold fields | Land Ho! goose + 3 gold fields |
| Fish for Catan | hill, forest, pasture, field, 2 mountains, 3 gold, 2 of the 3 parrot shoals at random | hill, forest, pasture, 2 fields, mountain, 2 gold, 3 shoals |
| Spices for Catan | sea, hill, forest, pasture, field, 2 mountains, 3 shoals, 3 spice farms | sea, hill, forest, pasture, 2 fields, mountain, 3 shoals, 3 spice farms |
| Explorers & Pirates | all 17 parrot hexes minus 1 sea | all 17 goose hexes minus 1 sea |

Starting-island terrain:

- **Land Ho!** (fixed): `(0,-3)` mountains, `(1,-3)` forest, `(-1,-2)` fields,
  `(0,-2)` pasture, `(-2,-1)` hills, `(-1,-1)` pasture, `(-3,0)` pasture,
  `(-2,0)` mountains, `(-1,0)` forest, `(-3,1)` fields, `(-2,1)` pasture,
  `(-3,2)` forest, `(-2,2)` hills, `(-3,3)` mountains, `(-2,3)` forest.
- **Pirate Lairs** (fixed): `(0,-3)` pasture, `(1,-3)` forest, `(-1,-2)` fields,
  `(0,-2)` pasture, `(-2,-1)` hills, `(-1,-1)` mountains, `(-3,0)` pasture,
  `(-2,0)` mountains, `(-1,0)` forest, `(-3,1)` fields, `(-2,1)` pasture,
  `(-3,2)` forest, `(-2,2)` mountains, `(-3,3)` hills, `(-2,3)` forest.
- **Fish, Spices, full game**: the 14 CATAN terrain hexes shuffled onto the
  cream cells (the `(-3,0)` pasture stays); discs fixed as above.

Land Ho! fixed pieces (EP25-M p. 4; corner `k` of a hex is at angle
`30° + 60°·k`, y downwards; side `k` faces neighbour `k` in the order E, NE,
NW, W, SW, SE). Every ship carries a settler.

| Colour | Settlement | Road | Harbour settlement | Ship | Starting resources |
|---|---|---|---|---|---|
| Blue | `(0,-3)` corner 1 | `(0,-3)` side 5 | `(-2,2)` corner 0 | `(-2,3)` side 1 | ore, grain, wool |
| Red | `(-3,2)` corner 0 | `(-2,2)` side 4 | `(1,-3)` corner 1 | `(1,-3)` side 5 | lumber, brick, ore |
| White | `(-3,0)` corner 0 | `(-2,0)` side 4 | `(-1,0)` corner 1 | `(-1,0)` side 5 | wool, ore, grain |
| Orange | `(-2,-1)` corner 2 | `(-2,-1)` side 4 | `(-1,-1)` corner 0 | `(-1,0)` side 1 | brick, wool |

Harbour-settlement start marks (Pirate Lairs and later, EP25 p. 7): corners 5
and 0 of `(1,-3)`, `(0,-2)`, `(-1,-1)`, `(-1,0)`, `(-2,1)`, `(-2,2)`,
`(-2,3)` (14 marks along the east coast).

## Contradictions, gaps and interpretations

1. **Pirate lair numbers are not printed.** CN3085 shows the lair token backs
   and one face (`3`, EP25 p. 4) but never lists the six numbers. The engine
   uses 2, 3, 5, 6, 8, 11 from a secondary report of the previous edition. Open
   fixture; replace when the 2025 tokens are confirmed.
2. **Fish for Catan omits the Council.** The map shows no Council hex although
   the mission delivers to it and the table lists one sea fewer than Pirate
   Lairs (19 vs 20). The Council is placed at `(0,0)` as in the Spices and
   full-game maps.
3. **Spices parrot disc table** reads "9: 2" with a total of 6; the component
   list (EP25 p. 3) has one 9. The component list wins.
4. **Gold compensation on a 7.** EP25 is silent; the 2020 rulebook excludes
   the 7. A 7 produces nothing, so no compensation is paid.
5. **Gold from a gold field counts as receiving** (no extra compensation gold).
6. **Several unexplored hexes at once.** If a step leaves both ship ends next
   to unexplored hexes, every such hex is flipped (in hex order).
7. **Ship building next to an unexplored intersection.** EP25 forbids edges
   of unexplored hexes; an edge whose end touches one would trigger an
   exploration on placement. Such edges are refused (the 2020 rulebook states
   this reason explicitly).
8. **Mission track overflow.** Progress past the last space is lost; the bonus
   tile requires leaving the start space.
9. **Tribute without gold.** A ship whose step needs tribute cannot make that
   step if its owner has no gold.
10. **Empty supplies.** Exploration rewards, gold compensation and lair gold
    are paid only while the bank/coin supply holds them (148 coins).
11. **Domestic trades with coins** are a limitation of the current trade UI:
    coins are not offered in player trades (see FIDELITY).

## As built

Rules (`packages/rules/src/modules/explorersPirates/`, `explorers-pirates-boards.ts`):

- Five profiles, one per mission set in book order, all `ep-2025.1`, 3/4
  players: `ep-land-ho-2025` (8 VP, fixed), `ep-pirate-lairs-2025` (12, fixed),
  `ep-fish-2025` (15, variable), `ep-spices-2025` (15, variable),
  `ep-full-2025` (17, variable). Bots refuse them (`botsSupported`).
- The module owns 27 commands (`ep.*`, listed in `docs/API.md`) and one
  pending frame (`explorersPirates.pirate`: place, then rob). Base
  `build.settlement`, `build.road`, `trade.*`, `turn.roll` and `turn.end`
  stay; cities, development cards, the robber and ports do not exist.
- No hidden state: an unexplored hex is `sea` terrain plus a public
  `fog` entry `{ hex, region }`. The tile, number disc, shoal number, spice
  ability and lair number are drawn with the server's recorded randomness when
  the hex is explored or the lair captured, from public remaining inventories.
- Harbour settlements are base settlements the module marks (+1 VP); ships are
  module state with cargo (two ships per edge); the Movement phase is a module
  turn phase keyed by the action window.
- New hooks on `RulesModule`: `sevenRobberStep`, `roadAllowed`,
  `vetoCommand`, `beforeEndTurn`, `bankRate`, `awardRules`; the kit gained
  `finishTurn` (see `packages/rules/src/modules/README.md`). Base and
  Seafarers digests are unchanged.

Client (`packages/web`):

- `components/ExplorersPiratesPrompt.tsx` (setup steps, pirate victim, coin
  trades, settler/crew holders with the `clear` option, ship rebuild, extra
  moves, start movement, fish roll, per-ship Movement actions) under the
  shared prompt; board targets for setup, harbour/ship builds, ship steps
  (carrying the ship id), founding and the pirate work in both renderers.
- SVG (`SvgExplorersPirates.tsx`) and 3D (`board/three/DioramaExplorersPirates.tsx`,
  `diorama-explorers.ts`): fog banks with parrot/goose markers that lift when a
  hex is explored, ships side by side with their cargo, harbour flags with
  cargo, lairs, shoals (number; pips in 3D) and hauls, spice farms, crews, the
  Council and the owner-marked pirate ship. All shapes are hand-made; the 3D
  pieces are procedural.
- Players panel: ships, gold, harbour and mission points; help section;
  inspection describes an unexplored hex only by its region; two new
  procedural cues (`explore.reveal`, `mission.advance`), the rest reuse the
  sea cues. Strings in `i18n/modules/explorersPirates.ts` (en, zh-Hant).

Browser harness (`scripts/explorers-pirates/`): `capture.py` plays every
mission to its result on the built service; `bot.mjs` serves decisions from
the fixture bot (`epBotStep` in `packages/rules/test/ep-sim.ts`). Player 1
acts through the UI the first times each command type comes up (executed in
one renderer, reached in the other); `report.json` lists per-mission command
coverage. Curated captures: `docs/screenshots/explorers-pirates/`.

Browser verification (run of 2026-11-03, `docs/screenshots/explorers-pirates/report.json`,
32 cases, no page errors): Land Ho! 4p 309 steps (8 VP), Pirate Lairs 3p 697
(12), Fish 3p 925 (15), Spices 4p 1139 (15), full 3p 727 (17). All 33 command
types that came up (27 `ep.*`, roll, end, road, settlement, 3:1 bank trade,
discard) were made through the UI in SVG and reached in 3D, 25 also made in
3D; player 1 sent nothing through the API. `ep.sellForGold`, `ep.unload` and
`ep.swap` are never chosen by the fixture bot, so the harness makes them from
the prompt when offered.

The harness found and fixed four client issues, three of them shared:

- the tall E&P prompt covered the vertically centred action-rail toggle (the
  rail now starts below the messages while an E&P prompt shows);
- the target picker sat below the board inspection and target layers (z-index
  20 < 43/44), so a picker row over a hex was not clickable in 3D;
- the picker spanned the map under the toolbar and the prompt card (it now
  sits clear of them; docked at the bottom on phones);
- inspecting an unexplored hex showed its sea details (now only its region).

Deviations and limits:

- The result screen keeps the shared statistics table (cities, longest road,
  knights); the E&P breakdown (harbours, mission points, gold) is in the
  players panel during play.
- No human playtest. The goose marker is faint in 3D.
- 5–6 players (CN3086), the combination rules and 2-player play stay out.
