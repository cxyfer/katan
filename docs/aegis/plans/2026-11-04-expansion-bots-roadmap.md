# 電腦對手支援擴充包：整體策略與版本計畫（v0.4.1–v0.4.5）

日期：2026-11-04；2026-11-06 開工前依程式現況核對並刷新（§12），同日併入 PL-1 的介面定案（§13）。狀態：**使用者已於 2026-11-05 確認 §10 的 D1–D4、D7–D11 採用建議；D5、D6 未列入，留待相關版本開工前決定。**

本文件是 Aegis 工作紀錄，不是權威的執行期決策；權威需求仍以 `docs/SPEC.md` §4.9 為準。每個版本開放 profile 時，要同步修訂 SPEC、FIDELITY 與 bot 規格。

前置閱讀：

- `docs/SPEC.md` §4.9
- `docs/aegis/specs/2026-11-01-bot-opponents.md`（以下簡稱「bot 規格」，含不變式 I1–I9 與 §5 合約）
- `docs/aegis/plans/2026-11-01-expansions-roadmap.md`
- `RELEASING.md`

證據來源：2026-11-04 的第一輪唯讀研究，基準為 `a200840 🔖 release: v0.4.0`。研究分為平台、Seafarers、Cities & Knights、Traders & Barbarians、Explorers & Pirates 與 SF+CK 組合，各一份報告，原樣收錄在 `docs/aegis/work/2026-11-04-bots-*-research.md`；探查腳本與輸出沒有提交。研究之後的修正以本文件與各擴充計畫為準（§11）。計畫定稿後另做了一次獨立事實核對，見 `docs/aegis/work/2026-11-04-bots-plans-review.md`。

研究期間機器與其他 agent 共用，load average 在 1 到 105 之間，因此**耗時只是參考值**。步數、回合數、終局率與拒絕數是決定性的，不受負載影響。

## 0. 摘要

1. **一版一個擴充包。** 建議順序如下表。全部完成後，19 個已啟用的擴充 profile 都能加入電腦對手。

   | 版本 | 擴充包 | profile 數 |
   |---|---|---|
   | 0.4.1 | Seafarers（含共用平台） | 2 |
   | 0.4.2 | Cities & Knights | 2 |
   | 0.4.3 | SF+CK 組合 | 2 |
   | 0.4.4 | Traders & Barbarians | 8 |
   | 0.4.5 | Explorers & Pirates | 5 |

2. **現況：bots 只會玩 base**（`packages/bots/src/support.ts:12` 的 `BOT_RULE_MODULES = []`）。未修改的 base 策略在各擴充的表現如下（細節見 §2.2）：
   - SF：大多能打完，但從不造船；主島蓋滿時會打不完。
   - C&K、SF+CK：卡在含 commodity 的棄牌與 pillage。
   - T&B：多數劇本卡在劇本 frame。
   - E&P：卡在 setup 與海盜 frame。
3. **伺服器、協定與前端幾乎不用改。** 指令路徑已經接受模組指令，`ProfileView.botSeats` 也已經逐 profile 計算。主要工作集中在 `@catan/bots`。
4. **架構採 BotModule 外掛。**
   - 比照 rules 的模組化：每個 rules module 對應一個 `packages/bots/src/modules/<id>/`，依 `profile.ruleModules` 的順序組合。
   - 合法性一律以 hints 為準；Bot 自己的模型只用來估值與規劃。
5. **開放粒度細到 profile。** 判定條件是「模組已支援」加上 `supports(profile)`，讓 T&B 可以依劇本、E&P 可以依任務開放。未知的 part 一律不開放。
6. **品質分三層**（§3.1）。前兩層是發布閘門，第三層只報告：
   - Q1：合法且能終局。
   - Q2：確實用到擴充機制。
   - Q3：強度，由 bench 量測並附在發布 PR。
7. **不改 rules 的規則行為。**
   - I3 改寫為「規則行為不變」，只允許新增型別與常數匯出。
   - 唯一例外是 E&P 的擱淺死結。這是真人也會遇到的規則缺陷，因此另開 rules 修正（#97）並升 `ep-2025.2`，不併進 Bot 工作。
8. **平台工作分兩階段落地。**
   - 合約、組合骨架、測試基礎建設與伺服器掛鉤在 0.4.1 一次做完。
   - 各擴充特有的能力延到第一個需要它的版本：海路模型隨 SF、commodity 經濟隨 C&K、goods 交易隨 T&B、子階段接管隨 E&P。

## 1. 目標、範圍與非目標

### 1.1 目標

- 所有已啟用的擴充 profile 都能加入 `easy` 與 `standard` 電腦對手，並涵蓋該 profile 支援的全部人數。
- 每個 0.4.x 只放出一個擴充包的支援。每一版都能獨立發布：發布時已開放的 profile 必須全部通過 Q1 與 Q2。
- 維持 bot 規格的不變式 I1–I9；I3 依 §3 的 P8 改寫。

### 1.2 範圍（19 個 profile）

| 擴充包 | profile | 人數 | `ruleModules` | 規則版本 |
|---|---|---|---|---|
| Seafarers | `sf-new-shores-2025`、`sf-new-shores-paired-2025` | 3–4／5–6 | `seafarers` | `sf-2025.2` |
| Cities & Knights | `ck-2025`、`ck-paired-2025` | 3–4／5–6 | `citiesKnights` | `ck-2025.1` |
| SF+CK | `sf-ck-new-shores-2025`、`sf-ck-new-shores-paired-2025` | 3–4／5–6 | `seafarersCitiesKnights`、`seafarers`、`citiesKnights` | `sf-ck-2025.1` |
| Traders & Barbarians | `tb-friendly-robber-2025`、`tb-harbors-2025`、`tb-friendly-robber-harbors-2025`、`tb-fishing-2025`、`tb-rivers-2025`、`tb-merchant-trains-2025`、`tb-barbarian-attack-2025`、`tb-traders-barbarians-2025` | 3–4 | `tradersBarbarians` | `tb-2025.2` |
| Explorers & Pirates | `ep-land-ho-2025`、`ep-pirate-lairs-2025`、`ep-fish-2025`、`ep-spices-2025`、`ep-full-2025` | 3–4 | `explorersPirates` | `ep-2025.1` |

### 1.3 非目標

- 沿用 bot 規格 §1 的範圍外清單：`hard` 難度、Bot 聊天、斷線托管、反報價、從事件紀錄推算對手手牌。
- 4 個 `tb-event-cards*` profile：目前 `implemented: false`，日後另行規劃。在那之前，gating 必須擋下它們（§4.4）。
- 修改 rules 的規則行為、`GameState`、事件或錯誤碼。E&P 擱淺死結的修正另案處理（#97，§9 R7）。
- 為 Bot 新增 hints 欄位。各研究都確認，判斷合法性所需的資訊已能從 view 與 hints 推出。選配的 hints（例如 E&P 的 `ships[].reach`）要另案決定。
- 協定與前端邏輯的修改。前端只改一句大廳文案（§4.4）。

## 2. 現況（v0.4.0）

### 2.1 已經就緒的部分

| 層 | 現況 | 位置 |
|---|---|---|
| 協定 | `CommandRequest.command` 是開放型別 | `packages/protocol/src/index.ts:299-303` |
| rules | `applyCommand` 接受 `Command \| ModuleCommand` | `packages/rules/src/engine.ts:669-673` |
| 伺服器 | gating 只有 `botsSupported(profile)` 一個入口 | `packages/server/src/bot-seats.ts:45-51` |
| 伺服器 API | 已逐 profile 輸出 `botSeats` | `packages/server/src/http.ts:288` |
| 前端 | 已讀取 `profile.botSeats` | `packages/web/src/state/bots.ts:18-20` |

### 2.2 未修改的 base 策略直接玩擴充 profile

依 BotDriver 語意實測：策略失敗時改用保底。

| 擴充包 | 結果 | 主因 |
|---|---|---|
| SF | 0 次拒絕，但**完全沒有造船**。前兩批實測全部終局（20/20 與 24/24）；依 B-GAME 方式重跑（standard／easy 混座，每個人數 10 個種子）時，3 人與 6 人各有 1 局到 8000 步仍無勝者 | 只在主島發展；主島沒有金礦，從不觸發 gold frame。主島蓋滿後（每人 4 座城市、沒有空位、發展卡用完，最高 13 分）就無法再得分 |
| C&K | 4 人 10 局：8 局卡在 `citiesKnights.pillage`，2 局卡在棄牌 | 模組 frame 回 null；手牌只展開 5 種資源，含 commodity 的棄牌張數錯誤（`E_INVALID_DISCARD_COUNT`） |
| SF+CK | 卡在含 commodity 的棄牌與 `citiesKnights.pillage` | 同 C&K |
| T&B | Harbors、Rivers 會終局；FR 與 FR+H 第一次擲出 7 就被拒，之後無限重試；Fishing、Trains、BA、Traders 停在各自的 frame | 強盜目標沒讀 `robberHexes`；模組 frame 回 null |
| E&P | 變動式開局在第 0 步停住；擲出 7 後停在海盜 frame；Land Ho! 跑 3000–4000 步（900–1270 回合）仍沒有勝者 | base setup 被 veto；模組 frame 回 null；從不使用 E&P 指令 |

### 2.3 共通根因

- **G-A：模組 frame 會讓整桌無聲停住。**
  - fallback 與 heuristic 遇到模組 frame 一律回 null（`packages/bots/src/fallback.ts:41-43`、`packages/bots/src/heuristic.ts:162-164`）。
  - 此時 BotDriver 不排重試（`packages/server/src/bot-driver.ts:330-345`），整桌永久停住，違反 I9。
  - E&P 的擱淺也屬於這一類：`canEndTurn` 為 false 時，保底直接回 null（`packages/bots/src/fallback.ts:77-78`），不會無限重試。
- **G-B：保底被拒後會無限重試。** BotDriver 每 30 秒退避重試一次（`packages/server/src/bot-driver.ts:413-423`），所以只要保底寫錯，就會一直重試下去。
- **G-C：型別只容得下 base 指令。** `BotPolicy.decide` 只能回傳 base 的 `Command`（`packages/bots/src/types.ts:39`）。
- **G-D：盤面、經濟與交易模型只認識 base。** 平台研究列為 A1–A28，主要包括：
  - 手牌只有 5 種資源。
  - 道路 BFS 不分陸海。
  - 城市產出寫死。
  - 計畫只有 4 種。
  - 報價只算資源，不算 goods。
- **G-E：測試只涵蓋 base。** 平台研究列為 T1–T13：
  - harness、守恆常數、合約檢查與 B-FAIR 擾動都寫死 base。
  - server 測試以 `[...expansions, ...variants]` 推算支援，與 `ruleModules` 不一致（`packages/server/test/bots.test.ts:259-261`）。

## 3. 共同原則

| # | 原則 | 落實方式 |
|---|---|---|
| P1 | 公平：只讀自己座位的投影（I2） | 各模組依自己的隱藏資訊擴充 B-FAIR 擾動，例如 C&K 的進度卡手牌與牌庫、T&B 的魚 token、牌庫與貨物堆 |
| P2 | 合法性以 hints 為準 | 送出前一律以 `hints.legal*`、`hints.modules[id]` 過濾。hints 沒檢查的費用、棋子存量與銀行存量由 Bot 自行檢查（合約規則 5）。Bot 的模型只用來估值與規劃 |
| P3 | 永不卡死（I9） | 每個模組 frame 與強制動作都要有保底，且只取 hints 的第一個合法選項。依序 frame 以 `responders[0] === self` 判斷資格，同時 frame 以 `responders.includes(self)` 判斷；保底一律採保守的 `responders[0]`。BotDriver 補上「欠動作卻沒有動作」的診斷與重試（§4.7） |
| P4 | 決定性（I6），且不讀事件 | 策略不得讀 `view.events`：BotDriver 投影時帶最近 40 筆事件，測試 harness 不帶，讀了會讓兩邊結果不一致。BFS、Dijkstra、子集枚舉等搜尋的 tie-break 要固定 |
| P5 | 模組化 | 每個 rules module 對應一個 BotModule，組合規則與 rules 一致（§4.2）。每一版只動自己的目錄，加上少數平台掛點 |
| P6 | 品質分三層 | 見 §3.1 |
| P7 | 逐 profile 開放 | profile 通過 Q1 與 Q2 才開放。以快照測試鎖住「Bot 可玩的 profile 清單」，確保每次開放都是刻意的變更 |
| P8 | 規則行為不變 | I3 改為：「`packages/rules` 的規則判定、`GameState`、事件與錯誤碼不變；允許只新增型別與常數的匯出，包括把模組內的投影與 hints 函式抽成具名函式。」新增 hints 欄位或修正規則一律另案處理，並依規則版本流程升級 |
| P9 | easy 也必須終局 | 難度只影響選擇品質，例如 topK、少用進階機制。實測顯示，SF 不造船、C&K 不改良城市、T&B 的 BA 與 Traders 不用劇本機制時，都可能無法終局（C&K 不防禦則會拉長尾端的局數），所以 easy 仍要保留最低限度的擴充行為 |

### 3.1 品質三層

| 層 | 內容 | 性質 |
|---|---|---|
| Q1 合法且終局 | 對每個開放的（profile, 人數），以 standard、easy 與保底混座對局，必須做到：0 次拒絕；在步數上限內分出勝者，且不觸發進度看門狗；沒有殘留 pending；每視窗每座位由策略送出的指令數不超過上限（≤；driver 在送滿上限之後才改走保底，`packages/server/src/bot-driver.ts:303-314`）；資源、commodity、gold 與棋子守恆；B-FAIR 通過；fuzz 不拋錯。另以全部座位只走保底的有界局驗證 0 拒絕與不卡死（§4.6） | 發布閘門 |
| Q2 用到機制 | 全部種子合計達到該模組的機制門檻，例如 SF 會造船並拿到小島加分、C&K 會招募騎士並守住蠻族、會打出進度卡、T&B 用到劇本指令、E&P 推進任務。數值由各擴充計畫訂定。sim 幾乎碰不到的機制（例如 SF+CK 的追擊海盜、金礦城市）改以固定盤面守門：在構造好的局面中，standard 必須使用該機制 | 發布閘門 |
| Q3 強度 | bench 量測：standard 對 easy、standard 對上一版策略（只有保底與 base 策略的 naive 版本）的勝率與公平份額；平均回合數，與 rules 腳本模擬對照；每個視窗的最大指令數；decide 的平均與最大耗時 | 不擋發布；發布 PR 附表，數據退步時要說明 |

## 4. 共用平台設計（0.4.1 交付）

### 4.1 BotModule 介面

```ts
// packages/bots/src/modules/types.ts（PL-1 定案，摘要；以原始檔為準）
export type BotCommand = Command | ModuleCommand;          // 定義在 src/types.ts
export interface Scored<T> { readonly item: T; readonly score: number }
export type RobberCause = MoveRobberPending['cause'];      // 'seven' | 'knight'
export type BanditTarget = number | null;                  // hex index；null 是外框（SF 海盜離場）

export interface TurnContext {                             // 單次決策共用；只增欄位
  readonly view: GameView;
  readonly ctx: BotContext;
  readonly level: BotLevel;                                // 建立策略時的難度，params 由它決定；不一定等於 ctx.level
  readonly params: LevelParams;
  readonly me: PublicPlayerView;
  readonly model: BoardModel;
  readonly rng: Rng;                                       // 回傳候選的鉤子不應消耗它
  readonly economy: Economy;                               // base 加上各模組 economy 鉤子，第一次讀取時計算
  readonly pairedSecond: boolean;
  readonly modules: readonly BotModule[];                  // 依 profile.ruleModules 順序
  pick<T>(candidates: readonly Scored<T>[]): T | null;     // 空清單回 null、不消耗亂數
  choose<T>(candidates: readonly Scored<T>[]): Scored<T> | null; // 同 pick，但回傳候選本身；item 可能是 null 時用它
}

export interface PlanInput {                               // scoreExtras 的輸入；只增欄位
  readonly model: BoardModel;
  readonly level: BotLevel;
  readonly base: Economy;                                  // 已合併 costs 與 piecesLeft；plans 只有 base 計畫
}

export interface BotEconomyHooks {
  costs?(model: BoardModel): Readonly<Record<string, Cost>>;        // 具名成本，例如 { ship }；不得用 base 的四個鍵
  piecesLeft?(model: BoardModel): Readonly<Record<string, number>>; // 例如 { ships: 12 }；可覆寫 base 的鍵，先出現的模組優先
  scoreExtras?(input: PlanInput): readonly Plan[];                  // kind 為 `<module id>.<名稱>`；不得呼叫 economyOf
  // 以下只保留型別，是暫定簽章，由第一個實作的版本定稿
  awards?(model: BoardModel): { readonly longestRoad?: boolean };                                   // 0.4.4
  cardKinds?(model: BoardModel): readonly CardKind[];                                                // 0.4.2
  rates?(model: BoardModel): Readonly<Partial<Record<CardKind, number>>>;                            // 0.4.2
  weights?(model: BoardModel): Readonly<Partial<Record<CardKind, number>>>;                          // 0.4.2
  hexYield?(model: BoardModel, hex: number, vertex: number): Readonly<Partial<Record<CardKind, number>>> | undefined; // 0.4.2
  vertexBlocker?(model: BoardModel, vertex: number): string | null;                                  // 0.4.2
  siteBlocked?(model: BoardModel, vertex: number): boolean;                                           // 0.4.2
  routeEdge?(model: BoardModel, edge: number): boolean | undefined;                                   // 延後（SF 計畫 §11-6）
}

export interface BotTradeHooks {                           // 只保留型別（0.4.4、0.4.5）
  goods?(view: GameView, playerId: string): Readonly<Record<string, number>>;  // 公開持有量
  goodValue?(turn: TurnContext, good: string, amount: number): number | null;  // null = 無法估值，拒絕
}

export interface BotModule {
  readonly id: string;                                     // 與 rules module id 相同
  supports?(profile: ProfileDefinition): boolean;          // T&B part、E&P mission；只影響 botsCanPlay，省略視為 true

  duty?(view: GameView, selfId: string): BotCommand | null | undefined;  // 保底（I9）；不得 throw
  answerFrame?(turn: TurnContext, frame: PublicModulePendingView): BotCommand | null | undefined;
  setup?(turn: TurnContext): BotCommand | null | undefined;
  preroll?(turn: TurnContext): readonly Scored<BotCommand>[];
  actions?(turn: TurnContext): readonly Scored<BotCommand>[];
  freeRouteCandidates?(turn: TurnContext): readonly Scored<BotCommand>[];
  banditCandidates?(turn: TurnContext, cause: RobberCause): readonly Scored<BanditTarget>[]; // 強盜以外的評分候選，例如 SF 海盜的海格與外框（null）；合法性由 robberTargets 決定
  planStep?(turn: TurnContext, plan: Plan): BotCommand | null | undefined; // 模組計畫種類的下一步，例如 SF 的島嶼聚落
  readonly economy?: BotEconomyHooks;
  readonly pacing?: Readonly<Record<string, number>>;
  readonly maxCommandsPerWindow?: number;
  readonly responseCommands?: readonly string[];

  // 以下只保留型別，骨架不呼叫
  phase?(turn: TurnContext): BotCommand | null | undefined;     // 0.4.5：接管子階段，例如 E&P movement
  endWindow?(turn: TurnContext): BotCommand | null | undefined; // 0.4.5：例如 ep.startMovement
  robberTargets?(view: GameView, selfId: string, targets: readonly BanditTarget[]): readonly BanditTarget[]; // 0.4.3：依模組順序 fold，結果是完整的合法盜賊目標；例如 T&B Friendly Robber、SF+CK 依 bandit 收窄
  rescore?(turn: TurnContext, command: BotCommand): number;     // 0.4.3：分數差值；只調整 actions 候選，不新增、不移除
  readonly trade?: BotTradeHooks;                                // 0.4.4、0.4.5
}
```

- **回傳值語意**（所有回傳指令的鉤子通用）：`undefined` 表示不歸我管，交給下一個模組，最後交給 base；`null` 表示歸我管，但這次不送指令。策略鉤子回 `null` 時，骨架改走保底；`duty` 回 `null` 時，保底不再送 base 預設（`turn.roll`／`turn.end`），交給 server 診斷。

- `heuristic.ts` 改成流程骨架，現有的 base 邏輯成為預設處理器。決策依序如下：
  1. 已有對局結果時，不動作。
  2. 有 pending：
     - 模組 frame：自己不在 `responders` 時不動作；否則依序詢問各模組的 `answerFrame`，都沒有回答時走保底。
     - base frame：沿用 base 的處理器，另有兩處併入模組。`moveRobber` 把 `banditCandidates` 接在 base 強盜候選之後一起挑選；`freeRoads` 在模組的 `freeRouteCandidates` 非空時改用它們。回 null 時走保底。
  3. setup：先依序詢問模組的 `setup`，都沒有回答時用 base 的 setup。
  4. 非行動者：回應報價。
  5. preroll：base 先決定是否打騎士；不打時才從模組的 `preroll` 候選中挑選。
  6. action：
     - 先看是否有模組以 `phase` 接管（0.4.5）。
     - 否則依序處理報價、發展卡與建造。建造時，base 的立即得分建造與模組的 `actions` 一起評分；接著走計畫的下一步，模組計畫種類交給 `planStep`。之後是主動開價與換牌，最後走 `endWindow`（0.4.5）或保底的 `turn.end`。
- `fallbackPolicy` 的順序：
  1. pending 與 setup：先跑 base 的處理器（pending 用 `pendingDuty`，套用 `cardKinds` 與 `robberTargets`；setup 取 hints 的第一項），回 null 時才詢問模組的 `duty`。模組 frame 中，自己不是 `responders[0]` 時不動作，也不詢問 `duty`（P3）。例如 SF 的 setup road 只剩船位時，由模組送 `setup.placeShip`（SF 計畫 F5）。
  2. preroll 與 action：先詢問模組的 `duty`，再送 `turn.roll` 或 `turn.end`。
- `fallbackPolicy` 的模組清單預設依 `view.profileId` 推導，所以 server 直接呼叫的 `fallbackPolicy` 也會用到已註冊模組的 `duty`。查不到 profile 時用空清單，不 throw，因為 server 的保底呼叫不在 try 裡（`packages/server/src/bot-driver.ts:332`）。同樣的理由，模組的 `duty` 不得 throw。
- 介面先保留全部鉤子的位置，0.4.1 只實作 SF 用到的鉤子，其餘到第一個用到它的版本才實作（§4.9）：
  - **0.4.1 實作組合**：`supports`、`duty`、`answerFrame`、`setup`、`preroll`、`actions`、`freeRouteCandidates`、`banditCandidates`、`planStep`、`economy.costs`、`economy.piecesLeft`、`economy.scoreExtras`、`pacing`、`maxCommandsPerWindow`、`responseCommands`。
  - **只保留型別，骨架不呼叫**：`phase`、`endWindow`（0.4.5）；`robberTargets` fold、`rescore`（0.4.3）；`economy.awards`（0.4.4）；`economy.cardKinds`、`rates`、`weights`、`hexYield`、`vertexBlocker`、`siteBlocked`（0.4.2、0.4.3）；`economy.routeEdge`（延後，SF 計畫 §11-6）；`trade.goods`、`trade.goodValue`（0.4.4、0.4.5）。`support.test` 斷言已註冊的模組沒有定義這些鉤子，以免誤以為已經生效。

### 4.2 組合規則

`botModulesOf(profile)` 依 `profile.ruleModules` 的順序取出 `BOT_MODULES.get(id)`，順序與 rules 一致。`BOT_MODULES` 是 `Map`，避免 `constructor` 這類原型鍵被當成已註冊的模組。以 SF+CK 為例，順序是 `seafarersCitiesKnights` → `seafarers` → `citiesKnights`，組合模組排在第一位，因此可以先攔截。未註冊的模組直接略過，例如 `packages/bots/test/ck-road-building.test.ts` 以 C&K 盤面跑 base 策略。這裡也不檢查 `supports`：gating 只由 `botsCanPlay` 判定，所以 SF-3 能在 SF-4 翻轉 gating 之前跑 B-GAME。

| 鉤子 | 組合方式 |
|---|---|
| `answerFrame`、`duty`、`setup`、`planStep`、`phase`、`endWindow` | 依序詢問，第一個回傳非 `undefined` 的模組勝出。若兩個以上的部件模組都會回答同一個 setup 階段（例如 SF+CK 的第 2 輪城市），由組合模組攔截並合成；它可以 import 部件匯出的純評分函式，不另設鉤子 |
| `preroll` | base 先決定是否打騎士（`knightDecision`）；不打時才從各模組串接的候選中挑一個，沒有候選就走保底 |
| `actions` | 與 base 的立即得分建造（`buildDecision` 的第一步）串接後一起挑選，模組候選接在 base 之後，維持穩定排序。分數尺度與 base 的立即建造相同，都是勝利分當量：base 城市與聚落為 `1 + PIP_VALUE × 點數`。非空時就會搶在計畫步驟之前，所以只放「現在就該做」的行動；有成本的目標走 `scoreExtras` 加 `planStep` |
| `freeRouteCandidates` | 各模組的候選串接後非空時，取代 base 的選路（`freeRoadDecision`），所以模組要自行納入道路選項；為空時走 base。Road Building 的打出條件見 §4.10 合約 12 |
| `scoreExtras` | 模組計畫併入 base 計畫，以同一個比較式排序；分數尺度與 base 計畫相同，為「勝利分當量 ÷ (1 + eta)」。同分時排在 base 種類之後（`planOrder`），模組計畫之間依模組順序，再依模組內的順序 |
| `banditCandidates` | 接在 base 強盜候選（`robberCandidates`）之後一起挑選（`banditChoice`）。分數尺度與強盜候選相同：點數 × 城市倍率 × 領先係數，加上偷牌加分，不是勝利分當量。挑選結果要能區分「沒有候選」（`null`）與「選中外框」（`{ target: null }`） |
| `robberTargets` | 依 `profile.ruleModules` 的順序 fold，與 rules 的 `legalRobberHexes` 相同（`packages/rules/src/engine.ts:1462-1471`），元素為 `number \| null`。初值是「盜賊預設」：陸地且不是目前強盜所在格；海格且不是目前海盜所在格；海盜在場時再加上 `null`（外框）。base 沒有海格、海盜為 null，所以初值與 rules 相同。每個模組收到目前候選並回傳下一組，可以縮小、替換或擴大，例如 FR 在沒有合法格時回傳沙漠格，即使強盜就在沙漠（`packages/rules/src/modules/tradersBarbarians/variants/friendlyRobber.ts:34-40`），SF+CK 依 `bandit` hint 收窄。結果是本次 `pending.moveRobber` 的完整合法集合：保底取第一項；base 的強盜候選與 `banditCandidates` 先以它過濾再評分，過濾後沒有候選時取第一項。`banditCandidates` 負責評分，fold 負責合法性 |
| `rescore` | 各模組的差值相加；只調整分數，不新增、不移除候選，也不得當作合法性過濾 |
| `vertexBlocker`、`siteBlocked` | 任一模組阻擋就算阻擋（OR）；`vertexBlocker` 的回傳值取第一個非 null |
| `hexYield` | 逐 hex 依序詢問，第一個非 `undefined` 者勝；都沒有回答時用 base。模組只對自己定義產出的地形回值，例如 C&K 只回答森林、牧場、山脈上的城市，金礦交給 SF |
| `awards` | 任一模組設為 false 就關閉；例如 `longestRoad: false` 時不再規劃最長道路（T&B 的 Traders、E&P） |
| `costs`、`piecesLeft`、`cardKinds`、`pacing`、`responseCommands` | 合併；重複的鍵以先出現的模組為準。`costs` 不得覆寫 base 的四個鍵，因為 base 計畫直接讀 `COSTS`；`piecesLeft` 可以覆寫，例如 E&P 的聚落上限 |
| `maxCommandsPerWindow` | 取最大值 |

### 4.3 型別

- **回傳型別**：`BotPolicy.decide` 改為回傳 `BotCommand | null`，`packages/server/src/bot-driver.ts:74` 的 `Decision.command` 同步修改。協定不必改。
  - 這項修改會讓 `bot-driver.ts`（`:313`、`:428` 等）、`packages/server/test/bots.test.ts`、`packages/bots/test/harness.ts` 與 `policy.test.ts` 的型別檢查失敗。因此由 PL-1 一併修改這些型別註記，而且只動型別，讓 release 分支在 PL-3 合併前也能通過 typecheck。
  - `ModuleCommand` 帶索引簽章（`packages/rules/src/modules/types.ts:33-36`），以 `type` 收窄後，其他欄位都是 `unknown`。
- **view 與 hints 型別**：由 `@catan/rules` 匯出各模組的型別，例如 `SeafarersView`、`SeafarersHints`，再匯出 `ModuleViewMap` 型別。accessor `moduleView(view, id)` 放在 bots，讓 rules 只新增型別與常數。
  - 好處：rules 改了形狀時，bots 與 web 會在編譯期失敗，不必等到 B-GAME 在執行期才發現。
  - 目前只有 E&P 已經匯出（`packages/rules/src/index.ts:12`）。其他模組要先把投影與 hints 函式抽成具名函式，這屬於 P8 允許的範圍。
  - 每一版只匯出該版需要的型別與常數，例如 SF 的 `SHIP_COST`、C&K 的成本與商品常數、E&P 的 `CARGO_SIZE`。
  - web 的本地型別可以逐步改用這份，不必在同一版完成。
- **指令形狀**：由 bots 內的小型建構函式宣告，例如 `shipBuild(edge)`。形狀若有漂移，由 B-GAME 的 0 拒絕檢查抓出。

### 4.4 開放判定（gating）

```ts
// packages/bots/src/support.ts（PL-1 定案）
export function botsCanPlay(profile: ProfileDefinition): boolean {
  return profile.ruleModules.every((id) => {
    const module = BOT_MODULES.get(id);
    return module !== undefined && (module.supports?.(profile) ?? true);
  });
}
```

- **part 與 mission 判定**：
  - SF 只開放 `scenario === 'new-shores'`，日後新增的 SF 劇本不會被自動放行。
  - T&B 以原始的 `scenario` 與 `variants` 對應 part。不能用 `activeParts`：它會略過未知 variant，`tb-event-cards*` 會被當成只有 FR 而放行。
  - E&P 以 `epScenario(profile.scenario)` 的任務，加上海盜部件（`pirates`）判定；scenario 未知或人數超過 4 時回 false（CN3086 的 5–6 人尚未實作）。
  - 未知的 part 或 mission 一律回 false，避免 `tb-event-cards*` 日後實作時被自動放行。
- **快照測試**：`support.test` 加上「Bot 可玩的 profile id 清單」快照。
- **開發期間的發布旗標**：模組可以先註冊，但在該版的 gating PR 之前，`supports` 一律回 false，例如 SF 的 `SUPPORTED_SCENARIOS = []`。翻轉只發生在 gating PR。
- **`BOT_RULE_MODULES`**：PL-1 先保留這個匯出並標為 deprecated，值仍是 `[]`，`botsCanPlay` 不再讀它。PL-3 讓 server 測試改用 `botsCanPlay`。SF-4 刪除這個匯出，並更新引用它的文件與註解：`docs/API.md:142`、`docs/FIDELITY.md:65`、`packages/server/src/bot-seats.ts:46-48`、`packages/server/test/traders-barbarians.test.ts:67`。
- **伺服器**：`bot-seats.ts`、`rooms.ts`、`http.ts` 不必改，但要修三處測試：
  - `bots.test.ts:259-261` 的支援推算改用 `botsCanPlay(getProfile(id))`。
  - 「不支援」的範例改用含未知模組的 fixture profile（`bots.test.ts:279-291`）。`:266-277` 是 SF 的拒絕測試，由 SF-4 翻轉。
  - 每一版翻轉該擴充 server 測試中的 `botSeats: false` 與 `E_INVALID_BOT`（`packages/server/test/{cities-knights,seafarers-cities-knights,explorers-pirates,traders-barbarians}.test.ts`）。
- **SPEC 修訂**：SPEC §4.9 的 Rulesets 條文（`docs/SPEC.md:188`）改寫為下文。其中「Today that is …」一句每一版更新；R-BOT 驗收本來就是通用寫法，不必改。

  > **Rulesets:** bots play only profiles the built-in strategies support: every rules module the profile runs, and for a module made of independent parts (Traders & Barbarians scenarios and variants, Explorers & Pirates missions) every part the profile runs. Today that is …. The service refuses bot seats in any other profile and blocks start while one is seated, and the lobby says why in both languages. A profile joins the supported list only once the strategies issue the commands and answer the pending frames its modules produce in that profile, and bot-only games of it finish with a winner for every player count.

- **大廳文案**：第一個擴充開放時，修改 `lobby.bots.unsupported`（`packages/web/src/i18n/zh-Hant.ts:276`、`en.ts:279`），message id 不變。`packages/web/test/bots.test.tsx:175-195` 逐字斷言舊的 zh-Hant 文案，並以 `sf-new-shores-2025` 當作不支援的範例，所以要同步改成新文案，範例改用 `ck-2025`。
  - zh-Hant：「電腦對手尚未支援這個規則組合。」
  - en：「Bot opponents can't play this ruleset yet.」

### 4.5 合約修訂（bot 規格 §5）

| 條 | 修訂 |
|---|---|
| 規則 3 | 非行動者只在兩種情況回傳指令。第一，自己欠的待決效果：base 的棄牌，以及依 P3 判定自己有資格回應的模組 frame。第二，收件人包含自己、仍然 open、且自己尚未回應的報價 |
| 規則 4 | 行動者在 action 階段無事可做時，回傳結束行動窗口的指令：模組有 `endWindow` 就用它，否則用 `turn.end` |
| 規則 7 | 保底表由各模組擴充，內容寫在各擴充計畫的保底一節 |
| 新增規則 8 | 策略不得讀 `view.events`（P4） |
| 新增規則 9 | 報價包含 Bot 無法估值的卡種或 goods（`giveGoods`、`wantGoods`）時一律拒絕；對方要求的數量超過自己持有量，或提議者公開的 goods 付不起 `giveGoods` 時，也一律拒絕（引擎在同意時會檢查雙方，`packages/rules/src/engine.ts:1874`） |
| I3 | 依 P8 改寫 |

### 4.6 測試基礎建設

- **harness**
  - 改為 `newBotGame({ profileId, players, seed, setupMode? })`。`setupMode` 的預設：profile 允許 `variable` 時用它，否則取第一個模式。base 允許 `['fixed', 'variable']`（`packages/rules/src/profiles.ts:188`），現行 harness 用的是 `variable`（`packages/bots/test/harness.ts:36`）；若改取第一個模式，base 會變成 `fixed`，golden replay 也會失敗。
  - 守恆檢查改為「base 資源加上各模組的 `conservation`」。
- **測試矩陣**
  - `BOT_TEST_MATRIX = PROFILES.filter(p => p.enabled && botsCanPlay(p))` 乘上各自的 `playerCounts`。開放新 profile 時，B-GAME 會自動納入。
  - 各擴充的 family 測試檔明列自己的 profile，不依賴 `BOT_TEST_MATRIX`，所以在 gating 翻轉前就能跑 B-GAME。B-GAME、B-POLICY 與 Q2 計數共用同一批對局。
  - 通用矩陣跳過已由 family 測試檔涵蓋的 profile，避免重跑；另加守門測試，斷言 `BOT_TEST_MATRIX` 的每個 profile 至少被一個測試檔涵蓋。各 family 涵蓋哪些 profile，登記在 `packages/bots/test/families.ts`（PL-2 建立，各擴充的測試切片各加一筆）；守門測試放在 `packages/bots/test/matrix.test.ts`。
- **保底席**
  - 每個（profile, 人數）至少 1 個種子讓 1 席只走保底，其餘座位用策略。
  - 另跑「全部座位只走保底」的有界局：只要求 0 拒絕且每一步都有動作，不要求終局。保底從不建造，實測 T&B 的 BA 只走保底時 0/10 局終局。
- **模組測試工具**：每個模組在 `test/modules/<id>.ts` 提供：
  - `conservation`：守恆檢查。
  - `hideDifferently`：B-FAIR 擾動。
  - `perturb`：fuzz 擾動。
  - `responseCommands`：合約檢查。
  - `mechanics`：Q2 計數。逐步累計 `applyCommand` 回傳的 `events`；不要在終局讀 `state.log`，它只保留最後 200 筆（`packages/rules/src/engine.ts:123`、`:251`），長局會少算。
- **仿 BotDriver 模式**：策略回 null 時改用保底，並分開統計兩種情況：
  - 「策略閒置、但保底有動作」：B-GAME 判為失敗。
  - 「兩者都閒置」：判定為卡死。
  - 是否欠動作以 PL-1 的 `botOwesAction` 判斷；不欠動作時回 null 是正常的。
- **進度看門狗**：連續 N 回合（或 N 次擲骰）都沒有任何玩家的分數超過自己先前的最高分，就判為失敗。之所以用「創新高」而不是「有變化」，是因為 C&K 失去城市、最長道路易手都會讓分數下降。步數上限與 N 都依 profile 設定。
- **種子數**
  - base 維持現行閘門：每個人數 10 個種子。
  - 擴充 profile 在 `pnpm test` 與 `pnpm verify` 中預設 3 個種子；發布閘門使用 `BOTS_SEEDS=10`。
  - bot 規格 §10 的完成閘門跟著修訂。
- **執行時間**
  - timeout 統一為 120 s，並修正 `packages/bots/test/fallback.test.ts:45` 的 30 s（高負載下已經逾時過）。
  - 每個模組或 profile family 各自一個測試檔，讓 vitest 平行執行。
- **B-GUARD**：放寬為允許 `../` 匯入，但解析後的路徑必須仍在 `src/` 內（`packages/bots/test/guard.test.ts:20`）。
- **bench**：`bench/run.ts` 改以 `{ profileId, players, standard }` 參數化，CLI 加上 `--profile`。輸出新增：
  - 拒絕數；
  - fallback 次數；
  - 模組機制計數；
  - 每個視窗的最大指令數；
  - 與 rules 腳本模擬對照的回合數。
- **重用 rules 的測試輔助程式**：可以直接 import，例如 `rules/test/ck-checks.ts`、`tb-helpers.ts`。已有先例：`packages/bots/test/ck-road-building.test.ts:4`。

### 4.7 伺服器

1. **型別**：`Decision.command` 改為 `BotCommand`。
2. **節奏**：各模組匯出 `pacing`，由 `@catan/bots` 合併成 `BOT_PACING`；server 以 `{ ...THINK_MS, ...BOT_PACING }` 查表，之後每一版都不必再改 server。建議值如下，由各擴充計畫定稿：

   | 類別 | 指令（例） | 建議值 |
   |---|---|---|
   | 建造 | `build.ship`、`knight.recruit`、`tb.buildBridge`、`ep.build*` | 900 ms |
   | 移動與步進 | `ship.move`、`knight.move`、`tb.wagonStep`、`ep.moveShip` | 400–700 ms |
   | 打牌 | `progress.play`、`tb.playKnight` | 1100 ms |
   | frame 回應 | `gold.choose`、`tb.fishSwap`、`ep.placePirate` | 700–1200 ms |

3. **每視窗指令上限**：`MAX_BOT_COMMANDS_PER_WINDOW = 40`（`packages/server/src/bot-driver.ts:70`）改為依 profile 取各模組的 `maxCommandsPerWindow`。E&P 設約 80，其餘維持 40。依據：E&P 腳本中單一座位最多 30 個；C&K 6 人原型的 32 個是全桌合計，逐 Bot 最多 16 個、p95 ≤ 7；T&B 實測單一 Bot 每視窗最多 15 個，所以 40 已經足夠。Traders 的車隊移動排在同一個視窗內，一次理論上最多 14 個指令，加上 Swift Journey 是 28 個，因此策略在單一車隊 frame 內最多送 12 個；Q3 若 T&B 任一 profile 的最大值超過 30，就把它的上限調到 60。測試可經 `BotDriverDeps` 的可選欄位 `commandLimitFor` 注入上限。
4. **「欠動作卻沒有動作」的處理**：Bot 是 frame 的第一位 responder，或是 preroll／action 的行動者，但策略與保底都回 null 時：
   - 記一筆 warn，附上 pending kind、responders 與模組子階段。
   - 以 `retryMs` 退避重試，與指令被拒時走同一條路徑。

   這樣 G-A 就從「無聲停住」變成「看得到的重試」。真正的防線仍是 Q1 的仿 BotDriver 測試。

   是否欠動作以 PL-1 的 `botOwesAction` 判斷。測試以 fixture rules module 製造模組 frame：`registerRulesModule`（`packages/rules/src/modules/registry.ts:18`）加上 `registerFixtureProfile`，比照 `packages/server/test/bots.test.ts:281`。不要依賴「某個擴充缺 duty」，因為 SF-1 合併後，gold frame 已由 SF 的 `duty` 回答。
5. **server 測試**：比照 `packages/server/test/bots.test.ts` 的既有案例，每個新開放的擴充至少要有：
   - 一局經 HTTP 的完整對局；
   - 由保底接手模組 frame；
   - 多 responder frame 中真人與 Bot 並存（若該擴充的模組 frame 都只有一位 responder，例如 E&P 的海盜 frame，改用 7 之後的 base 棄牌 frame）；
   - 模組 frame 進行中重啟後恢復。

### 4.8 交易與 goods

- 0.4.1 先落實合約規則 9 的防護：無法估值的卡種或 goods 一律拒絕。SF 沒有 goods，所以這條純屬預防。
- 估值能力在第一個需要它的版本加上：
  - 0.4.2：C&K 的 commodity，同時修正「Bot 會同意自己付不起的報價」。
  - 0.4.4：T&B 的 gold，價值可由 `goldPerResource` 推得。
  - 0.4.5：E&P 的金幣。
- 各版 MVP 都不主動提出含 goods 的報價。

### 4.9 平台在各版的落點

| 版本 | 平台交付 |
|---|---|
| 0.4.1 | `BotCommand`；BotModule 介面與 registry；組合骨架（base 行為不變，以 golden replay 驗證）；可注入模組清單的策略工廠與 `botOwesAction`；`supports` gating 與快照；合約與 I3 修訂；harness 與模組測試工具；仿 BotDriver 模式與看門狗；種子數與 timeout；bench 參數化；server 的節奏、上限、診斷與型別；server 測試修正；規則 9 防護 |
| 0.4.2 | CardKind 手牌、成本與匯率（commodity）；economy 的 `rates`、`weights`、`hexYield`（城市的 commodity 產出）、`vertexBlocker` 與 `siteBlocked`（騎士阻擋）掛點 |
| 0.4.3 | 組合層；`robberTargets` fold（元素 `number \| null`，從 0.4.4 提前）；`rescore`；`sea.ts` 的 `blocker` 預設改為組合後的 `vertexBlocker`；`vertexBlocker`、`siteBlocked`、`hexYield` 與 setup 的組合規則；確認 `supports` 要求三個 BotModule 都存在 |
| 0.4.4 | goods 估值與規則 9 的提議者檢查；以 part 為單位的 `supports`；沿用 0.4.3 的 `robberTargets` fold（FR）；`economy.awards`（Traders 停用最長道路）；個人勝利分 `player.victoryTarget`（Fishing 的舊靴）；測試回合結束時排入的 frame（`onEndTurn` defer）與依序多 responder 的 frame |
| 0.4.5 | `phase` 與 `endWindow` 接管；依 profile 的指令上限；以 mission 為單位的 `supports`；E&P 沿用 0.4.4 的 `economy.awards` 關掉最長道路 |

### 4.10 0.4.1 的平台切片

| 切片 | 分支／worktree | 內容 | 檔案所有權 | 驗收 |
|---|---|---|---|---|
| PL-1 合約與骨架 | `feat/bots-platform-contract`／`.worktrees/bots-platform-contract/` | `modules/types.ts`、registry；`heuristic.ts` 與 `fallback.ts` 改為組合骨架；`BotCommand`；下方的合約清單；`support.ts` 的 `supports` 與快照（`BOT_RULE_MODULES` 保留為 deprecated，§4.4）；B-GUARD 放寬；規則 9；bot 規格的合約條文；golden replay | `packages/bots/src/**`；`packages/bots/test/{support,guard}.test.ts`；新增的 `packages/bots/test/golden-base.test.ts`、`packages/bots/test/golden/**` 與 `packages/bots/test/skeleton.test.ts`（組合骨架與規則 9 的單元測試，不依賴 harness）；只改型別註記：`packages/bots/test/harness.ts`、`packages/bots/test/policy.test.ts`、`packages/server/src/bot-driver.ts`、`packages/server/test/bots.test.ts`（§4.3）；bot 規格的 I3（`:42`）、§5 程式碼區塊（`:76-98`）、規則 3 與 4（`:104-105`），以及規則 7 表格之後新增的規則 8、9 | **golden replay**（見下）與改動前逐一相同，而且 PR 的第一個 commit 只新增 golden 檔、不動 `src`；`pnpm --filter @catan/bots exec vitest run`；`pnpm typecheck`（整個 repo）；`pnpm --filter @catan/server exec vitest run test/bots.test.ts`；server 的 diff 只有型別 |
| PL-2 測試基礎建設 | `feat/bots-platform-harness`／`.worktrees/bots-platform-harness/` | harness 泛化、`BOT_TEST_MATRIX` 與 family 測試檔的覆蓋守門測試、保底席與全保底有界局、模組測試工具、仿 BotDriver 模式、看門狗、`BOTS_SEEDS`、timeout、bench `--profile` | 明列如下：`packages/bots/test/harness.ts`；既有的 `packages/bots/test/{policy,fair,fuzz,fallback,decisions,ck-road-building}.test.ts`；新增的 `packages/bots/test/modules/types.ts`、family 註冊檔 `packages/bots/test/families.ts`、覆蓋守門測試 `packages/bots/test/matrix.test.ts`、看門狗與仿 BotDriver 的反例測試；`packages/bots/bench/**`；`RELEASING.md` 的 pre-flight（D7）；bot 規格 `:258` 的完成閘門。不得改 `test/golden*`、`test/sf-*`、`support.test.ts`、`guard.test.ts`；`viewFor(state, playerId)` 的簽章不變 | base 矩陣行為不變：新 harness 的仿 BotDriver 模式跑 base，步數、勝者與雜湊都與 golden 相同；看門狗與仿 BotDriver 模式都有反例測試，故意卡住的假模組必須被抓到；`BOTS_SEEDS=10 pnpm --filter @catan/bots exec vitest run`；`pnpm --filter @catan/bots bench 10` 與 `bench 10 --profile base-2025` |
| PL-3 伺服器 | `feat/bots-platform-server`／`.worktrees/bots-platform-server/` | 依 `BOT_PACING` 查表；依 profile 的上限（測試可經 `BotDriverDeps.commandLimitFor` 注入）；診斷與重試；修正 `bots.test.ts` 的支援推算與「不支援」範例。`Decision` 的型別已由 PL-1 修改 | `packages/server/src/bot-driver.ts`；`packages/server/test/bots.test.ts`（`:252-264` 改用 `botsCanPlay`、`:279-291` 改用含未知模組的 fixture、新增診斷與上限測試）；可選：`docs/OPERATIONS.md:41-42` 補上診斷的說明 | `pnpm --filter @catan/server exec vitest run`；`pnpm --filter @catan/server typecheck`；診斷路徑有測試 |

- **PL-1 對下游的合約**：下表列出具名匯出，簽章已在 PL-1 的介面審查定案（型別見 §4.1）。「現況」欄是 v0.4.0 的位置。

  | # | 匯出 | 現況 | 下游 |
  |---|---|---|---|
  | 1 | `BotCommand = Command \| ModuleCommand`；`BotPolicy.decide(view, ctx): BotCommand \| null` | `packages/bots/src/types.ts:39` | 全部 |
  | 2 | `Scored<T>`、`TurnContext`（view、ctx、level、params、me、model、rng、economy、pairedSecond、modules、`pick`、`choose`），以及給單元測試用的 `turnContext(view, ctx, level, modules?)`（`heuristic.ts`；省略 `modules` 時依 profile 推導） | `heuristic.ts:68-110`，未匯出 | SF-1、SF-2a、SF-2b |
  | 3 | `RobberCause = 'seven' \| 'knight'` | 只有 rules 的 `packages/rules/src/types.ts:217`；view 的 `cause` 是 `string` | SF-2b |
  | 4 | `BotModule`：§4.1 的全部鉤子位置；economy 鉤子採不遞迴的簽章：`scoreExtras(input: PlanInput): readonly Plan[]`，`PlanInput` 是 `{ model, level, base }`，之後只增欄位 | — | SF-*、PL-2（假模組） |
  | 5 | `BOT_MODULES`、`botModulesOf(profile)`（§4.2）；`botsCanPlay(profile)`；deprecated 的 `BOT_RULE_MODULES` | `support.ts:12-17` | PL-2、PL-3、SF-1、SF-4 |
  | 6 | `BOT_PACING`（合併各模組的 `pacing`）；`botCommandLimit(profile, base)`（`base` 與各模組 `maxCommandsPerWindow` 的最大值）；`botResponseCommands(profile)`（base 加上各模組的 `responseCommands`） | `bot-driver.ts:40-64,70`；`policy.test.ts:18-25` | PL-2、PL-3、SF-3 |
  | 7 | `botOwesAction(view, selfId)`：回傳 `'frame' \| 'pending' \| 'setup' \| 'preroll' \| 'action' \| null` | — | PL-2（區分卡死與閒置）、PL-3（診斷） |
  | 8 | `createBotPolicy(level, { modules? })`、`createFallbackPolicy(modules?)`；省略 `modules` 時依 `view.profileId` 推導，`modules: []` 是只有 base 的策略；naive 座位只保留模組的 `duty`（PL-2 的 `naiveModule`）。`fallbackPolicy` 改為 `createFallbackPolicy()`：名稱、型別與 base 行為不變，但會依 profile 帶入已註冊模組的 `duty`（§4.1） | `policy.ts:8-10`、`fallback.ts:84` | PL-2、SF-3 |
  | 9 | base 評分函式的具名匯出：`setupSpotScore`、`roadDirectionScore`、`robberCandidates`（從 `robberHex` 拆出）、`plentyPick(turn, hand?, bank?)`（可重複選，供 gold 使用）、`usefulRoad`、`canPlay`。放在 `src/base/*.ts`，避免 `heuristic.ts` 與模組循環 import | `heuristic.ts:195-275,322,372`，都未匯出 | SF-2a、SF-2b |
  | 10 | 強盜組合 `banditChoice(turn, cause)`（`src/base/robber.ts`）：`robberCandidates` 與 `banditCandidates(turn, cause)` 串接後以 `turn.choose` 挑選；回傳 `null` 表示沒有候選，`{ target: null }` 表示選中外框。`pending.moveRobber` 取 `robberCauseOf(pending.cause)`，騎士固定為 `'knight'` | `heuristic.ts:142-146,407` | SF-2b |
  | 11 | `economyOf(model, modules?, level?)` 組合 `costs`、`piecesLeft`、`scoreExtras`；`Economy.costs` 與帶索引簽章的 `Economy.left`；模組計畫同分時排在 base 種類之後 | `economy.ts:176-288`；`planOrder`（`:286-288`）遇到未知種類回 `-1000`，同分時會排到最前 | SF-2a |
  | 12 | `heuristic.ts` 的通用掛點，讓 SF-2a 不必修改 `heuristic.ts`：`planStep` 在 default 分支交給模組（`:570-599`）；「可立即得分」改由 `isImmediate(plan)` 判斷，模組計畫以 `Plan.immediate` 標示，例如船已鋪完的島嶼聚落（`:445`）；Road Building 的條件改為「base 道路有存量且有用」或「任一模組的 `freeRouteCandidates` 非空」，base 運算元先求值，與 v0.4.0 相同（`:479`） | — | SF-2a |
  | 13 | 合約規則 9：拒絕含非資源卡種或任何 goods 的報價，用在 `respondToOffers`（`:353-366`）與行動者處理報價的分支（`:422-431`） | — | — |
  | 14 | B-GUARD 放寬（`packages/bots/test/guard.test.ts:20`） | — | SF-1 |

- **骨架的硬性規則**（golden replay 成立的前提）：模組清單為空時，每個組合點的呼叫順序都與 v0.4.0 相同，包括 `turn.pick` 消耗亂數的次數；與 base 串接的模組候選一律接在 base 候選之後（`freeRouteCandidates` 是取代，不是串接，§4.2）；保底的順序見 §4.1。
- **golden replay**：
  - PR 的第一個 commit 只新增 golden 檔、不動 `src`：凍結 v0.4.0 harness 邏輯的 `test/golden/driver.ts`、錄製腳本 `test/golden/record.ts`、fixture `test/golden/base-v040.json` 與比對測試 `test/golden-base.test.ts`。driver 凍結在 PL-1，之後 PL-2 改動 harness 也不會影響它。driver 的 `Decision.command` 宣告為 `PolicyCommand = NonNullable<ReturnType<BotPolicy['decide']>>`，型別跟著 `BotPolicy.decide` 走，所以 PL-1 把回傳型別放寬為 `BotCommand` 時不必修改 driver；這項型別修正在 `src` 改動之前就併入第一個 commit，fixture 不必重錄。
  - driver 照搬 v0.4.0 harness 的設定：遊戲亂數 `seededRng(seed)`；決策種子 `botSeed('test', id, state.seq)`（`packages/bots/test/harness.ts:82`）；報價時鐘 `createOfferClock`（`:95-110`）；投影只帶 hints、不帶 events（`viewFor`，`:53-55`）；座位等級 `mixedLevels(players, seed)`（`packages/bots/test/policy.test.ts:27-29`）；對局迴圈與 `runBotGame({ seats, seed, maxSteps, onDecision })` 相同（`policy.test.ts:85-87`）。
  - 涵蓋 48 局：
    - B-GAME 的 3–6 人 × 種子 1–10（`base-2025`／`base-paired-2025`、`variable`、`mixedLevels`、5000 步）；
    - 保底席：4 人，種子 21–23，`bot2` 只走保底；
    - 經過 `createBotPolicy` 的一局：4 人，種子 31；
    - 全保底有界局：3–6 人，種子 1，800 步。
  - 每局記錄步數、勝者、結束原因，以及決策序列的雜湊：每一步以鍵排序後的 JSON 計算 FNV-1a 64。另外每 100 步記一個 checkpoint 雜湊，方便找出分歧點。
  - 測試以凍結的 driver 搭配目前的策略重跑，逐欄比對；依人數拆成多個 `it`，每個 timeout 120 s（base 40 局在 load ≈ 22 時約需 50 s）。0.4.1 內不得修改 fixture；需要重錄時，由主 agent 決定並寫明原因。
- **依賴**：先做 PL-1，與 SF 計畫的 RX 並行。兩者合併後，PL-2、PL-3 與 SF-1 並行開發（檔案不重疊），合併順序為 PL-2、PL-3，然後 SF-1。細節見 SF 計畫 §5.1。
- **SPEC 與文案的時機**：SPEC §4.9 改寫、大廳文案與「Today that is」一句，都放在 SF 開放 gating 的那個 PR。在那之前，「只支援 base」的敘述仍然正確。
- **規模**：三個切片合計約 500–800 行（含測試），不含 golden fixture。

## 5. 版本對照

| 版本 | 擴充包 | profile | 主要工作 | 估計規模（src＋test） | 依賴 | 主要風險 |
|---|---|---|---|---|---|---|
| 0.4.1 | 平台＋Seafarers | 2 個，3–6 人 | 平台 PL-1 到 PL-3；海域模型；gold、freeRoads 與 setup 放船的保底；島嶼擴張策略 | 平台 500–800＋SF 約 1,670–2,160（含文件 60–90） | 無 | 平台重構不得改變 base 的行為 |
| 0.4.2 | Cities & Knights | 2 個，3–6 人 | commodity 經濟與 14 種 frame 的保底（CK-B1）；核心策略：騎士、蠻族防禦、改良、非互動進度卡（CK-B2）；gating（CK-G）；互動進度卡（CK-C） | 約 2,750–3,400 | 0.4.1 | 規模最大；一局 21–38 輪；CK-C 可能延到 0.4.3 |
| 0.4.3 | SF+CK | 2 個，3–6 人 | 平台小切片（盜賊目標 fold、`rescore`、`sea.ts` 的騎士阻擋）；組合模組：強盜／海盜收窄、追擊海盜、setup 合成、騎士位置罰分 | 約 1,315–1,805 | 0.4.1、0.4.2（不依賴 CK-C） | 兩個模組候選的分數尺度要一致；追擊海盜與金礦城市在 sim 中幾乎不出現 |
| 0.4.4 | Traders & Barbarians | 8 個，3–4 人 | part 化；修正 FR、H、FR+H；Fishing、Rivers、Trains、BA、Traders 的劇本策略；gold 交易 | 約 2,830–3,620 | 0.4.1 | 8 個 profile 的測試時間；Traders 的路徑規劃 |
| 0.4.5 | Explorers & Pirates | 5 個，3–4 人 | E&P setup、movement 子階段、任務策略、海盜 frame、規避擱淺 | 約 3,370 | 0.4.1。E&P 規則修正建議先合併，但不是硬依賴（§9 R7） | 每回合指令數與節奏；fixture 曾出現死循環 |

### 5.1 為什麼是這個順序

- **SF 先做**：
  - 風險最低：現行策略打 SF 已經 0 拒絕，B-GAME 混座 40 局中有 38 局能打完（§2.2）；只有 1 種依序 frame（gold）、4 個指令，也沒有新增隱藏資訊。不過不造船時，主島蓋滿就打不完，所以造船同時是 Q1 與 Q2 的前提，easy 也要會造船。
  - 平台需要驗證的機制剛好都在它身上：模組指令、依序 frame、setup 接管（`setup.placeShip`）、paired 5–6 人。
  - 海域模型可以被 SF+CK 完整重用，E&P 也能重用其中的幾何部分。
- **C&K 第二**：SF+CK 同時依賴 SF 與 C&K。C&K 緊接 SF 之後，SF+CK 就能趁兩者都還熟悉時完成。
- **T&B 第四**：它和其他擴充沒有共用元件的依賴。8 個 profile 彼此獨立，即使 BA 或 Traders 落後，其餘 6 個也能先開放（P7）。
- **E&P 最後**：引擎最獨特，需要子階段接管與較高的指令上限。規則端的擱淺死結也建議在它的 rc 之前修好，但不是硬依賴（§9 R7）。

### 5.2 替代方案與退路

- **替代 A：T&B 移到 C&K 之前。** 6 個 T&B profile 成本很低，能較早擴大覆蓋；代價是 SF+CK 與 C&K 之間的距離被拉開。
- **替代 B：0.4.1 一併附上 T&B 的 FR、H、FR+H。** 這三個 profile 幾乎零成本，只需要讀 `robberHexes` 並加上 Strongest Ports 估值，還能提早驗證 part 判定；但會違反「一版一個擴充」。
- **A 與 B 的共同前提：`robberTargets` 的 fold 要跟著提前。**
  - T&B 計畫假設 fold 已由 0.4.3 的 SFCK-P 交付（T&B 計畫 §4.3、§11-2）。
  - 沒有 fold 時，Bot 的強盜候選沿用 base 預設：不看保護，也會排除目前所在格（`packages/bots/src/heuristic.ts:195-200`、`packages/bots/src/fallback.ts:19-25`）。FR 在其他陸地格都受保護（碰到公開分數不超過 2 的玩家的建築）時，會把強盜送到沙漠，即使它已經在那裡；強盜已在沙漠時，唯一的合法格就是目前所在格，Bot 會沒有合法目標。
  - 採用 A 時，fold 改由 T&B 的 S1 實作。採用 B 時，fold 改由 0.4.1 的 PL-1 實作，T&B 計畫 S1 的 B-POLICY 放寬也要一起提前。
  - 提前的 fold 直接採用 §4.2 的最終形式（元素為 `number | null`、初值為盜賊預設）。SFCK-P 改為只確認它涵蓋海盜目標，§4.9 與 §5 的對應列一併調整。
- **退路**：每一版都可以只放出已通過 Q1 與 Q2 的 profile 子集。
  - C&K：CK-C（互動進度卡）若在 rc.1 就緒時還沒通過審查，就移到 0.4.3 與 SF+CK 一起發布，因為兩者共用進度卡策略。
  - T&B：BA 或 Traders 可以晚一版開放。
  - E&P：先開 Land Ho! 與 Pirate Lairs，Fish、Spices、Full 移到 0.4.6。

## 6. 每版完成定義（DoD）

1. **程式**
   - 該擴充的 BotModule 為每個 frame 與強制動作都提供保底。
   - standard 與 easy 都會發出模組指令（SPEC §4.9）。沒有模組指令的 profile（T&B 的 FR、H、FR+H）改以該計畫的行為指標判定，例如強盜落點與 Strongest Ports。
   - 開放的 profile 已加入快照清單。
2. **測試**
   - 通過 Q1（`BOTS_SEEDS=10`）與 Q2。
   - 每種模組 frame 都有固定盤面的 I9 單元測試，涵蓋保底、standard 與 easy。
   - server 至少有 §4.7 第 5 點列出的四類案例。
   - `pnpm verify` 全部通過。
3. **bench**：發布 PR 附上 Q3 表格，並與上一版比較。
4. **文件**：需要更新以下各處，平台研究 D1 已列出目前所有需改的行號。
   - `docs/SPEC.md` §4.9 的「Today that is」
   - bot 規格的範圍
   - `docs/API.md` 的 Bot 支援說明
   - `docs/FIDELITY.md` 該 profile 的「no bot seats」列與 R-* 證據列
   - `README.md` 的 Bot 註記
   - 工作紀錄 `docs/aegis/work/<date>-bots-<slug>.md`
   - `docs/aegis/INDEX.md`
5. **瀏覽器驗證**（由 Browser QA 執行）
   - 為每個新開放的 profile 從大廳建房，加入 easy 與 standard 電腦後開局，觀察數個 Bot 回合。
   - 至少要看到 Bot 使用該擴充的代表性機制，而且沒有停住。
   - paired profile 也要驗證一次。
   - 截圖是否提交，見 §10 D10。
6. **發布**：依 §7 先發 rc 試玩，再發 stable。release notes 由 `scripts/release-notes.sh` 產生，並跑 `scripts/release-notes-lint.sh` 檢查。

## 7. 分支、PR 與發布流程

依 `RELEASING.md`，並沿用 v0.4.0 的做法：

1. **建立 release 分支**：上一版 stable 發布後，從 `master` 建立 `release/v0.4.N`。
2. **功能分支與 PR**
   - 分支命名為 `feat/bots-<slug>-<slice>`。一個切片一個 worktree，放在 `.worktrees/bots-<slug>-<slice>/`，避免並行的切片互相衝突。
   - PR 指向 `release/v0.4.N`，以 squash merge 合併，subject 保留 `(#N)`，例如 `✨ feat(bots): build ships and settle islands in new shores (#N)`。
3. **同步 master**：master 有修正時，以 merge 方式併入 release 分支；不 rebase，也不 force-push。
4. **rc**：在 release 分支直接 push `🔖 release: v0.4.N-rc.K`，在該 commit 打 tag，發 `--prerelease` notes，再用 rc 映像試玩。
5. **stable 發布**
   - 開 PR `release/v0.4.N → master`，以 **Create a merge commit** 合併。
   - 在 master 建立 `🔖 release: v0.4.N`，打 tag，發 GitHub Release。
   - 打 tag 前先跑 `BOTS_SEEDS=10 pnpm verify`。
6. **跨版本重疊**：下一版的功能分支可以先從上一版的 release 分支切出。上一版以 merge commit 進入 master 後 commit SHA 不變，因此可以直接對新的 release 分支開 PR，不必 rebase。
7. **E&P 擱淺死結的修正**（#97）：走一般的修正 PR，可以搭任何一版發布。

## 8. Paseo 分工

派工前以 `list_profiles` 的實際結果為準，下表只列角色名稱。

| 角色 | 職責 | 隔離 |
|---|---|---|
| 主 agent（Orchestrator） | 擁有共用合約（`types.ts`、`modules/types.ts`、`support.ts`）；負責 Git、整合與最終驗證；派工與追蹤 | 主 worktree |
| Planner | 每版開工前，依當時的程式現況刷新該版計畫；唯讀 | 共用工作區 |
| Architect | 審查 0.4.1 的平台合約；處理跨模組的設計取捨，例如分數尺度；唯讀 | 共用工作區 |
| Implementer（Backend） | 依切片實作 bots、server 與 rules 的匯出並補測試；一個切片交給一個 agent，檔案所有權要明確 | 各自的 worktree |
| Implementer（Frontend） | 只負責大廳文案；也可以併入 gating PR，由主 agent 處理 | 各自的 worktree |
| Reviewer（Sol）或 Reviewer（Opus） | 每個 PR 的獨立審查，重點是合法性、I9、決定性與 B-FAIR；唯讀 | 共用工作區 |
| QA | 執行並彙整發布閘門的矩陣（`BOTS_SEEDS=10`）與 bench；只改測試 | 各自的 worktree |
| Browser QA | §6 第 5 點的瀏覽器驗證 | 共用工作區 |
| Bugfixer（Backend）與 Fix Verifier | 修正 E&P 擱淺死結的 rules，並獨立驗證 | 各自的 worktree |
| Release Manager | 只在使用者明確授權時處理 rc 與 stable 的 tag 和 Release | — |

- **並行原則**
  - `heuristic.ts`、`economy.ts`、`board.ts`、`trade.ts` 這類共用檔案，同一時間只交給一個 agent。
  - 模組目錄內的檔案，例如 T&B 各 part 的檔案，可以並行處理。
  - subagent 不 push、不改 lockfile；對合約有疑義時回報主 agent，不自行修改（沿用 bot 規格 §11）。
- **閒置 agent 的處理**：把狀態寫成交接筆記放到 `.worktrees/_handoff/` 後停止該 agent；之後再從筆記啟動新的 agent。

## 9. 風險

| # | 風險 | 對策 |
|---|---|---|
| R1 | 模組 frame 讓整桌無聲停住（G-A），或保底被拒後無限重試（G-B） | 保底只取 hints；仿 BotDriver 的 B-GAME；server 診斷與重試（§4.7） |
| R2 | 「合法」不等於「會玩」：SF 不造船也常能贏，但主島蓋滿時就打不完 | Q2 機制門檻 |
| R3 | 平台重構改變了 base 行為 | PL-1 以 golden replay 驗收 |
| R4 | 每視窗的指令上限與節奏：E&P 單一座位每回合 15–30 個指令；C&K 逐 Bot 最多 16 個 | 依 profile 設定上限；模組自帶 `pacing`；bench 監測最大值 |
| R5 | 測試時間增長，高負載下逾時 | 擴充 profile 預設 3 個種子、發布閘門 10 個；拆檔並行；timeout 120 s；在乾淨的機器上重新量測 |
| R6 | rules 的 view 形狀漂移，或 gating 誤判 | rules 匯出型別並加形狀測試；可玩 profile 快照；未知的 part 一律不開放 |
| R7 | E&P 擱淺死結：船擱淺在滿格邊、沒有出口，又沒有羊毛或 settler 時，`turn.end` 會被 `E_EP_EDGE_FULL` 拒絕，真人也會卡住 | 另開 rules 修正（#97；分支 `fix/rules-ep-strand`，指向 master），升 `ep-2025.2` 並處理存檔相容，建議在 0.4.5 的 rc 之前合併。這不是 Bot 發布的硬依賴：擱淺只會由行動者自己的移動造成，Bot 以路線規劃避開。現行保底遇到擱淺時回 null，整桌會無聲停住，所以 E&P 的保底與規劃都必須涵蓋這個情況 |
| R8 | E&P 或 Traders 出現死循環與長局（fixture full 3 人、種子 5 無法終局） | 進度看門狗；供應感知；依 profile 設定步數上限 |
| R9 | 真人用含 goods 的報價佔 Bot 便宜 | 合約規則 9；各版補上估值 |
| R10 | paired 5–6 人時 Player 2 的限制 | B-GAME 涵蓋 5、6 人；Bot 依 hints 行事 |
| R11 | 與真人同桌時對局變長（C&K 一局 21–38 輪） | 節奏表；用 bench 換算真人的觀看時長 |
| R12 | 研究數據受機器負載影響 | 結論只依決定性指標；耗時在實作階段重新量測 |

## 10. 需要使用者決定的事

| # | 決策 | 建議 |
|---|---|---|
| D1 | 版本順序 | SF → C&K → SF+CK → T&B → E&P（§5）；替代方案見 §5.2 |
| D2 | 開放粒度 | 細到 profile：「模組已支援」加上 `supports(profile)`，並依 §4.4 修訂 SPEC §4.9 |
| D3 | I3 與 rules 匯出 | 依 P8 改寫 I3，允許新增型別與常數匯出，包括抽出具名函式 |
| D4 | 品質門檻 | Q1 與 Q2 作為發布閘門，Q3 只報告、不擋發布；Q2 的數值由各擴充計畫提出，再由使用者確認 |
| D5 | E&P 擱淺死結 | 另開 rules 修正（#97，`ep-2025.2`），建議在 0.4.5 的 rc 之前合併，但不擋 Bot 發布；Bot 同時以規劃避開 |
| D6 | 含 goods 的國內交易 | MVP 只負責正確估值與回應，不主動提出；無法估值就拒絕 |
| D7 | 測試預算 | base 維持 10 個種子；擴充 profile 預設 3 個，發布閘門 10 個；在 `RELEASING.md` 的 pre-flight 加一行 `BOTS_SEEDS=10` |
| D8 | 節奏與上限 | 採用 §4.7 的節奏表；E&P 的每視窗上限放寬到 80 |
| D9 | rc 流程 | 每個 0.4.x 都走 release 分支，至少發一個 rc 試玩 |
| D10 | 瀏覽器證據 | 每版都跑 Browser QA；截圖預設不提交（放在 `.tmp/`），只在報告中列出路徑；要提交請明確授權 |
| D11 | easy 的下限 | easy 要保留讓對局能終局的最低限度擴充行為（P9） |

各擴充特有的決策（例如 C&K 的防禦取向、E&P 是否分批開放 mission）列在各自的計畫中。

## 11. 各擴充包計畫

| 版本 | 計畫 |
|---|---|
| 0.4.1 | `docs/aegis/plans/2026-11-04-bots-seafarers.md`（含與平台切片的銜接） |
| 0.4.2 | `docs/aegis/plans/2026-11-04-bots-cities-knights.md` |
| 0.4.3 | `docs/aegis/plans/2026-11-04-bots-seafarers-cities-knights.md` |
| 0.4.4 | `docs/aegis/plans/2026-11-04-bots-traders-barbarians.md` |
| 0.4.5 | `docs/aegis/plans/2026-11-04-bots-explorers-pirates.md` |

每份計畫使用相同的章節：

1. 目標與範圍
2. 現況與落差
3. 介面摘要
4. 設計：保底、standard、easy，以及對平台與 rules 的需求
5. 切片與 PR
6. 測試與驗收：Q1 與 Q2 門檻、Q3 指標
7. 文件與發布
8. Paseo 分工
9. 風險
10. 待使用者決定的事
11. 與整體策略的差異（沒有差異時寫「無」）

## 12. 開工前核對（2026-11-06）

基準是 `73a0d95`，也就是 `release/v0.4.1` 的起點。`a200840` 之後，bots、rules、server、protocol 都沒有變動，只有 web 與 docs 有修改（#99、#100、#106、#107）。Planner 以唯讀方式核對了本文件 §2–§5 與 SF 計畫全文，共 136 處 `檔案:行號`：126 處符合，10 處已在原處更正，如下表。

| # | 文件 | 原引用 | 更正 |
|---|---|---|---|
| 1–4 | 策略 §4.4；SF 計畫 §5、§7.1 | `zh-Hant.ts:275`、`en.ts:278` | `:276`、`:279`（#107 在 `:58-59` 多了一行） |
| 5 | 策略 §4.4 | `bots.test.ts:266-289` | 「不支援」的 fixture 測試在 `:279-291`；`:266-277` 是 SF 的拒絕測試，由 SF-4 翻轉 |
| 6 | SF 計畫 §4.5 | `bots.test.ts:278-290` | `:279-291` |
| 7 | SF 計畫 §5 | `bots.test.ts:265-276` | `:266-277` |
| 8 | SF 計畫 §7.1 | `README.md:176` | `:176-177` |
| 9 | SF 計畫 §4.1 | `engine.ts:1244-1248` | base 已是 `base-2025.4`：容量經 `pendingRouteCapacity`（`:651-655`）交給 `roadBuildingGrantCapacity`（`:1251-1256`），在 `:1254` 依存量截斷。結論不變 |
| 10 | SF 計畫 §3 | `ships.ts:111-129` | veto 在 `:111-128`，`movableShips` 在 `:136-144`。結論不變 |

另有 11 項實質落差，調整已併入各章節：

| # | 落差 | 調整 | 位置 |
|---|---|---|---|
| S1 | `decide` 改回傳 `BotCommand` 後，server 與 bots 測試的型別檢查會失敗 | PL-1 一併修改受影響的型別註記，只動型別 | §4.3、§4.10 |
| S2 | `BOT_RULE_MODULES` 還有其他引用 | PL-1 保留為 deprecated 的空陣列；PL-3 讓 server 測試改用 `botsCanPlay`；SF-4 刪除它並更新引用 | §4.4；SF 計畫 §4.4、§5、§9 |
| S3 | 「預設取第一個 setup 模式」會讓 base 從 `variable` 變成 `fixed` | 允許 `variable` 時用它，否則取第一個 | §4.6 |
| S4 | SF-4 改文案後，`web/test/bots.test.tsx` 會失敗 | 納入 SF-4 的所有權與驗收 | §4.4；SF 計畫 §5、§7.1 |
| S5 | SF-1 與 SF-2a 都需要改 `heuristic.ts`，但沒有列在所有權內 | PL-1 提供通用掛點；SF-1 只在 base 的 freeRoads 處理器加存量檢查 | §4.1、§4.10；SF 計畫 §4.5、§5 |
| S6 | PL-1 的合約缺項 | 列入 §4.10 的合約清單 | §4.1、§4.2、§4.10 |
| S7 | PL-2 與 SF-1 的測試檔重疊 | PL-2 的所有權改為明列 | §4.10 |
| S8 | 文件由哪個切片修改不明確 | bot 規格的合約條文歸 PL-1；完成閘門與 `RELEASING.md` 歸 PL-2；其餘歸 SF-4 | §4.10；SF 計畫 §7.1 |
| S9 | golden 測試耗時 | 依人數拆成多個 `it`，每個 timeout 120 s | §4.10 |
| S10 | PL-3 的測試需要注入點 | fixture rules module；`BotDriverDeps.commandLimitFor` | §4.7、§4.10 |
| S11 | RX 缺少 gold pending 型別與 hints 對照型別 | RX 定義 gold pending 介面，並匯出 `ModuleHintsMap` | SF 計畫 §4.5、§5 |

`docs/aegis/work/2026-11-04-bots-plans-review.md` 指出的問題都已修正，沒有殘留。D5、D6 都不是 0.4.1 的前提：PL-1 的規則 9 只需要拒絕含非資源卡種或任何 goods 的報價。

## 13. PL-1 介面定案（2026-11-06）

PL-1 開工前，由 Architect 以唯讀方式做介面審查。審查在 `git archive` 產生的副本上編輯並執行 tsc，結果已併入 §4.1、§4.2、§4.10 與 SF 計畫 §4.1、§4.2、§4.5、§5。A7 是 PR #119 的 Reviewer 提出的修正。與原計畫不同的地方如下：

| # | 原計畫 | 定案 | 理由 |
|---|---|---|---|
| A1 | `scoreExtras(model, baseEconomy)` | `scoreExtras(input: PlanInput)`，`PlanInput` 是 `{ model, level, base }` | SF 的船路徑上限依難度而定（easy ≤3、standard ≤4）；物件參數之後只增欄位 |
| A2 | `TurnContext` 只有 `pick` | 新增 `level` 與 `choose` | `banditCandidates` 的目標可能是 `null`（外框），需要回傳候選本身；`choose` 與 `pick` 共用實作，亂數消耗必然相同，不必改動 base 的 7 個 `pick` 呼叫點 |
| A3 | `fallbackPolicy` 不變 | `fallbackPolicy = createFallbackPolicy()`，依 `view.profileId` 推導模組 | server 直接呼叫 `fallbackPolicy.decide`（`bot-driver.ts:332`），而且 PL-3 不改這條路徑；推導後 SF-1 一註冊，server 就自動拿到 SF 的 `duty` |
| A4 | `preroll`、`actions`、`freeRouteCandidates`、`banditCandidates` 都「接在 base 的候選之後統一評分」 | 各自的組合方式見 §4.2 | base 只有在立即得分建造與強盜兩處有評分清單 |
| A5 | 「可立即得分」由模組擴充 | `Plan.immediate` 加上 `isImmediate(plan)`，不新增鉤子 | 改動最小；模組清單為空時是 no-op |
| A6 | golden driver 在 0.4.1 內不得修改 | 錄製後、`src` 改動前，把 `Decision.command` 改成跟著 `BotPolicy.decide` 走的 `PolicyCommand` 型別，併入第一個 commit | `decide` 放寬為 `BotCommand` 後，原本的 `Command` 註記會讓 typecheck 失敗；只改型別，fixture 不必重錄 |
| A7 | 保底以 `responders.includes(self)` 判斷模組 frame 的資格（介面定案的初稿） | 保底只在 `responders[0] === self` 時回應模組 frame，也只在這時詢問模組的 `duty`；策略的 `answerFrame` 仍以 `includes` 過濾，依序 frame 由模組自行檢查 `responders[0]` | 與 P3「保底一律採保守的 `responders[0]`」及 `botOwesAction` 一致；依序 frame 只接受第一位作答，非第一位送出會被拒（`E_NOT_YOUR_TURN`），例如 SF 的 gold（`packages/rules/src/modules/seafarers/gold.ts:94`）、C&K 的 science（`citiesKnights/production.ts:140`）與防守者選牌堆（`citiesKnights/barbarians.ts:198`）。PR #119 審查時發現 |

後續計畫引用的 v0.4.0 行號會因 PL-1 移動，例如 T&B §4.3 的 `heuristic.ts:195-200,214`，PL-1 之後在 `src/base/robber.ts`；`fallback.ts:19-25` 在 `src/base/duty.ts`；C&K §4.6 的 `fallback.ts:47-57` 也在 `src/base/duty.ts`。這些行號由 Planner 在各版開工前刷新。
