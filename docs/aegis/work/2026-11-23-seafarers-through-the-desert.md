# Seafarers scenario S4: Through the Desert

Advisory work record for slice S4 of
[the scenarios spec](../specs/2026-11-22-seafarers-scenarios.md) (D2–D5, D7,
D9; §3, §5.1–§5.4, §6.2, §7.1, §7.3, §7.5, §8, §10, §11 including SFX-S4).
Branch `feat/sfx-s4-through-the-desert`, stacked on S2 (the shared scenario
board module, the profile-driven island bonus from S1). Profile
`sf-through-the-desert-2025` (3 and 4 players, 14 VP, rule version `sf-2025.3`),
enabled by this slice.

## Sources (accessed 2026-11-22/23)

| Id | Edition | Publication | File | SHA-256 | Pages used |
|---|---|---|---|---|---|
| SF25 | CATAN – Seafarers, 2025 (`v6.250401`) | CN3083 | `CN3083 CATAN–Seafarers Rulebook 2025 secured reduced.pdf` (20 pp.) | `a499abe2b613afd618dd3c806790400c7e84adebcc9b9ab19a24fb80dd04b099` (same file as `2026-11-01-seafarers.md`) | 2–3 (rules, setup), 10 (Through the Desert, 3 players: map, component table, setup, victory), 11 (4 players: map, component table, variable-setup text) |

The PDF is not in the repository. The pages were rendered to images
(`p10.png`, `p11.png`, plus 400 dpi crops) outside the repository and read as
images; no code from the download was executed. (The first brief pointed at
`p06.png`/`p07.png`, which are The Four Islands; the transcribers noticed and
used the printed pages 10 and 11.)

## Method

1. **Two independent transcriptions.** Two transcribers, each seeing only the
   SF25 pages (p. 10 for 3 players, p. 11 for 4 players), each transcribed both
   maps: terrain, disc, island number, every sea hex, the harbor tokens (hex,
   side, type), the frame outline, the robber and the pirate. Neither saw the
   other's work nor the SFCN-20 screenshots.
2. **Cell-by-cell comparison.** The two files were compared field by field:
   terrain, disc, island number, sea cells, harbors (hex, side, token), the
   robber and the pirate. **They were identical in every item** (the second
   file only adds a `facing` note per harbor, whether it faces the frame or a
   sea hex), so no cell had to be re-read against the page.
3. **Checksums** against the component tables and the SFCN-20 sub-tables
   (below). `packages/rules/test/seafarers-through-the-desert.test.ts`
   re-runs all of them on the real layouts and compares every transcribed cell
   with the built layout.
4. **Frame depends on the player count (spec §7.3).** The 3-player map sits on
   the 35-hex frame (`NS3_CELLS`, rows 4-5-6-5-6-5-4); the 4-player map sits on
   the 42-hex frame (`NS4_CELLS`, rows 5-6-7-6-7-6-5). The two bumps at the
   ends of the middle row are frame, not cells (both transcriptions give the
   same outline rows). Topology ids `sf-through-the-desert-3` and
   `sf-through-the-desert-4` carry their own `harborSlots` (8 and 9);
   `throughTheDesertLayout` picks the topology by player count and checks the
   hex count (35 / 42) before building.
5. Coordinates are axial, pointy-top (`r` grows downwards, `topology.ts`);
   harbor `side` follows `NEIGHBOR_DIRS` (0 E, 1 NE, 2 NW, 3 W, 4 SW, 5 SE).
6. **Islands.** Island 1 is the main island and contains the three deserts
   (1, -3), (0, -2), (-1, -1) (the desert has no frame of its own on the page,
   so it follows the main island). Island 2 is the land strip outlined in
   green that the desert splits off: (0, -3), (-1, -2), (-2, -1). Islands 3
   (north-east), 4 (east) and 5 (south-east) are the three dark-blue outlines.
   Islands 2–5 are the four unexplored regions (p. 10: "The small islands
   (outlined in dark blue) and the small land strip are unexplored regions").

## Checksums

| | Sea | Desert | Gold | Fields | Forest | Hills | Mountains | Pasture | Total |
|---|---|---|---|---|---|---|---|---|---|
| 3 players (table, p. 10; spec §6.2) | 10 | 3 | 2 | 4 | 5 | 3 | 4 | 4 | 35 |
| 3 players (transcription) | 10 | 3 | 2 | 4 | 5 | 3 | 4 | 4 | 35 |
| 4 players (table, p. 11; spec §6.2) | 12 | 3 | 2 | 5 | 5 | 5 | 5 | 5 | 42 |
| 4 players (transcription) | 12 | 3 | 2 | 5 | 5 | 5 | 5 | 5 | 42 |

| Discs | 2 | 3 | 4 | 5 | 6 | 8 | 9 | 10 | 11 | 12 | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 3 players (table = transcription) | 1 | 2 | 3 | 3 | 3 | 3 | 3 | 2 | 1 | 1 | 22 |
| 4 players (table = transcription) | 1 | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 2 | 27 |

Harbors: 5×2:1 (one per resource) + 3×3:1 (3 players) or 4×3:1 (4 players).
VP tokens (table): 24 for 3 players, 32 for 4 players = players × 4 regions ×
2 VP. A player has at most four regions to settle first and the main island
never pays, so the bound is exactly the supply. The engine has no token supply:
the bonus is recorded in `SeafarersState.claims`, bounded the same way (the
tests assert at most four claims per player, never island 1).

SFCN-20 sub-tables (cross-check only; land and discs are verified on the real
layout, the sea split is not visible on the page):

| | Region | Sea | Desert | Gold | Fields | Hills | Mountains | Pasture | Forest | Total | Discs |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 3 players | main island | 8 | 3 | – | 2 | 3 | 2 | 3 | 4 | 25 | 14 |
| 3 players | outlying | 2 | – | 2 | 2 | – | 2 | 1 | 1 | 10 | 8 |
| 4 players | main island | 10 | 3 | – | 2 | 4 | 2 | 4 | 5 | 30 | 17 |
| 4 players | outlying | 2 | – | 2 | 3 | 1 | 3 | 1 | – | 12 | 10 |

Both transcriptions agree with these land rows and disc counts exactly (discs =
land hexes, the desert carries none). The sea hexes are 10 and 12 in total, equal
to 8 + 2 and 10 + 2; which sea hex belongs to which region is not drawn (the
green and dark-blue outlines enclose only land hexes), so that split is not
asserted (interpretation I3).

## Transcription: 3 players (SF25 p. 10)

Sea hexes (10): (2, -3), (2, -2), (2, -1), (3, -1), (-2, 0), (1, 0), (1, 1), (2, 1), (0, 2), (-1, 3).

| (q, r) | Terrain | Disc | Island |
|---|---|---|---|
| (1, -3) | desert | – | 1 |
| (0, -2) | desert | – | 1 |
| (1, -2) | forest | 4 | 1 |
| (-1, -1) | desert | – | 1 |
| (0, -1) | hills | 5 | 1 |
| (1, -1) | pasture | 6 | 1 |
| (-1, 0) | mountains | 3 | 1 |
| (0, 0) | forest | 10 | 1 |
| (-3, 1) | forest | 11 | 1 |
| (-2, 1) | hills | 6 | 1 |
| (-1, 1) | fields | 2 | 1 |
| (0, 1) | hills | 9 | 1 |
| (-3, 2) | mountains | 10 | 1 |
| (-2, 2) | fields | 9 | 1 |
| (-1, 2) | forest | 8 | 1 |
| (-3, 3) | pasture | 8 | 1 |
| (-2, 3) | pasture | 4 | 1 |
| (0, -3) | gold | 4 | 2 |
| (-1, -2) | forest | 3 | 2 |
| (-2, -1) | fields | 6 | 2 |
| (3, -3) | mountains | 8 | 3 |
| (3, -2) | pasture | 12 | 3 |
| (2, 0) | gold | 5 | 4 |
| (1, 2) | fields | 9 | 5 |
| (0, 3) | mountains | 5 | 5 |

Harbors, in `harborSlots` order:

| # | Hex (q, r) | Side | Token |
|---|---|---|---|
| 1 | (1, -2) | 1 | lumber |
| 2 | (0, 1) | 1 | generic |
| 3 | (0, 1) | 5 | generic |
| 4 | (-2, 3) | 0 | generic |
| 5 | (-3, 3) | 5 | brick |
| 6 | (-3, 3) | 3 | ore |
| 7 | (-3, 1) | 4 | wool |
| 8 | (-2, 1) | 2 | grain |

## Transcription: 4 players (SF25 p. 11)

Sea hexes (12): (3, -3), (3, -2), (3, -1), (-2, 0), (2, 0), (3, 0), (1, 1), (0, 2), (1, 2), (2, 2), (-3, 3), (-1, 3).

| (q, r) | Terrain | Disc | Island |
|---|---|---|---|
| (1, -3) | desert | – | 1 |
| (2, -3) | forest | 5 | 1 |
| (0, -2) | desert | – | 1 |
| (1, -2) | hills | 3 | 1 |
| (2, -2) | pasture | 6 | 1 |
| (-1, -1) | desert | – | 1 |
| (0, -1) | mountains | 8 | 1 |
| (1, -1) | fields | 10 | 1 |
| (2, -1) | forest | 4 | 1 |
| (-1, 0) | forest | 10 | 1 |
| (0, 0) | hills | 11 | 1 |
| (1, 0) | pasture | 9 | 1 |
| (-3, 1) | hills | 12 | 1 |
| (-2, 1) | hills | 6 | 1 |
| (-1, 1) | fields | 5 | 1 |
| (0, 1) | forest | 8 | 1 |
| (-3, 2) | pasture | 3 | 1 |
| (-2, 2) | pasture | 11 | 1 |
| (-1, 2) | mountains | 4 | 1 |
| (-2, 3) | forest | 9 | 1 |
| (0, -3) | gold | 10 | 2 |
| (-1, -2) | mountains | 11 | 2 |
| (-2, -1) | fields | 8 | 2 |
| (4, -3) | mountains | 9 | 3 |
| (4, -2) | fields | 4 | 3 |
| (4, -1) | hills | 2 | 3 |
| (2, 1) | gold | 5 | 4 |
| (3, 1) | pasture | 3 | 4 |
| (0, 3) | mountains | 6 | 5 |
| (1, 3) | fields | 12 | 5 |

Harbors, in `harborSlots` order:

| # | Hex (q, r) | Side | Token |
|---|---|---|---|
| 1 | (2, -3) | 0 | brick |
| 2 | (2, -1) | 1 | generic |
| 3 | (2, -1) | 5 | generic |
| 4 | (0, 1) | 5 | generic |
| 5 | (-2, 3) | 0 | lumber |
| 6 | (-2, 3) | 4 | generic |
| 7 | (-3, 2) | 5 | ore |
| 8 | (-3, 2) | 3 | grain |
| 9 | (-1, 0) | 3 | wool |


Robber: (0, -2), a desert, on both maps (the printed robber stands on the
desert). Pirate: on the frame strip above the first row between (0, -3) and
(1, -3) on both maps (`pirate: null`). Island sizes (3 players): 1 → 17
(including 3 deserts), 2 → 3, 3 → 2, 4 → 1, 5 → 2 (25 land hexes); (4 players):
1 → 20, 2 → 3, 3 → 3, 4 → 2, 5 → 2 (30 land hexes).

Harbors facing the frame instead of a sea hex (second transcription's note):
3 players #5 and #6 at (-3, 3) (sides 5 and 3) and #7 at (-3, 1) (side 4);
4 players #6 at (-2, 3) (side 4) and #8 at (-3, 2) (side 3). Land hexes with
two harbor tokens: (0, 1) on 3 players (sides 1 and 5); (2, -1) (sides 1 and 5),
(-2, 3) (sides 0 and 4) and (-3, 2) (sides 5 and 3) on 4 players.

## Interpretations

| # | Item | Decision | Basis |
|---|---|---|---|
| I1 | Island numbers | Main island 1 (deserts included), land strip 2, small islands 3, 4, 5. `islands[]` is a layout field, not a connectivity component: the strip touches the main island's desert but keeps number 2. | SF25 p. 10 outlines; spec §5.1 last bullet |
| I2 | Desert belongs to the main island | The deserts have no outline; they are part of the island the desert divides ("The desert divides the largest island into a small land strip … and a larger set of hexes (the main island)"). | SF25 p. 10 |
| I3 | Sea sub-table | Main-island sea 8 / 10 and outlying sea 2 / 2 (SFCN-20) are not checkable on the page: the outlines enclose land only. Only the sum against the sea-hex count of each map is asserted. | Both transcriptions; page art |
| I4 | Pirate start | Both maps print the pirate on the top frame, so `pirate: null`, as for New Shores and The Four Islands. | SF25 pp. 10–11 map art; `2026-11-01-seafarers.md` |
| I5 | Robber start | The desert (0, -2) on both maps; `layout.robber` is that hex, so no 12 disc is involved. | SF25 pp. 10–11; spec §5.4 |
| I6 | Starting settlements | Only the main island, and **no corner may touch any hex of islands 2–5**: the check is `islandsAt(vertex)` all equal to 1 and not empty (`allowBuilding` for `through-the-desert`). A main-island corner next to the land strip (for example between the desert (0, -2) and the strip hex (-1, -2)) touches island 2, so it is excluded. New Shores keeps its "touches the main island" rule; Four Islands stays open; `sf-2025.2` is unchanged. | SF25 p. 10; spec §5.2 |
| I7 | Island bonus | Profile `islandBonus: { points: 2, skip: 'main' }` (S1): each player gets +2 VP for the first settlement in each unexplored region, even if others are there already; nothing during setup. A corner touching the desert (island 1) and the strip (island 2) counts for island 2, because `bonusIslands` drops the main island first and then counts the rest once each; a corner that touches two regions would count both (no corner does on either map; the test asserts it). | SF25 p. 10; spec §5.1 |
| I8 | Roads and settlements on the desert | As in the base rules: allowed; the desert produces nothing. Nothing was added. | SF25 p. 10; spec §6.2 |
| I9 | Gold | Two gold hexes (strip and island 4) work as in New Shores, so the generic gold help line is shown. | SF25 pp. 2–3 |
| I10 | Victory | 14 VP on the own turn at any moment. | SF25 p. 10 |
| I11 | Wording | The web calls the bonus "unexplored region" (「未探索區域」): events, player panel and help; New Shores keeps "small island", Four Islands "new island". The help avoids "small island" on this map. | spec §5.1, §7.5 |
| I12 | Web bonus display | The player panel multiplies claimed regions by 2 (`ISLAND_BONUS_POINTS`), correct for S4. | `packages/web/src/board/seafarers.ts` |

## What was built

| Area | Files | Notes |
|---|---|---|
| Maps | `packages/rules/src/seafarers-scenario-boards.ts` (extended); `layout-registry.ts` (`sf-through-the-desert`) | `NS4_CELLS` now exported from `seafarers-boards.ts`; topologies registered through the existing `SCENARIO_TOPOLOGIES` |
| Rules | `packages/rules/src/modules/seafarers/islands.ts` | `allowBuilding` for `through-the-desert`; the bonus itself is the S1 rule table |
| Profile | `packages/rules/src/profiles.ts` | `topologyId: sf-through-the-desert-3`, `implemented: true`, `enabled: true` |
| Web | `HelpPanel.tsx`, `PlayersPanel.tsx`, `i18n/events.ts`, `i18n/islandWording.ts` (new), `i18n/modules/seafarers.ts` | desert help (setup, bonus, gold kept), unexplored-region wording in zh-Hant and en |
| Evidence | `packages/rules/test/seafarers-through-the-desert.test.ts`, `seafarers-sim.test.ts`, `packages/server/test/seafarers-through-the-desert.test.ts`, `packages/web/test/seafarers-through-the-desert.test.tsx`, `scripts/seafarers/capture_through_the_desert.py`, `desert_fixture.mjs` | see below |

## Verification

- Rules: `seafarers-through-the-desert.test.ts` (topology counts: 35 hexes /
  126 edges / 92 vertices / 42 frame edges / 8 harbor slots and 42 / 149 /
  108 / 46 / 9; both layouts against the tables; main / outlying sub-tables;
  island numbers, robber and pirate; harbors; every transcribed cell; setup:
  the legal corners on an empty board are exactly those touching only island 1,
  and the excluded main-island corners next to the strip exist; a whole setup
  on the main island with no bonus and no `home`; four regions each +2 for one
  player reaching 14 VP; per-player counting and no repeat; the desert/strip
  corner counts for island 2 only; 14 VP wins and 13 does not; VP tokens 24 /
  32), simulated 3- and 4-player games to a 14-point winner with supply
  conservation, at most 15 ships and bonus within the token supply,
  `profiles.test.ts`; New Shores and Four Islands layout / rules / island-bonus
  tests unchanged.
- Service: room by ruleset parts for 3 and 4 players, 5 and 6 refused
  (`bad-player-count`), bot seat refused (`E_INVALID_BOT`, reason `profile`),
  3- and 4-player starts on the two frames with the robber on a desert, every
  setup spot on the main island, mid-game restart, a 14-point finish by
  settling a region, and a pending gold choice (rolled on the gold next to a
  region settlement) that survives a restart and can be completed.
- Web: SVG board (hexes, harbors, pirate on the frame), coastline loops (the
  main island and the strip form one landmass, plus three small islands = 4
  loops), help panel in both locales (gold line kept, no "small island"),
  event and panel wording.
- Browser: `scripts/seafarers/capture_through_the_desert.py` (11 cases, no
  page errors; Chromium, software WebGL, `SF_TIMEOUT=180000` on the shared
  machine): lobby (3–4 players only), both maps in SVG and 3D (desktop; phone
  for the 4-player map), 4-player setup over the API with every spot on the
  main island (`desert_fixture.mjs check` confirms no starting settlement
  touches an unexplored region, and `home` is absent), the help panel (desert
  setup and bonus lines, gold line kept), then a live finish through the UI. A
  test-only fixture (service stopped) gives player 1 the turn, building cards,
  6 other bonus points and a road to two empty corners: one between the desert
  and the land strip (touches islands 1 and 2), one on small island 3. Player 1
  settles the first through the 3D renderer (+2, recorded for island 2 only;
  canvas `data-island-tokens` = 1, then token in SVG and the region list in the
  player panel) and the second in SVG (+2, 14 VP, result screen). Setup
  commands are checked for an `accepted` receipt, not just HTTP ok.
  The run fails if a token or the result screen is missing. Report with sha256
  per image: `docs/screenshots/seafarers-through-the-desert/report.json`; 9 of
  the 11 captures are kept in the repository (`committed: true`), the 3-player
  3D map and the 4-player phone 3D map are not (`committed: false`).
- The shared harness `scripts/seafarers/capture.py` now waits `SF_TIMEOUT` (at
  least 30 s) for the renderer and sets it on the phone page; before, a loaded
  machine failed on those fixed 30 s timeouts.

## Limitations

- No human playtest, physical device or screen-reader check.
- Variable setup (SF25 p. 11: deserts fixed, main island and outlying regions
  shuffled separately, red discs apart and not on gold) is not offered (S10).
- No bots: the profile is outside the bot support list and refuses bot seats.
