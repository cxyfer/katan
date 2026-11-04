# 電腦對手逐一支援擴充包：跨擴充包平台技術基礎報告（第 1 輪）

> 收錄說明：2026-11-04 第一輪唯讀研究報告，內容原樣保留，基準 `a200840`（v0.4.0）。定稿計畫是 `docs/aegis/plans/2026-11-04-expansion-bots-roadmap.md`，研究之後的修正一律以計畫為準。文中的 `/tmp/katan-bot-research/<slug>/report.md` 對應 `docs/aegis/work/2026-11-04-bots-<slug>-research.md`；探查腳本與輸出沒有提交。

範圍：Repo `graceful-swan`（分支 `docs/expansion-ai-opponent-plans`，等於 `a200840 🔖 release: v0.4.0`）。全程唯讀，探查腳本放在 `/tmp/katan-bot-research/platform/`。
量測時機器負載變動很大（load average 1.97 到 105，6 核），也有其他 agent 共用工作區。每筆數據都註明當時負載。

---

## 0. 結論

1. **伺服器與協定已經能傳送模組指令，也已經依 profile 開放 Bot。** 只有 `@catan/bots` 本身還停留在 base。
   - `CommandRequest.command` 是開放型別（`packages/protocol/src/index.ts:299-303`），`applyCommand` 接受 `Command | ModuleCommand`（`packages/rules/src/engine.ts:669-673`）。
   - `ProfileView.botSeats` 本來就逐 profile 計算（`packages/server/src/http.ts:288`、`packages/protocol/src/index.ts:266-271`）。
   - 因此改支援粒度**不需要改 protocol**。
2. **用 BotDriver 的保底語意把現行 base 策略丟進各擴充 profile 實測**（`probe-profiles.ts`、`probe-more.ts`）：
   - 未修改的策略可合法跑完（零拒絕、有勝者）：
     - `sf-new-shores-*` 3–6 人，24/24 局。
     - `tb-harbors-2025`、`tb-rivers-2025`，24/24 局。
     - `tb-friendly-robber*` 只補強盜目標（讀 `hints.modules.tradersBarbarians.robberHexes`），24/24 局。
   - 會卡死的情況：
     - C&K 與 SF+CK：含 commodity 的棄牌（`E_INVALID_DISCARD_COUNT`）。SF+CK 另有 `citiesKnights.pillage`。
     - friendly robber（未補目標時）：`E_ILLEGAL_TARGET`。
     - T&B 各劇本：卡在各自的 frame，例如 `fishSwap`、`wagonBid`、`baSteal`、`tbWagon`。
     - E&P：卡在 setup；`ep-land-ho` 跑了 4000 步、1270 回合仍沒有勝者。
3. **架構建議：比照 rules 的模組化 BotModule 外掛**，放在 `packages/bots/src/modules/<id>/`，依 `profile.ruleModules` 的順序組合。
4. **支援粒度建議：改為「rules module 加上 part／mission 能力判定」。** 理由如下：
   - T&B 的 8 個 profile 共用 `ruleModules: ['tradersBarbarians']`（`packages/rules/src/profiles.ts:229`）。
   - E&P 的 5 個 mission 都是 `['explorersPirates']`。
   - 依模組開放只能一次放出整個 T&B 或整個 E&P。
   - 等 T&B 的 event-cards profile 未來實作後，Bot 會被自動放行，這是隱藏風險。
5. **平台工作的切法：** 跨切面的合約、測試基礎建設與伺服器掛鉤在第一個版本做完；各擴充特有的能力（海路、commodity、trade goods、子階段）延到第一個需要它的版本再做。

---

## 1. 現況與 base 專屬假設

### 1.1 `packages/bots` 結構與擴充點

| 檔案 | 角色 | 擴充點現況 |
|---|---|---|
| `src/types.ts:34-40` | `BotPolicy.decide(view, ctx): Command \| null` | 回傳型別只有 base `Command` union（`:8`、`:39`） |
| `src/policy.ts:8-10` | `createBotPolicy(level)` 回傳 `heuristicPolicy` | 沒有 profile 參數 |
| `src/heuristic.ts:112-123` | 決策窗口分派：result、pending、setup、非行動者回報價、preroll、action | 沒有模組窗口 |
| `src/board.ts` | 盤面模型：點數、產能、距離規則、道路 BFS、最長路 | 只有陸路與 5 種資源 |
| `src/economy.ts` | 手牌、成本、權重、ETA、計畫 | 計畫只有 city、settlement、devCard、longestRoad |
| `src/trade.ts` | 報價評估、生命週期、銀行交易、開價 | 只看 `RESOURCES` |
| `src/fallback.ts:10-84` | 保底策略（I9） | 只認 base 的 frame 與 phase |
| `src/support.ts:12-17` | `BOT_RULE_MODULES = []`、`botsCanPlay` | 依 rules module id 判定 |
| `src/order.ts:7-14` | `botActingOrder`：先非行動者、後行動者 | 對模組 frame 也適用（見 §6） |

### 1.2 只適用 base 的假設

#### bots 策略

| # | 位置 | 假設 | 擴充時的影響 |
|---|---|---|---|
| A1 | `bots/src/types.ts:8,39` | `decide` 只回傳 base `Command` | 型別上不能回傳 `build.ship`、`knight.recruit`、`ep.*`、`tb.*` |
| A2 | `bots/src/support.ts:12,15-17` | 依 rules module id 判定 | T&B 與 E&P 無法依 part 或 mission 分批開放（§4） |
| A3 | `bots/src/fallback.ts:10-45`（`:41-43`） | `pendingDuty` 只認 discard、moveRobber、steal、yearOfPlenty、freeRoads；模組 frame 回 null | 實測：T&B 的 frame 全部卡住；BotDriver 會進入 30 秒退避的迴圈（I9 失效） |
| A4 | `bots/src/fallback.ts:17,48-56`、`bots/src/heuristic.ts:177` | 手牌只展開 `RESOURCES` | C&K 的 `handSize` 含 commodity（`rules/src/project.ts:136`、`rules/src/analysis.ts:335-337`），棄牌張數不足。實測 `ck-2025`、`sf-ck` 卡住 |
| A5 | `bots/src/fallback.ts:21-24`、`bots/src/heuristic.ts:195-222` | 強盜可放任何非海、非現位的陸地格 | 實測 `tb-friendly-robber` 出現 `E_ILLEGAL_TARGET`；也忽略 SF 海盜、SF+CK `bandit`（`seafarersCitiesKnights/index.ts:176-189`）、C&K `robberInactive` |
| A6 | `bots/src/fallback.ts:36-40`、`bots/src/heuristic.ts:257-272` | 免費道路只看 `hints.legalRoads` | SF 的免費路線容量含船（`rules/src/engine.ts:651-655`）。只剩船可放時保底回 null（推測：會卡住；24 局實測未觸發） |
| A7 | `bots/src/fallback.ts:58-82`、`bots/src/heuristic.ts:307-320` | setup 只送 `setup.placeBuilding`／`setup.placeRoad` | E&P 用 `ep.setup*` 並 veto base setup；實測非 land-ho 的 E&P 卡在 setup。SF 另有 `setup.placeShip` |
| A8 | `bots/src/heuristic.ts:118-122` | phase 只認 setup、preroll、action | E&P 的 movement 子階段存在模組狀態裡，`GameView.turn.phase` 仍是 `'action'`（`explorersPirates/index.ts:331-339`）；base 會送出被 veto 的建造 |
| A9 | `bots/src/heuristic.ts:134-166`（`:162-164`） | `pendingDecision` 遇模組 frame 回 null | 所有模組 frame 都要有策略或保底 |
| A10 | `bots/src/heuristic.ts:63-66,372-409,458-509` | 發展卡只有 base 五種 | C&K 停用發展卡（`citiesKnights/index.ts:149`）；T&B Traders 的牌庫是 `barbarianKnight`、`swiftJourney`（`rules/src/profiles.ts:335-340`）；E&P 沒有發展卡 |
| A11 | `bots/src/heuristic.ts:322-347` | 初始放置只評估 base 產能與港口 | 不認得 gold、fish、河流、commodity、C&K 第二座是城市、E&P 港口聚落 |
| A12 | `bots/src/heuristic.ts:353-366`（`:355`） | 只在 `action` phase 回應報價；收益只算資源 | commodity 報價與 T&B gold 報價會誤判（見 A26） |
| A13 | `bots/src/heuristic.ts:411-456`（`:455`） | 行動順序固定，最後送 `turn.end` | 沒有模組候選；E&P 必須先 `ep.startMovement` |
| A14 | `bots/src/heuristic.ts:519-568`（`:528,534,560,563`） | `COSTS` 只有 base 成本（`rules/src/engine.ts:116-121`） | 缺船、騎士、城牆、改良、E&P 的 `EP_COSTS`（`explorersPirates/core.ts:32-38`） |
| A15 | `bots/src/heuristic.ts:602-625`（`:606,621`） | 手牌 ≥ 8 才消化（base 上限 7）；銀行交易只換資源 | C&K 城牆改變 `discardLimit`；commodity 換匯 |

#### bots 盤面與經濟模型

| # | 位置 | 假設 | 擴充時的影響 |
|---|---|---|---|
| A16 | `bots/src/board.ts:20-28` | `Yield` 只有 5 種資源 | commodity、gold、fish 無法表達 |
| A17 | `bots/src/board.ts:89` | 點數只取 `board.numbers` | T&B Rivers 的 `extraNumbers`（`rules/src/project.ts:56-57`） |
| A18 | `bots/src/board.ts:90` | `TERRAIN_RESOURCE`（`rules/src/types.ts:33-39`） | gold 與 sea 為 null；`TERRAIN_COMMODITY`（`rules/src/types.ts:41-45`）未計入 |
| A19 | `bots/src/board.ts:96-100` | 空點只檢查距離規則 | 不檢查陸地路口、fog、`allowBuilding`（New Shores 主島起始） |
| A20 | `bots/src/board.ts:114-124` | 城市產出 2 份資源 | C&K 城市在森林、草原、山地產 1 資源加 1 commodity |
| A21 | `bots/src/board.ts:126-152`（`:140`） | 棋子只計 settlements、cities、roads；道路排除船但計入橋 | rules 的 `countRoads` 不計橋（`rules/src/modules/README.md:161-162`）；E&P 聚落是 5 一般加 4 港口（`rules/src/profiles.ts:241-244`、`:268`） |
| A22 | `bots/src/board.ts:171-206` | 道路 BFS 不分陸海 | 會規劃穿越海面的道路（rules 要求陸地邊，`modules/README.md:86-88`）；忽略 C&K 騎士阻擋（`vertexBlocker`） |
| A23 | `bots/src/board.ts:223-258`（`:234`） | 最長路排除船 | SF 的 Longest Trade Route 含船（`longestRouteIncludesShips`）；騎士會切斷；Trains 的 `edgeWeight`；Traders 停用最長路（`traders/index.ts:369-372`） |
| A24 | `bots/src/economy.ts:22-23,74-86,139-174,183` | `Hand`／`Cost` 只有資源；每輪擲骰次數等於人數（`:158`）；匯率預設 4 | paired 的 Player 2 不擲骰（影響小）；commodity 匯率在 `hints.modules.citiesKnights.commodityRates` |
| A25 | `bots/src/economy.ts:193-280` | 計畫只有 city、settlement、devCard、longestRoad；`devDeckSize > 0` | C&K、E&P、T&B Barbarian Attack 的 `devDeck: []`（`rules/src/profiles.ts:269,324,424,443,474`） |

#### bots 交易與執行順序

| # | 位置 | 假設 | 擴充時的影響 |
|---|---|---|---|
| A26 | `bots/src/trade.ts:19-44` | 報價效用只算資源 | 報價條款是 `CardKind`（`rules/src/types.ts:104-105,284-286`），另有 `giveGoods`／`wantGoods`（`rules/src/engine.ts:1755-1756`）。沒有 gold 卻同意會被拒（`rules/src/engine.ts:1873-1876`） |
| A27 | `bots/src/trade.ts:99-105,120-151,161-194` | 結算對象、銀行交易、主動開價都只看資源 | C&K 2:1 交易所、T&B gold 交易 |
| A28 | `bots/src/order.ts:7-14` | 先問非行動者，最後問行動者 | 模組 frame 的回應順序由 `responders` 決定；只要 Bot 自行檢查資格就不受影響（§6） |

#### bots 測試與 bench

| # | 位置 | 假設 |
|---|---|---|
| T1 | `bots/test/harness.ts:29-31` | `profileFor` 只回 base profile |
| T2 | `bots/test/harness.ts:33-50` | `newBotGame` 依人數挑 base profile，setupMode 預設 `variable`（E&P land-ho 與 pirate-lairs 只允許 `fixed`） |
| T3 | `bots/test/harness.ts:193-200` | `supplyTotal` 只計資源 |
| T4 | `bots/test/policy.test.ts:18-25,38-42` | 非行動者可送的指令清單只有 base |
| T5 | `bots/test/policy.test.ts:56-61,66-69` | 強盜檢查只認 `pending.moveRobber`、`dev.playKnight` |
| T6 | `bots/test/policy.test.ts:94` | 供應量常數只有 base |
| T7 | `bots/test/policy.test.ts:135-157` | 決定性只測 base 4 人 |
| T8 | `bots/test/fair.test.ts:21-58` | 隱藏資訊擾動只改資源、發展卡、牌庫 |
| T9 | `bots/test/fuzz.test.ts:23,48-81` | 只擾動 base 的手牌與發展卡 |
| T10 | `bots/test/fallback.test.ts:41,45` | 供應量寫死 `19*5`／`24*5`；timeout 30 s |
| T11 | `bots/test/guard.test.ts:20` | 只允許 `'./'` 相對匯入，子目錄要用的 `'../'` 會被判違規 |
| T12 | `bots/test/support.test.ts:16` | 以 seafarers 作為不支援的範例 |
| T13 | `bots/bench/run.ts:17-25` | 只有 base 的對局設定 |

#### 伺服器

| # | 位置 | 假設 |
|---|---|---|
| S1 | `server/src/bot-driver.ts:40-64` | `THINK_MS` 只列 base 指令；模組指令一律用 `DEFAULT_THINK_MS = 900`（`:64`、`:431`） |
| S2 | `server/src/bot-driver.ts:66,162` | 骰子演出等待只看 `turn.rolled`（對 C&K 足夠，見 §6） |
| S3 | `server/src/bot-driver.ts:70` | 每視窗每個 Bot 最多 40 個指令。E&P 實測接近上限（§6） |
| S4 | `server/src/bot-driver.ts:74` | `Decision.command: Command`；送出時已轉型為 `CommandRequest['command']`（`:380`） |
| S5 | `server/src/bot-driver.ts:413-423` | 保底也被拒時退避 `retryMs`（預設 30 s，`docs/OPERATIONS.md:37`）。模組保底寫錯就會每 30 秒卡一次 |
| S6 | `server/src/bot-seats.ts:45-51`、`server/src/rooms.ts:289-293,413-420,725-727`、`server/src/http.ts:288` | 透過 `botsSupported(profile)` 單一入口做 gating。API 不必改，只要改 `botsCanPlay` |

#### 伺服器測試

| # | 位置 | 假設 |
|---|---|---|
| S7 | `server/test/bots.test.ts:259-261` | 以 `[...expansions, ...variants]` 推算支援，與實際 `ruleModules` 不一致（SF+CK 多 `seafarersCitiesKnights`；T&B 的 variant 不是模組）。一開放就會誤判 |
| S8 | `server/test/bots.test.ts:266-277` | 以 Seafarers 當不支援的範例 |
| S9 | `server/test/cities-knights.test.ts:120-133`、`server/test/seafarers-cities-knights.test.ts:146-159`、`server/test/explorers-pirates.test.ts:66-72`、`server/test/traders-barbarians.test.ts:72-90` | 寫死 `botSeats: false` 或 `E_INVALID_BOT`，每個版本要翻轉 |

#### web、i18n 與文件

| # | 位置 | 假設 |
|---|---|---|
| W1 | `web/src/state/bots.ts:18-20`、`web/src/components/LobbyScreen.tsx:111-112,256,269,275-277` | 讀 `profile.botSeats`，已是 profile 粒度，不必改 |
| W2 | `web/src/i18n/en.ts:278`、`web/src/i18n/zh-Hant.ts:275` | `lobby.bots.unsupported` 寫「只會玩基本遊戲」；第一個擴充上線後就不成立 |
| W3 | `web/src/i18n/en.ts:798`、`web/src/i18n/zh-Hant.ts:791` | `blocker.botsUnsupported` 文案已是中性，不必改 |
| D1 | `docs/SPEC.md:188`、`docs/aegis/specs/2026-11-01-bot-opponents.md:16,19`、`docs/API.md:141-147,306,312`、`README.md:163,169,176`、`docs/FIDELITY.md:41-44,68,112,124,136,521,611-612` | 「只支援 base」或「Bot 不可入座」的敘述 |

---

## 2. 模組化 Bot 架構

### 2.1 方案比較

| 方案 | 說明 | 優點 | 缺點 |
|---|---|---|---|
| A. 單體 heuristic 加 profile 分支 | 在 `heuristic.ts`、`economy.ts` 內 `if (module present)` | 首版最快、不需抽象 | 625 行會膨脹數倍；SF+CK 的分支組合會爆炸；每版都改同一批檔案；與 rules「每個模組在自己目錄」的慣例相反 |
| B. BotModule 外掛（**建議**） | `src/modules/<id>/`，依 `ruleModules` 順序組合，鉤子與 rules 對應 | 每版只動自己的目錄；SF+CK 組合方式與 rules 一致；支援範圍由模組宣告；保底與策略可以各自測 | 首版要把 base 評估層參數化，成本較高；各模組候選的分數尺度要統一 |
| C. 每個 profile 一套獨立 policy | `createBotPolicy(level, profileId)` | 互不干擾、方便平行開發 | base 邏輯大量重複，base 修正要同步多處；SF+CK 需要第三套 |
| D. 完全依 hints 的通用策略 | 列舉 `hints.modules[id].targets` 加通用估值 | 新模組幾乎免費取得保底 | hints 形狀不統一（只有 T&B 的 rivers、fishing 用 `targets`，`rules/.../rivers/index.ts:114`、`fishing/index.ts:406`）；要統一就得改 rules 的 hints 合約與 web；策略品質低 |

建議採用 **B**。原則是：**合法性一律以 rules hints 為準**（`hints.legal*`、`hints.modules[id]`），Bot 自己的模型只用於估值與規劃。D 的想法只用在各模組的保底：保底從該模組的 hints 取第一個合法選項。

### 2.2 介面草案

```ts
// packages/bots/src/modules/types.ts
import type { Command, GameView, ModuleCommand, ProfileDefinition, PublicModulePendingView } from '@catan/rules';

export type BotCommand = Command | ModuleCommand;

export interface BotModule {
  /** 與 rules module id 相同（ProfileDefinition.ruleModules）。 */
  readonly id: string;
  /** 依 profile 判斷能否支援，例如 T&B part、E&P mission；不提供時視為全部支援。 */
  supports?(profile: ProfileDefinition): boolean;

  // 保底（I9）：必定合法的最小動作；回傳 undefined 代表「不歸我管」。
  duty?(view: GameView, selfId: string): BotCommand | null | undefined;

  // 策略窗口：第一個回傳非 undefined 的模組勝出（比照 rules 的 commands、moveBandit）。
  answerFrame?(turn: TurnContext, frame: PublicModulePendingView): BotCommand | null | undefined;
  setup?(turn: TurnContext): BotCommand | null | undefined;      // E&P setup、SF setup ship
  phase?(turn: TurnContext): BotCommand | null | undefined;      // 接管子階段，例如 E&P movement
  endWindow?(turn: TurnContext): BotCommand | null | undefined;  // 結束行動窗口的指令，例如 ep.startMovement

  // 候選：所有模組串接，與 base 候選放在同一尺度（勝利分當量除以 1 + eta）。
  preroll?(turn: TurnContext): Scored<BotCommand>[];   // C&K Alchemy、T&B 擲骰前的卡
  actions?(turn: TurnContext): Scored<BotCommand>[];   // 船、騎士、城牆、改良、橋……

  // base 窗口的調整（組合規則見 2.3）
  robberTargets?(view: GameView, selfId: string): readonly number[] | null;
  freeRouteCandidates?(turn: TurnContext): Scored<BotCommand>[];  // SF：免費路線可放船

  // 經濟與盤面模型
  economy?: {
    cardKinds?: readonly string[];                              // C&K commodities
    costs?(view: GameView): Readonly<Record<string, Cost>>;
    piecesLeft?(model: BoardModel): Partial<PieceCounts>;
    hexYield?(model: BoardModel, hex: number, building: { city: boolean }): Partial<Record<string, number>>;
    routeEdge?(model: BoardModel, edge: number): 'road' | 'ship' | 'blocked';
    scoreExtras?(turn: TurnContext): Plan[];                    // 島嶼獎勵、Strongest Ports、送貨
  };
  trade?: {
    goods?(view: GameView, selfId: string): Readonly<Record<string, number>>; // T&B gold（公開）
    goodValue?(turn: TurnContext, good: string): number;
  };

  // 伺服器與測試會用到的常數
  readonly pacing?: Readonly<Record<string, number>>;          // 併入 server THINK_MS
  readonly maxCommandsPerWindow?: number;                       // E&P movement
  readonly responseCommands?: readonly string[];                // 非行動者可送的指令（B-POLICY 合約檢查）
}
```

`heuristic.ts` 改為流程骨架，base 的現有邏輯成為預設處理器：

1. 有 `result` 時回 null。
2. 若有 `pending`：
   - 模組 frame 依 `ruleModules` 順序詢問 `answerFrame`，再詢問 `duty`。
   - base frame 用 base 處理器，套上 `robberTargets`、`cardKinds`、`freeRouteCandidates` 調整。
3. 若在 setup：先問各模組的 `setup`，都回 undefined 時用 base。
4. 非行動者：只回應報價，用 `trade.goods` 估值。
5. preroll：base 的騎士候選加上各模組的 `preroll`，選最佳，否則 `turn.roll`。
6. action：
   - 某個模組的 `phase` 接管時，直接回傳它的結果。
   - 否則把 base 與模組的 `actions` 放在一起評分；交易照舊；最後用 `endWindow` 或 `turn.end`。

`fallbackPolicy` 的組合順序：base 的 `pendingDuty`（套用 `cardKinds` 與 `robberTargets`），然後模組 `duty`，最後才是 base 的 roll 與 end。

### 2.3 組合 profile 與 `ruleModules` 的對應

- `botModulesOf(profile)` 等於 `profile.ruleModules.map(id => BOT_MODULES[id])`，順序與 rules 一致。SF+CK 為 `['seafarersCitiesKnights', 'seafarers', 'citiesKnights']`（`rules/src/profiles.ts:460,489`）。
- 組合規則比照 `rules/src/modules/README.md:94-108`：

| 鉤子類型 | 組合方式 |
|---|---|
| `answerFrame`、`duty`、`setup`、`phase`、`endWindow` | 依序詢問，第一個回傳非 undefined 者勝 |
| `preroll`、`actions`、`freeRouteCandidates`、`scoreExtras` | 串接 |
| `robberTargets` | 取交集 |
| `costs`、`cardKinds`、`pacing` | 合併 |

- frame 有 `module` 欄位，預設由擁有者處理，但組合模組排在第一順位，可以先攔截。
- SF+CK 的組合層需要的 Bot 鉤子很少：
  - 海盜追擊 `knight.chasePirate` 作為 action 候選。
  - 依 `hints.modules.seafarersCitiesKnights.bandit`（`seafarersCitiesKnights/index.ts:176-189`）選擇強盜或海盜。
  - 船被騎士壓住的情況已由 SF hints 的 `movableShips` 透過 `shipMoveBlock` 處理（`seafarers/ships.ts:125-144`），不必另外實作。
- `supports` 判定中，SF+CK 必須三個 BotModule 都存在，不能只靠 SF 與 CK。

---

## 3. 型別與資訊

### 3.1 模組 view 與 hints 型別：建議由 `@catan/rules` 匯出

現況：

- 只有 E&P 匯出型別：`rules/src/index.ts:12`；寫法是 `ReturnType<typeof projectState>` 與 `ReturnType<typeof hintsFor>`（`explorersPirates/index.ts:285,368`）。web 直接使用（`web/src/board/explorersPirates.ts:7-22`）。
- SF、C&K、SF+CK、T&B 由 web 各自宣告本地型別：
  - `web/src/board/seafarers.ts:16-31`
  - `web/src/board/citiesKnights.ts:40-107`
  - `web/src/board/seafarersCitiesKnights.ts:20-27`
  - `web/src/components/tb/model.ts:9-26`（`Record<string, unknown>`）
- SF 的 `project`／`actionHints` 寫在模組物件內（`seafarers/index.ts:70-103`），經過 `RulesModule` 介面後回傳型別是 `unknown`，必須先抽成具名函式才能匯出型別。C&K 已有具名函式 `projectCitiesKnights`、`citiesKnightsHints`（`citiesKnights/index.ts:198-214`）。

| 方案 | I2 | I3 | I7 | 重複程度 |
|---|---|---|---|---|
| 由 rules 匯出 `XxxView`／`XxxHints`（**建議**） | 不受影響：型別不提供額外資訊，Bot 仍只讀投影 | 只是型別匯出加上抽出具名函式，GameState、事件、錯誤碼都不變；建議把 I3 文字改成「規則行為不變」 | 不受影響（B-GUARD 允許 `@catan/rules`） | 只有一份；rules 改形狀時 bots 與 web 會在編譯期失敗 |
| 在 bots 內自行宣告 | 同上 | rules 完全不動 | 同上 | 變成 web 加 bots 兩份副本；漂移只能靠 B-GAME 在執行期發現 |
| 放在 protocol | — | — | **違反**：bots 只能依賴 rules（D3、`bots/test/guard.test.ts:48-50`） | — |

建議再加一個 `interface ModuleViewMap { seafarers: SeafarersView; … }`，bots 與 web 共用的 accessor 例如 `moduleView(view, 'seafarers')`。web 的本地型別可以逐步改用這份，不必一次完成。

### 3.2 ModuleCommand 從 `decide` 到 submit 的路徑

伺服器與協定已經接受模組指令，證據如下：

| 層級 | 位置 | 行為 |
|---|---|---|
| protocol | `protocol/src/index.ts:299-303` | `CommandRequest.command: { type: string } & Record<string, unknown>` |
| HTTP | `server/src/http.ts:432-445` | 只檢查 `command` 是物件 |
| GameCoordinator | `server/src/game.ts:249,277` | 雜湊整個 command；`applyCommand(... as unknown as Command)` 只是轉型 |
| rules | `rules/src/engine.ts:669-673,680,698-704,847-863` | 接受 `Command \| ModuleCommand`；未知 type 交給 `dispatchModuleCommand`；先做 disabled、pending、veto 檢查 |
| 實際用例 | `server/test/cities-knights.test.ts:181`、`server/test/ck-progress-privacy.test.ts:76-94` | 真人經同一路徑送 `progress.*` |
| BotDriver | `server/src/bot-driver.ts:376-381` | `command: decision.command as CommandRequest['command']` |

需要改的只有型別：`BotPolicy.decide` 改回傳 `BotCommand | null`，`ModuleCommand` 可從 `@catan/rules` 取得（`rules/src/modules/index.ts:4`）；`server/src/bot-driver.ts:74` 的 `Decision.command` 改為 `BotCommand`。protocol 不必改。
各模組的指令形狀由 bots 內的小型建構函式宣告，例如 `{ type: 'build.ship', edge }`。rules 端沒有模組指令的 union，形狀漂移由 B-GAME 的零拒絕檢查抓出。

另外建議在合約補一條：**策略不得讀 `view.events`**。BotDriver 投影時帶最近 40 筆事件（`server/src/bot-driver.ts:286-289`），測試 harness 不帶（`bots/test/harness.ts:53-55`），讀了就會讓兩邊的決定性不一致。

---

## 4. 支援範圍的粒度

| 方案 | 做法 | 評估 |
|---|---|---|
| 依 rules module（現況，SPEC §4.9） | `ruleModules.every(in BOT_RULE_MODULES)` | T&B 的 8 個 profile 只能一起開；E&P 的 5 個 mission 只能一起開；等 `tb-event-cards-*` 實作後（`rules/src/profiles.ts:343-349`）會被自動放行 |
| profile 白名單 | `BOT_PROFILE_IDS` | 明確，但新增 profile 時容易漏，且與模組能力脫鉤 |
| **模組加 part／mission 能力判定（建議）** | `botsCanPlay(p) = p.ruleModules.every(id => BOT_MODULES[id] && (BOT_MODULES[id].supports?.(p) ?? true))` | T&B 以 `profile.scenario` 加 `variants` 對應 part（`tradersBarbarians/index.ts` 的 `SCENARIO_PARTS`／`VARIANT_PARTS`，約第 15-27 行）；E&P 以 `epScenario(p.scenario).missions` 是否落在已支援的 mission 內（`epScenario` 已由 rules 匯出，`rules/src/index.ts:11`）。未知的 part 一律回 false |

要配合的修改：

- **support.test**：加一個「Bot 可玩的 profile id 清單」快照測試，讓任何開放都必須是刻意的變更。
- **server**：API 不變（`bot-seats.ts:49` 已傳入完整 `ProfileDefinition`）。修正 S7 的推算方式，改為 `botsCanPlay(getProfile(id))`。S8 改用 `registerFixtureProfile` 註冊含未知模組的 fixture。每版翻轉 S9 的四支測試。
- **protocol**：不必改，`ProfileView.botSeats` 已逐 profile 計算。`ServerConfigView.bots` 也不必改。
- **web**：邏輯不必改。文案 `lobby.bots.unsupported` 建議改為：
  - zh-Hant：「電腦對手尚未支援這個規則組合。」
  - en：「Bot opponents can't play this ruleset yet.」
  - message id 保留。另可選擇在 profile 選擇器加上「支援電腦對手」標示（非必要）。
- **SPEC §4.9 Rulesets（`docs/SPEC.md:188`）建議改寫為**：「bots play only profiles the built-in strategies support: every rules module the profile runs, and for a module made of independent parts (T&B scenarios and variants, E&P mission sets) every part it runs. … A profile joins the supported list only once the strategies issue its commands, answer its pending frames and bot-only games of it finish for every player count.」
  「today that is …」一句每版更新。R-BOT 驗收（`docs/SPEC.md:192`）已是通用寫法，不必改。

---

## 5. 測試基礎建設

### 5.1 harness 泛化

- `newBotGame({ profileId, players, seed, setupMode? })`：setupMode 預設取 `profile.setupModes`，優先 `variable`。
- `profileFor` 改為依 family 對應：base、sf、ck、sfck 的 3–4 人與 5–6 人各對應一個 profile；T&B、E&P 直接指定 profileId。
- 測試清單由 `PROFILES.filter(p => p.enabled && botsCanPlay(p))` 加上 `playerCounts` 推導出 `BOT_TEST_MATRIX`。開放新 profile 時會自動納入 B-GAME。
- 每個模組提供測試工具 `test/modules/<id>.ts`：

| 鉤子 | 內容 |
|---|---|
| `conservation(state)` | commodity、gold、fish、棋子守恆 |
| `hideDifferently(state, viewer)` | C&K 的進度卡手牌身分與牌庫順序（R-VIS，`rules/test/ck-progress-privacy.test.ts:1-6`）。E&P 沒有隱藏盤面（`rules/test/ep-privacy.test.ts:1-7`），只需擾動資源 |
| `perturb(state, rng)` | 模組專屬的擾動 |
| `responseCommands` | 非行動者可送的指令 |
| `mechanics(counters)` | 每局至少用到某些模組機制，例如 SF 有造船、C&K 有招募騎士 |

  可直接重用 rules 的測試輔助程式，例如 `rules/test/ck-checks.ts`。bots 測試已有跨套件匯入的先例（`bots/test/ck-road-building.test.ts:4`）。
- `supplyTotal`（`bots/test/harness.ts:193-200`）改為 base 資源加上模組的 `conservation`。

### 5.2 測試家族跨 profile 參數化

| 家族 | 參數化方式 |
|---|---|
| B-GAME | 對 `BOT_TEST_MATRIX` 做 `describe.each`，每個（profile, 人數）組合跑 N 個種子。檢查：勝利、零拒絕、無殘留 pending、守恆、合約；全部種子合計要達到模組的 mechanics 門檻 |
| B-POLICY | 決定性測試每個 family 跑 1 個種子；fuzz 對每個模組 `perturb`；合約檢查的非行動者清單併入模組 `responseCommands`（取代 `bots/test/policy.test.ts:18-25`） |
| B-FAIR | 每個 family 取快照，套用模組 `hideDifferently`；投影 JSON 必須相同，決策也必須相同 |
| B-GUARD | 放寬為允許 `'../'`，但解析後的路徑仍須在 `src/` 內（`bots/test/guard.test.ts:20`）；確認掃描到 `src/modules/**` |

### 5.3 卡住偵測

- `runBotGame` 目前在「所有座位都回 null 且沒有 open 報價」時判定卡住（`bots/test/harness.ts:172-182`），本身就是通用的，模組 frame 也涵蓋在內。
- 建議補強三點：
  1. 診斷資訊附上 pending kind、responders、模組子階段、最後 5 個指令。
  2. 加入「仿 BotDriver」模式（策略回 null 時改用 fallback），把「策略閒置但保底有動作」和「兩者都閒置」分開統計：前者在 B-GAME 算失敗，後者就是卡死。
  3. 加入進度看門狗：N 回合沒有任何人得分就判失敗。實測 `ep-land-ho` 用 base 策略會無限進行（4000 步、1270 回合）。
- 步數上限改為依 profile 設定，例如 E&P 與 C&K 設 15000。

### 5.4 量測結果

**base bot-only**（`base-bot-games.ts`，heuristic 混合 standard 與 easy，load 約 5）：

| 人數 | 每局 steps | 回合數 | decide 次數 | decide 平均 ms | decide 最大 ms | 每局 ms |
|---|---|---|---|---|---|---|
| 3 | 273–425 | 61–104 | 774–1219 | 0.030–0.043 | 0.59–1.97 | 170–258 |
| 4 | 205–361 | 47–86 | 778–1377 | 0.014–0.016 | 0.24–0.63 | 100–196 |
| 5 | 303–374 | 48–62 | 1454–1813 | 0.018–0.020 | 0.55–0.93 | 189–255 |
| 6 | 412–551 | 60–80 | 2291–3096 | 0.012–0.013 | 0.65–0.81 | 255–365 |

12 局合計 wall 2.9 s。在 load 13–96 下同一批 12 局，每局 391–12866 ms，decide 最大 411 ms。

**rules 腳本玩家一局**（`expansion-sims.ts all`，load 約 4；這些是試錯腳本，不是 Bot，回合數偏長）：

| 模擬 | 步數 | 回合 | 事件數 | ms |
|---|---|---|---|---|
| seafarers 3p／4p／5p／6p | — | 333／235／126／110 | 1678／1336／999／907 | 1876／1599／1152／1173 |
| ck 3p／4p／5p／6p | 約 495／652／1017／1245 | 158／190／198／208 | 1111–2495 | 869／1084／2283／2911 |
| sfck 3p／4p | — | 176／197 | 1189／1615 | 1133／1893 |
| ep land-ho 3p／4p | 337／516 | 26／38 | 426／641 | 383／571 |
| ep pirate-lairs 3p／4p | 758／537 | 83／42 | — | 986／677 |
| ep fish 3p／4p | 770／969 | 66／72 | — | 1122／1229 |
| ep spices 3p／4p | 760／685 | 74／55 | — | 1029／883 |
| ep full 3p／4p | 846／996 | 62／67 | 1096／1272 | 1179／1249 |
| tb traders／BA／trains／fishing／rivers（4p） | — | 177／109／125／93／121 | 697–1398 | 1324／658／792／632／1954 |

C&K 的步數是用 hook 觀察到的最大 step 值，屬於近似值。load 約 96 時同一批模擬 wall 1m57s，load 約 4 時為 32 s。

**單次 `projectGame` 加 `actionHints` 的成本**（`projection-cost.ts`，取終局狀態並改回 action phase）：base 0.023 ms、SF 0.045、CK 0.057、SF+CK 0.097、E&P full 0.144、T&B 0.046–0.051。投影不是瓶頸，成本主要在策略的搜尋與估值。

**現有測試套件：**

| 指令 | 負載 | 結果 |
|---|---|---|
| `pnpm --filter @catan/bots exec vitest run` | load 約 2 | 48/48 通過，Duration 16.5 s，wall 18.8 s，user 35.9 s |
| 同上 | load 44–96 | wall 161 s；`fallback.test.ts` 6 人案例跑 63.6 s，超過 30 s timeout 而失敗 |
| `pnpm --filter @catan/server exec vitest run test/bots.test.ts` | 高負載 | 31/32 通過，66 s；B-GAME 在 55 s 出現 `fetch failed: other side closed` |
| 同上，`-t "plays a whole game"` 單獨重跑 | 負載下降後 | 4.8 s 通過；判定為負載造成的偶發問題 |

**預算估計**（推測）：Bot 打擴充一局大約是 base 的 2–5 倍，也就是 0.3–2 s。若比照 base「每人數 10 種子」：

| 擴充 | 局數 | 估計 CPU |
|---|---|---|
| SF | 40 局 | 約 25 s |
| C&K | 40 局 | 約 40 s |
| T&B | 8 profile × 2 人數 × 10 = 160 局 | 約 120 s |
| E&P | 5 × 2 × 10 = 100 局 | 約 150 s |

repo 沒有 PR CI（`.github/workflows/docker-publish.yml` 只在 tag 觸發），所以這是本機 `pnpm verify` 的時間。建議：

- `pnpm test` 預設每個（profile, 人數）跑 3 種子；以 `BOTS_SEEDS=10` 作為 release 閘門；勝率另由 bench 量測。
- 每個擴充加入後，bots 套件 wall 增量上限 15 s（乾淨機器）。
- 每個模組一個測試檔，讓 vitest 平行執行。
- timeout 統一 120 s，修正 `bots/test/fallback.test.ts:45` 的 30 s。

### 5.5 server `bots.test.ts` 需要的跨 profile 案例

1. S7、S8 修正：支援判定改用 `botsCanPlay`；不支援的範例改用 fixture profile。
2. 每個新支援的擴充至少一局整局測試，比照 `server/test/bots.test.ts:953-1001`：真人座位也交給策略，經 HTTP 驗證模組指令、收據、零非 stale 拒絕。
3. 保底案例：用 `policyFor` 注入會出錯的策略，驗證在模組 frame 中由 fallback 合法回應，不進入 30 s 退避（比照 `server/test/bots.test.ts:621`）。
4. 多 responder frame：真人與 Bot 同為 responder 時，Bot 不搶答、不被拒（例如 Trains 的 `wagonBid`、Seafarers 的 gold）。
5. 重啟恢復：在模組 frame 中途或 E&P movement 中途重啟（比照 `server/test/bots.test.ts:836`）。
6. 各擴充的 server 測試翻轉 `botSeats` 與 `E_INVALID_BOT`（S9）。

### 5.6 bench 參數化

- `bench/run.ts` 的 `CONFIGS` 改為 `{ profileId, players, standard }`，CLI 加 `--profile`。
- 輸出加上：拒絕數、fallback 次數、模組機制計數、平均回合（與 rules 模擬對照）。
- 每版的發布 PR 附上 bench 表格，作為強度證據。

---

## 6. BotDriver 與伺服器

### 6.1 指令節奏

建議由各 BotModule 匯出 `pacing`，`@catan/bots` 合併成 `BOT_PACING`，server 以 `{ ...THINK_MS, ...BOT_PACING }` 查表。這樣之後每版不必修改 server。

| 類別 | 指令（例） | 建議 ms |
|---|---|---|
| 模組建造 | `build.ship`、`build.wall`、`knight.recruit`、`city.improve`、`ep.build*`、`tb.buildBridge`、`tb.buildBaCard` | 900 |
| 移動與步進 | `ep.moveShip`、`tb.wagonStep`、`tb.moveKnight`、`knight.move`、`ship.move` | 500–700（E&P 一回合十幾步） |
| 打牌 | `progress.play`、`tb.playKnight`、`tb.playSwiftJourney` | 1100 |
| frame 回應 | `gold.choose`、`barbarians.*`、`progress.discard`、`science.take`、`progress.*Answer`／`*Give`、`tb.fishSwap`、`tb.bidWagon`、`tb.baSteal`、`ep.placePirate`、`ep.robPlayer` | 700–1200 |
| 子階段與貨物 | `ep.startMovement`、`ep.load`、`ep.unload`、`ep.found`、`ep.deliver` | 600–800 |

### 6.2 擲骰演出

- C&K 的事件骰與紅骰在同一次 `turn.roll` commit：`turn.rolled`（`rules/src/engine.ts:999`）加上 `ck.eventRolled`（`citiesKnights/dice.ts:45`）。web 只為 `turn.rolled` 演出（`web/src/board/animation.ts:16-23`，2500 ms）。現有的 `ROLL_PRESENTATION_MS = 2800`（`server/src/bot-driver.ts:66,162`）已足夠。
- E&P 的 `ep.fishRolled`、`ep.chaseRolled` 沒有骰子演出，不必等待。可視需要多給約 1 s，讓玩家看清結果。

### 6.3 多步驟階段

- E&P movement：子階段存在模組狀態，`windowId` 不變。實測 rules 的 E&P 腳本中，單一視窗同一座位的指令數：

| 指標 | 數值 |
|---|---|
| p50 | 9–14 |
| p95 | 15–27 |
| 最大 | 18–30（full 4 人） |

  `MAX_BOT_COMMANDS_PER_WINDOW = 40`（`server/src/bot-driver.ts:70,303-312`）很可能被真正的策略超過。建議改為依 profile 取 `botModulesOf(profile)` 的 `maxCommandsPerWindow`，E&P 設 80 左右，其餘維持 40。
- `onEndTurn` defer：`turn.end` 成功後不換視窗，而是排入 frame（`rules/src/engine.ts:1125-1131`；Traders、Trains、BA 見 `tradersBarbarians/traders/index.ts:373-385`、`trains/index.ts:268-280`、`barbarians/index.ts:489-499`）。對 BotDriver 而言就是「接著有 frame 要回應」，不必改流程；策略與保底要能處理這些 frame。

### 6.4 多 responder frame 的詢問順序

- 模組各自決定是同時回應還是依序回應：
  - 依序：`gold.ts:93-94`、`barbarians.ts:197-198`、`trains/index.ts:194`
  - 同時：`barbarians.ts:161`、`trains/index.ts:186`
- `botActingOrder` 依座位排序、行動者最後；BotDriver 取第一個非 null 的決策（`server/src/bot-driver.ts:295-344`）。**只要 Bot 只在「輪到自己」時回應，詢問順序就不重要。**
- 保底必須採用同樣的資格判定：依序 frame 檢查 `responders[0] === self`，同時 frame 檢查 `includes(self)`。否則會被拒，觸發 30 s 退避（`server/src/bot-driver.ts:420-423`）。
- 保守的通用規則：保底只在 `responders[0] === self` 時回應。這兩類 frame 都一定接受，代價是同時 frame 可能多等一下。
- 建議在 BotDriver 增加診斷：若某 Bot 是唯一或第一位 responder，而策略與保底都回 null，記一筆 warn。

### 6.5 T&B gold 進入國內交易

- 引擎允許報價帶 `giveGoods`／`wantGoods`（`rules/src/engine.ts:1755-1756,1818-1820`）。同意時會檢查 goods 餘額（`:1873-1876`），結算時再查一次。
- BotDriver 的報價計時只看 offerId（`server/src/bot-driver.ts:164-167,436-476`），**不必改**。
- bots 的 `trade.ts` 需要調整：
  1. `offerGain` 納入 goods 估值。gold 的價值可由 coins part 的 `goldPerResource` 與 `tb.buyResource` 推得（`tradersBarbarians/coins/index.ts:124-133`）。
  2. `wantGoods` 超過自己餘額時一律拒絕。
  3. `ownOfferStep` 挑結算對象時，檢查對方公開的 gold 是否足夠。
  4. 主動開價可選擇是否用 gold。

### 6.6 伺服器修改清單

1. `server/src/bot-driver.ts:74`：`Decision.command` 改為 `BotCommand`。
2. `server/src/bot-driver.ts:40-64,431`：`THINK_MS` 併入 `BOT_PACING`。
3. `server/src/bot-driver.ts:70,303`：視窗指令上限改為依 profile。
4. （可選）`server/src/bot-driver.ts:330-342`：記錄「Bot 欠著 frame 卻沒有動作」的診斷。
5. `server/test/bots.test.ts` 與四支擴充測試，見 §5.5。
6. `bot-seats.ts`、`rooms.ts`、`http.ts`：**不必改**。

---

## 7. 發布流程（每個 0.4.x）

依 `RELEASING.md` 與 v0.4.0 的實際歷程（`3079189` rc.1、`8af1543` rc.2、`f1b9529` rc.3、`2e927ec` Merge PR #95、`a200840` release）：

1. 從 `master` 建 `release/v0.4.N` 分支。
2. 功能分支 `feat/bots-<slug>`，worktree 放在 `.worktrees/<slug>`。PR 指向 `release/v0.4.N`，以 squash merge 合併，subject 保留 `(#N)`，例如 `✨ feat(bots): play seafarers heading for new shores (#96)`。
3. master 有修正時，以 merge 方式併入 release 分支，不 rebase、不 force-push。
4. rc：直接在 release 分支推 `🔖 release: v0.4.N-rc.K`（subject 不帶 `#`），在該 commit 打 tag 並 push。用 `scripts/release-notes.sh` 加 `scripts/release-notes-lint.sh` 產生 `--prerelease` notes。
5. 發布：開 PR `release/v0.4.N → master`，以 **Create a merge commit** 合併。接著在 master 建 `🔖 release: v0.4.N`，打 tag，發布 GitHub Release。合併前先跑 `pnpm verify` 加上 `BOTS_SEEDS=10`。
6. 下一版的功能分支可以先從 master 開發，等下一個 release 分支建立後再改指向。避免 stacked PR 跨版本。

**每版都要更新的文件：**

| 位置 | 內容 |
|---|---|
| `docs/SPEC.md:188` | 「today that is …」支援清單 |
| `docs/aegis/specs/2026-11-01-bot-opponents.md:16,19` | 範圍；建議每個擴充另開 `docs/aegis/specs/<date>-bots-<expansion>.md` |
| `docs/API.md:141-147` | 支援判定說明（第一版改一次） |
| `docs/API.md:306,312` | 各擴充章節的「Bot 不可入座」 |
| `docs/FIDELITY.md:41-44,68,112,124,136,521,611-612` | profile 列的 no bot seats；R-* 證據列 |
| `README.md:163,169,176` | 加上 T&B 與 SF 段落的 Bot 註記 |
| `docs/aegis/INDEX.md` | 新增列；`docs/aegis/work/<date>-<slug>.md` |
| `scripts/<slug>/`、`docs/screenshots/<slug>/` | 瀏覽器證據（是否提交截圖待確認，見 §9） |
| `package.json` | 版號（只在 release commit 改） |
| i18n | `lobby.bots.unsupported` 只在第一版改 |

---

## 8. 上線順序

### 8.1 共用元件的實際依賴

| 共用元件 | 使用者 | 評估 |
|---|---|---|
| 海路與船隻路徑 | SF、SF+CK | 共用程度高：同樣是 `build.ship`、`ship.move`，SF+CK 的限制已反映在 SF hints 中 |
| 海路幾何 | E&P | 只能共用幾何（海邊、海路圖）。E&P 船是逐邊移動加貨物的另一套引擎，指令完全不同（比照 roadmap：「reuses … not its rules」） |
| 非資源卡與貨幣 | C&K commodity、T&B gold、E&P 金幣 | 共用一個「`CardKind` 加 goods 的手牌、成本與交易」抽象 |
| 騎士邏輯 | C&K、SF+CK、T&B BA | C&K 與 SF+CK 共用；T&B BA 的騎士（`tb.baPlaceKnight`、`tb.moveKnight`、`tb.baCapture`）語意不同，**只能共用「防禦估值」概念** |
| 回合結束 frame、依序多 responder frame | T&B 的 Trains、Traders、BA、Fishing；C&K 部分 frame | 平台層級處理 |

### 8.2 實測得到的成本訊號

- 近乎免費：
  - `tb-friendly-robber`、`tb-harbors`、`tb-friendly-robber-harbors` 沒有模組指令或 frame，只需強盜目標與 Strongest Ports 估值。
  - `sf-new-shores` 已合法可玩，但不會造船（品質問題）。
- 大型：C&K（23 種進度卡、騎士、改良、蠻族）、E&P（另一套 setup 與 movement 引擎）。

### 8.3 建議順序（工程依賴角度）

| 版本 | 內容 | 理由 |
|---|---|---|
| 0.4.1 | **平台加 Seafarers**（2 個 profile，3–6 人），可選附帶 T&B 三個 variant profile | SF 已合法，風險低；能驗證模組指令、依序 frame（gold）、setup 接管（setup ship）、paired 5–6、海路元件。T&B variant 幾乎零成本，能先驗證 part 判定 |
| 0.4.2 | **C&K**（2 個 profile） | 建立 `CardKind` 手牌與騎士元件；規模最大，建議用 rc 試玩 |
| 0.4.3 | **SF+CK**（2 個 profile） | 只需薄組合層，延續 0.4.2 的熟悉度 |
| 0.4.4 | **T&B 劇本**（rivers、fishing、trains、BA、traders；若 0.4.1 沒帶 variant 則一併納入） | 各 part 獨立；要處理回合結束 frame、多 responder、gold 交易。可再拆成兩版 |
| 0.4.5（加 0.4.6） | **E&P**，依 mission 分批：land-ho 加 pirate-lairs，之後 fish、spices、full | 引擎最獨特；mission 粒度可以分批 |

### 8.4 平台工作一次做完，還是分散到各版

**合約與基礎建設在 0.4.1 一次做完：**

- `BotCommand` 型別與 BotModule 介面（鉤子先保留，可以先不實作）。
- registry 與 `supports`。
- harness、測試工具與 B-* 參數化；卡住偵測與看門狗。
- server 的 pacing、視窗上限掛鉤；S7、S8 測試修正。
- i18n 文案；SPEC §4.9 改寫。

**各擴充特有的能力延到第一個需要它的版本：**

- 海路模型：SF。
- `CardKind` 經濟：C&K。
- goods 交易：T&B。
- 子階段接管：E&P。

在沒有實際使用者之前就先設計這些抽象，容易做錯。介面上先保留鉤子位置，之後的版本只負責實作。

---

## 9. 風險、未決問題與需要使用者決定的事

### 9.1 風險

1. **I9 實際上不保證不卡死**：模組保底寫錯時，BotDriver 會每 30 s 重試一次（`server/src/bot-driver.ts:420-423`）。每個模組的保底都必須從 hints 取值，確保合法，並由「仿 BotDriver」模式的 B-GAME 覆蓋。
2. **「合法」不等於「會玩」**：base 策略能贏 New Shores，卻從不造船。SPEC 的「issue its commands and answer its frames」需要量化門檻（見 9.3 第 3 點）。
3. **E&P 節奏與上限**：每回合 15–30 個指令，以 900 ms 計約 14–27 s；並且接近每視窗 40 的上限。
4. **測試時間**：每加一個擴充，B-GAME 矩陣就變大；在高負載下已觀察到 timeout（`fallback.test.ts` 6 人案例 63.6 s 超過 30 s）與 server B-GAME 的 socket 偶發失敗。
5. **組合誤判**：S7 的推算方式在 SF+CK 與 T&B 上會算錯；E&P 與 T&B 若依模組開放，會連帶放行尚未實作的 part。
6. **合約條文要修訂**：規則 3「非行動者只回應 pending 與報價」大致仍成立；規則 4「行動者無事時回 `turn.end`」要改為「回 `endWindow` 或 `turn.end`」（E&P 需先 `ep.startMovement`）；I3 的文字要放寬為「規則行為不變」。
7. **paired 5–6 人**：SF、C&K、SF+CK 都有 paired profile；模組指令對 Player 2 的限制（例如能否造船、招募騎士）要由 B-GAME 5–6 人覆蓋。
8. **推測：免費路線只剩船**（A6）可能卡住，這次 24 局未觸發。

### 9.2 未決問題

- web 的本地型別要不要在同一輪改用 rules 匯出的型別，還是只讓 bots 使用。
- bots 測試直接匯入 rules/test 的輔助程式（已有先例），還是在 bots/test 內複製一份。
- Bot 版本的瀏覽器證據與截圖是否提交。記憶紀錄只授權擴充包 stack 提交截圖。

### 9.3 需要使用者決定

1. **上線順序**：採 §8.3 的「SF → C&K → SF+CK → T&B → E&P」嗎？0.4.1 要不要附帶 T&B 的三個 variant profile？這會違反「一版一個擴充」，但幾乎沒有成本，還能先驗證 part 判定。
2. **支援粒度**：是否同意改為「模組加 part／mission 能力判定」，並照 §4 修訂 SPEC §4.9？E&P 依 mission、T&B 依劇本分批，還是各自一次放完？
3. **「支援」的品質門檻**：只要合法加完局，還是另加門檻？例如 bench 中 standard 對 easy 的勝率不低於公平份額；每局至少使用某些模組機制；平均回合數不超過 rules 模擬的某個倍數。
4. **測試預算**：預設 3 種子、release 閘門 10 種子；每個擴充 wall 增量上限 15 s，可以接受嗎？
5. **型別匯出**：同意在 rules 增加只有型別的匯出（並抽出具名投影與 hints 函式）嗎？
6. **節奏**：E&P 步進類指令縮短到 500–700 ms，視窗上限依 profile 放寬，可以嗎？
7. **rc 流程**：每個 0.4.x 都走 `release/v0.4.N` 加 rc 試玩，還是小版本直接從 master 發 stable？

---

## 附錄：量測與探查指令

探查腳本都在 `/tmp/katan-bot-research/platform/`，在 repo 根目錄執行。`rules/test/helpers.ts:49` 使用 parameter property，strip-only 模式無法載入，所以涉及 rules 測試腳本的都改用 `--experimental-transform-types`。

```bash
# base bot-only 一局（load 約 5 與 13–96 各跑一次）
node --experimental-strip-types /tmp/katan-bot-research/platform/base-bot-games.ts
# rules 擴充模擬一局（load 約 4 與約 96 各跑一次）
node --experimental-transform-types --no-warnings /tmp/katan-bot-research/platform/expansion-sims.ts all
# 每視窗指令數（E&P 精確值，C&K 為近似值）
node --experimental-transform-types --no-warnings /tmp/katan-bot-research/platform/window-commands.ts
# 投影加 hints 成本
node --experimental-transform-types --no-warnings /tmp/katan-bot-research/platform/projection-cost.ts
# base 策略加 BotDriver 保底語意，跑各擴充 profile
node --experimental-strip-types --no-warnings /tmp/katan-bot-research/platform/probe-profiles.ts
node --experimental-strip-types --no-warnings /tmp/katan-bot-research/platform/probe-more.ts   # 多種子，含 friendly robber 原型
# 現有測試套件
pnpm --filter @catan/bots exec vitest run --reporter=verbose
pnpm --filter @catan/server exec vitest run test/bots.test.ts --reporter=verbose
pnpm --filter @catan/server exec vitest run test/bots.test.ts -t "plays a whole game"
```

`probe-more.ts` 的彙總結果：

| profile | 人數 | 完成局數 | 平均回合 |
|---|---|---|---|
| sf-new-shores-2025 | 3／4 | 8/8、8/8 | 90／98 |
| sf-new-shores-paired-2025 | 5／6 | 4/4、4/4 | 90／93 |
| tb-harbors-2025 | 3／4 | 6/6、6/6 | 69／88 |
| tb-rivers-2025 | 3／4 | 6/6、6/6 | 70／67 |
| tb-friendly-robber-2025（補強盜目標） | 3／4 | 6/6、6/6 | 65／72 |
| tb-friendly-robber-harbors-2025（補強盜目標） | 3／4 | 6/6、6/6 | 73／72 |

以上全部零拒絕、零 fallback。
