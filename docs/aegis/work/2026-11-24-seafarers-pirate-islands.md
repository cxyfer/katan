# Seafarers scenario S7a: The Pirate Islands, board, presets and the western ship line

Advisory work record for slice **S7a** of
[the scenarios spec](../specs/2026-11-22-seafarers-scenarios.md) (§2.3, §5.2–§5.4, **§6.6**, §7.3–§7.5, §9 OQ-3,
§10 and §11.2 SFX-S7). Branch `feat/sfx-s7a-pirate-islands-board`, based on `origin/release/v0.4.6`
(S0–S6 and S9 merged; S8 is on another branch). Profile `sf-pirate-islands-2025` (3 and 4 players on one shared map,
rule version `sf-2025.3`). **The profile is not enabled by this slice**: `implemented: true`, `enabled: false`; S7b adds the
cruising pirate and its attacks, S7c the warships, the attack on the fortress and the ending, and enables the profile.

S7a covers the map, the preset pieces, the beachhead markers, the fortresses (state, no production, no score, no city), the
development-card deck, the starting-settlement restriction, the western ship line with the shortest-path rule (OQ-3 as
confirmed by the user), the boxed-in-line backtracking rule (`stuckLineBacktrack`) and its measurement, and both renderers.

## Sources (accessed 2026-11-24)

| Id | Edition | Publication | File | SHA-256 | Pages used |
|---|---|---|---|---|---|
| SF25 | CATAN – Seafarers, 2025 (`v6.250401`) | CN3083 | `CN3083 CATAN–Seafarers Rulebook 2025 secured reduced.pdf` (20 pp.) | `a499abe2b613afd618dd3c806790400c7e84adebcc9b9ab19a24fb80dd04b099` (same file as `2026-11-01-seafarers.md`) | 2–3 (rules), 16–17 (The Pirate Islands: setup, pirate movement and attacks, shipbuilding, building on the pirate island, warships, conquering a fortress, winning, component table; the map is a two-page spread) |

Rendered pages (outside the repository, read as images): `p16.png`
`da6bbf55db6623043729ecd72d56da79c17f8b0056143869e1f6695fbdae3e73`, `p17.png`
`4f074f6db9769eb8d47d5b21d3605e9d69f975501b88159546c2cbaad10dd601`. The PDF is not in the repository and nothing downloaded
was executed. SFCN-20 is cross-check only (§2.3 lists where it differs: line start, attack optional, beachhead wording).

## Method

1. **Two independent transcriptions** (`s7-A.json`, `s7-B.json`, outside the repository; sha256 `f25493e7…c7f05` and
   `d3a93afb…9ef`). Two transcribers, each seeing only the SF25 spread, transcribed the whole map: terrain, disc, island
   number, every sea hex, the outline rows and the two middle-row protrusions, the eight port positions, the pirate and the
   robber (none), and every marker (preset settlement and ship, fortress, beachhead per colour, the pirate route with its
   direction and start). Neither saw the other's work.
2. **Comparison.** Field by field: land (30 hexes: terrain, disc, island), sea (19 hexes), outline rows, the 8 ports (hex,
   side, "?"), the robber (none), the pirate (sea hex (0, 6)), the 4 × 4 markers (the hexes sharing each vertex or edge, per
   colour) and the 14-hex pirate route (order, direction, start) are **identical**. Nothing had to be re-read against the page.
   The page images were also looked at once for the marker positions (red settlement with ship at the north-east corner of the
   main island, white and blue settlements either side of the (2, 3) fields hex, orange at the south-west, the four lair stacks
   beside the western fortresses, the four beachhead discs and the grey pirate on the bottom row), which agrees.
   Both transcribers note the same naming difference from the spec text: the centre has **two** small islands (island 3 =
   two deserts in the north, island 6 = desert and pasture in the south, kept apart by the sea hexes (0, 3) and (1, 3)), not
   one; both are still the "pirate islands" (every island except the main one).
3. **Coordinates shifted once.** The transcription origin is "top row r = 0, leftmost cell of that row q = 0" (outline rows
   `[0,5] [-1,5] [-2,5] [-2,4] [-3,4] [-3,3] [-3,2]`). The repo outline of the Forgotten Tribe (`FT_CELLS`, rows 6-7-8-7-8-7-6,
   the middle row r = 0 holding q from -3 to 3) lists exactly the same q range on each row, so the map is the **same shape**
   and the shift is the same **(dq, dr) = (-1, -3)** as S5 and S8 will use. It is applied once in
   `seafarers-pirate-islands-boards.ts` (`PI_SHIFT`); a test compares the transcribed row ranges with the topology. This
   record lists both coordinates.
4. **Frame.** 49 cells, rows 6-7-8-7-8-7-6; the two hex-shaped protrusions at the ends of the middle row (the WEST and EAST
   labels, transcribed (-3, 3) and (5, 3), repo (-4, 0) and (4, 0)) are frame, as for New Shores: with them the map would be
   51 cells and 21 sea against the table's 49 and 19. A separate topology `sf-pirate-islands` is registered (the 49 hexes of
   `sf-forgotten-tribe` but its own 8 harbour slots: 172 edges, 124 vertices, Euler 1) rather than sharing the S5 id, because
   the harbour positions differ.
5. **Islands.** 1 = the main (eastern, 17 hexes: the settlers' home), 2 = north-west pirate island (4 hexes), 3 = centre-north
   (2 deserts), 4 = the single mountains hex in the west, 5 = south-west pirate island (4 hexes), 6 = centre-south (desert and
   pasture). Everything but island 1 is a pirate island.

## Checksums

| | Sea | Desert | Gold | Fields | Hills | Mountains | Pasture | Forest | Total |
|---|---|---|---|---|---|---|---|---|---|
| Table (p. 17; spec §6.6) | 19 | 3 | 2 | 5 | 5 | 5 | 5 | 5 | 49 |
| Transcription (both) | 19 | 3 | 2 | 5 | 5 | 5 | 5 | 5 | 49 |

| Discs | 2 | 3 | 4 | 5 | 6 | 8 | 9 | 10 | 11 | 12 | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Table (p. 17) | 1 | 2 | 3 | 3 | 3 | 3 | 3 | 3 | 2 | 1 | 24 |
| On land (30 hexes, both) | 1 | 2 | 3 | 3 | 3 | 3 | 3 | 3 | 2 | 1 | 24 |

Six hexes carry no disc, as the page says: the two hills (-1, 1) and (-3, 5), the three deserts (2, 1), (1, 2), (0, 4) and the
pasture (0, 5) (transcription coordinates). Ports: 5 × 2:1 + 3 × 3:1 = 8 tokens for 8 positions, all drawn "?" (random kind,
fixed position). Pirate lair tokens: 9 (3 players) or 12 (4 players) = 3 per fortress. Islands 17 + 4 + 2 + 1 + 4 + 2 = 30
land hexes. `packages/rules/test/seafarers-pirate-islands.test.ts` re-runs all of these on the real layout and compares
every transcribed cell, marker and route hex against a copy of the transcription kept in the test.

## Transcription (SF25 pp. 16–17)

Columns: transcription coordinate, repo coordinate, terrain, disc, island.

| (q, r) as transcribed | (q, r) in the repo | Terrain | Disc | Island |
|---|---|---|---|---|
| (0, 0) | (-1, -3) | gold | 11 | 2 |
| (1, 0) | (0, -3) | mountains | 6 | 2 |
| (4, 0) | (3, -3) | fields | 4 | 1 |
| (5, 0) | (4, -3) | hills | 5 | 1 |
| (-1, 1) | (-2, -2) | hills | – | 2 |
| (2, 1) | (1, -2) | desert | – | 3 |
| (4, 1) | (3, -2) | mountains | 9 | 1 |
| (5, 1) | (4, -2) | forest | 10 | 1 |
| (-2, 2) | (-3, -1) | fields | 4 | 2 |
| (1, 2) | (0, -1) | desert | – | 3 |
| (3, 2) | (2, -1) | forest | 3 | 1 |
| (4, 2) | (3, -1) | pasture | 8 | 1 |
| (5, 2) | (4, -1) | forest | 5 | 1 |
| (-1, 3) | (-2, 0) | mountains | 8 | 4 |
| (2, 3) | (1, 0) | fields | 6 | 1 |
| (3, 3) | (2, 0) | hills | 9 | 1 |
| (4, 3) | (3, 0) | pasture | 12 | 1 |
| (-3, 4) | (-4, 1) | fields | 10 | 5 |
| (0, 4) | (-1, 1) | desert | – | 6 |
| (2, 4) | (1, 1) | pasture | 11 | 1 |
| (3, 4) | (2, 1) | forest | 8 | 1 |
| (4, 4) | (3, 1) | pasture | 9 | 1 |
| (-3, 5) | (-4, 2) | hills | – | 5 |
| (0, 5) | (-1, 2) | pasture | – | 6 |
| (2, 5) | (1, 2) | mountains | 5 | 1 |
| (3, 5) | (2, 2) | forest | 2 | 1 |
| (-3, 6) | (-4, 3) | gold | 3 | 5 |
| (-2, 6) | (-3, 3) | mountains | 6 | 5 |
| (1, 6) | (0, 3) | fields | 10 | 1 |
| (2, 6) | (1, 3) | hills | 4 | 1 |

Sea hexes (19, repo coordinates): (1, -3), (2, -3), (-1, -2), (0, -2), (2, -2), (-2, -1), (-1, -1), (1, -1), (-3, 0),
(-1, 0), (0, 0), (-3, 1), (-2, 1), (0, 1), (-3, 2), (-2, 2), (0, 2), (-2, 3), (-1, 3).

Robber: **not used** (returned to the box): `layout.robber = -1`, `board.robber = -1`, the module reports the robber as inactive so
a 7 only makes players with more than 7 cards discard. Pirate: the grey ship drawn on the bottom row, sea hex transcribed
(0, 6) = repo (-1, 3), the first hex of the route; it is a sea hex, not the frame.

## The eight ports

Position as transcribed (hex, side with `NEIGHBOR_DIRS`: 0 E, 1 NE, 2 NW, 3 W, 4 SW, 5 SE), repo hex, and the edge index in
`sf-pirate-islands`; all eight are land-to-frame edges of the main island. Kinds are shuffled over them with the game rng when
the layout is built (5 × 2:1, one per resource, and 3 × 3:1).

| # | Hex as transcribed | Hex in the repo | Side | Edge |
|---|---|---|---|---|
| 0 | (4, 0) | (3, -3) | 2 | 23 |
| 1 | (5, 0) | (4, -3) | 2 | 28 |
| 2 | (5, 0) | (4, -3) | 0 | 30 |
| 3 | (5, 1) | (4, -2) | 0 | 54 |
| 4 | (4, 3) | (3, 0) | 0 | 103 |
| 5 | (4, 4) | (3, 1) | 5 | 127 |
| 6 | (3, 5) | (2, 2) | 5 | 150 |
| 7 | (1, 6) | (0, 3) | 5 | 166 |

(The edge numbers are the topology's `harborSlots` in its own order; the token kinds are shuffled over the slots, so the
order of the rows only identifies the positions.)

## Preset pieces, fortresses and beachheads

Corner/side names as in `seafarers-helpers`: corners 0 lower right, 1 bottom, 2 lower left, 3 upper left, 4 top, 5 upper
right; sides 0 E, 1 NE, 2 NW, 3 W, 4 SW, 5 SE. Hexes are those sharing the vertex (frame hexes omitted); the vertex and edge
numbers are the `sf-pirate-islands` topology indices. **Each colour has one set** (a settlement and a ship on the main island's
coast, a fortress and a beachhead on the western islands). In a 3-player game the white set is not used.

| Colour | Settlement (hexes, corner, vertex) | Ship (hexes, side, edge) | Fortress (hexes, corner, vertex) | Beachhead (hexes, corner, vertex) |
|---|---|---|---|---|
| red | (3,1) (4,0) (4,1) · bottom of (4,0) · 19 | (4,0)/(3,1) · SW of (4,0) · 22 | (0,0) · top of (0,0) · 4 | (1,0) (2,0) · upper right of (1,0) · 9 |
| blue | (1,4) (2,3) (2,4) · bottom of (2,3) · 72 | (2,3)/(1,4) · SW of (2,3) · 96 | (-3,4) (-3,5) (-2,4) · top of (-3,5) · 77 | (-2,4) (-1,3) (-1,4) · bottom of (-1,3) · 66 |
| orange | (1,5) (1,6) (2,5) · top of (1,6) · 105 | (1,5)/(1,6) · NW of (1,6) · 144 | (-3,6) · bottom of (-3,6) · 112 | (-2,6) (-1,6) · lower right of (-2,6) · 114 |
| white (4 players) | (2,2) (2,3) (3,2) · top of (2,3) · 53 | (2,2)/(2,3) · NW of (2,3) · 69 | (-2,2) (-1,1) (-1,2) · bottom of (-1,1) · 27 | (-1,2) (-1,3) (0,2) · top of (-1,3) · 47 |

(All coordinates in this table are transcription coordinates.) The beachheads are **vertices**, as expected from "you may build a
settlement there" (SF25 p. 17): red and orange on a corner of a pirate-island hex facing the route, blue and white on the bottom and
top corners of the single mountains hex (-1, 3). A lair stack is drawn beside each fortress settlement; it is an illustration,
not a separate position.

## The pirate route

14 sea hexes in one closed loop, **clockwise** (north side to the east, east side to the south, south side to the west, west
side to the north), one arrow drawn between every two neighbours; the first hex is the pirate's start. Transcription
coordinates: (0, 6), (-1, 6), (-1, 5), (-1, 4), (0, 3), (0, 2), (1, 1), (2, 0), (3, 0), (3, 1), (2, 2), (1, 3), (1, 4), (1, 5)
(repo hex indices 46, 45, 38, 30, 23, 15, 8, 2, 3, 10, 17, 24, 32, 40). The route narrows between the two centre islands:
(0, 3) and (1, 3) are neighbours but not consecutive on the route. S7a stores and draws the route; S7b moves the pirate along it.

## Interpretations

| # | Item | Decision | Basis |
|---|---|---|---|
| I1 | Which set a player gets | A player whose colour is red, blue, orange or white takes that colour's set; the others take the remaining sets in seat order. 3 players use the red, blue and orange sets (`PI_PIECES.slice(0, 3)`), so the white positions stay empty whatever colours are chosen. Colour is cosmetic in the engine, so this keeps every table legal. | SF25 p. 16 "in a 3-player game, do not use the white piece locations"; spec §5.2 |
| I2 | The fortress | A real settlement on the board (so it occupies the vertex, uses one of the 5 settlement pieces, stops opponents' ships and lies in the distance rule) plus 3 lair tokens held in module state (`fortresses: [{ player, vertex, lairs }]`). While `lairs > 0` it **produces nothing** (neither the resource hex nor the gold hex: `productionAmount` and `goldEntitlements`), **scores nothing** (the module's `score` hook subtracts the settlement's 1 VP), and **cannot become a city** (`allowCity`). Recapturing (S7c) sets `lairs` to 0 and it is an ordinary settlement. Settlement pieces: 1 preset + 2 starting + the fortress = 4 of 5, leaving one for the beachhead. | SF25 p. 16 note, p. 17 "now counts as one of your settlements"; spec §5.3 |
| I3 | Where settlements and roads may go | Starting settlements: only vertices all of whose land hexes are on the main island (`allowBuilding`, setup). Later: the main island as usual; on the pirate islands only the player's **own beachhead** vertex, and **only once the player's western ship line (ships, never roads) has reached it**; other players' beachheads and every other pirate-island vertex are refused. **Roads on a pirate island** may only leave a building the player holds legitimately (a beachhead settlement or a recaptured fortress) or a road built from one (`roadAllowed`): an unrecaptured fortress is a settlement on the board but cannot start a road, so nobody can walk a road from the fortress to the beachhead or claim the coast beside it (review finding, tests for Red's and Blue's cases). | SF25 p. 16 "You may build on the main island as normal. The remaining islands are considered pirate islands", p. 17 "Building on the pirate island" |
| I4 | Which ships belong to the line | The line is the player's ordered chain of ships from the starting settlement. **The preset ship is its first ship** (start = the preset coastal settlement). A new ship placed at the line's end that cuts the distance to the next target by 1 extends the line. Any other ship on an edge that touches the main island is one of "the other routes around the main island" and is free; any other ship on an edge that touches no main-island hex is refused (`E_SHIP_LINE`). **While the line is still only the preset ship**, a strict first step from **any other own coastal building** on the main island starts a new line there **only if that is strictly better for the player** (the distance from the new ship's far end to the target is smaller than the distance from the current line end; when the current end is cut off, any shortest first step qualifies; round 6 review), otherwise the ship is an ordinary free coastal ship and the line is unchanged, and the preset ship becomes an ordinary free coastal ship (round 4 review; this also applies to setup ships beside a new settlement). Once the line has grown past one ship it keeps its start. A restart is allowed **only if the old ship is a coastal ship** (it becomes a free coastal ship); if the single line ship is an offshore ship the restart would leave an orphan offshore ship outside the line, so the step is refused (`E_SHIP_LINE`), setup and build alike (round 5 review; 4-player seed 1 setup at vertex 17 / edge 19 then vertex 21 / edge 24: the second ship is now an ordinary free ship and the line stays `[19]`). A restart also goes through the no-wall check (it starts at an own building, which other players cannot pass anyway, so in practice it never walls anyone). | SF25 p. 16 "You may create other routes around the main island"; spec §2.3 |
| I5 | Where the line begins | **At an own coastal building on the main island, any of them** (SF25 p. 16 "This line must begin at one of your coastal buildings on the eastern island"; this replaces the earlier reading that a free ship could feed the line). The preset ship starts it at the preset settlement by default; until the line has grown past that one ship the player may instead begin at another own coastal building (I4), and a line with no ship (after S7c losses) restarts only at a vertex that touches the main island and holds an own settlement or city, never at a vertex that only has an own free ship. Coastal buildings often have only coastal edges beside them, which is why the coastal edges count for the distance (I6). | SF25 p. 16; spec §2.3 |
| I6 | The shortest path (OQ-3, confirmed by the user) | Every new line ship must make the distance from the line's end to the **next target** (the beachhead first, then the fortress) smaller by exactly 1. The distance is a breadth-first count over **every currently empty sea edge** (coastal edges included), never through a vertex held by another player's building; the pirate's temporary restrictions are not counted. The distance is from the *current end*, so when another player's ship blocks the shortest route the detour's every step is legal, and several shortest paths are all allowed. The new end's distance is checked equal to the old one minus 1 on every step in the tests. | spec §6.6, OQ-3; SF25 p. 16 "must take the shortest path" |
| I7 | One line, no branching | The line is the ordered list of the player's line ships (`lines[player] = { start, edges }`). A line ship must attach at the end; once the line has reached the fortress (`done`) no more line ships can be built, free coastal ships still can. Ships on the line (the preset ship included) cannot be moved (`shipMoveBlocked`); a free ship moved onto a line edge is judged exactly like a new ship (`ship.move` and `setup.placeShip` go through the same check and the same `E_SHIP_LINE`). A setup ship at a new settlement is a line ship only if that settlement is the line's end and the ship cuts the distance; otherwise it must be on a coastal edge. | SF25 p. 16 "one continuous line … No branching" |
| I8 | Reaching the targets | The line reaches the beachhead when one of its vertices is the beachhead vertex (the target then becomes the fortress) and the fortress when it passes the fortress vertex (the line is complete). A settlement at the beachhead does not stop the line: it continues from there. Counting the preset ship, every colour needs 6 ships to the beachhead and 3 more to the fortress (`EXPECTED_LINE_LENGTHS`; the map is symmetric), well inside the 15 ships of the supply. | SF25 p. 16 |
| I9 | A boxed-in line: backtracking (`stuckLineBacktrack`) | **Departure from SF25** (which defines nothing here), **decided by the user on 2026-11-24**; it replaces the earlier "extend in any legal direction" relaxation, which could not help because a relaxed step stays inside the pocket that is cut off from the target (see the simulation), and that code is gone. When the distance from the line's end to the current target over empty sea edges is *completely* blocked, the **last ship of the line** (and only it, and only then) is no longer fixed: the player moves it with the ordinary `ship.move` (one ship move per action window as always, and not a ship built in this window) to any legal place, either a free coastal edge or a **strict** extension from the new end (every step cuts the distance by 1 again). The line is cut by that ship in the same transition (`lines[player].edges` and the end follow); if the new end is still blocked the next last ship can go back the same way, one per window, down to the preset ship, after which the line has no ship (`start: null`) and restarts only at an own coastal building (I5). A move is used instead of a removal to the supply because it reuses the existing move flow, hints and both renderers, and it keeps the ship count (15) honest. The end ship may be moved when its far end (the line's end) touches an own building (a beachhead settlement; the building stays), but **not** when that end also touches another own ship (a free coastal ship), which would leave a ship cut off from every building: the ordinary open-end rule applies then (`lineBacktrackMovable`, round 3 review). The distances use the same walkable vertices as `lineShip`: the player's own line vertices other than the end cannot be entered, so a path back through the line is never counted. Hints: the end ship is in `movableShips`, `pirateLine.stuck` is true and the panel says so. If no route exists from anywhere (a complete wall of other players' ships), backtracking cannot help; see the simulation. | user decision 2026-11-24; spec §6.6, §9 OQ-3 |
| I10 | The pirate and the robber in S7a (superseded by I23–I31 in S7b: the pirate cruises and a 7 now steals) | The pirate stands on the route's first hex and does not move until S7b; the base rule that no ship can be placed or moved onto an edge of the pirate's hex still applies. The robber is out of the game (`robberInactive`): a 7 makes players with more than 7 cards discard and nothing else happens (the "steal from any other player" step is S7b). Longest Road and Largest Army are disabled (`awardRules`). | SF25 p. 16 |
| I11 | The deck | 3 players: the 5 victory point cards are removed (20 cards: 14 knights, 2 road building, 2 year of plenty, 2 monopoly). 4 players: they are replaced in place by knights (25 cards, 19 knights), so the shuffled order is unchanged. Playing them (warships) is S7c. | SF25 p. 16 |
| I12 | Setup | Unchanged: two rounds, two starting settlements with a road or a ship each, on the main island only; the second settlement still gives its starting cards. Everyone then has 3 settlements and 3 VP (the fortress counts for 0). The preset pieces are placed in `initGame` without the rng. | SF25 p. 16 |
| I13 | Profile | `implemented: true`, `enabled: false`: the engine can build the game (tests, the sim) while the lobby and the server still refuse it (`disabled`); S7c enables it. `stuckLineBacktrack: true` is a registry field. | spec §10 |
| I14 | State and views | `SeafarersState.pirateIslands` (fortresses, beachheads, lines, route) exists only in this scenario; the public view `modules.seafarers.pirateIslands` and the hint `pirateLine` (next target, target vertex, end, edges) are absent elsewhere, so every other profile keeps its view and hint keys and its ship rules (D7, tested). Everything is public: no hidden information is involved. | spec D7 |
| I15 | Robber and knights in S7a | The robber does not exist: `robberTargets`, `legalRobberHexes` and the pirate targets are empty. `dev.playKnight` is **refused** (`E_INVALID_COMMAND`, `vetoCommand`) until S7c, which turns knights into warship conversions ("knight cards may only be used to convert ships into warships"), so no command can put the removed robber back on the board. | SF25 p. 16–17 |
| I16 | Panel settlement count | An unrecaptured fortress is not counted in the settlements of the player panel (it scores nothing), so the breakdown (e.g. Settlements (3 × 1) after setup) matches the total. | SF25 p. 16 |
| I17 | Nobody may wall off a target | **Departure from SF25, decided by the user on 2026-11-24**, extending "you may not create a longer line to block off other players". An action is illegal when it turns **any** player (the actor included) from *connected* to *completely cut off* from the **current target** (beachhead, or the fortress once the beachhead is reached). *Connected* means: the target's component over empty sea edges, never through a vertex another player's building holds, touches one of the player's possible starting points, which are every vertex of the current line (so a retreat to any of them is possible) or, with no ship, the own coastal buildings on the main island. Players whose line is complete are not protected, and a player already cut off before the action is not protected either, so an old walled-off position never freezes the table. Checked for: `build.ship`, `ship.move`, Road Building's free ships and `setup.placeShip` (through `canPlaceShip`; error `E_LINE_WALLED`), roads on coastal edges (`roadAllowed`) and settlements (`allowBuilding`, a building blocks others' passage), setup placements included. The actor's own line extension is judged against the target it will have afterwards (reaching the beachhead switches the target to the fortress). Cost: one breadth-first search per protected player at most, and only when the placement touches the single empty route that was found for that player (a route that is still intact proves the connection), plus a cached per-board context; the hints list only legal ships. **Exemption (user decision, 2026-11-24): the player's own strict shortest-path extension is never refused by this rule** (a newly built line ship at the line's end whose new end is one step closer to the current target). SF25 only forbids lengthening a line to block others; sailing the shortest path is required, so it is not blocking on purpose. Without the exemption two lines that need the same narrow channel each refused the other's step and both waited forever (342 such player-turns in the 4-player heavy-free-ship runs). The rule still applies to free ships, moved ships (a backtracked ship's landing included), coastal roads, settlements and non-shortest line placements; the first line to reach a shared channel may use it. A consequence: the lines of two players can wall each other, and those players are then limited to backtracking (I9). The remaining ways to be boxed in are the pirate (temporary), buildings and such a line-versus-line wall. **Known limitation**; S7c will change the board again when a failed attack removes ships from a line, which can also open or close routes. | user decision 2026-11-24; SF25 p. 16 |
| I18 | Targets in order | The beachhead must be reached before the fortress: until then the fortress vertex cannot be passed (the distances avoid it) and `done` means that the fortress is reached **after** the beachhead in the line (a line that touched the fortress first and stopped at the beachhead is not complete). Other players' fortresses are buildings and already block; other players' beachhead vertices stay passable. | SF25 p. 16 "first … your beachhead marker. Finally … the pirate fortress" |
| I19 | Backtracking hint and checks | `pirateLine.stuck` only says the line is boxed in; `pirateLine.backtrack` says the end ship can really be moved now (action phase, the player's own turn, no ship moved yet in the window, not built this turn, not by the pirate, a legal place to put it), computed from the same `movableShips` the move flow uses; the panel text offers the move only when `backtrack` is true and otherwise says when it will be possible. The no-wall check of a backtracking move uses the line **after** the ship is removed (the target can fall back from the fortress to the beachhead, and a line with no ship starts from every own coastal building). | review round 4 |
| I21 | No village on another player's ship line | **User decision extending no-walling (2026-11-24), departure from SF25**: nobody may build a settlement (or place one in setup) on a vertex of **another player's ship line** (start, interior vertices and end). A village there cuts the line in two for good (a line cannot be joined again), which is a permanent wall even though no empty sea route is involved, so the path-based check of I17 does not see it. Checked in `allowBuilding`, `vetoCommand` and in the hints. The veto answers `E_LINE_WALLED` (text in zh-Hant and en) **only when everything else about the command is fine** (turn, phase, no pending frame, resources, occupancy and the ordinary building rules); any other cause keeps its ordinary error code (`E_NOT_YOUR_TURN`, `E_WRONG_PHASE`, `E_ILLEGAL_TARGET`), as for ships. It can happen: an opponent's village on a coastal vertex the line passes. FIDELITY gets a row for this departure when S7c enables the profile (together with I9, I17). |
| I22 | Boxed-in hint reasons | `pirateLine.backtrackBlocked` is `null` when the end ship can move now, otherwise `phase` (not the action phase or not the player's turn), `moved` (a ship already moved this window), `builtThisTurn` (own text: the end ship was built this turn), `pirate` (the pirate is beside it), `attached` (another own ship hangs on the end) or `noTarget` (a legal place to put it does not exist); the panel text depends on it (zh-Hant and en). | review round 5 |
| I20 | zh-Hant terms | The beachhead marker is the 補給站標記 (SFCN-20 / spec §2.3 term) and the pirate lair token the 海盜巢穴標記 (spec §6.6); the English texts keep the SF25 names. | spec §2.3, §6.6 |

## Simulation: how often is a line boxed in, with backtracking, the no-wall rule and its exemption

Spec §6.6 and OQ-3. History: the exact shortest-path rule can leave a line boxed in; an "extend in any direction" relaxation was shown not to help and was replaced
by backtracking (I9); the user then added the no-wall rule (I17), and on the same day exempted a player's own strict shortest extension from it, because without the exemption two lines
needing one channel deadlocked. This section measures the final rules (300 games per player count and policy).

`packages/rules/test/seafarers-pirate-islands-sim.ts` plays whole setups and then turns of random **legal** actions
(3 and 4 players, seeds 1..N, at most 60 turns, or until every line reaches its fortress): the actor rolls (a 7 only discards), then makes 1 to 4
actions, each either an extension of the own line (probability `bias`) or any other legal ship (free coastal routes), a road, or a settlement on a
beachhead (settlements elsewhere and cities are left out so nobody wins by points); the hand is refilled before every action so
the run tests paths, not the economy; before every turn the pirate jumps to a random hex of the route. **A boxed-in player first backtracks**. Every command goes through
`applyCommand`, and at the end of each game every road and every line end is checked. Measured: *boxed-in* = the target cannot be reached from the line's end over empty sea edges;
*wall refusals* = legal ship places hidden by the no-wall rule, summed over every action; *rule deadlocks* = player-turns where the end can reach the target and only the no-wall rule prevents every extension
(0 now: the exemption removed them); *inconsistent* = no legal extension even without the no-wall rule although the end can reach the target (must be 0); *stuck players* = players at the end whose line is unfinished, pieces
are left, no legal extension exists and the end ship cannot move to a legal place; *route-less* = boxed-in players with no route from any vertex of the line or any own building. Run with
`PI_SIM_GAMES=<n> PI_SIM_BIASES=<list> PI_SIM_REPORT=1 pnpm --filter @katan/rules exec vitest run test/seafarers-pirate-islands-sim.test.ts` (2026-11-24, shared machine, two runs in parallel):

| Players | Policy | Games | Games with a boxed-in line | Boxed-in players | Backtracks | Still boxed in at the end (route-less) | Stuck players | Rule deadlock turns | Wall refusals | inconsistent | badEnds | illegalRoads |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 3 | bias 1 | 300 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 0 | 0 | 0 | 0 |
| 4 | bias 1 | 300 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 0 | 0 | 0 | 0 |
| 3 | bias 0.85 | 300 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 0 | 0 | 0 | 0 |
| 4 | bias 0.85 | 300 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 0 | 0 | 0 | 0 |
| 3 | bias 0.4 | 300 | 3 (1 %) | 3 | 11 | 1 (0) | **1** | 0 | 0 | 0 | 0 | 0 |
| 4 | bias 0.4 | 300 | 11 (3.7 %) | 11 | 15 | 7 (5) | **7** | 0 | 0 | 0 | 0 | 0 |

Hint cost (`actionHints` for the acting player, measured inside the simulation on the shared machine, two runs in parallel): about **3.5 ms** per call for 3 players and **3.1 ms** for 4 players on average at `bias 0.4`
(22,346 and 28,082 calls); `bias 1` and `0.85` about 3.3 ms. An unloaded micro-measurement on the opening position gave about 4 ms per call, `legalShipEdges` about 2 ms, other Seafarers profiles below 1 ms.

Reading (round 4: the player may restart the line from another coastal building while it is only the preset ship, targets are visited in order, and the "route exists" test used by the rule and by this table counts a retreat to any line vertex):

- For line-focused play nobody is boxed in (0 of 1,200 games at `bias 1` and 1,200 at `0.85`; every line completes); with many random free ships 1 % (3 players) to 3.7 % (4 players) of the games have a boxed-in line,
  down from 3 % / 6.7 % in the previous measurement, because routes are now counted from every retreat point.
- **Rule deadlocks 0, wall refusals 0, inconsistent 0, bad ends 0, illegal roads 0.**
- Stuck players are **1 (3 players) and 7 (4 players) at `bias 0.4`**, most of them route-less (the two lines wall each other under the I17 exemption). **Known limitation**; S7c changes the board again when failed attacks
  remove ships, so re-measure then.
- Simulation policy note: the simulated players never restart a line at random (neither in setup nor when the pirate temporarily blocks the step); a first version that did restart at random reported about 45 % boxed-in games, which was the
  simulation's own doing, not the rules'. Restarts are covered by their own tests.

## What was built

| Area | Files | Notes |
|---|---|---|
| Map | `packages/rules/src/seafarers-pirate-islands-boards.ts` (new), `topology-registry.ts`, `layout-registry.ts` | shifted coordinates, 8 shuffled ports, the 49-cell topology `sf-pirate-islands`, preset/route data, corner and side lookups |
| Rules | `packages/rules/src/modules/seafarers/pirateIslands.ts` (new), `index.ts`, `state.ts`, `ships.ts`, `islands.ts`, `gold.ts`, `messages.ts` | presets, fortress lock (production, gold, score, city), beachhead and setup building, the ship line with the shortest path and the fallback, hints, projection, `E_SHIP_LINE` |
| Profile | `packages/rules/src/profiles.ts` | `topologyId: sf-pirate-islands`, `stuckLineBacktrack`, `implemented` |
| Web | `components/SvgPirateIslands.tsx`, `board/three/DioramaPirateIslands.tsx`, `board/three/diorama-pirate-islands.ts` (new); `SvgBoard.tsx`, `DioramaSeafarers.tsx`, `PlayersPanel.tsx`, `BoardView.tsx`, `board/seafarers.ts`, `i18n/modules/seafarers.ts` | lair stacks, beachhead discs, the next-target ring, the route in SVG and 3D, fortress and ship-line marks in the player panel, `E_SHIP_LINE` and the pirate texts in zh-Hant and en |
| Evidence | `packages/rules/test/seafarers-pirate-islands.test.ts`, `seafarers-pirate-islands-sim.ts`, `seafarers-pirate-islands-sim.test.ts`, `packages/web/test/seafarers-pirate-islands.test.tsx` | see Verification |

The ship line is reachable in both renderers through the ordinary ship build intent: `legalShips` in the hints already lists
only the legal edges (the line rule is inside `canPlaceShip`), and `pirateLine.target` marks the next target.

## Verification

- Rules (`packages/rules/test/seafarers-pirate-islands.test.ts`, 59 tests; whole suite 74 files, 1307 tests):
  topology (49 hexes, rows 6-7-8-7-8-7-6 on the `sf-forgotten-tribe` outline, Euler, protrusions absent, 8 distinct frame harbour edges)
  and the (-1, -3) shift against the transcribed row ranges; layout checksums (terrain 19/3/2/5×5, 24 discs, the 6 hexes without a
  disc, islands 17/4/2/1/4/2, every transcribed cell, 8 harbour tokens reproducible and varying with the seed, route 14 consecutive
  sea hexes, pirate on the first, robber -1); every preset marker against the two transcriptions (hex lists per vertex and edge);
  presets for 4 players (4 settlement and fortress pairs, 4 ships, 4 fortresses of 3 lairs, 12 lairs) and 3 (no white, 9 lairs), colour to set
  assignment (green, red, blue), deck composition 20 and 25, score 1 before and 3 after setup; setup only on the main island
  (legal vertices, the beachhead refused, whole setups on three seeds), no Longest Road or Largest Army, a 7 only discards (other
  Seafarers scenarios still move the robber); the fortress lock (resources, gold, score, city, ships stopped, 4 of 5 settlement
  pieces); roads and the beachhead (Red's roads from the fortress to the beachhead refused, a forced road path still does not unlock the
  beachhead without the ship line, Blue's coast roads and ships beside its fortress refused, legitimate buildings still extend roads);
  the line (the preset ship is the first line ship, free coastal routes, wrong ship refused with `E_SHIP_LINE`, every colour reaches
  beachhead and fortress with every step cutting the distance by 1 and a simple path, a finished line cannot grow, an emptied line restarts
  only at a coastal building and never at a free ship, no branching, detours around other ships and impassable vertices, backtracking with its
  flag on and off, settlement at the beachhead only after the line arrives and only the own one, line ships fixed and free ships judged when
  moved, setup ships, the robber and knights are refused; round 4: restarting the line from another coastal building, the beachhead-before-fortress order, backtracking checked against the shortened line, the `stuck`/`backtrack` hints, a coastal road that would wall someone off, per-player-count checksums for 3 and 4 players); public view equal for every
  viewer; other scenarios without state, hints or line rules; profile enabled/implemented flags and player counts;
  `seafarers-pirate-islands-sim.test.ts` (2 tests: 12 games for each of 3 policies × 2 player counts, `illegalRoads` 0 and `badEnds` 0, the
  large runs above); `profiles.test.ts` and `seafarers-exports.test.ts` updated for the new key and the implemented flag; backtracking tests (only the end ship can move and only when boxed in, the flag off, the line is cut, step-by-step retreat to no line, a new strict route after backtracking, other scenarios unaffected);
  `message-ids.test.ts` covers `E_SHIP_LINE`.
- Service: no code path is added (the profile is disabled); `seafarers-scenarios-registry.test.ts` still lists the profile as disabled and
  rejects 5 and 6 players with `bad-player-count` and 3–4 with `disabled`; `bots.test.ts` still refuses bot seats with reason `profile`.
- Web (`seafarers-pirate-islands.test.tsx`, 9 tests): SVG board (49 hexes, 8 harbours, 8 buildings and 4 ships for 4 players, 4
  fortresses with 3 lairs and their titles, 4 beachheads, the 14-hex route, no robber, 3 players with 3 fortresses and no white
  pieces), the next-target ring (beachhead first), a recaptured fortress without lair tokens, no layer in other scenarios; 3D helper
  geometry (lair spot beside the fortress on land, beachhead on its vertex, taller stack for more lairs, models built); player panel
  (the settlement count leaves an unrecaptured fortress out, the route has a title, fortress mark as one value `×3` or `recaptured`, ship line mark, no Longest Road, both locales); the new message ids in both locales. The SVG board was also
  rendered once to an image and compared with the printed map (presets, fortress stacks, beachheads, pirate on the bottom row).
  The 3D scene is not rendered in a browser in this slice (the profile is not enabled); only its instance data is tested.
- `pnpm typecheck` passes. The browser evidence script belongs to S7c.

## Limitations

- ~~The 3D renderer does not show the pirate's cruising order~~ — done in S7b (arrows in SVG and 3D, see the S7b section).

- **Dual-renderer evidence is deferred to S7c**: the profile is not enabled in S7a, so there is no lobby path and no browser run; S7c will build a line, move a ship (backtracking) and attack in both the SVG and the 3D renderer in a real browser. S7a only tests the SVG output, the 3D instance data and the hints that both renderers use.

- No human playtest, physical device or screen-reader check; no browser capture in S7a (the profile is not enabled, so there is no
  lobby path; the capture belongs to S7c).
- The shortest-path definition is the user-confirmed reading of SF25 (OQ-3), not a printed rule; the line backtracking is a
  departure from SF25 (I9).
- "Which ships belong to the line" (I4–I5) is our reading of "one continuous line to the western islands … you may create other
  routes around the main island", with the preset ship as the line's first ship.
- The pirate's movement and attacks and the 7's steal step are S7b (below); the warship conversion and the attack on the fortress are S7c.
- ~~The help panel has no scenario text yet~~ — done in S7c (`sf.help.pi.*`, see the S7c section).

---

# Slice S7b: the cruising pirate, its attacks and the 7's steal

Branch `feat/sfx-s7b-pirate-patrol`, stacked on S7a (`feat/sfx-s7a-pirate-islands-board`, PR #234). SF25 p. 16 ("Pirate movement",
"Pirate attacks", "Resolving a 7"; the p. 16–17 spread was re-read from `p16.txt` and `p16.png`). The profile is still
`implemented: true, enabled: false` and the bots still refuse it; S7c adds the warships, the attack on the fortress, the ending and
enables the profile.

## Roll order

`turn.roll` → the Seafarers module's `beforeProduction` (pirate cruises, attacks, then one `seafarers.pirateGift` frame per player who
beat the pirate, then a hidden `seafarers.pirateResume` continuation frame) → production, or the 7 (discards, then
`sevenRobberStep`: the `seafarers.sevenSteal` frame) → gold. Everything is in `modules/seafarers/pirateCruise.ts`; `index.ts` wires the
hooks (`beforeProduction`, `sevenRobberStep`, `resumePending`, `activatePending`, `projectPending`, two commands) and `messages.ts` lists the five new
events. No new error code is needed: the handlers use the base codes (`E_PENDING_EFFECT`, `E_NOT_ACTOR`, `E_INVALID_SELECTION`,
`E_BANK_EMPTY`, `E_NO_ELIGIBLE_VICTIM`, and `E_INVALID_COMMAND` in the other eight scenarios, as `cloth.steal` does).

## Interpretations

| # | Item | Decision | Basis |
|---|---|---|---|
| I23 | Direction, start and state | The pirate moves **clockwise** along the 14-hex route transcribed in S7a, starting on its first hex; the position is only `board.pirate` (route hexes are distinct, so the route index is `route.indexOf(board.pirate)`); there is no extra state and no randomness, so replays are deterministic. The step count is the lower die (both dice equal: that number); it wraps past the last hex to the first (`(index + steps) mod 14`). Hexes passed over have no effect, only the final hex counts. Rolled in every roll, a 7 included. | SF25 p. 16 "Pirate movement" |
| I24 | When | In the Seafarers module's `beforeProduction` hook, i.e. after `turn.rolled` and before production, gold or the 7. Event order in the log: `pirate.cruised`, then one `pirate.attacked` per attacked player, `pirate.gifted` for each pick, and only then `production.resolved` (or `discard.required` for a 7). | SF25 p. 16 "before players Collect Resources or Resolve a 7" |
| I25 | Whose buildings count | Every settlement or city on a vertex of the pirate's hex counts for its owner, the roller included. An **unrecaptured fortress is not "your building"**: it belongs to the pirates (it holds the lair tokens, produces nothing and scores nothing, I2), so it never attracts the pirate; a recaptured fortress (lairs 0, S7c) is an ordinary settlement and counts. This is moot on the printed map: a test checks that **no route hex touches any fortress vertex**, and the route hexes touch only the beachhead vertices (route positions 1, 3, 5, 7: a village built on the beachhead can be attacked) and the preset main-island villages (positions 9, 10, 12, 13). The fortress rule therefore never changes an outcome in S7b; it only matters if S7c's data differed. Ships and roads never count ("buildings"). | SF25 p. 16 "adjacent to one of your buildings", p. 16 note "Pirate fortresses do not produce resources" |
| I26 | Several players on one hex | Each is attacked, starting with the roller and going in seat order (the same order as gold). Losses are resolved at once (random draws on the game rng, in that order); the picks of players who won are queued as frames in the same order and the roll continues only after all of them are answered. | SF25 gives no order; same rule as the gold frame |
| I27 | Strength | Pirate = the lower die (the die used for the move, I23). Player = the number of own warships (`warshipCount` = the length of `pirateIslands.warships[player]`, projected publicly). There are no warships in S7b (the knight is still refused, I15), so every attack is a loss for the player; S7c only fills `warships`. Tests inject warship edges to cover the won and tied cases. | SF25 p. 16 |
| I28 | Lost attack | The player discards 1 random card plus 1 per own city (all cities on the board, not only adjacent ones), each drawn uniformly from what is left of the hand, capped by the hand size; the cards go back to the supply. The public log says how many were due and lost; the exact cards are a private parameter for the victim. For the statistics they are added to the player's `discarded` counter (an expense column, as with the 7), not to robbed/stolen (see I41). | SF25 p. 16 |
| I29 | Won attack | A `seafarers.pirateGift` frame for that player: 1 resource of their choice from the supply (`pirate.gift { resource }`). Only resources the supply still has can be chosen (`E_BANK_EMPTY` otherwise; hints list them as `pirateGift`). If the supply has **none at all**, the player gets nothing, the frame is skipped and the log says so (`pirate.gifted` with `resource: null`). SF25 says nothing about an empty supply; this follows the base rule (a card the supply does not have cannot be taken) and the gold frame. | SF25 p. 16 "receive 1 resource card of your choice from the supply" |
| I30 | Tie | Nothing happens (the attack is logged with `result: 'tie'`). | SF25 p. 16 |
| I31 | The 7 | The robber is still out of the game (no `moveRobber` frame, `robberTargets` empty, layout robber -1). `robberInactive` is **gone** for this scenario so that the engine's own order (discards first, then the module's 7 step) runs; players over 7 cards discard half rounded down as usual, then the roller gets a `seafarers.sevenSteal` frame: `seven.steal { victim }` steals one **uniformly random card** from **any other player who has cards** (no hex, no pirate involved, not limited to neighbours), or `victim: null` to **choose not to steal** (SF25 "may"). With nobody holding a card there is no frame. Hints: `sevenSteal` lists the victims, only for the roller while the frame is active. The pirate's attack of the same roll comes first, so a victim may already have discarded to the pirate before the half-discard is computed. | SF25 p. 16 "Resolving a 7" |
| I32 | Pending queue | `[gift(A), gift(B), pirateResume]` is queued before production; the resume frame has no responders and is resolved by the engine as soon as it becomes active (it is never visible to a client). A gift frame whose supply has gone empty is skipped when it activates. The frames use module kinds `seafarers.pirateGift` (public data: the pirate's strength), `seafarers.sevenSteal` (public data: the victims, whose hand sizes are public anyway) and `seafarers.pirateResume` (no data). | engine pending conventions (gold, fog) |
| I33 | Ships next to the pirate, boxed-in hints | Unchanged rules (S7a): nothing can be placed or moved onto an edge of the pirate's hex, ships already there stay. The pirate's hex is read from `board.pirate` everywhere, so `backtrackBlocked: 'pirate'` and the new-ship restrictions follow the moving pirate (tests: roll the pirate next to a boxed-in line's end ship and read the hint). The shortest-path distances still ignore the pirate (I6), so a pirate that sits beside the end only delays the player. | SF25 p. 2 (pirate blocks ships) |
| I34 | Web | SVG and 3D show the pirate where it is (the existing pirate piece) and add: a clockwise arrow in the middle of every route leg, a gold ring on the pirate's hex, and in SVG a small chip 1–6 on the next six hexes ("a lower die of N brings the pirate here"). Both pickers reuse existing layouts: the supply pick is the gold picker grid (5 resource buttons, same CSS), the 7's steal is a button per victim plus "Do not steal" in the prompt, so desktop and mobile share one component. Log lines and sounds exist in zh-Hant and en (`event.pirate.cruised`, `.attacked`, `.gifted`, `event.seven.stole`, `.stealSkipped`). | spec §6.6, S7a limitation |

## Simulation (the real pirate)

`seafarers-pirate-islands-sim.ts` no longer jumps the pirate: every roll goes through the engine, the sim answers the frames (discards; the
7's steal at random: 1/3 of the time it skips; the gift cannot occur because there are no warships) and counts rolls, attacks, steals and
the turns where the player's line is only held up by the pirate (with the pirate off the board a line extension exists, with it there is none).
Same method and policies as S7a (300 games per player count and policy, at most 60 turns, 2026-11-25, one process on the shared machine):

| Players | Policy | Games | Games with a boxed-in line | Boxed-in players | Backtracks | Still boxed in (route-less) | Stuck players | Rule deadlocks | Wall refusals | inconsistent | badEnds | illegalRoads | Lines done | Out of ships |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 3 | bias 1 | 300 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 0 | 0 | 0 | 0 | 900/900 | 0 |
| 4 | bias 1 | 300 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 0 | 0 | 0 | 0 | 1199/1200 | 1 |
| 3 | bias 0.85 | 300 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 0 | 0 | 0 | 0 | 900/900 | 0 |
| 4 | bias 0.85 | 300 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 0 | 0 | 0 | 0 | 1196/1200 | 4 |
| 3 | bias 0.4 | 300 | 11 (3.7 %) | 11 | 24 | 1 (0) | **1** | 0 | 0 | 0 | 0 | 0 | 825/900 | 72 |
| 4 | bias 0.4 | 300 | 12 (4 %) | 13 | 10 | 12 (5) | **12** | 0 | 0 | 0 | 0 | 0 | 1123/1200 | 62 |

| Players | Policy | Rolls | Attacks | Steals (7) | Line held up only by the pirate (turns / turns with a line extension) |
|---|---|---|---|---|---|
| 3 | bias 1 | 3,957 | 1,100 (0.28 per roll) | 456 | 133 / 3,394 (3.9 %) |
| 4 | bias 1 | 5,661 | 1,842 | 641 | 252 / 4,577 (5.5 %) |
| 3 | bias 0.85 | 4,553 | 1,218 | 501 | 152 / 3,892 (3.9 %) |
| 4 | bias 0.85 | 6,557 | 2,116 | 727 | 263 / 5,190 (5.1 %) |
| 3 | bias 0.4 | 10,687 | 3,595 | 1,200 | 354 / 6,905 (5.1 %) |
| 4 | bias 0.4 | 12,829 | 5,183 | 1,405 | 515 / 9,004 (5.7 %) |

Reading:

- The rule checks all stay at 0 (`inconsistent`, `badEnds`, `illegalRoads`, rule deadlocks, wall refusals): the moving pirate never makes the engine accept an illegal line, road or end.
- The line-focused policies complete every line (all but 5 of 4,200 lines; those ran out of the 15 ships of the supply). With many random free ships (bias 0.4) 3.7 % (3 players) and 4 % (4 players) of the games have a boxed-in line and 1 and 12 players end stuck (5 of the 12 route-less). **S7a measured 1 and 7 for the same policy with a pirate that jumped at random**; the two runs use different random streams (the pirate no longer draws from the sim's rng and every 7 now steals), so the runs are not paired and the change from 7 to 12 is within what a different stream gives; the pirate does not cause stuck players (the check ignores it), it only delays a line for a few turns. **Known limitation, unchanged** (I17): lines of two players can wall each other; S7c will change the board again when a failed attack removes ships.
- The pirate delays a line extension in about **4–5.7 % of the turns where an extension exists and the player still has ships** (round 2: players who already used all 15 ships are no longer in the denominator); it never blocks a line for good because the pirate moves every roll (at most a 14-turn cycle, and in practice the lower die moves it 1 to 6 hexes per roll).
- Hint cost with the real pirate: about 1.5–2.0 ms per `actionHints` call (the machine was less loaded than for the S7a run, so it is not comparable).

## What was built (S7b)

| Area | Files | Notes |
|---|---|---|
| Rules | `modules/seafarers/pirateCruise.ts` (new), `pirateIslands.ts` (`warships`, `warshipCount`), `index.ts`, `messages.ts` | cruise, attack, gift and 7 frames, hints `pirateGift` and `sevenSteal`, projection of the frames and `warships` |
| Web | `board/seafarers.ts`, `components/SeafarersPrompt.tsx`, `components/SvgPirateIslands.tsx`, `board/three/diorama-pirate-islands.ts`, `board/three/DioramaPirateIslands.tsx`, `board/three/DioramaSeafarers.tsx`, `audio/cues.ts`, `i18n/modules/seafarers.ts`, `i18n/modules/seafarers-events.ts`, `styles/seafarers.css` | route arrows and position ring (SVG and 3D), the two pickers, log texts and sounds |
| Evidence | `test/seafarers-pirate-islands-patrol.test.ts` (new, 29 tests), `seafarers-pirate-islands.test.ts` (+1), `seafarers-exports.test.ts` (D7, +1 and the new hint keys), `seafarers-pirate-islands-sim.ts` and `.test.ts`, `packages/web/test/seafarers-pirate-patrol.test.tsx` (new, 11 tests) | |

## Verification (S7b)

- Rules, `seafarers-pirate-islands-patrol.test.ts` (29): steps (lower die, equal dice, wrap, helper functions, a run of seven rolls), the base rule that ships cannot be placed on the pirate's hex, attacks (adjacent only, 1 random card back to the supply with the private detail, no attack on empty hexes, per-city extra discards that count cities anywhere, a short hand, an empty hand, several players in roller-then-seat order, unrecaptured and recaptured fortresses and the map fact that no route hex touches a fortress, the four preset villages' hexes), a stronger player (frame, hints, public view, supply decrement, production only afterwards), pick errors, an empty supply, a tie, win + loss mixed on one hex with queued frames, event order; the 7 (pirate first, discards, steal from any player with cards, skip, no victims, no `moveRobber`, attack before discard, gift before discard) and determinism (a twelve-roll replay and a JSON round trip).
- `seafarers-pirate-islands.test.ts` (+1): the boxed-in hint reads `'pirate'` after a real roll moved the pirate beside the end ship and clears when it moves on.
- `seafarers-exports.test.ts` (D7): the eight other scenarios keep the pirate in place, have no new events or frames, no new hint keys, the 7 still opens their own step, and `pirate.gift` / `seven.steal` are `E_INVALID_COMMAND` (or `E_PENDING_EFFECT` with a frame open) there; the key sets of the view, hints and module state are unchanged.
- Rules whole suite: 75 files, 1,338 tests pass (S7a: 74 files, 1,307). `pnpm typecheck` passes (rules, bots, protocol, web, server). Server `seafarers-scenarios-registry` and `bots` tests and the bots `support` test still refuse or hide the profile.
- Web `seafarers-pirate-patrol.test.tsx` (11): SVG route arrows (14, consecutive and closing), position ring and step chips (also across the wrap), no layer elsewhere; 3D arrow geometry (direction in three.js' Y rotation, tip towards +x, ring model); the gift picker (disabled for resources the supply lacks, submits `pirate.gift`, hidden from others, both locales); the 7's picker (one button per victim, skip sends `victim: null`); log lines for the cruise and the three outcomes, the supply pick and the 7's steal in both locales; sounds. All 13 web `seafarers*` files (170 tests), `i18n`, `audio-cues`, `audio-board`, `audio-ui` pass.
- Not done: no browser run or screenshot (the profile is not enabled; S7c). The new 3D arrows and ring are tested as geometry and instance data only.

## Review round 1 fixes (S7b)

| # | Item | Decision |
|---|---|---|
| I35 | D7: scenario-only commands (`commandScenarios`) | `pirate.gift` and `seven.steal` are registered **only in the pirate islands**. `RulesModule.commandScenarios` maps a command type to the one scenario that has it; `moduleCommandTypes`, `dispatchModuleCommand` and the pending gate (`modulePendingCommand`) honour it. Every other profile, the two `sf-2025.2` New Shores profiles included, neither lists the commands (protocol validation) nor lets them through a pending frame, so they answer exactly like a profile without the module (`E_INVALID_COMMAND`, or `E_PENDING_EFFECT` with the base params). The handlers no longer check the scenario themselves. Test: `seafarers-exports.test.ts` compares both `sf-2025.2` profiles with a base game, with and without a pending frame. |
| I36 | The board keeps the pre-roll projection while the dice are shown | The pirate's new hex would reveal the lower die before the dice settle. `rollChangesBoard` (`web/src/state/table.ts`, the existing hold used for C&K and cloth) now also holds the board for scenarios with `pirateIslands`; SVG and 3D both draw from the held board, so the pirate, the position ring and the step chips stay on the old hex until the dice presentation ends. Test: `dice-hold.test.tsx`, a `2 + 5` roll, snapshot-first and events-first. |
| I37 | Passing a hex does not attack | Only the hex where the pirate ends counts (I23). Test: four players, `route[7]` with `4 + 6` passes P1's village at `route[9]` and stops at `route[11]`: no attack event, P1's hand unchanged. |
| I38 | Snapshot and restart with an answer pending (spec §11.3) | Test: `2 + 5` leaves a `pirateGift` frame with the hidden continuation queued; the state is serialized and restored, the pick runs the continuation exactly once (one `pirate.cruised`, `pirate.attacked`, `pirate.gifted` in the log, no leftover queue), then the `sevenSteal` frame survives a second restore and the steal gives the same state as the run without restarts. |
| I39 | Small fixes | The 3D route arrows sit at `SEA_LEVEL + 0.012` like the route marks and the position ring (the test asserts `position[1]`). A victim with an empty hand no longer logs `(—)` in the attack line (web formatting, both locales). |

Test numbers after the fixes: rules whole suite 75 files, 1,341 tests (was 1,338); `seafarers-pirate-islands-patrol.test.ts` 31 tests, `seafarers-exports.test.ts` 18; web `dice-hold` 23, `seafarers-pirate-patrol` 11, all 13 `seafarers*` files 170; server registry, bots, seafarers-bots and recovery tests and the bots `support` test pass; `pnpm typecheck` passes.

Limitation: **the server restart path cannot be tested for this scenario until S7c enables the profile** (the lobby and `createGame` in the service refuse a disabled profile). The restart evidence is rules-level (state serialized and restored before the next command); S7c should add a server recovery test with a pending `pirateGift` and `sevenSteal`.

## Review round 2 fixes (S7b)

| # | Item | Decision |
|---|---|---|
| I40 | Pirate answers keep the dice presentation | A `seafarers.sevenSteal` or `seafarers.pirateGift` frame opened right after the roll made `useBoardAnimation` treat the roll as overtaken by a required action and clear the dice queue, so the pirate jumped at once. The rules now mark both frames' public data with `fromRoll: true` ("this answer was caused by the roll"); the client treats any module frame with `data.fromRoll === true` like a discard or a 7's robber step and keeps the last roll of the packet, **any total** (a gift can follow a non-7). Other module frames carry no such flag, so every other scenario behaves as before (D7; test: `seafarers.gold` and a frame without the flag still clear the dice). Test: `pirate-roll-presentation.test.tsx` (2 + 5 with a victim and nobody over 7 cards, a gift after 2 + 2). |
| I41 | Statistics | Cards the pirate takes are added to the player's **discarded** counter (an expense column, as with the 7); a resource taken from the supply for beating the pirate is income in a new optional counter `supplyPicks` (created on first use, absent in other scenarios; `GameStats` shows a "Pirate prize" column only when someone has one, zh-Hant 海盜戰利品). The 7's steal already used stolen/robbed. Tests: red holds 1 grain, `2 + 2` from `route[7]`: lost first, then 1 grain produced, hand 1, `discarded.grain` 1, `produced.grain` 1; a gift counts in `supplyPicks` and the hand equals the income; `game-stats.test.tsx`. |
| I42 | Attack before production, with real production | The red preset village touches the 4-disc fields hex. Tests with the real disc layout: an empty-handed red is attacked (nothing to lose), then produces 1 grain and ends with 1 grain (an early grant would have lost it); with 1 grain it loses it first and then gets 1. |
| I43 | Simulation denominator | `lineTurns` now skips turns of players who have used all 15 ships (4 players, seed 8, bias 0.4 had 6 of 38 such turns). Table above re-measured (300 games per cell); the other columns did not change. |

Test numbers after round 2: rules whole suite 75 files, 1,344 tests; `seafarers-pirate-islands-patrol.test.ts` 34; web `pirate-roll-presentation` 3, `game-stats` 13, `dice-hold` 23, `board-animation*` 23, `seafarers-pirate-patrol` 11, all 13 `seafarers*` files 170; server registry, bots and recovery pass; `pnpm typecheck` passes.

## Review round 3 fixes (S7b)

| # | Item | Decision |
|---|---|---|
| I44 | The player panel during the dice presentation | `holdForRoll` now also fills `rollHold.seafarers` for the pirate islands, so the panel (`PlayersPanel`, which reads `shownSeafarers`) keeps the pre-roll view **and hints**: the boxed-in text (`pirateLine.backtrackBlocked: 'pirate'`) no longer shows where the pirate landed. Other readers checked: `SeafarersPrompt` and the pending prompt return nothing while follow-ups are held; the board uses the held board (I36); the log hides events after the roll. Test: a boxed-in line and a `2 + 6` roll, the `line-stuck` text stays "boxed in" during the presentation and becomes the pirate text afterwards. |
| I45 | D7 regression with a real non-7 | The earlier "non-7" case rolled `3 + 4`; it now rolls `2 + 4` (asserted) in `seafarers-exports.test.ts` and in the patrol test. |
| I46 | Sounds | `pirate.attacked` with `count: 0` (nothing was taken) plays no theft cue, and `pirate.gifted` with `resource: null` (empty supply) no pick cue; one test each. |
| I47 | Documentation | I28 now agrees with I41 (pirate losses are added to `discarded`). |

Test numbers after round 3: rules `seafarers-exports` 18, `seafarers-pirate-islands-patrol` 34, `seafarers-pirate-islands` 60, `message-ids` 5; web `seafarers-pirate-patrol` 13, `dice-hold` 23, `pirate-roll-presentation` 3, `audio-cues` 16, `i18n` 24, `game-stats` 13, `scoreboard-hover` and all 13 `seafarers*` files 172; `pnpm typecheck` passes.

## Review round 4 fixes (S7b)

- The random draws are now tested so that "always take the first card" fails: an attack on a hand of 2 lumber and 1 brick with the scripted index 2 takes the brick (index 1 takes a lumber); a 7's steal from a victim with wool, grain and 2 ore takes the grain at index 1 and the ore at index 3 (`seafarers-pirate-islands-patrol.test.ts`, now 36 tests).
- English "1 was owed" / "N were owed" (`sf.pirate.outcome.shortOne`); zh-Hant has no plural and the same text for both keys.
- Not accepted, already planned: the scenario help panel text stays in S7c (see Limitations: "The help panel has no scenario text yet (S7c)").
- Tests: rules patrol 36; web `seafarers-pirate-patrol` 13 and `i18n` 24; `pnpm typecheck` passes.


---

# Slice S7c: warships, the attack on the fortress, recapture, the ending, and the profile is enabled

Branch `feat/sfx-s7c-warships-recapture`, stacked on S7b (`feat/sfx-s7b-pirate-patrol`, PR #235). SF25 p. 17 ("Warships", "Conquering a pirate
fortress", "Winning the game"; `p17.txt` and `p17.png` re-read). `sf-pirate-islands-2025` is now `implemented: true, enabled: true`
(lobby, server rooms for 3 and 4 players, `message-ids`, `profile` and `scenario` texts); bot seats are still refused
(`E_INVALID_BOT`, reason `profile`). Code: `modules/seafarers/pirateWarships.ts` (new), hooks in `modules/seafarers/index.ts`.

## Hooks used

| Rule | Engine hook | Notes |
|---|---|---|
| Knight to warship | `moveBandit` (the knight path of `playKnight`) | the module answers `{ ok, hex: null, candidates: [] }`; the engine then removes the card, counts it as played and emits `dev.knight` as for a pirate move (`pirate: true`, `hex: null`); `warship.converted` follows. The base checks (one development card per turn, a card bought this turn cannot be played) are the engine's own. A refusal (`E_NO_WARSHIP_TARGET`) comes before the card is taken |
| Attack | `onEndTurn` (called by `turn.end` before the turn passes) | see I49 |
| Ending | `winCause` (the S8 hook) + `GameEndCause` `fortressRecaptured` | evaluated by the engine's `checkVictory` for the current actor, so "at any point during your turn" is every place the engine already checks (after builds, ship moves, the attack, and when the turn opens) |

## Interpretations

| # | Item | Decision | Basis |
|---|---|---|---|
| I48 | Which ship becomes a warship | The first ship of the line **in line order from the start** that is not a warship yet (the preset ship is the line's first ship, I4). Free coastal ships and offshore ships outside the line are never converted. The ship stays where it is, stays part of the line and keeps counting for the shortest-path rules; a warship is recorded by its edge in `pirateIslands.warships` (already projected publicly in S7b). With no ordinary line ship (no line ship at all, or all are warships) the knight is **refused with `E_NO_WARSHIP_TARGET`** and stays in the hand, the turn's card slot is not used. The command carries no target hex (`hex: null`; a hex is `E_INVALID_COMMAND`), because there is no robber or pirate to place. Before the roll and after it, like any knight. Knights are not counted for Largest Army (disabled in this scenario) and `stats.robberMoves` is still incremented by the engine's knight path (a statistics counter only) | SF25 p. 17 "Warships"; replaces I15 |
| I49 | When the attack happens | **When the player presses end turn** (`turn.end`, hence also when a turn timer or the server ends the turn): `onEndTurn` runs the attack if the own line is `done` and the own fortress still has lairs, then the turn ends as always ("Your turn ends after attacking the fortress"). It is automatic and cannot be declined, as decided in the spec (§6.6, "行動階段結束時自動進攻"). It is not run for a player whose fortress is already recaptured or whose line is not complete. The die is one draw of the game rng (`rng.int(6) + 1`), so a replay or a restart reproduces it. A recapture that reaches 10 VP ends the game at once (the module defers the end of the turn) and the other players never see the next turn | spec §6.6; SF25 p. 17 "At the end of the Action phase when your route reaches the pirate fortress in your color, you attack" |
| I50 | The player's strength | Against the fortress: the **warships on the line** (`lineWarships`, the line edges that are warships). Against the cruising pirate (S7b, I27): every warship of the player (`warshipCount`). They differ only for a warship that left the line by the backtracking move (I9, I52); the SF25 sentences are "the number of warships in your route" (fortress) and "the number of warships you have" (pirate) | SF25 p. 16 and p. 17 |
| I51 | Removed ships | A lost attack takes the last 2 (a tie: the last 1) edges of the line (the ones closest to the fortress, because a finished line ends at the fortress, I7); fewer if the line is shorter. The ships go back to the supply (the road slots are cleared, so `countShips` drops and they can be built again), and warships among them are gone. The line, its end, `next` target (back to the fortress, in theory also the beachhead), `done`, the hints and the stuck/backtrack state are all derived from the remaining edges, so there is nothing else to keep consistent: tests check the target after a loss, that every old edge is a legal strict extension again, that the line can be rebuilt to `done`, and the hint keys. The no-wall rule (I17) is a rule about placements and is not applied to a removal (a removal only empties edges); the restart rule (I4, I5) can matter only when the whole line is gone, which a single attack cannot cause (a finished line has 9 ships) | SF25 p. 17 |
| I52 | A warship that is moved back | A warship at the end of a boxed-in line may be moved with `ship.move` (I9). It **stays a warship** (the record follows the piece to its new edge, `moveWarship`), because the piece is the same; it then no longer counts against the fortress if it is not on the line. SF25 says nothing about backtracking at all | extension of I9 (user decision) |
| I53 | Recapture | When the last lair is taken the fortress is an ordinary settlement, with no new state: production, gold, score (the lock in `score`), the city upgrade (`allowCity`) and roads (`roadAllowed`) follow `fortressLocked`, as prepared in S7a (I2, I3). It can be attacked by the cruising pirate only if a route hex touches it (none does, I25). **When every fortress on the board is recaptured** the pirate is removed from the game: `board.pirate = null`, event `pirate.removed`; later rolls do not cruise or attack (`cruise` returns at once), placement near the old hex is free (`touchesPirate` is false), the route is not drawn any more in either renderer, and the 7's steal remains (it never involved the pirate) | SF25 p. 17 note |
| I54 | The ending | `winCause` answers for every player: `fortressRecaptured` when the actor's own fortress has 0 lairs and the score (hidden VP cards included) is at least the profile's 10; `null` otherwise, so 10 VP alone never ends the game and a recapture alone does not either. Only the actor's own turn is judged (the engine's `checkVictory`): a player who passes 10 VP on an opponent's turn wins when their own turn opens. Result: `reason: victory`, `cause: fortressRecaptured`, `playerIds: [winner]`; `game.finished` carries `playerIds`, `cause` and `score` and no `target` (the `endGame` path of S6 and S8) | spec §6.6; SF25 p. 17 |
| I55 | Output of other profiles | The default victory path is untouched: `winCause` returns `undefined` outside this scenario and the wonders scenario, `GameEndCause` only gains a value, `game.finished` is unchanged for every other cause (`seafarers-exports.test.ts` D7 and the S8 tests). The result screen treats the new cause like the wonder endings (no "victory target" line, but the score line keeps the target because 10 VP is part of the condition); the seat header and the help panel state the condition ("recapture your fortress and have 10 VP") | S8 precedent |
| I56 | 4 players and the deck | The 4-player deck has 19 knights (S7a, I11), the 3-player deck 14; every knight is a warship conversion, so warships are bounded by the deck and by the 15 ships. Nothing else in the deck changes | SF25 p. 16 |
| I57 | Web | A knight in the hand sends `dev.playKnight { hex: null }` at once (no board selection), the button reads "Convert a ship (knight)" and the card text says what it does; with no ordinary line ship the button is disabled with a `title`, a visually hidden `warship-blocked` text and the reason in both locales. The player panel gets "Warships: n (m on the ship line)" and a line that ending the turn attacks the fortress. SVG: a warship is the cog turned 90 degrees with a row of gun ports and a red pennant; 3D: the cog model heeled over 80 degrees with guns and a pennant; a recaptured fortress shows a gold-ringed banner (SVG) or a banner on a plinth (3D) where the lair stack stood; with the pirate removed neither renderer draws it or the route. Log lines, sounds, help text, result text and `E_NO_WARSHIP_TARGET` exist in zh-Hant and en | spec §7 |
| I58 | Departures from SF25 that are the user's decisions (also in `docs/FIDELITY.md`) | I9 (a boxed-in line may move its end ship back), I17 (nobody may wall off a target; a player's own strict shortest extension is exempt) and I21 (no settlement on another player's ship line) are **user decisions of 2026-11-24 that SF25 does not contain**; the shortest-path definition (I6, OQ-3) is the **user-confirmed reading** of "must take the shortest path". Everything else in S7c follows SF25 p. 17 literally | user decisions 2026-11-24 |

## Simulation (S7c): full games to a winner, and the stuck-player re-measurement

`seafarers-pirate-islands-sim.ts` gained a **full game** mode (`full: true`, also used by `seafarers-sim.ts`' hints for the scenario): the same random legal
play as before (setup, a roll with every frame answered, 3 to 6 actions per turn) plus the S7c actions: buy development cards while the line has fewer than 4
warships and the deck still holds knights, play a knight on the first ordinary line ship (`dev.playKnight { hex: null }`), complete the last line step only
with 4 warships on the line (or when no knight is left), build cities and any legal settlement (so 10 VP is reachable), and answer the gold frame. The hand is
refilled **from the supply** to 6 of each resource before every action (the S7a/S7b line mode still refills without touching the supply), so bank + hands is
conserved. Games run until `state.result` or 400 turns. Every game must end with a winner whose `cause` is `fortressRecaptured`, the supply must be conserved
and no player may own more than 15 ships. 300 games per player count, bias 0.4, seeds 1..300, 2026-11-25, one process (niced, on the shared machine):

| Players | Games | With a winner | Winner cause | Rolls (avg per game) | Knights converted | Fortress attacks (won / lost / tied) | Recaptures | Supply not conserved | Over 15 ships | inconsistent | badEnds | illegalRoads | rule deadlocks |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 3 | 300 | **300** | `fortressRecaptured` | 10,311 (34.4) | 2,763 | 2,121 (1,228 / 595 / 298) | 302 | 0 | 0 | 0 | 0 | 0 | 0 |
| 4 | 300 | **300** | `fortressRecaptured` | 13,045 (43.5) | 2,381 | 2,872 (1,620 / 844 / 408) | 384 | 0 | 0 | 0 | 0 | 0 | 0 |

Other policies (100 games per cell, same method; `PI_SIM_FULL_BIASES=1,0.85`):

| Players | Policy | Games | With a winner | Rolls | Knights converted | Fortress attacks (won / lost / tied) | Recaptures | Stuck players | Boxed-in players | Backtracks | Out of ships | Supply not conserved | Over 15 ships | inconsistent / badEnds / illegalRoads |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 3 | bias 1 | 100 | **100** | 2,437 | 1,067 | 1,077 (516 / 388 / 173) | 101 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 0 / 0 |
| 3 | bias 0.85 | 100 | **100** | 2,602 | 1,038 | 1,097 (517 / 387 / 193) | 103 | 1 | 1 | 3 | 1 | 0 | 0 | 0 / 0 / 0 |
| 4 | bias 1 | 100 | **100** | 3,263 | 935 | 1,320 (622 / 465 / 233) | 127 | 0 | 0 | 0 | 3 | 0 | 0 | 0 / 0 / 0 |
| 4 | bias 0.85 | 100 | **100** | 3,507 | 863 | 1,254 (608 / 439 / 207) | 127 | 0 | 0 | 0 | 6 | 0 | 0 | 0 / 0 / 0 |

(Every game ends before every fortress is recaptured, so the pirate never leaves in the simulation; that path is in the rules tests and the browser run. Recaptures
can exceed the games because two players may recapture before one of them reaches 10 VP.) Hint cost under load: about 5.7 ms per `actionHints` call.

**Stuck players, re-measured with S7c** (spec §11.2: failed attacks remove ships and change the board again). Same definition as S7a and S7b (players at the end of a
game whose line is unfinished, who still have pieces, no legal extension and no end ship that can go back), bias 0.4, 300 games per player count:

| | 3 players | 4 players |
|---|---|---|
| S7a (pirate jumps at random, no attacks) | 1 | 7 |
| S7b (cruising pirate, no attacks on the fortress) | 1 | 12 |
| S7c, the S7a/S7b line policy under the S7c rules (a finished line attacks at every end of turn with no warships, so every attack is lost and 2 ships are removed; games run 60 turns) | **5** (6 still boxed in, 0 route-less) | **6** (6 still boxed in, 4 route-less) |
| S7c full games (to a winner, about 34 and 44 rolls) | **2** (5 still boxed in at the end, 3 route-less) | **8** (9 still boxed in, 6 route-less) |

Line-policy columns of the same run: boxed-in line seen in 17 (3 players) and 8 (4 players) of 300 games, 28 and 7 backtracks, 236 and 133 players out of the 15 ships (they rebuild after
every lost attack), rule deadlocks, wall refusals, `inconsistent`, `badEnds` and `illegalRoads` all 0. The line policy is not comparable with S7a/S7b: in those runs a
finished line stayed finished, now it loses ships each turn, so the stuck count measures a different dynamic (a rebuilt line meets other players' free ships and lines more often). The
rates are small (0.6 % and 0.5 % of player lines for the line policy; 0.2 % and 0.7 % of players in full games), none is caused by the removal itself (the line, its target and the hints stay
consistent after a removal, tested), and `inconsistent`, `badEnds`, `illegalRoads` are 0. **Known limitation, unchanged** (I17): lines of two players can wall each other, and
only the backtracking move helps; with S7c a failed attack also reopens edges, which is why the numbers are in the same range as S7b rather than higher.

## Browser evidence (S7c)

`scripts/seafarers/capture_pirate_islands.py` with `scripts/seafarers/pirate_fixture.mjs` (a test-only board preparation that uses the rules engine's own commands:
`line`, `wall`, `ring`, `check`), against the built service, Playwright with software WebGL. Real games through the real UI and API; the service state is read back after
every UI command. `docs/screenshots/seafarers-pirate-islands/report.json` lists **22 cases with sha256 and 0 page errors**; 16 captures are kept (`committed: true`).

| Step | Renderer | What was done and checked |
|---|---|---|
| Lobby | desktop | Seafarers, The Pirate Islands: only 3 and 4 players are selectable |
| Maps 3 and 4 players | SVG, 3D, phone (4) | 49 hexes, 8 harbours, one fortress with 3 lair tokens and one beachhead per player, 14 route arrows, the pirate on the first hex; 3D by the canvas probes `lairStacks`, `beachheadMarkers`, `routeArrows` |
| Setup | API | `check`: every starting settlement on the main island, 3 villages each beside the preset, 4 fortresses of 3 lairs, one ship per line |
| Ship line | SVG, 3D, phone | one line ship built by the UI in SVG and one in 3D at the engine's shortest-path steps; the next target is ringed |
| Boxed in and backtrack | SVG (panel text), 3D (`ship.move`) | other players' ships around the end of the line; the panel offers the move; the end ship is moved back in 3D (the line gets shorter, `ship.moved` in the log) |
| Cruise and attack | SVG | every die result lands beside one of player 1's buildings: `pirate.cruised`, then `pirate.attacked` (0 warships, lost); the 7 prompt is answered when it comes up |
| Supply pick | 3D | with 9 warships the attack is won: the 5-button picker, one ore taken (`pirate.gifted`) |
| Knight to warship | SVG | the knight card raised ("Convert a ship (knight)"), 4 warships on the first 4 line ships, `robber` stays -1 |
| Fortress attack | SVG | ending the turn attacks automatically: the die, warships on the line and the result match the rules (this run: die 1 against 4 warships, a win) |
| Knight blocked | 3D | every line ship is a warship: the button is disabled and the reason is written on the card |
| Recapture | SVG, 3D | the last lair is taken: no lair stack, a banner; the game goes on |
| Pirate leaves and the win | SVG, desktop and phone | every fortress recaptured: `pirate.removed`, `board.pirate` null, the pirate and its route are gone from the final board; 10 VP: `cause: fortressRecaptured`, result screen without overflow on a phone |

**Looked at by eye (SVG and 3D), problems found and fixed:**

1. **3D lair stacks hidden** (S7a code, first seen here): the stack was placed inside the hex towards its centre and the terrain models (mountains) covered it on the gold-mountains
   fortress. It now stands along the shore in front of the fortress (towards the camera), and every stack and the recaptured banner carry a tall flag (black skull flag, red banner
   with a gold stripe) so they show from any angle. Checked on all four fortresses and on the recaptured one.
2. The 3D warship (heeled 90 degrees) read as a red slab from the camera: it is heeled 70 degrees, has a row of four gun ports with bright frames and a furled white sail.
3. The knight button was only disabled with a tooltip: the reason is now visible text on the raised card.
4. The test-only fixture first put buildings on sea vertices (they floated in the water); the fixture now chooses coastal vertices. This was the fixture's fault, not the product's.
5. Checked without change: the S7b route arrows and the position ring (SVG: arrows on every leg and the dashed ring; 3D: arrows and ring on the water at sea level), the S7a beachhead
   discs (SVG and 3D, on the coast of the pirate islands, not floating) and the preset villages and ships on the main island in both renderers.

## Verification (S7c)

- Rules: `seafarers-pirate-islands-warships.test.ts` (25 tests): conversion (the first ordinary line ship, the second one next turn, card removed, no robber), one development card per turn and a card
  bought this turn, refusal without an ordinary ship (card kept) and without a line, a hex argument refused, no Largest Army, the deck; the four attack results (win, loss of 2, tie of 1, removed
  warships reduce the count), only line warships count, no attack without a finished line or after the recapture or for another player, determinism of the die; line consistency after a removal (target, every
  old edge a legal extension again, hints, rebuild to `done`); a moved warship stays a warship; recapture (score, no pirate removal while others remain, production, city, road), pirate removal and no more cruise, the
  ending with the negative cases (10 VP alone, a recapture alone, another player's turn), the win at any point (a city), warships against the cruising pirate, snapshot equality. `seafarers-pirate-islands.test.ts` updated
  (the knight test, the enabled profile). Whole suite **76 files, 1,376 tests** pass (1,372 before the four simulation-suite tests added last) (S7b: 75 files, 1,344); `message-ids` covers the new events and `E_NO_WARSHIP_TARGET`; D7 is unchanged (`seafarers-exports.test.ts`).
  `seafarers-pirate-islands-sim.test.ts` (3 tests) includes the full-game run (12 games per player count by default; 300 for the table above).
- Server: `seafarers-pirate-islands.test.ts` (7 tests): listing and selectability, rooms for 3 and 4 players and 5 and 6 refused (`bad-player-count`), a bot seat refused (`E_INVALID_BOT`, reason `profile`), the starts for 3 and 4 players,
  **a restart with a pending `pirateGift` (continuation queued) that is answered afterwards and resumes the roll exactly once, a restart with a pending `sevenSteal` (S7b's deferred item)**, and a whole game from the ship line to the end-of-turn attack, recapture and the 10-point win (room `completed`).
  `seafarers-scenarios-registry.test.ts` now lists all eight scenarios as enabled (3-4 players, no bot seats, 5-6 refused); `rooms`, `session`, `bots` updated. Whole server suite 43 files, 445 tests (20 skipped as before).
- Web: `seafarers-pirate-warships.test.tsx` (14 tests): SVG warship and title, 3D flag and heeled model, the recaptured banner, the removed pirate and route, the knight button (no target, label, disabled with a visible reason, other scenarios unchanged), the player panel (warships, win condition),
  log lines for the attack results, recapture, pirate leaving, warship and the knight, the ending, cues, ids in both locales, the help panel (6 rules, no robber wording), the result screen. `seafarers-pirate-islands.test.tsx` (lair spot along the shore, flag), `rulesets.test.ts` (the lobby lists the scenario).
  Whole web suite 92 files, 1,178 tests; one lobby test timed out once under load (`lobby.test.tsx`, passes alone, 15 of 15).
- Bots: `support.test.ts` and the server `bots.test.ts` still refuse the profile (`profile`). `pnpm typecheck` passes.

## Limitations (S7c)

- No human playtest, physical device or screen-reader check. The browser run is Chromium with software WebGL; phone evidence is a 390 x 844 viewport.
- The SF25 text gives no rule for a boxed-in line (I9), walling (I17) or villages on another line (I21): these are the user's decisions and are in `docs/FIDELITY.md`. The attack on the fortress cannot be declined (spec decision, I49).
- The knight path of the engine still increments the player's `robberMoves` statistic and `playedKnights` (the latter is the real count of knights played).
- A removed pirate never happens in the random simulation (the game ends at the first win); it is covered by the rules tests and the browser run.
- Hard bots and any bot seat in this scenario remain out of scope.
