# Traders & Barbarians (P5)

Advisory work record for phase P5 of
[the expansions roadmap](../plans/2026-11-01-expansions-roadmap.md). Branch
`feat/traders-barbarians` from `feat/expansion-platform` @ `161eb1a`, developed
in parallel with the Seafarers branch on the same base. Scope: base board,
3–4 players, the 2025 Traders & Barbarians variants and five scenarios.

This record starts with the source transcription (what the rulebook says,
with page references) so the research survives interruptions; the
implementation, fixture map and verification sections are filled in as the
slices land. The transcription is a paraphrase for implementation, not a copy
of rule or card text.

## Source

| Id | Edition | Publication id | File | SHA-256 | Accessed |
|---|---|---|---|---|---|
| TB25 | CATAN – Traders & Barbarians Expansion, 2025 English rulebook (6th edition), page footers `v6.250701` | CN3089 | [`CN3089 CATAN – T&B Rulebook.pdf`](https://www.catan.com/sites/default/files/2025-04/CN3089%20CATAN%20%E2%80%93%20T%26B%20Rulebook.pdf), 24 pages, 27,843,748 bytes, PDF created 2025-03-10 | `7c4938dc45480ed28fde1fccbeca450c815b36ee2f4ed57107650013313acaaf` | 2026-11-01 |

Read page by page (text extraction plus rendered page images for every map,
component and example). Pages: 2–3 components, 4 Friendly Robber and Harbors
of Catan, 4–6 Event Cards, 7–8 Catan for Two, 9–10 Fishing on Catan, 11–12
Rivers of Catan, 13–14 Merchant Trains, 15–19 Barbarian Attack, 20–24 Traders
& Barbarians.

Out of scope and not read for this phase: the T&B 5–6 rulebook (CN3090) and
the official combination PDFs listed on
[catan.com/traders-barbarians](https://www.catan.com/traders-barbarians).

## Transcription

Base rules (B25) apply except where a variant or scenario says otherwise.
Coordinates are axial `(q, r)` on the base 19-hex board (`hex-r2`), pointy
top, `r = -2` the top row; hex sides use `NEIGHBOR_DIRS` order (0 right,
1 upper right, 2 upper left, 3 left, 4 lower left, 5 lower right).

### Variants (pp. 4–8)

The four variants can be used individually or combined with each other and
with the five scenarios (p. 2).

- **The Friendly Robber** (p. 4). When activating the robber you may not move
  it to a hex with a building of a player who only has 2 VP. If no hex is
  valid, move it to the desert and steal 1 random card from a player with an
  adjacent building who has more than 2 VP. Combines with all T&B variants and
  scenarios without changes.
- **Harbors of Catan** (p. 4). One Strongest Ports tile, worth 2 VP: the first
  player with 3 VP in buildings on ports takes it; a player with more VP in
  buildings on ports takes it immediately. Victory at 11 VP. Combined with
  other CATAN products: +1 VP to that target.
- **CATAN Event Cards** (pp. 4–6). 37 cards: 36 events plus New Year. Deck:
  set New Year aside, shuffle 36, deal 5 face down, New Year on top of them,
  the remaining cards on top. Instead of rolling, reveal the top card, resolve
  its event, then produce or resolve a 7 by the card's number disc; New Year
  rebuilds the deck and reveals the next card. Events: A Beautiful Day (none),
  Calm Seas (most buildings on ports take 1 resource of choice), Conflict
  (Largest Army holder steals 1 random resource; else the unique player with
  most Knight cards may), Earthquake (each player damages one own road; no new
  roads until all repaired for 1 brick + 1 lumber each; no settlement next to
  a damaged road; still counts for Longest Route), Epidemic (cities produce 1),
  Good Neighbors (each gives 1 resource of choice to the left), Helpful
  Neighbor (player(s) with most VP give 1 resource to a player with fewer),
  New Year, Plentiful Year (each takes 1 resource of choice), Robber Attacks
  (resolve a 7), Robber Flees (robber to a desert, no steal; no desert → off
  the board), Tournament (most face-up Knight cards take 1 resource of choice),
  Trade Advantage (Longest Route holder steals 1 random resource).
  **Open:** the rulebook does not list how many cards carry each event nor the
  number disc printed on each card; the deck composition cannot be
  transcribed from TB25. Scenario overrides: Barbarian Attack p. 19 (Conflict:
  unique player with most knights on the board steals; Robber Attacks: discard
  then steal; Robber Flees: no effect), Traders & Barbarians p. 24
  (Earthquake: 2 MP to move along a damaged road; Robber Attacks: the
  scenario's 7; Robber Flees: no effect).
- **Catan for Two** (pp. 7–8): two players with two neutral players and trade
  tokens. Out of scope (2-player mode deferred).

### Fishing on Catan (pp. 9–10)

- Components: 6 fishing ground tiles numbered 4, 5, 6, 8, 9, 10; 1 lake hex
  showing 2, 3, 11, 12; 29 fish tokens (11 × one fish, 10 × two, 8 × three);
  1 old boot token; 4 player aids.
- Setup: variable setup; the lake replaces the desert. The lake and 6 random
  hexes fill the inner 7 positions (centre and first ring); the remaining 12
  hexes form the outer ring. A random fishing ground goes on each of the six
  marked frame "V" positions. Reading the printed map, each V sits in a
  coastal valley (a coast intersection shared by two outer hexes) and covers
  the two coastal edges meeting there: `(0,-2)|(1,-2)`, `(2,-1)|(2,0)`,
  `(2,0)|(1,1)`, `(-2,2)|(-1,2)`, `(-2,1)|(-2,2)`, `(-1,-1)|(0,-2)` (mirror
  symmetric about the horizontal axis). A ground therefore touches three
  intersections. Fish tokens and the old boot are mixed face down as the
  supply. The robber starts beside the board and enters on a 7 or a Knight. A
  second setup settlement adjacent to a fishing ground or the lake also takes
  one random fish token.
- Production: fishing grounds and the lake produce on their numbers; a
  settlement draws 1 token, a city 2. Starting with the active player and
  going clockwise, each receiving player draws one token at a time. The old
  boot is revealed face up when drawn; fish tokens stay secret. When the
  supply is empty the face-up discard pile is shuffled into a new supply.
- Limit: at most 7 fish tokens (boot excluded). Once per turn, a player at 7
  who would receive more may discard 1 token and draw a replacement, then
  stops drawing.
- Old boot: during your turn you may give it to a player with the same or more
  VP (hidden VP cards excluded). Its holder needs 1 more VP to win.
- Robber: may stand on the lake (blocking all four numbers); never on a
  fishing ground.
- Spending (during your turn, any number of actions, each paid in full,
  excess lost, tokens to the face-up discard): 2 remove the robber from the
  board (it returns on a 7 or Knight); 3 steal a random resource from another
  player; 4 take a resource of choice from the supply; 5 build a road free;
  7 build a development card free.
- Fish are not resource cards: they do not count on a 7, cannot be stolen by
  the robber and cannot be traded.
- Victory: 10 VP, 11 with the old boot.

### Rivers of Catan (pp. 11–12)

- Components: two river tiles (a four-hex and a three-hex river), 1 Wealthiest
  Catanian tile (+1 VP), 4 Poor Catanian tiles (−2 VP), 40 coins (15 × 5 gold,
  25 × 1 gold = 100 gold), 12 bridges (3 per colour), 4 player aids.
- Setup: return 2 hills, 2 pastures, 2 mountains and the desert. River tiles
  as printed: four-hex river mountains `(-1,-1)`, hills `(-1,0)`, pasture
  `(-1,1)`, swamp `(-1,2)`; three-hex river mountains `(1,-1)`, hills `(1,0)`,
  swamp `(1,1)`. The other 12 hexes (4 forest, 2 pasture, 4 fields, 1 hills,
  1 mountains) are random. Number discs: set aside the 2, place the rest as
  normal from a corner skipping the swamps, then put the 2 on the 12 hex (it
  produces on 2 and 12). Robber on either swamp. Each player takes 3 bridges,
  an aid and a Poor Catanian tile.
- Bridge sites: where the river crosses or meets an edge. From the tile art:
  four-hex river at mountains|hills, hills|pasture, pasture|swamp and the
  swamp's lower-left coast; three-hex river at mountains|hills, hills|swamp
  and the swamp's right coast — 7 sites. Roads may never be built on bridge
  sites (setup included).
- Bridges: cost 2 brick + 1 lumber, 0 VP, built on an empty site connected to
  your road or building, not past an opponent's building, not with Road
  Building; count as roads for Longest Route.
- Gold: +1 for each settlement built on a river-tile intersection and each road
  built on a river-tile edge (setup included), +3 per bridge. Resources may be
  sold to the supply for 1 gold at 4:1 (3:1 or 2:1 with the port). 2 gold buy
  1 resource of choice, up to twice per turn. Coins may be used in trades with
  players; they do not count on a 7, cannot be stolen, and Monopoly cannot
  take them.
- Wealth: the unique player with most gold holds Wealthiest Catanian (tie: in
  the supply); every player with the least gold holds a Poor Catanian tile.
- Victory: 10 VP.

### Merchant Trains (pp. 13–14)

- Components: 22 trade wagons (neutral), 1 watering hole hex, 4 player aids.
- Setup: return the desert; the watering hole goes in the centre; the rest is
  random. Wagons and the robber beside the board (robber enters on a 7 or
  Knight).
- A player who builds any number of buildings in their Action phase collects
  one wagon, placed in a voting round at the end of the turn.
- Voting round: from the active player clockwise, each player may bid any
  number of wool and/or grain face up (at least 1 to take part); one card is
  one vote. A player with a majority of votes places the wagon. Otherwise
  every bidder assigns all their votes to one location: (1) a unique
  most-voted location gets the wagon; (2) else the unique top bidder places
  it; (3) else the active player places it, even without a bid. All bids
  return to the supply.
- Trains: start at three locations on the watering hole — the outward edges
  at its upper-left, upper-right and bottom intersections, facing away from
  the hex. Wagons go on edges without a wagon (roads allowed), start a new
  train or extend a train's front nose to tail; trains never branch; trains
  merge when they meet at an intersection; a train ends when it cannot be
  extended or the supply is empty.
- Points: a wagon on the same edge as a road counts as an additional road for
  Longest Route; each building between 2 wagons is worth +1 VP.
- Victory: 12 VP.

### Barbarian Attack (pp. 15–19)

- Components: 24 knights (6 per colour), 36 barbarians, 40 coins, 1 castle
  hex, 26 development cards (4 Capture, 14 Knighthood, 4 Swift Knight,
  4 Treason), 4 player aids.
- Setup: return 1 forest, one 11 disc, the development cards, Largest Army and
  the robber. Castle at `(-2,2)`, desert at `(2,-2)`. The 10 other coastal
  hexes take 2 hills, 2 forests, 3 pastures, 2 fields, 1 mountain at random;
  the 7 inner hexes take 1 hill, 1 forest, 1 pasture, 2 fields, 2 mountains
  at random. Printed numbers: `(0,-2)` 3, `(1,-2)` 8, `(-1,-1)` 9, `(0,-1)` 4,
  `(1,-1)` 5, `(2,-1)` 10, `(-2,0)` 12, `(-1,0)` 6, `(0,0)` 10, `(1,0)` 8,
  `(2,0)` 11, `(-2,1)` 4, `(-1,1)` 9, `(0,1)` 3, `(1,1)` 5, `(-1,2)` 6,
  `(0,2)` 2 (each coastal number 2–12 except 7 occurs once). One barbarian on
  the 2 hex and one on the 12 hex. Second setup placement is a city taking 1
  resource per adjacent hex.
- 7: no production, discard as normal, then steal 1 random resource from a
  player of your choice.
- Coins as in Rivers (without wealth tiles).
- Barbarian attack after every building placed: roll until not 7; the coastal
  hex with that number receives 1 barbarian if it has fewer than 3; repeat for
  a second and third result different from the earlier ones while barbarians
  remain in the supply. Three barbarians conquer a hex: it stops producing and
  nothing may be built on its edges or intersections. A building touching only
  conquered hexes and the frame is conquered: 0 VP, its ports unusable.
- Development cards are played immediately when built, then discarded;
  reshuffle the discards when the deck is empty. Capture: remove a barbarian
  from a coastal hex into your prisoners (none: draw again); Knighthood: knight
  on an empty castle edge; Swift Knight: knight on any edge without a knight;
  Treason: take 2 gold and move 2 barbarians from two different coastal hexes
  to two other unconquered coastal hexes (missing barbarians from the supply).
  Removing a barbarian from a conquered hex liberates it.
- End of turn: move knights (each up to 3 edges, 5 for 1 grain per knight;
  knights ignore pieces while moving, end on an edge without a knight, never
  end on a castle edge; a knight on a castle edge must move), then expel the
  barbarians: from the 4 hex next to the castle clockwise, a hex is won when it
  has a barbarian and more knights on its edges than barbarians. Prisoners go
  to the involved players: a single player takes all; several take one each,
  a remaining one goes to the player with most knights there (tie: dice, the
  loser takes 3 gold); too few prisoners: dice order, those without a prisoner
  take 3 gold. Two prisoners are 1 VP. The hex is liberated. Then one die
  picks an edge orientation of the castle (1/6, 2/5, 3/4); involved knights on
  edges of that orientation return to their owners for 3 gold each.
- Victory: 12 VP.

### Traders & Barbarians (pp. 20–24)

- Components: 3 commodity hexes (quarry, glassworks, castle), 4 wagon boards,
  4 cubes, 3 barbarians, 36 commodity tokens, 9 X markers, 4 wagons (one per
  colour), 40 coins, 25 development cards (16 Knight, 3 Road Building,
  3 Swift Journey, 3 Victory Point), 4 player aids.
- Commodity tokens (p. 3): 12 per site, by site: quarry 6 marble + 6 sand,
  glassworks 6 glass + 6 tools, castle 6 sand + 6 tools. The quarry needs
  tools, the glassworks needs sand, the castle needs marble and glass.
- Setup: return 1 pasture, 1 field, the desert, the 2 and 12 discs, the
  development cards, Longest Road and the robber. Quarry at `(2,-2)`, castle at
  `(-2,0)`, glassworks at `(0,2)`, their path-less sides (the three coastal
  edges, each with an X marker) against the frame. Each commodity hex has four
  interior paths from its centre plaza to the two intersections at the ends of
  the coastal run and the two inland intersections. Barbarians on the edges
  `(1,-2)|(1,-1)`, `(-1,0)|(-2,1)` and `(0,1)|(1,1)`. Numbers as normal
  without 2 and 12, skipping the commodity hexes. Each player: 5 gold, a wagon
  board with the cube on level 1, a wagon on the intersection of their city.
  Second setup placement is a city taking 1 resource per adjacent hex.
- Rolls of 2 or 12 are rerolled. 7: discard, then move 1 barbarian to an edge
  without a barbarian; on a road, steal 1 random resource from its owner.
- Roads may be built on barbarian edges and interior paths, never on X edges;
  no settlement on a centre plaza. Coins as in Barbarian Attack.
- Wagon board levels 1–5: movement 4/5/6/7/7 MP; drive-off die ranges none,
  6, 5–6, 4–6, 3–6; delivery value 1–5 gold. Upgrades: 1→2 and 2→3 cost lumber,
  wool, ore; 3→4 and 4→5 cost 2 lumber, wool, ore; the fourth upgrade is +1 VP.
- End of turn: move the wagon from intersection to intersection: 2 MP without
  a road, 1 MP on your road, 1 MP + 1 gold paid to the owner on another
  player's road, +2 MP with a barbarian; once per turn 1 grain gives +2 MP;
  whole edges only; unused MP are lost. Entering a centre plaza ends the move;
  a wanted token is delivered (face down, 1 VP, gold by level), then a token
  is drawn face up from that site's stack if the wagon is empty (carry one).
  Drive off: stop at an intersection next to a barbarian, roll 1 die, in range
  → move it to any edge without a barbarian (no steal); once per barbarian per
  turn.
- Development cards: Knight moves a barbarian (road → steal from its owner);
  Road Building builds 2 free roads; Swift Journey repeats the wagon move
  action this turn; Victory Point cards as in the base game.
- Victory: 13 VP.

## Implementation notes

| Area | Files | Notes |
|---|---|---|
| Platform hooks | `packages/rules/src/modules/types.ts`, `engine.ts`, `analysis.ts`, `topology.ts`, `project.ts` | additive hooks and board data listed in the roadmap's P5 note; `legalRobberHexes`, `victoryTargetOf`; base digests unchanged |
| Base fix | `engine.ts` | Road Building with no road pieces left no longer leaves an unresolvable `freeRoads` frame (found by the T&B simulations) |
| Composite module | `modules/tradersBarbarians/{index,part,state,messages}.ts` | parts per variant/scenario, frames `tradersBarbarians.<step>`, root hints `targets` / `board` / `robberHexes` |
| Variants | `variants/friendlyRobber.ts`, `variants/harbors.ts` | `robberTargets` + `stealCandidates`; Strongest Ports award via `afterBuild` |
| Boards | `frame.ts`, `boards.ts`, `*/board.ts` | printed frame `tb-r2`, scenario layouts, `tb-traders-r2` with interior paths |
| Fishing | `fishing/` | grounds, lake, face-down token supply with refill, swap frame, boot, fish actions |
| Coins | `coins/` | 100-gold supply, buy/sell, `tradeGoods` gold in offers (Rivers, BA, T&B) |
| Rivers | `rivers/` | bridge sites, bridges (`RoadRef.bridge`), river gold, wealth tiles derived from gold |
| Merchant Trains | `trains/` | wagon collection, end-of-turn voting frames (bid → assign → place), trains, route weights |
| Barbarian Attack | `barbarians/` | landing rolls, conquest, cards played on build, knight moves, expel with dice |
| Traders & Barbarians | `traders/` | sites/stacks, wagon board, end-of-turn wagon frame, drive-off, Knight / Swift Journey |
| Profiles | `profiles.ts` (`TRADERS_BARBARIANS_PROFILES`) | 12 rows; 8 enabled |
| Web | `packages/web/src/components/tb/`, `board/tb-rivers.ts`, `board/three/{tb-terrain.ts,TbScenePieces.tsx}`, `audio/tb-cues.ts`, `i18n/modules/tradersBarbarians.ts` | Scenario tool tab, prompt choices, SVG and 3D pieces, terrain emblems, five procedural cues, zh-Hant + en |
| Generic web | `board/intent.ts`, `state/table.ts` (`Selection.extra/field/targetsKey`), `TradePanel.tsx` (goods steppers), `GameTools.tsx`, `coastline.ts` (interior paths) | module board targets and choices without per-scenario code in shared components |
| Harness | `scripts/traders-barbarians/{fixtures.mjs,capture.py,patch.mjs,live.py}` | engine-projected fixtures for every scenario (SVG/3D × desktop/phone, panel); `capture.py --live` games to the first turn; `live.py` plays each enabled profile's own action through the UI in SVG and 3D against the built service (see Review fixes) |

Interpretations and open items are listed in FIDELITY (Traders & Barbarians).

## Verification

`SMOKE_PORT=3451 PORT=3051 pnpm verify` (exit 0):

- typecheck: all four packages
- rules 25 files / 246 tests; protocol 1 / 8; server 11 / 108 passed, 11
  skipped (PostgreSQL contract replay, no `TEST_POSTGRES_URL`); web 60 / 570
- build: web + server bundles; smoke 13/13; test:dev 1/1

Captures: `pnpm build && python3 scripts/traders-barbarians/capture.py --out
test-results/tb-final-1 --live` — 30 cases PASS (5 scenarios × SVG/3D ×
desktop/phone, 5 panels, 5 live games); curated in
[`docs/screenshots/traders-barbarians`](../../screenshots/traders-barbarians/README.md).

Base compatibility: `base-regression.test.ts` digests (topologies, layouts,
created snapshots, five simulated base games) still match.

## Review fixes

Review `review-tb` (PR #62 @ `bcb4295`) found three defects and a list of
untested clauses; the T&B live harness also had to go beyond the first turn.
Head after the fixes: see the PR.

1. **Merchant Trains merge** (`trains/index.ts`, TB25 p. 14, fig. 1 and 2).
   `wagonLocations` ended a train whenever its front touched another wagon,
   so two meeting fronts never merged. Now a front that touches another
   train's body or tail has run into it and ends (fig. 1); two fronts meeting
   at one intersection merge and the merged train continues along the
   remaining free edge, which joins the lower-numbered train (fig. 2); a front
   with no free edge left cannot be extended. Fixtures `MT8`–`MT10`;
   FIDELITY states the interpretation.
2. **Drive-off once per barbarian** (`traders/index.ts`, p. 23): `drivenOff`
   now holds the barbarian's index in `slot.barbarians` (relocation keeps it)
   instead of edge ids, so a barbarian driven to another edge cannot be tried
   again. Fixture `TR11b`; the hint also lists untried barbarians only.
3. **Simulations**: all T&B simulated-game tests run with
   `SIMULATION_TIMEOUT` (30 s, `tb-helpers.ts`).
4. **Clause fixtures**: every clause on the review list now has a fixture
   with its page, start state, window, command and expected result
   (`FI14`–`FI21`, `RV9`–`RV19`, `MT8`–`MT15`, `BA13`–`BA23`, `TR11b`,
   `TR12`–`TR18`, `FRHB1`–`FRHB2`); clauses already covered by older fixtures
   are named in FIDELITY. The new fixtures exposed one engine defect (the
   train merge above) and no other. FIDELITY lists what stays untested.
5. **Bots**: `traders-barbarians.test.ts` checks that every enabled `tb-*`
   profile is listed without bot seats and refuses bots at room creation,
   when adding a bot and when switching a bot room to the profile.
6. **Live harness** (`scripts/traders-barbarians/live.py`, `patch.mjs`): for
   each of the eight enabled profiles and for SVG and 3D, a fresh built
   service on its own port, a real three-guest room whose setup is played over
   the API, one test-only fixture patch of the persisted snapshot (computed by
   `patch.mjs` from the rules package) and then the profile's action through
   the UI only, asserted against the service's projection:
   Friendly Robber — robber moves past guarded hexes (no target on a
   protected hex); Harbors — city upgrade awards Strongest Ports; combined —
   robbing the holder of Strongest Ports (protection lifted) incl. the steal
   prompt; Fishing — spend 4 fish for a resource; Rivers — build a bridge
   (+3 gold); Merchant Trains — end turn, pass the bid, place the wagon;
   Barbarian Attack — build a card (Capture), then move the castle knight and
   finish the turn; Traders & Barbarians — end turn and deliver a commodity.
   16 live cases PASS (ports 3052–3059, Chromium with software WebGL), none
   of the profiles had to be disabled: every action was reachable and worked
   in both renderers.
7. The curated captures are unchanged (no visual change).

Verification after the fixes: `SMOKE_PORT=3451 PORT=3051 VITE_PORT=5251 pnpm
verify` (exit 0): rules 26 files / 315 tests; protocol 8; bots 45; server 161
passed, 15 skipped (PostgreSQL contract replay, no `TEST_POSTGRES_URL`); web
61 files / 598; build; smoke 13/13; test:dev 1/1. Live harness: `python3
scripts/traders-barbarians/live.py <new dir>` — 16 live cases and 44 captures
PASS.
