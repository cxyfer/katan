# Seafarers scenario S8: The Wonders of Catan

Advisory work record for slice S8 of
[the scenarios spec](../specs/2026-11-22-seafarers-scenarios.md) (D2–D5, D7,
D9; §3, §5.1–§5.4, §6.7, §7.1, §7.3–§7.5, §8, §9 OQ-1, §10, §11 including
SFX-S8). Branch `feat/sfx-s8-wonders-of-catan` on `release/v0.4.6` (f3ded61:
S0–S6 merged). Profile `sf-wonders-of-catan-2025` (3 and 4 players on one
shared map, rule version `sf-2025.3`), enabled by this slice.

## Sources (accessed 2026-11-24)

| Id | Edition | Publication | File | SHA-256 | Pages used |
|---|---|---|---|---|---|
| SF25 | CATAN – Seafarers, 2025 (`v6.250401`) | CN3083 | `CN3083 CATAN–Seafarers Rulebook 2025 secured reduced.pdf` (20 pp.) | `a499abe2b613afd618dd3c806790400c7e84adebcc9b9ab19a24fb80dd04b099` (same file as `2026-11-01-seafarers.md`) | 1 (Components: the five Wonders of Catan tiles), 2–3 (rules), 18–19 (The Wonders of Catan: setup, additional rules, winning, component table; the map is a two-page spread) |

Rendered pages (outside the repository, read as images): `p18.png`
`969332e26c35e2cbf00d1131440c613d8727d3420a1cc8cb1b2009d111f092a0`, `p19.png`
`85cbe7881de5b9a70179fc43d4569a5f822e20b90651782812a2271e6d91bd1e`, and the
900 dpi crop of the p. 1 tiles `p01-wonders-900.png` (sha256 prefix
`10dc8c5773eb7707`). The PDF is not in the repository and nothing downloaded
was executed.

## Method

1. **Two independent transcriptions** (`s8-A.json`, `s8-B.json`, outside the
   repository; sha256 prefixes `753029ca1fafa41d` and `5260fccbcc70de8e`). Each
   transcriber saw only the SF25 spread and transcribed terrain, discs, islands,
   every sea hex, the outline rows and the two protrusions, the nine ports, the
   robber, the pirate and the 11 markers (vertices, listed as the hexes that meet
   there).
2. **Comparison.** Compared field by field with a script: the 30 land hexes
   (terrain, disc, island), the 19 sea hexes, the outline rows, the protrusions,
   the nine ports (hex, side, "?") and the 11 marker vertices are **identical**.
   The only differences are the order in which A and B list the hexes of one
   X marker (same set) and the free-text notes. No cell had to be re-read; I
   still re-checked the left half of p. 18 against the image (hexes 12, 6, 3,
   8, 9, 5 and the "?" port beside the 3, the NW gold 8) and found no
   difference.
3. **Outline and shift.** Rows 6-7-8-7-8-7-6 = 49 cells; the two middle-row
   protrusions (-3,3) and (5,3) are frame (otherwise 51 against the table's
   49). The outline is **identical to The Forgotten Tribe's** (`FT_CELLS`), with the
   same shift **(dq, dr) = (-1, -3)** (transcribed rows `[0,5] [-1,5] [-2,5]
   [-2,4] [-3,4] [-3,3] [-3,2]` become repo rows `[-1,4] [-2,4] [-3,4] [-3,3]
   [-4,3] [-4,2] [-4,1]` at r = -3 … 3). The hex list is shared; the topology is
   a new id `sf-wonders-of-catan` because it has 9 harbor slots (S5 has 6).
4. **Islands.** 1 = large island (25 hexes: 22 resource hexes and the three
   deserts); 2 = north-west small island (gold 8, hills 2); 3 = south-east small
   island (gold 6, forest 4, fields 5). The blue outline on the printed map (the
   variable-setup region, S10) is not used.
5. **Markers are vertices.** 5 Great Wall (five consecutive corners along the
   boundary between the forest 9 / hills 4 and the desert hexes), 2 Great Bridge
   (the two ends of the shared edge between sea hexes (-1,5) and (-2,6)) and 4 X
   (one beside each end of each bridge marker, one of them at the frame edge with
   only two board hexes). Each vertex is found from the hexes that meet there
   (`wonderMarkerVertices`) and kept in module state.
6. **Robber and pirate.** SF25: "Place the robber on a desert hex. Return the
   pirate to the box." The robber starts on one of the three deserts, drawn with the
   layout rng and stored in the layout (as S5). The pirate is not used
   (`pirate: null`). The printed map shows the robber on (4,2).

## Checksums

| | Sea | Desert | Gold | Fields | Hills | Mountains | Pasture | Forest | Total |
|---|---|---|---|---|---|---|---|---|---|
| Table (p. 19; spec §6.7) | 19 | 3 | 2 | 5 | 5 | 5 | 5 | 5 | 49 |
| Transcription (both) | 19 | 3 | 2 | 5 | 5 | 5 | 5 | 5 | 49 |

| Discs | 2 | 3 | 4 | 5 | 6 | 8 | 9 | 10 | 11 | 12 | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Table (p. 19) | 2 | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 1 | 27 |
| Transcription (both) | 2 | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 1 | 27 |

Ports 9 = 5 × 2:1 + 4 × 3:1 (all printed as "?"); markers 5 + 2 + 4; VP tokens 8
(= 2 small islands × 4 players, the island bonus supply); wonder tiles 5.

## Transcription (SF25 pp. 18–19)

Land hexes (30). Coordinates: as transcribed (origin top row r = 0, leftmost q = 0)
and in the repo (shift (-1, -3)).

| (q, r) as transcribed | (q, r) in the repo | Terrain | Disc | Island |
|---|---|---|---|---|
| (0, 0) | (-1, -3) | gold | 8 | 2 |
| (1, 0) | (0, -3) | hills | 2 | 2 |
| (3, 0) | (2, -3) | mountains | 10 | 1 |
| (2, 1) | (1, -2) | forest | 11 | 1 |
| (4, 1) | (3, -2) | desert | – | 1 |
| (-2, 2) | (-3, -1) | mountains | 12 | 1 |
| (-1, 2) | (-2, -1) | fields | 6 | 1 |
| (0, 2) | (-1, -1) | hills | 11 | 1 |
| (1, 2) | (0, -1) | fields | 10 | 1 |
| (2, 2) | (1, -1) | pasture | 3 | 1 |
| (3, 2) | (2, -1) | forest | 9 | 1 |
| (4, 2) | (3, -1) | desert | – | 1 |
| (-2, 3) | (-3, 0) | mountains | 3 | 1 |
| (-1, 3) | (-2, 0) | fields | 4 | 1 |
| (0, 3) | (-1, 0) | mountains | 6 | 1 |
| (1, 3) | (0, 0) | pasture | 5 | 1 |
| (2, 3) | (1, 0) | hills | 4 | 1 |
| (3, 3) | (2, 0) | desert | – | 1 |
| (-3, 4) | (-4, 1) | hills | 8 | 1 |
| (-2, 4) | (-3, 1) | pasture | 9 | 1 |
| (1, 4) | (0, 1) | hills | 10 | 1 |
| (4, 4) | (3, 1) | gold | 6 | 3 |
| (-2, 5) | (-3, 2) | forest | 3 | 1 |
| (0, 5) | (-1, 2) | forest | 8 | 1 |
| (1, 5) | (0, 2) | fields | 9 | 1 |
| (3, 5) | (2, 2) | forest | 4 | 3 |
| (-3, 6) | (-4, 3) | mountains | 5 | 1 |
| (-1, 6) | (-2, 3) | pasture | 11 | 1 |
| (0, 6) | (-1, 3) | pasture | 2 | 1 |
| (2, 6) | (1, 3) | fields | 5 | 3 |

The nine port positions (hex of land, side 0 E … 5 SE toward the sea or frame;
kinds are shuffled by the layout rng). Order in the table is by row; the topology
lists them in the order of `WC_PORT_SLOTS`.

| # | Hex as transcribed | Hex in the repo | Side |
|---|---|---|---|
| 0 | (-1, 2) | (-2, -1) | 2 |
| 1 | (1, 2) | (0, -1) | 2 |
| 2 | (2, 2) | (1, -1) | 1 |
| 3 | (-2, 3) | (-3, 0) | 3 |
| 4 | (-1, 3) | (-2, 0) | 5 |
| 5 | (-2, 5) | (-3, 2) | 3 |
| 6 | (1, 5) | (0, 2) | 1 |
| 7 | (1, 5) | (0, 2) | 5 |
| 8 | (-1, 6) | (-2, 3) | 5 |


The eleven markers (hexes that meet at the vertex, as transcribed):

| Kind | Hexes |
|---|---|
| Great Wall | (3,2)(3,1)(4,1) · (3,2)(4,1)(4,2) · (3,2)(4,2)(3,3) · (3,2)(3,3)(2,3) · (2,3)(3,3)(2,4) |
| Great Bridge | (-2,5)(-1,5)(-2,6) · (-1,6)(-2,6)(-1,5) |
| X | (-2,5)(-1,4)(-1,5) · (-2,5)(-2,6)(-3,6) · (-1,6)(-1,5)(0,5) · (-1,6)(-2,6) (third hex is frame) |

## The five wonder tiles (OQ-1 resolved)

SF25 p. 1 (Components, "5 Wonders of Catan tiles") prints the five tiles; the
text layer gives the names and the requirement lines and the cost row is read
from the 900 dpi crop (the icons: brick, lumber, wool, grain, ore). I looked at
the crop again myself.

| Tile (SF25) | Requirement (SF25 text) | Cost per level (5 cards) | SFCN-20 name |
|---|---|---|---|
| Great Wall | Requires a building at one of the Great Wall markers to begin. | brick 3, lumber 1, grain 1 | 長城 (same) |
| Great Bridge | Requires a building at one of the Great Bridge markers to begin. | lumber 3, wool 1, grain 1 | 大橋 (same) |
| Grand Theater | Requires 2 cities to begin. | wool 3, brick 1, lumber 1 | 大劇院 (same) |
| Grand Castle | Requires 1 city and 6+ VPs to begin. | ore 3, brick 1, grain 1 | 大教堂 (same requirement and cost; the name and picture differ) |
| Grand Monument | Requires 1 city at a port and a trade route with 5+ roads/ships to begin. | grain 3, ore 2 | 巨像 (SFCN-20 says "at least 1 harbor"; **SF25 wins: a city at a port**) |

The tiles are a data table (`WONDERS` in `modules/seafarers/wonders.ts`: id,
condition fields `marker`, `cities`, `score`, `portCities`, `route`, and the
cost); no rule code names a tile. zh-Hant keeps SFCN-20's wording for four tiles
(長城, 大橋, 大劇院, 巨像); Grand Castle is **大城堡** because SF25's name and
picture are a castle, not SFCN-20's 大教堂. FIDELITY records OQ-1 as resolved by
SF25 p. 1; nothing depends on a third-party source any more.

## Interpretations

| # | Item | Decision | Basis |
|---|---|---|---|
| I1 | Setup | Starting settlements only on a vertex that touches the large island (island 1) and is not a Great Wall, Great Bridge or X vertex. A vertex that touches a small island is only legal if it also touches the large island, which never happens on this map. | SF25 p. 18 |
| I2 | X markers | "intersections with X markers next to the Great Bridge markers": forbidden **only in setup**, like the Great Wall and Great Bridge vertices. After setup all 11 vertices are normal building sites (Great Wall / Great Bridge sites are the construction requirement). The X has no other effect. | SF25 p. 18 |
| I3 | Small islands | Profile `islandBonus { points: 1, skip: 'main' }` (S1 rule table): each player's first settlement on each small island is 1 VP, others' settlements do not matter; the VP token lies under the settlement (`claims`); 8 tokens suffice. No bonus in setup. | SF25 p. 18, spec §5.1 |
| I4 | Claim vs. start | Two commands. `wonder.choose { wonder }` (the tile is taken: free, only in the own action phase, requirement checked **now**), `wonder.build` (pay the tile's cost; the first payment puts the marker on 1, each next payment moves it one level; 4 payments complete). SF25 says the tile is taken "when you meet the requirement" and the cost is paid "to start building". | SF25 p. 18 |
| I5 | One each | A player holds one tile (`E_WONDER_HELD`); a tile held by anyone cannot be claimed (`E_WONDER_TAKEN`) and only its holder builds it (`E_WONDER_NOT_CHOSEN` for everyone else). | SF25 p. 18 |
| I6 | When checked | The requirement is checked only at claim; losing it later (for example a building taken away) does not stop construction. | lead's reading of "before you can begin" |
| I7 | Building | The marker and the levels are public module state (`owned`, `levels`); wonder markers and VP tokens are separate stocks. Any number of levels per turn while affordable. | SF25 p. 18 |
| I8 | "building" for Great Wall / Great Bridge | An own settlement or a city on that vertex. | SF25 p. 1 |
| I9 | "city at a port" | An own city on a vertex of a harbor edge (any harbor, 2:1 or 3:1). A settlement does not count. | SF25 p. 1 (replaces SFCN-20's "harbor") |
| I10 | "trade route with 5+ roads/ships" | The longest route (`longestRouteLength`, ships included): consecutive own roads/ships, a road and a ship joining only at an own building, cut by opponents' buildings. At least 5. It does not have to touch the port city. | SF25 p. 1 and the Longest Trade Route rule, pp. 2–3 |
| I11 | "6+ VPs" | The claimant's own score including hidden victory point cards (as the win check does). | SF25 p. 1 |
| I12 | Ending 1 | Completing level 4 on the own turn ends the game at once (`cause: wonderComplete`). | SF25 p. 18 |
| I13 | Ending 2 | 10 or more VPs and a completed level strictly higher than **every** other player (others without a wonder count 0, so at least level 1), judged for the player whose turn it is after every build, upgrade or other check. A tie on levels does not win. `cause: wonderLead`. The profile target 10 is only this threshold: 10 VP alone never wins. | SF25 p. 18 |
| I14 | Engine | New module hook `winCause` replaces the plain target check for the current player; `endGame` writes `playerIds` and `cause`. For every other profile the hook is absent and the target path is bit-for-bit as before; the `game.finished` event of a wonder ending carries `cause` and no `target`. | spec §5.3, D12 plumbing |
| I15 | Pirate | Off inside the rules: no pirate target hint, a 7 or knight can move only the robber (a sea hex or the frame is `E_ILLEGAL_TARGET`), no pirate in the layout; both renderers draw none; the registry field `hasPirate` stays true (§7.1). | SF25 p. 18 |
| I16 | Robber | Any desert, drawn by the layout rng; afterwards the robber may move anywhere on land (no restriction in SF25). | SF25 p. 18 |
| I17 | Harbors | Nine fixed positions, kinds drawn with the layout rng (public, stored in the layout). | SF25 pp. 18–19 |
| I18 | Variable setup | SF25 p. 18's random main island is S10; only the fixed map is offered. | spec |
| I19 | Bots | Outside the bot support list: bot seats refused (`E_INVALID_BOT`, reason `profile`). | spec §7.4 |
| I20 | D7 isolation | `wonders` exists in module state, the projection and the hints only in this scenario; `wonder.*` in any other scenario answers as an unknown command (`E_INVALID_COMMAND`, or `E_PENDING_EFFECT` with a pending frame). New error codes only exist for this scenario. | spec D7 |
| I21 | Wonder tiles in the UI | The five tiles are one HTML panel in the action bar (claim and build buttons, requirement text, cost chips, each player's level), shared by the SVG and the 3D board; the markers are drawn inside both renderers. The panel is hidden while the action rail is collapsed (it would be clipped to half width) and shown once the rail expands; it follows the same holds as the action list (offline, table suspended or syncing, dice shown, command in flight) and reads the pre-roll projection while the dice are shown. | design, review |
| I22 | 7 and knight prompts | No pirate wording in this scenario (`sf.bandit.robberOnly`, `sf.bandit.knightRobberOnly`). | SF25 p. 18 |

## What was built

| Area | Files | Notes |
|---|---|---|
| Map | `packages/rules/src/seafarers-scenario-boards.ts`, `layout-registry.ts` | shared hex list, 9 ports, markers, layout builder |
| Rules | `modules/seafarers/wonders.ts` (new), `index.ts`, `state.ts`, `islands.ts`, `pirate.ts`, `messages.ts` | data table, claim, build, win cause, projection, hints |
| Engine | `engine.ts`, `modules/types.ts`, `types.ts` | `winCause` hook, `GameEndCause` `wonderComplete` / `wonderLead` |
| Profile | `profiles.ts` | topology, `implemented`, `enabled` |
| Web | `SvgSeafarers.tsx` (`WonderMarker`), `SvgBoard.tsx`, `three/diorama-ships.ts`, `three/DioramaSeafarers.tsx`, `WondersPanel.tsx` (new), `ActionBar.tsx`, `PlayersPanel.tsx`, `ResultScreen.tsx`, `HelpPanel.tsx`, `board/seafarers.ts`, `audio/cues.ts`, `i18n/*` | markers, panel, endings |
| Evidence | `packages/rules/test/seafarers-wonders-of-catan.test.ts`, `seafarers-sim.test.ts`, `packages/server/test/seafarers-wonders-of-catan.test.ts`, `packages/web/test/seafarers-wonders-of-catan.test.tsx`, `scripts/seafarers/capture_wonders_of_catan.py`, `wonders_fixture.mjs` | |

## Verification

- Rules (`seafarers-wonders-of-catan.test.ts`, 50 tests; whole suite 69 files, 1172 tests; `seafarers-exports.test.ts` 15, `profiles.test.ts` updated): topology (49 hexes, same hexes/edges/vertices as `sf-forgotten-tribe`, Euler, rows 6-7-8-7-8-7-6, protrusions absent, 9 distinct harbor edges each beside exactly one land hex) and the (-1, -3) shift; marker vertices (5 / 2 / 4, distinct, bridge pair adjacent, every X beside a bridge, wall chain beside deserts); layout checksums (terrain, 27 discs, islands 25/2/3, every transcribed cell, robber on a desert for 40 seeds and all three deserts reached, no pirate, nine harbor tokens, reproducible); profile and player counts; setup (large island only, off all 11 markers, other vertices open after setup, no setup bonus); island bonus (1 VP, others' presence irrelevant, both islands); the five requirements each with positive and negative cases (markers incl. other player's and the wrong marker kind, 2 cities, city + 6 VP with hidden cards, port city + route of 5 with ship/road joins only at an own building); one tile each, taken tiles, turn/phase/pending guards; cost per level for all five tiles with bank return, missing any one resource refused, several levels per turn, marker progress, requirement not re-checked, public view for every viewer, restart snapshot; both endings (10 VP + strictly higher level, tie/lower/third-player no, 9 VP no, level 0 no, hidden VP counts, completion at low score, event and view without target) ; pirate off; D7 (no `wonders` in other scenarios, target-path output unchanged). `seafarers-sim.test.ts`: 3 and 4 players to a wonder winner with a conserved bank, one wonder per tile holder, levels at most 4, no pirate, wonders claimed and built across seeds.
- Service (`seafarers-wonders-of-catan.test.ts`, 5 tests; whole suite 39 files, 406 passed and 20 skipped): enabled and selectable without bot seats, rooms for 3 and 4, 5 and 6 refused, bot seat refused (`profile`), 3 and 4 player starts (topology, 10 VP, robber on a desert, no pirate, 9 harbors, 11 markers, same view for everyone), setup off the markers, claim and level 1 over the API, **restart mid-game**, another player refused, levels 2–4, completion (`wonderComplete`, `game.finished` without `target`) and the room `completed`. `rooms`, `session`, `seafarers-scenarios-registry` updated.
- Web (`seafarers-wonders-of-catan.test.tsx`, 15 tests; whole suite 85 files, 1088 tests): SVG markers (5 / 2 / 4 with titles, no pirate; other scenarios still draw the pirate), 3D marker models and vertices, the panel (five tiles with requirement and cost, claim and build buttons and their commands, holder and level, zh-Hant names, nothing elsewhere), players panel level and 1-point islands, help, events and result screen for both endings and the unchanged target ending, sound cues. `rulesets.test.ts` updated.
- Browser: `scripts/seafarers/capture_wonders_of_catan.py` (Chromium, software WebGL, `SF_TIMEOUT=90000`, 13 cases, 0 page errors; after each UI command the service state is read back): lobby (3–4 players only), the 3- and 4-player map in SVG (49 hexes, 9 harbors, 5 / 2 / 4 `[data-wonder-marker]`, no pirate) and 3D (canvas `data-wonder-markers` = `5,2,4`), phone for 4, setup over the API (`wonders_fixture.mjs check`: all on the large island and off all markers), the help panel, then a live game for player 1: test-only fixture (service stopped) gives the turn, a settlement on a Great Wall marker, four levels of resources and player 2 a started Great Bridge. **SVG**: claim (the Great Bridge has no claim button, shows player 2's level) and level 1; **3D**: level 2; **phone** (touch context): level 3 with the build button in the panel; **desktop SVG**: level 4, the result screen shows the wonder ending with no target (`data-cause=wonderComplete`, no horizontal overflow in a phone-sized viewport), every client reads the same `playerIds` / `cause`. Report with sha256: `docs/screenshots/seafarers-wonders-of-catan/report.json`; the curated captures are `committed: true` (the 3-player 3D map is not kept).

## Limitations

- No human playtest, physical device or screen-reader check.
- Wonder tiles are an HTML panel, not objects drawn on the board.
- Variable setup (SF25 p. 18) is not offered (S10); no bots.
- The "route of 5" is the longest trade route, not a route that must start at the port city (SF25 does not say).
