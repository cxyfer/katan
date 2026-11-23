# Seafarers scenario S3: The Fog Islands

Advisory work record for slice S3 of
[the scenarios spec](../specs/2026-11-22-seafarers-scenarios.md) (D5, D7, D9;
§2.3, §5.2, §5.3, §5.4, §6.3, §7.3, §7.5, §9 OQ-2, §10, §11). Branch
`feat/sfx-s3-fog-islands`, based on `release/v0.4.6` (S0 registry, S1 island
rule table, S2 four islands). Profile `sf-fog-islands-2025` (3 and 4 players,
12 VP, rule version `sf-2025.3`, no island bonus), enabled by this slice.

## Sources (accessed 2026-11-23)

| Id | Edition | Publication | File | SHA-256 | Pages used |
|---|---|---|---|---|---|
| SF25 | CATAN – Seafarers, 2025 (`v6.250401`) | CN3083 | `CN3083 CATAN–Seafarers Rulebook 2025 secured reduced.pdf` (20 pp.) | `a499abe2b613afd618dd3c806790400c7e84adebcc9b9ab19a24fb80dd04b099` (same file as `2026-11-01-seafarers.md`) | 2–3 (rules), 8 (The Fog Islands, 3 players: map, component table, setup, exploration, victory), 9 (4 players: map, component table, variable-setup text) |

The PDF is not in the repository. Pages were rendered at 200 dpi outside the
repository (`p08.png` sha256 prefix `adb6783798ebb8a5`, `p09.png`
`54d1c94ab9f1763b`) and read as images; no code from the download was executed.

## Method

1. **Two independent transcriptions** (SF25 pages only, neither saw the other's
   output): per player count the 14 / 17 known land hexes (terrain, disc, island),
   every known sea hex, the 12 empty spaces, the harbor tokens (hex, side, type),
   the robber and the pirate, plus the component table's Facedown row.
2. **Cell-by-cell comparison.** Compared field by field (parsed values, notes
   excluded): terrain, disc, island, sea cells, fog cells, harbors (incl. side),
   robber, pirate, fog deck. **Identical in every item**; the files differ only in
   free-text notes. The pirate was judged to stand on the frame in both
   transcriptions (both maps), and the 3-player page was spot-checked against the
   image by the implementer.
3. **Checksums** below, re-run on the real layouts by
   `packages/rules/test/seafarers-fog-islands.test.ts`, which also compares every
   transcribed cell with the built layout and checks the deck inventory.
4. **Frame.** Both maps are 42 hexes = `NS4_CELLS` (rows 5-6-7-6-7-6-5; the two
   bumps at the ends of the middle row are frame): 30 known hexes + 12 empty
   spaces. Topology ids `sf-fog-islands-3` (8 harbor slots) and
   `sf-fog-islands-4` (9) share the hex list with `sf-new-shores-4`. Data lives in
   `seafarers-fog-islands-boards.ts` (a separate file from
   `seafarers-scenario-boards.ts`, which spec §7.3 names; kept apart so parallel slices do not collide).
5. Coordinates are axial, pointy-top (`r` grows downwards); harbor `side` follows
   `NEIGHBOR_DIRS` (0 E, 1 NE, 2 NW, 3 W, 4 SW, 5 SE).

## Checksums

| | Sea | Fields | Forest | Hills | Mountains | Pasture | Total |
|---|---|---|---|---|---|---|---|
| 3 players known (table p. 8 = transcription) | 16 | 2 | 4 | 2 | 2 | 4 | 30 |
| 4 players known (table p. 9 = transcription) | 13 | 3 | 4 | 3 | 3 | 4 | 30 |

| Known discs | 2 | 3 | 4 | 5 | 6 | 8 | 9 | 10 | 11 | 12 | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 3 players (table = transcription) | – | 1 | 1 | 2 | 2 | 2 | 2 | 1 | 2 | 1 | 14 |
| 4 players (table = transcription) | 1 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 1 | 1 | 17 |

Facedown deck (both player counts, tables pp. 8–9): sea 2, gold 2, fields 2,
hills 2, mountains 2, pasture 1, forest 1 (12 tiles). Facedown discs: 3 players
3:2, 4:1, 5:1, 6:1, 8:1, 9:1, 10:1, 11:1, 12:1; 4 players 3:1, 4:1, 5:1, 6:1,
8:1, 9:1, 10:1, 11:2, 12:1 (10 discs). Harbors: 5×2:1 + 3×3:1 (3 players), 5×2:1 +
4×3:1 (4 players). No VP tokens. The layout holds sea for the 12 empty spaces, so
the built layout has 28 (3 players) / 25 (4 players) sea hexes = known sea + 12.

## Transcription: 3 players (SF25 p. 8)

Known sea hexes (16): (2, -3), (2, -2), (-2, -1), (-1, -1), (0, -1), (2, -1), (0, 0), (2, 0), (-3, 1), (0, 1), (2, 1), (3, 1), (-3, 2), (0, 2), (-3, 3), (-1, 3).
Empty spaces (12): (0, -3), (1, -3), (-1, -2), (0, -2), (1, -2), (1, -1), (1, 0), (1, 1), (1, 2), (2, 2), (0, 3), (1, 3).

| (q, r) | Terrain | Disc | Island |
|---|---|---|---|
| (3, -3) | hills | 6 | 2 |
| (4, -3) | forest | 11 | 2 |
| (3, -2) | forest | 5 | 2 |
| (4, -2) | fields | 3 | 2 |
| (3, -1) | pasture | 8 | 2 |
| (4, -1) | pasture | 9 | 2 |
| (3, 0) | mountains | 4 | 2 |
| (-2, 0) | forest | 6 | 3 |
| (-1, 0) | pasture | 5 | 3 |
| (-2, 1) | hills | 11 | 3 |
| (-1, 1) | forest | 9 | 3 |
| (-2, 2) | mountains | 8 | 3 |
| (-1, 2) | fields | 10 | 3 |
| (-2, 3) | pasture | 12 | 3 |

Harbors, in `harborSlots` order:

| # | Hex (q, r) | Side | Token | Faces |
|---|---|---|---|---|
| 1 | (3, -3) | 1 | generic | frame |
| 2 | (4, -3) | 0 | wool | frame |
| 3 | (4, -1) | 1 | grain | frame |
| 4 | (3, 0) | 0 | generic | frame |
| 5 | (-2, 0) | 4 | ore | sea |
| 6 | (-2, 1) | 4 | lumber | sea |
| 7 | (-1, 2) | 5 | brick | sea |
| 8 | (-2, 3) | 3 | generic | sea |

Robber: (-2, 3), the pasture 12. Pirate: on the frame (`pirate: null`).
Islands: 2 (north-east) → 7 hexes, 3 (south-west) → 7 hexes.

## Transcription: 4 players (SF25 p. 9)

Known sea hexes (13): (1, -3), (1, -2), (-2, -1), (-1, -1), (1, -1), (2, -1), (-1, 0), (2, 0), (-1, 1), (2, 1), (-1, 2), (2, 2), (-1, 3).
Empty spaces (12): (0, -3), (-1, -2), (0, -2), (0, -1), (0, 0), (1, 0), (0, 1), (1, 1), (0, 2), (1, 2), (0, 3), (1, 3).

| (q, r) | Terrain | Disc | Island |
|---|---|---|---|
| (2, -3) | hills | 4 | 2 |
| (3, -3) | fields | 10 | 2 |
| (4, -3) | mountains | 3 | 2 |
| (2, -2) | pasture | 9 | 2 |
| (3, -2) | forest | 6 | 2 |
| (4, -2) | hills | 12 | 2 |
| (3, -1) | pasture | 10 | 2 |
| (4, -1) | mountains | 8 | 2 |
| (3, 0) | fields | 11 | 2 |
| (3, 1) | forest | 5 | 2 |
| (-2, 0) | mountains | 3 | 3 |
| (-3, 1) | fields | 6 | 3 |
| (-2, 1) | forest | 4 | 3 |
| (-3, 2) | hills | 9 | 3 |
| (-2, 2) | pasture | 8 | 3 |
| (-3, 3) | pasture | 2 | 3 |
| (-2, 3) | forest | 5 | 3 |

Harbors, in `harborSlots` order:

| # | Hex (q, r) | Side | Token | Faces |
|---|---|---|---|---|
| 1 | (2, -3) | 1 | wool | frame |
| 2 | (4, -3) | 2 | grain | frame |
| 3 | (4, -3) | 0 | generic | frame |
| 4 | (4, -1) | 1 | brick | frame |
| 5 | (3, 1) | 1 | generic | frame |
| 6 | (-2, 0) | 3 | lumber | frame |
| 7 | (-3, 1) | 4 | ore | frame |
| 8 | (-3, 3) | 3 | generic | frame |
| 9 | (-3, 3) | 5 | generic | frame |

Robber: (4, -2), the hills 12. Pirate: on the frame below the (0, 3) / (1, 3)
spaces (`pirate: null`). Islands: 2 (north-east) → 10 hexes, 3 (south-west) → 7 hexes.

## Interpretations

| # | Item | Decision | Basis |
|---|---|---|---|
| I1 | Island numbers | The two known islands are numbered 2 and 3 (transcribed as 1 and 2; renumbered because 1 is `MAIN_ISLAND`). They have no gameplay role: the profile has no `islandBonus`. A hex revealed later keeps island 0. | `seafarers-boards.ts` convention |
| I2 | Fog storage | The 12 spaces are `sea` with no number in the layout; `SeafarersState.fog` holds `hexes` (unrevealed, public) and the remaining tile and disc multisets (server-only, sorted, never projected). Tile and disc are drawn with `ctx.rng` at the moment of reveal, which is the same game as a shuffled face-down stack. No hex-to-identity record exists anywhere before the reveal (spec D5; same as E&P). | D5, `explorers-pirates-boards.ts` |
| I3 | Trigger (OQ-2 a) | Building a road or a ship so that either end of that edge touches a space discovers it. One space: revealed at once. Several at once: the placer chooses (`seafarers.fog` frame, `fog.choose <built-in function hex>`, public candidates, answered only by the placer). A frame queued behind another frame drops candidates revealed meanwhile. | SF25 p. 8 (singular "a new location", "the empty hex space") |
| I4 | Moving a ship (OQ-2 b) | Does **not** explore. SF25 p. 8 says "place a ship or road"; S5 spells out "build or move" where it means both. Profile flag `fogOnMove` (default `false`) switches it without touching other rules (tested). | SF25 pp. 8, 12 |
| I5 | Gold (OQ-2 c) | A revealed gold hex is land: it gets a disc and the explorer takes 1 resource of their own choice (reusing the `seafarers.gold` frame and picker); resources the supply lacks cannot be taken, and with an empty supply nothing is taken. | SF25 p. 8 ("the type produced by that hex"); gold rule p. 2 |
| I6 | Land resource | The explorer takes 1 card of the hex's resource if the supply has it, else nothing. Sea: no disc, no card. The hex stays terrain `sea` with no number. | SF25 p. 8 |
| I7 | Villages | Settlements and cities never explore. | SF25 p. 8 (ship or road only) |
| I8 | Setup placements | A starting road or ship counts as "place": a setup ship whose far end touches a space explores (rules test plays setups where this happens; it can only be a ship: no known land hex touches a space). The explorer takes the resource at once; a gold hex or a multi-space touch raises the same frames, and the next setup step waits for the answer. Starting **settlements** are limited to hexes of the known islands (every land hex around the intersection must carry an island number), so land revealed during setup is not a legal start. | SF25 p. 8 "may be placed on one island or two"; spec §5.2 |
| I9 | Robber and pirate | Robber starts on the 12 disc. It only goes on land (a space is stored as sea, so never). The pirate starts on the frame, goes only on revealed sea hexes or the frame, never on an unrevealed space (`E_ILLEGAL_TARGET`, and the hint list omits them). | SF25 p. 8; spec §5.4 |
| I10 | Victory | 12 VP on the own turn, no island bonus. | SF25 p. 8 |
| I11 | Variable setup | SF25 p. 9 variable setup (known land random, reds may touch, ports random) is deferred to S10. | spec §10 |

## What was built

| Area | Files | Notes |
|---|---|---|
| Maps | `packages/rules/src/seafarers-fog-islands-boards.ts` (new); `layout-registry.ts`, `topology-registry.ts` (one line each); `seafarers-boards.ts` exports `NS4_CELLS` | |
| Rules | `modules/seafarers/fog.ts` (new), `state.ts`, `index.ts`, `ships.ts`, `pirate.ts`, `islands.ts` (`allowBuilding`), `gold.ts` (`enqueueGold`), `messages.ts` | `fog.revealed` event; `fog.choose` command |
| Profile | `profiles.ts` | `fogOnMove`, `topologyId: sf-fog-islands-3`, enabled |
| View | `modules/seafarers/index.ts` | `modules.seafarers.fog` (unrevealed hex list) |
| Web | `SvgBoard.tsx`, `SvgExplorersPirates.tsx` (`FogCloud` exported), `DioramaSeafarers.tsx` (fog banks reuse the E&P model, `data-fog-hexes` probe), `board/intent.ts` (hex choice), `board/seafarers.ts`, `HelpPanel.tsx`, i18n, `audio/cues.ts` | |
| Evidence | rules, server and web tests below; `scripts/seafarers/capture_fog_islands.py`, `fog_islands_fixture.mjs` | |

## Verification

- Rules: `seafarers-fog-islands.test.ts` (topology; both layouts and the fog
  deck value by value; ports beside known land; trigger by ship and road; no
  trigger for settlements or moving; `fogOnMove`; several spaces → choice;
  land + disc + resource; supply-empty; gold pick; sea; setup ships; start
  settlements on known land; robber/pirate limits; 12 VP; privacy SFX-S3-P:
  projection, events, snapshot, same-state-different-draw, JSON restore),
  simulated 3- and 4-player games to a 12-point winner with reveals and a
  conserved supply (`seafarers-sim.test.ts`), `seafarers-exports.test.ts`,
  `profiles.test.ts`; the whole rules suite (65 files) passes.
- Service: room by ruleset parts for 3 and 4 players, 5 and 6 refused, bot seat
  refused, starts with 12 unrevealed hexes and no deck in the view, a mid-game
  restart holding a pending choice frame (answered only by the placer, public
  reveal) and a legal settlement ending the game at 12.
- Web: SVG board (12 clouds, known land, harbors, pirate on the frame), a reveal
  removes its cloud, the choice is a board intent for the placer only,
  inspection reads "Unexplored", help and event wording in both locales.
- Browser: see Browser evidence below.

## Limitations

- No human playtest, physical device or screen-reader check.
- Variable setup (SF25 p. 9) is not offered (S10).
- No bots: the profile is outside the bot support list and refuses bot seats.
- The evidence fixture writes the ships leading to the last ship directly
  (test-only), so some touch unexplored hexes without having revealed them; the
  ship built through the UI is a real placement.

## Browser evidence

`scripts/seafarers/capture_fog_islands.py` (Chromium, software WebGL, built
service on a private SQLite file, `SF_TIMEOUT=180000`): 12 cases, no page
errors. Real UI and API, no mocked snapshots:

1. Lobby: Seafarers / The Fog Islands offers 3 and 4 players only.
2. Both maps in SVG (12 `sf-fog-*` clouds) and 3D (canvas `data-fog-hexes` = 12),
   pirate on the frame; setup over the API; help panel with the fog rules.
3. A test-only fixture (service stopped; `fog_islands_fixture.mjs`) gives player 1
   the turn, two ships' worth of cards and the ship chains to a one-space and a
   two-space path. Through the UI: the one-space ship built on the **SVG** board
   reveals its hex (11 clouds left); the two-space ship built on the **3D**
   board raises the choice prompt with the two candidates highlighted, the pick
   on the 3D board reveals it (10 banks left; a gold hex was answered in the
   gold picker in this run). The run fails if a reveal, the choice frame or a fog
   count is missing; it also asserts the view carries no deck.
4. A second fixture gives player 1 the last points and a free spot; a legal
   settlement ends the game (result screen; no island bonus). The final score is
   14 because the fixture's ship chain also earns the Longest Trade Route.

Report and 9 curated captures plus lobby: `docs/screenshots/seafarers-fog-islands/`
(sha256 per image in `report.json`).
