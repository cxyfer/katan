/**
 * 島嶼獎勵的用語依劇本而定（New Shores「小島」、四島群島「新島嶼」、穿越荒漠「未探索區域」）。
 * 回傳訊息 id 的後綴；New Shores 與其他劇本回 null，沿用原文案。
 */
export type IslandWording = 'fourIslands' | 'desert';

export function islandWording(scenario: string | null | undefined): IslandWording | null {
  if (scenario === 'four-islands') return 'fourIslands';
  if (scenario === 'through-the-desert') return 'desert';
  return null;
}
