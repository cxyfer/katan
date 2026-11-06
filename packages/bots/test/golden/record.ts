/**
 * 錄製 base golden fixture，輸出到 stdout。0.4.1 內不得重錄；需要時由主 agent 決定。
 *
 * 在 repo 根目錄執行（先 bundle 再跑，輸出需逐位元穩定）：
 *   pnpm exec esbuild packages/bots/test/golden/record.ts --bundle --platform=node --format=esm --outfile=/tmp/golden-pl1.mjs \
 *     && node /tmp/golden-pl1.mjs > packages/bots/test/golden/base-v040.json
 */

import { GOLDEN_GAMES, playGolden } from './driver.ts';

// 本套件不載入 Node 型別；輸出只需要這個全域。
declare const console: { log(text: string): void };

const records = GOLDEN_GAMES.map((game) => {
  const outcome = playGolden(game);
  // 有拒絕或卡死的局不能當基準。
  if (outcome.failure !== null) throw new Error(`${game.id}: rejected ${outcome.failure}`);
  if (outcome.stalled) throw new Error(`${game.id}: stalled after ${outcome.record.steps} steps`);
  return outcome.record;
});

console.log(JSON.stringify(records, null, 2));
