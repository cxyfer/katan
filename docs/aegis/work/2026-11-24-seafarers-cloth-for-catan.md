# Seafarers scenario S6: Cloth for Catan

Advisory work record for slice S6 of
[the scenarios spec](../specs/2026-11-22-seafarers-scenarios.md) (D2–D5, D7,
D9, **D12**; §3, §5.2–§5.4, §6.5, §7.1, §7.3–§7.5, §8, §10, §11 including
SFX-S6 and §11.3). Branch `feat/sfx-s6-cloth-for-catan`, stacked on S5
(`feat/sfx-s5-forgotten-tribe`, not merged yet) which sits on `release/v0.4.6`
(S0, S1, S2 and S4 merged; S3 is still in review and is not in this base).
Profile `sf-cloth-for-catan-2025` (3 and 4 players on one shared map, 14 VP or
the cloth ending, rule version `sf-2025.3`), enabled by this slice.

## Sources (accessed 2026-11-24)

| Id | Edition | Publication | File | SHA-256 | Pages used |
|---|---|---|---|---|---|
| SF25 | CATAN – Seafarers, 2025 (`v6.250401`) | CN3083 | `CN3083 CATAN–Seafarers Rulebook 2025 secured reduced.pdf` (20 pp.) | `a499abe2b613afd618dd3c806790400c7e84adebcc9b9ab19a24fb80dd04b099` (same file as `2026-11-01-seafarers.md`) | 2–3 (rules), 14–15 (Cloth for Catan: component table, setup, additional rules, victory, variable setup; the map is a two-page spread) |

Rendered pages (outside the repository, read as images): `p14.png`
`d67737770510e74b317f3e71948e4d4d3fe5f74fe958135f4353786b71e744cd`, `p15.png`
`dd6681fb965254cbd2169e5a2e1138d9ef8e37de3aadae148ccaa2b672607e15`.
The PDF is not in the repository and nothing downloaded was executed.

## Method

1. **Two independent transcriptions** (`s6-A.json`, `s6-B.json`, outside the
   repository; sha256 `a8562aa4…bdf` and `9d20811f…564`). Two transcribers,
   each seeing only the SF25 spread, transcribed the whole map: terrain,
   disc, island number, every sea hex, the outline rows and the two
   protrusions, the nine ports, the robber, the pirate and the eight tribe
   discs (the three hexes that meet at each disc's vertex). Neither saw the
   other's work.
2. **Comparison.** Field by field: land (terrain, disc), sea, outline rows,
   frame protrusions, the nine ports (hex, side, "?"), robber, pirate and the
   eight tribe vertices (hex triple and number) are **identical**. The only
   difference is the island numbering: A counts the north large island 1, the
   four small islands 2–5 and the south large island 6; B counts the two large
   islands 1 and 2 and the small islands 3–6. Both follow the brief's rule
   ("largest island is 1, the rest by topmost hex") because the two large
   islands are tied at 10 hexes; it is a naming difference, not a content
   difference, and no cell had to be re-read against the page. The repo uses
   A's numbers (large islands 1 and 6, small islands 2–5).
3. **Coordinates shifted once.** The transcription origin is "top row r = 0,
   leftmost cell of that row q = 0" (outline rows `[0,4] [-1,4] [-2,4] [-2,3]
   [-3,3] [-3,2] [-3,1]`, middle-row protrusions at (-3,3) and (4,3)). The
   repo outline `NS4_CELLS` (rows 5-6-7-6-7-6-5, middle row r = 0 with the two
   protrusions at (-3,0) and (4,0) excluded) lists exactly the same q range on
   each row, so the shift is **(dq, dr) = (0, -3)**: only `r` changes, applied
   once in `seafarers-scenario-boards.ts` (`CFC_SHIFT`). A test compares the
   transcribed row ranges with the topology. This record lists both
   coordinates.
4. **Frame.** 42 cells, rows 5-6-7-6-7-6-5 (repo coordinates: r = -3 q in
   [0, 4]; r = -2 [-1, 4]; r = -1 [-2, 4]; r = 0 [-2, 3]; r = 1 [-3, 3];
   r = 2 [-3, 2]; r = 3 [-3, 1]). The two hex-shaped protrusions at the ends
   of the middle row are frame, as for New Shores 4 (otherwise 44 cells and 20
   sea against the table's 42 and 18). One topology `sf-cloth-for-catan`
   (same hexes as `sf-new-shores-4`: 149 edges, 108 vertices, 46 frame inner
   edges; 9 harbor slots), shared by 3 and 4 players (SF25 has one map).
5. **Tribe discs are vertices.** Each is the vertex shared by the one-hex
   island and two sea hexes, above or below the island; the topology vertex is
   found from the hex triple (`tribeVertices`).
6. **Islands.** Island 1 is the north large island (10 hexes), 6 the south one
   (10 hexes); 2, 3, 4, 5 are single hexes (gold, desert, desert, gold)
   without discs.

## Checksums

| | Sea | Desert | Gold | Fields | Hills | Mountains | Pasture | Forest | Total |
|---|---|---|---|---|---|---|---|---|---|
| Table (p. 14; spec §6.5) | 18 | 2 | 2 | 5 | 3 | 4 | 4 | 4 | 42 |
| Transcription (both) | 18 | 2 | 2 | 5 | 3 | 4 | 4 | 4 | 42 |

| Discs | 2 | 3 | 4 | 5 | 6 | 8 | 9 | 10 | 11 | 12 | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Table (p. 14) | 2 | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 2 | 28 |
| On land (20 hexes, both) | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 20 |
| Tribe discs (8) | – | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | – | 8 |

Ports: 5×2:1 (one per resource) + 4×3:1 = 9 tokens for 9 positions, all drawn
as "?" (random kind, fixed position). Cloth: 8 tribes × 5 + 10 in the supply
pile = 50. Two large islands = 20 numbered hexes; four small islands = 4 hexes
without discs. `packages/rules/test/seafarers-cloth-for-catan.test.ts`
re-runs all of these on the real layout and compares every transcribed cell.

## Transcription (SF25 pp. 14–15)

Columns: transcription coordinate, repo coordinate, terrain, disc, island.

| (q, r) as transcribed | (q, r) in the repo | Terrain | Disc | Island |
|---|---|---|---|---|
| (0, 0) | (0, -3) | forest | 4 | 1 |
| (1, 0) | (1, -3) | pasture | 6 | 1 |
| (2, 0) | (2, -3) | hills | 5 | 1 |
| (3, 0) | (3, -3) | pasture | 11 | 1 |
| (4, 0) | (4, -3) | fields | 8 | 1 |
| (-1, 1) | (-1, -2) | fields | 3 | 1 |
| (0, 1) | (0, -2) | forest | 12 | 1 |
| (3, 1) | (3, -2) | forest | 3 | 1 |
| (4, 1) | (4, -2) | mountains | 9 | 1 |
| (-2, 2) | (-2, -1) | fields | 12 | 1 |
| (1, 2) | (1, -1) | gold | – | 2 |
| (-1, 3) | (-1, 0) | desert | – | 3 |
| (2, 3) | (2, 0) | desert | – | 4 |
| (0, 4) | (0, 1) | gold | – | 5 |
| (3, 4) | (3, 1) | mountains | 2 | 6 |
| (-3, 5) | (-3, 2) | hills | 9 | 6 |
| (-2, 5) | (-2, 2) | fields | 2 | 6 |
| (1, 5) | (1, 2) | pasture | 11 | 6 |
| (2, 5) | (2, 2) | mountains | 4 | 6 |
| (-3, 6) | (-3, 3) | pasture | 10 | 6 |
| (-2, 6) | (-2, 3) | forest | 6 | 6 |
| (-1, 6) | (-1, 3) | mountains | 5 | 6 |
| (0, 6) | (0, 3) | fields | 10 | 6 |
| (1, 6) | (1, 3) | hills | 8 | 6 |

Sea hexes (18, repo coordinates): (1, -2), (2, -2), (-1, -1), (0, -1),
(2, -1), (3, -1), (4, -1), (-2, 0), (0, 0), (1, 0), (3, 0), (-3, 1), (-2, 1),
(-1, 1), (1, 1), (2, 1), (-1, 2), (0, 2).

Robber: printed on the fields hex with the 12 disc, transcribed (-2, 2) = repo
(-2, -1) (the variable setup lets a player choose a 12 hex, S10). Pirate: drawn
on the right middle-row protrusion (transcribed (4, 3) = repo (4, 0)), which
is frame, so `pirate: null` as for New Shores.

## The eight tribes

A tribe disc sits on the vertex above and the vertex below each one-hex island
(disc numbers (11, 8), (10, 9), (4, 5) and (6, 3) per island, top then
bottom). Index = position in `CFC_TRIBES` (the order of the module state's
`tribes`); hexes are the three that meet at the vertex.

| # | Disc | Hexes as transcribed | Hexes in the repo | Topology vertex |
|---|---|---|---|---|
| 0 | 10 | (-1,3) (-1,2) (0,2) | (-1,0) (-1,-1) (0,-1) | 41 |
| 1 | 9 | (-1,3) (-1,4) (-2,4) | (-1,0) (-1,1) (-2,1) | 58 |
| 2 | 11 | (1,2) (1,1) (2,1) | (1,-1) (1,-2) (2,-2) | 28 |
| 3 | 8 | (1,2) (1,3) (0,3) | (1,-1) (1,0) (0,0) | 46 |
| 4 | 6 | (0,4) (0,3) (1,3) | (0,1) (0,0) (1,0) | 59 |
| 5 | 3 | (0,4) (0,5) (-1,5) | (0,1) (0,2) (-1,2) | 76 |
| 6 | 4 | (2,3) (2,2) (3,2) | (2,0) (2,-1) (3,-1) | 47 |
| 7 | 5 | (2,3) (2,4) (1,4) | (2,0) (2,1) (1,1) | 64 |

Tribes 3 (disc 8) and 4 (disc 6) are joined by one edge (the lower vertex of
the north-central island and the upper vertex of the south-central island), and
need three ships from the nearest large-island coast; the other six are one ship
from a large-island corner. Both facts are visible in the tests.

## The nine ports

Position as transcribed (hex, side with `NEIGHBOR_DIRS`: 0 E, 1 NE, 2 NW, 3 W,
4 SW, 5 SE), repo hex and the edge index in `sf-cloth-for-catan`; all nine are
land-to-frame edges. Kinds are shuffled over them with the game rng when the
layout is built (5 × 2:1, one per resource, and 4 × 3:1).

| # | Hex as transcribed | Hex in the repo | Side | Edge |
|---|---|---|---|---|
| 0 | (0, 0) | (0, -3) | 1 | 4 |
| 1 | (3, 0) | (3, -3) | 2 | 18 |
| 2 | (-1, 1) | (-1, -2) | 3 | 28 |
| 3 | (4, 1) | (4, -2) | 0 | 46 |
| 4 | (3, 4) | (3, 1) | 0 | 113 |
| 5 | (-3, 5) | (-3, 2) | 3 | 116 |
| 6 | (2, 5) | (2, 2) | 5 | 130 |
| 7 | (0, 6) | (0, 3) | 5 | 143 |
| 8 | (-2, 6) | (-2, 3) | 4 | 138 |

## Interpretations

| # | Item | Decision | Basis |
|---|---|---|---|
| I1 | Third starting settlement | The module extends `turn.setup.order` (seats forward, backward, **forward again**: "from the starting player, clockwise") in `initGame` and sets `SetupState.third = false`; the engine turns it `true` for the last `n` steps (round stays 2). The new module hook `setupStartingResources` withholds the cards in round 2 and pays them for the third settlement. Placement needs a road **or ship** like any setup step. No pending frame is inserted during setup (the third round is plain placement), so setup keeps the engine's own step clean-up; `third` is projected (`turn.setup.third`) only while true, and no other profile has the field, so digests are unchanged. The bot setup code reads only `round` (still 1 or 2) and the profile is outside the bot list. | SF25 p. 14; spec §5.2 |
| I2 | Where setup may build | Any vertex whose land hexes are all on the two large islands (one island or split); a vertex touching any small-island hex is never allowed, in setup or later (`allowBuilding`). Tribe vertices touch a small-island hex, so they are excluded too. | SF25 p. 14 |
| I3 | Trade link ("route") | After every board change (build, ship move, setup placement) the module recomputes, per player, which tribes are **reachable**: from a tribe vertex walk back over the player's own ships and roads (never through another player's building) to an own settlement or city. A newly reachable tribe opens the player's trade and takes 1 cloth at once. Each player opens each tribe once; other players already trading do not matter; further routes to the same tribe add nothing. The link is not undone if the route is later broken. Roads are included only for completeness (a tribe vertex can only be reached by sea). | SF25 p. 14 |
| I4 | Tribe already empty | The link still opens, but there is nothing to take (`gained: 0`). | SF25 does not say |
| I5 | Production | Each tribe whose disc number is rolled pays each trading player 1 cloth. If the tribe holds fewer than the number of trading players the tribe gives all it has and the supply pile covers the rest ("the shortfall comes from the general supply"). A tribe that is already empty pays **nothing and is not topped up** from the supply. Settled before the gold fields (`afterProduction`) and before the roll's own victory check. | SF25 p. 14 |
| I6 | Supply pile also short | Players are served in turn order starting with the roller, clockwise, first from the tribe and then from the supply pile; those left over take less (`shortBy` in `cloth.produced`). The order only matters when both are short. | SF25 does not say; recorded here |
| I7 | Scoring | 2 cloth = 1 VP, remainder worthless, all game (module `score` hook, public). Cloth gained by production, trade or theft counts at the next victory check (after the roll, after a build or move, after a theft). | SF25 p. 14 |
| I8 | Closed routes | A ship is **in a route to a tribe** when it lies on a simple path of the owner's ships and roads that starts at an own settlement or city and ends at a tribe vertex (the walk never passes another player's building). Such a ship cannot be moved (`E_SHIP_NOT_MOVABLE`, through `shipMoveBlocked`), even though its outer end looks open. A ship that extends past the tribe vertex, or forks off the path, is on no such path and follows the ordinary open-end rule. A second ship line to the same tribe closes that line too. The check is path-based, so a fork that happens to reach another tribe is closed for that tribe. | SF25 p. 14 |
| I9 | Robber and pirate | The robber (7 or knight) never moves to the four small islands (`robberTargets`). The pirate moves (7 or knight) only if the player has at least one route to a tribe (`E_PIRATE_NEEDS_TRIBE`; hint `pirateTargets` is empty otherwise; the robber is still available). | SF25 p. 14 |
| I10 | Stealing cloth | After a pirate move the victims are players with a ship beside the hex who hold a card **or** a cloth token. The actor takes one resource card (`pending.steal`) or one cloth token (`cloth.steal { victim }`, pirate frames only; the hint `clothVictims` lists who has cloth). Card theft from a victim with no cards is refused. | SF25 p. 14 |
| I11 | Ending 1 | 14 VP at any moment of the own turn (the base check; the cloth VP count). | SF25 p. 14 |
| I12 | Ending 2 | When a turn ends (`turn.end`, after every pending effect) with 5 or more tribes holding no cloth, the game ends: highest score (hidden victory point cards included, as for the target), then most cloth, then a **shared victory** of everybody still tied. **The shared victory is a user-decided reading (D12), not an official rule**: SF25 names the tie-break by cloth but does not rule a full tie. The check runs only at the end of a turn, not when the fifth tribe runs dry. No `turn.ended` event is emitted for that turn. | SF25 p. 14; spec D12, §6.5 |
| I13 | `GameResult` | New optional fields: `playerIds` (all winners in seat order) and `cause` (`'clothExhausted'`; absent means the target). `playerId` stays the first winner so older readers see one name. Only the cloth ending writes them, so a single-winner **target** finish (any profile) is **bit-for-bit unchanged**: `result`, the `game.finished` event `{ playerId, reason, score, target }` and the public `result` view keep their exact shape (tests compare them). The cloth ending's `game.finished` carries `{ playerId, playerIds, reason, score, cause }` and no target. | spec §6.5 |
| I14 | No Longest Road | `awardRules` raises the minimum to infinity for this scenario; nobody gets the award or its 2 VP and the panel hides the route mark. (The engine still tracks route length internally.) | SF25 p. 14 |
| I15 | Gold fields | The two gold hexes carry no disc, so they never produce; the generic gold help line is dropped from this scenario's help. | SF25 p. 14 |
| I16 | Harbors | Nine fixed positions, kinds drawn with the layout's rng (so reproducible from the game seed and stored in the layout, public). | SF25 pp. 14–15 |
| I17 | Messages | The closed-route refusal reuses `E_SHIP_NOT_MOVABLE` whose text says "neither end is open"; a dedicated message would be nicer but is not required. | – |
| I18 | Variable setup | Random large islands and the 12-hex robber choice (SF25 p. 15) belong to S10; the fixed map is offered. | spec §6.5 |
| I19 | Bots | The profile is outside the bot support list: bot seats are refused (`E_INVALID_BOT`, reason `profile`); the survey code does not run it but credits co-winners 1/k so a future run stays consistent. | spec §7.4 |

## What was built

| Area | Files | Notes |
|---|---|---|
| Map | `packages/rules/src/seafarers-scenario-boards.ts` (extended), `layout-registry.ts` (`sf-cloth-for-catan`) | shifted coordinates, tribes, 9 shuffled ports, the 42-cell topology |
| Rules | `packages/rules/src/modules/seafarers/cloth.ts` (new), `index.ts`, `state.ts`, `islands.ts`, `pirate.ts`, `messages.ts` | tribes in module state, trade after every board change, production, closed routes, pirate and cloth theft, score, no Longest Road, the cloth ending |
| Engine | `packages/rules/src/engine.ts`, `types.ts`, `project.ts`, `modules/types.ts`, `modules/README.md` | `SetupState.third`, `setupStartingResources` hook, `kit.endGame`, optional `GameResult.playerIds` / `cause`, projection of both |
| Profile | `packages/rules/src/profiles.ts` | `topologyId: sf-cloth-for-catan`, no `islandBonus`, `implemented` and `enabled` |
| Web | `SvgBoard.tsx`, `SvgSeafarers.tsx` (`TribeMarker`), `three/diorama-ships.ts`, `three/DioramaSeafarers.tsx`, `three/SceneContent.tsx`, `PlayersPanel.tsx`, `PendingPrompt.tsx`, `ResultScreen.tsx`, `GameStats.tsx`, `HelpPanel.tsx`, `board/seafarers.ts`, `audio/cues.ts`, `i18n/*` | tribes in both renderers, cloth and score marks, card-or-cloth steal choice, shared result, statistics, help and events in zh-Hant and en, sound cues |
| Survey | `packages/bots/bench/survey.ts`, `survey-records.ts` | `coWinners` and a 1/k `winShare` per co-winner |
| Evidence | `packages/rules/test/seafarers-cloth-for-catan.test.ts`, `seafarers-sim.test.ts`, `seafarers-sim.ts`, `packages/server/test/seafarers-cloth-for-catan.test.ts`, `packages/web/test/seafarers-cloth-for-catan.test.tsx`, `packages/bots/bench/survey-records.test.ts`, `scripts/seafarers/capture_cloth_for_catan.py`, `cloth_fixture.mjs` | see Verification |

## Verification

- Rules (`seafarers-cloth-for-catan.test.ts`, 47 tests; whole suite 67 files, 1069 tests): topology (42 hexes,
  same hexes and counts as `sf-new-shores-4`, Euler, rows 5-6-7-6-7-6-5,
  protrusions absent, 9 distinct frame harbor edges) and the (0, -3) shift
  against the transcribed row ranges; the 8 tribe vertices (three hexes each,
  one small-island hex, no building, numbers per island 11/8, 10/9, 4/5, 6/3);
  layout checksums (terrain, 20 + 8 discs, islands 10/1/1/1/1/10, every
  transcribed cell, robber on the 12, pirate on the frame, nine harbor
  tokens, reproducible and varying with the seed, 50 cloth); profile and
  player counts; setup (order, no cards before the third settlement, the
  third settlement's cards, large islands only on both, no corner touching a
  small island, a starting ship straight onto a tribe opens trade);
  trade (first tribe +1, others already trading, two routes to one tribe, empty
  tribe, a moved ship, an opponent's building cutting the route); production
  and supply (each trading player, none for non-trading players, short tribe
  covered by the supply, supply short in roller order, empty tribe not
  topped up, before gold, a roll that reaches 14); scoring (2 = 1 VP,
  14 VP by a trade, no Longest Road); closed routes and forks; robber
  restrictions, the pirate's route requirement, stealing cloth or a card, the
  cloth steal that wins; both endings (4 empty tribes no, 5 yes at the end of a
  turn, single winner under 14, tie on cloth, full tie shared, hidden cards
  count, target path with exact `result` / event / view, public view and
  reconnect, other profiles untouched). `seafarers-sim.test.ts`: 3 and 4
  players to a winner with a conserved bank and **50 cloth conserved**, at most
  15 ships, trades and production across seeds. `profiles.test.ts`,
  `seafarers-exports.test.ts` updated; the whole rules suite passes.
- Service (`seafarers-cloth-for-catan.test.ts`, 5 tests; `session`, `rooms`, `bots` suites pass): enabled and
  selectable without bot seats, room by ruleset parts for 3 and 4 players, 5
  and 6 refused, bot seat refused (`profile`), 3- and 4-player starts (topology,
  14 VP, 9 harbors, robber on the 12, 8 tribes × 5 + 10, identical for every
  viewer), a four-player setup with three settlements each and four starting
  grants, a ship trade, a **restart mid-game** (state identical, same view), a
  shared finish by the cloth ending read by every client, **a second restart**
  (the finished result and the event log name the same winners) and the room
  `completed`. `rooms.test.ts` and `session.test.ts` counts updated.
- Web (`seafarers-cloth-for-catan.test.tsx`, 16 tests): SVG board (42 hexes, 9
  harbors, 8 tribe discs with numbers and 5 cloth, title text, link dots and a
  stack per cloth); 3D tribe spots and number tokens; player panel (cloth,
  score, supply, empty tribes, no Longest Road, both locales); card-or-cloth
  steal prompt and its commands, the unchanged robber prompt, no pirate target
  without a route; help (seven rule lines, "house reading" caveat) and event
  lines in both locales including the cloth `game.finished` variants and the
  unchanged target sentence; result screen (shared, single cloth winner below
  14, ordinary target ending unchanged, statistics rank both co-winners);
  sound cues (every co-winner hears victory, others game over, single winner
  unchanged). `rulesets.test.ts` updated; the whole web suite was run once
  (the known `lobby.test.tsx` timing flake aside). Bots: `survey-records.test.ts`
  (co-winner shares, validation); `support.test.ts` already refuses the profile.
- Browser: `scripts/seafarers/capture_cloth_for_catan.py` (Chromium, software
  WebGL, `SF_TIMEOUT=180000` on the shared machine, **every command receipt
  asserted `accepted`**, 13 cases, 0 page errors): lobby (3–4 players only), the
  3- and 4-player map in SVG (42 hexes, 9 harbors, 8 `[data-tribe-number]`
  nodes) and 3D (canvas `data-tribe-markers` = 8, `data-tribe-cloth` =
  `5,5,5,5,5,5,5,5`), phone for 4, setup over the API (every seat places three
  settlements, three third-round steps seen through `turn.setup.third`;
  `cloth_fixture.mjs check`: nothing touches a small island), the help panel,
  then a live game for player 1 through the UI: a test-only fixture (service
  stopped) gives the turn, ship cards, two coastal settlements each one ship
  from a tribe and player 2 a ship and 2 cloth beside a sea hex. **SVG**: a
  ship to the first tribe (trade opens, +1 cloth, the tribe disc shows ×4 and
  the player's link dot, panel mark, 50 cloth conserved); **3D**: a ship to the
  second tribe (canvas cloth stacks follow the view, 2 cloth = 1 VP); a
  test-only `moveRobber` frame, then the pirate moved onto player 2's hex on
  the 3D board and the prompt offers "steal a card" or "steal cloth" (cloth
  chosen: 3 and 1); then, on a touch **phone** context in SVG, a second pirate move and a card
  steal (the prompt text names "a card or a cloth token"; receipts accepted;
  player 2 holds only grain so the stolen card is exactly one grain); a second
  fixture empties five tribes and ties players 1
  and 3 on score and cloth, and ending the turn shows the **shared victory**
  on the result screen (both winners, "cloth ran out", no target line, no
  horizontal overflow in a phone-sized viewport; both players read the same
  `playerIds` / `cause` from the API). Finished games leave the resume list, so
  the phone capture resizes the same page instead of reopening it. Report with
  sha256 per image: `docs/screenshots/seafarers-cloth-for-catan/report.json`;
  the curated captures are `committed: true` (the 3-player 3D map is not kept).

## Limitations

- No human playtest, physical device or screen-reader check.
- The full-tie shared victory is a user-decided reading (D12), not SF25 text.
- Variable setup (SF25 p. 15) is not offered (S10).
- No bots: the profile is outside the bot support list and refuses bot seats.
- A route's closed ships report the generic "no open end" message (I17).
