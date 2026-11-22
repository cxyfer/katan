# Seafarers scenario S2: The Four Islands

Advisory work record for slice S2 of
[the scenarios spec](../specs/2026-11-22-seafarers-scenarios.md) (D2–D5, D7,
D9; §5.1, §5.2, §5.3, §5.4, §6.1, §7.1, §7.3, §7.5, §10, §11). Branch
`feat/sfx-s2-four-islands`, stacked on S1 (island bonus rule table and `SeafarersState.home`).
Profile `sf-four-islands-2025` (3 and 4 players, 13 VP, rule version
`sf-2025.3`), enabled by this slice.

## Sources (accessed 2026-11-22)

| Id | Edition | Publication | File | SHA-256 | Pages used |
|---|---|---|---|---|---|
| SF25 | CATAN – Seafarers, 2025 (`v6.250401`) | CN3083 | `CN3083 CATAN–Seafarers Rulebook 2025 secured reduced.pdf` (20 pp.) | `a499abe2b613afd618dd3c806790400c7e84adebcc9b9ab19a24fb80dd04b099` (same file as `2026-11-01-seafarers.md`) | 2–3 (rules, setup), 6 (The Four Islands, 3 players: map, component table, setup, victory), 7 (4 players: map, component table, variable-setup text) |

The PDF is not in the repository. The pages were rendered to images
(`p06.png`, `p07.png`) outside the repository and read as images; no code from
the download was executed.

## Method

1. **Two independent transcriptions.** Two transcribers, each seeing only the
   SF25 pages (p. 6 for 3 players, p. 7 for 4 players), each transcribed both
   maps: terrain, disc, island number, every sea hex, the nine harbor tokens
   (hex, side, type), the robber and the pirate. Neither saw the other's work
   nor the SFCN-20 screenshots.
2. **Cell-by-cell comparison.** The two files were compared field by field:
   terrain, disc, island number, sea cells, the nine harbors (including the
   side), the robber and the pirate. **They were identical in every item**,
   so no cell had to be re-read against the page.
3. **Checksums against the component tables** (below), and the sub-checks that
   the 3-player map has islands of 4, 6, 6 and 4 hexes and the 4-player map of
   4, 8, 7 and 4 hexes. The tests in
   `packages/rules/test/seafarers-four-islands.test.ts` re-run all of them on
   the real layouts and compare every transcribed cell with the built layout.
4. **Frame.** Both maps sit on the same 35-hex frame as the Heading for New
   Shores 3-player map (`NS3_CELLS`: rows 4-5-6-5-6-5-4; the two bumps at the
   ends of the middle row are frame, not cells). The topology
   ids are `sf-four-islands-3` and `sf-four-islands-4`; they share the hex
   list with `sf-new-shores-3` but carry their own nine `harborSlots`.
   `fourIslandsLayout` picks the topology by player count and checks that it
   has 35 hexes.
5. Coordinates are axial, pointy-top (`r` grows downwards, `topology.ts`);
   harbor `side` follows `NEIGHBOR_DIRS` (0 E, 1 NE, 2 NW, 3 W, 4 SW, 5 SE).

## Checksums

| | Sea | Fields | Forest | Hills | Mountains | Pasture | Total |
|---|---|---|---|---|---|---|---|
| 3 players (table, p. 6) | 15 | 4 | 4 | 4 | 4 | 4 | 35 |
| 3 players (transcription) | 15 | 4 | 4 | 4 | 4 | 4 | 35 |
| 4 players (table, p. 7) | 12 | 5 | 5 | 4 | 4 | 5 | 35 |
| 4 players (transcription) | 12 | 5 | 5 | 4 | 4 | 5 | 35 |

| Discs | 2 | 3 | 4 | 5 | 6 | 8 | 9 | 10 | 11 | 12 | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 3 players (table = transcription) | 1 | 2 | 2 | 3 | 2 | 2 | 3 | 2 | 2 | 1 | 20 |
| 4 players (table = transcription) | 1 | 2 | 3 | 3 | 2 | 2 | 3 | 3 | 3 | 1 | 23 |

Harbors: 5×2:1 (one per resource) + 4×3:1 on both maps. VP tokens (table):
18 for 3 players, 24 for 4 players = players × 3 islands × 2 VP (a player has
at most three non-home islands). The engine does not use a token supply: the
bonus is recorded in `SeafarersState.claims`, which is bounded the same way.

## Transcription: 3 players (SF25 p. 6)

Sea hexes (15): (0, -3), (1, -3), (1, -2), (0, -1), (3, -1), (-2, 0), (-1, 0), (0, 0), (1, 0), (2, 0), (0, 1), (-1, 2), (-2, 3), (-1, 3), (0, 3).

| (q, r) | Terrain | Disc | Island |
|---|---|---|---|
| (-1, -2) | mountains | 4 | 2 |
| (0, -2) | forest | 9 | 2 |
| (-2, -1) | pasture | 6 | 2 |
| (-1, -1) | mountains | 10 | 2 |
| (2, -3) | fields | 4 | 3 |
| (3, -3) | pasture | 3 | 3 |
| (2, -2) | fields | 9 | 3 |
| (3, -2) | hills | 5 | 3 |
| (1, -1) | forest | 8 | 3 |
| (2, -1) | hills | 11 | 3 |
| (-3, 1) | fields | 11 | 4 |
| (-2, 1) | mountains | 8 | 4 |
| (-1, 1) | forest | 3 | 4 |
| (-3, 2) | forest | 5 | 4 |
| (-2, 2) | pasture | 9 | 4 |
| (-3, 3) | pasture | 12 | 4 |
| (1, 1) | hills | 10 | 5 |
| (2, 1) | hills | 6 | 5 |
| (0, 2) | mountains | 2 | 5 |
| (1, 2) | fields | 5 | 5 |

Harbors, in `harborSlots` order:

| # | Hex (q, r) | Side | Token | Faces |
|---|---|---|---|---|
| 1 | (-2, -1) | 2 | generic | frame |
| 2 | (0, -2) | 5 | ore | sea |
| 3 | (3, -2) | 1 | generic | frame |
| 4 | (2, -1) | 4 | brick | sea |
| 5 | (-3, 1) | 1 | lumber | sea |
| 6 | (-3, 1) | 4 | generic | frame |
| 7 | (-2, 2) | 5 | wool | sea |
| 8 | (0, 2) | 2 | generic | sea |
| 9 | (2, 1) | 5 | grain | frame |

Robber: (-3, 3), the pasture 12. Pirate: on the frame below the bottom row
(`pirate: null`). Island sizes: 2 → 4, 3 → 6, 4 → 6, 5 → 4 (20 land hexes).

## Transcription: 4 players (SF25 p. 7)

Sea hexes (12): (1, -3), (0, -2), (0, -1), (3, -1), (-2, 0), (-1, 0), (1, 0), (2, 0), (-1, 1), (0, 1), (0, 2), (-1, 3).

| (q, r) | Terrain | Disc | Island |
|---|---|---|---|
| (0, -3) | pasture | 8 | 2 |
| (-1, -2) | hills | 10 | 2 |
| (-2, -1) | fields | 5 | 2 |
| (-1, -1) | forest | 3 | 2 |
| (2, -3) | forest | 9 | 3 |
| (3, -3) | forest | 11 | 3 |
| (1, -2) | mountains | 3 | 3 |
| (2, -2) | fields | 12 | 3 |
| (3, -2) | pasture | 5 | 3 |
| (1, -1) | hills | 5 | 3 |
| (2, -1) | mountains | 10 | 3 |
| (0, 0) | forest | 6 | 3 |
| (-3, 1) | hills | 4 | 4 |
| (-2, 1) | pasture | 9 | 4 |
| (-3, 2) | fields | 6 | 4 |
| (-2, 2) | mountains | 4 | 4 |
| (-1, 2) | hills | 2 | 4 |
| (-3, 3) | pasture | 10 | 4 |
| (-2, 3) | fields | 11 | 4 |
| (1, 1) | forest | 9 | 5 |
| (2, 1) | pasture | 11 | 5 |
| (1, 2) | mountains | 8 | 5 |
| (0, 3) | fields | 4 | 5 |

Harbors, in `harborSlots` order:

| # | Hex (q, r) | Side | Token | Faces |
|---|---|---|---|---|
| 1 | (-1, -2) | 3 | grain | frame |
| 2 | (-2, -1) | 5 | generic | sea |
| 3 | (0, 0) | 2 | generic | sea |
| 4 | (3, -2) | 5 | lumber | sea |
| 5 | (2, 1) | 2 | ore | sea |
| 6 | (2, 1) | 5 | generic | frame |
| 7 | (-2, 2) | 1 | generic | sea |
| 8 | (-3, 1) | 4 | brick | frame |
| 9 | (-3, 3) | 3 | wool | frame |

Robber: (2, -2), the fields 12 (p. 7: "place the robber on the hex with the
number 12 disc"). Pirate: on the frame (`pirate: null`). Island sizes: 2 → 4,
3 → 8, 4 → 7, 5 → 4 (23 land hexes).

## Interpretations

| # | Item | Decision | Basis |
|---|---|---|---|
| I1 | No main island | Islands are numbered 2–5 (left top, right top, left bottom, right bottom). `MAIN_ISLAND` (1) is not used on these maps. | SF25 p. 6: four islands; island numbers follow the `islands[]` convention of S0 |
| I2 | 4-player right-top island | (0, 0) forest 6 and (1, -1) hills 5 share an edge, so they are one island of 8 hexes (4/8/7/4 = 23). A reader expecting at most 7 hexes per island should re-check this against p. 7. | Both transcriptions drew it that way; sum of island sizes = disc count |
| I3 | Pirate start | Both maps print the pirate on the frame, so `pirate: null`, as for New Shores. The 3-player pirate stands below the bottom row between (-2, 3) and (-1, 3). | SF25 pp. 6–7 map art; same treatment as `2026-11-01-seafarers.md` |
| I4 | Harbors facing the frame | Several harbor tokens (3 players: #1, #3, #6, #9; 4 players: #1, #6, #8, #9) lie on the frame side of a land hex rather than between a land hex and a sea hex. The slot is the land hex's edge facing the frame. New Shores has the same case. | Map art; `harborSlots` accept any edge of the land hex |
| I5 | Low/high discs on forest and pasture | The fixed maps print forest 3 and 11, pasture 12 and 3 (e.g. 4-player (3, -3) forest 11, (-1, -1) forest 3). Transcribed as printed. The "no 2, 3, 11, 12 on forest and pasture" restriction is part of the **variable** setup (p. 7), deferred to S10. | SF25 p. 7 |
| I6 | Starting settlements | Both starting settlements (each with a road or a ship) may go on any island, on one island or on two. No `allowBuilding` restriction is needed: `allowBuilding` restricts only `scenario === 'new-shores'`, so `four-islands` is open by construction and `sf-2025.2` is unchanged. | SF25 p. 6; spec §5.2 |
| I7 | Home islands | At the end of setup the islands touched by a player's starting settlements are recorded in `SeafarersState.home` (S1) and published as `modules.seafarers.home`. | Spec §5.1 |
| I8 | Island bonus | Each player gets +2 VP for the first settlement on each island that is not one of their home islands, even if others are there already. Nothing during setup. Profile `islandBonus: { points: 2, skip: 'home' }`. | SF25 p. 6; spec §5.1 |
| I9 | Victory | 13 VP on the own turn at any moment. | SF25 p. 6 |
| I10 | Web bonus display | The player panel multiplies claimed islands by 2 (`ISLAND_BONUS_POINTS`, also in the bots' `ISLAND_BONUS_VP`); S2 is 2 points, so neither changed. S8 and S9 (1 point) will need a profile-driven value. | `packages/web/src/board/seafarers.ts` |

## What was built

| Area | Files | Notes |
|---|---|---|
| Maps | `packages/rules/src/seafarers-scenario-boards.ts` (new); `layout-registry.ts` (`sf-four-islands`); `topology-registry.ts` | `NS3_CELLS`, `fixedLayout`, `L` exported from `seafarers-boards.ts` |
| Profile | `packages/rules/src/profiles.ts` | `topologyId: sf-four-islands-3`, `implemented: true`, `enabled: true` |
| View | `packages/rules/src/modules/seafarers/index.ts` | `modules.seafarers.home` only when setup recorded it (other scenarios project unchanged) |
| Web | `HelpPanel.tsx`, `i18n/modules/seafarers.ts`, `board/seafarers.ts` | special-rules section (zh-Hant, en); typed `home` |
| Evidence | `packages/rules/test/seafarers-four-islands.test.ts`, `seafarers-sim.test.ts`, `packages/server/test/seafarers-four-islands.test.ts`, `packages/web/test/seafarers-four-islands.test.tsx`, `scripts/seafarers/capture_four_islands.py` | see below |

## Verification

- Rules: `seafarers-four-islands.test.ts` (topology counts: 35 hexes, 126
  edges, 92 vertices, 42 frame edges, 9 harbor slots; both layouts; setup on
  any island; home islands; per-player island bonus; 13 VP), simulated 3- and
  4-player games to a 13-point winner with supply conservation and at most 15
  ships per player, `seafarers-exports.test.ts` (`home` view key),
  `profiles.test.ts`; New Shores layout/rules/island-bonus tests and the base
  regression digests unchanged.
- Service: room by ruleset parts for 3 and 4 players, 5 and 6 refused
  (`bad-player-count`), bot seat refused (`E_INVALID_BOT`, reason `profile`),
  3- and 4-player starts, home islands, mid-game restart, a 13-point finish.
- Web: SVG board (hexes, nine harbors, pirate on the frame), coastline loop
  for the frame, help panel in both locales.
- Browser: `scripts/seafarers/capture_four_islands.py` (see the report file
  listed in the index).

## Limitations

- No human playtest, physical device or screen-reader check.
- Variable setup (SF25 p. 7) is not offered (S10).
- No bots: the profile is outside the bot support list and refuses bot seats.
