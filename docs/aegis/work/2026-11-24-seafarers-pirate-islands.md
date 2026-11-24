# Seafarers scenario S7a: The Pirate Islands, board, presets and the western ship line

Advisory work record for slice **S7a** of
[the scenarios spec](../specs/2026-11-22-seafarers-scenarios.md) (§2.3, §5.2–§5.4, **§6.6**, §7.3–§7.5, §9 OQ-3,
§10 and §11.2 SFX-S7). Branch `feat/sfx-s7a-pirate-islands-board`, based on `origin/release/v0.4.6`
(S0–S6 and S9 merged; S8 is on another branch). Profile `sf-pirate-islands-2025` (3 and 4 players on one shared map,
rule version `sf-2025.3`). **The profile is not enabled by this slice**: `implemented: true`, `enabled: false`; S7b adds the
cruising pirate and its attacks, S7c the warships, the attack on the fortress and the ending, and enables the profile.

S7a covers the map, the preset pieces, the beachhead markers, the fortresses (state, no production, no score, no city), the
development-card deck, the starting-settlement restriction, the western ship line with the shortest-path rule (OQ-3 as
confirmed by the user), the line fallback flag and its measurement, and both renderers.

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
| I3 | Where settlements may go | Starting settlements: only vertices all of whose land hexes are on the main island (`allowBuilding`, setup). Later: the main island as usual; on the pirate islands only the player's **own beachhead** vertex, and the base connection rule still needs an own ship at that vertex, which is exactly "after your line of ships reaches your beachhead marker". Other players' beachheads and every other pirate-island vertex are refused. | SF25 p. 16 "You may build on the main island as normal. The remaining islands are considered pirate islands", p. 17 "Building on the pirate island" |
| I4 | Which ships belong to the line | A ship on a sea edge that **touches no main-island land hex** (`isLineEdge`) belongs to the western ship line; a ship on an edge that touches the main island is one of "the other routes around the main island" and is free. The preset ships (the first ship of every set) are free; both of their ends touch the main island, so they can feed the line. | SF25 p. 16 "You may create other routes around the main island"; spec §2.3 (line only to the west islands, other routes free) |
| I5 | Where the line begins | A line ship without a line yet must attach at a vertex that touches the main island and holds an own building or an own ship (the free coastal routes included, the fortress and beachhead excluded). The first line ship fixes `start`; later line ships must attach at the line's current end. | SF25 p. 16 "begin at one of your coastal buildings on the eastern island"; spec §2.3 |
| I6 | The shortest path (OQ-3, confirmed by the user) | Every new line ship must make the distance from the line's end to the **next target** (the beachhead first, then the fortress) smaller by exactly 1. The distance is a breadth-first count over **currently empty** line edges (sea edges not touching the main island, no ship on them), never through a vertex held by another player's building; the pirate's temporary restrictions are not counted. The distance is from the *current end*, so when another player's ship blocks the shortest route the detour's every step is legal, and several shortest paths are all allowed. The new end's distance is checked equal to the old one minus 1 on every step in the tests. | spec §6.6, OQ-3; SF25 p. 16 "must take the shortest path" |
| I7 | One line, no branching | The line is the ordered list of the player's line ships. A line ship must attach at the end (`not-at-end` otherwise, error `E_SHIP_LINE`); once the line has reached the fortress (`done`) no more line ships can be built, free coastal ships still can. The line's end is kept in `lines[player]` (`start`, `edges`), not inferred. Ships on the line cannot be moved (`shipMoveBlocked`); a free ship moved onto a line edge is judged exactly like a new ship (`ship.move` and `setup.placeShip` go through the same check and the same `E_SHIP_LINE`). | SF25 p. 16 "one continuous line … No branching" |
| I8 | Reaching the targets | The line reaches the beachhead when one of its vertices is the beachhead vertex (the target then becomes the fortress) and the fortress when it passes the fortress vertex (the line is complete). A settlement at the beachhead does not stop the line: it continues from there. Following the shortest path from the free coastal start, every colour needs 5 line ships to the beachhead and 3 more to the fortress in the test (`EXPECTED_LINE_LENGTHS`; the map is symmetric), well inside the 15 ships of the supply. | SF25 p. 16 |
| I9 | When nothing leads to the target | **Fallback `shortestPathFallback` (kept, profile flag)**: when the target is not reachable from the line's end over empty line edges (or, without a line, no own building or ship on the main island reaches it), the line may extend in any legal direction (still attached at the end, still one line); as soon as the end can reach the target again the exact rule resumes. **Departure from SF25**, which gives no definition; spec §6.6. The measurement that decided to keep it is in the next section. | spec §6.6, §9 OQ-3 |
| I10 | The pirate and the robber in S7a | The pirate stands on the route's first hex and does not move until S7b; the base rule that no ship can be placed or moved onto an edge of the pirate's hex still applies. The robber is out of the game (`robberInactive`): a 7 makes players with more than 7 cards discard and nothing else happens (the "steal from any other player" step is S7b). Longest Road and Largest Army are disabled (`awardRules`). | SF25 p. 16 |
| I11 | The deck | 3 players: the 5 victory point cards are removed (20 cards: 14 knights, 2 road building, 2 year of plenty, 2 monopoly). 4 players: they are replaced in place by knights (25 cards, 19 knights), so the shuffled order is unchanged. Playing them (warships) is S7c. | SF25 p. 16 |
| I12 | Setup | Unchanged: two rounds, two starting settlements with a road or a ship each, on the main island only; the second settlement still gives its starting cards. Everyone then has 3 settlements and 3 VP (the fortress counts for 0). The preset pieces are placed in `initGame` without the rng. | SF25 p. 16 |
| I13 | Profile | `implemented: true`, `enabled: false`: the engine can build the game (tests, the sim) while the lobby and the server still refuse it (`disabled`); S7c enables it. `shortestPathFallback: true` is a registry field. | spec §10 |
| I14 | State and views | `SeafarersState.pirateIslands` (fortresses, beachheads, lines, route) exists only in this scenario; the public view `modules.seafarers.pirateIslands` and the hint `pirateLine` (next target, target vertex, end, edges) are absent elsewhere, so every other profile keeps its view and hint keys and its ship rules (D7, tested). Everything is public: no hidden information is involved. | spec D7 |

## Simulation: how often is a line left without a path

Spec §6.6 and OQ-3: measure with random legal moves whether the exact shortest-path rule can leave a player with no way to
extend the line; if it never does, drop `shortestPathFallback` and its code. **It does happen, so the flag stays on (I9).**

`packages/rules/test/seafarers-pirate-islands-sim.ts` plays whole setups and then turns of random **legal** actions
(3 and 4 players, seeds 1..N, at most 60 turns, or until every line reaches its fortress): the actor rolls (a 7 only discards), then makes 1 to 4
actions, each either an extension of the own line (probability `bias`) or any other legal ship, a road, or a settlement on a
beachhead (settlements elsewhere and cities are left out so nobody wins by points); the hand is refilled before every action so
the run tests paths, not the economy; before every turn the pirate jumps to a random hex of the route (S7b will move it for
real, so its temporary blocking shows up all over the board). Three policies: `bias 1` (only line ships, every start and every
shortest path equally likely), `0.85` and `0.4` (more and more other legal ships, which are free around the main island).
After every action each player is checked: *unreachable* = the line has ships and its next target cannot be reached from the end
over empty line edges; *noStart* = no line yet and no vertex of the main island's coast reaches the target; *noExtension* = the
end can reach the target but the player has no legal line ship (pirate ignored, pieces left). Run with
`PI_SIM_GAMES=<n> PI_SIM_BIASES=<list> PI_SIM_REPORT=1 pnpm --filter @katan/rules exec vitest run test/seafarers-pirate-islands-sim.test.ts`
(2026-11-24, one worker on the shared machine, 128 s for the 600 games of `bias 1`, 856 s for the 1600 games of the other two):

| Players | Policy | Games | Games with a line left without a path | Games where the fallback placed a ship (ships) | Lines completed | Lines out of ships | noStart (observations) | noExtension |
|---|---|---|---|---|---|---|---|---|
| 3 | bias 1 | 300 | 98 (33 %) | 55 (179) | 762 / 900 | 67 | 57 | **0** |
| 4 | bias 1 | 300 | 104 (35 %) | 81 (290) | 1046 / 1200 | 32 | 84 | **0** |
| 3 | bias 0.85 | 400 | 175 (44 %) | 117 (401) | 954 / 1200 | 101 | 32 | **0** |
| 4 | bias 0.85 | 400 | 195 (49 %) | 168 (622) | 1295 / 1600 | 66 | 259 | **0** |
| 3 | bias 0.4 | 400 | 354 (89 %) | 317 (1521) | 495 / 1200 | 339 | 20 | **0** |
| 4 | bias 0.4 | 400 | 386 (97 %) | 377 (2178) | 658 / 1600 | 272 | 330 | **0** |

Reading: with random starts and random shortest paths about a third of the games already leave some player's target unreachable on
the open sea: lines of different players cannot cross (a vertex has three edges, so a line is a wall for everybody else), and a line
that starts from the far side of the main island walls the others off. The counts are from random play with no defence (many random
free ships, nobody avoids blocking), so they overstate real tables, but the case is common enough that the strict rule would stall
games, so **the fallback stays** (`shortestPathFallback: true`, FIDELITY will mark it a departure from SF25 when S7c enables the
profile). With it, **no player was ever left without a legal line ship** (`noExtension` 0 in all 2,200 games); lines that did not
finish ran out of the 15 ships or of turns. One consequence worth a user decision: requiring the line to begin at the preset
settlement's coast (or the nearest coastal building) would remove most crossings; S7a implements the user-confirmed definition
as it is (I5, I6) and does not add that.

## What was built

| Area | Files | Notes |
|---|---|---|
| Map | `packages/rules/src/seafarers-pirate-islands-boards.ts` (new), `topology-registry.ts`, `layout-registry.ts` | shifted coordinates, 8 shuffled ports, the 49-cell topology `sf-pirate-islands`, preset/route data, corner and side lookups |
| Rules | `packages/rules/src/modules/seafarers/pirateIslands.ts` (new), `index.ts`, `state.ts`, `ships.ts`, `islands.ts`, `gold.ts`, `messages.ts` | presets, fortress lock (production, gold, score, city), beachhead and setup building, the ship line with the shortest path and the fallback, hints, projection, `E_SHIP_LINE` |
| Profile | `packages/rules/src/profiles.ts` | `topologyId: sf-pirate-islands`, `shortestPathFallback`, `implemented` |
| Web | `components/SvgPirateIslands.tsx`, `board/three/DioramaPirateIslands.tsx`, `board/three/diorama-pirate-islands.ts` (new); `SvgBoard.tsx`, `DioramaSeafarers.tsx`, `PlayersPanel.tsx`, `BoardView.tsx`, `board/seafarers.ts`, `i18n/modules/seafarers.ts` | lair stacks, beachhead discs, the next-target ring, the route in SVG and 3D, fortress and ship-line marks in the player panel, `E_SHIP_LINE` and the pirate texts in zh-Hant and en |
| Evidence | `packages/rules/test/seafarers-pirate-islands.test.ts`, `seafarers-pirate-islands-sim.ts`, `seafarers-pirate-islands-sim.test.ts`, `packages/web/test/seafarers-pirate-islands.test.tsx` | see Verification |

The ship line is reachable in both renderers through the ordinary ship build intent: `legalShips` in the hints already lists
only the legal edges (the line rule is inside `canPlaceShip`), and `pirateLine.target` marks the next target.

## Verification

- Rules (`packages/rules/test/seafarers-pirate-islands.test.ts`, 32 tests; whole suite 71 files, 1175 tests):
  topology (49 hexes, rows 6-7-8-7-8-7-6 on the `sf-forgotten-tribe` outline, Euler, protrusions absent, 8 distinct frame harbour edges)
  and the (-1, -3) shift against the transcribed row ranges; layout checksums (terrain 19/3/2/5×5, 24 discs, the 6 hexes without a
  disc, islands 17/4/2/1/4/2, every transcribed cell, 8 harbour tokens reproducible and varying with the seed, route 14 consecutive
  sea hexes, pirate on the first, robber -1); every preset marker against the two transcriptions (hex lists per vertex and edge);
  presets for 4 players (4 settlement and fortress pairs, 4 ships, 4 fortresses of 3 lairs, 12 lairs) and 3 (no white, 9 lairs), colour to set
  assignment (green, red, blue), deck composition 20 and 25, score 1 before and 3 after setup; setup only on the main island
  (legal vertices, the beachhead refused, whole setups on three seeds), no Longest Road or Largest Army, a 7 only discards (other
  Seafarers scenarios still move the robber); the fortress lock (resources, gold, score, city, ships stopped, 4 of 5 settlement
  pieces); the line (coastal ships free, wrong ship refused with `E_SHIP_LINE`, lines of 3 and 4 players reach beachhead and
  fortress with every step cutting the distance by 1 and a simple path, a finished line cannot grow, no branching, detours around
  other ships and impassable vertices, the fallback with its flag on and off, settlement at the beachhead only after the line
  arrives and only the own one, line ships fixed and free ships judged when moved, setup ships); public view equal for every
  viewer; other scenarios without state, hints or line rules; profile enabled/implemented flags and player counts;
  `seafarers-pirate-islands-sim.test.ts` (2 tests, 36 s: 12 games for each of 3 policies × 2 player counts, `noExtension` 0, the
  large runs above); `profiles.test.ts` and `seafarers-exports.test.ts` updated for the new key and the implemented flag;
  `message-ids.test.ts` covers `E_SHIP_LINE`.
- Service: no code path is added (the profile is disabled); `seafarers-scenarios-registry.test.ts` still lists the profile as disabled and
  rejects 5 and 6 players with `bad-player-count` and 3–4 with `disabled`; `bots.test.ts` still refuses bot seats with reason `profile`.
- Web (`seafarers-pirate-islands.test.tsx`, 7 tests): SVG board (49 hexes, 8 harbours, 8 buildings and 4 ships for 4 players, 4
  fortresses with 3 lairs and their titles, 4 beachheads, the 14-hex route, no robber, 3 players with 3 fortresses and no white
  pieces), the next-target ring (beachhead first), a recaptured fortress without lair tokens, no layer in other scenarios; 3D helper
  geometry (lair spot beside the fortress on land, beachhead on its vertex, taller stack for more lairs, models built); player panel
  (fortress and ship line marks, no Longest Road, both locales); the new message ids in both locales. The SVG board was also
  rendered once to an image and compared with the printed map (presets, fortress stacks, beachheads, pirate on the bottom row).
  The 3D scene is not rendered in a browser in this slice (the profile is not enabled); only its instance data is tested.
- `pnpm typecheck` passes. The browser evidence script belongs to S7c.

## Limitations

- No human playtest, physical device or screen-reader check; no browser capture in S7a (the profile is not enabled, so there is no
  lobby path; the capture belongs to S7c).
- The shortest-path definition is the user-confirmed reading of SF25 (OQ-3), not a printed rule; the line fallback is a
  departure from SF25 (I9).
- "Which ships belong to the line" (I4–I5) is our reading of "one continuous line to the western islands … you may create other
  routes around the main island".
- Whether a recaptured or locked fortress counts as "a building adjacent to the pirate" for attacks, the pirate's movement and
  attacks, the 7's steal step, the warship conversion and the attack on the fortress are S7b and S7c.
- The help panel has no scenario text yet (S7c).
