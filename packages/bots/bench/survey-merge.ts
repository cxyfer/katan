/**
 * survey 分片的合併檢查（純函式，`bench/survey-merge.test.ts` 測它；`survey.ts` 的 `--merge`、`--latin` 共用）。
 *
 * 規則：
 * - 分片必須是同一組態：profile、人數、`--roles`、`--openings`、`--script-roles`、`--setup-from` 都相同，否則拒絕；
 * - 局號以 `(shift, game)` 判斷唯一：同一個 shift 內不能有兩個分片含有同一局（否則該局會被重複計入）；
 *   不同 shift 之間局號可以相同（拉丁方陣每個 shift 都從同一批種子起跑）；
 * - 位移不同的分片只能「池化」：座位 × 開局被平衡掉，合併後的 `meta.shift` 移除。
 */

export interface ShardMeta {
  profile: string;
  players: number;
  roles: string;
  openings?: string;
  shift?: number;
  /** 只腳本化某個角色（`--script-roles`）；不同的分片不能合併。 */
  scriptRoles?: string;
  /** standard 座位的 setup 改用哪個策略的決定（`--setup-from`）；不同的分片不能合併。 */
  setupFrom?: string;
}

export interface ShardGame {
  game: number;
}

export interface Shard<M extends ShardMeta, G extends ShardGame> {
  meta: M;
  games: readonly G[];
}

export class ShardMergeError extends Error {}

/** 分片的 shift；沒有腳本開局（沒有 `--shift`）的分片視為同一個「無 shift」。 */
function shiftOf(meta: ShardMeta): string {
  return meta.shift === undefined ? 'none' : String(meta.shift);
}

/** 檢查分片可以合併；不合規則時丟 `ShardMergeError`。 */
export function checkShards<M extends ShardMeta, G extends ShardGame>(shards: readonly Shard<M, G>[]): void {
  const first = shards[0]?.meta;
  if (!first) throw new ShardMergeError('nothing to merge');
  for (const { meta } of shards) {
    if (
      meta.profile !== first.profile ||
      meta.players !== first.players ||
      meta.roles !== first.roles ||
      meta.openings !== first.openings ||
      meta.scriptRoles !== first.scriptRoles ||
      meta.setupFrom !== first.setupFrom
    ) {
      throw new ShardMergeError(`cannot merge shards of different configs: ${JSON.stringify(first)} vs ${JSON.stringify(meta)}`);
    }
  }
  const seen = new Set<string>();
  for (const { meta, games } of shards) {
    for (const { game } of games) {
      const key = `${shiftOf(meta)}:${game}`;
      if (seen.has(key)) {
        throw new ShardMergeError(
          `shards overlap: game ${game} appears twice${meta.shift === undefined ? '' : ` in shift ${meta.shift}`}`,
        );
      }
      seen.add(key);
    }
  }
}

/**
 * 合併分片：先檢查，再串接逐局記錄。位移不同時（池化）回傳的 meta 不帶 `shift`。
 * 呼叫端另外負責把 `from`、`games` 之類的欄位依自己的 meta 型別補上。
 */
export function mergeShards<M extends ShardMeta, G extends ShardGame>(
  shards: readonly Shard<M, G>[],
): { meta: M; games: G[]; pooled: boolean } {
  checkShards(shards);
  const first = shards[0]!.meta;
  const pooled = shards.some(({ meta }) => meta.shift !== first.shift);
  const meta = { ...first };
  if (pooled) delete meta.shift;
  return { meta, games: shards.flatMap(({ games }) => [...games]), pooled };
}
