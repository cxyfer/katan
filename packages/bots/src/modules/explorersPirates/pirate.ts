/**
 * E&P 的海盜 frame（計畫 §4.3、§4.4、§6.4 I9；E3）：只有 `responders[0]` 作答。
 *
 * - place：在 `H.pirateTargets` 內替每個海格評分：貼著對手船的邊（以對手的領先分加權，可偷才算足額、載貨的船被擋路再加分）、
 *   對手 harbour 的角，扣掉會嚇跑自己魚的魚場；easy 從前 3 名挑。
 * - rob：與 base 的 `stealVictim` 相同的評分（手牌張數優先，其次公開分數）。
 *   `stealVictim` 在 heuristic.ts 內沒有匯出，骨架檔不改，所以這裡重寫同一個公式。
 */

import { EP_PIRATE_FRAME } from '@katan/rules';
import type { BotCommand, BotModule, Scored, TurnContext } from '../types.ts';
import type { EpGeometry } from './geometry.ts';
import { geometryOf } from './plans.ts';
import { epHints, epPlayer } from './view.ts';

/** 靠近目標格但不貼邊的對手船：之後路過要付過路費。 */
const NEAR_WEIGHT = 0.25;
const CARGO_BONUS = 0.5;
const HARBOR_WEIGHT = 0.3;
const SHOAL_PENALTY = 1;

/** 目標格 `hex` 的分數（純函式）。 */
export function pirateHexScore(turn: TurnContext, g: EpGeometry, hex: number): number {
  const me = turn.ctx.selfId;
  const mine = turn.me.publicScore;
  const corners = new Set<number>();
  g.topo.vertices.forEach((vertex, index) => {
    if (vertex.hexes.includes(hex)) corners.add(index);
  });
  const weightOf = (id: string): number => 1 + 0.5 * Math.max(0, (turn.view.players.find((p) => p.id === id)?.publicScore ?? 0) - mine);
  let score = 0;
  for (const ship of g.ep.ships) {
    if (ship.player === me) continue;
    const edge = g.topo.edges[ship.edge]!;
    const weight = weightOf(ship.player);
    if (edge.hexes.includes(hex)) {
      const victim = turn.view.players.find((p) => p.id === ship.player);
      const robbable = (victim?.handSize ?? 0) > 0 || (epPlayer(g.ep, ship.player)?.gold ?? 0) > 0;
      score += weight * (robbable ? 1 : 0.2) + (ship.cargo.length > 0 ? CARGO_BONUS : 0);
    } else if (edge.vertices.some((vertex) => corners.has(vertex))) {
      score += weight * NEAR_WEIGHT;
    }
  }
  for (const harbor of g.ep.harbors) if (harbor.player !== me && corners.has(harbor.vertex)) score += HARBOR_WEIGHT * weightOf(harbor.player);
  const site = g.ep.sites.find((entry) => entry.hex === hex);
  if (site?.kind === 'shoal' && site.fish) score -= SHOAL_PENALTY;
  return score;
}

function robScore(turn: TurnContext, id: string): number {
  const player = turn.view.players.find((candidate) => candidate.id === id);
  return (player?.handSize ?? 0) * 10 + (player?.publicScore ?? 0);
}

export const epAnswerFrame = (
  turn: TurnContext,
  frame: Parameters<NonNullable<BotModule['answerFrame']>>[1],
): BotCommand | null | undefined => {
  if (frame.kind !== EP_PIRATE_FRAME) return undefined;
  if (!('responders' in frame) || frame.responders[0] !== turn.ctx.selfId) return null;
  const hints = epHints(turn.view.hints);
  const stage = (frame.data as { stage?: string } | undefined)?.stage;
  if (stage === 'place') {
    const g = geometryOf(turn);
    const scored: Scored<number>[] = (hints?.pirateTargets ?? []).map((hex) => ({ item: hex, score: g ? pirateHexScore(turn, g, hex) : 0 }));
    const hex = turn.pick(scored);
    return hex === null ? null : { type: 'ep.placePirate', hex };
  }
  if (stage === 'rob') {
    const victim = turn.pick((hints?.robCandidates ?? []).map((item) => ({ item, score: robScore(turn, item) })));
    return victim === null ? null : { type: 'ep.robPlayer', victim };
  }
  return null;
};
