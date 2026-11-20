# Traders & Barbarians 電腦對手：實作計畫（v0.4.4）

- 日期：2026-11-04；2026-11-20 刷新（§12）
- 狀態：**執行中（2026-11-20 起）。** 使用者指示「直接照計畫進入開發」，§10 的 D-TB1–D-TB7 全部採用建議。切片 PR 依 `RELEASING.md` 指向 `release/v0.4.4` 並 squash merge（§5、§7）。刷新後交給 Orchestrator 決定的合約細節列在 §12.4。
- 前置閱讀：
  - 整體策略：`docs/aegis/plans/2026-11-04-expansion-bots-roadmap.md`（下稱「策略」）
  - bot 規格：`docs/aegis/specs/2026-11-01-bot-opponents.md`
  - rules 文件：`docs/FIDELITY.md` 的 §Traders & Barbarians（:674 起）與 R-TB 證據列（:143-149）
  - 第一輪研究：`docs/aegis/work/2026-11-04-bots-traders-barbarians-research.md`（清單不再重抄；探查腳本當時放在 `/tmp/katan-bot-research/traders-barbarians/`，沒有提交）
  - 0.4.3 工作紀錄：`docs/aegis/work/2026-11-12-bots-seafarers-cities-knights.md`（fold、`rescore`、決策雜湊比對 D1、bench 時機 D6）
- 證據基準：`58fe789`（v0.4.3），原稿以 `a200840`（v0.4.0）為準。下列路徑在兩者之間沒有任何變動（`git diff a200840 58fe789` 為空），所以這些路徑的行號沿用原稿：`TB/**`、`R/analysis.ts`、`packages/rules/test/tb-*.test.ts`。bots、server、`R/engine.ts`、`R/project.ts`、`R/profiles.ts`、`R/index.ts` 與文件的行號，已依 `58fe789` 改寫在各節。
- 縮寫：`TB/` = `packages/rules/src/modules/tradersBarbarians/`；`R/` = `packages/rules/src/`；`B/` = `packages/bots/src/`；`S/` = `packages/server/src/`。
- 「實測」指本輪以 `node --experimental-transform-types` 跑 plus 原型量得的結果。plus 原型是 base 策略加上最小的模組處理，腳本為 `probe-mechanics.ts`、`probe-fbseat.ts`。「推測」指依規則與常數推算、尚未用最終策略量測的數字。耗時只當參考，結論以步數、局數、計數等決定性指標為準。

## 1. 目標與範圍

0.4.4 為 8 個 T&B profile 的 3–4 人桌開放 Bot 座位。依策略 §4.9，平台在這一版補上三件事：

- goods 估值；
- 以 part 為單位的 `supports`；
- 兩類測試：回合結束時排入的 frame（`onEndTurn` defer），以及依序回應的多 responder frame。

| profile | rules part（順序同 `TB/index.ts:28-40`） | 目標 VP | 代表機制 |
|---|---|---|---|
| `tb-friendly-robber-2025` | `friendly-robber` | 10 | 受保護玩家；全部受保護時只能放沙漠 |
| `tb-harbors-2025` | `harbors` | 11 | Strongest Ports 2 VP（`TB/variants/harbors.ts:41-58`） |
| `tb-friendly-robber-harbors-2025` | `friendly-robber`、`harbors` | 11 | 上兩者合併 |
| `tb-fishing-2025` | `tb-fishing` | 10，持舊靴者 +1 | 魚片、`tb.spendFish`、`tb.giveBoot`、`fishSwap` frame |
| `tb-rivers-2025` | `tb-coins`、`tb-rivers` | 10 | 橋、金幣買賣、Wealthiest +1／Poor −2 |
| `tb-merchant-trains-2025` | `tb-merchant-trains` | 12 | 投標、分配與放置車廂；車廂所在的邊權重 2 |
| `tb-barbarian-attack-2025` | `tb-coins`、`tb-barbarian-attack` | 12 | BA 卡、騎士、俘虜、征服 |
| `tb-traders-barbarians-2025` | `tb-coins`、`tb-traders-barbarians` | 13 | 車隊路線、運貨、蠻族、蠻族騎士卡 |

- **範圍外**
  - `tb-event-cards*`：`implemented:false`、`enabled:false`（`R/profiles.ts:354-363`，旗標來自 `:301` 的 `EVENT_DECK_CLOSED`）。這些 profile 必須維持 Bot 不可玩，並以測試鎖住（§3.3）。
  - Catan for Two、5–6 人，以及和其他擴充或劇本的組合（`docs/FIDELITY.md:685-693`）。
  - Bot 主動提出含 gold 的報價（策略 §4.8）。
  - hard：`hardSupports` 只接受沒有 rules module 的 profile（`B/support.ts:25-27`），T&B 開放後自動只有 easy、standard，不必寫程式。server 測試要涵蓋拒絕 hard 的案例。
- **限制**
  - 不改 rules 行為（P8、I3）。只匯出型別與常數，並把投影與 hints 抽成具名函式。
- **品質**
  - Q1 必過；Q2 依 §6.3 的門檻；Q3 只報告（策略 §3.1）。
  - standard 與 easy 都要發出模組指令（DoD 1）。FR 與 H 沒有模組指令，改用 §6.3 的行為指標。

## 2. 現況與落差

v0.4.0 時，`BOT_RULE_MODULES` 是空的，server 測試也斷言 T&B 沒有 Bot 座位。到了 0.4.3（`58fe789`），`BOT_RULE_MODULES` 已改為註冊表 `B/modules/registry.ts:13-17`，裡面只登記 SF、C&K 與 SF+CK 三個模組，仍然沒有 T&B。server 測試斷言 T&B 沒有 Bot 座位的位置是 `packages/server/test/traders-barbarians.test.ts:67-89`。

第一輪量測：

- plus 原型：320 局全部終局，0 拒絕。
- 只走保底：BA 0/10 局終局，Traders 5/10 局終局。所以終局要靠 standard 與 easy 的策略，保底只負責不卡死。

下表的證據欄已換成 `58fe789` 的位置；現況欄說明 0.4.1–0.4.3 處理到哪裡（細節見 §12.2）。

| # | 落差 | 證據（`58fe789`） | 現況 | 切片 |
|---|---|---|---|---|
| G1 | 模組 frame 不論在策略或保底都回 null，整桌無聲停住 | `B/heuristic.ts:74-77`、`B/fallback.ts:28-39` | **平台已修（0.4.1）**：frame 先交給模組的 `answerFrame`，沒有模組回答時改走保底；保底在自己是 `responders[0]` 時詢問模組的 `duty`。T&B 只缺模組本身 | S2 |
| G2 | 強盜候選排除了目前所在格，也不看保護。FR 在全部受保護時，即使強盜已在沙漠也只能選沙漠；引擎接受模組列入的目前所在格 | `B/base/robber.ts:51-64`（fold 初值）、`:84-97`（fold）、`:104-117`（`banditChoice`）、`B/base/duty.ts:22-26`；`TB/variants/friendlyRobber.ts:34-41`；`R/engine.ts:1495-1515` | **平台已修（0.4.3 SFCK-P）**：fold 之後不再排除現位格；fold 結果過濾後沒有候選時，直接取第一項，不消耗亂數。T&B 只需由模組的 `robberTargets` 回傳 `robberHexes` | S3（原為 S1） |
| G3 | 個人勝利分只放在 `PublicPlayerView.victoryTarget`（與 profile 不同時才出現），bots 只讀全域值 | `R/project.ts:152-153`；`B/heuristic.ts:254`、`B/base/robber.ts:32`、`B/trade.ts:80` | 未修 | S1 |
| G4 | Traders 停用最長道路（`minLongestRoad=Infinity`），bots 仍為它鋪路 | `TB/traders/index.ts:369-372`；`B/economy.ts:446-468`、`B/base/roads.ts:22-23` | 未修。`awards` 只有型別，骨架沒有呼叫（`B/modules/types.ts:122-123`） | S1、S7 |
| G5 | 蠻族騎士卡計入最大騎士團（`playedKnights`），bots 只認 `knight` | `TB/traders/index.ts:152-163`；`B/heuristic.ts:248-259`、`B/economy.ts:434-444` | 部分。`devCard` 計畫的騎士團加值讀的是 `playedKnights`，rules 已把蠻族騎士卡計入，所以這部分估值正確；`knightDecision` 只打 `knight`，`tb.playKnight` 要由 S7 的 preroll／actions 打出。不必改共用檔 | S7 |
| G6 | Rivers 的 12 格另有一個 2（`extraNumbers`），bots 的產量只讀 `numbers` | `TB/rivers/board.ts:103`、`R/project.ts:255`；`B/board.ts:125` | 未修 | S1 |
| G7 | 橋被算進道路存量，rules 不算 | `B/board.ts:253-264`（`:261`）；`R/analysis.ts:49` | 部分。`roadStockLeft`（`B/board.ts:280-291`）已經不算橋，所以免費道路的保底是對的；`piecesOnBoard` 仍然算橋，`Economy.left.roads` 因此偏低 | S1 |
| G8 | 同意報價時，引擎同時檢查雙方的 goods，bots 只估資源 | `R/engine.ts:1907`（同意）、`:2013`（結算）、`:1824-1831`；`B/trade.ts:44-50`、`:67-73` | 部分。0.4.1 的規則 9 防護會拒絕所有含 goods 的報價，所以不會出現「同意後才被拒」；但 gold 仍然無法估值 | S1、S3 |
| G9 | `wagonBid` 依序回應（`responders[0]`），`wagonAssign` 同時回應（`includes`） | `TB/trains/index.ts:183-213` | **平台已支援**：策略以 `includes` 過濾（`B/heuristic.ts:75`），保底與 `botOwesAction` 以 `responders[0]` 判定（`B/fallback.ts:33`、`:90`）。harness 與 server 每一步都會輪詢所有 Bot（`packages/bots/test/harness.ts:311-335`、`S/bot-driver.ts:384-437`）。只缺 T&B 的實作與測試 | S2、S5、S9 |
| G10 | 回合結束時排入的 frame：Trains 投標、BA 騎士移動、Traders 每回合的車隊移動 | `TB/trains/index.ts:268-278`、`TB/barbarians/index.ts:489-498`、`TB/traders/index.ts:373-385`；`R/engine.ts:1148-1168`（defer 在 `:1163`） | 平台不必改；缺測試 | S2、S9 |
| G11 | `activeParts` 靜默略過未知 variant，event-cards 會被解析成只剩 FR | `TB/index.ts:45-56` | 未修。這是 rules 行為，不改；由 `supports` 讀原始 id 處理 | S2 |
| G12 | B-POLICY 的「強盜不放自己的格」缺少「還有其他合法格」的條件，FR 下會誤報 | `packages/bots/test/policy.test.ts:72-77` | 部分。`policy.test.ts` 只跑 `GENERIC_MATRIX`（base），擴充由各自的 family 測試檔自帶合約檢查；`sfck-game.test.ts:178-182` 已經有「還有其他合法格才算違規」的寫法，T&B 照用即可。`policy.test.ts` 不必改 | S2（工具）、S3–S8 |
| G13 | Fishing 的道路 hints 不檢查道路存量，`spendFish` 會檢查 | `TB/fishing/index.ts:389-409` 對照 `:195-282` | 未修（rules 不改）；S4 以 `roadStockLeft`（`B/board.ts:280`）自行檢查 | S4 |

刷新時另外記下的兩項觀察（不是阻擋條件，§12.2）：

- **BA 被征服的格不生產**（`TB/barbarians/index.ts:468-470`），bots 的產量估計看不到這件事。S6 可以用 0.4.2 已接上骨架的 `economy.hexYield`，對被征服的格回 `{}`，不必改共用檔。
- **Trains 車廂下的道路在最長道路中算 2**（`TB/trains/index.ts:285-291`），bots 的 `routeLength` 不加權。S5 若需要，用 `scoreExtras` 估值，不改 `board.ts`。

## 3. 介面摘要

### 3.1 rules 匯出（S0，屬 P8 允許範圍，依策略 §4.3）

`58fe789` 的 `R/index.ts` 沒有任何 T&B 匯出：`ModuleViewMap`、`ModuleHintsMap`（`R/index.ts:84-101`）只有 `seafarers`、`explorersPirates`、`citiesKnights`、`seafarersCitiesKnights`。部分常數已經是 part 檔內的 `export const`，例如 `TB/coins/index.ts:16-19` 的 `GOLD_SUPPLY`、`GOLD_PER_RESOURCE`、`PURCHASES_PER_TURN`，`TB/variants/harbors.ts:15` 的 `STRONGEST_PORTS_POINTS`，`TB/trains/index.ts:15` 的 `WAGON_SUPPLY`，但都還沒從 `R/index.ts` 轉出。下表全部屬於 S0 尚未完成的工作。

| 類別 | 名稱 | 來源 |
|---|---|---|
| 具名函式 | 7 個 part 的 `project` 與 `actionHints` 抽成 `fishingView`／`fishingHints` 這類具名函式，型別用 `ReturnType` 推導。part 物件標註為 `TbPart`（`TB/part.ts:14-21`），方法的回傳型別會被抹成 `unknown`，所以一定要先抽成具名函式，比照 `R/modules/seafarersCitiesKnights/index.ts:152`、`:170` | 各 part 的 `index.ts` |
| view／hints 型別 | `TbFishingView`/`Hints`、`TbCoinsView`/`Hints`、`TbRiversView`/`Hints`、`TbTrainsView`/`Hints`、`TbBarbarianAttackView`/`Hints`、`TbTradersView`/`Hints`、`TbHarborsView` | 同上 |
| 組合型別 | `TradersBarbariansView`：以 part id 為鍵的紀錄，對應 `TB/index.ts:184-188`。`TradersBarbariansHints`：以 part id 為鍵，另含 `targets`、`board`、`robberHexes?`，對應 `TB/index.ts:194-215`。兩者分別加進 `ModuleViewMap.tradersBarbarians`、`ModuleHintsMap.tradersBarbarians` | `TB/index.ts` |
| frame data | `TbVoteData`、`TbTreasonData`、`TbKnightsData`、`TbMoveData` | trains、barbarians、traders |
| part 對照 | `TB_SCENARIO_PART_IDS`、`TB_VARIANT_PART_IDS`：由 `SCENARIO_PARTS`、`VARIANT_PARTS`（`TB/index.ts:28-40`）的 `id` 推導 | `TB/index.ts` |
| 常數 | `TB_FRAME_KINDS`、`FISH_COSTS`、`FISH_LIMIT`、`FISH_SUPPLY`、`GOLD_PER_RESOURCE`、`PURCHASES_PER_TURN`、`BRIDGE_COST`、`BRIDGE_GOLD`、`WAGON_SUPPLY`、BA 卡成本與牌組、`CONQUER_AT`、`WAGON_LEVELS`、`UPGRADE_COSTS`、`BOOST_MP`、`STRONGEST_PORTS_POINTS`；另加 `TB_PENDING_COMMANDS`，即 `tradersBarbariansModule.pendingCommands`（`TB/index.ts:172`，共 15 個） | 各 part |

S0 的驗收是「投影不變」：rules 既有的 T&B 模擬測試全部通過，並新增 `packages/rules/test/tb-exports.test.ts`，斷言 8 個 profile 在固定種子下，`project` 的 JSON 與抽出前完全相同。寫法比照 0.4.3 SFCK-X 的 `packages/rules/test/sfck-exports.test.ts`。

### 3.2 bots 模組（`B/modules/tradersBarbarians/`）

| 檔案 | 內容 | 切片 |
|---|---|---|
| `index.ts` | 實作 BotModule `tradersBarbarians`，依 active part 組合各 `TbPartBot`；在 `B/modules/registry.ts:13-17` 的 `REGISTERED` 加一行 | S2 |
| `part.ts`、`parts.ts` | `TbPartBot` 介面；part id 對 TbPartBot 的表；`TB_READY_PARTS`（S2 時是空集合，S9 才翻開） | S2；S9 只改一行 |
| `view.ts`、`frames.ts` | 型別化的 accessor，例如 `tbView`、`tbHints`、`goldOf`，用 `moduleView`／`moduleHints`（`B/modules/view.ts:17-30`）取值；frame kind 常數；P3 資格判定 `isMine` | S2 |
| `duty.ts` | §4.1 的整張保底表；S2 合併後凍結 | S2 |
| `graph.ts` | 車隊與騎士的最短路徑與可達性 | S2 |
| `coins.ts`、`variants.ts`、`fishing.ts`、`rivers.ts`、`trains.ts`、`barbarianAttack.ts`、`traders.ts` | 各 part 的策略。S2 先放只含 `id` 的 stub | S3–S8 |

```ts
// 2026-11-20 依 58fe789 的 BotModule（B/modules/types.ts:133-185）修訂：
// 加上 setup、planStep；goodValue 改為 trade（與 BotTradeHooks 同形）；候選陣列改為 readonly。
export interface TbPartBot {
  readonly id: string;  // rules part id，例如 'tb-fishing'
  answerFrame?(turn: TurnContext, frame: PublicModulePendingView): BotCommand | null | undefined;
  setup?(turn: TurnContext): BotCommand | null | undefined;
  preroll?(turn: TurnContext): readonly Scored<BotCommand>[];
  actions?(turn: TurnContext): readonly Scored<BotCommand>[];
  planStep?(turn: TurnContext, plan: Plan): BotCommand | null | undefined;
  robberTargets?(view: GameView, selfId: string, targets: readonly BanditTarget[]): readonly BanditTarget[];
  readonly economy?: BotEconomyHooks;
  readonly trade?: BotTradeHooks;
  readonly pacing?: Readonly<Record<string, number>>;
  readonly responseCommands?: readonly string[];
}
```

`index.ts` 在模組內部組合各 part，規則與骨架相同：

- part 依 `activeParts` 的順序詢問。frame、`setup`、`planStep` 由第一個 `!== undefined` 的答案勝出（`firstAnswer`，`B/modules/compose.ts:15-24`）。候選全部串接（`collectScored`，`:27-37`）。`robberTargets` 依序折疊。
- economy 鉤子：
  - `costs`、`piecesLeft`：先出現的優先。
  - `scoreExtras`：串接，計畫 kind 一律是 `tradersBarbarians.<名稱>`（`B/modules/types.ts:77`），`planStep` 依 kind 交回對應的 part。
  - `hexYield`：第一個非 undefined 勝出。
  - `discardLimit`：依序折疊。
  - `awards`：任一 part 回 `false` 就關閉（§12.4 C1）。
- `trade.goods`：合併各 part 的回傳。`trade.goodValue`：第一個非 undefined 勝出。目前只有 coins 會實作這兩個鉤子。
- `responseCommands`：等於 `TB_PENDING_COMMANDS` 這 15 個指令，做法比照 C&K 的 `CK_PENDING_COMMANDS`（`B/modules/citiesKnights/index.ts:31-45`）。測試要和 rules 的 `pendingCommands` 對照；`wagonPlace` 可能由非行動者放置（多數持有者），所以不能只列一部分。

T&B 使用的平台鉤子：

- `supports`、`duty`、`answerFrame`、`setup`、`preroll`、`actions`、`planStep`、`robberTargets`；
- `economy` 的 `costs`、`piecesLeft`、`hexYield`（BA 被征服的格）、`scoreExtras`、`discardLimit`（若 part 需要），以及 S1 接上骨架的 `awards`（§11-1）；
- `trade` 的 `goods`、`goodValue`（S1 接上骨架）；
- `pacing`、`maxCommandsPerWindow`、`responseCommands`。

T&B 不使用 `phase`、`endWindow`、`banditCandidates`、`freeRouteCandidates`、`rescore`、`routeEdge`、`cardKinds`：gold 不是 `CardKind`，屬於 goods（F10）。

### 3.3 `supports`（S2）

```ts
supports(profile) {
  const scenario = profile.scenario ? TB_SCENARIO_PART_IDS[profile.scenario] : [];
  if (scenario === undefined) return false;                 // 未知劇本
  const variants = profile.variants.map((v) => TB_VARIANT_PART_IDS[v]);
  if (variants.some((id) => id === undefined)) return false; // 'event-cards' 在這裡被擋下
  return [...scenario, ...variants].every((id) => TB_READY_PARTS.has(id!));
}
```

`profile.scenario` 與 `profile.variants` 的型別見 `R/profiles.ts:114-115`。這裡必須讀原始的 `scenario` 與 `variants`，不能用 `activeParts`：它會丟掉未知 variant（`TB/index.ts:50-53`），event-cards 會因此被放行。`botsCanPlay`（`B/support.ts:17-22`）只呼叫 `supports`，模組本身一直都是註冊狀態。

`tb-support.test.ts` 鎖住以下兩點：

- 4 個 `tb-event-cards*` 的 `supports` 一律回 false。要直接呼叫 `supports`，因為這些 profile 本來就是 `enabled:false`，不能只看 `botsCanPlay`。
- 測試中把一個 part 移出 `TB_READY_PARTS` 時，只有含該 part 的 profile 會關閉。

## 4. 設計

### 4.1 保底（`duty.ts`；規則 7）

保底只用 hints 與 view 裡的現成候選。依序回應的 frame 檢查 `responders[0]===self`。同時回應的 frame 由 standard 用 `includes(self)` 回應；保底保守起見，同樣只在 `responders[0]===self` 時動作（P3）。平台在 `B/fallback.ts:33` 已經這樣做：自己不是第一位 responder 時，連模組的 `duty` 都不會被詢問。

`duty` 不得 throw（`B/modules/types.ts:140-144`）。server 的保底呼叫在 `S/bot-driver.ts:421`，不在 try 裡；`types.ts` 的註解仍寫 `:332`，由 S1 的合約 commit 順手更正。

| # | frame 或強制動作 | 最小動作 | 為何一定合法 | 證據 |
|---|---|---|---|---|
| 1 | `fishSwap` | `tb.fishSwap {token:null}` | 放棄是合法的，並用掉本回合的交換 | `TB/fishing/index.ts:104-117,302-330` |
| 2 | `wagonBid`（依序） | `tb.bidWagon {wool:0,grain:0}` | 出價 0 一定付得起 | `TB/trains/index.ts:190-213` |
| 3 | `wagonAssign`（同時） | `tb.assignWagon` 到 `board.targets[0]` | 候選來自 hints；只有出價者會在 responders 裡 | `:139-154,215-231,316-332` |
| 4 | `wagonPlace` | `tb.placeWagon` 到 `board.targets[0]` | 同上；出價全為 0 時由行動者放置 | `:149-151,233-245` |
| 5 | `baSteal` | `tb.baSteal` 對 `stealVictims[0]` | hints 只列出有手牌的對手 | `TB/barbarians/index.ts:289-299,578-580` |
| 6 | `baCapture` | `tb.baCapture` 到 `board.targets[0]` | 抽卡時的替換迴圈保證有目標（空目標的理論例外見 R10） | `:179-187,220-230,550` |
| 7 | `baKnighthood` | `tb.baPlaceKnight` 到 `board.targets[0]` | 只有能放騎士時才開這個 frame | `:196-201,551-554` |
| 8 | `baSwiftKnight` | `tb.baPlaceKnight` 到 `board.targets[0]` | 任何空邊都可以放 | `:202-207,555-558` |
| 9 | `baTreason` | `tb.baTreason` 用 `treasonMoves[0]` | 由 `treasonMoves` 產生 | `:208-214,255-287` |
| 10 | `baKnights`（回合結束時排入） | 有停在城堡邊、且有落點的己方騎士時，用 `targets['tb.moveKnight:<e>:0'][0]` 移走；沒有時送 `tb.endKnights` | `endKnights` 只在城堡邊騎士有落點時拒絕；落點不含城堡邊 | `:323-370` |
| 11 | `tbBarbarian`（擲出 7） | `tb.moveBarbarian`：`barbarians[0]` → `targets['tb.barbarian:'+from][0]` | 落點是所有沒有蠻族的邊 | `TB/traders/index.ts:118-133,423-425` |
| 12 | `tbWagon`（每回合結束） | `tb.wagonStop`；有 Swift Journey 的額外移動時再送一次 | stop 在任何狀態都可以送 | `:219-233,297-301,373-385` |
| 13 | FR 的 `moveRobber` | 不必寫 T&B 的 duty：base 的 `pendingDuty` 取 fold 的第一項（`B/base/duty.ts:22-26`），而 T&B 的 `robberTargets` 會把集合換成 `robberHexes`，可能包含目前所在格 | hints 已套用 FR 的縮減；引擎接受模組列入的格 | `TB/index.ts:209-213`；`R/engine.ts:1495-1515` |
| 14 | FR 的騎士卡、Traders 的蠻族騎士卡與 Swift Journey | 不打 | 打牌不是強制動作 | — |
| 15 | base 的棄牌、偷牌、豐收之年、道路建設 | 沿用 base 的 `pendingDuty` | base 未改；Traders 牌組內有道路建設；免費道路已用 `roadStockLeft` 檢查存量，不算橋 | `B/base/duty.ts:13-49` |
| 16 | setup，包括 BA 與 Traders 第 2 輪放城市、Fishing 第 2 輪拿魚 | `setup.placeBuilding` 用 `legalSettlements[0]` | 引擎依 `setupBuilding` 自動決定放城市 | `B/base/duty.ts:52-63`（保底先問 base，`B/fallback.ts:46`）；`TB/barbarians/index.ts:467`、`TB/traders/index.ts:337` |
| 17 | preroll、action | `turn.roll`、`turn.end` | Traders 擲出 2 或 12 會自動重擲 | `B/fallback.ts:47-56`（先問模組的 duty；模組回 null 時不送預設） |

保底的驗收（S2）：

- 每一列都有固定盤面的 I9 單元測試，分別測保底、standard 與 easy。
- 8 個 profile 各跑一次「全部座位只走保底」的有界局，結果是 0 拒絕，而且每一步都有動作。

### 4.2 standard 與 easy

分數尺度沿用策略 §4.2，以「勝利分當量 ÷ (1+eta)」計，資源先換算成資源當量。

| part | standard | easy（P9：必須終局，可少用進階機制） |
|---|---|---|
| variants（S3） | **FR**：`robberTargets` 直接回傳 `moduleHints(view.hints,'tradersBarbarians')?.robberHexes`；hints 缺漏時原樣回傳收到的集合。之後由 base 的 `banditChoice` 在集合內選阻擋價值最高的格；有合法目標時才打騎士卡。注意：集合只剩目前所在格（沙漠）時，base 候選會跳過現位格（`B/base/robber.ts:17`），過濾後是空集合，`banditChoice` 改取第一項（`:111-114`），不消耗亂數。**H**：用 `scoreExtras` 估港口點數的差額；Strongest Ports 需要至少 3 點，而且必須嚴格超過持有者才會轉手 | FR 規則相同；H 不估 Strongest Ports |
| coins（S3） | 1 gold = 0.5 資源（`GOLD_PER_RESOURCE=2`）。`tb.buyResource` 只在能補齊本回合的建造時使用，每回合最多 2 次。`tb.sellResources` 只在 Rivers 要脫離 Poor，或資源已超過手牌上限時使用。`trade.goods` 讀 `view.modules.tradersBarbarians['tb-coins'].gold`（公開，`TB/coins/index.ts:124-134`） | 只買不賣 |
| rivers（S8） | 橋的成本是 brick 2、lumber 1，可得 +3 gold，每人 3 座，以 road 計畫評估。金幣額外計入排名效果：唯一最多者 +1，最少者（含並列）−2 | 有橋點時照樣蓋；不估排名 |
| fishing（S4） | 每個魚片期望值 55/29 ≈ 1.90 條魚（`FISH_SUPPLY` [11,10,8]，`TB/fishing/index.ts:21`）。依 `FISH_COSTS` 選用途：2 移走強盜、3 偷牌、4 取資源、5 道路、7 發展卡；買道路前先用 `roadStockLeft` 檢查剩餘道路數（G13）。有對象時立即交出舊靴。`fishSwap` 只換掉面額 1 的魚片 | 只用在道路、取資源與發展卡；不交換 |
| trains（S5） | 只用計畫外剩下的 wool 與 grain 出價，目標是車廂落在自己的道路上（權重 2），或讓車廂夾住自己的建築。分配與放置都選對自己價值最高的位置 | 出價 0；分配與放置照常選擇 |
| BA（S6） | 沿海建築受到威脅（蠻族數量接近 `CONQUER_AT=3`）時，優先買 BA 卡（wool、grain、ore 各 1）。騎士朝可驅逐的格移動；grain 足夠時才加速。Treason 選擇最傷害領先者的走法。被征服的格以 `economy.hexYield` 回 `{}`，不計產量 | 同樣買 BA 卡並移動騎士，不加速；Treason 取第一個 |
| Traders（S7） | `graph.ts` 依 MP 計算最短路徑；路上有蠻族時 +2 MP；經過對手道路時付 1 gold 過路費，並為此保留 1 gold 的準備金。運貨優先。升級與加速以「本回合多送一次貨」來估值。蠻族騎士卡同時計入最大騎士團與排除擋路的蠻族，也可以在 preroll 打出。用 `economy.awards` 回 `{ longestRoad: false }`，不為最長道路鋪路 | 照樣依路線送貨，不升級、不加速 |

**gold 交易與規則 9**

- standard 依 `goodValue` 估值回應含 gold 的報價；easy 一律拒絕含 goods 的報價；兩者都不主動提出 gold 報價。
- 以下情況一律拒絕：
  - 報價含任何模組都沒有列在 `trade.goods` 的 goods；
  - `wantGoods` 超過自己持有的 gold；
  - `giveGoods` 超過對方公開的 gold（引擎在同意時會檢查雙方，`R/engine.ts:1907`；結算時再查一次，`:2013`；見 §11-3）。
- bot 規格 §5 規則 9（`docs/aegis/specs/2026-11-01-bot-opponents.md:160`）已經寫入提議者 goods 的檢查，S9 不必再改條文。

### 4.3 共用檔修正（S1 獨佔）

| 修正 | 位置（`58fe789`） |
|---|---|
| 新增 `targetOf(view, id)`，回傳 `player.victoryTarget ?? view.victoryTarget`，取代讀全域值的三處：`knightDecision` 的勝利判定、base 強盜候選的「接近勝利」加權、`acceptMargin`。SF 的 `bandit.ts:62` 與 C&K 的 `cards-interactive.ts:78` 屬於別的擴充，可以一併改，但不強制；hard 不受影響（不開放給有模組的 profile） | `B/heuristic.ts:254`、`B/base/robber.ts:32`、`B/trade.ts:80` |
| 讀取 `economy.awards`：任一模組回 `longestRoad:false` 時，不產生 `longestRoad` 計畫，`usefulRoad` 也不再為了延長路線而鋪路 | `B/economy.ts:446-468`、`B/base/roads.ts:22-23` |
| `hexPips` 加上 `view.board.extraNumbers`；`piecesOnBoard` 不算橋 | `B/board.ts:125`、`:261` |
| 依 `trade.goods` 與 `goodValue` 做 goods 估值，並補上規則 9 對提議者 gold 的檢查。目前 `offerTermsKnown` 會拒絕所有 goods，`offerGain` 只估卡牌；兩個呼叫點都拿得到 `turn` | `B/trade.ts:44-50`、`:67-73`；呼叫點 `B/heuristic.ts:209-223`（非行動者回應）、`:270-281`（行動者結算反報價） |
| 移除 `support.test.ts` 保留清單中的 `'trade'` 與 `'awards'`：骨架開始呼叫它們，S2 註冊的 T&B 模組又會定義它們（§12.3） | `packages/bots/test/support.test.ts:26-27` |
| ~~`robberTargets` 的 fold~~：已由 0.4.3 SFCK-P 交付（`B/base/robber.ts:42-97`），S1 不做。FR 的寫法移到 S3（§4.2） | — |
| ~~B-POLICY 放寬~~：`policy.test.ts` 只跑 base，不必改；T&B 的 family 測試照用 `sfck-game.test.ts:178-182` 的寫法（G12） | — |

S1 的驗收：

1. base 的 golden replay 必須逐一相同。`pnpm --filter @catan/bots test` 已經包含這些比對：`golden-base.test.ts` 用凍結的 v0.4.0 driver 重跑 48 局；`policy.test.ts`、`fallback.test.ts` 依 `goldenIdsFor`（`packages/bots/test/harness.ts:812-822`）比對；`matrix.test.ts` 斷言比對的局數合計剛好是 48。
2. 比照 0.4.3 的 D1，在 scratch 用 `createDecisionHasher`（`harness.ts:824`）比對 sf、ck、sf-ck 四個 profile，每個人數各 3 個種子，結果表放進 PR 本文。沒有 T&B 模組時，上述改動對它們都應該是 no-op：沒有個人勝利分，沒有 `awards`、`trade` 提供者，沒有 `extraNumbers`，也沒有橋。

### 4.4 節奏與每視窗上限

server 以 `command.type` 查表。合併表在 `S/bot-driver.ts:73`，寫法是 `{ ...THINK_MS, ...BOT_PACING }`，同一個鍵以模組的值為準；base 的表在 `:48-71`；查表在 `delayFor` 的 `:586`；預設 900 ms（`DEFAULT_THINK_MS`，`:74`）。`BOT_PACING` 依註冊順序合併各模組的 `pacing`，重複的鍵以先註冊者為準（`B/support.ts:36-44`）。所以 `tb.*` 的鍵不得和 SF、C&K、SF+CK 重複，目前也確實沒有重複。T&B 匯出的 `pacing` 如下：

| 指令 | ms | 指令 | ms |
|---|---|---|---|
| `tb.buildBridge`、`tb.buildBaCard`、`tb.upgradeWagon`、`tb.spendFish`、`tb.giveBoot` | 900 | `tb.wagonStep` | 450 |
| `tb.buyResource`、`tb.sellResources` | 800（同 `trade.bank`） | `tb.wagonBoost`、`tb.moveKnight` | 600 |
| `tb.playKnight`、`tb.playSwiftJourney` | 1100（同 `dev.play*`） | `tb.wagonStop` | 500 |
| `tb.moveBarbarian` | 1200（同 `pending.moveRobber`） | `tb.endKnights` | 700 |
| `tb.bidWagon`、`tb.driveOff` | 1000 | `tb.fishSwap`、`tb.baSteal` | 800（同 `pending.steal`） |
| `tb.assignWagon`、`tb.placeWagon`、`tb.baCapture`、`tb.baPlaceKnight`、`tb.baTreason` | 900 | | |

**每視窗上限**：維持 40。server 的常數 `MAX_BOT_COMMANDS_PER_WINDOW` 已改名為 `BASE_COMMANDS_PER_WINDOW`（`S/bot-driver.ts:83`）。實際上限由 `commandLimit`（`:446-451`）呼叫 `botCommandLimit(profile, 40)` 取得（`B/support.ts:47-51`），也就是 base 與該 profile 各模組 `maxCommandsPerWindow` 的最大值。測試可以用 `BotDriverDeps.commandLimitFor`（`:42-43`）注入上限；harness 的對應常數是 `BOT_WINDOW_COMMAND_LIMIT`（`packages/bots/test/harness.ts:197`）。

- 依據：
  - 實測每個 Bot 單一視窗最多 15 個指令。
  - Traders 的車隊移動排在同一個視窗裡：`windowId` 只在開新視窗時遞增（`R/engine.ts:585`）。理論上一次移動最多 14 個指令，加上 Swift Journey 是 28 個。
- 要求：
  - Traders 策略在單一 `tbWagon` frame 內最多送 12 個指令，之後改送 `tb.wagonStop`。
  - Q3 若任何 profile 的最大值超過 30，就把 T&B 模組的 `maxCommandsPerWindow` 設為 60（D-TB7）。這個設定只影響 T&B profile。

## 5. 切片與 PR

**分支流程**（策略 §7、`RELEASING.md:40-56`）：

- 分支命名為 `feat/bots-tb-<slice>`，worktree 放在 `.worktrees/bots-tb-<slice>/`。
- 各切片的 PR 指向 `release/v0.4.4`（已存在，與 `master` 同在 `58fe789`），以 squash merge 合併，subject 保留 `(#N)`。
- master 有修正時，以 merge 方式併入 `release/v0.4.4`，不 rebase、不 force-push。

| 切片 | 分支／worktree slug | 檔案所有權（並行切片之間不重疊） | 內容 | src／test 行 | 依賴 | 驗收指令 |
|---|---|---|---|---|---|---|
| S0 匯出 | `feat/bots-tb-exports`／`bots-tb-exports` | `TB/**`、`R/index.ts`、`packages/rules/test/tb-exports.test.ts` | §3.1 | 100–140／20–40 | — | `pnpm --filter @catan/rules typecheck && pnpm --filter @catan/rules exec vitest run && pnpm --filter @catan/web typecheck` |
| S1 共用 | `feat/bots-tb-shared`／`bots-tb-shared` | `B/{heuristic,economy,board,trade}.ts`、`B/base/{robber,roads}.ts`、`packages/bots/test/{support,shared-tb}.test.ts`；`B/modules/types.ts` 的 `awards`、`trade` 簽章由 Orchestrator 先在此分支提交（§12.4） | §4.3 | 70–110／100–140 | 0.4.1–0.4.3 的平台（已具備） | `pnpm --filter @catan/bots typecheck && pnpm --filter @catan/bots test`（含 golden replay），加上 §4.3 的決策雜湊比對 |
| S2 核心 | `feat/bots-tb-core`／`bots-tb-core` | `B/modules/tradersBarbarians/{index,part,parts,view,frames,duty,graph}.ts` 與 7 個 part 的 stub；`B/modules/registry.ts` 的註冊；`packages/bots/test/support.test.ts` 的節奏合併斷言（`:102-135`）；`test/modules/tradersBarbarians.ts`（kit id 必須是 `tradersBarbarians`）與 `test/modules/tb/*.ts` 的 stub；`test/harness.ts` 的 `PROFILE_LIMITS`（`:222-232`，8 筆一次加齊）；`bench/run.ts:53` 的 `BENCH_KITS`；`test/{tb-duty,tb-support}.test.ts` | `supports`、保底 17 列、frame 分派、part 組合、守恆與擾動工具、`onEndTurn` defer 與依序多 responder 的單元測試 | 300–360／290–350 | S0、S1 | `pnpm --filter @catan/bots exec vitest run test/tb-duty.test.ts test/tb-support.test.ts test/support.test.ts test/matrix.test.ts && pnpm --filter @catan/bots typecheck` |
| S3 coins＋variants | `feat/bots-tb-coins-variants`／`bots-tb-coins-variants` | `…/{coins,variants}.ts`、`test/modules/tb/{coins,variants}.ts`、`test/tb-{coins,variants}.test.ts` | gold、規則 9、FR（`robberTargets`）、H | 160–200／130–170 | S2 | `pnpm --filter @catan/bots exec vitest run test/tb-coins.test.ts test/tb-variants.test.ts` |
| S4 Fishing | `feat/bots-tb-fishing`／`bots-tb-fishing` | `…/fishing.ts`、`test/modules/tb/fishing.ts`、`test/tb-fishing.test.ts` | §4.2 | 150–190／110–140 | S2 | 同上，換成該檔 |
| S5 Trains | `feat/bots-tb-trains`／`bots-tb-trains` | `…/trains.ts`、`test/modules/tb/trains.ts`、`test/tb-trains.test.ts` | §4.2 | 140–180／110–140 | S2 | 同上 |
| S6 BA | `feat/bots-tb-barbarian-attack`／`bots-tb-barbarian-attack` | `…/barbarianAttack.ts`、`test/modules/tb/barbarianAttack.ts`、`test/tb-barbarian-attack.test.ts` | §4.2 | 210–260／130–170 | S2 | 同上 |
| S7 Traders | `feat/bots-tb-traders`／`bots-tb-traders` | `…/traders.ts`、`test/modules/tb/traders.ts`、`test/tb-traders.test.ts` | §4.2 | 260–320／140–180 | S2 | 同上 |
| S8 Rivers | `feat/bots-tb-rivers`／`bots-tb-rivers` | `…/rivers.ts`、`test/modules/tb/rivers.ts`、`test/tb-rivers.test.ts` | §4.2 | 100–130／80–110 | S3（gold 估值） | 同上 |
| S9 開放 | `feat/bots-tb-gate`／`bots-tb-gate` | `parts.ts` 的 `TB_READY_PARTS`；`packages/bots/test/support.test.ts` 的快照（`:72-83`）；`packages/bots/test/families.ts` 的 T&B family；`packages/server/test/traders-barbarians.test.ts`（`:67-89`）、`bots.test.ts`（`:282-312` 與新的入座案例，比照 `:382-408`）、新檔 `bots-traders-barbarians.test.ts`；§7 的文件 | 開放 gating、快照、family 登記、server 四類測試、文件 | 10–20／200–260，另有文件 40–60 | S3–S8 與 QA 結果 | `pnpm --filter @catan/server exec vitest run test/bots-traders-barbarians.test.ts test/traders-barbarians.test.ts test/bots.test.ts && BOTS_SEEDS=10 pnpm verify` |

- **合計**：src 1,500–1,910 行，test 1,310–1,700 行，總計約 2,810–3,610 行，文件另計。與原估計（2,830–3,620 行）相當：S1 少了 fold 與 B-POLICY，S2 多了 part 組合與既有測試工具的登記（§12.3）。
- **各 part 測試的閘門版**：S3–S8 的驗收都要再加跑 `BOTS_SEEDS=10` 版本，並跑 `pnpm --filter @catan/bots typecheck`。
- **波次**
  - W0：S0 與 S1 並行。S1 不依賴 S0 的型別。
  - W1：S2。
  - W2：S3、S6、S7 先做，把最長的 BA 與 Traders 提前；接著做 S4、S5，以及 S3 合併後的 S8。並行上限 3。
  - W3：QA 跑閘門矩陣與 bench。bench 在 gating 開放前會被擋下（§6.4），所以 QA 要在本地暫時翻開 `TB_READY_PARTS`，量完不提交（比照 0.4.3 的 D6）。
  - W4：S9。
- **與第一輪批次的對應**
  - 批次 1 → S1–S3；
  - 批次 2 → S4、S5、S8；
  - 批次 3 → S6；
  - 批次 4 → S7。
- **共用檔**：`heuristic.ts`、`economy.ts`、`board.ts`、`trade.ts`、`base/robber.ts`、`base/roads.ts` 只歸 S1。part 切片若需要共用檔的改動，回報 Orchestrator，排進 S1 的後續 PR。
- **依序修改的測試檔**：`support.test.ts` 依 S1 → S2 → S9 的順序修改，三者在不同波次，不會衝突。`harness.ts` 的 `PROFILE_LIMITS` 與 `bench/run.ts` 的 `BENCH_KITS` 只歸 S2；S3–S8 要調整時回報，由 QA 在 W3 一次改。
- **替代方案（策略 §5.2）**：W3 時 BA 或 Traders 仍未通過 Q1 或 Q2，S9 就只把其餘 part 放進 `TB_READY_PARTS`，先開放 6 個 profile（`tb-coins` 由 Rivers 帶入）。
  - 落後的 part 程式照樣合併，但不開放；測試保留明列的 profile 清單，繼續執行。
  - 該 part 移到 0.4.5 開放。

## 6. 測試與驗收

### 6.1 Q1 矩陣（B-GAME 仿 BotDriver 模式；策略 §4.6）

現成的工具都在 `packages/bots/test/harness.ts`：

- `runBotGame`（`:510`）預設就是仿 BotDriver 模式，結果含 `idleFallbacks`、`stuck`、`watchdog`、`maxWindowCommands`、`mechanics`、`conservation`。
- 種子用 `seedsFor`／`BOTS_SEEDS`（`:175-187`；擴充預設 3 個，閘門 10 個）。
- 上限用 `limitsFor`／`PROFILE_LIMITS`（`:219-236`；預設 `maxSteps: 5000`、`watchdogRolls: 60`）。
- 保底席用 `withFallbackSeat`（`:398`）與 `fallbackSeatSeeds`（`:798`）。
- 全保底局用 `ALL_FALLBACK_SEEDS = [1,2,3]` 與 `ALL_FALLBACK_STEPS = 800`（`:804-805`）。

看門狗的單位是 `turn.roll` 的次數，不是回合（`:204`）。Traders 擲出 2 或 12 時，重擲在同一個指令內完成，所以只算一次。

| profile | 人數 | 種子（預設／閘門） | 座位 | 步數上限 | 看門狗 N（`turn.roll` 次數） | 實測依據：最多步數／最長無得分回合 |
|---|---|---|---|---|---|---|
| FR、H、FR+H | 3、4 | 3／10 | standard 與 easy 輪替；另加 1 個種子讓 bot2 只走保底 | 3000（寫進 `PROFILE_LIMITS`） | 60（預設） | 522／23 |
| Fishing | 3、4 | 3／10 | 同上 | 3000 | 60 | 451／29 |
| Rivers | 3、4 | 3／10 | 同上 | 3000 | 60 | 508／26 |
| Trains | 3、4 | 3／10 | 同上 | 3000 | 60 | 556／24 |
| BA | 3、4 | 3／10 | 同上 | 5000（預設） | 60 | 1079／31 |
| Traders | 3、4 | 3／10 | 同上 | 5000（預設） | 60 | 538／14；rules 腳本模擬最多 1091 步 |
| 全部座位只走保底（有界局） | 3、4 | `ALL_FALLBACK_SEEDS`（1–3） | 全部座位都用保底 | 800（`ALL_FALLBACK_STEPS`） | 關閉（`watchdogRolls: null`） | 不要求終局，只要求 0 拒絕且每一步都有動作；實測 BA 0/10、Traders 5/10 局終局 |

- 實測範圍：plus 原型跑 20 個種子 × 3、4 人，全部勝出、0 拒絕。bot2 只走保底的 80 局全部終局，無得分最長 30 回合。
- 通過條件：
  - 0 拒絕；
  - 在步數上限內分出勝負；
  - 結束時沒有殘留的 pending；
  - 守恆成立（§6.2）；
  - `idleFallbacks` 為空，也就是不出現「策略閒置、但保底有動作」；
  - B-FAIR 與 fuzz 通過。
- B-FAIR 要擾動的隱藏資訊，寫在 kit 的 `hideDifferently` 裡：
  - 對手的魚片面額（數量不變）與魚片供應的順序（`TB/fishing/index.ts:370-385`）；
  - BA 牌庫的順序；
  - Traders 的發展卡牌庫與對手手牌。
- fuzz 的擾動寫在 kit 的 `perturb` 裡，依 kit 陣列的順序套用（`harness.ts:742-777`）。
- 合約檢查：各 T&B 測試檔自帶「強盜不放自己的格，除非沒有其他合法格」的檢查，比照 `sfck-game.test.ts:168-182`，並檢查目標一定在 fold 集合內（G12）。

### 6.2 守恆（`test/modules/tb/<part>.ts`，由 kit 的 `conservation` 彙整）

rules 測試已在模擬局結束時斷言以下不變量，因此不再列為推測。harness 只在每局結束時呼叫 kit 的 `conservation`（`conservationProblems`，`harness.ts:645-655`）。要每 50 步檢查一次，得由 T&B 測試檔在 `onStep`（`harness.ts:458`、`:577-588`）裡自行呼叫，不必改 harness。

| part | 不變量 | rules 已有的斷言 |
|---|---|---|
| base | 各資源：手牌 + 銀行 + 投標中的牌（`frame.data.bids`，投標結束才歸還銀行）= 19。注意：harness 的 base 守恆 `supplyTotal`（`harness.ts:636`）只算手牌與銀行，Trains 投標進行中的狀態要由 T&B kit 補上投標中的牌，或只在沒有投標 frame 時檢查 | `TB/trains/index.ts:131-136,190-213` |
| tb-coins | 玩家 gold 合計 + supply = 100 | `packages/rules/test/tb-rivers.test.ts:439`、`tb-barbarians.test.ts:491-497`、`tb-traders.test.ts:457-463` |
| tb-fishing | 各面額的 supply + 棄堆 + 手牌 = [11,10,8]；舊靴只有 1 個 | `tb-fishing.test.ts:426` |
| trains | 車廂 + supply = 22，且邊不重複 | `tb-trains.test.ts:411-412` |
| BA | 盤上蠻族 + 俘虜 + supply = 36；牌庫 + 棄堆 = 26 | `tb-barbarians.test.ts:491-497` |
| Traders | commodity 共 36；3 個蠻族所在的邊互不相同 | `tb-traders.test.ts:457-463` |

### 6.3 Q2 門檻（全部種子合計；S = 每個人數的種子數，共 2S 局）

計數一律從 `MechanicsStep.events` 逐步累計，不讀 `state.log`：它只保留最後 200 筆（`R/engine.ts:123`、`:258`）。只計 `source === 'policy'` 的指令。

| profile | 指標 | 門檻 | S=3／S=10 | 依據 |
|---|---|---|---|---|
| FR、FR+H | 強盜落點都在 `robberHexes` 內 | 100% | — | 實測 |
| FR、FR+H | `moveRobber` 次數 | ≥3S | 9／30 | 實測 |
| H、FR+H | 終局時 Strongest Ports 有持有者的局數 | ≥⌈0.3S⌉ | 1／3 | 實測：不估值時 10 局中 3–7 局 |
| Fishing | `tb.spendFish` | ≥2S | 6／20 | 推測：每局有 15–26 次回合結束時持有 ≥2 條魚 |
| Rivers | 蓋橋 | ≥⌈0.5S⌉ | 2／5 | 推測：每局有 1.3–3.4 次付得起 |
| Rivers | `tb.buyResource` + `tb.sellResources` | ≥S | 3／10 | 推測：每局有 50–75 次 gold ≥2 |
| Trains | wool+grain > 0 的出價 | ≥S | 3／10 | 推測：每局有 25–47 次手上有 wool 或 grain 的投標回合 |
| Trains | 放置的車廂 | ≥5S | 15／50 | 實測：每局至少 7 |
| BA | `tb.buildBaCard` | ≥5S | 15／50 | 實測：每局約 22–24 |
| BA | 俘虜 | ≥3S，且每局 ≥1 | 9／30 | 實測：每局 3–21 |
| Traders | 運貨次數 | ≥5S | 15／50 | 實測：每局至少 7 |
| Traders | `tb.upgradeWagon` | ≥S | 3／10 | 推測：每局有 2.8–4.9 次付得起 |
| Traders | `tb.playKnight` | ≥S | 3／10 | 推測：每局有 19–23 次可以打 |
| Fishing、Rivers、Trains、BA、Traders | easy 與 standard 各自發出的模組指令 | 每種至少 1 | — | DoD 1 |

### 6.4 Q3 bench（`pnpm --filter @catan/bots bench <局數> --profile <id>`，只報告）

bench 的實際設定（`packages/bots/bench/run.ts:1-19`、`:78-97`）是每個人數四種對局：

1. 1 standard 對其餘 easy；
2. 1 standard 對其餘 naive；
3. 全 standard；
4. 全 easy。

focus 依局數輪換座位，種子從 10000 起。原稿的「4 人：2 standard 對 2 easy」並不存在，改用 0.4.3 的 soft target（工作紀錄「Q3 bench」）。bench 會擋下 `botsCanPlay` 為 false 的 profile（`run.ts:115-118`），所以 S9 之前只能在本地暫時翻開 gating 後執行（§5 W3）。T&B 的 kit 要加進 `BENCH_KITS`（`run.ts:53`）；有 rules 腳本模擬的回合數時，加進 `RULES_SIM_ROUNDS`（`:68-75`）。

| 設定（各 50 局，與原稿相同） | 軟目標 |
|---|---|
| ① 1 standard 對 easy（3、4 人） | 勝率 ≥ 1.3 × 公平份額，而且 ≥ 公平份額 + 10 pp（3 人 ≥ 43.3%、4 人 ≥ 35%） |
| ② 1 standard 對 naive（3、4 人） | 同上；另報告 BA 與 Traders 的 naive 終局率與看門狗次數 |
| ③ 全 standard、④ 全 easy | 只報告平均回合數 |

- 其他指標與軟目標：平均回合數 ≤ plus 原型 × 1.15；拒絕數 0；fallback 次數 0；每視窗最大指令數 ≤30（硬上限 40）；`decide` 最大耗時 ≤50 ms；模組機制計數只報告。
- plus 原型的平均回合數（3 人／4 人）：FR 21／18、H 22／19、FR+H 22／19、Fishing 23／19、Rivers 19／18、Trains 24／19、BA 26／26、Traders 17／14。

### 6.5 server 測試（S9，新檔 `packages/server/test/bots-traders-barbarians.test.ts`）

寫法比照 `packages/server/test/seafarers-cities-knights-bots.test.ts`。

1. 經 HTTP 的完整對局，用 `tb-merchant-trains-2025`。這一局同時涵蓋 `onEndTurn` defer 與依序多 responder 的 frame。
2. 由保底接手：在 `tb-traders-barbarians-2025` 的 `tbWagon` frame 注入一個不合法的 `tb.wagonStep`，預期改由 `tb.wagonStop` 接手，對局繼續。
3. 真人與 Bot 同桌，處理 `wagonBid`（依序）與 `wagonAssign`（同時）。真人在前、Bot 在前兩種順序都要測，斷言 Bot 只在輪到自己時回應，而且不會擋住真人。
4. 在 Traders 的車隊移動 frame 進行中重啟 server，Bot 恢復後完成移動。
5. 翻轉 `packages/server/test/traders-barbarians.test.ts:67-89`：開放的 profile 改為 `botSeats:true`，可以加入 Bot；若走替代方案，未開放的 profile 維持 `E_INVALID_BOT`。另外更新 `bots.test.ts:282-312` 的 profile 清單與 `botLevels`（T&B 為 `['easy','standard']`），並比照 `:382-408` 加一個入座與切換的案例，包含 hard 被拒（`E_INVALID_BOT`，reason `profileLevel`）。`session.test.ts:77-78` 已排除 `tb-`，不受影響。

### 6.6 測試檔與時間預算

- **測試檔**：B-GAME、B-POLICY 與 Q2 計數共用同一批對局，不重跑。
  - 新增 9 個檔：`tb-support`、`tb-duty`、`tb-coins`、`tb-variants`、`tb-fishing`、`tb-rivers`、`tb-trains`、`tb-barbarian-attack`、`tb-traders`。都放在 `packages/bots/test/` 根目錄：family 守門只讀 `./*.test.ts`，不遞迴（`packages/bots/test/families.ts:18-19`）。
  - 各檔明列自己的 profile，用單引號字面值，寫在註解以外的地方（`families.ts:15-16`），因此在開放 gating 之前就能測試（§11-5）。
  - family 登記在 S9 才加進 `families.ts`。原因是 `familyCoverageProblems`（`families.ts:115-144`）要求登記的檔案都存在，而且只有 `BOT_TEST_MATRIX` 裡的 profile 必須被涵蓋；S9 之前 T&B 不在矩陣裡。登記後，`GENERIC_MATRIX` 會自動跳過 T&B。
- **預算估算**（實測平均每局 0.51 s，BA 0.59 s）

  | 項目 | 預設 | 閘門（`BOTS_SEEDS=10`） |
  |---|---|---|
  | B-GAME 對局數 | 每個 profile 8 局，共約 32 s | 每個 profile 22 局，約 90 s |
  | 只走保底的有界局 | 約 16 s | 約 48 s |
  | B-FAIR、fuzz 與單元測試 | 約 15 s | 約 15 s |
  | CPU 合計 | 約 63 s | 約 150 s |
  | vitest 並行後 bots 測試增加的 wall time | 約 12–20 s | 約 35–50 s |

  原稿寫「現行 bots 套件是 48 個測試，約 20 s」，這是 v0.4.0 的數字。`58fe789` 的 `packages/bots/test/` 已有 45 個測試檔，S2 開工時重量基準。
- **拆檔規則**：預設下單檔超過 15 s，或閘門下單檔超過 60 s，就依人數拆檔，例如 `tb-barbarian-attack.3p.test.ts`。timeout 統一為 120 s（`GAME_TIMEOUT`，`harness.ts:59`）。

## 7. 文件與發布

| 檔案:行（`58fe789`） | 更新內容 | 切片 |
|---|---|---|
| `docs/SPEC.md:190` | 「Today that is …」一句加入開放的 T&B profile（3–4 人）；R-BOT 條文（`:194`）不改 | S9 |
| `docs/aegis/specs/2026-11-01-bot-opponents.md:16-20` | 「支援的 profile」清單加一行「0.4.4 起加上 T&B…」，指向本計畫 | S9 |
| 同上 `:23` 與 §5 規則 7（`:142`）、規則 9（`:160`） | `:23` 範圍外清單目前沒有提到擴充，event-cards 的排除寫進 `:16-20` 新增的那一行；規則 7 的保底表指向本計畫 §4.1；規則 9 已含提議者 goods 的檢查，不改 | S9 |
| `docs/API.md:148-159` | 開放的 T&B profile 改為 `botSeats:true`；`tb-event-cards*` 仍不可加 Bot；hard 被拒的說明比照 `:483`、`:576`。T&B 段落（`:376` 起）視需要補一句 | S9 |
| `docs/FIDELITY.md:45-52` | T&B profile 列註明「easy and standard bot seats」 | S9 |
| `docs/FIDELITY.md:65-67` 的段落之後 | 加一段 T&B 的 bot 閘門說明（Q1／Q2／server 測試），比照 `:65`、`:67` | S9 |
| `docs/FIDELITY.md:149` 之後 | 新增 R-TB-BOT 證據列，指向 bots 的 `tb-*.test.ts` 與 server 測試，格式比照 `:120`、`:128` | S9 |
| `docs/FIDELITY.md:685-693` | 範圍段落加一句 Bot 支援的範圍 | S9 |
| `README.md:138-141` | T&B 條目加上「easy and standard computer opponents」；`:181` 的 event-card 說明不改 | S9 |
| `docs/aegis/work/<date>-bots-traders-barbarians.md` | 新的工作紀錄，附 Q1／Q2／Q3 結果與實測門檻的調整 | S9 |
| `docs/aegis/INDEX.md` | 加入本計畫與工作紀錄 | S9 |

大廳文案在 0.4.1 已經改過（策略 §4.4），這一版不用動。

發布流程依策略 §7 與 `RELEASING.md:40-56`：

1. 各切片的 PR 指向 `release/v0.4.4`，以 squash merge 合併（§5）；master 有修正時以 merge 方式同步進來。
2. 打 rc 前，Browser QA 依 DoD 5 驗證 8 個 profile：從大廳建房、加入 easy 與 standard 電腦後開局，觀察數個 Bot 回合，確認用到代表性機制而且沒有停住。可沿用 `scripts/traders-barbarians/capture.py` 截圖。截圖比照 0.4.2、0.4.3 的 E-9：PR 證據放 `pr-assets` 的 `pr-<N>/`；是否在 `docs/screenshots/traders-barbarians/` 收一張大廳參考截圖，由 S9 依前例決定。
3. 在 release 分支 push `🔖 release: v0.4.4-rc.1` 並打 tag，用 rc 映像試玩。
4. 發 stable：開 `release/v0.4.4 → master` 的 PR，以 merge commit 合併；打 tag 前先跑 `BOTS_SEEDS=10 pnpm verify`；release notes 用 `scripts/release-notes.sh` 產生，並跑 `scripts/release-notes-lint.sh`；發布 PR 附上 Q3 表格，並與 0.4.3 比較。
5. tag 與 Release 只在使用者明確授權後，由 Release Manager 處理。

## 8. Paseo 分工

派工前以 `list_profiles` 的實際結果為準。prompt 開頭寫「角色：…」，並寫明檔案範圍與驗收指令。

| 順序 | 角色 | 工作 | 隔離 | 並行 |
|---|---|---|---|---|
| 0 | Planner | 依 0.4.3 的程式刷新本計畫的行號與鉤子名稱；唯讀。**2026-11-20 完成（§12）** | worktree `bots-tb-plan` | — |
| 0 | Orchestrator | 在 S1 分支先提交 `modules/types.ts` 的 `awards`、`trade` 簽章（§12.4）；負責註冊表審核、Git、整合與最終驗證 | 主 worktree | — |
| W0 | Implementer（Backend）× 2 | S0、S1 | 各自的 worktree | 2 |
| W1 | Implementer（Backend） | S2 | worktree | 1 |
| W2 | Implementer（Backend）× 3 | 先做 S3、S6、S7，再做 S4、S5、S8 | 各自的 worktree | ≤3 |
| 每個 PR | Reviewer（Sol） | 審查合法性、I9、決定性、B-FAIR，以及檔案所有權是否越界；唯讀 | 共用工作區 | 跟著 PR |
| S0、S1、S2 | 再加 Reviewer（Opus） | rules 匯出是否零行為變更、共用檔與 golden replay、`duty.ts` 合約；唯讀 | 共用工作區 | — |
| W3 | QA | 跑 `BOTS_SEEDS=10` 矩陣與 bench（本地暫時翻開 gating，不提交），彙整 Q1／Q2／Q3，提出門檻調整；只改測試，包括 `PROFILE_LIMITS` | worktree | 1 |
| W3 | Architect（視需要） | 分數尺度爭議（R9）與 Q2 未達時的取捨；唯讀 | 共用工作區 | — |
| W4 | Implementer（Backend） | S9 | worktree | 1 |
| rc 前 | Browser QA | DoD 5 | 共用工作區 | — |
| 授權後 | Release Manager | rc 與 stable | — | — |

- subagent 不 push、不改 lockfile；對合約有疑義時回報 Orchestrator。
- 閒置的 agent 把交接筆記寫到 `.worktrees/_handoff/` 後停止。scratch 腳本放在 repo 外（例如 `.worktrees/_scratch/<slice>/`），不提交。

## 9. 風險

| # | 風險 | 對策 |
|---|---|---|
| R1 | BA 對局偏長：最多 1079 步、218 回合；只走保底時 0/10 局終局 | 步數上限 5000、看門狗 60 次擲骰；easy 也必須買 BA 卡並移動騎士（P9）；S6 先開工 |
| R2 | Traders 車隊每回合都要處理 frame，視窗指令偏多；路徑計算可能不具決定性 | 每個 frame 最多 12 個指令；`graph.ts` 遇到同分時依邊或頂點編號決勝；B-GAME 重跑同一種子，必須得到相同的指令序列 |
| R3 | gold 被人類玩家用報價套利，或 Bot 同意後被拒 | 規則 9 加上提議者 gold 的檢查；easy 拒絕所有含 goods 的報價；gold 估值保守取 0.5 |
| R4 | 測試時間超出預算 | 共用對局；依 §6.6 的規則拆檔；預設種子 3 |
| R5 | FR 在沙漠的邊角情況：實測 4 人 FR 與 FR+H 共 40 局中，被迫放沙漠 3 次、留在沙漠 2 次 | 0.4.3 的 fold（§11-2）；固定盤面單元測試；T&B 測試檔的合約檢查要有「還有其他合法格」的條件 |
| R6 | event-cards 日後實作時被自動放行 | `supports` 讀原始 id；`tb-support.test.ts` 加上 S9 的快照 |
| R7 | 標為「推測」的 Q2 門檻不切實際 | W3 由 QA 依 standard 的實測值校正；只能在使用者同意下調低（D-TB2） |
| R8 | 0.4.1–0.4.3 改動了鉤子名稱或行號 | **已處理（2026-11-20，§12）**；S2 的介面以 `58fe789` 的 `modules/types.ts` 為準 |
| R9 | 各 part 的分數尺度不一致，例如 gold、魚、俘虜，導致策略偏食 | 統一換算成資源當量；bench 的機制計數若偏差就交給 Architect |
| R10 | BA 的 capture 替換迴圈理論上可能開出沒有目標的 frame（`TB/barbarians/index.ts:179-187`） | 矩陣斷言這種情況不會發生；萬一發生，走 server 的「欠動作」診斷；修正走 rules 的修正 PR，不在本版範圍 |
| R11 | `goodValue` 的單位沒有定稿，gold 的估值與 `handUtility` 尺度不一致時，Bot 會過度或從不接受 gold 報價 | 由 Orchestrator 在 S1 的合約 commit 定稿（§12.4 C2）；S3 的固定盤面測試鎖住「1 gold ≈ 0.5 資源」的取捨點 |

## 10. 待使用者決定的事

**2026-11-20：使用者指示「直接照計畫進入開發」，下表 D-TB1–D-TB7 全部採用建議。**

| # | 事項 | 建議（已採用） |
|---|---|---|
| D-TB1 | 一次開放 8 個 profile，或先開 6 個 | 以 8 個為目標；W3 時 BA 或 Traders 未過 Q1 或 Q2，就改走替代方案先開 6 個 |
| D-TB2 | Q2 門檻（§6.3），其中 7 項是推測 | 先照表採用；QA 實測後只允許調高，調低要經使用者同意 |
| D-TB3 | gold 交易 | standard 估值後回應、easy 一律拒絕、兩者都不主動提出 |
| D-TB4 | rules 匯出範圍（§3.1） | 照表匯出，含 frame data 型別；web 的本地型別不在本版改 |
| D-TB5 | easy 的下限 | 依 §4.2：BA 要買卡並移動騎士，Traders 要送貨；其餘進階機制關閉 |
| D-TB6 | Harbors 的 Q2 指標 | 用「Strongest Ports 有持有者的局數」；替代方案是「standard 的港口點數高於 easy」 |
| D-TB7 | 節奏與上限 | 照 §4.4；上限先維持 40，Q3 超過 30 時改為 60 |

## 11. 與整體策略的差異

> 2026-11-04：1–7 都已併入整體策略（§3.1 Q1、§4.1、§4.2、§4.4、§4.5 規則 9、§4.6、§4.7-3、§4.9、§5、§6 DoD）。
>
> - 第 1 項與 E&P 計畫提出的 `economy.basePlans` 統一為 `economy.awards`，由本版 S1 建立，E&P 沿用。
> - 第 2 項經獨立審查後定稿為與 rules 相同的有序 fold（`packages/rules/src/engine.ts:1495-1505`，原稿行號 `:1462-1471`）：每個模組收到目前候選並回傳下一組，可以縮小、替換或擴大。這涵蓋了本項要的「取代」，也取代了「多個模組之間取交集」的寫法。fold 的元素型別依 SF+CK 計畫推廣為 `number | null`，並提前到 0.4.3 交付（`B/base/robber.ts:42-97`），本版直接使用。
> - 下列各項保留原始論證。worktree 路徑依策略 §7 改為 `.worktrees/bots-tb-<slice>/`。

1. **新增 `economy.awards` 鉤子**（策略 §4.1 沒有）。
   - Traders 以 `minLongestRoad=Infinity` 停用最長道路（`TB/traders/index.ts:369-372`），但 bots 無從得知，仍會推動道路計畫（`B/economy.ts:446-468`、`B/base/roads.ts:22-23`）。
   - 用 `scoreExtras` 扣分無法關掉計畫本身，所以改用 `awards: { longestRoad?: boolean }`。型別已在 `B/modules/types.ts:123`，骨架尚未呼叫。
   - 合約檔由 Orchestrator 修改。
2. **`robberTargets` 取代 base 的預設，而不是與它取交集**（策略 §4.1、§4.2 原本寫的是「只能縮小」與「取交集」）。
   - FR 在全部受保護、強盜又已在沙漠時，唯一的合法格就是目前所在格（`TB/variants/friendlyRobber.ts:34-41`；引擎接受，`R/engine.ts:1495-1515`）。
   - v0.4.0 的 base 預設會排除目前所在格，取交集後是空集合，Bot 就會卡住。實測 40 局中出現 2 次「留在沙漠」。0.4.3 的 fold 只在初值排除現位格（`B/base/robber.ts:51-64`），之後不再排除，這個問題已經解決。
   - 多個模組之間的交集改為依序 fold。
3. **規則 9 補一條**：`giveGoods` 超過提議者公開的 gold 時也拒絕。引擎在同意時會檢查雙方（`R/engine.ts:1907`），只檢查自己這一方仍會被拒。bot 規格 `:160` 已寫入。
4. **Q1 加上兩種局**：每個人數加 1 個「bot2 只走保底」的種子，另加「全部座位只走保底」的有界局。保底不保證終局（實測 BA 0/10），所以後者只驗證 0 拒絕與不卡死。
5. **T&B 各 family 的測試檔明列自己的 profile**，不依賴 `BOT_TEST_MATRIX`，讓 S3–S8 在開放 gating 之前就能跑 B-GAME。
   - 通用矩陣跳過已由 family 測試檔涵蓋的 profile，避免重跑（`GENERIC_MATRIX`，`packages/bots/test/harness.ts:160-163`）。
   - 守門測試：`BOT_TEST_MATRIX` 中的每個 profile，必須至少被一個測試檔涵蓋（`matrix.test.ts:73`，PL-2 已交付）。
   - gating 的翻轉集中在 S9 一行。
6. **型別依策略 §4.3 由 rules 匯出**，撤回第一輪「bots 自建本地型別」的建議。
7. **FR 與 H 沒有模組指令**，DoD 1 的「發出模組指令」改用 §6.3 的行為指標判定（強盜落點、Strongest Ports）。

## 12. 2026-11-20 刷新（依 `58fe789`）

v0.4.3 stable 發布後、0.4.4 開工前，Planner 依 `58fe789`（`master`，`release/v0.4.4` 也指向它）逐項核對本計畫的引用與前提。**沒有阻擋開工的問題。** 主要結論：

- `TB/**`、`R/analysis.ts` 與 rules 的 `tb-*.test.ts` 自 `a200840` 起沒有任何變動，所以 `TB/` 的行號全部有效。
- 平台在 0.4.1–0.4.3 已經修掉 G1、G2，並支援 G9、G10 需要的分派。S1 因此變小。
- `awards` 與 `trade` 仍然只有型別，是 S1 的主要工作。
- S0 完全沒有開始。

行號更正已直接改進各節，以下只做彙整。

### 12.1 更正表（原引用 → `58fe789`）

| 原引用（`a200840`） | 新引用或現況 | 出現處 |
|---|---|---|
| `B/support.ts:12-17` `BOT_RULE_MODULES` | 已移除。改為註冊表 `B/modules/registry.ts:13-17`（`REGISTERED`）；`botsCanPlay` 在 `B/support.ts:17-22` | §2 |
| `packages/server/test/traders-barbarians.test.ts:66-89` | `:67-89`（註解已改為 `botsCanPlay`） | §2、§6.5 |
| `B/heuristic.ts:162-164`、`B/fallback.ts:41-43`（G1） | `B/heuristic.ts:74-77`、`B/fallback.ts:28-39` | §2 |
| `B/heuristic.ts:195-200`、`B/fallback.ts:19-25`（G2，強盜候選） | `B/base/robber.ts:13-40`（`robberCandidates`）、`:51-64`（初值）、`:84-97`（fold）、`:104-117`（`banditChoice`）；`B/base/duty.ts:22-26` | §2、§4.3、§11 |
| `R/engine.ts:1462-1482`、`:1462-1471` | `R/engine.ts:1495-1505`（`legalRobberHexes`）、`:1507-1515`（`robberTargetError`） | §2、§4.1、§11 |
| `R/project.ts:147-148`、`:250` | `:152-153`、`:255` | §2 |
| `B/heuristic.ts:214,404`、`B/trade.ts:57`（G3） | `B/base/robber.ts:32`、`B/heuristic.ts:254`、`B/trade.ts:80` | §2、§4.3 |
| `B/economy.ts:259-281`（G4） | `B/economy.ts:446-468`；另加 `B/base/roads.ts:22-23`（`usefulRoad` 延長路線） | §2、§4.3、§11 |
| `B/heuristic.ts:398-409`、`B/economy.ts:247-257`（G5） | `B/heuristic.ts:248-259`（`knightDecision`）、`B/economy.ts:434-444`（devCard 計畫） | §2 |
| `B/board.ts:89`（G6）、`:139-141`（G7） | `B/board.ts:125`（`hexPips`）；`:253-264`（`piecesOnBoard`，`:261`）；`roadStockLeft` `:280-291` 已不算橋 | §2、§4.3 |
| `R/engine.ts:1874`（G8） | `:1907`（同意）、`:2013`（結算）、`:1824-1831`（`requireTradeGoods`） | §2、§4.2、§11 |
| `B/trade.ts:38-44`、`:38-57` | `B/trade.ts:44-50`（`offerGain`）、`:67-73`（`offerTermsKnown`）、`:76-83`（`acceptMargin`） | §2、§4.3 |
| `R/engine.ts:1115-1135`（G10） | `:1148-1168`（`endTurn`，defer 在 `:1163`） | §2 |
| `R/engine.ts:563`（`windowId`） | `:585` | §4.4 |
| `packages/bots/test/policy.test.ts:57-60`（G12） | `:72-77`；T&B 改用 `sfck-game.test.ts:178-182` 的寫法，`policy.test.ts` 不改 | §2、§4.3 |
| `R/profiles.ts:291-353` | `:354-363`（event-cards 列）；`EVENT_DECK_CLOSED` `:301`；T&B 全表 `:303-364` | §1 |
| `TB/index.ts:184-212`、`:205-212` | 組合 `project` `:184-188`、`actionHints` `:194-215`、`robberHexes` `:209-213`（`TB/` 無變動，原稿行號是概略範圍） | §3.1、§4.1 |
| `B/fallback.ts`（保底 15–17 列） | `B/base/duty.ts:13-49`、`:52-63`；`B/fallback.ts:46-56` | §4.1 |
| `S/bot-driver.ts:431`（查表）、`:64`（預設）、`:70`（上限） | `:586`、`:74`、`:83`（改名為 `BASE_COMMANDS_PER_WINDOW`）；合併表 `:73`；`commandLimit` `:446-451`；`commandLimitFor` `:42-43`；保底呼叫 `:421`（不在 try 裡） | §4.1、§4.4 |
| `B/modules/types.ts` 註解中的 `bot-driver.ts:332` | 現為 `:421`；S1 的合約 commit 順手更正 | §4.1 |
| `B/modules/index.ts` 的註冊（S2） | 這個檔案不存在；改為 `B/modules/registry.ts` | §5 |
| `docs/FIDELITY.md:622`、`:138-144`、`:633-642`、`:144` 之後 | `:674`、`:143-149`、`:685-693`、`:149` 之後；`:45-52` 不變 | 前置閱讀、§1、§7 |
| `docs/SPEC.md:188`、`:192` | `:190`、`:194` | §7 |
| bot 規格 `:16`、`:19` | `:16-20`（支援清單）、`:23`（範圍外）；規則 7 `:142`、規則 9 `:160`（已含提議者 goods 的檢查） | §4.2、§7 |
| `docs/API.md:141-147` | `:148-159`；hard 的寫法比照 `:483`、`:576` | §7 |
| `README.md:136-139` | `:138-141`；event-card `:181` | §7 |
| §6.1「看門狗 N（回合）」 | 單位是 `turn.roll` 次數（`harness.ts:204`）；預設 60、步數 5000（`:219`）；3000 步要寫進 `PROFILE_LIMITS` | §6.1 |
| §6.4「4 人：2 standard 對 2 easy」 | bench 沒有這個設定；改為 ① 到 ④ 四種對局，用 0.4.3 的 soft target | §6.4 |
| §6.6「現行 bots 套件是 48 個測試」 | 已過時（`58fe789` 有 45 個測試檔），S2 重量 | §6.6 |

### 12.2 落差現況

| # | 現況 | 說明 |
|---|---|---|
| G1 | **已修**（0.4.1，平台） | frame 分派與保底都會詢問模組；S2 只要實作 `answerFrame`、`duty` |
| G2 | **已修**（0.4.3 SFCK-P） | fold、初值與「過濾後為空就取第一項」都已交付；FR 移到 S3，寫法見 §4.2 |
| G3 | 未修 | S1 的 `targetOf` |
| G4 | 未修 | `awards` 只有型別（`types.ts:122-123`），而且列在 `support.test.ts:27` 的保留清單上 |
| G5 | 部分 | 估值已涵蓋；`tb.playKnight` 由 S7 打出 |
| G6 | 未修 | S1 |
| G7 | 部分 | `roadStockLeft` 已修；`piecesOnBoard` 未修 |
| G8 | 部分 | 規則 9 防護一律拒絕 goods；`trade` 只有型別（`types.ts:127-131`），而且列在 `support.test.ts:26` 的保留清單上 |
| G9 | 平台已支援 | 缺 T&B 的實作與測試 |
| G10 | 平台不必改 | 缺測試 |
| G11 | 不修 rules | 由 `supports` 讀原始 id 處理 |
| G12 | 部分 | 現有寫法可沿用，`policy.test.ts` 不必改 |
| G13 | 未修 | S4 |

**`awards` 與 `trade` 的骨架呼叫點（S1 要接上）**

- `awards`：`economyOf` 的最長道路計畫（`B/economy.ts:446-468`），以及 `usefulRoad` 的路線延長（`B/base/roads.ts:22-23`）。`usefulRoad` 也被 `buildDecision`（`B/heuristic.ts:423-426`）、`handRelief`（`:548-551`）、`freeRoadDecision`（`B/base/roads.ts:33-37`）使用。awards 關閉時，`usefulRoad` 跳過 `bestRouteEdge`，`anyEdge` 為 true 時仍會回傳一條合法道路。`hard/economy.ts:31-50` 不必改：hard 不開放給有模組的 profile。
- `trade.goods`／`goodValue`：`offerTermsKnown`（`B/trade.ts:67-73`）與 `offerGain`（`:44-50`）的兩個呼叫點：`respondToOffers`（`B/heuristic.ts:209-223`）與行動者處理反報價（`:270-281`）。行動者的 `proposerCanPay`（`:276`）也要加上 goods 的檢查。`ownOfferStep`、`proposeOffer` 不提出 goods，不必改。

**rules 的 T&B 匯出（S0）**：`R/index.ts` 目前沒有任何 T&B 型別或常數，`ModuleViewMap`／`ModuleHintsMap` 沒有 `tradersBarbarians` 鍵。§3.1 的整張表都還沒做，範圍與行數估計不變。

**刷新時新發現的兩項**（都不改共用檔）：

- BA 被征服的格不生產（`TB/barbarians/index.ts:468-470`）：S6 用 `economy.hexYield` 處理。
- Trains 車廂的道路權重（`TB/trains/index.ts:285-291`）：S5 視需要用 `scoreExtras` 處理。

### 12.3 切片範圍與行數的調整

- **S1**：拿掉 fold 與 B-POLICY 放寬；加上 `B/base/robber.ts`、`B/base/roads.ts` 的所有權，以及 `support.test.ts` 保留清單的清理；`fallback.ts`、`policy.test.ts` 移出所有權。src 由 120–160 行降為 70–110 行，test 由 110–150 行降為 100–140 行。驗收加上 sf、ck、sf-ck 的決策雜湊比對（§4.3）。
- **S2**：
  - 註冊位置改為 `B/modules/registry.ts`。
  - 要更新 `support.test.ts:102-135` 的節奏合併斷言：它目前斷言 `BOT_PACING` 恰好是三個模組的合併，註冊 T&B 後就會失敗。
  - 一次加齊 8 筆 `PROFILE_LIMITS`，並把 kit 加進 `BENCH_KITS`。
  - `TbPartBot` 加上 `setup`、`planStep`、`trade`（§3.2）。
  - test 行數上調 10 行。
- **S3**：加上 FR 的 `robberTargets`（從 S1 移入）；src 上調 10 行。
- **S9**：加上 `families.ts` 的 family 登記與 `bots.test.ts` 的兩處（§6.5、§6.6）；test 上調 20–30 行。
- **合計**大致不變（§5）。

### 12.4 交給 Orchestrator 決定或先提交的合約（不需要使用者決定）

| # | 項目 | 建議 |
|---|---|---|
| C1 | `BotEconomyHooks.awards` 的簽章與組合 | 維持 `awards?(model: BoardModel): { readonly longestRoad?: boolean }`。組合規則：任一模組回 `longestRoad: false` 就關閉（AND）；沒有模組回答時視為開啟。把它從 `types.ts:122` 的「只保留型別」區塊移到「0.4.4 實作」區塊，並寫明呼叫點（§12.2）。E&P 沿用。不加 `largestArmy`：BA 的 profile 已設定 `retainLargestArmy: false` 與 `devDeck: []`（`R/profiles.ts:329-339`），bots 不會產生騎士團計畫 |
| C2 | `BotTradeHooks` 的簽章與 `goodValue` 的單位 | 保留現有簽章（`types.ts:128-131`）：`goods(view, playerId)` 回傳公開持有量；`goodValue(turn, good, amount)` 回傳 `number \| null`，null 表示拒絕。建議把單位寫死為「資源當量（張）」，再由 S1 乘上一張過剩資源的平均效用，換算到 `handUtility` 的尺度（`B/trade.ts:29-41`）。組合方式：`goods` 合併，`goodValue` 第一個非 undefined 勝出。把 `trade` 移到「0.4.4 實作」區塊；`phase`、`endWindow`、`routeEdge` 維持保留 |
| C3 | `support.test.ts` 的保留清單 | S1 從 `RESERVED_HOOKS` 移除 `'trade'`，從 `RESERVED_ECONOMY_HOOKS` 移除 `'awards'`（`:26-27`）。檢查器自我測試（`:90-93`）用的是 `awards`，要改用 `routeEdge`，否則斷言會失敗 |
| C4 | `types.ts` 的註解 | 順手把 `bot-driver.ts:332` 改為 `:421` |
| C5 | bench 的時機 | W3 的 QA 在本地暫時翻開 `TB_READY_PARTS` 跑 bench，量完不提交（比照 D6）；發布 PR 的 Q3 表格在 S9 之後重跑確認 |
| C6 | family 登記的時機 | 在 S9 登記（§6.6）；S3–S8 的測試檔只要明列 profile 即可 |

**需要使用者決定的事**：目前沒有。分支流程與 §10 都已在 2026-11-20 決定。以下兩點只是知會：

- 本版的 PR 流程與 `RELEASING.md:43` 的「squash 進 release 分支」不同。是否改寫 `RELEASING.md`，留待使用者另行指示；本計畫不改。
- `release/v0.4.4` 已經存在（`58fe789`）。

### 12.5 切片 brief 的補充事項

只列其他段落沒有寫到的陷阱。

- **S1**
  - `robberCandidates` 的迭代順序與跳過條件不得更動（`B/base/robber.ts:12`）。這裡只換 `victoryTarget` 的讀法，base 的 golden 必須不變。
  - `piecesOnBoard` 改成不算橋之後，`piecesLeft` 與 `Economy.left.roads` 隨之改變。只有 Rivers 有橋，其他 profile 不受影響。
  - `extraNumbers` 只在 Rivers 出現。`resourceWeights`、強盜候選與產量估計都讀 `hexPips`，一次就能修正，不要在模組裡用 `hexYield` 另行補償，否則會重複計算。
- **S2**
  - kit 的 `id` 必須是 `tradersBarbarians`：`kitsOf` 依 `ruleModules` 比對（`packages/bots/test/modules/types.ts:73-84`）。各 part 的子 kit 由這個 kit 依 `state.profileId` 的 active part 在內部組合。
  - `naiveModule`（`harness.ts:406-415`）只保留 `duty`、`supports`、`pacing`、上限與回應指令。T&B 的保底必須讓 naive 座位也能終局或走完有界局。
  - 4 個 event-cards profile 的 `supports` 必須回 false。`botsCanPlay` 對它們本來就因為 `enabled:false` 而不在矩陣裡，所以測試要直接呼叫 `supports`。
- **S3**
  - FR 的 `robberTargets` 只讀 hints，不得 throw、不得消耗亂數（`types.ts:163-172`）。hints 的 `robberHexes` 是以檢視者的身分計算的，FR 的判定與行動者無關，可以直接用。
- **S9**
  - hard 的拒絕不必寫程式，但 server 測試要涵蓋，文件比照 `docs/API.md:483`。

## 附錄：探查

第一輪的探查腳本當時放在 `/tmp/katan-bot-research/traders-barbarians/`，包括 `probe-mechanics.ts`、`probe-fbseat.ts`，沒有提交。2026-11-20 刷新時沒有重跑，也沒有依賴這些腳本：本次刷新只讀程式碼，所有實測數字沿用原稿。
