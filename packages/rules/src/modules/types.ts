/**
 * Rules-module hook interface.
 *
 * The base engine (`engine.ts`) owns the turn structure and calls these hooks
 * at fixed points; an expansion or variant implements only the hooks it
 * needs, in its own directory. A profile lists its modules in
 * `ProfileDefinition.ruleModules`; hooks run in that order. Base profiles list
 * none, so no hook ever runs for a base game.
 *
 * Hooks receive a `ModuleContext` instead of importing engine internals, which
 * keeps module files free of import cycles and lets them be tested in
 * isolation. Like the engine, a module never draws randomness on its own: it
 * uses `ctx.rng` and stores every outcome in the state.
 */

import type { AwardRules, ProductionResult, ScoreOptions } from '../analysis.ts';
import type { CommandErrorCode } from '../messages.ts';
import type { ProfileDefinition } from '../profiles.ts';
import type { Rng } from '../rng.ts';
import type { BoardTopology } from '../topology.ts';
import type {
  CommandOutcome,
  GameEvent,
  GameState,
  ModulePending,
  PendingFrame,
  PlayerState,
  Resource,
} from '../types.ts';

/** A command addressed to a module; the engine only checks its `type`. */
export interface ModuleCommand {
  type: string;
  [field: string]: unknown;
}

/** Engine services a hook may use. All of them mutate the given state. */
export interface RulesKit {
  emit(
    state: GameState,
    type: string,
    params?: Record<string, unknown>,
    priv?: { to: string[]; params: Record<string, unknown> },
  ): GameEvent;
  fail(code: CommandErrorCode, params?: Record<string, unknown>): CommandOutcome;
  /** `{ ok: true }` outcome for a handler that mutated `state` in place. */
  accept(state: GameState): CommandOutcome;
  currentPlayer(state: GameState): PlayerState;
  topology(state: GameState): BoardTopology;
  canAfford(player: PlayerState, cost: Partial<Record<Resource, number>>): boolean;
  /** Pays a build cost into the bank and records it in the statistics. */
  payBuild(state: GameState, player: PlayerState, cost: Partial<Record<Resource, number>>): void;
  /** Recomputes routes and awards; call after any board change. */
  afterBoardChange(state: GameState): void;
  /** Ends the game when the current actor has reached the target. */
  checkVictory(state: GameState): void;
  enqueuePending(state: GameState, ...frames: PendingFrame[]): void;
  /**
   * Finishes the active frame and runs any continuation that becomes active.
   * Pass `ctx.rng` when a continuation may draw.
   */
  completePending(state: GameState, rng?: Rng): void;
  /**
   * Resolves the roll's base outcome: the 7 sequence or production, followed
   * by the modules' `afterProduction` stages. A module that deferred the roll
   * in `beforeProduction` calls this once its own frames are resolved.
   */
  resolveRollOutcome(state: GameState, roll: RollResult, rng?: Rng): void;
  /** Completes the current setup placement step (after its road/ship). */
  finishSetupStep(state: GameState): void;
  /**
   * Ends the current action window and opens the next one, without running
   * `beforeEndTurn` again. A module that deferred the end of a turn calls this
   * once its end-of-turn frames are resolved.
   */
  finishTurn(state: GameState): void;
  /** Base road legality (connection, occupancy, module conditions) for a player. */
  canPlaceRoad(state: GameState, playerId: string, edge: number): boolean;
  /** Base settlement legality (distance rule, connection, module conditions). */
  canPlaceBuilding(state: GameState, playerId: string, vertex: number, options?: { setup?: boolean }): boolean;
}

export interface ModuleContext {
  profile: ProfileDefinition;
  rng: Rng;
  kit: RulesKit;
}

/** Hook context for read-only views (no randomness, no mutation). */
export interface ModuleViewContext {
  profile: ProfileDefinition;
  /**
   * Read-only engine legality checks, present when the engine itself calls
   * the hook (action hints, board conditions); absent in plain projections.
   */
  rules?: Pick<RulesKit, 'canPlaceRoad' | 'canPlaceBuilding'>;
}

export interface RollResult {
  /** The two production dice. */
  dice: [number, number];
  total: number;
  /** Module-specific roll data (for example the C&K event die). */
  extra?: Record<string, unknown>;
}

export interface SetupStep {
  playerId: string;
  round: 1 | 2;
}

/** A piece the engine just placed (setup or action phase). */
export interface BuildEvent {
  playerId: string;
  piece: 'settlement' | 'city' | 'road';
  vertex?: number;
  edge?: number;
  /** Placed during initial setup. */
  setup: boolean;
  /** Placed without paying (Road Building). */
  free: boolean;
}

/** Non-resource goods a module lets players trade (e.g. gold coins). */
export interface TradeGoods {
  /** Good ids tradeable in this state. */
  ids(state: GameState): readonly string[];
  balance(state: GameState, playerId: string, good: string): number;
  /** Moves goods between players; amounts were checked against `balance`. */
  transfer(state: GameState, from: string, to: string, good: string, amount: number): void;
}

export type ModuleCommandHandler = (
  state: GameState,
  actorId: string,
  command: ModuleCommand,
  ctx: ModuleContext,
) => CommandOutcome;

/** The public, viewer-filtered form of a module frame. */
export interface PublicModulePendingView {
  kind: `${string}.${string}`;
  module: string;
  responders: string[];
  data: Record<string, unknown>;
}

export interface RulesModule {
  /** Stable id listed in `ProfileDefinition.ruleModules`. */
  readonly id: string;

  // -- setup ---------------------------------------------------------------
  /** Adds module state after the base state is built (bank, decks, pieces). */
  initGame?(state: GameState, ctx: ModuleContext): void;
  /** The building a setup step places; `undefined` keeps the settlement. */
  setupBuilding?(state: GameState, step: SetupStep, ctx: ModuleViewContext): 'settlement' | 'city' | undefined;

  // -- roll resolution -------------------------------------------------------
  /** Supplies the roll instead of two base dice. At most one module may. */
  rollDice?(state: GameState, ctx: ModuleContext): RollResult | undefined;
  /**
   * Runs after `turn.rolled` and before the 7 / production. Return `'defer'`
   * after enqueueing frames whose resolution must come first; the module then
   * calls `kit.resolveRollOutcome` from a continuation frame.
   */
  beforeProduction?(state: GameState, roll: RollResult, ctx: ModuleContext): 'continue' | 'defer';
  /**
   * Replaces the robber step of a 7 (after discards). Return a frame to make
   * active, `null` for no robber step, or `undefined` to keep the base
   * `moveRobber` frame.
   */
  sevenRobberStep?(state: GameState, actorId: string, ctx: ModuleContext): PendingFrame | null | undefined;
  /** Discard threshold for a player on a 7 (base: 7 cards). */
  discardLimit?(state: GameState, player: PlayerState, base: number, ctx: ModuleViewContext): number;
  /** Adjusts the production results before they are paid out. */
  modifyProduction?(state: GameState, results: ProductionResult[], roll: RollResult, ctx: ModuleContext): ProductionResult[];
  /** Runs after production or the 7 has been set up. */
  afterProduction?(state: GameState, roll: RollResult, ctx: ModuleContext): void;

  // -- commands and building -------------------------------------------------
  /** Handlers for module-owned command types (never base command types). */
  commands?: Readonly<Record<string, ModuleCommandHandler>>;
  /** Command types accepted while a frame is pending (base gate otherwise). */
  pendingCommands?: readonly string[];
  /** Extra condition for a road on `edge` (setup and action phase). */
  roadAllowed?(state: GameState, playerId: string, edge: number, ctx: ModuleViewContext): boolean;
  /** Extra condition for a settlement or city on `vertex` (setup and action phase). */
  buildingAllowed?(
    state: GameState,
    playerId: string,
    vertex: number,
    kind: 'settlement' | 'city',
    ctx: ModuleViewContext,
  ): boolean;
  /** Runs after a settlement, city or road was placed (setup included). */
  afterBuild?(state: GameState, build: BuildEvent, ctx: ModuleContext): void;
  /**
   * Runs when the actor ends their action phase. Return `'defer'` after
   * enqueueing end-of-turn frames; the module then calls `kit.finishTurn`.
   */
  beforeEndTurn?(state: GameState, actorId: string, ctx: ModuleContext): 'continue' | 'defer';
  /** Legal robber hexes; `targets` is the base list (every hex but the current one). */
  robberTargets?(state: GameState, actorId: string, targets: number[], ctx: ModuleViewContext): number[];
  /** Filters the players the robber may steal from at `hex`. */
  stealCandidates?(state: GameState, hex: number, actorId: string, candidates: string[], ctx: ModuleViewContext): string[];
  /** False when a hex yields nothing this roll (counted as blocked). */
  hexProduces?(state: GameState, hex: number, ctx: ModuleViewContext): boolean;
  /** Adjusts one building's entitlement on a producing hex, before the bank limit. */
  productionAmount?(state: GameState, hex: number, vertex: number, amount: number, ctx: ModuleViewContext): number;
  /** Whether a player's building at `vertex` may use the harbour there. */
  harborAccess?(state: GameState, playerId: string, vertex: number, ctx: ModuleViewContext): boolean;
  /** Adjusts the award rules (minimums, route weights) before awards are recomputed. */
  awardRules?(state: GameState, rules: AwardRules, ctx: ModuleViewContext): AwardRules;
  /** Goods besides resources that domestic offers may carry. */
  tradeGoods?: TradeGoods;
  /** Runs after every board change (build, setup placement, robber move). */
  afterBoardChange?(state: GameState, ctx: ModuleViewContext): void;
  /**
   * Resolves a continuation frame (`responders: []`) of this module when it
   * becomes active. The engine advances the queue afterwards, so the hook
   * must not call `kit.completePending` for that frame itself.
   */
  resumePending?(state: GameState, frame: ModulePending, ctx: ModuleContext): void;

  // -- scoring ---------------------------------------------------------------
  /** Victory points this module adds for a player. */
  score?(state: GameState, playerId: string, options: ScoreOptions, ctx: ModuleViewContext): number;
  /** The points a player needs to win; `base` is the profile target. */
  victoryTarget?(state: GameState, playerId: string, base: number, ctx: ModuleViewContext): number;

  // -- projection ------------------------------------------------------------
  /** Viewer-filtered module state, published as `GameView.modules[id]`. */
  project?(state: GameState, viewerId: string, ctx: ModuleViewContext): unknown;
  /** Viewer-filtered form of this module's frame; defaults to no data. */
  projectPending?(state: GameState, frame: ModulePending, viewerId: string, ctx: ModuleViewContext): PublicModulePendingView;
  /** Advisory legal targets, published as `ActionHints.modules[id]`. */
  actionHints?(state: GameState, playerId: string, ctx: ModuleViewContext): unknown;
}
