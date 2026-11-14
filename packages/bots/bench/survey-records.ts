/**
 * survey 的記錄格式與 jsonl 分片的解析（純函式；`bench/survey-records.test.ts` 測它）。
 *
 * 分片是外部輸入：meta 與逐局、逐座位的每個欄位都必填且型別正確（`GAME_SCHEMA`、`SEAT_SCHEMA` 用
 * `Record<keyof …>` 讓新增欄位時編譯器強迫同步），並檢查彼此一致：座位角色對得上 `--roles` 的輪換、
 * `won` 對得上 `winner`、`finished` 對得上 `problem`。沒有欄位會被靜默略過驗證；選填的只有「沒有用到
 * 該功能」時才省略的設定（`openings`／`shift`／`scriptRoles`／`setupFrom`），它們有就必須合法且彼此一致。
 */

import { getProfile } from '@catan/rules';
import { ShardMergeError, type Shard } from './survey-merge.ts';

export type Role = 'standard' | 'easy' | 'naive';
export const ROLES: readonly Role[] = ['standard', 'easy', 'naive'];


// ---------------------------------------------------------------------------
// 記錄格式
// ---------------------------------------------------------------------------

export interface Meta {
  profile: string;
  players: number;
  roles: string;
  from: number;
  games: number;
  /** 只腳本化這個角色的座位（`--script-roles`）；省略表示所有座位。 */
  scriptRoles?: string;
  /** `standard` 座位的 setup 階段改用哪個策略的決定（`--setup-from`）；省略表示不改。 */
  setupFrom?: string;
  /** 腳本開局（`--openings`）與位移（`--shift`）；沒有腳本時省略。 */
  openings?: string;
  shift?: number;
}

export interface SeatRecord {
  seat: number;
  role: Role;
  won: boolean;
  /** 終局分數（含隱藏分）。 */
  score: number;
  /** 開局依序放置的聚落頂點。 */
  opening: number[];
  /** 每個開局頂點周圍的點數（pips）合計。 */
  openPips: number[];
  /** 每個開局頂點是否臨海。 */
  openCoast: boolean[];
  /** 每個開局頂點是否在港口上。 */
  openHarbor: boolean[];
  /** 兩個開局頂點周圍不同資源（含金礦）的種類數。 */
  openKinds: number;
  paidShips: number;
  freeShips: number;
  setupShips: number;
  shipsMoved: number;
  islandBonuses: number;
  settlements: number;
  cities: number;
  roads: number;
  devBought: number;
  knights: number;
  playerTrades: number;
  bankTrades: number;
  produced: number;
  turns: number;
  improvements: number;
  /** 被強盜偷走與被強盜擋住的資源張數。 */
  robbed: number;
  blocked: number;
  /** 終局時是否持有最長道路、最大騎士團。 */
  longestRoad: boolean;
  largestArmy: boolean;
  /** 腳本頂點不合法、退回 bot 自己選擇的次數（沒有腳本時為 0）。 */
  scriptMiss: number;
  /** 第 10、20 輪開始時的分數；整局在那之前結束則為 null。 */
  vp10: number | null;
  vp20: number | null;
}

export interface GameRecord {
  game: number;
  seed: number;
  finished: boolean;
  /** 沒有正常終局的原因（看門狗、卡死、拒絕、守恆）。 */
  problem: string | null;
  winner: number | null;
  rounds: number;
  seats: SeatRecord[];
}

export interface RoleSpec {
  focus: Role | null;
  rest: Role;
}

export function parseRoles(spec: string): RoleSpec {
  const [first, second, ...extra] = spec.split(':');
  const valid = (value: string | undefined): value is Role => ROLES.includes(value as Role);
  if (extra.length > 0 || !valid(first) || (second !== undefined && !valid(second))) {
    throw new Error(`--roles must be <role> or <focus>:<rest> with roles ${ROLES.join('|')}, got "${spec}"`);
  }
  return second === undefined ? { focus: null, rest: first } : { focus: first, rest: second };
}

export function rolesFor(spec: RoleSpec, players: number, game: number): Role[] {
  return Array.from({ length: players }, (_, seat) =>
    spec.focus !== null && (((seat - game) % players) + players) % players < 1 ? spec.focus : spec.rest,
  );
}

type FieldKind = 'int' | 'num' | 'bool' | 'int[]' | 'num[]' | 'bool[]' | 'str|null' | 'int|null' | 'num|null' | 'role';

/** 逐局與逐座位記錄的欄位型別；`Record<keyof …>` 讓新增欄位時編譯器強迫這裡同步，不會有欄位被略過驗證。 */
const GAME_SCHEMA: Record<Exclude<keyof GameRecord, 'seats'>, FieldKind> = {
  game: 'int',
  seed: 'int',
  finished: 'bool',
  problem: 'str|null',
  winner: 'int|null',
  rounds: 'num',
};

const SEAT_SCHEMA: Record<keyof SeatRecord, FieldKind> = {
  seat: 'int',
  role: 'role',
  won: 'bool',
  score: 'num',
  opening: 'int[]',
  openPips: 'num[]',
  openCoast: 'bool[]',
  openHarbor: 'bool[]',
  openKinds: 'num',
  paidShips: 'num',
  freeShips: 'num',
  setupShips: 'num',
  shipsMoved: 'num',
  islandBonuses: 'num',
  settlements: 'num',
  cities: 'num',
  roads: 'num',
  devBought: 'num',
  knights: 'num',
  playerTrades: 'num',
  bankTrades: 'num',
  produced: 'num',
  turns: 'num',
  improvements: 'num',
  robbed: 'num',
  blocked: 'num',
  longestRoad: 'bool',
  largestArmy: 'bool',
  scriptMiss: 'num',
  vp10: 'num|null',
  vp20: 'num|null',
};

const isInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function matchesKind(kind: FieldKind, value: unknown): boolean {
  switch (kind) {
    case 'int':
      return isInteger(value);
    case 'num':
      return isNumber(value);
    case 'bool':
      return typeof value === 'boolean';
    case 'int[]':
      return Array.isArray(value) && value.every(isInteger);
    case 'num[]':
      return Array.isArray(value) && value.every(isNumber);
    case 'bool[]':
      return Array.isArray(value) && value.every((entry) => typeof entry === 'boolean');
    case 'str|null':
      return value === null || typeof value === 'string';
    case 'int|null':
      return value === null || isInteger(value);
    case 'num|null':
      return value === null || isNumber(value);
    case 'role':
      return typeof value === 'string' && ROLES.includes(value as Role);
  }
}

/** 逐局記錄的完整驗證：每個欄位都必填且型別正確，座位角色、勝者與終局狀態彼此一致。 */
function checkGameRecord(file: string, lineNumber: number, raw: unknown, meta: Meta, spec: RoleSpec): GameRecord {
  const where = `${file} line ${lineNumber}`;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ShardMergeError(`${where} is not a game record`);
  const record = raw as Record<string, unknown>;
  for (const [key, kind] of Object.entries(GAME_SCHEMA)) {
    if (!(key in record) || !matchesKind(kind, record[key])) throw new ShardMergeError(`${where} needs ${key} (${kind}), got ${JSON.stringify(record[key])}`);
  }
  const seats = record.seats;
  if (!Array.isArray(seats) || seats.length !== meta.players) {
    throw new ShardMergeError(`${where} needs ${meta.players} seat records, got ${Array.isArray(seats) ? seats.length : JSON.stringify(seats)}`);
  }
  const game = record as unknown as GameRecord;
  const expectedRoles = rolesFor(spec, meta.players, game.game);
  seats.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new ShardMergeError(`${where} seat ${index + 1} is not a seat record`);
    const seat = entry as Record<string, unknown>;
    for (const [key, kind] of Object.entries(SEAT_SCHEMA)) {
      if (!(key in seat) || !matchesKind(kind, seat[key])) throw new ShardMergeError(`${where} seat ${index + 1} needs ${key} (${kind}), got ${JSON.stringify(seat[key])}`);
    }
    if (seat.seat !== index) throw new ShardMergeError(`${where} seat ${index + 1} has seat index ${String(seat.seat)}`);
    if (seat.role !== expectedRoles[index]) throw new ShardMergeError(`${where} seat ${index + 1} has role ${String(seat.role)}, expected ${expectedRoles[index]} for --roles ${meta.roles}`);
    if (seat.won !== (game.winner === index)) throw new ShardMergeError(`${where} seat ${index + 1} won=${String(seat.won)} disagrees with winner ${String(game.winner)}`);
  });
  if (game.finished !== (game.problem === null)) throw new ShardMergeError(`${where} finished=${String(game.finished)} disagrees with problem ${JSON.stringify(game.problem)}`);
  if (game.finished && (game.winner === null || game.winner >= meta.players)) throw new ShardMergeError(`${where} is finished but has no winner seat`);
  if (!game.finished && game.winner !== null) throw new ShardMergeError(`${where} is unfinished but has a winner`);
  return game;
}

/** 解析一個 jsonl 分片的文字：第一行 meta，其餘為逐局記錄；任何欄位缺少或型別不對都丟 `ShardMergeError`（含檔名）。 */
export function parseShard(file: string, text: string): Shard<Meta, GameRecord> {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) throw new ShardMergeError(`${file} is empty`);
  const parse = (line: string, index: number): unknown => {
    try {
      return JSON.parse(line);
    } catch {
      throw new ShardMergeError(`${file} line ${index + 1} is not valid JSON`);
    }
  };
  const head = parse(lines[0]!, 0) as { meta?: Record<string, unknown> } | null;
  const meta = head?.meta;
  if (!meta || typeof meta !== 'object') throw new ShardMergeError(`${file} line 1 is not a shard meta`);
  if (typeof meta.profile !== 'string' || !isInteger(meta.players) || meta.players < 1 || typeof meta.roles !== 'string') {
    throw new ShardMergeError(`${file} meta needs profile (string), players (integer >= 1) and roles (string)`);
  }
  for (const key of ['from', 'games'] as const) {
    if (!isInteger(meta[key]) || (meta[key] as number) < 0) throw new ShardMergeError(`${file} meta.${key} must be a non-negative integer, got ${JSON.stringify(meta[key])}`);
  }
  if (meta.shift !== undefined && (!isInteger(meta.shift) || meta.shift < 0)) throw new ShardMergeError(`${file} meta.shift must be a non-negative integer`);
  for (const key of ['openings', 'scriptRoles', 'setupFrom'] as const) {
    if (meta[key] !== undefined && typeof meta[key] !== 'string') throw new ShardMergeError(`${file} meta.${key} must be a string`);
  }
  const typed = meta as unknown as Meta;
  let spec: RoleSpec;
  try {
    spec = parseRoles(typed.roles);
  } catch (error) {
    throw new ShardMergeError(`${file} meta.roles is invalid: ${(error as Error).message}`);
  }
  const profile = getProfile(typed.profile);
  if (!profile) throw new ShardMergeError(`${file} meta.profile "${typed.profile}" is not a known ruleset profile`);
  if (!profile.playerCounts.includes(typed.players)) throw new ShardMergeError(`${file} meta.players ${typed.players} is not supported by ${profile.id}`);
  if (typed.scriptRoles !== undefined) {
    if (!ROLES.includes(typed.scriptRoles as Role)) throw new ShardMergeError(`${file} meta.scriptRoles must be one of ${ROLES.join('|')}`);
    if (typed.openings === undefined) throw new ShardMergeError(`${file} has meta.scriptRoles but no scripted openings`);
    if (spec.focus !== typed.scriptRoles && spec.rest !== typed.scriptRoles) throw new ShardMergeError(`${file} meta.scriptRoles ${typed.scriptRoles} matches no seat in --roles ${typed.roles}`);
  }
  if (typed.setupFrom !== undefined) {
    if (typed.setupFrom !== 'naive') throw new ShardMergeError(`${file} meta.setupFrom must be "naive"`);
    if (typed.openings !== undefined) throw new ShardMergeError(`${file} has both meta.setupFrom and scripted openings (they are exclusive)`);
  }
  if (typed.openings !== undefined) {
    if (!/^\d+\/\d+(,\d+\/\d+)*$/.test(typed.openings) || typed.openings.split(',').length !== typed.players) {
      throw new ShardMergeError(`${file} meta.openings must list ${typed.players} <vertex>/<vertex> entries, got "${typed.openings}"`);
    }
    if (typed.shift !== undefined && typed.shift >= typed.players) throw new ShardMergeError(`${file} meta.shift ${typed.shift} must be below the player count ${typed.players}`);
  }
  const games = lines.slice(1).map((line, index) => checkGameRecord(file, index + 2, parse(line, index + 1), typed, spec));
  return { meta: typed, games, file };
}

