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
| S4 | 3 | main area 17 cells (14 land + 3 fixed desert); unexplored 8 land, placed in the remaining cells | main: terrain, discs, port types; unexplored: positions, terrain, discs | main: forest 4, hills 3, pasture 3, mountains 2, fields 2; discs 14. Unexplored: gold 2, fields 2, mountains 2, forest 1, pasture 1; discs 8 |
| S4 | 4 | main area 20 cells (17 land + 3 desert); unexplored 10 land | same | main: forest 5, hills 4, pasture 4, mountains 2, fields 2; discs 17. Unexplored: gold 2, mountains 3, fields 3, hills 1, pasture 1; discs 10 |

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

**S4 (p. 11).** Deserts keep their positions (robber stays on desert (0,-2) as on
the fixed map). The main-island land (non-desert cells of the main area) takes
the main terrain and discs; the unexplored land takes its own terrain and discs
and is placed on a random subset of the "remaining spaces" (frame cells that are
not in the main area and not the sea cell in front of a port). Constraints: no
two red discs (6, 8) on adjacent hexes (across the whole board, main and
unexplored, desert has no disc), and no red disc on gold (gold only exists in
the unexplored set). Algorithm: per attempt, draw the unexplored cells, shuffle
both terrain sets, pick the red-disc cells with a randomized greedy
independent-set pick (main reds first, then unexplored reds on non-gold cells,
each skipping cells adjacent to an already chosen red), deal the black discs
over the remaining cells; if either pick comes up short, retry the whole
attempt. **Bounded**: at most `DESERT_MAX_ATTEMPTS` = 1,000 attempts; after
that it falls back to the printed fixed arrangement (which itself satisfies
both constraints, checked by the test), so it always terminates with a valid
board. Measured over seeds 1–1,000: 3 players max 2 attempts (mean 1.01), 4
players max 1 attempt (mean 1.00); the fallback was never used (asserted).
Candidate room: 3 players 13 cells for 8 unexplored hexes, 4 players 15 for 10.

## Interpretation table (V = variable-setup interpretations)

| # | Question | Decision | Why |
|---|---|---|---|
| V1 | S2 and S3 ports: positions fixed? | Positions fixed, only the port types are shuffled (5×2:1 + 4×3:1 / 5 or 4 3:1 as in the tables) | S2: "place them on the port locations shown on the map"; S3: "Port locations must remain as shown". Also keeps the topology's harbor slots (edges) valid |
| V2 | S2 red-disc adjacency? | Not constrained | p. 7 only restricts low discs on forest and pasture; adding a red-disc rule would invent a constraint |
| V3 | S4: "main island ... ports ... randomly in the area shown" | The main-island area is the printed main land cells; harbor positions stay at the printed edges and the port types are shuffled | The page says "ports" are gathered with the main island but gives no separate port-area shape; fixed slots stay on main-island coast, which is the printed area. Free port positions would need an edge rule not given in the scenario |
| V4 | S4: where may unexplored land go? | Any frame cell outside the main area, except the sea cell directly in front of a port (so no port faces land) | "the remaining spaces within the frame"; the exclusion is ours, 13 / 15 candidate cells remain |
| V5 | S4: island numbers for the new board | Main island (with the three deserts) is island 1; unexplored land is grouped by adjacency among unexplored hexes only, numbered from 2 in cell order. An unexplored hex that touches the main island still counts as a different island | Same as the printed map, where the land strip (island 2) touches the desert; so the setup exclusion (only corners whose land hexes are all main) and the +2 bonus per player per unexplored region keep working with no engine change |
| V6 | S4 VP tokens (3 players 24, 4 players 32) | The engine does not track a token supply (bonus is per player and island). A random board can have up to 8 (3 players) or 10 (4 players) unexplored islands, so in theory 4 × 10 > 32 claims; not enforced | Reaching it needs every player to settle every single-hex island before anyone wins at 14 VP; open point |
| V7 | S3: is the fog deck affected? | No: unknown hexes and discs, deck, reveal and privacy are as fixed | p. 9 only randomizes the faceup hexes |
| V8 | Robber/pirate | S2, S3: robber on the 12 disc, pirate on the frame (`pirate: null`) as printed; S4: robber on desert (0,-2), pirate on the frame | p. 7/9/11 |
| V9 | Lobby | The host switches the setup mode in the room settings (`lobby-setup`); no UI code change: the select is driven by `profile.setupModes` | Existing New Shores / base flow |

## Tests and evidence

| What | Where |
|---|---|
| 1,000 seeds × scenario × 3/4 players: counts (terrain, discs, port types), port edges unchanged, robber, determinism, S2 forest/pasture limit and island areas, S3 areas and fog count, S4 constraints / main area / islands / port-facing cells, termination and attempt statistics, `fixed` byte-identical and rng untouched, `setupModes`, whole simulated games in variable mode (6 runs) | `packages/rules/test/seafarers-variable-setup.test.ts` |
| Variable room by ruleset parts, start, constraints on the persisted layout, S4 setup over the API and snapshot restore after a restart | `packages/server/test/seafarers-variable-setup.test.ts` |
| Lobby switch to variable (3 scenarios), SVG rendering of variable boards (6 combos) | `packages/web/test/seafarers-variable-setup.test.tsx` |
| Browser run (lobby, SVG and 3D boards, phone) | `scripts/seafarers/capture_variable_setup.py`, `variable_fixture.mjs`; screenshots in `docs/screenshots/seafarers-variable-setup/` with `report.json` (sha256) |

## Browser evidence (`scripts/seafarers/capture_variable_setup.py`)

Real games through the real UI and API against the built service (private SQLite): the host creates the room, switches the setup mode to `variable` in the lobby settings and saves, three or four seats join and start. Each started board is read from the API and checked by `variable_fixture.mjs` (it differs from the fixed map; S2 no 2/3/11/12 on forest or pasture and robber on the 12; S3 robber on the 12; S4 no adjacent red discs, none on gold, robber on the desert). 21 cases, 0 errors; the curated 15 images are kept in `docs/screenshots/seafarers-variable-setup/` (the others, such as the 3-player lobby shots, are deleted after the run and marked `committed: false`).

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
| `through-the-desert-map-3p-svg-desktop.png` | `a7bf632c2f05dd618bd8ed7c77e08b1e0a0f00bbad489e009e01ca9e374fb1c8` |
| `through-the-desert-lobby-variable.png` | `b70cf457809709cde97afac0a49cfac7496269393d159f2719247edae8c9e539` |
| `through-the-desert-map-4p-svg-desktop.png` | `b7857f061242dc214f181dfdc388dc3ff3f74d2b41c4c8d27567310f32cc7295` |
| `through-the-desert-map-4p-r3f-desktop.png` | `aa2cdee84fd621d8ab64a53ecb19ec7146d4870adabffcf218a0c0e634c8f67a` |
| `through-the-desert-map-4p-svg-phone.png` | `ff57f5d4ebcae979241e22a7bced84db99bb8f33719e73a548b6775b02862aad` |

S10b (S5, S6, S8) is not part of this slice.
