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
   uses 2, 3, 5, 6, 8, 11 from a secondary report of the 2013/2020 edition.
   Provisional — maintainer decision 2026-11-03: the lair missions are enabled
   with this list; a correction is a one-line change to `LAIR_TOKENS`
   (`core.ts`, pinned by R-EP-42).
2. **Fish for Catan omits the Council** (resolved source note). The map shows no Council hex although
   the mission delivers to it and the table lists one sea fewer than Pirate
   Lairs (19 vs 20). The Council is placed at `(0,0)` as in the Spices and
   full-game maps.
3. **Spices parrot disc table** reads "9: 2" with a total of 6; the component
   list (EP25 p. 3) has one 9. The component list and the total win
   (resolved source note).
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
11. **Domestic trades with coins** use the `tradeGoods` hook shared with
    Traders & Barbarians (offers carry `giveGoods` / `wantGoods`).
12. **Making room** returns exactly one named piece; a settler needs an empty
    holder (EP25 p. 10).
13. **Extra move** is up to 6 edges (EP25 p. 10 text) although the tool card
    reads "+1-2 extra spaces" (EP25 p. 2); it stacks with Swift Voyage (unsourced).

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
  `vetoCommand`, `onEndTurn`, `bankRate`, `awardRules`; the kit gained
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

Rule fixtures: every clause in "Rule clauses" maps to at least one R-EP
fixture (the clause map is in FIDELITY). R-EP-01…24 are in `ep-rules.test.ts`
and R-EP-25…58 in `ep-clauses.test.ts`; lair captures (R-EP-53…56) run through
`ep.dropCrew` and `turn.end`. `ep-privacy.test.ts` (12) checks that each
reveal pool equals the printed region list minus the draws named in public
events (condition a) and that the view only carries counts; that every draw is
stored in the snapshot and its event and a restored game draws nothing again
(condition b); and that no event names a hex's tile, disc, shoal, ability or
bonus before its `ep.explored`. A server test restarts the service and finds
the fog, pools and a pirate frame unchanged. No clause is open. Rules tests:
352.

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

The harness found four client issues:

- the tall E&P prompt covered the vertically centred action-rail toggle (the
  rail now starts below the messages while an E&P prompt shows; E&P only);
- inspecting an unexplored hex showed its sea details (now only its region);
- the target picker sat below the board inspection and target layers (z-index
  20 < 43/44), so a picker row over a hex was not clickable in 3D;
- the picker spanned the map under the toolbar and the prompt card.

The two picker issues affect every game. They were fixed here at first, then
reverted in favour of master PR #85, which turns the picker into a compact
popover anchored to the click (z-index 46). The 3D picker clicks of the
recorded run depend on that fix.

Deviations and limits:

- The result screen keeps the shared statistics table (cities, longest road,
  knights); the E&P breakdown (harbours, mission points, gold) is in the
  players panel during play.
- No human playtest. The goose marker is faint in 3D.
- 5–6 players (CN3086), the combination rules and 2-player play stay out.

## Release integration comparison
Original E&P base: `29acbfc6124cbd869d553265563b1db7c440d0be`; original head: `b6d2bbc04246eb24becb8570a634582e4a4ca485`; release parent: `f151facb1afe178becb9599420ca500f93899512`. First-parent history contains no later Seafarers merge. The original 89-file delta matched `gh pr diff 87 --name-only` before changing the PR base.
The following comparison uses the merge index against the release parent and compares signed, nonblank changed lines per file against the original delta, retaining multiplicity. It excludes context, line numbers and the self-referential additions to this work record. Differences are listed below; relative ordering of common signed lines is reported separately below. The subsequent board-hook fix and its tests are recorded separately after this merge comparison.
### Conflicted files
- `README.md`: keep release expansion status and add E&P description.
- `docs/API.md`: The shared T&B goods paragraph and the E&P section now both document release validation at proposal, revision, consent and settlement.
- `docs/FIDELITY.md`: Preserve release SF/CK/T&B coverage while adding E&P sources, profiles and clauses; nearby prose and table ordering differ.
- `docs/SPEC.md`: Preserve release expansion/status descriptions while adding E&P descriptions.
- `docs/aegis/INDEX.md`: keep CK/T&B work entries and add the E&P work record.
- `docs/aegis/plans/2026-11-01-expansions-roadmap.md`: keep release P2–P5 completion notes and add the P6 implementation note.
- `packages/rules/src/analysis.ts`: keep release road/ship/bridge counting and C&K route logic.
- `packages/rules/src/engine.ts`: Repeated braces and local declarations match at different positions; the E&P veto retains the same sequence.
- `packages/rules/src/index.ts`: export the E&P public types and boards alongside release exports.
- `packages/rules/src/layout-registry.ts`: register E&P layouts alongside release layouts.
- `packages/rules/src/messages.ts`: keep release combined message IDs.
- `packages/rules/src/modules/README.md`: release implementation retained.
- `packages/rules/src/modules/builtins.ts`: keep release module registry including E&P and SFCK.
- `packages/rules/src/modules/citiesKnights/index.ts`: release implementation retained.
- `packages/rules/src/modules/citiesKnights/messages.ts`: release implementation retained.
- `packages/rules/src/modules/explorersPirates/index.ts`: keep the full E&P rules module in place of the release placeholder.
- `packages/rules/src/modules/explorersPirates/messages.ts`: keep the E&P event and rejection catalog.
- `packages/rules/src/modules/messages.ts`: keep release combined module message registry.
- `packages/rules/src/modules/seafarers/index.ts`: release implementation retained.
- `packages/rules/src/modules/seafarers/pirate.ts`: release implementation retained.
- `packages/rules/src/modules/seafarers/ships.ts`: release implementation retained.
- `packages/rules/src/modules/tradersBarbarians/index.ts`: release implementation retained.
- `packages/rules/src/modules/tradersBarbarians/messages.ts`: release implementation retained.
- `packages/rules/src/modules/types.ts`: Shared hooks already exist in release with updated signatures; E&P adds only vetoCommand against the release view context.
- `packages/rules/src/pending.ts`: keep release continuation machinery.
- `packages/rules/src/profiles.ts`: Retain release T&B and enabled CK/SFCK profiles and append the five E&P profiles using the existing registry.
- `packages/rules/src/project.ts`: keep release projection and victory-target logic.
- `packages/rules/src/topology-registry.ts`: register E&P topologies alongside release topologies.
- `packages/rules/src/topology.ts`: keep release interior-path topology support.
- `packages/rules/test/profiles.test.ts`: Update counts and enabled-profile expectations to include CK, SFCK, T&B and E&P.
- `packages/rules/test/seafarers-sim.ts`: keep release SF ship scoring helper.
- `packages/rules/test/simulate.ts`: keep release combined simulation helpers.
- `packages/server/src/game.ts`: keep release actor-projected receipts and snapshot publication.
- `packages/server/src/rooms.ts`: keep release lobby Bot seating workflow.
- `packages/server/test/rooms.test.ts`: Update enabled profile counts to include both release expansions and E&P.
- `packages/server/test/session.test.ts`: Update enabled profile counts and IDs to include both release expansions and E&P.
- `packages/web/src/audio/cues.ts`: include E&P audio events alongside CK and T&B cues.
- `packages/web/src/audio/synth.ts`: include E&P synthesizers alongside CK and T&B sounds.
- `packages/web/src/board/coastline.ts`: keep release exclusion of interior paths.
- `packages/web/src/board/geometry.ts`: keep release exclusion of interior paths.
- `packages/web/src/board/intent.ts`: Combine E&P intent parameters with the release module target and follow-up interfaces.
- `packages/web/src/board/render-contract.ts`: Keep release arrivals and add the active group used by E&P fog animation.
- `packages/web/src/board/seafarers.ts`: retain SF helpers and add E&P ship-command recognition.
- `packages/web/src/board/three/DioramaSeafarers.tsx`: keep release arrivals rendering for SF.
- `packages/web/src/board/three/SceneContent.tsx`: Keep release scene layers and arrivals while supplying the E&P scene and active effect.
- `packages/web/src/board/three/diorama-ships.ts`: keep release arrivals-aware ship geometry.
- `packages/web/src/board/three/model-specs.ts`: keep release bridge handling.
- `packages/web/src/components/ActionBar.tsx`: Combine the E&P and CK action icon mappings.
- `packages/web/src/components/BoardView.tsx`: Keep release target picker and arrivals while passing E&P state and its active animation group to both renderers.
- `packages/web/src/components/HelpPanel.tsx`: Combine E&P restricted build costs and help with release CK and T&B help.
- `packages/web/src/components/HomeScreen.tsx`: keep release create-room flow without Bot controls.
- `packages/web/src/components/LobbyScreen.tsx`: keep release lobby Bot controls and naming dialog.
- `packages/web/src/components/PendingPrompt.tsx`: Render E&P and CK prompts together with the release pending framework.
- `packages/web/src/components/PlayersPanel.tsx`: Preserve release CK, bot and hand handling, add E&P scores and use its held pre-roll view.
- `packages/web/src/components/SeafarersPrompt.tsx`: keep release SF prompt and combined bandit behavior.
- `packages/web/src/components/SelectionPreview.tsx`: include E&P selection costs with release preview.
- `packages/web/src/components/SoundPreview.tsx`: include E&P preview sounds alongside release sounds.
- `packages/web/src/components/SvgBoard.tsx`: Keep release arrivals, CK and T&B layers while rendering E&P and its active effect.
- `packages/web/src/components/TradePanel.tsx`: Use release shared goods stepper and formatTradeMap, with E&P gold and held balances.
- `packages/web/src/i18n/en.ts`: keep release English base catalog.
- `packages/web/src/i18n/events.ts`: keep release event formatting using formatTradeMap.
- `packages/web/src/i18n/modules/citiesKnights.ts`: release implementation retained.
- `packages/web/src/i18n/modules/events.ts`: Register E&P event builder alongside the release CK and SFCK builders.
- `packages/web/src/i18n/modules/explorersPirates.ts`: keep the E&P locale catalog instead of the placeholder.
- `packages/web/src/i18n/modules/index.ts`: keep release registration of E&P and SFCK catalogs.
- `packages/web/src/i18n/modules/tradersBarbarians.ts`: release implementation retained.
- `packages/web/src/i18n/zh-Hant.ts`: keep release Traditional Chinese base catalog.
- `packages/web/src/state/actions.ts`: Preserve release CK actions and add the mutually exclusive E&P actions and phase restrictions.
- `packages/web/src/state/pending.ts`: add E&P setup handling while preserving SFCK bandit handling.
- `packages/web/src/state/table.ts`: Capture the E&P pre-roll projection and expose the shared hold selector for gold.
- `packages/web/src/state/useTable.ts`: keep release selection extra and E&P params in submitted payload.
- `packages/web/test/archipelago-board.test.tsx`: keep release arrival assertions.
- `packages/web/test/bots.test.tsx`: keep release lobby Bot tests.
- `packages/web/test/i18n.test.ts`: keep release CK/SFCK localization assertions.
- `packages/web/test/rulesets.test.ts`: Retain E&P scenarios while updating expected enabled choices for CK, SFCK and T&B.
- `packages/web/test/seafarers.test.tsx`: keep release SF arrival assertions.

### Signed line differences

`Original only` means a signed changed line in the original E&P delta absent from the merge delta; `merge only` is the converse.

#### `docs/API.md`

The shared T&B goods paragraph and the E&P section now both document release validation at proposal, revision, consent and settlement.

```diff
# original only
+repeat them, and both players' coins are checked at settlement (EP25 p. 9).
# merge only
+  gold.
+  revised, consented to and settled. E&P gold uses the same contract as T&B
+  validated against the declaring module and current holdings when proposed,
+consent and settlement (EP25 p. 9).
+repeat them. Amounts and holdings are validated at proposal, revision,
-  checked against holdings at settlement, like resources (Traders & Barbarians
-  gold).
```

#### `docs/FIDELITY.md`

Preserve release SF/CK/T&B coverage while adding E&P sources, profiles and clauses; nearby prose and table ordering differ.

```diff
# original only
+    offers carry `giveGoods` / `wantGoods`, checked at settlement.
+`base-paired-2025` is enabled after the B56-25 fixture set verifies the 30-hex topology, 11 harbors, 24/resource bank, 34-card development deck, setup order, and paired turns. The Heading for New Shores profiles are enabled after the R-SF fixtures below pass, the maps are transcribed from the printed SF25/SF56-25 pages (method and per-cell data in [the work record](aegis/work/2026-11-01-seafarers.md) and `packages/rules/src/seafarers-boards.ts`) and a whole game is playable from the browser in both renderers (`scripts/seafarers/capture.py`). The five Explorers & Pirates profiles are enabled one per mission set, in book order, after the R-EP fixtures below pass, the maps are transcribed from EP25/EP25-M (method, per-cell data and interpretations in [the work record](aegis/work/2026-11-02-explorers-pirates.md) and `packages/rules/src/explorers-pirates-boards.ts`) and each mission is played to its result in the browser with every command in play made through the UI in one renderer and reached in the other (`scripts/explorers-pirates/capture.py`, [captures](screenshots/explorers-pirates/README.md)). Explorers & Pirates is never combined with Seafarers; bots refuse E&P rooms. Cities & Knights and the combined profiles remain closed.
-`base-paired-2025` is enabled after the B56-25 fixture set verifies the 30-hex topology, 11 harbors, 24/resource bank, 34-card development deck, setup order, and paired turns. The Heading for New Shores profiles are enabled after the R-SF fixtures below pass, the maps are transcribed from the printed SF25/SF56-25 pages (method and per-cell data in [the work record](aegis/work/2026-11-01-seafarers.md) and `packages/rules/src/seafarers-boards.ts`) and a whole game is playable from the browser in both renderers (`scripts/seafarers/capture.py`). Cities & Knights and the combined profiles remain closed.
# merge only
+    holdings are checked at proposal, revision, consent and settlement.
+    offers carry `giveGoods` / `wantGoods`; the declaring module and current
+The five Explorers & Pirates profiles are enabled one per mission set, in book order, after the R-EP fixtures below pass, the maps are transcribed from EP25/EP25-M (method, per-cell data and interpretations in [the work record](aegis/work/2026-11-02-explorers-pirates.md) and `packages/rules/src/explorers-pirates-boards.ts`) and each mission is played to its result in the browser with every command in play made through the UI in one renderer and reached in the other (`scripts/explorers-pirates/capture.py`, [captures](screenshots/explorers-pirates/README.md)). Explorers & Pirates is never combined with Seafarers; bots refuse E&P rooms.
```

#### `docs/SPEC.md`

Preserve release expansion/status descriptions while adding E&P descriptions.

```diff
# original only
+- Expansion set: base rules are mandatory; the lobby offers only expansion sets that some enabled registry profile has (today: the base game, Seafarers — Heading for New Shores, and Explorers & Pirates with its five mission sets for 3–4 players). Seafarers, Cities & Knights, Traders & Barbarians and Explorers & Pirates are registry vocabulary, not free toggles.
-- Expansion set: base rules are mandatory; the lobby offers only expansion sets that some enabled registry profile has (today: the base game and Seafarers — Heading for New Shores). Seafarers, Cities & Knights, Traders & Barbarians and Explorers & Pirates are registry vocabulary, not free toggles.
# merge only
+- Expansion set: base rules are mandatory; the lobby offers only expansion sets that some enabled registry profile has (today: base game, Seafarers — Heading for New Shores, Cities & Knights, Seafarers + Cities & Knights, Traders & Barbarians and Explorers & Pirates with its five mission sets for 3–4 players). These are registry entries, not free toggles.
-- Expansion set: base rules are mandatory; the lobby offers only expansion sets that some enabled registry profile has (today: the base game, Seafarers, Cities & Knights, Seafarers + Cities & Knights and Traders & Barbarians). Seafarers, Cities & Knights, Traders & Barbarians and Explorers & Pirates are registry vocabulary, not free toggles.
```

#### `packages/rules/src/engine.ts`

Most old platform additions are already provided by release, with later fixes to continuation, commodities, ship capacity, trade validation and board hooks. Only E&P command veto is added to that implementation.

```diff
# original only
+      // An end-of-turn phase owned by a module; it calls `kit.finishTurn`.
+      completePending(state, rng);
+      emit(state, 'robber.moveRequired', { playerId: roller, cause: 'seven' });
+      if (goods.balance(state, partner.id, good) < amount) return fail('E_INSUFFICIENT_RESOURCES', { playerId: partner.id, good });
+      if (goods.balance(state, proposer.id, good) < amount) return fail('E_INSUFFICIENT_RESOURCES', { playerId: proposer.id, good });
+      if (module.onEndTurn?.(state, actorId, ctx) === 'defer') return { ok: true, state, events: [] };
+      if (replaced) enqueuePending(state, replaced);
+      return createOffer(state, actorId, command as OfferCommand);
+      return endTurn(state, actorId, rng);
+      return reviseOffer(state, actorId, command as Omit<OfferCommand, 'to'> & { offerId: string });
+      return submitDiscard(state, actorId, command.resources, rng);
+      return;
+      state.pending = replaced;
+      state.pending = { kind: 'moveRobber', actor: roller, cause: 'seven', pirate: false };
+    ...(offer.giveGoods ? { giveGoods: offer.giveGoods } : {}),
+    ...(offer.giveGoods ? { giveGoods: offer.giveGoods } : {}),
+    ...(offer.giveGoods ? { giveGoods: offer.giveGoods } : {}),
+    ...(offer.wantGoods ? { wantGoods: offer.wantGoods } : {}),
+    ...(offer.wantGoods ? { wantGoods: offer.wantGoods } : {}),
+    ...(offer.wantGoods ? { wantGoods: offer.wantGoods } : {}),
+    bankRates: bankRatesFor(state, playerId),
+    const ctx = moduleContext(profile, rng);
+    const frame = module.sevenRobberStep?.(state, currentPlayer(state).id, ctx);
+    const replaced = moduleSevenStep(state, rng);
+    const replaced = moduleSevenStep(state, rng);
+    for (const [good, amount] of Object.entries(offer.giveGoods ?? {})) goods.transfer(state, proposer.id, partner.id, good, amount);
+    for (const [good, amount] of Object.entries(offer.giveGoods ?? {})) {
+    for (const [good, amount] of Object.entries(offer.wantGoods ?? {})) goods.transfer(state, partner.id, proposer.id, good, amount);
+    for (const [good, amount] of Object.entries(offer.wantGoods ?? {})) {
+    for (const module of modules) {
+    from: actorId,
+    give,
+    give,
+    if (!allowed.includes(good)) return null;
+    if (!goods) return fail('E_INVALID_SELECTION', { reason: 'goods' });
+    if (amount === 0) continue;
+    if (frame !== undefined) return frame;
+    if (replaced !== undefined) {
+    if (replaced === null) {
+    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0) return null;
+    offerId: offer.id,
+    offerId: offer.id,
+    out[good] = amount;
+    recomputeAwards(state, rules);
+    return;
+    return;
+    return;
+    revision: offer.revision,
+    to: offer.to,
+    want,
+    want,
+    }
+    }
+    }
+    }
+    }
+    } else if (replaced) {
+    } else {
+  /** Module goods (e.g. gold), only where the profile's modules allow them. */
+  command: OfferCommand,
+  command: Omit<OfferCommand, 'to'> & { offerId: string },
+  const actorId = currentPlayer(state).id;
+  const allowed = tradeGoodsOf(state)?.ids(state) ?? [];
+  const ctx = moduleContext(profile, rng);
+  const ctx = viewContext(state);
+  const ctx = viewContext(state);
+  const ctx = viewContext(state);
+  const giveGoods = normalizeGoods(state, command.giveGoods);
+  const giveGoods = normalizeGoods(state, command.giveGoods);
+  const goods = offer.giveGoods || offer.wantGoods ? tradeGoodsOf(state) : undefined;
+  const moduleCtx = moduleContext(requireProfile(state.profileId), null);
+  const modules = modulesOf(state);
+  const modules = modulesOf(state);
+  const modules = modulesOf(state);
+  const modules = rulesModulesOf(profile);
+  const modules = rulesModulesOf(profile);
+  const out = {} as Record<Resource, number>;
+  const out: Record<string, number> = {};
+  const profile = requireProfile(state.profileId);
+  const profile = requireProfile(state.profileId);
+  const rate = bankRateFor(state, actorId, give);
+  const rates = harborRates(state, playerId);
+  const wantGoods = normalizeGoods(state, command.wantGoods);
+  const wantGoods = normalizeGoods(state, command.wantGoods);
+  else delete offer.giveGoods;
+  else delete offer.wantGoods;
+  emit(state, 'trade.offered', {
+  emit(state, 'trade.revised', {
+  finishTurn(state);
+  finishTurn,
+  for (const [good, amount] of Object.entries(goods as Record<string, unknown>)) {
+  for (const module of modules) if (module.awardRules) rules = module.awardRules(state, rules, ctx);
+  for (const module of modules) if (module.bankRate) rate = module.bankRate(state, playerId, give, rate, ctx);
+  for (const module of modules) module.afterBoardChange?.(state, moduleCtx);
+  for (const module of modules) {
+  for (const resource of RESOURCES) out[resource] = bankRateFor(state, playerId, resource);
+  give: Partial<Record<Resource, number>>;
+  giveGoods?: Record<string, number>;
+  if (!giveGoods || !wantGoods) return fail('E_INVALID_SELECTION', { reason: 'goods' });
+  if (!giveGoods || !wantGoods) return fail('E_INVALID_SELECTION', { reason: 'goods' });
+  if (!modulesAllowRoad(state, playerId, edge)) return false;
+  if (goods === undefined || goods === null) return {};
+  if (goods) {
+  if (goodsTotal(giveGoods) > 0) offer.giveGoods = giveGoods;
+  if (goodsTotal(wantGoods) > 0) offer.wantGoods = wantGoods;
+  if (modules.length === 0) return rate;
+  if (modules.length === 0) return true;
+  if (modules.length === 0) return undefined;
+  if (modules.length === 0) {
+  if (modules.length > 0) {
+  if (modulesOf(state).length === 0) return harborRates(state, playerId);
+  if (offer.giveGoods || offer.wantGoods) {
+  if (roll.total === 7) resolveSeven(state, rng);
+  if (state.result) return;
+  if (termsTotal(give) + goodsTotal(giveGoods) === 0 || termsTotal(want) + goodsTotal(wantGoods) === 0) {
+  if (termsTotal(give) + goodsTotal(giveGoods) === 0 || termsTotal(want) + goodsTotal(wantGoods) === 0) {
+  if (typeof goods !== 'object' || Array.isArray(goods)) return null;
+  let rate = rates[give];
+  let rules = {
+  recomputeAwards(state, rules);
+  return Object.values(goods ?? {}).reduce((sum, amount) => sum + amount, 0);
+  return modules.every((module) => !module.roadAllowed || module.roadAllowed(state, playerId, edge, ctx));
+  return modulesOf(state).find((module) => module.tradeGoods)?.tradeGoods;
+  return out;
+  return out;
+  return rate;
+  return undefined;
+  return { ok: true, state, events: [] };
+  setOfferGoods(offer, giveGoods, wantGoods);
+  setOfferGoods(offer, giveGoods, wantGoods);
+  to: string | 'all';
+  type CardKind,
+  want: Partial<Record<Resource, number>>;
+  wantGoods?: Record<string, number>;
+  }
+  }
+  }
+  }
+  }
+  }
+  });
+  });
+  };
+ * Supply rate for giving one card kind: the port rate, adjusted last by the
+ * profile's modules (E&P: 3:1 from the supply).
+ */
+/**
+/** A module's replacement for the robber step of a 7 (`undefined`: base step). */
+/** Closes the actor's window and opens the next one. */
+/** Keeps positive whole amounts of goods the profile allows; `null` for an unknown good. */
+/** Resource bank rates after module adjustments (base: the port rates). */
+/** The profile's tradeable goods module, if any. */
+function bankRateFor(state: GameState, playerId: string, give: CardKind): number {
+function bankRatesFor(state: GameState, playerId: string): Record<Resource, number> {
+function endTurn(state: GameState, actorId: string, rng: Rng): CommandOutcome {
+function finishTurn(state: GameState): void {
+function goodsTotal(goods: Record<string, number> | undefined): number {
+function moduleSevenStep(state: GameState, rng: Rng | null): PendingFrame | null | undefined {
+function modulesAllowRoad(state: GameState, playerId: string, edge: number): boolean {
+function normalizeGoods(state: GameState, goods: unknown): Record<string, number> | null {
+function resolveSeven(state: GameState, rng: Rng | null): void {
+function setOfferGoods(offer: Offer, giveGoods: Record<string, number>, wantGoods: Record<string, number>): void {
+function submitDiscard(state: GameState, actorId: string, resources: Resource[], rng: Rng): CommandOutcome {
+function tradeGoodsOf(state: GameState): RulesModule['tradeGoods'] | undefined {
+interface OfferCommand {
+}
+}
+}
+}
+}
+}
+}
+}
+}
+}
-      return createOffer(state, actorId, command);
-      return endTurn(state, actorId);
-      return reviseOffer(state, actorId, command);
-      return submitDiscard(state, actorId, command.resources);
-    bankRates: harborRates(state, playerId),
-    emit(state, 'robber.moveRequired', { playerId: roller, cause: 'seven' });
-    return { ok: true, state, events: [] };
-    return { ok: true, state, events: [] };
-    state.pending = { kind: 'moveRobber', actor: roller, cause: 'seven', pirate: false };
-  command: { offerId: string; give: Partial<Record<Resource, number>>; want: Partial<Record<Resource, number>> },
-  command: { to: string | 'all'; give: Partial<Record<Resource, number>>; want: Partial<Record<Resource, number>> },
-  const ctx = moduleContext(requireProfile(state.profileId), null);
-  const modules = modulesOf(state);
-  const rate = rates[give];
-  const rates = harborRates(state, actorId);
-  emit(state, 'trade.offered', { offerId: offer.id, from: actorId, to: offer.to, give, want });
-  emit(state, 'trade.revised', { offerId: offer.id, revision: offer.revision, give, want });
-  for (const module of modules) module.afterBoardChange?.(state, ctx);
-  if (modules.length === 0) return;
-  if (roll.total === 7) resolveSeven(state);
-  if (termsTotal(give) === 0 || termsTotal(want) === 0) {
-  if (termsTotal(give) === 0 || termsTotal(want) === 0) {
-  recomputeAwards(state, {
-  return { ok: true, state, events: [] };
-  });
-function endTurn(state: GameState, actorId: string): CommandOutcome {
-function resolveSeven(state: GameState): void {
-function submitDiscard(state: GameState, actorId: string, resources: Resource[]): CommandOutcome {
```

#### `packages/rules/src/modules/README.md`

The platform hook descriptions introduced by the old E&P stack are already present in release.

```diff
# original only
+`citiesKnights` and `tradersBarbarians`, so a phase
+`resolveRollOutcome`, `finishSetupStep`, `finishTurn`, `legalRoads`, `placedFreeRoute`, …)
+`seafarers` (Heading for New Shores) and `explorersPirates` (CN3085, one
+profile per mission set) are implemented; placeholders exist for
+| awards | `awardRules` | adjusts the Longest Road / Largest Army rules before awards are recomputed (E&P turns both off) |
+| board | `roadAllowed` | extra veto on a road edge (setup and play), e.g. E&P edges of unexplored hexes |
+| commands | `vetoCommand` | before any command is dispatched; return a failed outcome to refuse it (E&P: base setup commands, building and trading in the Movement phase) |
+| roll | `sevenRobberStep` | after the 7's discards: return a module frame instead of the base robber move, `null` for no robber step, `undefined` to leave it to the base (E&P: the pirate ship, none in Land Ho!) |
+| trade | `bankRate` | per bank trade card, given the harbour rate |
+| trade | `tradeGoods` | non-resource goods in domestic offers (E&P coins) |
+| turn | `onEndTurn` | on `turn.end`; `'defer'` opens an end-of-turn phase that calls `kit.finishTurn` |
-`citiesKnights`, `tradersBarbarians` and `explorersPirates`, so a phase
-`resolveRollOutcome`, `finishSetupStep`, `legalRoads`, `placedFreeRoute`, …)
-`seafarers` (Heading for New Shores) is implemented; placeholders exist for
```

#### `packages/rules/src/modules/types.ts`

Shared hooks already exist in release with updated signatures; E&P adds only vetoCommand against the release view context.

```diff
# original only
+   * 4:1 / 3:1 for commodities) and returns the adjusted rate.
+   * Ends the current action window and opens the next one, without running
+   * Refuses a command before it is dispatched, for example base building and
+   * Replaces the robber step of a 7 (after discards). Return a frame to make
+   * Runs when the actor ends their action phase. Return `'defer'` after
+   * Supply trade rate for giving `card`; receives the rate so far (ports, or
+   * `moveRobber` frame.
+   * `onEndTurn` again. A module that deferred the end of a turn calls this
+   * active, `null` for no robber step, or `undefined` to keep the base
+   * enqueueing end-of-turn frames; the module then calls `kit.finishTurn`.
+   * once its end-of-turn frames are resolved.
+   * trading during a module-owned phase. Return a failed outcome to refuse.
+   */
+   */
+   */
+   */
+   */
+  /**
+  /**
+  /**
+  /**
+  /**
+  /** Adjusts the award rules (minimums, route weights) before awards are recomputed. */
+  /** Extra condition for a road on `edge` (setup and action phase). */
+  /** Good ids tradeable in this state. */
+  /** Goods besides resources that domestic offers may carry. */
+  /** Moves goods between players; amounts were checked against `balance`. */
+  CardKind,
+  awardRules?(state: GameState, rules: AwardRules, ctx: ModuleViewContext): AwardRules;
+  balance(state: GameState, playerId: string, good: string): number;
+  bankRate?(state: GameState, playerId: string, card: CardKind, rate: number, ctx: ModuleViewContext): number;
+  finishTurn(state: GameState): void;
+  ids(state: GameState): readonly string[];
+  onEndTurn?(state: GameState, actorId: string, ctx: ModuleContext): 'continue' | 'defer';
+  roadAllowed?(state: GameState, playerId: string, edge: number, ctx: ModuleViewContext): boolean;
+  sevenRobberStep?(state: GameState, actorId: string, ctx: ModuleContext): PendingFrame | null | undefined;
+  tradeGoods?: TradeGoods;
+  transfer(state: GameState, from: string, to: string, good: string, amount: number): void;
+/** Non-resource goods a module lets players trade (e.g. gold coins). */
+export interface TradeGoods {
+import type { AwardRules, ProductionResult, ScoreOptions } from '../analysis.ts';
+}
-import type { ProductionResult, ScoreOptions } from '../analysis.ts';
# merge only
+  /** Veto a command before dispatch (for scenario phase and action boundaries). */
```

#### `packages/rules/src/profiles.ts`

Retain release T&B and enabled CK/SFCK profiles and append the five E&P profiles using the existing registry.

```diff
# original only
+    // Enabled after the mission fixtures, evidence and browser harness passed (docs/FIDELITY.md).
+ * Explorers & Pirates (EP25 / EP25-M, CN3085): one profile per mission set, in
+ * `explorers-pirates-boards.ts`. E&P is standalone: no development cards,
+ * book order; rules in `modules/explorersPirates/`, maps in
+ * cities, robber, ports, Longest Road or Largest Army (EP25-M p. 2), and it is
+ * harbour settlements; the module keeps plain settlements at 5.
+ * never combined with Seafarers. Harbour settlements are base settlements
+ * the module marks, so the shared settlement count is 5 settlements + 4
+ */
+/**
+export const SCENARIO_IDS = ['new-shores', 'land-ho', 'pirate-lairs', 'fish', 'spices', 'explorers-pirates'] as const;
+export const SOURCE_IDS = ['B25', 'B56-25', 'SF25', 'SF56-25', 'CK25', 'CK56-25', 'COMB', 'EP25', 'EP25-M'] as const;
-export const SCENARIO_IDS = ['new-shores'] as const;
-export const SOURCE_IDS = ['B25', 'B56-25', 'SF25', 'SF56-25', 'CK25', 'CK56-25', 'COMB'] as const;
# merge only
+  'land-ho', 'pirate-lairs', 'fish', 'spices', 'explorers-pirates',
+export const SOURCE_IDS = ['B25', 'B56-25', 'SF25', 'SF56-25', 'CK25', 'CK56-25', 'COMB', 'TB25', 'EP25', 'EP25-M'] as const;
-export const SOURCE_IDS = ['B25', 'B56-25', 'SF25', 'SF56-25', 'CK25', 'CK56-25', 'COMB', 'TB25'] as const;
```

#### `packages/rules/src/types.ts`

The shared goods and route types already exist in release; the release CardKind includes commodities.

```diff
# original only
+   * Non-resource goods a rules module lets players trade (for example gold
+   * coins), keyed by good id. Omitted when the offer has none.
+   */
+  /**
+  giveGoods?: Record<string, number>;
+  wantGoods?: Record<string, number>;
+/** A card a player can trade with the supply (Cities & Knights adds commodities). */
+export type CardKind = Resource;
```

#### `packages/rules/test/ep-clauses.test.ts`

Release validates the requested gold on consent, so the formerly later failure is asserted at consent.

```diff
# original only
+    expect(refused(state, 'p1', { type: 'trade.settle', offerId: second, counterparty: 'p2' })).toBe('E_INSUFFICIENT_RESOURCES');
+    state = run(state, 'p2', { type: 'trade.respond', offerId: second, response: 'consented' }).state;
# merge only
+    expect(refused(state, 'p2', { type: 'trade.respond', offerId: second, response: 'consented' })).toBe('E_INSUFFICIENT_RESOURCES');
```

#### `packages/rules/test/message-ids.test.ts`

A comment invalidates an old Vite transform cache whose glob was compiled before the release module files existed; the scanner itself is unchanged.

```diff
# merge only
+// Include each module's nested implementation files as well as its entry point.
```

#### `packages/rules/test/profiles.test.ts`

Update counts and enabled-profile expectations to include CK, SFCK, T&B and E&P.

```diff
# original only
+    expect(enabled).toEqual(['base-2025', 'base-paired-2025', 'sf-new-shores-2025', 'sf-new-shores-paired-2025', 'ep-land-ho-2025', 'ep-pirate-lairs-2025', 'ep-fish-2025', 'ep-spices-2025', 'ep-full-2025']);
+    expect(selectableProfiles().map((profile) => profile.id)).toEqual(['base-2025', 'base-paired-2025', 'sf-new-shores-2025', 'sf-new-shores-paired-2025', 'ep-land-ho-2025', 'ep-pirate-lairs-2025', 'ep-fish-2025', 'ep-spices-2025', 'ep-full-2025']);
-    expect(enabled).toEqual(['base-2025', 'base-paired-2025', 'sf-new-shores-2025', 'sf-new-shores-paired-2025']);
-    expect(selectableProfiles().map((profile) => profile.id)).toEqual(['base-2025', 'base-paired-2025', 'sf-new-shores-2025', 'sf-new-shores-paired-2025']);
# merge only
+    const all = ['base-2025', 'base-paired-2025', 'sf-new-shores-2025', 'sf-new-shores-paired-2025', 'ck-2025', 'ck-paired-2025', 'sf-ck-new-shores-2025', 'sf-ck-new-shores-paired-2025', 'ep-land-ho-2025', 'ep-pirate-lairs-2025', 'ep-fish-2025', 'ep-spices-2025', 'ep-full-2025'];
-    const all = ['base-2025', 'base-paired-2025', 'sf-new-shores-2025', 'sf-new-shores-paired-2025', 'ck-2025', 'ck-paired-2025', 'sf-ck-new-shores-2025', 'sf-ck-new-shores-paired-2025'];
```

#### `packages/server/test/explorers-pirates.test.ts`

The release lobby adds bots after creation; test rejection for all five E&P profiles at that endpoint.

```diff
# original only
+      visibility: 'private', capacity: 3, profileId: 'ep-fish-2025', setupMode: 'variable', bots: 1,
+      visibility: 'private', capacity: 3, profileId: 'ep-land-ho-2025', setupMode: 'fixed', bots: 0,
+    const created = await host.post('/api/rooms', {
+    const room = host.expectOk<{ id: string }>(await host.post('/api/rooms', {
+    expect(created.status).toBeGreaterThanOrEqual(400);
+    host.expectError(await host.post(`/api/rooms/${room.id}/bots`, {}), 'E_INVALID_BOT');
+    }));
+    });
# merge only
+        visibility: 'private', capacity: 3, profileId, setupMode,
+      const room = host.expectOk<{ id: string }>(await host.post('/api/rooms', {
+      host.expectError(await host.post(`/api/rooms/${room.id}/bots`, {}), 'E_INVALID_BOT');
+      }));
+    for (const [, profileId, setupMode] of MISSIONS) {
+    }
```

#### `packages/server/test/rooms.test.ts`

Update enabled profile counts to include both release expansions and E&P.

```diff
# original only
+      'ep-land-ho-2025', 'ep-pirate-lairs-2025', 'ep-fish-2025', 'ep-spices-2025', 'ep-full-2025']);
+    expect(data.selectable).toEqual(['base-2025', 'base-paired-2025', 'sf-new-shores-2025', 'sf-new-shores-paired-2025',
-    expect(data.selectable).toEqual(['base-2025', 'base-paired-2025', 'sf-new-shores-2025', 'sf-new-shores-paired-2025']);
# merge only
+    expect(data.selectable.filter((id) => !id.startsWith('tb-'))).toEqual(['base-2025', 'base-paired-2025', 'sf-new-shores-2025', 'sf-new-shores-paired-2025', 'ck-2025', 'ck-paired-2025', 'sf-ck-new-shores-2025', 'sf-ck-new-shores-paired-2025', 'ep-land-ho-2025', 'ep-pirate-lairs-2025', 'ep-fish-2025', 'ep-spices-2025', 'ep-full-2025']);
-    expect(data.selectable.filter((id) => !id.startsWith('tb-'))).toEqual(['base-2025', 'base-paired-2025', 'sf-new-shores-2025', 'sf-new-shores-paired-2025', 'ck-2025', 'ck-paired-2025', 'sf-ck-new-shores-2025', 'sf-ck-new-shores-paired-2025']);
```

#### `packages/server/test/session.test.ts`

Update enabled profile counts and IDs to include both release expansions and E&P.

```diff
# original only
+    expect(profiles.profiles.length).toBe(13);
+    expect(profiles.selectable).toEqual(['base-2025', 'base-paired-2025', 'sf-new-shores-2025', 'sf-new-shores-paired-2025', 'ep-land-ho-2025', 'ep-pirate-lairs-2025', 'ep-fish-2025', 'ep-spices-2025', 'ep-full-2025']);
-    expect(profiles.profiles.length).toBe(8);
-    expect(profiles.selectable).toEqual(['base-2025', 'base-paired-2025', 'sf-new-shores-2025', 'sf-new-shores-paired-2025']);
# merge only
+    expect(profiles.profiles.filter((profile) => !profile.id.startsWith('tb-')).length).toBe(13);
+    expect(profiles.selectable.filter((id) => !id.startsWith('tb-'))).toEqual(['base-2025', 'base-paired-2025', 'sf-new-shores-2025', 'sf-new-shores-paired-2025', 'ck-2025', 'ck-paired-2025', 'sf-ck-new-shores-2025', 'sf-ck-new-shores-paired-2025', 'ep-land-ho-2025', 'ep-pirate-lairs-2025', 'ep-fish-2025', 'ep-spices-2025', 'ep-full-2025']);
-    expect(profiles.profiles.filter((profile) => !profile.id.startsWith('tb-')).length).toBe(8);
-    expect(profiles.selectable.filter((id) => !id.startsWith('tb-'))).toEqual(['base-2025', 'base-paired-2025', 'sf-new-shores-2025', 'sf-new-shores-paired-2025', 'ck-2025', 'ck-paired-2025', 'sf-ck-new-shores-2025', 'sf-ck-new-shores-paired-2025']);
```

#### `packages/web/src/board/intent.ts`

Combine E&P intent parameters with the release module target and follow-up interfaces.

```diff
# original only
+      fromHints: armed.startsWith('build.') || armed.startsWith('ep.') || isShipCommand(armed),
-      fromHints: armed.startsWith('build.') || isShipCommand(armed),
# merge only
+      fromHints: armed.startsWith('build.') || armed.startsWith('ep.') || moduleTargets(state, state.selection.targetsKey ?? armed) !== null || isShipCommand(armed) || isCitiesKnightsVertexCommand(armed),
-      fromHints: armed.startsWith('build.') || moduleTargets(state, state.selection.targetsKey ?? armed) !== null || isShipCommand(armed) || isCitiesKnightsVertexCommand(armed),
```

#### `packages/web/src/board/render-contract.ts`

Keep release arrivals and add the active group used by E&P fog animation.

```diff
# merge only
+  /** Current effect group for scenario-specific event presentation. */
+  active?: BoardEffectGroup | null;
```

#### `packages/web/src/board/three/SceneContent.tsx`

Keep release scene layers and arrivals while supplying the E&P scene and active effect.

```diff
# merge only
+  'modules' | 'geometry' | 'board' | 'players' | 'intent' | 'selection' | 'arrivals' | 'active' | 'viewport' | 'quality' |
+  'motionAllowed' | 'onProjection' | 'onReady' | 'onUnavailable' | 'seafarers' | 'citiesKnights' | 'explorersPirates'>;
-  'modules' | 'geometry' | 'board' | 'players' | 'intent' | 'selection' | 'arrivals' | 'viewport' | 'quality' |
-  'motionAllowed' | 'onProjection' | 'onReady' | 'onUnavailable' | 'citiesKnights'>;
```

#### `packages/web/src/components/ActionBar.tsx`

Combine the E&P and CK action icon mappings.

```diff
# original only
+                <span className="action-list__label"><GameIcon name={action.commandType === 'turn.roll' ? 'dice' : action.commandType === 'turn.end' ? 'flag' : action.id === 'build.devCard' ? 'cards' : action.id === 'build.road' ? 'trade' : action.id === 'build.city' ? 'crown' : action.id === 'build.ship' || action.id === 'ship.move' || action.id === 'ep.buildShip' ? 'ship' : action.id === 'ep.buildHarbor' ? 'anchor' : 'home'} size={18} />{t(action.labelId)}</span>
-                <span className="action-list__label"><GameIcon name={action.commandType === 'turn.roll' ? 'dice' : action.commandType === 'turn.end' ? 'flag' : action.id === 'build.devCard' ? 'cards' : action.id === 'build.road' ? 'trade' : action.id === 'build.city' ? 'crown' : action.id === 'build.ship' || action.id === 'ship.move' ? 'ship' : 'home'} size={18} />{t(action.labelId)}</span>
# merge only
+                <span className="action-list__label"><GameIcon name={action.commandType === 'turn.roll' ? 'dice' : action.commandType === 'turn.end' ? 'flag' : action.id === 'build.devCard' ? 'cards' : action.id === 'build.road' ? 'trade' : action.id === 'build.city' ? 'crown' : action.id === 'build.ship' || action.id === 'ship.move' || action.id === 'ep.buildShip' ? 'ship' : action.id === 'ep.buildHarbor' ? 'anchor' : action.id.startsWith('knight.') ? 'shield' : action.id === 'build.wall' ? 'city' : 'home'} size={18} />{t(action.labelId)}</span>
-                <span className="action-list__label"><GameIcon name={action.commandType === 'turn.roll' ? 'dice' : action.commandType === 'turn.end' ? 'flag' : action.id === 'build.devCard' ? 'cards' : action.id === 'build.road' ? 'trade' : action.id === 'build.city' ? 'crown' : action.id === 'build.ship' || action.id === 'ship.move' ? 'ship' : action.id.startsWith('knight.') ? 'shield' : action.id === 'build.wall' ? 'city' : 'home'} size={18} />{t(action.labelId)}</span>
```

#### `packages/web/src/components/BoardView.tsx`

Keep release target picker and arrivals while passing E&P state and its active animation group to both renderers.

```diff
# original only
+            <Scene geometry={geometry} board={board} players={view.players.map(({ id, seat, color }) => ({ id, seat, color }))} seafarers={seaView} explorersPirates={epModule}
-            <Scene geometry={geometry} board={board} players={view.players.map(({ id, seat, color }) => ({ id, seat, color }))} seafarers={seaView}
# merge only
+              intent={intent} selection={selection} arrivals={animation.arrivals} active={animation.active} viewport={controls.viewport} quality={quality}
+              motionAllowed={animation.arrivals.length > 0 || animation.active !== null} onProjection={setProjection} onReady={sceneReady} onUnavailable={unavailable} {...(view.modules ? { modules: view.modules } : {})} />
+            <Scene geometry={geometry} board={board} players={view.players.map(({ id, seat, color }) => ({ id, seat, color }))} seafarers={seaView} citiesKnights={ckView} explorersPirates={epModule}
+        {effective === 'svg' && <SvgBoard svgRef={svgRef} geometry={geometry} view={view} arrivals={animation.arrivals} active={animation.active}
-              intent={intent} selection={selection} arrivals={animation.arrivals} viewport={controls.viewport} quality={quality}
-              motionAllowed={animation.arrivals.length > 0} onProjection={setProjection} onReady={sceneReady} onUnavailable={unavailable} {...(view.modules ? { modules: view.modules } : {})} />
-            <Scene geometry={geometry} board={board} players={view.players.map(({ id, seat, color }) => ({ id, seat, color }))} seafarers={seaView} citiesKnights={ckView}
-        {effective === 'svg' && <SvgBoard svgRef={svgRef} geometry={geometry} view={view} arrivals={animation.arrivals}
```

#### `packages/web/src/components/HelpPanel.tsx`

Combine E&P restricted build costs and help with release CK and T&B help.

```diff
# original only
+        {(ep ? ['road', 'settlement'] as const : ['road', 'settlement', 'city', 'devCard'] as const).map((piece) => (
-        {(['road', 'settlement', 'city', 'devCard'] as const).map((piece) => (
# merge only
+        {(['road', 'settlement', 'city', 'devCard'] as const).filter((piece) => (!ep || (piece !== 'city' && piece !== 'devCard')) && (piece !== 'devCard' || !citiesKnightsView(controller.state.game?.view))).map((piece) => (
-        {(['road', 'settlement', 'city', 'devCard'] as const).filter((piece) => piece !== 'devCard' || !citiesKnightsView(controller.state.game?.view)).map((piece) => (
```

#### `packages/web/src/components/PendingPrompt.tsx`

Render E&P and CK prompts together with the release pending framework.

```diff
# merge only
+import { TbPrompt } from './tb/TbPrompt.tsx';
-import { TbPrompt } from './tb/TbPrompt.tsx';
```

#### `packages/web/src/components/PlayersPanel.tsx`

Preserve release CK, bot and hand handling, add E&P scores and use its held pre-roll view.

```diff
# original only
+                    value={number(player.longestRoadLength)} awarded={longestRoad} />}
+                    value={number(player.playedKnights)} awarded={largestArmy} />}
+                  {!ep && <ScoreMark icon="book" label={t('play.devCardCount')} value={number(player.devCardCount)} />}
+                  {!ep && <ScoreMark icon="shield" label={`${t('play.knightsPlayed')}${largestArmy ? ` · ${t('play.award.largestArmy')} (+2)` : ''}`}
-                    value={number(player.longestRoadLength)} awarded={longestRoad} />
-                    value={number(player.playedKnights)} awarded={largestArmy} />
-                  <ScoreMark icon="book" label={t('play.devCardCount')} value={number(player.devCardCount)} />
-                  <ScoreMark icon="shield" label={`${t('play.knightsPlayed')}${largestArmy ? ` · ${t('play.award.largestArmy')} (+2)` : ''}`}
# merge only
+                    : !ep && <ScoreMark icon="book" label={t('play.devCardCount')} value={number(player.devCardCount)} />}
+                    value={number(player.longestRoadLength)} awarded={longestRoad} testId={`players-route-${player.seat}`} />}
+                  {!ck && !ep && <ScoreMark icon="shield" label={`${t('play.knightsPlayed')}${largestArmy ? ` · ${t('play.award.largestArmy')} (+2)` : ''}`}
+  const view = shownCitiesKnights(state) ?? shownTradersBarbarians(state) ?? shownExplorersPirates(state) ?? state.game?.view;
+import { shownCitiesKnights, shownExplorersPirates, shownTradersBarbarians, shownHandSize } from '../state/table.ts';
-                    : <ScoreMark icon="book" label={t('play.devCardCount')} value={number(player.devCardCount)} />}
-                    value={number(player.longestRoadLength)} awarded={longestRoad} testId={`players-route-${player.seat}`} />
-                  {!ck && <ScoreMark icon="shield" label={`${t('play.knightsPlayed')}${largestArmy ? ` · ${t('play.award.largestArmy')} (+2)` : ''}`}
-  const view = shownCitiesKnights(state) ?? shownTradersBarbarians(state) ?? state.game?.view;
-import { shownCitiesKnights, shownTradersBarbarians, shownHandSize } from '../state/table.ts';
```

#### `packages/web/src/components/SvgBoard.tsx`

Keep release arrivals, CK and T&B layers while rendering E&P and its active effect.

```diff
# merge only
+  active?: BoardEffectGroup | null;
+  arrivals?: readonly BoardEffectGroup[];
+export function SvgBoard({ svgRef, geometry, view, arrivals = [], active = null, selection, selfId, intent, pan, zoom, viewBoxCenter, nameResolver, ...svgProps }: SvgBoardProps) {
-  arrivals: readonly BoardEffectGroup[];
-export function SvgBoard({ svgRef, geometry, view, arrivals, selection, selfId, intent, pan, zoom, viewBoxCenter, nameResolver, ...svgProps }: SvgBoardProps) {
```

#### `packages/web/src/components/TradePanel.tsx`

Use release shared goods stepper and formatTradeMap, with E&P gold and held balances.

```diff
# original only
+                  available={(good) => goodsBalance(view, selfId, good)} />
+                  onChange={side === 'give' ? setGiveGoods : setWantGoods}
+                ...(goodsTotal(giveGoods) > 0 ? { giveGoods } : {}),
+                ...(goodsTotal(wantGoods) > 0 ? { wantGoods } : {}),
+                <GoodsStepper side={side} goods={goods} value={side === 'give' ? giveGoods : wantGoods}
+                type: 'trade.offer', to, give, want,
+              setGiveGoods({});
+              setWantGoods({});
+              void actions.submitCommand({
+              }, 'play.tradeNew');
+            {t('play.tradeGive')}: {formatResourceMap(locale, viewerTerms.give)}{goodsSuffix(sideGoods.give)} ·{' '}
+            {t('play.tradeGiveBy', { player: nameOf(offer.from) })}: {formatResourceMap(locale, offer.give)}{goodsSuffix(offer.giveGoods)} ·{' '}
+            {t('play.tradeWant')}: {formatResourceMap(locale, viewerTerms.want)}{goodsSuffix(sideGoods.want)}
+            {t('play.tradeWantBy', { player: nameOf(offer.from) })}: {formatResourceMap(locale, offer.want)}{goodsSuffix(offer.wantGoods)}
+    goodsTotal(giveGoods) === 0 && goodsTotal(wantGoods) === 0;
+  // Module goods (Explorers & Pirates gold) on each side of a new offer.
+  const [giveGoods, setGiveGoods] = useState<Goods>({});
+  const [wantGoods, setWantGoods] = useState<Goods>({});
+  const draftEmpty = Object.keys(give).length === 0 && Object.keys(want).length === 0 &&
+  const goods = tradeGoodsOf(view);
+  const goodsSuffix = useGoodsSuffix();
+  const sideGoods = viewerGoods(offer, selfId);
+import { GoodsStepper, goodsBalance, goodsTotal, tradeGoodsOf, useGoodsSuffix, viewerGoods, type Goods } from './ep/TradeGoods.tsx';
-              void actions.submitCommand({ type: 'trade.offer', to, give, want }, 'play.tradeNew');
-            {t('play.tradeGive')}: {formatResourceMap(locale, viewerTerms.give)} ·{' '}
-            {t('play.tradeGiveBy', { player: nameOf(offer.from) })}: {formatResourceMap(locale, offer.give)} ·{' '}
-            {t('play.tradeWant')}: {formatResourceMap(locale, viewerTerms.want)}
-            {t('play.tradeWantBy', { player: nameOf(offer.from) })}: {formatResourceMap(locale, offer.want)}
-  const draftEmpty = Object.keys(give).length === 0 && Object.keys(want).length === 0;
# merge only
+                  prefix={epView(view) ? 'ep' : 'tb'}
+  // Module goods on each side of a new offer.
+  const goodsView = shownTradersBarbarians(state) ?? shownExplorersPirates(state) ?? view;
+import { epView } from '../board/explorersPirates.ts';
+import { nameOf as resolveName, shownExplorersPirates, shownHand, shownTradersBarbarians } from '../state/table.ts';
-  // Module goods (Traders & Barbarians gold) on each side of a new offer.
-  const goodsView = shownTradersBarbarians(state) ?? view;
-import { nameOf as resolveName, shownHand, shownTradersBarbarians } from '../state/table.ts';
```

#### `packages/web/src/components/tb/TradeGoods.tsx`

Extend the release shared goods stepper to E&P gold and its locale labels.

```diff
# merge only
+                aria-label={`${t(goodNameKey)} +`} onClick={() => set(amount + 1)}>+</button>
+                aria-label={`${t(goodNameKey)} −`} onClick={() => set(amount - 1)}>−</button>
+              {t(goodNameKey)}
+        const goodNameKey = `${prefix}.trade.goodName.${good}`;
+  prefix?: 'ep' | 'tb';
+  return epView(view) || tbPart(view, 'tb-coins') ? ['gold'] : [];
+  return epView(view)?.players[playerId]?.gold ?? tbPart<{ gold: Record<string, number> }>(view, 'tb-coins')?.gold[playerId];
+export function GoodsStepper({ side, goods, available, value, onChange, prefix = 'tb' }: {
+import { epView } from '../../board/explorersPirates.ts';
-                aria-label={`${t(`tb.trade.goodName.${good}`)} +`} onClick={() => set(amount + 1)}>+</button>
-                aria-label={`${t(`tb.trade.goodName.${good}`)} −`} onClick={() => set(amount - 1)}>−</button>
-              {t(`tb.trade.goodName.${good}`)}
-  return tbPart(view, 'tb-coins') ? ['gold'] : [];
-  return tbPart<{ gold: Record<string, number> }>(view, 'tb-coins')?.gold[playerId];
-export function GoodsStepper({ side, goods, available, value, onChange }: {
```

#### `packages/web/src/i18n/modules/events.ts`

Register E&P event builder alongside the release CK and SFCK builders.

```diff
# original only
+const BUILDERS: readonly Builder[] = [seafarersEventParams, explorersPiratesEventParams];
-const BUILDERS: readonly Builder[] = [seafarersEventParams];
# merge only
+const BUILDERS: readonly Builder[] = [seafarersEventParams, explorersPiratesEventParams, citiesKnightsEventParams, seafarersCitiesKnightsEventParams];
-const BUILDERS: readonly Builder[] = [seafarersEventParams, citiesKnightsEventParams, seafarersCitiesKnightsEventParams];
```

#### `packages/web/src/state/actions.ts`

Preserve release CK actions and add the mutually exclusive E&P actions and phase restrictions.

```diff
# original only
+  | 'ep.buildShip';
+  | 'ship.move'
-  | 'ship.move';
# merge only
+  | 'ep.buildShip'
```

#### `packages/web/src/state/table.ts`

Capture the E&P pre-roll projection and expose the shared hold selector for gold.

```diff
# merge only
+      explorersPirates: current.view.modules?.explorersPirates ? current.view : null,
+  /** E&P 擲骰前的公開狀態，包括金幣與分數。 */
+  const hold = activeHold(state);
+  const view = state.game?.view ?? null;
+  explorersPirates?: GameSnapshot['view'] | null;
+  if (hold) return hold.explorersPirates ?? null;
+  return view?.modules?.explorersPirates ? view : null;
+/** E&P 金幣與任務面板在擲骰演出期間使用擲骰前投影。 */
+export function shownExplorersPirates(state: TableState): GameSnapshot['view'] | null {
+}
```

#### `packages/web/test/dice-hold.test.tsx`

Add snapshot-first and events-first regressions for pre-roll E&P gold.

```diff
# merge only
+    after.view.modules = { explorersPirates: { players: { p1: { gold: 3 } } } };
+    before.game!.view.modules = { explorersPirates: { players: { p1: { gold: 1 } } } };
+    const after = rolledSnapshot(9);
+    const before = base();
+    expect(shownExplorersPirates(state)?.modules?.explorersPirates).toEqual({ players: { p1: { gold: 1 } } });
+    expect(shownExplorersPirates(state)?.modules?.explorersPirates).toEqual({ players: { p1: { gold: 3 } } });
+    let state = delivery === 'events' ? tableReducer(before, { type: 'events', events: after.view.events }) : before;
+    state = tableReducer(state, { type: 'dice-presenting', value: false });
+    state = tableReducer(state, { type: 'snapshot', snapshot: after });
+  it.each(['snapshot', 'events'] as const)('holds E&P gold until dice settle (%s first)', (delivery) => {
+  });
+import { initialTableState, shownCitiesKnights, shownExplorersPirates, shownHand, tableReducer, type TableState } from '../src/state/table.ts';
-import { initialTableState, shownCitiesKnights, shownHand, tableReducer, type TableState } from '../src/state/table.ts';
```

#### `packages/web/test/explorers-pirates.test.tsx`

Expect release formatTradeMap output for the E&P gold offer.

```diff
# original only
+    expect(screen.getByTestId(`offer-terms-${offerId}`).textContent).toBe('You give: 1×Ore · You receive: — + 2 gold');
# merge only
+    expect(screen.getByTestId(`offer-terms-${offerId}`).textContent).toBe('You give: 1×Ore · You receive: 2×Gold');
```

#### `packages/web/test/rulesets.test.ts`

Retain E&P scenarios while updating expected enabled choices for CK, SFCK and T&B.

```diff
# original only
+    expect(resolved.expansions.map((choice) => choice.key)).toEqual(['base', 'seafarers', 'explorersPirates']);
+  it('offers only enabled profiles: the base game and Seafarers for 3–6 players, Explorers & Pirates for 3–4', () => {
-    expect(resolved.expansions.map((choice) => choice.key)).toEqual(['base', 'seafarers']);
-  it('offers only enabled profiles: the base game and Seafarers for 3–6 players', () => {
# merge only
+    const stale = resolveRuleset(enabledAll, { expansionKey: 'tradersBarbarians', scenarioKey: 'gone', playerCount: 9 });
+    expect(resolved.expansions.map((choice) => choice.key)).toEqual(['base', 'seafarers', 'citiesKnights', 'citiesKnights+seafarers', 'explorersPirates', 'tradersBarbarians']);
-    const stale = resolveRuleset(enabledAll, { expansionKey: 'explorersPirates', scenarioKey: 'gone', playerCount: 9 });
-    expect(resolved.expansions.map((choice) => choice.key)).toEqual(['base', 'seafarers', 'citiesKnights', 'citiesKnights+seafarers', 'tradersBarbarians']);
```


### Blank-line differences

Signed blank lines were also compared by count per file. Their placement differs
where old E&P platform code was subsumed by release or adjacent sections were
joined; they do not change executable behavior. Counts below exclude this work
record itself, whose new lines document the integration.

| File | Original only | Merge only |
|---|---:|---:|
| `docs/API.md` | +1 | 0 |
| `docs/FIDELITY.md` | +1 | −1 |
| `docs/SPEC.md` | +1 | 0 |
| `packages/rules/src/engine.ts` | +10 | 0 |
| `packages/rules/src/modules/types.ts` | +1 | 0 |
| `packages/rules/src/profiles.ts` | +1 | 0 |
| `packages/server/test/rooms.test.ts` | 0 | −1 |
| `packages/web/src/components/SvgBoard.tsx` | 0 | −1 |
| `packages/web/src/state/actions.ts` | +1 | 0 |
| `packages/web/src/state/table.ts` | 0 | +1 |
| `packages/web/test/dice-hold.test.tsx` | 0 | +1 |

### Changed-line ordering

The following compares the relative order of signed lines common to both deltas; the prefixes inside the block are unified-diff markers followed by the original signed line. Differences can arise where an equivalent line occurs multiple times as well as from moved lines.

#### `packages/rules/src/engine.ts`

The response occurs after revision because revision clears consent; the original insufficient consent is now rejected.

```diff
--- original
+++ merge
@@ -1,5 +1 @@
-+  const modules = modulesOf(state);
-+  const ctx = viewContext(state);
-+}
-+  }
 +  const veto = moduleVeto(next, actorId, command as ModuleCommand);
@@ -8,3 +4,5 @@
 +function moduleVeto(state: GameState, actorId: string, command: ModuleCommand): CommandOutcome | undefined {
++  const modules = modulesOf(state);
 +  if (modules.length === 0) return undefined;
++  const ctx = viewContext(state);
 +  for (const module of modules) {
@@ -12,2 +10,4 @@
 +    if (veto) return veto;
++  }
 +  return undefined;
++}
```

#### `packages/rules/test/ep-clauses.test.ts`

The added loop contains repeated closing braces; matching those lines accounts for the apparent relocation.

```diff
--- original
+++ merge
@@ -705,5 +705,5 @@
 +    const second = state.offers.at(-1)!.id;
-+    state = run(state, 'p2', { type: 'trade.respond', offerId: second, response: 'consented' }).state;
 +    // Revising to an affordable amount settles.
 +    state = run(state, 'p1', { type: 'trade.revise', offerId: second, give: { lumber: 1 }, want: {}, wantGoods: { gold: 3 } }).state;
++    state = run(state, 'p2', { type: 'trade.respond', offerId: second, response: 'consented' }).state;
 +    state = run(state, 'p1', { type: 'trade.settle', offerId: second, counterparty: 'p2' }).state;
```

#### `packages/server/test/explorers-pirates.test.ts`

Shared platform and test changes were integrated around release code; repeated identical lines may also align differently.

```diff
--- original
+++ merge
@@ -58,2 +58,4 @@
 +    const host = await harness.client('EpBots');
++      }));
++    }
 +  });
@@ -129,3 +131,2 @@
 +        commandId: 'pirate-after-restart', expectedRevision: mine.revision, command: { type: 'ep.placePirate', hex },
-+      }));
 +      expect(receipt.outcome).toBe('accepted');
@@ -135,3 +136,2 @@
 +      rmSync(local.dataDir, { recursive: true, force: true });
-+    }
 +  });
```

### Follow-up verification and board-hook fix

Inspection found that `ep.moveShip` only notified `afterBoardChange` when it
revealed fog; ordinary movement also changes the E&P board. Successful
`ep.chase` removes the pirate, and `ep.placePirate` places it, but neither
notified the hook. A separate follow-up changes these operations to notify once
per board-changing command, after mutation and before pending continuation;
failed chases do not notify. `ep-hooks.test.ts` covers ordinary movement,
exploration, lair capture, missed/successful chase and pirate placement. Lair
capture and exploration already notify through their existing paths.

`ep-trade-integration.test.ts` exercises insufficient E&P gold at offer,
revision and consent by both parties. `ep-transport-privacy.test.ts` checks
pirate theft through the actor receipt and replay, HTTP snapshots, WebSocket
snapshots and event history for actor, victim and bystander. It also checks
that internal pools and lair-token arrays do not appear in the module view.
Existing `ep-privacy.test.ts` covers fog identities before exploration and
recovery of draws. The generic actor-projected receipt is retained from release.

### Post-merge changed lines

The merge comparison above is based on `b0a52c6`. The following complete follow-up patch is the additional difference in `6c95dd5`: movement and pirate changes notify the shared hook, while the three new test files cover hook counts, trade checks and transport privacy. These are the only post-merge product and test changes.

```diff
diff --git a/packages/rules/src/modules/explorersPirates/movement.ts b/packages/rules/src/modules/explorersPirates/movement.ts
index 21fe757..b1ce3e0 100644
--- a/packages/rules/src/modules/explorersPirates/movement.ts
+++ b/packages/rules/src/modules/explorersPirates/movement.ts
@@ -147 +146,0 @@ export function moveShip(state: GameState, actorId: string, command: ModuleComma
-    ctx.kit.afterBoardChange(state);
@@ -148,0 +148 @@ export function moveShip(state: GameState, actorId: string, command: ModuleComma
+  ctx.kit.afterBoardChange(state);
diff --git a/packages/rules/src/modules/explorersPirates/pirate.ts b/packages/rules/src/modules/explorersPirates/pirate.ts
index 2ba7d20..9adff19 100644
--- a/packages/rules/src/modules/explorersPirates/pirate.ts
+++ b/packages/rules/src/modules/explorersPirates/pirate.ts
@@ -92,0 +93 @@ export function placePirate(state: GameState, actorId: string, command: ModuleCo
+  ctx.kit.afterBoardChange(state);
@@ -187,0 +189 @@ export function chasePirate(state: GameState, actorId: string, command: ModuleCo
+    ctx.kit.afterBoardChange(state);
diff --git a/packages/rules/test/ep-hooks.test.ts b/packages/rules/test/ep-hooks.test.ts
new file mode 100644
index 0000000..8cc3c5b
--- /dev/null
+++ b/packages/rules/test/ep-hooks.test.ts
@@ -0,0 +1,69 @@
+import { describe, expect, it } from 'vitest';
+import { topologyOf } from '../src/analysis.ts';
+import { registerRulesModule } from '../src/modules/registry.ts';
+import { fogAtEnds } from '../src/modules/explorersPirates/geometry.ts';
+import { epState } from '../src/modules/explorersPirates/state.ts';
+import { registerFixtureProfile, requireProfile } from '../src/profiles.ts';
+import { epHints, epPlayable } from './ep-sim.ts';
+import { exploringPair, run, shipOf } from './ep-helpers.ts';
+import { scriptedRng } from './helpers.ts';
+
+const observed: (number | null)[] = [];
+registerRulesModule({ id: 'ep-observer', afterBoardChange(state) { observed.push(epState(state).pirate?.hex ?? null); } });
+const profile = requireProfile('ep-pirate-lairs-2025');
+registerFixtureProfile('fixture-ep-hooks', [3, 4], { ...profile, id: 'fixture-ep-hooks', ruleModules: ['explorersPirates', 'ep-observer'] });
+
+describe('E&P board-change hooks', () => {
+  it('notifies once when a captured lair receives its number', () => {
+    const state = epPlayable('pirate-lairs', 3);
+    state.profileId = 'fixture-ep-hooks';
+    const slot = epState(state);
+    const hex = slot.fog.shift()!.hex;
+    state.board.layout.terrain[hex] = 'gold';
+    slot.sites.push({ hex, kind: 'lair', crews: ['p1', 'p2', 'p3'], captured: false });
+    slot.captures.push(hex);
+    observed.length = 0;
+    const result = run(state, 'p1', { type: 'turn.end' }, scriptedRng([5, 0, 0, 0]));
+    expect(observed).toEqual([null]);
+    expect(result.state.board.layout.numbers[hex]).not.toBeNull();
+  });
+
+  it('observes one notification per ship move, including exploration', () => {
+    let state = epPlayable('pirate-lairs', 3);
+    state.profileId = 'fixture-ep-hooks';
+    const ship = shipOf(state, 'p1');
+    const { from, to } = exploringPair(state);
+    ship.edge = from;
+    state = run(state, 'p1', { type: 'ep.startMovement' }).state;
+    const plain = epHints(state, 'p1').ships.find((entry) => entry.id === ship.id)!.steps.find((step) => !step.explores && !step.full);
+    expect(plain).toBeDefined();
+    observed.length = 0;
+    const moved = run(state, 'p1', { type: 'ep.moveShip', ship: ship.id, edge: plain!.edge }).state;
+    expect(observed).toEqual([null]);
+    expect(fogAtEnds(state, to)).toHaveLength(1);
+    observed.length = 0;
+    const explored = run(state, 'p1', { type: 'ep.moveShip', ship: ship.id, edge: to }, scriptedRng([0, 0, 0])).state;
+    expect(observed).toEqual([null]);
+    expect(epState(explored).fog.length).toBeLessThan(epState(state).fog.length);
+    expect(epState(moved).ships.find((entry) => entry.id === ship.id)?.edge).toBe(plain!.edge);
+  });
+
+  it('observes successful chase and placement once each, before continuation', () => {
+    let state = epPlayable('pirate-lairs', 3);
+    state.profileId = 'fixture-ep-hooks';
+    const ship = shipOf(state, 'p1');
+    const hex = topologyOf(state).edges[ship.edge]!.hexes.find((cell) => state.board.layout.terrain[cell] === 'sea')!;
+    epState(state).pirate = { hex, owner: 'p2' };
+    state = run(state, 'p1', { type: 'ep.startMovement' }).state;
+    observed.length = 0;
+    const missed = run(state, 'p1', { type: 'ep.chase', ship: ship.id }, scriptedRng([4]));
+    expect(observed).toEqual([]);
+    expect(epState(missed.state).pirate?.hex).toBe(hex);
+    state = run(state, 'p1', { type: 'ep.chase', ship: ship.id }, scriptedRng([5])).state;
+    expect(observed).toEqual([null]);
+    const target = epHints(state, 'p1').pirateTargets[0]!;
+    state = run(state, 'p1', { type: 'ep.placePirate', hex: target }).state;
+    expect(observed).toEqual([null, target]);
+    expect(epState(state).pirate?.hex).toBe(target);
+  });
+});
diff --git a/packages/rules/test/ep-trade-integration.test.ts b/packages/rules/test/ep-trade-integration.test.ts
new file mode 100644
index 0000000..20d40e3
--- /dev/null
+++ b/packages/rules/test/ep-trade-integration.test.ts
@@ -0,0 +1,22 @@
+import { describe, expect, it } from 'vitest';
+import { epState, landHo, refused, run } from './ep-helpers.ts';
+import { setHand } from './helpers.ts';
+
+describe('E&P goods trade integration', () => {
+  it('checks the proposer at offer and revision and both parties at consent', () => {
+    let state = landHo();
+    setHand(state, 'p1', { lumber: 2 });
+    setHand(state, 'p2', { ore: 1 });
+    epState(state).gold.p1 = 1;
+    epState(state).gold.p2 = 1;
+    expect(refused(state, 'p1', { type: 'trade.offer', to: 'p2', give: {}, giveGoods: { gold: 2 }, want: { ore: 1 } })).toBe('E_INSUFFICIENT_RESOURCES');
+    state = run(state, 'p1', { type: 'trade.offer', to: 'p2', give: {}, giveGoods: { gold: 1 }, want: { ore: 1 } }).state;
+    const offerId = state.offers.at(-1)!.id;
+    expect(refused(state, 'p1', { type: 'trade.revise', offerId, give: {}, giveGoods: { gold: 2 }, want: { ore: 1 } })).toBe('E_INSUFFICIENT_RESOURCES');
+    state = run(state, 'p1', { type: 'trade.revise', offerId, give: { lumber: 1 }, want: {}, wantGoods: { gold: 2 } }).state;
+    expect(refused(state, 'p2', { type: 'trade.respond', offerId, response: 'consented' })).toBe('E_INSUFFICIENT_RESOURCES');
+    state = run(state, 'p1', { type: 'trade.revise', offerId, give: {}, giveGoods: { gold: 1 }, want: { ore: 1 } }).state;
+    epState(state).gold.p1 = 0;
+    expect(refused(state, 'p2', { type: 'trade.respond', offerId, response: 'consented' })).toBe('E_INSUFFICIENT_RESOURCES');
+  });
+});
diff --git a/packages/server/test/ep-transport-privacy.test.ts b/packages/server/test/ep-transport-privacy.test.ts
new file mode 100644
index 0000000..9dad70a
--- /dev/null
+++ b/packages/server/test/ep-transport-privacy.test.ts
@@ -0,0 +1,64 @@
+import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
+import { WebSocket } from 'ws';
+import type { GameState } from '@catan/rules';
+import type { CommandReceipt, GameSnapshot, ServerMessage } from '@catan/protocol';
+import { startHarness, startedGame, type TestClient, type TestHarness } from './helpers.ts';
+
+let harness: TestHarness;
+beforeAll(async () => { harness = await startHarness(); });
+afterAll(async () => { await harness.close(); });
+
+async function subscribe(client: TestClient, roomId: string) {
+  const socket = new WebSocket(`${harness.base.replace('http', 'ws')}/ws`, { headers: { cookie: client.cookie! } });
+  const snapshots: GameSnapshot[] = [];
+  socket.on('message', (data) => {
+    const message = JSON.parse(data.toString()) as ServerMessage;
+    if (message.type === 'snapshot') snapshots.push(message.payload);
+  });
+  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
+  socket.send(JSON.stringify({ type: 'subscribe', payload: { roomId } }));
+  await vi.waitFor(() => expect(snapshots.length).toBeGreaterThan(0));
+  return { socket, snapshots };
+}
+
+describe('E&P transport privacy', () => {
+  it('projects pirate theft privately in receipts, snapshots, websocket and event history', async () => {
+    const { clients, roomId, gameId } = await startedGame(harness, 3, { profileId: 'ep-pirate-lairs-2025' });
+    const row = (await harness.service.repo.findGame(gameId))!;
+    const state = JSON.parse(row.state_json) as GameState;
+    const actor = clients.find((client) => client.playerId === state.players[state.turn.seat]!.id)!;
+    const victim = clients.find((client) => client !== actor)!;
+    const outsider = clients.find((client) => client !== actor && client !== victim)!;
+    state.turn.phase = 'action';
+    state.turn.setup = null;
+    for (const player of state.players) for (const resource of Object.keys(player.resources) as (keyof typeof player.resources)[]) player.resources[resource] = 0;
+    state.players.find((player) => player.id === victim.playerId)!.resources.ore = 1;
+    state.pending = { kind: 'explorersPirates.pirate', module: 'explorersPirates', responders: [actor.playerId!], data: { stage: 'rob', cause: 'seven', candidates: [victim.playerId!] } };
+    await harness.service.repo.saveGame(gameId, state, row.revision, 'playing', null);
+    const feeds = await Promise.all(clients.map((client) => subscribe(client, roomId)));
+    try {
+      const body = { commandId: 'ep-private-theft', expectedRevision: row.revision, command: { type: 'ep.robPlayer', victim: victim.playerId } };
+      const receipt = actor.expectOk<CommandReceipt>(await actor.post(`/api/games/${gameId}/commands`, body));
+      expect(receipt.outcome).toBe('accepted');
+      expect(receipt.events.find((event) => event.type === 'ep.pirateStole')?.params.resource).toBe('ore');
+      expect(receipt.events.every((event) => event.private === undefined)).toBe(true);
+      expect(actor.expectOk<CommandReceipt>(await actor.post(`/api/games/${gameId}/commands`, body))).toEqual(receipt);
+      await vi.waitFor(() => { for (const feed of feeds) expect(feed.snapshots.at(-1)?.revision).toBe(receipt.revision); });
+      for (const client of clients) {
+        const http = client.expectOk<GameSnapshot>(await client.get(`/api/games/${gameId}`));
+        const ws = feeds[clients.indexOf(client)]!.snapshots.at(-1)!;
+        for (const snapshot of [http, ws]) {
+          const event = snapshot.view.events.find((entry) => entry.type === 'ep.pirateStole')!;
+          if (client === outsider) expect(event.params).not.toHaveProperty('resource');
+          else expect(event.params.resource).toBe('ore');
+          expect(snapshot.view.modules?.explorersPirates).not.toHaveProperty('pools');
+          expect(snapshot.view.modules?.explorersPirates).not.toHaveProperty('lairTokens');
+        }
+        const history = client.expectOk<{ events: CommandReceipt['events'] }>(await client.get(`/api/games/${gameId}/events?after=0`));
+        const event = history.events.find((entry) => entry.type === 'ep.pirateStole');
+        if (client === outsider) expect(event).toBeUndefined();
+        else expect(event?.params.resource).toBe('ore');
+      }
+    } finally { for (const feed of feeds) feed.socket.close(); }
+  });
+});
```
