# Seafarers scenario S5: The Forgotten Tribe

Advisory work record for slice S5 of
[the scenarios spec](../specs/2026-11-22-seafarers-scenarios.md) (D2–D5, D7,
D9; §3, §5.2–§5.4, §6.4, §7.1, §7.3, §7.5, §8, §10, §11 including SFX-S5).
Branch `feat/sfx-s5-forgotten-tribe`, based on `release/v0.4.6` (S0–S2 and S4
merged: the shared scenario board module, the profile-driven island bonus).
Profile `sf-forgotten-tribe-2025` (3 and 4 players on one shared map, 13 VP,
rule version `sf-2025.3`), enabled by this slice.

## Sources (accessed 2026-11-23)

| Id | Edition | Publication | File | SHA-256 | Pages used |
|---|---|---|---|---|---|
| SF25 | CATAN – Seafarers, 2025 (`v6.250401`) | CN3083 | `CN3083 CATAN–Seafarers Rulebook 2025 secured reduced.pdf` (20 pp.) | `a499abe2b613afd618dd3c806790400c7e84adebcc9b9ab19a24fb80dd04b099` (same file as `2026-11-01-seafarers.md`) | 2–3 (rules), 12–13 (The Forgotten Tribe: component table, setup, additional rules, VP tokens, development cards, ports, victory, variable setup; the map is a two-page spread) |

The PDF is not in the repository. The pages were rendered to images
(`p12.png`, `p13.png`, joined at the seam at original size) outside the
repository and read as images; no code from the download was executed.

## Method

1. **Two independent transcriptions** (`s5-A.json`, `s5-B.json`, outside the
   repository). Two transcribers, each seeing only the SF25 spread, transcribed
   the whole map: terrain, disc, island number, every sea hex, the frame outline
   (rows and the two protrusions), the robber, the pirate and all 18 marker
   positions (hex, side, kind). Neither saw the other's work.
2. **Comparison.** Field by field: land (terrain, disc, island), sea, outline
   rows, frame protrusions, ports, pirate and the 18 markers (kind, hex, side)
   are **identical** (the two files differ only in key order and notes: A lists
   the three robber deserts under `robberDeserts`, B under `robber.deserts`;
   B adds a note per marker; A lists the three blue-outlined hexes of the
   variable setup). No cell had to be re-read against the page.
3. **Coordinates shifted once.** The transcription origin is "top row r = 0,
   leftmost cell of that row q = 0" (outline rows `[0,5] [-1,5] [-2,5] [-2,4]
   [-3,4] [-3,3] [-3,2]`, middle-row protrusions at (-3,3) and (5,3)). The repo
   convention (NS3/NS4) puts the middle of the middle row at (0, 0). The shift
   is applied **once**, in `seafarers-scenario-boards.ts`
   (`FT_SHIFT = { dq: -1, dr: -3 }`, every transcribed `(q, r)` becomes
   `(q - 1, r - 3)`): the middle row becomes r = 0 with q in [-4, 4] (protrusions
   at (-4, 0) and (4, 0)), and each row is symmetric about x = 0 (a test asserts
   it). This record lists both coordinates.
4. **Frame.** 49 cells, rows 6-7-8-7-8-7-6 (centred: r = -3 q in [-1, 4];
   r = -2 [-2, 4]; r = -1 [-3, 4]; r = 0 [-3, 3]; r = 1 [-4, 3]; r = 2 [-4, 2];
   r = 3 [-4, 1]). The two hex-shaped protrusions at the ends of the middle row
   are frame, as in New Shores (otherwise 51 cells and 21 sea against the
   table's 49 and 19). One topology `sf-forgotten-tribe` (172 edges, 124
   vertices, 50 frame inner edges, 6 harbor slots), shared by 3 and 4 players
   (SF25 has one map; the SFCN-20 caption "3 players" is ignored, spec §6.4).
   The wide frame shape is used by S5 only so far; S7/S8 decide later whether
   to share it (spec §7.3).
5. **Gift positions are edges** between a land hex and the frame, given as
   `(hex, side)` with `side` following `NEIGHBOR_DIRS` (0 E, 1 NE, 2 NW, 3 W,
   4 SW, 5 SE); the 6 port positions are the topology's `harborSlots`, so the
   layout starts with no printed harbor (`layout.harbors = []`).
6. **Islands.** Island 1 is the large island (the three middle rows, 18 hexes,
   every one with a disc). The small islands carry no disc: 2 (top left, gold
   + mountains), 3 (top right, desert, mountains, fields), 4 (right, pasture),
   5 (right, forest), 6 (bottom left, desert, hills), 7 (bottom right, hills,
   desert, gold) = 12 hexes with three deserts and two gold fields.

## Checksums

| | Sea | Desert | Gold | Fields | Forest | Hills | Mountains | Pasture | Total |
|---|---|---|---|---|---|---|---|---|---|
| Table (p. 12; spec §6.4) | 19 | 3 | 2 | 5 | 5 | 5 | 5 | 5 | 49 |
| Transcription (both) | 19 | 3 | 2 | 5 | 5 | 5 | 5 | 5 | 49 |

| Discs | 2 | 3 | 4 | 5 | 6 | 8 | 9 | 10 | 11 | 12 | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Table = transcription | 1 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 1 | 18 |

Ports: 5×2:1 (one per resource) + 1×3:1 = 6 tokens for 6 positions. VP tokens
8, development cards 4 (top of the deck), markers 8 + 4 + 6 = 18 = the 18
transcribed positions. Large island 18 hexes = 18 discs; small islands 12
hexes = 0 discs. `packages/rules/test/seafarers-forgotten-tribe.test.ts`
re-runs all of these on the real layout and compares every transcribed cell.

## Transcription (SF25 pp. 12–13)

Columns: transcription coordinate, repo (centred) coordinate, terrain, disc,
island.

| (q, r) as transcribed | (q, r) in the repo | Terrain | Disc | Island |
|---|---|---|---|---|
| (0, 0) | (-1, -3) | gold | – | 2 |
| (1, 0) | (0, -3) | mountains | – | 2 |
| (3, 0) | (2, -3) | desert | – | 3 |
| (4, 0) | (3, -3) | mountains | – | 3 |
| (5, 0) | (4, -3) | fields | – | 3 |
| (-2, 2) | (-3, -1) | fields | 6 | 1 |
| (-1, 2) | (-2, -1) | forest | 9 | 1 |
| (0, 2) | (-1, -1) | mountains | 11 | 1 |
| (1, 2) | (0, -1) | hills | 5 | 1 |
| (2, 2) | (1, -1) | forest | 6 | 1 |
| (3, 2) | (2, -1) | mountains | 4 | 1 |
| (5, 2) | (4, -1) | pasture | – | 4 |
| (-2, 3) | (-3, 0) | pasture | 10 | 1 |
| (-1, 3) | (-2, 0) | hills | 8 | 1 |
| (0, 3) | (-1, 0) | pasture | 4 | 1 |
| (1, 3) | (0, 0) | fields | 12 | 1 |
| (2, 3) | (1, 0) | forest | 5 | 1 |
| (3, 3) | (2, 0) | pasture | 2 | 1 |
| (-3, 4) | (-4, 1) | forest | 11 | 1 |
| (-2, 4) | (-3, 1) | fields | 9 | 1 |
| (-1, 4) | (-2, 1) | mountains | 3 | 1 |
| (0, 4) | (-1, 1) | pasture | 8 | 1 |
| (1, 4) | (0, 1) | hills | 10 | 1 |
| (2, 4) | (1, 1) | fields | 3 | 1 |
| (4, 4) | (3, 1) | forest | – | 5 |
| (-3, 6) | (-4, 3) | desert | – | 6 |
| (-2, 6) | (-3, 3) | hills | – | 6 |
| (0, 6) | (-1, 3) | hills | – | 7 |
| (1, 6) | (0, 3) | desert | – | 7 |
| (2, 6) | (1, 3) | gold | – | 7 |

Sea hexes (19, repo coordinates): (1, -3), (-2, -2), (-1, -2), (0, -2), (1, -2), (2, -2), (3, -2), (4, -2), (3, -1), (3, 0), (2, 1), (-4, 2), (-3, 2), (-2, 2), (-1, 2), (0, 2), (1, 2), (2, 2), (-2, 3).

Robber: any desert; the three deserts are (2, -3), (-4, 3) and (0, 3) (printed
robber on (0, 3)). Pirate: the sea hex (1, -3) (transcribed (2, 0)), between
the two top small islands. Blue-outlined hexes of the variable setup (p. 13):
transcribed (3,2), (3,3), (2,4) = repo (2,-1), (2,0), (1,1); they take no 5,
6, 8 or 9 in the variable setup (S10) and are not used by the fixed map.

## The 18 gift edges

All 18 are edges between a land hex and the frame (`edge.hexes.length === 1`,
a frame inner edge, spec §6.4); none is a sea–land or sea–sea edge. Hex and
side as transcribed (kind drawn on the page: a coin badge for VP, a card
rectangle across the hex's east or west edge for development cards, a "?" tab
for ports), then the repo hex and the edge index in `sf-forgotten-tribe`.

| # | Kind | Hex as transcribed | Hex in the repo | Side | Edge index |
|---|---|---|---|---|---|
| 1 | vp | (0, 0) gold | (-1, -3) | 1 (NE) | 4 |
| 2 | vp | (3, 0) desert | (2, -3) | 1 (NE) | 19 |
| 3 | vp | (5, 0) fields | (4, -3) | 1 (NE) | 29 |
| 4 | vp | (5, 2) pasture | (4, -1) | 0 (E) | 81 |
| 5 | vp | (4, 4) forest | (3, 1) | 0 (E) | 130 |
| 6 | vp | (-3, 6) desert | (-4, 3) | 5 (SE) | 153 |
| 7 | vp | (0, 6) hills | (-1, 3) | 4 (SW) | 164 |
| 8 | vp | (2, 6) gold | (1, 3) | 5 (SE) | 169 |
| 9 | devcard | (0, 0) gold | (-1, -3) | 3 (W) | 2 |
| 10 | devcard | (5, 0) fields | (4, -3) | 0 (E) | 30 |
| 11 | devcard | (-3, 6) desert | (-4, 3) | 3 (W) | 155 |
| 12 | devcard | (2, 6) gold | (1, 3) | 0 (E) | 171 |
| 13 | port | (0, 0) gold | (-1, -3) | 2 (NW) | 3 |
| 14 | port | (3, 0) desert | (2, -3) | 2 (NW) | 18 |
| 15 | port | (5, 2) pasture | (4, -1) | 1 (NE) | 80 |
| 16 | port | (4, 4) forest | (3, 1) | 5 (SE) | 127 |
| 17 | port | (-3, 6) desert | (-4, 3) | 4 (SW) | 154 |
| 18 | port | (0, 6) hills | (-1, 3) | 5 (SE) | 163 |

Port positions are in `harborSlots` order (the table's last six rows).

## Interpretations

| # | Item | Decision | Basis |
|---|---|---|---|
| I1 | Ships on land–frame edges | **No engine change was needed.** The frame's inner edge is a sea edge (`isSeaEdge`: a boundary edge counts as sea, as for New Shores, whose harbors already face the frame), so a ship may be built or moved onto each of the 18 gift edges like any other sea edge, and the pirate rule applies to them unchanged (they never touch the pirate's sea hex). A road could in principle be built on such a coast edge, but only ships take a gift ("build or move one of your ships"), and no settlement can stand on a small island, so roads cannot reach those edges at all (a test builds one by fixture and checks the gift stays). | SF25 pp. 2–3, 12; SF-FAQ (frame inner edge); `ships.ts` |
| I2 | Villages only on numbered hexes | A settlement may only stand on an intersection that touches at least one hex with a number disc (spec §6.4), in setup and after. A corner touching a numbered and an unnumbered hex is allowed (none exists: the large island and the small islands never touch). Starting settlements additionally must touch the large island. | SF25 p. 12; spec §6.4 |
| I3 | Robber | Starts on **any desert**: the layout builder draws one of the three with the game's recorded rng and stores it in the layout (`layout.robber`), so it is reproducible from the snapshot. From then on the robber (7 or knight) may only move to a hex with a disc (so never to a small island, and never back to a desert). The pirate starts on the sea hex (1, -3) and is unrestricted. | SF25 p. 12; spec §5.4 |
| I4 | Ports at setup | The six ports are shuffled over the six port positions with the game's rng in `initGame` (face up, public). They are not in `layout.harbors` until a player places one; an unplaced gift position is not a harbor for the spacing rule. | SF25 p. 12 |
| I5 | Harbor placement | A taken port goes to an edge that (a) lies between a land hex and a sea hex or the frame, (b) has an own settlement or city at one end, (c) is not a harbor edge, and (d) shares **no vertex** with an existing harbor ("there must always be one edge between ports" = two harbor edges are never adjacent). The player chooses the edge (and the kind when several are held) in a `seafarers.harbor` pending frame, command `harbor.place { edge, harbor }`; placing is mandatory while a legal edge exists (the turn cannot end), and the placed port works at once (`layout.harbors`, so `harborRates` sees it). Since no settlement can stand on a small island (I2), harbors can only end up on the large island's coast. | SF25 p. 12; spec §6.4 |
| I6 | Held ports | With no legal edge the port stays in front of the player (`held`, public: it is face up). After **every board change** all players' held ports are re-checked and a frame opens as soon as a legal edge exists; a queued frame whose edges vanished is dropped on activation and the port stays held. Placing one port re-checks for the next. | SF25 p. 12; spec §6.4 |
| I7 | VP tokens | 8 tokens, 1 VP each, public (`bonusPoints` plus `tribe.vp`); there is no island bonus in this profile. | SF25 p. 12; spec §5.3 |
| I8 | Development card gifts | The four cards are the top four of the shuffled deck taken in `initGame` (so the deck starts at 21), identity only in module state. A card taken by a ship goes to `newDevCards` ("as if bought this turn": playable from the next turn on, `E_CARD_JUST_BOUGHT` before), and a victory point card counts at once in the victory check that follows the ship command ("immediately reveal to win"). The event carries the card only as a private parameter for the taker. | SF25 p. 12 |
| I9 | Build or move | The gift is taken by `build.ship` (also the free ships of Road Building) and `ship.move`; `setup.placeShip` cannot reach a gift (setup is on the large island, gifts are on small islands), so it is not wired. A ship moved off an edge takes nothing from it. | SF25 p. 12 |
| I10 | Gold | The two gold hexes carry no disc, so they never produce; the generic gold help line is dropped from this scenario's help. | SF25 p. 12 |
| I11 | Victory | 13 VP on the own turn at any moment; no island bonus; 15 ships. | SF25 p. 12; spec §5.3 |
| I12 | Variable setup | The three blue-outlined hexes (no 5/6/8/9) and the random large island belong to S10; the fixed map is offered. | SF25 p. 13 |

| I13 | Two free ships from Road Building | Each free ship that lands on a port gift takes it at once; the harbor frames are queued behind the Road Building frame, so both ports are placed after the second ship is built, and the player chooses which held port to place first. Both ports come from the same card, so the order is the player's. | SF25 p. 12; `build.ship` and `harbor.place` |
| I14 | Scenario isolation (D7) | Only `forgotten-tribe` carries the gift state. Elsewhere (New Shores `sf-2025.2`, Four Islands, Through the Desert, Fog Islands) `actionHints().modules.seafarers` has no `harborChoices`, `targets` or `board` keys, and `harbor.place` answers like any unknown command (`E_INVALID_COMMAND`, or `E_PENDING_EFFECT` while a frame is pending), the same treatment as `fog.choose`. A regression test pins the key set and both codes. | spec D7; `seafarers-exports.test.ts` |

## What was built

| Area | Files | Notes |
|---|---|---|
| Map | `packages/rules/src/seafarers-scenario-boards.ts` (extended), `layout-registry.ts` (`sf-forgotten-tribe`), `seafarers-boards.ts` (`fixedLayout` accepts no ports) | shifted coordinates, 49-cell frame, 18 gift positions, robber desert drawn from the rng |
| Rules | `packages/rules/src/modules/seafarers/tribe.ts` (new), `state.ts`, `index.ts`, `ships.ts`, `islands.ts`, `messages.ts` | gifts in module state, `takeGift` after build and move, `seafarers.harbor` frame, `harbor.place`, held ports re-checked in `afterBoardChange`, robber and settlement disc rule, projection and hints (`harborChoices`, `targets`, `board`) |
| Profile | `packages/rules/src/profiles.ts` | `topologyId: sf-forgotten-tribe`, no `islandBonus`, `implemented` and `enabled` |
| Web | `SvgBoard.tsx`, `SvgSeafarers.tsx` (`GiftMarker`), `three/diorama-ships.ts`, `three/DioramaSeafarers.tsx`, `PlayersPanel.tsx`, `SeafarersPrompt.tsx`, `HelpPanel.tsx`, `board/seafarers.ts`, `i18n/modules/seafarers*.ts`, `audio/cues.ts` | gifts in both renderers, VP and held-port marks, harbor type picker, help, event lines |
| Evidence | `packages/rules/test/seafarers-forgotten-tribe.test.ts`, `seafarers-sim.test.ts`, `seafarers-sim.ts`, `packages/server/test/seafarers-forgotten-tribe.test.ts`, `packages/web/test/seafarers-forgotten-tribe.test.tsx`, `scripts/seafarers/capture_forgotten_tribe.py`, `tribe_fixture.mjs` | see below |

## Verification

- Rules (`seafarers-forgotten-tribe.test.ts`, 34 tests): topology (49 hexes,
  172 / 124 / 50 / 6, Euler, rows 6-7-8-7-8-7-6, symmetric rows, protrusions
  absent); the 18 gifts are distinct frame inner edges of land hexes (8 / 4 /
  6) and the port slots equal `harborSlots`; layout checksums; large island
  18 discs, small islands none; every transcribed cell; 3 and 4 players share
  the map; robber on each of the three deserts across seeds, pirate on the sea
  hex; profile and player counts; the initial gifts (deck 21, 25 conserved,
  ports a permutation of the six tokens, reproducible per seed, projection
  without card identity); **18 positions × (build, move)**: VP +1, card in
  `newDevCards`, port in a frame; no gift on plain edges; roads take nothing;
  Road Building ships take gifts; VP tokens (supply 8, public, 13 VP wins at
  exactly the 13th point); development cards (not playable this turn, playable
  after a full round, victory point card wins at once, move); privacy
  (untaken identities in no projection or event; after taking, only the taker
  sees the card); harbor placement (frame, hints, rejected edges and types,
  turn cannot end, placed port works at once, one-edge spacing, held port,
  re-check after an inland and then a coastal settlement, two held ports);
  settlements and the robber only on numbered hexes (setup, mid-game, knight,
  7); simulated 3- and 4-player games to a winner with gift and harbor
  conservation. `seafarers-sim.test.ts`: 3 and 4 players to a 13-point winner
  with a conserved supply, at most 15 ships, gifts and placed harbors across
  seeds. `profiles.test.ts`, `seafarers-exports.test.ts` updated.
- Service: room by ruleset parts for 3 and 4 players, 5 and 6 refused, bot
  seat refused (`profile`), 3- and 4-player starts (topology, 13 VP, no
  harbors, pirate on sea, robber on a desert, deck 21, 18 gifts, no `card`
  field and no card identity in any viewer's snapshot), setup spots on the
  large island, a ship taking a port gift that opens the harbor frame, a
  **restart with that frame pending** (state identical, hints identical), the
  harbor placed through the API, and a 13-point finish by a VP token
  (room `completed`).
- Web (`seafarers-forgotten-tribe.test.tsx`, 12 tests): SVG board (49 hexes,
  18 gifts by kind, ports with their kind, no card identity, no printed
  harbors), a taken gift disappears and a placed harbor is drawn, accessible
  names; 3D gift transforms (18 distinct points beyond each edge midpoint);
  player panel (VP tokens, held ports as visible text, zh-Hant and en);
  harbor board intents (one held kind arms the board at once, several kinds
  ask first, then arm; the edge targets project through the geometry the 3D
  overlay shares; other players see nothing); help (five tribe lines, no gold
  or island bonus) and event lines in both locales.
- Browser: `scripts/seafarers/capture_forgotten_tribe.py` (Chromium, software
  WebGL, `SF_TIMEOUT=180000` on the shared machine, **every command receipt
  asserted `accepted`**): lobby (3–4 players only), the 3- and 4-player map in
  SVG (18 `[data-gift-kind]` nodes) and 3D (canvas `data-gift-markers` = 18),
  phone for 4, setup over the API (`tribe_fixture.mjs check`: every starting
  settlement touches the large island), the help panel, then a live finish for
  player 1 through the UI: a test-only fixture (service stopped) gives the
  turn, ship cards, 6 other bonus points, three coastal settlements on the
  large island, a knight as the card gift and floating ships beside seven
  gifts. **3D**: build a ship onto a port gift (canvas gift count 18 → 17,
  frame pending, `harborChoices` include the settlement's coast edges), click
  an edge on the 3D board and confirm, then **move** a ship onto a VP token
  (count 16, tribe `vp` = 1); **phone (390 px, SVG)**: build onto a second port
  gift and place it through the target list (the seat panel covers part of the
  board); **SVG**: build onto and place a third port, take the development card
  gift (card in `newDevCards`) and build onto the second VP token (13 VP,
  result screen). Gift edges sit close together, so the script chooses in the
  ambiguity list when it opens. In 3D the gifts stand on a post above the sand
  and face-up ports carry the same ratio and resource plaque as placed
  harbors. Report with sha256 per image:
  `docs/screenshots/seafarers-forgotten-tribe/report.json`; the curated
  captures are `committed: true`.

## Limitations

- No human playtest, physical device or screen-reader check.
- Variable setup (SF25 p. 13) is not offered (S10).
- No bots: the profile is outside the bot support list and refuses bot seats.
- A held port is placed on the player's own choice of a legal edge; SF25 does
  not say whether a player may decline while a legal edge exists, so placing is
  mandatory (I5).
