/**
 * BotModule 合約（策略 §4.1–§4.2；PL-1 定案）。依 profile.ruleModules 順序組合；
 * 合法性一律以 hints 為準（P2），模組的模型只用來估值與規劃。
 *
 * 回傳值語意（所有「回傳指令」的鉤子通用）：
 * - undefined：不歸我管，交給下一個模組，最後交給 base。
 * - null：歸我管，但這次不送指令。策略鉤子回 null 時，骨架改走保底；
 *   duty 回 null 時，保底不再送 base 預設（turn.roll／turn.end），交給 server 診斷。
 */

import type {
  CardKind,
  GameView,
  MoveRobberPending,
  ProfileDefinition,
  PublicModulePendingView,
  PublicPlayerView,
  Rng,
} from '@catan/rules';
import type { BoardModel } from '../board.ts';
import type { Cost, Economy, Plan } from '../economy.ts';
import type { LevelParams } from '../level.ts';
import type { BotCommand, BotContext, BotLevel } from '../types.ts';

export type { BotCommand } from '../types.ts';

/** 評分後的候選；挑選時依分數由高到低穩定排序，同分保留原順序。 */
export interface Scored<T> {
  readonly item: T;
  readonly score: number;
}

/** 與 rules 的 MoveRobberPending.cause 同步（view 的 cause 只是 string）。 */
export type RobberCause = MoveRobberPending['cause'];

/** 盜賊目標：hex index；null 是外框（SF 海盜離場）。 */
export type BanditTarget = number | null;

/** 單次決策共用的資料，由 turn.ts 的 Turn 實作。只增欄位，不改既有欄位。 */
export interface TurnContext {
  readonly view: GameView;
  readonly ctx: BotContext;
  /** 建立策略時的難度，params 由它決定；不一定等於 ctx.level。 */
  readonly level: BotLevel;
  readonly params: LevelParams;
  readonly me: PublicPlayerView;
  readonly model: BoardModel;
  /** seededRng(ctx.seed)。回傳候選的鉤子不應消耗它。 */
  readonly rng: Rng;
  /** 組合後的經濟（base 加上各模組 economy 鉤子），第一次讀取時計算。 */
  readonly economy: Economy;
  readonly pairedSecond: boolean;
  /** 本次決策的模組，依 profile.ruleModules 順序。 */
  readonly modules: readonly BotModule[];
  /** 空清單回 null，不消耗亂數；topK > 1 時消耗一次 rng.int(k)。 */
  pick<T>(candidates: readonly Scored<T>[]): T | null;
  /** 挑選方式與亂數消耗都與 pick 相同，但回傳候選本身；item 可能是 null 時用它。 */
  choose<T>(candidates: readonly Scored<T>[]): Scored<T> | null;
}

/** scoreExtras 的輸入；只增欄位。 */
export interface PlanInput {
  readonly model: BoardModel;
  readonly level: BotLevel;
  /** base 經濟：已合併各模組的 costs 與 piecesLeft；plans 只有 base 計畫，而且已排序。 */
  readonly base: Economy;
}

export interface BotEconomyHooks {
  // ---- 0.4.1 實作 ----
  /** 具名成本，合併進 Economy.costs，例如 { ship: SHIP_COST }；不得使用 base 的四個鍵。 */
  costs?(model: BoardModel): Readonly<Record<string, Cost>>;
  /** 剩餘棋子，合併進 Economy.left，例如 { ships: 12 }；可覆寫 base 的鍵；先出現的模組優先。 */
  piecesLeft?(model: BoardModel): Readonly<Record<string, number>>;
  /** 模組計畫；kind 必須是 `<module id>.<名稱>`。不得呼叫 economyOf。 */
  scoreExtras?(input: PlanInput): readonly Plan[];

  // ---- 只保留型別，骨架不呼叫。尚無實作者，簽章由第一個實作的版本定稿 ----
  awards?(model: BoardModel): { readonly longestRoad?: boolean }; // 0.4.4
  cardKinds?(model: BoardModel): readonly CardKind[]; // 0.4.2
  rates?(model: BoardModel): Readonly<Partial<Record<CardKind, number>>>; // 0.4.2
  weights?(model: BoardModel): Readonly<Partial<Record<CardKind, number>>>; // 0.4.2
  hexYield?(model: BoardModel, hex: number, vertex: number): Readonly<Partial<Record<CardKind, number>>> | undefined; // 0.4.2
  vertexBlocker?(model: BoardModel, vertex: number): string | null; // 0.4.2
  siteBlocked?(model: BoardModel, vertex: number): boolean; // 0.4.2
  routeEdge?(model: BoardModel, edge: number): boolean | undefined; // 延後（SF §11-6）
}

/** 只保留型別（0.4.4、0.4.5）。 */
export interface BotTradeHooks {
  goods?(view: GameView, playerId: string): Readonly<Record<string, number>>; // 公開持有量
  goodValue?(turn: TurnContext, good: string, amount: number): number | null; // null = 無法估值 → 拒絕
}

export interface BotModule {
  /** 與 rules module id 相同。 */
  readonly id: string;
  /** 只影響 botsCanPlay，不影響 botModulesOf；省略視為 true。 */
  supports?(profile: ProfileDefinition): boolean;

  // ---- 0.4.1 實作 ----
  duty?(view: GameView, selfId: string): BotCommand | null | undefined;
  answerFrame?(turn: TurnContext, frame: PublicModulePendingView): BotCommand | null | undefined;
  setup?(turn: TurnContext): BotCommand | null | undefined;
  preroll?(turn: TurnContext): readonly Scored<BotCommand>[];
  actions?(turn: TurnContext): readonly Scored<BotCommand>[];
  freeRouteCandidates?(turn: TurnContext): readonly Scored<BotCommand>[];
  banditCandidates?(turn: TurnContext, cause: RobberCause): readonly Scored<BanditTarget>[];
  planStep?(turn: TurnContext, plan: Plan): BotCommand | null | undefined;
  readonly economy?: BotEconomyHooks;
  readonly pacing?: Readonly<Record<string, number>>;
  readonly maxCommandsPerWindow?: number;
  readonly responseCommands?: readonly string[];

  // ---- 只保留型別，骨架不呼叫 ----
  phase?(turn: TurnContext): BotCommand | null | undefined; // 0.4.5
  endWindow?(turn: TurnContext): BotCommand | null | undefined; // 0.4.5
  robberTargets?(view: GameView, selfId: string, targets: readonly BanditTarget[]): readonly BanditTarget[]; // 0.4.3
  rescore?(turn: TurnContext, command: BotCommand): number; // 0.4.3
  readonly trade?: BotTradeHooks; // 0.4.4、0.4.5
}
