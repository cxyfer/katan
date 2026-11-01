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

Placeholders exist for `seafarers`, `citiesKnights`, `tradersBarbarians` and
`explorersPirates`, so a phase normally edits only its own directory plus its
profile rows, layout builder and i18n catalog file.

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
| scoring | `score` | inside `scoreOf`, added to the base score |
| projection | `project` / `projectPending` / `actionHints` | `GameView.modules[id]`, module frames, `ActionHints.modules[id]` |

Hooks get a `ModuleContext` (`profile`, `rng`, `kit`). `kit` exposes the engine
services a module needs (`emit`, `fail`, `accept`, `payBuild`,
`afterBoardChange`, `checkVictory`, `enqueuePending`, `completePending`,
`resolveRollOutcome`, `finishSetupStep`, …) so module files never import
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
