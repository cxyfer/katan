/**
 * Traders & Barbarians rules module (TB25, CN3089). The box holds independent
 * variants and scenarios; a profile selects one scenario (or none) plus
 * variants, and this module composes the matching parts (`part.ts`) in that
 * order. Profiles list `ruleModules: ['tradersBarbarians']` explicitly.
 */

import { getProfile, type ProfileDefinition } from '../../profiles.ts';
import type {
  ModuleCommandHandler,
  ModuleViewContext,
  PublicModulePendingView,
  RollResult,
  RulesModule,
} from '../types.ts';
import { TB, type TbPart } from './part.ts';
import { friendlyRobberPart } from './variants/friendlyRobber.ts';
import { harborsPart } from './variants/harbors.ts';

/** Scenario id → parts it runs, shared parts first. */
const SCENARIO_PARTS: Readonly<Record<string, readonly TbPart[]>> = {};

/** Variant id → part. */
const VARIANT_PARTS: Readonly<Record<string, TbPart>> = {
  [friendlyRobberPart.id]: friendlyRobberPart,
  [harborsPart.id]: harborsPart,
};

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
  beforeEndTurn(state, actorId, ctx) {
    for (const part of parts(ctx)) if (part.beforeEndTurn?.(state, actorId, ctx) === 'defer') return 'defer';
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
  pendingCommands: [...new Set(allParts().flatMap((part) => part.pendingCommands ?? []))],
  resumePending(state, frame, ctx) {
    partOfFrame(ctx.profile, frame.kind)?.resumePending?.(state, frame, ctx);
  },

  score(state, playerId, options, ctx) {
    return parts(ctx).reduce((sum, part) => sum + (part.score?.(state, playerId, options, ctx) ?? 0), 0);
  },
  victoryTarget(state, playerId, base, ctx) {
    return parts(ctx).reduce((value, part) => part.victoryTarget?.(state, playerId, value, ctx) ?? value, base);
  },

  project(state, viewerId, ctx) {
    return Object.fromEntries(
      parts(ctx).filter((part) => part.project).map((part) => [part.id, part.project!(state, viewerId, ctx)]),
    );
  },
  projectPending(state, frame, viewerId, ctx): PublicModulePendingView {
    const part = partOfFrame(ctx.profile, frame.kind);
    if (part?.projectPending) return part.projectPending(state, frame, viewerId, ctx);
    return { kind: frame.kind, module: frame.module, responders: frame.responders.slice(), data: {} };
  },
  actionHints(state, playerId, ctx) {
    const hints: Record<string, unknown> = Object.fromEntries(
      parts(ctx).filter((part) => part.actionHints).map((part) => [part.id, part.actionHints!(state, playerId, ctx)]),
    );
    if (parts(ctx).some((part) => part.robberTargets)) {
      // The robber's legal hexes when a part narrows them (the board's targets).
      const base = state.board.layout.terrain.map((_, hex) => hex).filter((hex) => hex !== state.board.robber);
      hints.robberHexes = parts(ctx).reduce((value, part) => part.robberTargets?.(state, playerId, value, ctx) ?? value, base);
    }
    return hints;
  },
};

/** The active part that defines trade goods. */
function goodsPart(state: { profileId: string }): TbPart | undefined {
  const profile = getProfile(state.profileId);
  return profile ? activeParts(profile).find((part) => part.tradeGoods) : undefined;
}
