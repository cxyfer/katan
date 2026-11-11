/**
 * C&K 的開局放置（C&K 計畫 §4.3 setup 第 2 輪）：第 2 輪放的是城市，選點分數 = 點數加上 commodity 產出
 * （森林、牧場、山脈上的城市各多一張 commodity），而且至少要相鄰 ore 或 grain 其中之一（騎士與啟動都要用）。
 * 第 1 輪（聚落）與放路都沿用 base：回 undefined。
 *
 * `citySetupScore` 是純函式，供 0.4.3 的 SF+CK 組合 setup 使用：只讀 `model`（含組合後的 `hexYield`），
 * 不讀 hints、不消耗亂數。評分單位與 base 的 `setupSpotScore` 相同（加權點數）。
 * 常數是未經對局調校的起點。
 */

import { RESOURCES, type Resource } from '@catan/rules';
import { playerYield, vertexYield, type BoardModel, type Yield } from '../../board.ts';
import { resourceWeights, weightedPips, type KindTable } from '../../economy.ts';
import type { BotModule } from '../types.ts';
import { COMMODITY_WEIGHT } from './economy.ts';

/** commodity 的估值權重（開局時還沒有改良可以參考，用基準值）。 */
function setupWeights(model: BoardModel): KindTable {
  return { ...resourceWeights(model), paper: COMMODITY_WEIGHT.base, cloth: COMMODITY_WEIGHT.base, coin: COMMODITY_WEIGHT.base };
}

/**
 * 在 `vertex` 放城市的分數。`mine` 是自己目前（長期）的產能，省略時由 `model` 計算。城市的產能依
 * `vertexYield(…, city = true)`：每格 2 張，森林、牧場、山脈上是 1 資源加 1 commodity。
 */
export function citySetupScore(model: BoardModel, vertex: number, mine: Yield = playerYield(model, model.selfId, true)): number {
  const weights = setupWeights(model);
  const city = vertexYield(model, vertex, null, true);
  // 城市每格 2 張：除以 2，與聚落的 `setupSpotScore` 同尺度。
  let score = weightedPips(city, weights) / 2;
  for (const resource of RESOURCES) {
    if (city[resource] > 0 && mine[resource] === 0) score += 2;
  }
  const harbor = model.harborAt[vertex];
  if (harbor === 'generic') score += 1;
  else if (harbor) score += mine[harbor as Resource] + city[harbor as Resource] / 2 >= 5 ? 2.5 : 0.5;
  // 第 2 輪要讓開局能鋪路、能蓋聚落，也要有騎士與啟動的材料（ore 或 grain 至少一種）。
  const combined: Record<Resource, number> = { ...mine };
  for (const resource of RESOURCES) combined[resource] += city[resource];
  if (combined.lumber === 0) score -= 2.5;
  if (combined.brick === 0) score -= 2.5;
  if (combined.ore === 0 && combined.grain === 0) score -= 3;
  else if (combined.grain === 0) score -= 1;
  else if (combined.ore === 0) score -= 1;
  if (combined.wool === 0) score -= 0.5;
  // 起始資源：城市立即給每格一張。
  for (const hex of model.topo.vertices[vertex]!.hexes) if (model.hexResource[hex]) score += 0.3;
  return score;
}

export const citiesKnightsSetup: NonNullable<BotModule['setup']> = (turn) => {
  const { view, model } = turn;
  const setup = view.turn.setup;
  if (setup?.stage !== 'building' || setup.round !== 2) return undefined;
  const mine = playerYield(model, turn.ctx.selfId, true);
  const vertex = turn.pick((view.hints?.legalSettlements ?? []).map((item) => ({ item, score: citySetupScore(model, item, mine) })));
  return vertex === null ? undefined : { type: 'setup.placeBuilding', vertex };
};
