/** base 的初始放置評分。 */

import { RESOURCES, type Resource } from '@catan/rules';
import { playerYield, vertexYield } from '../board.ts';
import { resourceWeights, weightedPips } from '../economy.ts';
import type { TurnContext } from '../modules/types.ts';

export function setupSpotScore(turn: TurnContext, vertex: number): number {
  const { model, ctx, view } = turn;
  const weights = resourceWeights(model);
  const mine = playerYield(model, ctx.selfId, true);
  const spot = vertexYield(model, vertex);
  let score = weightedPips(spot, weights);
  for (const resource of RESOURCES) {
    if (spot[resource] > 0 && mine[resource] === 0) score += 2;
  }
  const harbor = model.harborAt[vertex];
  if (harbor === 'generic') score += 1;
  else if (harbor) score += mine[harbor as Resource] + spot[harbor as Resource] >= 5 ? 2.5 : 0.5;
  if (view.turn.setup?.round === 2) {
    // 第二座聚落要讓開局能鋪路、能蓋聚落。
    const combined = { ...mine };
    for (const resource of RESOURCES) combined[resource] += spot[resource];
    if (combined.lumber === 0) score -= 3;
    if (combined.brick === 0) score -= 3;
    if (combined.grain === 0) score -= 1.5;
    if (combined.wool === 0) score -= 1;
    if (combined.ore === 0) score -= 1;
    // 第二座聚落立即給起始資源。
    for (const hex of model.topo.vertices[vertex]!.hexes) if (model.hexResource[hex]) score += 0.3;
  }
  return score;
}
