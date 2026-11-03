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

import type { ProductionResult, ScoreOptions } from '../analysis.ts';
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
   * Resumes the remaining `beforeProduction` hooks after this module, then
   * resolves the 7 sequence or production and the `afterProduction` stages.
   * A deferring module calls this once from its own continuation or command.
   * Later modules may defer again. Uses the context RNG unless one is passed.
   */
  resolveRollOutcome(state: GameState, roll: RollResult, rng?: Rng): void;
  /** Completes the current setup placement step (after its road/ship). */
  finishSetupStep(state: GameState): void;
}

export interface ModuleContext {
  profile: ProfileDefinition;
  rng: Rng;
  kit: RulesKit;
}

/** Hook context for read-only views (no randomness, no mutation). */
export interface ModuleViewContext {
  profile: ProfileDefinition;
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

  // -- projection ------------------------------------------------------------
  /** Viewer-filtered module state, published as `GameView.modules[id]`. */
  project?(state: GameState, viewerId: string, ctx: ModuleViewContext): unknown;
  /** Viewer-filtered form of this module's frame; defaults to no data. */
  projectPending?(state: GameState, frame: ModulePending, viewerId: string, ctx: ModuleViewContext): PublicModulePendingView;
  /** Advisory legal targets, published as `ActionHints.modules[id]`. */
  actionHints?(state: GameState, playerId: string, ctx: ModuleViewContext): unknown;
}
