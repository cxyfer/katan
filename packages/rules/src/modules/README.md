# Rules modules

Each expansion or variant lives in its own directory here and plugs into the
base engine through the hooks in `types.ts`. The base engine (`../engine.ts`)
owns the turn structure and calls the hooks of the profile's
`ruleModules`, in that order. Base profiles list no modules, so base games
never run a hook and their snapshots/views carry no module fields.

```
modules/
  types.ts            hook interface (RulesModule, ModuleContext, RulesKit)
  registry.ts         id → module; rulesModulesOf(profile)
  builtins.ts         the built-in module list (one line per module)
  messages.ts         merges every module's message lists
  state.ts            moduleStateOf / setModuleState (GameState.moduleState)
  <id>/index.ts       the module object
  <id>/messages.ts    the module's event types and error codes
```

`seafarers` (Heading for New Shores), `citiesKnights` and the
`seafarersCitiesKnights` combination layer are implemented; placeholders exist for `tradersBarbarians` and
`explorersPirates`, so a phase
normally edits only its own directory plus its profile rows, layout builder
and i18n catalog file.

## Hooks

| Area | Hook | Called |
|---|---|---|
| setup | `initGame` | once, after the base state is built and `game.created` is emitted |
| setup | `setupBuilding` | per setup building placement; `'city'` replaces the settlement |
| roll | `rollDice` | instead of the two base dice (first module that returns a roll wins) |
| roll | `beforeProduction` | after `turn.rolled`; return `'defer'` after enqueueing frames that must resolve first |
| roll | `discardLimit` | per player on a 7 (base limit 7) |
| roll | `modifyProduction` | on the production results before they are paid |
| roll | `afterProduction` | after production or the 7 has been set up |
| commands | `commands` / `pendingCommands` | module-owned command types; types accepted while a frame is pending |
| commands | `disabledCommands` | base command types the ruleset lacks (C&K: development cards); rejected |
| commands | `beforeEndTurn` | veto on `turn.end` (C&K: progress hand limit by the end of the action phase) |
| board | `allowBuilding` | extra veto on a building intersection (setup and play), e.g. New Shores' main-island start |
| board | `allowCity` | extra veto on upgrading a settlement (C&K: a toppled city must be rebuilt first) |
| board | `vertexBlocker` | owner of a module piece holding an intersection (C&K knights): opponents' roads cannot pass and their Longest Route splits there |
| board | `afterBoardChange` | after every board change, after awards are recomputed; gets the kit (emit, …) but no randomness |
| robber | `moveBandit` | on a robber target (7 or Knight) before the base robber; claims sea hexes / `null` (frame) for the pirate and returns theft candidates, or `undefined` to leave it to the robber |
| robber | `robberInactive` | true while the robber is out of play (C&K before the first attack); a 7 still discards |
| trade | `bankRate` | adjusts the supply rate for a given card (C&K: commodities, trade level 3 at 2:1) |
| board | `legalShips` | ship edges the player could place now, supply included (Seafarers); lets another module re-place a ship (C&K Diplomacy); `kit.legalShips` collects them |
| board | `shipMoveBlocked` | extra veto on moving an own ship (combination: knights close and pin shipping routes) |
| board | `allowMerchant` | extra veto on a merchant hex (combination: never on gold) |
| cards | `freeRouteTargets` | extra free Road Building placements (ships), supply included; summed with the legal roads capped by the road pieces left |
| pending | `resumePending` | when a continuation frame (`responders: []`) of the module becomes active |
| pending | `activatePending` | when a queued frame of the module that still has responders becomes active; may resolve it (Seafarers: an empty supply skips gold) |
| scoring | `score` | inside `scoreOf`, added to the base score |
| projection | `project` / `projectPending` / `actionHints` | `GameView.modules[id]`, module frames, `ActionHints.modules[id]` |

Hooks get a `ModuleContext` (`profile`, `rng`, `kit`). `kit` exposes the engine
services a module needs (`emit`, `fail`, `accept`, `payBuild`,
`afterBoardChange`, `checkVictory`, `enqueuePending`, `completePending`,
`resolveRollOutcome`, `finishSetupStep`, `legalRoads`, `placedFreeRoute`, …)
so module files never import `engine.ts`.

The base engine itself is sea-aware (P1): buildings need a land intersection,
roads a land edge (`isLandVertex` / `isLandEdge` in `analysis.ts`), only roads
extend roads, the robber stays on land, and with
`longestRouteIncludesShips` a road and a ship continue each other only at the
owner's building. Ships are module pieces (`RoadRef.ship`); `isSeaEdge`
treats the topology's boundary edges as the frame's inner edge. Module files must not call engine or analysis helpers at module
top level (imports are cyclic through `registry.ts`).

## Hook order and combinations

A profile with several expansions lists several modules; the engine calls
them in `ruleModules` order and combines their answers per hook:

- `commands`, `rollDice`, `moveBandit`: the first module that handles it (or
  returns a value) wins; a type in any module's `pendingCommands` is
  accepted while a frame is pending.
- `allowBuilding`, `allowCity`, `allowMerchant`: every module must allow;
  `shipMoveBlocked`, `beforeEndTurn`: any module may veto.
- `score`, `freeRouteTargets`: summed; `legalShips`: concatenated.
- `initGame`, `afterProduction`, `afterBoardChange`: every module runs, in
  order; `beforeProduction` runs in order until one returns `'defer'`.

A rule that exists only because two expansions meet goes into a small
combination module rather than into either expansion, so neither expansion
tests for the other. The combined Heading for New Shores profiles run
`['seafarersCitiesKnights', 'seafarers', 'citiesKnights']`:

- `seafarersCitiesKnights` comes first, so its `moveBandit` vetoes (no
  pirate before the first attack, a robber chase moves the robber only, a
  pirate chase the pirate only) precede the Seafarers pirate, and its
  `afterProduction` lets the Seafarers gold frame queue before the C&K
  science bonus (gold is production). It also owns `knight.chasePirate`,
  `shipMoveBlocked` (knights close and pin ships) and `allowMerchant` (no
  merchant on gold).
- `seafarers` before `citiesKnights`, so gold is queued before the
  aqueduct and the pirate's `moveBandit` before the robber's.

Everything else composes through the shared hooks: C&K knights block ships
through `vertexBlocker`, Road Building and Diplomacy reach ships through
`freeRouteTargets` / `legalShips`, and scores add up. The order is pinned by
`packages/rules/test/profiles.test.ts` and the R-COMB fixtures
(`sfck-clauses.test.ts`).

## Pending frames

`state.pending` is the active frame and `state.pendingQueue` the frames behind
it (omitted when empty). A module frame is
`{ kind: '<module>.<step>', module, responders, data }`:

- `responders` are the players who still have to answer, in order. The module
  removes a responder when they answer and calls `kit.completePending` when
  none is left, which activates the next frame.
- A frame with no responders is a continuation: the engine calls the module's
  `resumePending` as soon as it becomes active (for example "resolve
  production now" after a C&K barbarian attack). `resumePending` must not
  call `completePending` for that frame itself.
- `data` is server-only. Clients see `{ kind, module, responders, data: {} }`
  unless `projectPending` returns viewer-filtered data.

## Message ids and state

Every `emit(state, '<type>', …)` and own `fail('E_…')` in a module's directory
must be listed in its `messages.ts`, and nothing else; `message-ids.test.ts`
enforces this, and the protocol and web catalog tests then require both
locales to translate them. Module state goes in
`setModuleState(state, '<id>', …)`; it is persisted in the snapshot and is
never projected except through `project`. Randomness only comes from
`ctx.rng`, and every outcome is stored in the state.
