/**
 * Traders & Barbarians rules module (TB25, CN3089). The box holds independent
 * variants and scenarios; a profile selects one scenario (or none) plus
 * variants, and this module composes the matching parts (`part.ts`) in that
 * order. Profiles list `ruleModules: ['tradersBarbarians']` explicitly.
 */

import { getProfile, type ProfileDefinition } from '../../profiles.ts';
import type { GameState } from '../../types.ts';
import type {
  ModuleCommandHandler,
  ModuleViewContext,
  PublicModulePendingView,
  RollResult,
  RulesModule,
} from '../types.ts';
import './boards.ts';
import {
  BARBARIAN_ATTACK,
  barbarianAttackPart,
  CAPTURE as BA_CAPTURE_FRAME,
  KNIGHTHOOD as BA_KNIGHTHOOD_FRAME,
  KNIGHTS as BA_KNIGHTS_FRAME,
  STEAL as BA_STEAL_FRAME,
  SWIFT as BA_SWIFT_KNIGHT_FRAME,
  TREASON as BA_TREASON_FRAME,
  type TbBarbarianAttackHints,
  type TbBarbarianAttackView,
} from './barbarians/index.ts';
import { COINS, coinsPart, type TbCoinsHints, type TbCoinsView } from './coins/index.ts';
import { FISHING, fishingPart, SWAP_FRAME as FISH_SWAP_FRAME, type TbFishingHints, type TbFishingView } from './fishing/index.ts';
import { RIVERS, riversPart, type TbRiversHints, type TbRiversView } from './rivers/index.ts';
import {
  BARBARIAN as TRADERS_BARBARIAN_FRAME,
  MOVE as TRADERS_WAGON_FRAME,
  TRADERS,
  tradersPart,
  type TbTradersHints,
  type TbTradersView,
} from './traders/index.ts';
import {
  ASSIGN as WAGON_ASSIGN_FRAME,
  BID as WAGON_BID_FRAME,
  PLACE as WAGON_PLACE_FRAME,
  TRAINS,
  trainsPart,
  type TbTrainsHints,
  type TbTrainsView,
} from './trains/index.ts';
import { TB, type TbBoardChoice, type TbPart } from './part.ts';
import { friendlyRobberPart } from './variants/friendlyRobber.ts';
import { HARBORS, harborsPart, type TbHarborsView } from './variants/harbors.ts';

/** Scenario id → parts it runs, shared parts first. */
const SCENARIO_PARTS: Readonly<Record<string, readonly TbPart[]>> = {
  'tb-fishing': [fishingPart],
  'tb-rivers': [coinsPart, riversPart],
  'tb-merchant-trains': [trainsPart],
  'tb-barbarian-attack': [coinsPart, barbarianAttackPart],
  'tb-traders-barbarians': [coinsPart, tradersPart],
};

/** Variant id → part. */
const VARIANT_PARTS: Readonly<Record<string, TbPart>> = {
  [friendlyRobberPart.id]: friendlyRobberPart,
  [harborsPart.id]: harborsPart,
};

/** 劇本 id → 依序執行的 part id；未知劇本查不到（`undefined`）。 */
export const TB_SCENARIO_PART_IDS: Readonly<Partial<Record<string, readonly string[]>>> = Object.freeze(
  Object.fromEntries(Object.entries(SCENARIO_PARTS).map(([id, list]) => [id, Object.freeze(list.map((part) => part.id))])),
);

/** 變體 id → part id；沒有 part 的變體（如 `event-cards`）查不到（`undefined`）。 */
export const TB_VARIANT_PART_IDS: Readonly<Partial<Record<string, readonly string[]>>> = Object.freeze(
  Object.fromEntries(Object.entries(VARIANT_PARTS).map(([id, part]) => [id, Object.freeze([part.id])])),
);

/** frame 進行中可以送的模組指令（所有 part 的聯集）；bots 的 responseCommands 用它。 */
export const TB_PENDING_COMMANDS: readonly string[] = Object.freeze([
  ...new Set(allParts().flatMap((part) => part.pendingCommands ?? [])),
]);

/** T&B 各 part 的 pending frame kind，鍵為步驟名。 */
export const TB_FRAME_KINDS = {
  fishSwap: FISH_SWAP_FRAME,
  wagonBid: WAGON_BID_FRAME,
  wagonAssign: WAGON_ASSIGN_FRAME,
  wagonPlace: WAGON_PLACE_FRAME,
  baSteal: BA_STEAL_FRAME,
  baCapture: BA_CAPTURE_FRAME,
  baKnighthood: BA_KNIGHTHOOD_FRAME,
  baSwiftKnight: BA_SWIFT_KNIGHT_FRAME,
  baTreason: BA_TREASON_FRAME,
  baKnights: BA_KNIGHTS_FRAME,
  tbWagon: TRADERS_WAGON_FRAME,
  tbBarbarian: TRADERS_BARBARIAN_FRAME,
} as const;

/**
 * `GameView.modules.tradersBarbarians`：part id → 該 part 的 view，只有 profile
 * 啟用的 part 才有鍵（part 狀態未建立時為 `null`）。Friendly Robber 沒有 view。
 */
export interface TradersBarbariansView {
  [FISHING]?: TbFishingView | null;
  [COINS]?: TbCoinsView | null;
  [RIVERS]?: TbRiversView | null;
  [TRAINS]?: TbTrainsView | null;
  [BARBARIAN_ATTACK]?: TbBarbarianAttackView | null;
  [TRADERS]?: TbTradersView | null;
  [HARBORS]?: TbHarborsView;
}

/**
 * `ActionHints.modules.tradersBarbarians`：啟用 part 的 hints，加上根層合併的
 * `targets`、第一個非空的 `board`，以及有 part 限制強盜位置時的 `robberHexes`。
 */
export interface TradersBarbariansHints {
  [FISHING]?: TbFishingHints | null;
  [COINS]?: TbCoinsHints;
  [RIVERS]?: TbRiversHints | null;
  [TRAINS]?: TbTrainsHints | null;
  [BARBARIAN_ATTACK]?: TbBarbarianAttackHints | null;
  [TRADERS]?: TbTradersHints | null;
  targets: Record<string, number[]>;
  board: TbBoardChoice | null;
  robberHexes?: number[];
}

const resolved = new WeakMap<ProfileDefinition, readonly TbPart[]>();

/** The parts a profile runs: its scenario's parts, then its variants. */
export function activeParts(profile: ProfileDefinition): readonly TbPart[] {
  const cached = resolved.get(profile);
  if (cached) return cached;
  const parts: TbPart[] = [];
  if (profile.scenario) parts.push(...(SCENARIO_PARTS[profile.scenario] ?? []));
  for (const variant of profile.variants) {
    const part = VARIANT_PARTS[variant];
    if (part) parts.push(part);
  }
  resolved.set(profile, parts);
  return parts;
}

function allParts(): TbPart[] {
  return [...new Set([...Object.values(SCENARIO_PARTS).flat(), ...Object.values(VARIANT_PARTS)])];
}

/** Every part's commands; a command of an inactive part is rejected. */
function composeCommands(): Record<string, ModuleCommandHandler> {
  const out: Record<string, ModuleCommandHandler> = {};
  for (const part of allParts()) {
    for (const [type, handler] of Object.entries(part.commands ?? {})) {
      const previous = out[type];
      out[type] = (state, actorId, command, ctx) => {
        if (activeParts(ctx.profile).includes(part)) return handler(state, actorId, command, ctx);
        return previous ? previous(state, actorId, command, ctx) : ctx.kit.fail('E_INVALID_COMMAND');
      };
    }
  }
  return out;
}

function partOfFrame(profile: ProfileDefinition, kind: string): TbPart | undefined {
  return activeParts(profile).find((part) => part.frames?.includes(kind));
}

const parts = (ctx: ModuleViewContext) => activeParts(ctx.profile);

/** 合併啟用 part 的 view，發布為 `GameView.modules.tradersBarbarians`。 */
export function tradersBarbariansView(state: GameState, viewerId: string, ctx: ModuleViewContext): TradersBarbariansView {
  return Object.fromEntries(
    parts(ctx).filter((part) => part.project).map((part) => [part.id, part.project!(state, viewerId, ctx)]),
  ) as TradersBarbariansView;
}

/** 合併啟用 part 的 hints，發布為 `ActionHints.modules.tradersBarbarians`。 */
export function tradersBarbariansHints(state: GameState, playerId: string, ctx: ModuleViewContext): TradersBarbariansHints {
  const hints: Record<string, unknown> = Object.fromEntries(
    parts(ctx).filter((part) => part.actionHints).map((part) => [part.id, part.actionHints!(state, playerId, ctx)]),
  );
  // Board targets and pending board choices are published at the root so a
  // client finds them without knowing which part asked.
  const targets: Record<string, number[]> = {};
  let board: unknown = null;
  for (const value of Object.values(hints)) {
    if (!value || typeof value !== 'object') continue;
    Object.assign(targets, (value as { targets?: Record<string, number[]> }).targets ?? {});
    board ??= (value as { board?: unknown }).board ?? null;
  }
  hints.targets = targets;
  hints.board = board;
  if (parts(ctx).some((part) => part.robberTargets)) {
    // The robber's legal hexes when a part narrows them (the board's targets).
    const base = state.board.layout.terrain.map((_, hex) => hex).filter((hex) => hex !== state.board.robber);
    hints.robberHexes = parts(ctx).reduce((value, part) => part.robberTargets?.(state, playerId, value, ctx) ?? value, base);
  }
  return hints as unknown as TradersBarbariansHints;
}

export const tradersBarbariansModule: RulesModule = {
  id: TB,

  initGame(state, ctx) {
    for (const part of parts(ctx)) part.initGame?.(state, ctx);
  },
  setupBuilding(state, step, ctx) {
    for (const part of parts(ctx)) {
      const building = part.setupBuilding?.(state, step, ctx);
      if (building) return building;
    }
    return undefined;
  },

  rollDice(state, ctx) {
    for (const part of parts(ctx)) {
      const roll = part.rollDice?.(state, ctx);
      if (roll) return roll;
    }
    return undefined;
  },
  beforeProduction(state, roll: RollResult, ctx) {
    for (const part of parts(ctx)) if (part.beforeProduction?.(state, roll, ctx) === 'defer') return 'defer';
    return 'continue';
  },
  sevenRobberStep(state, actorId, ctx) {
    for (const part of parts(ctx)) {
      const frame = part.sevenRobberStep?.(state, actorId, ctx);
      if (frame !== undefined) return frame;
    }
    return undefined;
  },
  discardLimit(state, player, base, ctx) {
    return parts(ctx).reduce((limit, part) => part.discardLimit?.(state, player, limit, ctx) ?? limit, base);
  },
  hexProduces(state, hex, ctx) {
    return parts(ctx).every((part) => !part.hexProduces || part.hexProduces(state, hex, ctx));
  },
  productionAmount(state, hex, vertex, amount, ctx) {
    return parts(ctx).reduce((value, part) => part.productionAmount?.(state, hex, vertex, value, ctx) ?? value, amount);
  },
  modifyProduction(state, results, roll, ctx) {
    return parts(ctx).reduce((value, part) => part.modifyProduction?.(state, value, roll, ctx) ?? value, results);
  },
  afterProduction(state, roll, ctx) {
    for (const part of parts(ctx)) part.afterProduction?.(state, roll, ctx);
  },

  roadAllowed(state, playerId, edge, ctx) {
    return parts(ctx).every((part) => !part.roadAllowed || part.roadAllowed(state, playerId, edge, ctx));
  },
  buildingAllowed(state, playerId, vertex, kind, ctx) {
    return parts(ctx).every((part) => !part.buildingAllowed || part.buildingAllowed(state, playerId, vertex, kind, ctx));
  },
  afterBuild(state, build, ctx) {
    for (const part of parts(ctx)) part.afterBuild?.(state, build, ctx);
  },
  afterBoardChange(state, ctx) {
    for (const part of parts(ctx)) part.afterBoardChange?.(state, ctx);
  },
  onEndTurn(state, actorId, ctx) {
    for (const part of parts(ctx)) if (part.onEndTurn?.(state, actorId, ctx) === 'defer') return 'defer';
    return 'continue';
  },
  robberTargets(state, actorId, targets, ctx) {
    return parts(ctx).reduce((value, part) => part.robberTargets?.(state, actorId, value, ctx) ?? value, targets);
  },
  stealCandidates(state, hex, actorId, candidates, ctx) {
    return parts(ctx).reduce((value, part) => part.stealCandidates?.(state, hex, actorId, value, ctx) ?? value, candidates);
  },
  harborAccess(state, playerId, vertex, ctx) {
    return parts(ctx).every((part) => !part.harborAccess || part.harborAccess(state, playerId, vertex, ctx));
  },
  awardRules(state, rules, ctx) {
    return parts(ctx).reduce((value, part) => part.awardRules?.(state, value, ctx) ?? value, rules);
  },
  tradeGoods: {
    ids(state) {
      return goodsPart(state)?.tradeGoods?.ids(state) ?? [];
    },
    balance(state, playerId, good) {
      return goodsPart(state)?.tradeGoods?.balance(state, playerId, good) ?? 0;
    },
    transfer(state, from, to, good, amount) {
      goodsPart(state)?.tradeGoods?.transfer(state, from, to, good, amount);
    },
  },

  commands: composeCommands(),
  pendingCommands: [...TB_PENDING_COMMANDS],
  resumePending(state, frame, ctx) {
    partOfFrame(ctx.profile, frame.kind)?.resumePending?.(state, frame, ctx);
  },

  score(state, playerId, options, ctx) {
    return parts(ctx).reduce((sum, part) => sum + (part.score?.(state, playerId, options, ctx) ?? 0), 0);
  },
  victoryTarget(state, playerId, base, ctx) {
    return parts(ctx).reduce((value, part) => part.victoryTarget?.(state, playerId, value, ctx) ?? value, base);
  },

  project: tradersBarbariansView,
  projectPending(state, frame, viewerId, ctx): PublicModulePendingView {
    const part = partOfFrame(ctx.profile, frame.kind);
    if (part?.projectPending) return part.projectPending(state, frame, viewerId, ctx);
    return { kind: frame.kind, module: frame.module, responders: frame.responders.slice(), data: {} };
  },
  actionHints: tradersBarbariansHints,
};

/** The active part that defines trade goods. */
function goodsPart(state: { profileId: string }): TbPart | undefined {
  const profile = getProfile(state.profileId);
  return profile ? activeParts(profile).find((part) => part.tradeGoods) : undefined;
}
