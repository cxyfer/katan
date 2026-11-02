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

Placeholders exist for `seafarers`, `citiesKnights` and `explorersPirates`,
so a phase normally edits only its own directory plus its profile rows,
layout builder and i18n catalog file.

`tradersBarbarians` is a composite: the box is a set of independent variants
and scenarios, each a *part* with the module hook shape
(`tradersBarbarians/part.ts`). `tradersBarbarians/index.ts` maps a profile's
scenario and variants to parts and runs their hooks in that order; frames are
`tradersBarbarians.<step>` and each part names the frames it owns. Parts keep
their state under one key of the module slot (`state.ts`).

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
| board | `afterBoardChange` | after every board change, after awards are recomputed |
| pending | `resumePending` | when a continuation frame (`responders: []`) of the module becomes active |
| roll | `sevenRobberStep` | after a 7's discards: a frame replacing `moveRobber`, `null` for none |
| robber | `robberTargets` / `stealCandidates` | narrow the robber's hexes and victims (7 and Knight) |
| production | `hexProduces` / `productionAmount` | block a hex, change one building's entitlement before the bank limit |
| building | `roadAllowed` / `buildingAllowed` | extra placement conditions (setup and action phase, city upgrades) |
| building | `afterBuild` | after a settlement, city or road is placed (setup included), with `ctx.rng` |
| turn | `onEndTurn` | on `turn.end`; `'defer'` opens an end-of-turn phase that calls `kit.finishTurn` |
| trade | `harborAccess` / `tradeGoods` | harbour use per building; non-resource goods in domestic offers |
| awards | `awardRules` | adjust award minimums and route weights before awards are recomputed |
| scoring | `score` | inside `scoreOf`, added to the base score |
| scoring | `victoryTarget` | a player's own target (`victoryTargetOf`, `PublicPlayerView.victoryTarget`) |
| projection | `project` / `projectPending` / `actionHints` | `GameView.modules[id]`, module frames, `ActionHints.modules[id]` |

Hooks get a `ModuleContext` (`profile`, `rng`, `kit`). `kit` exposes the engine
services a module needs (`emit`, `fail`, `accept`, `payBuild`,
`afterBoardChange`, `checkVictory`, `enqueuePending`, `completePending`,
`resolveRollOutcome`, `finishSetupStep`, `finishTurn`, …) so module files never import
`engine.ts`. Module files must not call engine or analysis helpers at module
top level (imports are cyclic through `registry.ts`).

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

## Board data for modules

- `BoardLayout.extraNumbers` gives a hex a second production number (a river
  hex holding both 2 and 12); the board view repeats it.
- `RoadRef.bridge` marks a bridge: it is a road for connectivity and routes,
  but `countRoads` (the road supply) skips it.
- `TopologyDefinition.interiorPaths` adds a plaza vertex at a hex centre with
  path edges to chosen corners; both carry `interior: true`, come after the
  regular indices and are never coast.
- `BoardLayout.robber = -1` starts the robber beside the board.
