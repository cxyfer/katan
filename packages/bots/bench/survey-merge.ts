/**
 * survey 分片的驗證、合併與拉丁方陣的局集（純函式，`bench/survey-merge.test.ts` 測它；`survey.ts` 的
 * `--merge`、`--latin` 共用）。
 *
 * 分片的規則（`checkShards`）：
 * - 分片不能是空的；`meta.from`、`meta.games`、每局的 `game`、`seed`、`seats` 都是必填（缺少、型別不對一律拒絕，
 *   不會靜默略過檢查）；`meta.games` 要等於實際局數（檔案被截斷時拒絕），局號要落在 `[from, from + games)`；
 * - 種子必須是 `10000 + 局號`（`SEED_BASE`），否則不同來源的對局被當成同一局；
 * - 分片必須是同一組態：profile、人數、`--roles`、`--openings`、`--script-roles`、`--setup-from` 都相同，否則拒絕；
 * - 局號以 `(shift, game)` 判斷唯一：同一個 shift 內不能有兩個分片含有同一局（否則該局會被重複計入）；
 *   不同 shift 之間局號可以相同（拉丁方陣每個 shift 都從同一批種子起跑）；
 * - 位移不同的分片只能「池化」：座位 × 開局被平衡掉，合併後的 `meta.shift` 移除（`poolBalanceWarning`
 *   檢查池化的位移是否完整、每個位移的局數是否相同）。
 *
 * 拉丁方陣（`latinCohort`）：每個 shift 都要有 0..人數−1 的完整編號；只用「在每個 shift 都有記錄、而且
 * 每個 shift 都終局」的局號（交集），否則同一個種子在不同位移的座位／開局排列會缺席，邊際就混入種子本身的
 * 結果。被剔除的局數逐 shift 回報。
 */

/** 逐局種子 = `SEED_BASE + 局號`（與 `bench/run.ts` 相同）。 */
export const SEED_BASE = 10_000;

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
  /** 分片宣告的起始局與局數（必填）：與實際記錄對照。 */
  from: number;
  games: number;
}

export interface ShardGame {
  game: number;
  /** 逐局種子（必填）：必須是 `SEED_BASE + game`。 */
  seed: number;
  /** 逐局的座位記錄（必填）：數量必須等於人數。 */
  seats: readonly unknown[];
}

export interface Shard<M extends ShardMeta, G extends ShardGame> {
  meta: M;
  games: readonly G[];
  /** 只用在錯誤訊息。 */
  file?: string;
}

export class ShardMergeError extends Error {}

/** 分片的 shift；沒有腳本開局（沒有 `--shift`）的分片視為同一個「無 shift」。 */
function shiftOf(meta: ShardMeta): string {
  return meta.shift === undefined ? 'none' : String(meta.shift);
}

const nameOf = (shard: Shard<ShardMeta, ShardGame>, index: number): string => shard.file ?? `shard #${index + 1}`;

/** 檢查分片可以合併；不合規則時丟 `ShardMergeError`。型別是必填，但資料來自 JSON，所以執行期也逐項檢查。 */
export function checkShards<M extends ShardMeta, G extends ShardGame>(shards: readonly Shard<M, G>[]): void {
  const first = shards[0]?.meta;
  if (!first) throw new ShardMergeError('nothing to merge');
  const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
  shards.forEach((shard, index) => {
    const { meta, games } = shard;
    const name = nameOf(shard, index);
    if (!isInt(meta.from) || meta.from < 0 || !isInt(meta.games) || meta.games < 0) {
      throw new ShardMergeError(`${name} needs integer meta.from and meta.games`);
    }
    if (games.length === 0) throw new ShardMergeError(`${name} is empty (no game records)`);
    if (meta.openings !== undefined && meta.shift === undefined) throw new ShardMergeError(`${name} has scripted openings but no shift`);
    if (meta.openings === undefined && meta.shift !== undefined) throw new ShardMergeError(`${name} has a shift but no scripted openings`);
    if (meta.games !== games.length) {
      throw new ShardMergeError(`${name} has ${games.length} game records but its meta says ${meta.games} (truncated or edited file?)`);
    }
    for (const game of games) {
      if (!isInt(game.game) || game.game < meta.from || game.game >= meta.from + meta.games) {
        throw new ShardMergeError(`${name} has game ${String(game.game)} outside its declared range ${meta.from}..${meta.from + meta.games - 1}`);
      }
      if (!isInt(game.seed)) throw new ShardMergeError(`${name} game ${game.game} needs an integer seed, got ${JSON.stringify(game.seed)}`);
      if (game.seed !== SEED_BASE + game.game) {
        throw new ShardMergeError(`${name} game ${game.game} has seed ${game.seed}, expected ${SEED_BASE + game.game}`);
      }
      if (!Array.isArray(game.seats) || game.seats.length !== meta.players) {
        throw new ShardMergeError(`${name} game ${game.game} needs ${meta.players} seat records, got ${Array.isArray(game.seats) ? game.seats.length : JSON.stringify(game.seats)}`);
      }
    }
  });
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

/**
 * 池化合併的平衡檢查：座位 × 開局只有在 shift 0..人數−1 都有、而且每個 shift 的局數（與終局數）相同時才被
 * 完全平衡掉。不平衡時回傳警告文字，平衡或不是池化就回傳 null。
 */
export function poolBalanceWarning<M extends ShardMeta, G extends ShardGame & { finished?: boolean }>(
  shards: readonly Shard<M, G>[],
): string | null {
  const first = shards[0]?.meta;
  if (!first || first.openings === undefined) return null;
  const perShift = new Map<number, { games: number; finished: number }>();
  for (const { meta, games } of shards) {
    const shift = meta.shift ?? 0;
    const slot = perShift.get(shift) ?? { games: 0, finished: 0 };
    slot.games += games.length;
    slot.finished += games.filter((game) => game.finished !== false).length;
    perShift.set(shift, slot);
  }
  if (perShift.size < 2) return null;
  const missing = Array.from({ length: first.players }, (_, shift) => shift).filter((shift) => !perShift.has(shift));
  const counts = [...perShift.values()];
  const equal = counts.every((slot) => slot.games === counts[0]!.games && slot.finished === counts[0]!.finished);
  if (missing.length === 0 && equal) return null;
  const detail = [...perShift.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([shift, slot]) => `shift ${shift}: ${slot.finished}/${slot.games} finished`)
    .join(', ');
  return (
    `pooled shards do not balance seat × opening (${missing.length > 0 ? `missing shift ${missing.join(',')}; ` : ''}${detail}); ` +
    'use --latin for the seat and opening marginals'
  );
}

export interface LatinGame extends ShardGame {
  finished: boolean;
}

export interface LatinCohort<G extends LatinGame> {
  /** 位移，依序為 0..人數−1。 */
  shifts: number[];
  /** 交集局號（遞增）。 */
  ids: number[];
  /** 每個 shift 的交集局（依局號遞增，與 `ids` 逐一對應）。 */
  byShift: Map<number, G[]>;
  /** 每個 shift 的記錄數、終局數、保留數；`dropped = games − kept`。 */
  stats: Map<number, { games: number; finished: number; kept: number; dropped: number }>;
}

/**
 * 拉丁方陣的局集：shift 必須恰好是 0..人數−1（不可重複、缺漏或超出），只保留「每個 shift 都有記錄、而且每個
 * shift 都終局」的局號。範圍不同或看門狗失敗的局不同時，仍保證每個局號在每個座位 × 開局排列各出現一次。
 * 交集為空時丟 `ShardMergeError`；有剔除時呼叫端應輸出警告（`stats` 有逐 shift 的剔除數）。
 */
export function latinCohort<M extends ShardMeta, G extends LatinGame>(shards: readonly Shard<M, G>[]): LatinCohort<G> {
  checkShards(shards);
  const n = shards[0]!.meta.players;
  const records = new Map<number, Map<number, G>>();
  shards.forEach((shard, index) => {
    const { meta, games } = shard;
    const shift = meta.shift;
    if (shift === undefined || !Number.isInteger(shift) || shift < 0 || shift >= n) {
      throw new ShardMergeError(`${nameOf(shard, index)} needs a scripted shift in 0..${n - 1}, got ${shift === undefined ? 'none' : shift}`);
    }
    const bucket = records.get(shift) ?? new Map<number, G>();
    for (const game of games) bucket.set(game.game, game);
    records.set(shift, bucket);
  });
  const shifts = [...records.keys()].sort((a, b) => a - b);
  if (shifts.length !== n || shifts.some((shift, index) => shift !== index)) {
    throw new ShardMergeError(`--latin needs one shift per 0..${n - 1}, got ${shifts.join(',')}`);
  }
  const ids = [...records.get(0)!.keys()]
    .filter((id) => shifts.every((shift) => records.get(shift)!.get(id)?.finished === true))
    .sort((a, b) => a - b);
  if (ids.length === 0) throw new ShardMergeError('no game is present and finished in every shift');
  const byShift = new Map<number, G[]>();
  const stats = new Map<number, { games: number; finished: number; kept: number; dropped: number }>();
  for (const shift of shifts) {
    const bucket = records.get(shift)!;
    byShift.set(shift, ids.map((id) => bucket.get(id)!));
    const finished = [...bucket.values()].filter((game) => game.finished).length;
    stats.set(shift, { games: bucket.size, finished, kept: ids.length, dropped: bucket.size - ids.length });
  }
  return { shifts, ids, byShift, stats };
}

/** 剔除說明（沒有剔除時回傳 null）：給報告與 stderr 的警告。 */
export function cohortWarning<G extends LatinGame>(cohort: LatinCohort<G>): string | null {
  const dropped = [...cohort.stats.entries()].filter(([, slot]) => slot.dropped > 0);
  if (dropped.length === 0) return null;
  const detail = [...cohort.stats.entries()]
    .map(([shift, slot]) => `shift ${shift}: ${slot.games} games, ${slot.finished} finished, ${slot.dropped} dropped`)
    .join('; ');
  return `latin cohort: kept ${cohort.ids.length} games finished in every shift; ${detail}`;
}
