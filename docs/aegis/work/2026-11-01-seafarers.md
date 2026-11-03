# Seafarers — Heading for New Shores (P1)

Advisory work record for phase P1 of
[the expansions roadmap](../plans/2026-11-01-expansions-roadmap.md). Branch
`feat/seafarers`, stacked on `feat/expansion-platform` @ `161eb1a` (PR #57).

## Sources (accessed 2026-11-01)

| Id | Edition | Publication | File | SHA-256 | Pages used |
|---|---|---|---|---|---|
| SF25 | CATAN – Seafarers, 2025 (`v6.250401`) | CN3083 | `CN3083 CATAN–Seafarers Rulebook 2025 secured reduced.pdf` (20 pp.) | `a499abe2b613afd618dd3c806790400c7e84adebcc9b9ab19a24fb80dd04b099` | 1 (components), 2–3 (rules, setup), 4–5 (Heading for New Shores 3/4 maps, tables, variable setup) |
| SF56-25 | CATAN – Seafarers 5–6, 2025 (`v6.250401`) | CN3084 | `CN3084 CATAN – Seafarers_ 5-6 Player_ Rulebook.pdf` (12 pp.) | `746ac86ef5262c666ac204ede77bbd2886960590a9e82c2bcdbe2533e78bb0fe` | 1 (components: extra 2:1 wool port), 2–3 (paired turn, turn summary), 4 (Heading for New Shores 5–6) |
| B25 | CATAN – The Game, 2025 | CN3081 | `CN3081 CATAN–The Game Rulebook secure (1).pdf` | `0d81a40c1d4eb5eb438a62f80d71cdaab5f00404722c3cfa0b106d79b635ebc6` | 6 (resolve a 7: "move the robber to a new hex"), 11 (variable setup) |
| B56-25 | CATAN – 5–6, 2025 | CN3082 | `CN3082 CATAN – 5-6 Rulebook 2025 reduced.pdf` | `7b7285e178689585ca39c2c72f78ce20a78c02608c40dd3be2cd9f97c8d95ea1` | 3 (paired turns), 4 (variable setup) |
| SF-FAQ | catan.com/faq/seafarers (HTML) | — | `faq-seafarers.html` | `91d8ad897e2d94b0191f42320d368fe0a0817e13fbc9375b88ba956dcfc60d75` | entries 1–18; image `CATAN_ship_circle_closed.jpg` (`7de2dd7e…5be3`) |

Downloads went to a fresh directory outside the repository; pages were
rendered with PyMuPDF 1.24.14 (wheel verified by its PyPI blake2b path) and
read as images. No code from the downloads was executed.

## Rule clauses used (paraphrased)

| Clause | Source | Implementation |
|---|---|---|
| Ships cost 1 lumber + 1 wool | SF25 p. 2 (building cost) | `seafarers` module `build.ship` |
| Ships go on empty edges of sea hexes; a ship and a road never share a coastal edge | SF25 p. 2 | sea-aware placement |
| The inner edge of the frame is buildable for ships, the outer edge never | SF-FAQ 15 | boundary edges of the topology count as sea edges |
| A new ship connects to an own ship or building, not to a road; not past an opponent's building | SF25 p. 2 | ship connectivity |
| No new ship on an edge of the pirate's hex (also during setup) | SF25 p. 2, SF-FAQ 5–6 | pirate restriction |
| Move one ship per action phase: not one built this turn, only with an open end (end not next to an own ship or building), not part of a ship line linking two own buildings even if an opponent's building interrupts it, not to/from an edge of the pirate's hex; the new position obeys normal ship placement | SF25 p. 2, SF-FAQ 13–14 | `ship.move` |
| Gold: a settlement takes 1 resource of choice, a city 2 in any combination | SF25 p. 2, SF-FAQ 2 | gold pending frames |
| On a 7 (and with a Knight) choose robber or pirate; the pirate moves to the frame or to a new sea hex and steals from a player with a ship on that hex | SF25 pp. 2–3 | robber-or-pirate choice |
| Coastal settlements are not robbed by the pirate | SF-FAQ 7 | theft only from adjacent ships |
| Longest Route: 5+ continuous roads and/or ships; roads and ships join only at an own building | SF25 p. 2, SF-FAQ 16 | trade-route length |
| Moving a ship does not lose the award if the route is not shorter afterwards | SF-FAQ 12 | awards recomputed only after the move |
| Road Building: 2 roads, 2 ships or 1 + 1, one after another | SF25 p. 3, SF-FAQ 1 | free road/ship frame |
| Starting pieces as in the CATAN variable setup; a coastal starting settlement may take an adjacent ship instead of its road | SF25 p. 3 | setup ship |
| New Shores: start on the main island; +2 VP for a player's first settlement on each small island regardless of other players; 14 VP to win | SF25 p. 4 | island bonus, target 14 |
| Robber starts on the 12 (3 players) / the desert (4 players); pirate "as shown" | SF25 pp. 4–5 | layouts |
| 5–6: small islands as shown, main island by the CATAN 5–6 variable setup with random ports on the marked positions; pirate as shown; starting settlements as in Seafarers | SF56-25 p. 4 | `sf-new-shores-56` layout |
| 5–6: Player 2 builds, trades with the supply, moves 1 ship and plays 1 development card, no domestic trade | SF56-25 pp. 2–3 | paired actor ship move |
| Distance rule also across a narrow strait | SF-FAQ 11 | vertices joined by any edge are neighbours |

## Map transcription

The three printed maps were rendered at 130–600 dpi, a pointy-top axial
lattice was fitted to the number discs and overlaid on the image, and every
tile, disc, port token (flat side = port edge) and outline was read per cell.
The result is `packages/rules/src/seafarers-boards.ts`.

Frame: the outline of each board is a full hexagonal block (37 cells for 3
players, 44 for 4, 58 for 5–6), but the corner frame pieces at both ends of
the middle row carry a hex-shaped bump. Those two cells are frame, which
reconciles the outlines with the component tables (35 = 13 sea + 22 land,
42 = 14 + 28, 56 = 16 + 40). The pirate is printed on the right-hand bump,
so it starts on the frame. Ports may lie on the frame (several tokens do).

| Map | Cells | Land (terrain) | Discs | Ports | Robber | Pirate |
|---|---|---|---|---|---|---|
| 3 players (SF25 p. 4) | 35: rows 4-5-6-5-6-5-4 | 22: gold 2, hills 4, forest 3, pasture 5, fields 4, mountains 4, no desert | 2,3×2,4×3,5×3,6×2,8×3,9×2,10×3,11×2,12 | 5×2:1 (one per resource) + 3×3:1 | on the 12 hills | frame |
| 4 players (SF25 p. 5) | 42: rows 5-6-7-6-7-6-5 | 28: gold 2, hills 5, forest 5, pasture 5, fields 5, mountains 5, desert 1 | 2×2,3×3,…,11×3,12 | 5×2:1 + 4×3:1 | desert | frame |
| 5–6 players (SF56-25 p. 4) | 56: rows 7-8-9-8-9-8-7 | 10 fixed small-island hexes (gold 3, hills 2, mountains 2, forest, pasture, fields) + 30 random main-island hexes (B56 inventory) | small islands one of each 2–12; main island the 28 B56 discs | 11 marked positions, random tokens: 6×2:1 (extra wool) + 5×3:1 | first desert | frame |

Small islands follow the dark-blue outlines. In the 5–6 map the `6`+`12`
and `3`+`10` outlines each enclose two land hexes and the sea hex between
them, so each pair is one small island for the bonus.

## Open items found while reading

- **"Open" ship, FAQ special cases.** SF25 p. 2 defines an open end as one
  not next to an own ship or building. SF-FAQ 18 adds that a ship loop
  returning to the same building has movable end ships and that a ship circle
  without any building is entirely movable; under the SF25 wording none of
  those ships has an open end. The engine follows SF25; the conflict is an
  explicit open fixture (see FIDELITY).
- **Robber on sea.** B25 says "move the robber to a new hex"; Seafarers moves
  the pirate on sea hexes. The robber is limited to land hexes (any terrain,
  including desert and gold).
- **5–6 main-island discs.** B56-25 deals discs in their printed A–Z order
  along a spiral; the engine's base 5–6 variable board shuffles them (FIDELITY
  gap 3), and the New Shores main island uses that same procedure.

## What was built

| Area | Files | Notes for later phases |
|---|---|---|
| Maps | `packages/rules/src/seafarers-boards.ts`, registered in `topology-registry.ts` / `layout-registry.ts` | topologies `sf-new-shores-3`, `-4`, `-56`; builder `sf-new-shores`; `MAIN_ISLAND = 1` |
| Sea-aware engine | `engine.ts`, `analysis.ts` (`isLandHex`, `isLandVertex`, `isLandEdge`, `isSeaEdge`) | buildings need land, roads need a land edge and extend only roads, robber on land, trade route joins road/ship only at an own building; base digests unchanged |
| Hooks | `modules/types.ts`, `modules/README.md` | `allowBuilding`, `moveBandit` (+ `BanditMove`), `freeRouteTargets`; `afterBoardChange(state, ModuleContext)`; kit `legalRoads`, `placedFreeRoute` |
| Module | `modules/seafarers/` (`ships.ts`, `pirate.ts`, `gold.ts`, `islands.ts`, `state.ts`, `messages.ts`) | commands `build.ship`, `ship.move`, `setup.placeShip`, `gold.choose`; frame `seafarers.gold`; module state per action window (`built`, `moved`) and island claims |
| Profiles | `profiles.ts` | both `sf-new-shores-*` enabled; paired profile uses the B56-25 deck and `variable` setup |
| Web | `board/seafarers.ts`, `board/sea.ts`, `components/SvgSeafarers.tsx`, `components/SeafarersPrompt.tsx`, `board/three/diorama-ships.ts`, `board/three/DioramaSeafarers.tsx`, `i18n/modules/seafarers*.ts`, `audio/` | ship/pirate/island-token art (SVG + procedural 3D), sea targets at the water plane, ship build/move actions, robber-or-pirate prompt with the frame, gold picker, road-or-ship switch, scoring and help, five new cues |
| Evidence | `packages/rules/test/seafarers-*.test.ts`, `packages/server/test/seafarers.test.ts`, `packages/web/test/seafarers.test.tsx`, `scripts/seafarers/` | R-SF fixture map in `docs/FIDELITY.md` |

## Verification

- Rules: layouts (5), ships and moves (18), pirate/gold/routes/islands/paired/privacy (20), simulated 3/4/5/6-player games (5); base regression digests unchanged.
- Service: New Shores room by ruleset parts, 3-player game start, idempotent `setup.placeShip` receipt.
- Web: 7 client tests (actions, intents, gold picker, SVG pieces, sea target heights, event text in both locales).
- Browser: `scripts/seafarers/capture.py` (curated captures in `docs/screenshots/seafarers/`), and the P0 base harness comparing the base boards byte-for-byte with the P0 references (`2026-11-01-seafarers/base-compare-report.json`).
- `SMOKE_PORT=3421 pnpm verify` (exit 0): typecheck; rules 22 files / 217 tests; protocol 8; server 103 passed, 11 skipped (PostgreSQL contract replay, no `TEST_POSTGRES_URL`); web 56 files / 561 tests; build; smoke 13/13; dev runner 1/1.
- `scripts/seafarers/capture.py`: 35 cases, 0 page errors (Chromium 145, software WebGL), including Road Building as road + ship and as two ships, a Knight moving the pirate (cards written into the persisted hand as a test-only fixture) and the 5-player map.

## Limitations

- No human playtest, physical device or screen-reader check of the expansion.
- 3/4-player variable setup (SF25 p. 5) is not offered; other Seafarers scenarios are out of scope.
- Open fixture: SF-FAQ 18 ship-circle and loop cases vs SF25 p. 2 (SF25 implemented).
- Open base item: the Road Building grant is fixed at play time (FIDELITY gap 13).
- PostgreSQL repository tests were not run (no `TEST_POSTGRES_URL`).

## Rebased onto the new P0 and review fixes (2026-11-02)

P0 was rebased onto master `0815c76` (bots, #60 base rule fixes, random game
order); this branch was rebased onto it.

- **#60 in the Seafarers paths.** Road connectivity now follows #60: a road
  extends from an own building or from an empty vertex reached by an own
  *road* (ships hand over to roads only at a building, SF25 p. 2); an opponent
  building blocks both roads and ships. Road Building uses #60's cap: the
  grant is `min(2, roads capped by road pieces + ship targets)`, the effect
  ends after a placement when no road or ship target is left, and
  `normalizedPending` caps a stalled effect to the road pieces (when a road
  target exists) plus the ship targets. P1's own stall fix (road edges ignored
  once the road supply is used up) was dropped for #60's. Base behaviour is
  unchanged (the re-pinned base digests still match).
- **review-sf 1 (HIGH): separate supplies.** `countRoads` counted ships, so 8
  roads + 7 ships refused a 9th road and Road Building ended early. It now
  counts roads only.
- **review-sf 2 (HIGH): routes past an opponent building.** Fixed by #60;
  fixtures for roads and ships.
- **review-sf 3 (LOW): Road Building grant at play time.** Base behaviour;
  left unchanged and recorded as FIDELITY gap 13 for maintainer approval.
- **review-sf 4 (LOW): queued gold frame on an empty supply.** New module hook
  `activatePending` runs when a queued frame with responders becomes active;
  Seafarers skips every entitled player there when the supply is empty.
- **FIDELITY:** 48 VP tokens = 4 small islands × 6 × 2 supports the 5–6 island
  grouping; red 6/8 may be adjacent on the shuffled 5–6 main island; separate
  supplies and the queued gold case; evidence rows for the new fixtures.
- **Fixtures** (`packages/rules/test/seafarers-clauses.test.ts`, 22): the
  untested R-SF clauses from the review, each citing SF25 / SF56-25 / SF-FAQ.
- **Bots:** Seafarers profiles have rules modules, so `ProfileView.botSeats`
  is false and rooms refuse bot seats (server test added).
- **Browser:** the capture harness ran again (35 cases, no page errors); only
  the lobby changed visually and was refreshed.

`SMOKE_PORT=3421 pnpm verify` (exit 0): rules 24 files / 260 tests; protocol
8; bots 45; server 148 passed, 15 skipped (PostgreSQL, no
`TEST_POSTGRES_URL`); web 57 files / 589 tests; build; smoke 13/13; dev runner
1/1.
