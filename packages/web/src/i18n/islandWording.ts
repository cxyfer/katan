/**
 * 島嶼獎勵的用語依劇本而定（New Shores「小島」、四島群島「新島嶼」、穿越荒漠「未探索區域」）。
 * 回傳訊息 id 的後綴；New Shores 與其他劇本回 null，沿用原文案。
 */
export type IslandWording = 'fourIslands' | 'desert';

export function islandWording(scenario: string | null | undefined): IslandWording | null {
  // 新世界與四島群島一樣沒有「小島」：每座非 home 的島都是新島嶼。
  if (scenario === 'four-islands' || scenario === 'new-world') return 'fourIslands';
  if (scenario === 'through-the-desert') return 'desert';
  return null;
}
