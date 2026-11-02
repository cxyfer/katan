# Expansion platform (P0)

Advisory work record for phase P0 of
[the expansions roadmap](../plans/2026-11-01-expansions-roadmap.md). Branch
`feat/expansion-platform`, first built on `master` @ `7decd81` and rebased
onto `master` @ `0815c76` (see the last section). No new game rule; base games
behave exactly as on master.

## What was built

| Area | Files | Extension point for later phases |
|---|---|---|
| Registry v2 | `packages/rules/src/profiles.ts` | `ExpansionId`, `ScenarioId` (`SCENARIO_IDS`), `VariantId`, `SourceId`, `BoxId`; per profile `expansions`, `scenario`, `variants`, `ruleModules`, `ruleVersion`, `sources`, `requiredBoxes`, `layoutId`. `resolveCombination({ expansions, scenario, variants, playerCount, setupMode })` (exact set match), `combinationOf`, `registerFixtureProfile` (tests only) |
| Rule versions | `profiles.ts`, `engine.ts`, `server/src/game.ts` | snapshot `engineVersion` = profile `ruleVersion`; base = `BASE_RULE_VERSION` = master's `base-2025.3` (`ENGINE_VERSION` alias kept) |
| Pending queue | `packages/rules/src/pending.ts`, `types.ts` | `PendingFrame`, `ModulePending`, `enqueuePending`, `advancePending`, `clearPending`, `pendingResponders`, `normalizePending`; `GameState.pendingQueue?`; `GameView.pendingQueue` |
| Layout registry | `packages/rules/src/layout-registry.ts` | `registerLayoutBuilder(id, ({ profile, topology, mode, playerCount, rng }) => BoardLayout)`; `createGame` calls `buildProfileLayout` |
| Generic topology | `topology.ts`, `topology-registry.ts`, `sample-boards.ts` | `TopologyDefinition { id, hexes, harborSlots: { q, r, side }[] }`, `buildTopologyFromHexes`, `registerTopologyDefinition`; sample `sample-archipelago` + `archipelagoLayout` |
| Rules modules | `packages/rules/src/modules/` (README) | `RulesModule` hooks: `initGame`, `setupBuilding`, `rollDice`, `beforeProduction` (`'defer'`), `discardLimit`, `modifyProduction`, `afterProduction`, `commands`/`pendingCommands`, `afterBoardChange`, `resumePending`, `score`, `project`, `projectPending`, `actionHints`; `ModuleContext.kit` engine services; `moduleStateOf`/`setModuleState`; placeholder dirs `seafarers/`, `citiesKnights/`, `tradersBarbarians/`, `explorersPirates/` |
| Message ids | `packages/rules/src/messages.ts`, `modules/<id>/messages.ts` | `BASE_*` lists checked against `engine.ts`; each module list checked against its own directory; merged `COMMAND_ERROR_CODES` / `RULE_EVENT_TYPES` |
| Protocol | `packages/protocol/src/index.ts` | `ProfileView` v2, `profileView()`, `RULESET_MESSAGE_IDS` (profile/expansion/scenario/variant/box names) in `REQUIRED_MESSAGE_IDS` |
| Server | `packages/server/src/rooms.ts`, `http.ts` | `resolveRoomProfile`; `POST /api/rooms` and settings accept `profileId` or `ruleset` |
| Lobby | `packages/web/src/state/rulesets.ts`, `HomeScreen.tsx` | expansion set → scenario → player count cascade from `GET /api/profiles`; resolved profile and required boxes shown |
| i18n | `packages/web/src/i18n/modules/<id>.ts` | per-module catalogs merged over the base catalogs; parity and no-redefinition tests |
| Rendering | `board/geometry.ts`, `coastline.ts`, `harbor.ts`, `three/bounds.ts`, `three/model-specs.ts`, `three/DioramaTerrain.tsx`, `components/SvgBoard.tsx`, `BoardView.tsx` | `BoardGeometry.land` from terrain; `isCoastEdge`, `landHexOfEdge`; `coastLoops(topology, land)`; sea hexes are open water (SVG water cells, no 3D tile) |
| Preview | `main.tsx`, `IslandPreview.tsx`, `island-preview.ts` | `?preview=archipelago` (and a topology option in `?preview=island`) |

## Compatibility evidence

- `packages/rules/test/base-regression.test.ts` pins FNV-1a digests recorded
  from master's own engine (first `7decd81`, re-recorded at `0815c76`) for: hex-r2/hex-r56 topology (hexes, vertices, edges, coastal
  edges, harbour slots); fixed and five variable layouts per base topology;
  `createGame` snapshots for 3/4 base and 5/6 paired players, fixed and
  variable; five whole simulated games (4p seeds 11/29/47, 3p variable, 6p
  paired variable). All still match, so base snapshots, indices and
  transitions are byte-identical.
- Old snapshots: a state without `pendingQueue` projects `pendingQueue: []`
  and accepts commands; a queue without an active head is promoted
  (`platform.test.ts`).
- Browser: base 19/30-hex boards in SVG and 3D, desktop and phone, are
  byte-identical before (`ce57dce`, board code identical to `7decd81`) and
  after the renderer change; two runs of one build are byte-identical. See
  [the captures](../../screenshots/expansion-platform/README.md) and their
  `report.json`.

## Verification

`pnpm verify` on the final tree (exit 0):

- typecheck: all four packages
- rules 18 files / 169 tests; protocol 1 / 8; server 10 / 101 passed, 11
  skipped (PostgreSQL contract replay, no `TEST_POSTGRES_URL`); web 55 / 553
- build: web + server bundles
- smoke: 13/13 checks
- test:dev: 1/1

After the rebase onto `0815c76` (exit 0): rules 19 / 189; protocol 1 / 8;
bots 7 / 45; server 11 / 145 passed, 15 skipped (PostgreSQL, no
`TEST_POSTGRES_URL`); web 56 / 581; build; smoke 13/13; test:dev 1/1.

Browser captures:

```sh
pnpm build
python3 scripts/expansion-platform/capture.py --cases base --out test-results/expansion-platform-before
# after the change
python3 scripts/expansion-platform/capture.py --out test-results/expansion-platform-after \
  --compare test-results/expansion-platform-before
```

18/18 cases passed (Chromium 145, software WebGL).

## Limitations and open items

- No real expansion module exists; hooks are exercised by a test fixture
  module only. Hook shapes may need small adjustments when P1/P2 land.
- The base engine does not know about sea: on a topology with sea hexes,
  `canPlaceBuilding`/`canPlaceRoad` would still allow sea vertices/edges.
  That is Seafarers rule work (P1), not a platform change.
- Sea-hex interaction targets (robber/pirate on water, ships) are not
  rendered or tested; the 3D target plane sits at tile height, above the
  ocean surface.
- Coastline loops assume islands do not enclose lakes or touch only at a
  corner; neither occurs in the sample board.
- `?preview=archipelago` is 3D only; the SVG archipelago is covered by the
  in-game capture and jsdom tests.
- PostgreSQL contract tests were not run (no `TEST_POSTGRES_URL`).
- Profile `sources` cite only pages SPEC already cites; each phase records
  edition, hash and pages when it enables a profile.

## Rebased onto master @ 0815c76 (2026-11-02)

Master gained bot seats (#58, #59, #64), the base rule fixes of #60
(`base-2025.3`) and random game order (#66).

- **Rule version.** `BASE_RULE_VERSION` = `base-2025.3`; `ENGINE_VERSION`
  stays an alias. #60's version comment and the maintainer approval it records
  are kept verbatim.
- **#60 in the new structure.** Road connectivity (`roadCanExtendFrom`) and
  the Year of Plenty / Road Building caps merge unchanged. Master's
  `normalizedPending` (caps a stalled `freeRoads` / `yearOfPlenty` frame from
  an old snapshot) runs in `applyCommand` after `normalizePending`; when it
  ends the active frame, the next queued frame activates through
  `completePending`. `effectivePending` gives projection and hints the same
  view (active frame plus queue). `freeRoads.granted` is kept and frames are
  created through `enqueuePending`.
- **Re-pinned digests.** The 7decd81 pins no longer describe master (#60
  changed `engineVersion` and play). Method: a temporary detached worktree at
  `origin/master` (`0815c76`) received only `base-regression.test.ts` and the
  `simulate.ts` options it needs; `RECORD_BASE_PINS=1 pnpm --filter
  @catan/rules exec vitest run test/base-regression.test.ts` printed each
  section; the worktree was removed. Topology and layout digests were
  unchanged; the eight snapshot and five game digests were replaced. The
  rebased branch reproduces all of them.
- **Bots versus expansion profiles.** Bot strategies issue only base commands.
  `@catan/bots` exports `BOT_RULE_MODULES` (empty) and `botsCanPlay(profile)`
  (every `ruleModules` entry listed). The server's `botsSupported` uses it to
  refuse bot seats at creation, on add and on a settings change
  (`E_INVALID_BOT`, reason `profile`), and `startBlockers` adds
  `blocker.botsUnsupported` if a bot seat is in such a room anyway.
  `ProfileView.botSeats` lets the lobby hide the bot fields with a localized
  reason (`lobby.bots.unsupported`). Tests: `bots/test/support.test.ts`,
  `server/test/bots.test.ts`, `web/test/bots.test.tsx`.
- **Other conflicts.** `rooms.ts` / `http.ts` combine `resolveRoomProfile`
  with `orderMode` and bot fields; the bot strategies' pending switches return
  `null` for module frames; the home screen keeps both the bot fields and the
  resolved-profile line; docs merge both sides.
