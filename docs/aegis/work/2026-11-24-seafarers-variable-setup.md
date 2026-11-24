# Seafarers variable setup (S10a): Four Islands, Fog Islands, Through the Desert

Advisory work record for slice S10a of
[the scenarios spec](../specs/2026-11-22-seafarers-scenarios.md) (D1, D4, §6.1–§6.3,
§7, §10 S10, §11.2–§11.3). S10 is split in two PRs: **S10a** (this record:
S2 Four Islands, S3 Fog Islands, S4 Through the Desert) and S10b (S5, S6, S8,
written later in the same file). Branch `feat/sfx-s10a-variable-setup`, based on
`release/v0.4.6` (93ab8f4: S0–S6, S8, S9 merged). The profiles keep their ids and
rule version (`sf-2025.3`); only `setupModes` changes to `['fixed', 'variable']`.

## Sources (accessed 2026-11-24)

SF25 (`CN3083`, 2025, `v6.250401`, sha256
`a499abe2b613afd618dd3c806790400c7e84adebcc9b9ab19a24fb80dd04b099`, same file as
`2026-11-01-seafarers.md`). The PDF is not in the repository. Pages were rendered
to images outside the repository and read both as image and as extracted text;
no downloaded code was executed.

| Scenario | Page | Page image sha256 | Text read |
|---|---|---|---|
| S2 Four Islands | p. 7 (4-player map and table, VARIABLE SETUP) | `b38e59f2c8dc04452c0138559e61344c2e4b3f3ad1d6690ac126a65df862725b` | "place sea hexes as shown on the map. Gather the land hexes and number discs and place them randomly in the four island areas. Make sure forests and pastures do not get low value number discs (2, 3, 11, and 12). You may also randomize the ports. Shuffle the port tokens and place them on the port locations shown on the map. Finally, place the robber on the hex with the number 12 disc and the pirate on the indicated location." |
| S3 Fog Islands | p. 9 | `54d1c94ab9f1763bb1849329edf99ced0c81dea06e97b0fb01f9eafb884db138` | "Gather the faceup land hexes and number discs and place them randomly in the two island areas shown on the map. Red number discs (6s and 8s) are allowed to end up next to each other in this case. Port locations must remain as shown, but you may randomize which specific port appears in these port locations. Finally, place the robber on the number 12 disc and the pirate on the indicated location." |
| S4 Through the Desert | p. 11 | `f82f536612e2117be449bd5288704342de210036e169e32895b83c0d8574c632` | "Place the 3 desert hexes as shown on the map. MAIN ISLAND: Gather the main island land hexes, number discs, and ports. Place them randomly in the area shown on the map. Then place the sea hexes within the frame. UNEXPLORED REGIONS: Gather the unexplored regions' hexes and number discs. Place them randomly in the remaining spaces within the frame. Finally, place the robber and the pirate as shown. Note: ... be sure not to place red number discs (6s and 8s) on adjacent hexes. Do not place red number discs on gold fields." |

All three variable-setup texts open with "Set up the frame for a 3- or 4-player
game", which is why they apply to both player counts.

## Method

The printed fixed maps are already transcribed and checked against the component
tables (S2, S3, S4 work records). A variable board **re-deals the fixed
transcription**: the frame, the sea cells, the island areas and the harbor slots
are the printed ones; the multisets of terrain, discs and harbor tokens are read
from the fixed transcription, so they equal the SF25 component tables by
construction (and the tests re-check them on 1,000 seeds). The generators are in
`packages/rules/src/seafarers-variable-boards.ts` (pure functions of the fixed
land and ports plus the layout `Rng`); the three layout builders call them only
when `mode === 'variable'`. `fixed` does not touch the new file, does not draw
from the rng, and is byte-identical (regression test: layouts equal
`fixedLayout(...)` of the unchanged transcription, and the rng is not advanced).

## Island areas and component counts

Island areas are the fixed maps' island cell sets (counted by the code from the
transcription; the cell counts are the same as in the S2/S3/S4 records).

| Scenario | Players | Areas (cells) | Re-dealt | Counts (all as in SF25 tables) |
|---|---|---|---|---|
| S2 | 3 | islands 2/3/4/5 = 4 / 6 / 6 / 4 = 20 land | terrain, discs | land: 4 each of fields, hills, mountains, pasture, forest; discs 20; ports 5×2:1 + 4×3:1 (9) |
| S2 | 4 | 4 / 8 / 7 / 4 = 23 land | terrain, discs | land: fields 5, hills 4, mountains 4, pasture 5, forest 5; discs 23; ports 9 |
| S3 | 3 | known islands 2 / 3 = 7 / 7 = 14 land (+ 12 empty spaces) | known terrain, known discs | known: hills 2, fields 2, mountains 2, pasture 4, forest 4 (30 hexes with 16 sea); discs 14; ports 5 + 3 |
| S3 | 4 | known islands 2 / 3 = 10 / 7 = 17 land (+ 12 empty spaces) | known terrain, known discs | known: hills 3, fields 3, mountains 3, pasture 4, forest 4 (30 hexes with 13 sea); discs 17; ports 5 + 4 |
| S4 | 3 | main area 17 cells (14 land + 3 fixed desert); four unexplored regions 3 / 2 / 1 / 2 = 8 land (islands 2–5, printed cells) | main: terrain, discs, port types; unexplored: terrain, discs (cells fixed) | main: forest 4, hills 3, pasture 3, mountains 2, fields 2; discs 14. Unexplored: gold 2, fields 2, mountains 2, forest 1, pasture 1; discs 8 |
| S4 | 4 | main area 20 cells (17 land + 3 desert); four unexplored regions 3 / 3 / 2 / 2 = 10 land (islands 2–5, printed cells) | same | main: forest 5, hills 4, pasture 4, mountains 2, fields 2; discs 17. Unexplored: gold 2, mountains 3, fields 3, hills 1, pasture 1; discs 10 |

Fog (S3) unchanged: the 12 empty spaces stay numberless sea in the layout; the
facedown deck and its discs are still built by `initialFog` from the same map
and drawn with `ctx.rng` on reveal (privacy untouched: the layout only contains
the face-up land).

## Constraints, randomness and termination

All draws use only the passed layout `Rng`; the result is stored in the
snapshot (same rule as every other layout builder).

**S2 (p. 7).** Terrain is shuffled over the 20 / 23 land cells; the low discs
(2, 3, 11, 12: 6 for 3 players, 7 for 4) are first dealt (shuffled) onto cells
that are neither forest nor pasture, then the remaining discs are shuffled over
the remaining cells. Termination: one pass, no retry; the number of cells that
are not forest/pasture (3 players 12, 4 players 13) is at least the number of low
discs (6, 7), and the code throws if that were ever false (it cannot be: the
tile multiset is fixed). Robber on the 12 disc. Islands are the fixed areas, so
`layout.islands` equals the fixed map's. The red-disc adjacency rule is **not**
applied: SF25 states it only for S4 (see interpretation V2).

**S3 (p. 9).** Known terrain and discs are shuffled over the known land cells
(no constraint; red discs may touch, as printed). One pass, no retry. Robber on
the 12 disc. Port locations are the printed ones, only the port types are
shuffled.

**S4 (p. 11).** p. 11 orders the steps: deserts as shown; main-island land, discs and ports into the main area; then the sea hexes into the frame; then the unexplored hexes and discs into the **remaining spaces**. After the sea is placed, the remaining spaces are exactly the printed unexplored-region cells, so the sea cells, the four unexplored regions (island ids 2–5) and the main area keep their printed positions; only terrain and discs are re-dealt (main set over the main non-desert cells, unexplored set over the unexplored cells, pooled over the four regions). Deserts and the robber (desert (0,-2)) stay. Constraints: no two red discs (6, 8) on adjacent hexes (whole board, across main and unexplored; desert has no disc), and no red disc on gold (gold only exists in the unexplored set). Algorithm: per attempt shuffle both terrain sets, pick the red-disc cells with a randomized greedy independent-set pick (main reds first, then unexplored reds on non-gold cells, each skipping cells adjacent to an already chosen red), deal the black discs over the remaining cells; if either pick comes up short, retry. **Bounded**: at most `DESERT_MAX_ATTEMPTS` = 1,000 attempts, then it falls back to the printed arrangement (which itself satisfies both constraints, checked by the test), so it always terminates with a valid board. Measured over seeds 1–1,000: 3 players max 3 attempts (mean 1.01), 4 players max 1 (mean 1.00); the fallback was never used (asserted). Because island ids and cells do not change, the engine's setup exclusion, the per-region +2 bonus and the harbor corners behave exactly as on the printed map (tests: layout islands equal fixed; no harbor corner touches unexplored land).

## Interpretation table (V = variable-setup interpretations)

| # | Question | Decision | Why |
|---|---|---|---|
| V1 | S2 and S3 ports: positions fixed? (confirmed by the coordinator) | Positions fixed, only the port types are shuffled (5×2:1 + 4×3:1 / 5 or 4 3:1 as in the tables) | S2: "place them on the port locations shown on the map"; S3: "Port locations must remain as shown". Also keeps the topology's harbor slots (edges) valid |
| V2 | S2 red-disc adjacency? | Not constrained | p. 7 only restricts low discs on forest and pasture; adding a red-disc rule would invent a constraint |
| V3 | S4: "main island ... ports ... randomly in the area shown" | The main-island area is the printed main land cells; harbor positions stay at the printed edges and only the port types are shuffled | The page gives no separate port-area shape; free port positions would need an edge rule the scenario does not give |
| V4 | S4: where do the unexplored hexes go? | Into the printed unexplored-region cells (islands 2–5), in the order p. 11 gives: main island, then sea into the frame, then unexplored hexes into the remaining spaces. Cells and island ids are unchanged; only terrain and discs are dealt (pooled over the four regions) | "remaining spaces" after the sea is placed are exactly those cells. An earlier draft scattered the land over any free cell; the review showed that merges unexplored land with the main island, takes harbor corners away and breaks the four-region bonus, so it was dropped (no port-facing exclusion and no re-numbering code remain) |
| V5 | S4: island numbers | Unchanged from the printed map: main island with the three deserts is 1, unexplored regions 2–5 | Setup exclusion and +2 per player per region need no engine change |
| V6 | VP tokens | The engine does not track a token supply and no cap is added (coordinator decision). With the four fixed unexplored regions the claims cannot exceed 4 per player, so the 24 / 32 tokens are never exceeded | |
| V7 | S3: is the fog deck affected? | No: unknown hexes and discs, deck, reveal and privacy are as fixed | p. 9 only randomizes the faceup hexes |
| V8 | Robber/pirate | S2, S3: robber on the 12 disc, pirate on the frame (`pirate: null`) as printed; S4: robber on desert (0,-2), pirate on the frame | p. 7/9/11 |
| V9 | Lobby | The host switches the setup mode in the room settings (`lobby-setup`); no UI code change: the select is driven by `profile.setupModes` | Existing New Shores / base flow |

## Tests and evidence

| What | Where |
|---|---|
| 1,000 seeds × scenario × 3/4 players: counts (terrain, discs, port types), port edges unchanged, robber, determinism, S2 forest/pasture limit and island areas, S3 areas and fog count, S4 constraints, main area, fixed unexplored regions and islands, no harbor corner touching unexplored land, termination and attempt statistics, `fixed` byte-identical and rng untouched, `setupModes`, whole simulated games in variable mode (6 runs) | `packages/rules/test/seafarers-variable-setup.test.ts` |
| Variable room by ruleset parts, start, constraints on the persisted layout, S4 setup over the API and snapshot restore after a restart | `packages/server/test/seafarers-variable-setup.test.ts` |
| Lobby switch to variable (3 scenarios), SVG rendering of variable boards (6 combos) | `packages/web/test/seafarers-variable-setup.test.tsx` |
| Browser run (lobby, SVG and 3D boards, phone) | `scripts/seafarers/capture_variable_setup.py`, `variable_fixture.mjs`; screenshots in `docs/screenshots/seafarers-variable-setup/` with `report.json` (sha256) |

## Browser evidence (`scripts/seafarers/capture_variable_setup.py`)

Real games through the real UI and API against the built service (private SQLite): the host creates the room, switches the setup mode to `variable` in the lobby settings and saves, three or four seats join and start. Each started board is read from the API and checked by `variable_fixture.mjs` (it differs from the fixed map; S2 no 2/3/11/12 on forest or pasture and robber on the 12; S3 robber on the 12; S4 no adjacent red discs, none on gold, robber on the desert). 21 cases, 0 errors (the S4 captures were retaken after the review fix; `SF_SCENARIOS=through-the-desert` reruns one scenario); the curated 15 images are kept in `docs/screenshots/seafarers-variable-setup/` (the others, such as the 3-player lobby shots, are deleted after the run and marked `committed: false`).

| Image | sha256 |
|---|---|
| `four-islands-map-3p-svg-desktop.png` | `0bf0014141a3f8378dabbaeeb3d1860f827d6e4f1cc5bbe7add9ec8657a5cc3f` |
| `four-islands-lobby-variable.png` | `49006f6e7704210631a3eca084cdc26a7e410e38a07d713c0f32f3515dce50d7` |
| `four-islands-map-4p-svg-desktop.png` | `f333e6cbb86bac5b0c60f80f811a247632589de98ff18237014b3b0756526feb` |
| `four-islands-map-4p-r3f-desktop.png` | `55872504b0d28ddc55bff26ed9ba23a07a6ffd4277a43bd748dace3880177631` |
| `four-islands-map-4p-svg-phone.png` | `9c73ec1341722d91b670e18b0cb1565b0fcf6ea14228b5666eebd75ac22ef87b` |
| `fog-islands-map-3p-svg-desktop.png` | `8b0782950b10ad6cd180a15e4b4ee241f928a3b878a5aec4c0ebe5ff7daa6492` |
| `fog-islands-lobby-variable.png` | `5b16113892a26abdc679c52076a49acf14caa6db6281de7c3ac243f09d4b1eab` |
| `fog-islands-map-4p-svg-desktop.png` | `04b1bb2d203b9a47cf834f6fc73c6d999ad4ca93b14f2cec6e145bf8d1d82551` |
| `fog-islands-map-4p-r3f-desktop.png` | `0c8685c05e0da21624ee43d08232156d8bbb2555e64dd2b821ea056d8f1332af` |
| `fog-islands-map-4p-svg-phone.png` | `0d934f75a560b1de359434a231837f6acbdd226b93052a03df141cf313e631ab` |
| `through-the-desert-map-3p-svg-desktop.png` | `ec637d728b82e86ce8ae9cb66baae6d6bd2d5bbae38b33cc934ef6820c4968f2` |
| `through-the-desert-lobby-variable.png` | `a4d5c3b3d5c84659aed9918d5d0348ce24aafb7e3aee44c8759e695f6e3c59a0` |
| `through-the-desert-map-4p-svg-desktop.png` | `a2efbac978f03c575299cc09a8cea86b62501755059ce9658156d6fa070cd22c` |
| `through-the-desert-map-4p-r3f-desktop.png` | `d33b6178f1c926d610c3417a091c864f4b96e570415792a8676909b5efee04b3` |
| `through-the-desert-map-4p-svg-phone.png` | `b628e236f1f6d295f2eaf461c027dab048159083a16bf6573ca257044800c56f` |

---

# S10b: The Forgotten Tribe, Cloth for Catan, The Wonders of Catan

Slice S10b of the same spec (D1, D4, §6.4, §6.5, §6.7, §10 S10, §11.2–§11.3). Branch
`feat/sfx-s10b-variable-setup`, based on `release/v0.4.6` (b9254c8: S0–S6, S8, S9, S10a merged).
The three profiles keep their ids and rule version (`sf-2025.3`); only `setupModes` changes to
`['fixed', 'variable']`. The method of S10a applies unchanged: **re-deal the fixed transcription** (frame,
sea, island areas and harbor slots as printed; multisets of terrain, discs and port tokens from the fixed
transcription, which the earlier S5/S6/S8 records checked against the component tables); the generators
are in the same `packages/rules/src/seafarers-variable-boards.ts` (end of the file), the three layout
builders call them only when `mode === 'variable'`, and `fixed` is byte-identical and draws the same
randomness as before (regression test).

## Sources (accessed 2026-11-24)

SF25 (same file and sha256 as above). Pages rendered outside the repository and read as image and as
extracted text; no downloaded code was executed.

| Scenario | Page | Page image sha256 | Text read |
|---|---|---|---|
| S5 Forgotten Tribe | p. 13 (right half of the map and VARIABLE SETUP) | `233d7e599c71b13009eb91b4373b8a2f077a6f33ef39c6a290df3db85800773c` | "Set up the frame. Place the small islands and sea hexes as shown on the map. Gather the land hexes and number discs for the large island and place them randomly in the center of the map. Note: The 3 hexes outlined in blue on the right side of the large island should not receive the number discs 5, 6, 8, or 9. Place the robber on a desert. Then place the pirate, ports, VP tokens, and development cards on the indicated locations." |
| S6 Cloth for Catan | p. 15 (left part of the map and VARIABLE SETUP) | `dd6681fb965254cbd2169e5a2e1138d9ef8e37de3aadae148ccaa2b672607e15` | "Set up the frame, the four small islands, and sea hexes as shown. Set up the villages by placing the number discs and cloth tokens as shown. Gather the land hexes and number discs for the large islands and place them randomly in the empty hex areas. Randomly place ports on the locations shown. Players choose which hex with a number 12 disc should start the game with the robber. Then place the pirate on the indicated location." |
| S8 Wonders of Catan | pp. 18–19 (VARIABLE SETUP on p. 18, the map with the blue area on pp. 18–19) | p. 18 `969332e26c35e2cbf00d1131440c613d8727d3420a1cc8cb1b2009d111f092a0`, p. 19 `85cbe7881de5b9a70179fc43d4569a5f822e20b90651782812a2271e6d91bd1e` | "Set up the frame. Then place desert, small island, and sea hexes within the frame as shown. MAIN ISLAND: Gather the main island land hexes, number discs, and ports. Place them randomly in the area outlined in blue on the map. Note: The 2 land hexes next to the desert should not receive red number discs (6s and 8s). Finally, place the robber on one of the desert hexes." |

## Constraint hexes, read from the page images

* **S5, the 3 blue hexes (p. 13).** The blue outline on the page image encloses the rightmost hex of each of
  the three island rows on the right side of the large island: the mountains hex with the 4 (top row of the
  island), the pasture hex with the 2 (middle row) and the fields hex with the 3 (bottom row). In the
  transcription (centred coordinates, shift (-1, -3)) they are (2,-1), (2,0) and (1,1)
  (`FT_VARIABLE_RESTRICTED`). A test re-derives them: they are exactly the rightmost large-island hex of each
  island row, and their printed contents are mountains 4, pasture 2, fields 3. The printed map has no 5, 6, 8
  or 9 on them, which is consistent with the rule.
* **S8, the 2 land hexes next to the desert (pp. 18–19).** The three deserts form one cluster on the east
  side (page 19). The only land hexes touching a desert are the forest with the 9 (3,2 in the transcription)
  and the hills with the 4 (2,3); everything else around the cluster is sea. A test derives the desert
  neighbours from the topology and requires exactly these two (`WC_VARIABLE_NO_RED`, centred (2,-1) and
  (1,0)). The printed discs 9 and 4 are not red, again consistent.
* **S6.** p. 15 prints two 12 discs on the fixed map (both on the north large island); the south island has none.

## Island areas and component counts

| Scenario | Area (cells) | Re-dealt | Constraint | Counts (as in the SF25 tables) |
|---|---|---|---|---|
| S5 | large island, island 1 = 18 land hexes, all with discs | terrain, discs | the 3 right-edge hexes never get 5, 6, 8, 9 | discs 18 (all large island), terrain as printed; gifts, ports (6 face-up gift ports), pirate and small islands unchanged |
| S6 | north large island (island 1, 10 hexes) + south large island (island 6, 10 hexes) = 20 land hexes, one pool | terrain, discs; harbor types | none except the robber choice (below) | 20 discs on land (+ 8 tribe discs, unchanged), 9 ports = 5×2:1 + 4×3:1 at the printed edges |
| S8 | large island, island 1 non-desert = 22 land hexes (the island has 25 hexes with the 3 deserts; counted by code) | terrain, discs; harbor types | the 2 hexes beside the desert never get 6 or 8 | discs 22 on the large island (5 on the small islands, unchanged); 9 ports at the printed edges |

## Constraints, randomness and termination

All draws use only the passed layout `Rng`.

**S5.** One pass, no retry: terrain is shuffled over the 18 hexes; the restricted hexes (in shuffled order)
first take a legal disc from the shuffled disc pool (2, 3, 3, 4, 4, 10, 10, 11, 11, 12: 10 legal discs for 3
cells), then the remaining discs are shuffled over the remaining hexes. Taking the first legal disc from a
shuffled pool is uniform over the valid arrangements. 6 and 8 are therefore shuffled with all other discs
(a test requires a large-island hex to have seen both over 1,000 seeds). The robber goes on a random desert,
drawn after the board (all three deserts are on small islands, so the large-island deal cannot remove them);
the pirate stays on its printed sea hex.

**S6.** One pass over the two areas as one pool (V12), then the harbor types are shuffled over the printed
locations (the fixed layout already shuffles them with the layout rng too). The robber is initially on the
first 12 hex and moved by the choice step below.

**S8.** One pass: the two restricted hexes first take a non-red disc, then the rest is shuffled over the
remaining 20 large-island hexes. Non-red discs on the large island are far more than 2, so it cannot fail.
Harbor types shuffled over the printed locations; robber on a random desert; no pirate.

## S6 robber choice step

p. 15: "Players choose which hex with a number 12 disc should start the game with the robber." After the shuffle the
two 12 discs can be on any hex of the large islands (same island or one on each; both cases occur in the
1,000-seed test), so the starting hex is a real decision.

* **Where it lives.** A new setup stage `robber` in `SetupState.stage` (union `'building' | 'road' | 'harbor' | 'robber'`),
  the same shape as the S9 `harbor` stage and the S6 third round: no pending frame, so it cannot collide with
  the frames that the setup flow already uses (S3 had trouble with a setup pending frame). The module
  command is `cloth.robber { hex }`, handled in `packages/rules/src/modules/seafarers/robber-choice.ts`; the
  module context got an optional `setupMode` (set only for `initGame`) so the module can tell a variable game
  from a fixed one without storing anything new in the layout.
* **When.** `initGame` of the seafarers module sets the stage to `robber` only when the scenario is Cloth for
  Catan and the setup mode is `variable`. Fixed games never enter it and their hints keep the same keys
  (the robber hint keys appear only in this stage; D7 key-set test unchanged for fixed).
* **Who.** The starting player (`setup.order[0]`, seat 0 in the engine's order, the player who then also places the
  first settlement) chooses. "Players choose" has no mechanism in the text; a vote would add a second protocol
  for no gain, and the first player is the natural representative (V13). Anyone else gets `E_NOT_YOUR_TURN`.
* **What.** Only hexes with a 12 disc (always exactly two); anything else is `E_ILLEGAL_TARGET`. Choosing sets `board.robber`,
  emits `cloth.robberChosen { playerId, hex }`, returns the stage to `building` and the turn seat to `order[0]`; the
  usual three-round setup (V14) continues unchanged. The step draws no randomness. Before the choice the robber stands on the
  first 12 hex (the layout's initial value), which also covers a game that is abandoned or restarted in that moment.
* **Placement before the choice.** `setup.placeBuilding` in the `robber` stage fails with `E_WRONG_PHASE`
  (the engine checks `stage === 'building'`) and `legalSettlements` is empty.
* **Persistence.** Everything is in `turn.setup.stage` and `board.robber`; the snapshot already carries both,
  so a restart before or after the choice restores exactly (server test compares the persisted JSON before and
  after the restart, then finishes the setup with the restarted service).
* **UI.** The hint `hints.modules.seafarers.board` arms a `hex` board intent with the 12 hexes (same mechanism
  as the fog hex choice), so the SVG overlay, the 3D overlay and the mobile target list (`open-target-picker`)
  all work with the existing selection and confirm flow; the intent for the stage never falls through to the
  settlement targets. The setup guide, the required-action banner and the board intent label are written in
  English and Traditional Chinese (`sf.cloth.robber*`, `event.cloth.robberChosen`); `activeTurnKey` includes
  the stage so the choice is a new step (`remaining` does not change). No bot support is needed: Cloth for
  Catan is not in the bot scenario list, so bots cannot sit in these rooms.

## Interpretation table (continues the S10a numbering)

| # | Question | Decision | Why |
|---|---|---|---|
| V10 | S5: which 3 hexes are blue? | Rightmost hex of each of the three large-island rows (mountains 4, pasture 2, fields 3 on the printed map), recorded as `FT_VARIABLE_RESTRICTED` | p. 13 image; a test re-derives them from the topology |
| V11 | S5: "in the center of the map" | The 18 large-island hexes (island 1); small islands, gifts, pirate and sea as printed | p. 13: "Place the small islands and sea hexes as shown" |
| V12 | S6: one pool or one per island? | One pool over both large-island areas (20 hexes) | "the land hexes and number discs for the large islands ... randomly in the empty hex areas": one set of components, plural areas |
| V13 | S6: who chooses the robber hex? | The starting player, one step before the first settlement | "Players choose" gives no mechanism; the first player is the representative |
| V14 | S6: third round | Unchanged | The robber step comes before round 1; nothing else in setup changes |
| V15 | S8: which 2 hexes are "next to the desert"? | The two land hexes touching a desert: forest (3,2) and hills (2,3) in transcription coordinates, `WC_VARIABLE_NO_RED` | pp. 18–19 images; a test derives them from the topology |
| V16 | S8: ports "placed randomly in the area outlined in blue"? | Port locations stay as printed (the "?" markers on the page), only the types are shuffled | A port token needs an edge, not a hex area; every other scenario says "on the locations shown", the page prints the locations |
| V17 | S8: area | The large island's non-desert hexes; deserts, small islands and sea as printed ("place desert, small island, and sea hexes ... as shown") | Same reading as S10a V4 (the printed cells keep their island ids) |
| V18 | S8: the markers (Great Wall, Great Bridge, X) | Unchanged | They are at fixed intersections the page prints; the Great Wall hub is a land hex but the markers only need its vertices |
| V19 | S8 robber | Random desert via the layout rng, as in fixed | "on one of the desert hexes" |
| V20 | Layout rng order | S5: board then desert; S6: board then ports; S8: board then ports then desert. Fixed uses the earlier order | Fixed output must not change |

## Tests and evidence (S10b)

| What | Where |
|---|---|
| 1,000 seeds × scenario × 3/4 players: counts, restricted hexes, fixed elements, determinism, 6/8 shuffled, 12 discs on both/one island (S6), constraint cells derived from the page, fixed regression (cells and rng use), S6 robber step (rules, projection, errors, restart by JSON round trip, rng untouched), 6 simulated variable games (supply conservation, 50 cloth, ships ≤ 15, legal board) | `packages/rules/test/seafarers-variable-setup-s10b.test.ts` |
| Variable rooms by ruleset parts, starts, constraints on the persisted layout, S6 choice over the API (wrong player / wrong hex / early settlement rejected), restart before and after the choice | `packages/server/test/seafarers-variable-setup-s10b.test.ts` |
| Lobby switch (3 scenarios), SVG boards (6 combinations), S6 board intent and target list, shared geometry projection for the 3D scene, banner, guide, event text in both languages, turn key | `packages/web/test/seafarers-variable-setup-s10b.test.tsx` |
| Browser run (lobby, SVG and 3D boards, phone, the S6 choice in SVG and in 3D) | `scripts/seafarers/capture_variable_setup.py` (`SF_SCENARIOS`, `SF_PREV_REPORT`), `variable_fixture.mjs`; screenshots in `docs/screenshots/seafarers-variable-setup/` with `report.json` (S10a entries kept) |

## Browser evidence (S10b)

`scripts/seafarers/capture_variable_setup.py` now covers the three S10b scenarios as well (`SF_SCENARIOS=forgotten-tribe,cloth-for-catan,wonders-of-catan`, `SF_PREV_REPORT` merges the earlier `report.json` so the S10a entries stay). Real games through the real UI and API against the built service (private SQLite): the host creates the room, switches the setup mode to `variable` in the lobby settings and saves, three or four seats join and start. Each started board is read from the API and checked by `variable_fixture.mjs`: it differs from the fixed map; S5 has none of 5/6/8/9 on the three right-edge hexes and the robber on a desert; S8 has no red disc on the two hexes beside the desert and the robber on a desert; S6 has two 12 hexes, starts in the `robber` stage, and then the starting player picks one of them **on the board** (3 players in the SVG renderer, 4 players in the 3D renderer): the API shows `board.robber` on the chosen hex (the one the layout had not placed it on) and the setup back at `building`. The full report has 44 cases (the 21 S10a cases plus 23 new), 0 errors; the curated images are kept in `docs/screenshots/seafarers-variable-setup/` (S10a: 15, S10b: 17). The run takes about 12 minutes under software rendering on a loaded 4-core machine. The "no red disc on gold" check applies to Through the Desert only: the S8 small islands print red discs on gold.

| Image | sha256 |
|---|---|
| `forgotten-tribe-map-3p-svg-desktop.png` | `9929f549fc91cf51f86ab133b51043e76932f10ef3cc8d92bbae209a85f21eac` |
| `forgotten-tribe-lobby-variable.png` | `150a0d46c9435f0b1c427f099ee978da2beb316a5e5d2722ad336753dc8fcd79` |
| `forgotten-tribe-map-4p-svg-desktop.png` | `078a9c50a075ce7e39391d7d4d586587d3f46152ae0dd199b0db70b570c4b550` |
| `forgotten-tribe-map-4p-r3f-desktop.png` | `c32693a2b1cf18a3ac4f7a668a8758cc3825a6b4d75b4c0b49aea418a22d5236` |
| `forgotten-tribe-map-4p-svg-phone.png` | `e7aff3ce9f89e28bc0680edda61986cbbdb83f03356955fb6023ba62b1920668` |
| `cloth-for-catan-robber-targets-3p-svg-desktop.png` | `ed01bc428727f524fa59aa1b1d70e2493d9cdbf6e2a1a44cb07671976838d61c` |
| `cloth-for-catan-map-3p-svg-desktop.png` | `61505e7c5d18be68ac20f070a44d8b824e30b263d5c7f4fac3c709d89aa3070a` |
| `cloth-for-catan-lobby-variable.png` | `a2f6a7dfa68c2de34d56456b0f39d331e5e4d8217e32d307e8f109c4c135ed04` |
| `cloth-for-catan-robber-targets-4p-r3f-desktop.png` | `b1c40809343f9b849139bf3b85b3dfb003f07b93b1a34e2ae8fcd20d005ef202` |
| `cloth-for-catan-map-4p-svg-desktop.png` | `52b515bddc420fe11d263d32442dfc600c22a294e0ebd60876c6d49663c250b1` |
| `cloth-for-catan-map-4p-r3f-desktop.png` | `2991c31e2ad3f22b66dc7b96088132ad62c3e968d4653d7196aa77a6ab5d35d1` |
| `cloth-for-catan-map-4p-svg-phone.png` | `73cd78440ad5dca883b44d19f266af3c436641e4973172f13224d0dfd785c054` |
| `wonders-of-catan-map-3p-svg-desktop.png` | `ddf3a89757da209a022f2cda641225d7eff30e1006ad40b28e0e06f330449271` |
| `wonders-of-catan-lobby-variable.png` | `85659364626c8aed3364a0cc4b6bb53f7720a88f24a7c285ce05cd1689fe25ed` |
| `wonders-of-catan-map-4p-svg-desktop.png` | `549b81723c03df9db36222927a687707205343f41fbf63866f292735723918d4` |
| `wonders-of-catan-map-4p-r3f-desktop.png` | `1b37297172e2d0900563e4d4eaa0b9f7daa01ff328ed3273c4645b47d31d93e7` |
| `wonders-of-catan-map-4p-svg-phone.png` | `d02e25affacb60755668d48e2d18fc2f2fd928b62058dfa9ef57f7a3f4a82cb0` |
