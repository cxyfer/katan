/**
 * hard 的強盜、騎士與偷牌（規格 §4 第 4 點）：依估計分數（含隱藏分）加權封鎖的產能，
 * 偷牌以計牌結果估計偷到的牌對自己的價值。
 */

import { RESOURCES, type Command, type Resource } from '@catan/rules';
import { canPlay } from '../base/cards.ts';
import { deficitOf } from '../economy.ts';
import { blockedPips } from '../heuristic.ts';
import type { HardTurn } from './turn.ts';

/** 偷牌價值：對手每單位威脅（`HardTurn.threat` − 1）多算的分數。 */
const STEAL_THREAT = 0.3;
/** 強盜格：自己建築的點數權重（負）。 */
const ROBBER_SELF = 3;
/** 強盜格：偷牌價值相對封鎖產能的權重。 */
const ROBBER_STEAL = 3;
/** 被強盜擋住的點數（城市加倍）達到這個值時，打騎士解除封鎖。 */
const KNIGHT_UNBLOCK = 3;

/** 自己每種資源多一張的價值：主要計畫缺的牌最值錢。 */
function cardValues(turn: HardTurn): Record<Resource, number> {
  const economy = turn.economy;
  const plan = economy.plans[0];
  const missing = plan ? deficitOf(economy.hand, plan.cost) : null;
  const out = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
  for (const resource of RESOURCES) {
    out[resource] = economy.weights[resource] * (missing && missing[resource] > 0 ? 2 : 1);
  }
  return out;
}

/** 從某位對手偷一張牌的期望價值（偷到自己需要的牌，也讓對方少一張）。 */
export function stealValue(turn: HardTurn, victimId: string, values = cardValues(turn)): number {
  const victim = turn.player(victimId);
  if (!victim || victim.handSize === 0) return 0;
  const odds = turn.cardOdds(victimId);
  let value = 0;
  for (const resource of RESOURCES) value += odds[resource] * values[resource];
  return value + STEAL_THREAT * (turn.threat(victimId) - 1);
}

/** 強盜格的評分：封鎖對手的加權產能，避開自己，並加上偷牌的價值。 */
export function robberScores(turn: HardTurn): { hex: number; score: number }[] {
  const { view, model, ctx } = turn;
  const values = cardValues(turn);
  const out: { hex: number; score: number }[] = [];
  view.board.terrain.forEach((terrain, hex) => {
    if (hex === view.board.robber || terrain === 'sea') return;
    const pips = model.hexPips[hex]!;
    const resource = model.hexResource[hex];
    const scarcity = resource ? turn.economy.weights[resource] : 1;
    let score = 0;
    let steal = 0;
    const seen = new Set<string>();
    for (const vertex of model.hexVertices[hex]!) {
      const building = view.board.buildings[vertex];
      if (!building) continue;
      const factor = building.city ? 2 : 1;
      if (building.player === ctx.selfId) {
        score -= pips * factor * ROBBER_SELF;
        continue;
      }
      score += pips * factor * scarcity * turn.threat(building.player);
      if (!seen.has(building.player)) {
        seen.add(building.player);
        steal = Math.max(steal, stealValue(turn, building.player, values));
      }
    }
    out.push({ hex, score: score + ROBBER_STEAL * steal });
  });
  return out;
}

export function robberTarget(turn: HardTurn): number | null {
  let best: { hex: number; score: number } | null = null;
  for (const candidate of robberScores(turn)) if (!best || candidate.score > best.score) best = candidate;
  return best?.hex ?? null;
}

export function hardStealVictim(turn: HardTurn, candidates: readonly string[]): string | null {
  const values = cardValues(turn);
  let best: string | null = null;
  let bestValue = -Infinity;
  for (const id of candidates) {
    const value = stealValue(turn, id, values);
    if (value > bestValue) {
      bestValue = value;
      best = id;
    }
  }
  return best;
}

/**
 * 騎士：standard 的時機（解除封鎖、拿到最大騎士團、致勝）之外，只要還追得上最大騎士團就打；
 * 目標用 hard 的強盜評分。
 */
export function hardKnightDecision(turn: HardTurn): Command | null {
  if (!canPlay(turn, 'knight')) return null;
  const { view, me } = turn;
  const holder = view.awards.largestArmy;
  const holderKnights = holder ? (turn.player(holder)?.playedKnights ?? 0) : 0;
  const takesArmy = holder !== me.id && me.playedKnights + 1 >= 3 && me.playedKnights + 1 > holderKnights;
  const wins = takesArmy && (me.ownScore ?? me.publicScore) + 2 >= view.victoryTarget;
  const unblock = blockedPips(turn) >= KNIGHT_UNBLOCK;
  // 積極：只要還追得上最大騎士團，就趁早打出（偷牌、封鎖領先者、累積騎士數）。自我對局：4 人局
  // 從 42% 提高到 49%、6 人局從 25% 提高到 32%（standard 只在解除封鎖或拿到騎士團時才打）。
  const rivalKnights = Math.max(0, ...turn.opponents.map((player) => player.playedKnights));
  const held = (me.devCards ?? []).filter((card) => card === 'knight').length;
  const eager = me.playedKnights + held + 1 >= rivalKnights;
  if (!unblock && !wins && !takesArmy && !eager) return null;
  const hex = robberTarget(turn);
  return hex === null ? null : { type: 'dev.playKnight', hex };
}
