/**
 * BotModule 合約（策略 §4.1–§4.2；PL-1 定案）。依 profile.ruleModules 順序組合；
 * 合法性一律以 hints 為準（P2），模組的模型只用來估值與規劃。
 *
 * 回傳值語意（所有「回傳指令」的鉤子通用）：
 * - undefined：不歸我管，交給下一個模組，最後交給 base。
 * - null：歸我管，但這次不送指令。策略鉤子回 null 時，骨架改走保底；
 *   duty 回 null 時，保底不再送 base 預設（turn.roll／turn.end），交給 server 診斷。
 * - 例外：planStep 回 null 或 undefined，骨架都會繼續處理銀行交易與其他計畫，不走保底；
 *   兩者的差別只在於要不要繼續詢問下一個模組。
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

  // ---- 0.4.2 實作（C&K；CK-B1 接上骨架，模組清單為空時 base 不變）----
  /**
   * 這個模組讓手牌多出的卡種（C&K：paper、cloth、coin）；不得含 Resource。組合：`RESOURCES` 在前，
   * 依模組順序附加、去重，得到 `Economy.kinds`。手牌、成本、ETA、估值、棄牌與規則 9 都依這份清單；
   * 清單外的卡種一律視為無法估值。
   */
  cardKinds?(model: BoardModel): readonly CardKind[];
  /**
   * 給銀行一張該卡種要付的張數，只回答自己 `cardKinds` 內的卡種（C&K：`hints.modules.citiesKnights.commodityRates`）。
   * 資源一律讀 `hints.bankRates`（已含模組調整），模組回傳的資源鍵忽略。缺漏的卡種視為不能與銀行交易。
   */
  rates?(model: BoardModel): Readonly<Partial<Record<CardKind, number>>>;
  /**
   * 卡種的估值權重，與 `resourceWeights` 同尺度；只回答自己 `cardKinds` 內的卡種，資源權重維持 base。
   * 先出現的模組優先；缺漏的模組卡種權重為 0。
   */
  weights?(model: BoardModel): Readonly<Partial<Record<CardKind, number>>>;
  /**
   * `vertex` 上的一座建築（`city` 可以是假設，例如城市計畫）在 `hex` 擲中時拿到的張數。依模組順序詢問，第一個
   * 非 undefined 勝出；都沒有回答時用 base：`hexResource` 的資源 `city ? 2 : 1` 張（沙漠、海、金礦為空）。
   * 模組只回答自己定義產出的地形，其餘回 undefined（金礦仍由 `goldPipsAt` 計價）。
   */
  hexYield?(
    model: BoardModel,
    hex: number,
    vertex: number,
    city: boolean,
  ): Readonly<Partial<Record<CardKind, number>>> | undefined;
  /**
   * 擋住 `vertex` 的非建築棋子的擁有者（C&K：騎士），沒有則回 null；第一個非 null 勝出。骨架在道路 BFS
   * （`searchRoads`）與路線長度（`routeLength`）把「擁有者不是自己」當成對手建築，自己的不擋。
   */
  vertexBlocker?(model: BoardModel, vertex: number): string | null;
  /** `vertex` 不能蓋建築（C&K：上面有任何騎士，含自己的）；任一模組為 true 就算（OR）。骨架在 `isFreeSpot` 使用。 */
  siteBlocked?(model: BoardModel, vertex: number): boolean;
  /**
   * 擲出 7 時超過幾張要棄牌，與 rules 的 `discardLimit` 相同的折疊：依模組順序，每個模組拿到前一個的結果
   * `base`（第一個是 7）並回傳新的上限（C&K：`base + 2 ×` 自己的城牆數，城牆數讀自己的公開 view）。結果放進
   * `Economy.handLimit`；`handRelief` 等「手牌太多」的判斷都讀它，不再寫死 7。回傳非有限數字視為沒有調整。
   */
  discardLimit?(model: BoardModel, base: number): number;

  // ---- 只保留型別，骨架不呼叫。尚無實作者，簽章由第一個實作的版本定稿 ----
  awards?(model: BoardModel): { readonly longestRoad?: boolean }; // 0.4.4
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
  /**
   * 保底義務。模組 frame 時，保底只在自己是 `responders[0]` 時才詢問（P3）。不得 throw：
   * server 的保底呼叫不在 try 裡（packages/server/src/bot-driver.ts:332），例外會讓這一局不斷重試。
   */
  duty?(view: GameView, selfId: string): BotCommand | null | undefined;
  /**
   * 回應模組 frame。骨架只以 `responders.includes(self)` 過濾；依序作答的 frame（例如 SF 的
   * gold）由模組自行檢查 `responders[0] === self`。
   */
  answerFrame?(turn: TurnContext, frame: PublicModulePendingView): BotCommand | null | undefined;
  setup?(turn: TurnContext): BotCommand | null | undefined;
  preroll?(turn: TurnContext): readonly Scored<BotCommand>[];
  actions?(turn: TurnContext): readonly Scored<BotCommand>[];
  freeRouteCandidates?(turn: TurnContext): readonly Scored<BotCommand>[];
  banditCandidates?(turn: TurnContext, cause: RobberCause): readonly Scored<BanditTarget>[];
  /** 模組計畫的下一步。回 null 或 undefined，骨架都會繼續處理銀行交易與其他計畫（不走保底）；差別只在於是否繼續詢問下一個模組。 */
  planStep?(turn: TurnContext, plan: Plan): BotCommand | null | undefined;
  readonly economy?: BotEconomyHooks;
  readonly pacing?: Readonly<Record<string, number>>;
  readonly maxCommandsPerWindow?: number;
  readonly responseCommands?: readonly string[];

  // ---- 0.4.3 實作（SF+CK；SFCK-P 接上骨架）----
  /**
   * 盜賊目標的 fold（策略 §4.2；比照 rules 的 `legalRobberHexes`，`packages/rules/src/engine.ts:1495-1505`）。依
   * `profile.ruleModules` 順序，每個模組收到目前的集合並回傳下一組（可以縮小、替換或擴大，例如 T&B 的 FR 換成沙漠）。
   * 初值是「盜賊預設」：陸地且不是 `view.board.robber` 的 hex（index 遞增），接著是海且不是 `view.board.pirate`
   * 的 hex，`view.board.pirate !== null` 時最後加上 `null`（外框）。base 沒有海格、海盜為 null，所以初值就是 base
   * 的強盜目標。結果是這次 `pending.moveRobber`（以及打出騎士卡）的完整合法集合：保底取第一項；策略以它過濾 base 的
   * 強盜候選與各模組的 `banditCandidates`，過濾後沒有候選時直接取第一項（不消耗亂數）。fold 之後不再另外排除
   * `view.board.robber`。保底路徑也會呼叫它：不得 throw、不得消耗亂數，只讀 view 與 hints。
   */
  robberTargets?(view: GameView, selfId: string, targets: readonly BanditTarget[]): readonly BanditTarget[];
  /**
   * 行動候選的分數差值（勝利分當量）。骨架在 `buildDecision` 合併 base 的立即建造與各模組的 `actions`、去重之後，
   * 把所有模組對同一個候選的差值相加，再挑選；沒有任何模組提供時完全不呼叫。只調整分數，不得用來表達合法性或排除
   * 候選（合法性只看 hints，P2）；不相干的指令回 0。不得消耗亂數。非有限值視為 0；要壓低分數請回有限的負值，
   * 不得以 −∞ 表達排除（R-SC9）。（SFCK-2 起，D2）C&K 的 `recruitSite` 也以它為各招募點排序（同分保留既有順序）。
   */
  rescore?(turn: TurnContext, command: BotCommand): number;

  // ---- 只保留型別，骨架不呼叫 ----
  phase?(turn: TurnContext): BotCommand | null | undefined; // 0.4.5
  endWindow?(turn: TurnContext): BotCommand | null | undefined; // 0.4.5
  readonly trade?: BotTradeHooks; // 0.4.4、0.4.5
}
