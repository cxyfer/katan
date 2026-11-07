/**
 * 凍結的 golden driver：照搬 v0.4.0 的 `test/harness.ts`、`policy.test.ts` 與
 * `fallback.test.ts` 的對局邏輯，讓 base 的決策序列可以在平台重構前後逐步比對。
 *
 * 凍結規則：
 * - 不 import `../harness.ts`；harness 之後會被泛化，不得影響這個檔案。
 * - 策略只從公開入口 `../../src/index.ts` 取得（`createBotPolicy`、`fallbackPolicy`），
 *   另外只用到同一入口的 `botActingOrder`、`botSeed` 與型別。
 * - 設定一律寫死：遊戲亂數 `seededRng(seed)`、決策種子 `botSeed('test', id, state.seq)`、
 *   報價時鐘 `createOfferClock`、投影只帶 hints、`variable` 開局。
 * - 0.4.1 內不得修改本檔與 fixture；需要重錄時由主 agent 決定並寫明原因。
 *
 * 決策序列的雜湊：每個被規則引擎接受的決策，以「鍵排序的 JSON（座位 id 加上指令）+ 換行」
 * 逐筆累計 FNV-1a 64（UTF-8 位元組、BigInt 運算、16 位小寫十六進位）。與物件鍵順序、
 * 執行環境無關。
 */

import {
  actionHints,
  applyCommand,
  createGame,
  PLAYER_COLORS,
  projectGame,
  seededRng,
  type GameState,
  type GameView,
  type Rng,
} from '@catan/rules';
import {
  botActingOrder,
  botSeed,
  createBotPolicy,
  fallbackPolicy,
  type BotLevel,
  type BotPolicy,
  type OfferPhase,
} from '../../src/index.ts';

// 本套件不載入 Node 型別；雜湊只需要這個全域（Node 與瀏覽器都有）。
declare const TextEncoder: new () => { encode(text: string): Uint8Array };

/** 每隔多少個已套用的決策記一個 checkpoint 雜湊。 */
export const CHECKPOINT_INTERVAL = 100;

// ---------------------------------------------------------------------------
// 雜湊
// ---------------------------------------------------------------------------

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = (1n << 64n) - 1n;

/** 鍵排序的 JSON：與物件鍵的插入順序無關；`undefined` 的鍵與 `JSON.stringify` 一樣省略。 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}

export interface Fnv64 {
  update(text: string): void;
  digest(): string;
}

export function createFnv64(): Fnv64 {
  const encoder = new TextEncoder();
  let hash = FNV_OFFSET;
  return {
    update(text) {
      for (const byte of encoder.encode(text)) hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & MASK_64;
    },
    digest: () => hash.toString(16).padStart(16, '0'),
  };
}

// ---------------------------------------------------------------------------
// v0.4.0 harness（只保留對局需要的部分；計時與統計與行為無關，已省略）
// ---------------------------------------------------------------------------

interface BotSeat {
  id: string;
  level: BotLevel;
  policy: BotPolicy;
}

/** 策略回傳的指令型別；跟著 `BotPolicy.decide` 走，凍結後不受型別放寬影響。 */
type PolicyCommand = NonNullable<ReturnType<BotPolicy['decide']>>;

interface Decision {
  actor: string;
  command: PolicyCommand;
}

type OfferPhases = (botId: string, state: GameState) => Readonly<Record<string, OfferPhase>>;

function profileFor(players: number): string {
  return players >= 5 ? 'base-paired-2025' : 'base-2025';
}

function newBotGame(players: number, seed: number): { state: GameState; rng: Rng } {
  const rng = seededRng(seed);
  const state = createGame({
    profileId: profileFor(players),
    players: Array.from({ length: players }, (_, index) => ({
      id: `bot${index + 1}`,
      nickname: `Bot ${index + 1}`,
      color: PLAYER_COLORS[index]!,
    })),
    setupMode: 'variable',
    rng,
  });
  return { state, rng };
}

/** 與伺服器相同的投影：自己座位的 view 加上 hints（不帶 events）。 */
function viewFor(state: GameState, playerId: string): GameView {
  return projectGame(state, playerId, { hints: actionHints(state, playerId) });
}

/** 依排程順序詢問各 Bot，回傳第一個非 null 的決策；全部在等待時回傳 null。 */
function nextDecision(
  state: GameState,
  seats: readonly BotSeat[],
  offerPhases: OfferPhases = () => ({}),
): Decision | null {
  const order = botActingOrder(
    viewFor(state, seats[0]!.id),
    seats.map((seat) => seat.id),
  );
  for (const id of order) {
    const seat = seats.find((candidate) => candidate.id === id)!;
    const view = viewFor(state, id);
    const command = seat.policy.decide(view, {
      selfId: id,
      level: seat.level,
      seed: botSeed('test', id, state.seq),
      offerPhases: offerPhases(id, state),
    });
    if (command) return { actor: id, command };
  }
  return null;
}

/**
 * 以步數模擬報價階段：報價建立後第一次輪詢為 collecting，下一次為 ready，之後為
 * expired。每當所有座位都在等待時，時鐘前進一格。
 */
function createOfferClock(): { phases: OfferPhases; tick(state: GameState): void } {
  const age = new Map<string, number>();
  return {
    phases(botId, state) {
      const out: Record<string, OfferPhase> = {};
      for (const offer of state.offers) {
        if (offer.from !== botId || offer.status !== 'open') continue;
        const ticks = age.get(offer.id) ?? 0;
        out[offer.id] = ticks === 0 ? 'collecting' : ticks === 1 ? 'ready' : 'expired';
      }
      return out;
    },
    tick(state) {
      for (const offer of state.offers) {
        if (offer.status === 'open') age.set(offer.id, (age.get(offer.id) ?? 0) + 1);
      }
    },
  };
}

function mixedLevels(players: number, seed: number): BotLevel[] {
  return Array.from({ length: players }, (_, index) => ((index + seed) % 2 === 0 ? 'standard' : 'easy'));
}

// ---------------------------------------------------------------------------
// 對局定義
// ---------------------------------------------------------------------------

/**
 * - `game`：`runBotGame` 迴圈（報價時鐘、5000 步上限、有勝者即停）。
 * - `bounded`：`fallback.test.ts` 的迴圈（無報價時鐘、不看勝者、固定跑滿 `maxSteps`）。
 */
export type GoldenKind = 'game' | 'bounded';

export interface GoldenGame {
  id: string;
  /** 測試 `it` 的名稱；不寫進 fixture。 */
  group: string;
  kind: GoldenKind;
  players: number;
  seed: number;
  levels: readonly BotLevel[];
  maxSteps: number;
  /** 只走保底策略的座位 id；其餘座位走 `createBotPolicy(level)`。 */
  fallbackSeats: readonly string[];
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

const botIds = (players: number): string[] => range(1, players).map((index) => `bot${index}`);

export const GOLDEN_GAMES: readonly GoldenGame[] = [
  // B-GAME：3–6 人 × 種子 1–10（policy.test.ts:91-107）
  ...[3, 4, 5, 6].flatMap((players) =>
    range(1, 10).map(
      (seed): GoldenGame => ({
        id: `b-game/${players}p/seed${seed}`,
        group: `b-game ${players} players`,
        kind: 'game',
        players,
        seed,
        levels: mixedLevels(players, seed),
        maxSteps: 5000,
        fallbackSeats: [],
      }),
    ),
  ),
  // 保底席：bot2 從不回應報價（policy.test.ts:109-124）
  ...[21, 22, 23].map(
    (seed): GoldenGame => ({
      id: `fallback-seat/4p/seed${seed}`,
      group: 'fallback seat',
      kind: 'game',
      players: 4,
      seed,
      levels: ['standard', 'easy', 'standard', 'standard'],
      maxSteps: 5000,
      fallbackSeats: ['bot2'],
    }),
  ),
  // 經過 createBotPolicy 的一局（policy.test.ts:126-132）
  {
    id: 'wrapped/4p/seed31',
    group: 'wrapped policy',
    kind: 'game',
    players: 4,
    seed: 31,
    levels: ['standard', 'easy', 'easy', 'standard'],
    maxSteps: 5000,
    fallbackSeats: [],
  },
  // 全保底有界局（fallback.test.ts:16-45）
  ...[3, 4, 5, 6].map(
    (players): GoldenGame => ({
      id: `all-fallback/${players}p/seed1`,
      group: 'all-fallback bounded',
      kind: 'bounded',
      players,
      seed: 1,
      levels: Array.from({ length: players }, () => 'standard' as const),
      maxSteps: 800,
      fallbackSeats: botIds(players),
    }),
  ),
];

// ---------------------------------------------------------------------------
// 執行與記錄
// ---------------------------------------------------------------------------

/** 寫進 fixture 的欄位。 */
export interface GoldenRecord {
  id: string;
  profileId: string;
  players: number;
  seed: number;
  levels: BotLevel[];
  maxSteps: number;
  /** 被規則引擎接受的決策數。 */
  steps: number;
  seq: number;
  winner: string | null;
  reason: string | null;
  /** 全部決策的累計雜湊。 */
  hash: string;
  /** 第 i 個元素是第 `(i + 1) * CHECKPOINT_INTERVAL` 個決策套用後的累計雜湊。 */
  checkpoints: string[];
}

export interface GoldenOutcome {
  record: GoldenRecord;
  /** 所有座位都在等待、且沒有報價可以推進。 */
  stalled: boolean;
  /** 被規則引擎拒絕的決策（`<actor> <command.type> <error.code>`）；沒有則為 null。 */
  failure: string | null;
}

export function playGolden(game: GoldenGame): GoldenOutcome {
  const seats: BotSeat[] = game.levels.map((level, index) => {
    const id = `bot${index + 1}`;
    return { id, level, policy: game.fallbackSeats.includes(id) ? fallbackPolicy : createBotPolicy(level) };
  });
  let { state, rng } = newBotGame(game.players, game.seed);
  const clock = createOfferClock();
  const hasher = createFnv64();
  const checkpoints: string[] = [];
  let steps = 0;
  let stalled = false;
  let failure: string | null = null;

  /** 套用一個決策；被拒時記下失敗並回傳 false。 */
  const apply = (decision: Decision): boolean => {
    const outcome = applyCommand(state, decision.actor, decision.command, rng);
    if (!outcome.ok) {
      failure = `${decision.actor} ${decision.command.type} ${outcome.error.code}`;
      return false;
    }
    state = outcome.state;
    hasher.update(`${canonicalJson({ actor: decision.actor, command: decision.command })}\n`);
    steps += 1;
    if (steps % CHECKPOINT_INTERVAL === 0) checkpoints.push(hasher.digest());
    return true;
  };

  if (game.kind === 'game') {
    let idle = 0;
    while (steps < game.maxSteps && !state.result) {
      const decision = nextDecision(state, seats, clock.phases);
      if (!decision) {
        // 只有在等報價回應時才允許等待；時鐘最多前進三格就一定會撤回。
        if (idle < 3 && state.offers.some((offer) => offer.status === 'open')) {
          clock.tick(state);
          idle += 1;
          continue;
        }
        stalled = true;
        break;
      }
      idle = 0;
      if (!apply(decision)) break;
    }
  } else {
    for (let step = 0; step < game.maxSteps; step++) {
      // 全部座位都是 Bot 時，永遠有人該行動。
      const decision = nextDecision(state, seats);
      if (!decision) {
        stalled = true;
        break;
      }
      if (!apply(decision)) break;
    }
  }

  return {
    record: {
      id: game.id,
      profileId: profileFor(game.players),
      players: game.players,
      seed: game.seed,
      levels: [...game.levels],
      maxSteps: game.maxSteps,
      steps,
      seq: state.seq,
      winner: state.result?.playerId ?? null,
      reason: state.result?.reason ?? null,
      hash: hasher.digest(),
      checkpoints,
    },
    stalled,
    failure,
  };
}
