# Traders & Barbarians 電腦對手：實作計畫（v0.4.4）

- 日期：2026-11-04
- 狀態：建議計畫，待使用者確認 §10
- 前置閱讀：
  - 整體策略：`docs/aegis/plans/2026-11-04-expansion-bots-roadmap.md`（下稱「策略」）
  - bot 規格：`docs/aegis/specs/2026-11-01-bot-opponents.md`
  - rules 文件：`docs/FIDELITY.md` §Traders & Barbarians（:622 起）、R-TB 證據列（:138-144）
  - 第一輪研究：`docs/aegis/work/2026-11-04-bots-traders-barbarians-research.md`（清單不再重抄；探查腳本留在 `/tmp/katan-bot-research/traders-barbarians/`，不提交）
- 證據基準：`a200840`（v0.4.0）。0.4.1–0.4.3 會改動 bots 與 server 的行號，開工前由 Planner 刷新（R8）。
- 縮寫：`TB/` = `packages/rules/src/modules/tradersBarbarians/`；`R/` = `packages/rules/src/`；`B/` = `packages/bots/src/`；`S/` = `packages/server/src/`。
- 「實測」：本輪以 `node --experimental-transform-types` 跑 plus 原型（base 策略加上最小模組處理；腳本 `probe-mechanics.ts`、`probe-fbseat.ts`）量得。「推測」：依規則與常數推算，尚未用最終策略量測。耗時只當參考，結論以步數、局數、計數等決定性指標為準。

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
  - `tb-event-cards*`：`implemented:false`、`enabled:false`（`R/profiles.ts:291-353`），必須維持 Bot 不可玩，並以測試鎖住（§4.4）。
  - Catan for Two、5–6 人，以及和其他擴充或劇本的組合（`docs/FIDELITY.md:633-642`）。
  - Bot 主動提出含 gold 的報價（策略 §4.8）。
- **限制**
  - 不改 rules 行為（P8、I3）。只匯出型別與常數，並把投影與 hints 抽成具名函式。
- **品質**
  - Q1 必過；Q2 依 §6.3 的門檻；Q3 只報告（策略 §3.1）。
  - standard 與 easy 都要發出模組指令（DoD 1）。FR 與 H 沒有模組指令，改用 §6.3 的行為指標。

## 2. 現況與落差

v0.4.0 時，`BOT_RULE_MODULES` 是空的（`B/support.ts:12-17`），server 測試也斷言 T&B 沒有 Bot 座位（`packages/server/test/traders-barbarians.test.ts:66-89`）。第一輪量測如下：

- plus 原型：320 局全部終局，0 拒絕。
- 只走保底：BA 0/10 局終局，Traders 5/10 局終局。所以終局要靠 standard 與 easy 的策略；保底只負責不卡死。

| # | 落差 | 證據 | 切片 |
|---|---|---|---|
| G1 | 模組 frame 不論在策略或保底都回 null，整桌無聲停住 | `B/heuristic.ts:162-164`、`B/fallback.ts:41-43` | S2 |
| G2 | 強盜候選排除了目前所在格，也不看保護。FR 在全部受保護時，即使強盜已在沙漠也只能選沙漠；引擎接受模組列入的目前所在格 | `B/heuristic.ts:195-200`、`B/fallback.ts:19-25`；`TB/variants/friendlyRobber.ts:34-41`；`R/engine.ts:1462-1482` | S1、S3 |
| G3 | 個人勝利分只放在 `PublicPlayerView.victoryTarget`（與 profile 不同時才出現），bots 只讀全域值 | `R/project.ts:147-148`；`B/heuristic.ts:214,404`、`B/trade.ts:57` | S1 |
| G4 | Traders 停用最長道路（`minLongestRoad=Infinity`），bots 仍為它鋪路 | `TB/traders/index.ts:369-372`；`B/economy.ts:259-281` | S1、S7 |
| G5 | 蠻族騎士卡計入最大騎士團（`playedKnights`），bots 只認 `knight` | `TB/traders/index.ts:152-163`；`B/heuristic.ts:398-409`、`B/economy.ts:247-257` | S7 |
| G6 | Rivers 的 12 格另有一個 2（`extraNumbers`），bots 的產量只讀 `numbers` | `TB/rivers/board.ts:103`、`R/project.ts:250`；`B/board.ts:89` | S1 |
| G7 | 橋被算進道路存量，rules 不算 | `B/board.ts:139-141`；`R/analysis.ts:49` | S1 |
| G8 | 同意報價時，引擎同時檢查雙方的 goods，bots 只估資源 | `R/engine.ts:1874`；`B/trade.ts:38-44` | S1、S3 |
| G9 | `wagonBid` 依序回應（`responders[0]`），`wagonAssign` 同時回應（`includes`） | `TB/trains/index.ts:183-213` | S2、S5、S9 |
| G10 | 回合結束排入的 frame：Trains 投標、BA 騎士移動、Traders 每回合的車隊移動 | `TB/trains/index.ts:268-278`、`TB/barbarians/index.ts:489-498`、`TB/traders/index.ts:373-385`；`R/engine.ts:1115-1135` | S2、S9 |
| G11 | `activeParts` 靜默略過未知 variant，event-cards 會被解析成只剩 FR | `TB/index.ts:45-56` | S2 |
| G12 | B-POLICY 的「強盜不放自己的格」缺少「還有其他合法格」的條件，FR 下會誤報 | `packages/bots/test/policy.test.ts:57-60` | S1 |
| G13 | Fishing 的道路 hints 不檢查道路存量，`spendFish` 會檢查 | `TB/fishing/index.ts:389-409` 對照 `:195-282` | S4 |

## 3. 介面摘要

### 3.1 rules 匯出（S0，屬 P8 允許範圍，依策略 §4.3）

| 類別 | 名稱 | 來源 |
|---|---|---|
| 具名函式 | 7 個 part 的 `project` 與 `actionHints` 抽成 `fishingView`／`fishingHints` 這類具名函式；型別用 `ReturnType` 推導 | 各 part 的 `index.ts` |
| view／hints 型別 | `TbFishingView`/`Hints`、`TbCoinsView`/`Hints`、`TbRiversView`/`Hints`、`TbTrainsView`/`Hints`、`TbBarbarianAttackView`/`Hints`、`TbTradersView`/`Hints`、`TbHarborsView` | 同上 |
| 組合型別 | `TradersBarbariansView`、`TradersBarbariansHints`（含 `targets`、`board`、`robberHexes?`）；`ModuleViewMap.tradersBarbarians` | `TB/index.ts:184-212` |
| frame data | `TbVoteData`、`TbTreasonData`、`TbKnightsData`、`TbMoveData` | trains、barbarians、traders |
| part 對照 | `TB_SCENARIO_PART_IDS`、`TB_VARIANT_PART_IDS`：由 `SCENARIO_PARTS`、`VARIANT_PARTS` 的 `id` 推導 | `TB/index.ts:28-40` |
| 常數 | `TB_FRAME_KINDS`、`FISH_COSTS`、`FISH_LIMIT`、`FISH_SUPPLY`、`GOLD_PER_RESOURCE`、`PURCHASES_PER_TURN`、`BRIDGE_COST`、`BRIDGE_GOLD`、`WAGON_SUPPLY`、BA 卡成本與牌組、`CONQUER_AT`、`WAGON_LEVELS`、`UPGRADE_COSTS`、`BOOST_MP`、Strongest Ports 分數 | 各 part |

S0 的驗收是「投影不變」：rules 既有的 T&B 模擬測試全部通過，並新增一個測試，斷言 8 個 profile 在固定種子下，`project` 的 JSON 與抽出前完全相同。

### 3.2 bots 模組（`B/modules/tradersBarbarians/`）

| 檔案 | 內容 | 切片 |
|---|---|---|
| `index.ts` | 實作 BotModule `tradersBarbarians`，依 active part 組合各 `TbPartBot` | S2 |
| `part.ts`、`parts.ts` | `TbPartBot` 介面；part id 對 TbPartBot 的表；`TB_READY_PARTS`（S2 時是空集合，S9 才翻開） | S2；S9 只改一行 |
| `view.ts`、`frames.ts` | 型別化的 accessor，例如 `tbView`、`tbHints`、`goldOf`；frame kind 常數；P3 資格判定 `isMine` | S2 |
| `duty.ts` | §4.1 的整張保底表；S2 合併後凍結 | S2 |
| `graph.ts` | 車隊與騎士的最短路徑與可達性 | S2 |
| `coins.ts`、`variants.ts`、`fishing.ts`、`rivers.ts`、`trains.ts`、`barbarianAttack.ts`、`traders.ts` | 各 part 的策略。S2 先放只含 `id` 的 stub | S3–S8 |

```ts
export interface TbPartBot {
  readonly id: string;  // rules part id，例如 'tb-fishing'
  answerFrame?(turn: TurnContext, frame: PublicModulePendingView): BotCommand | null | undefined;
  preroll?(turn: TurnContext): Scored<BotCommand>[];
  actions?(turn: TurnContext): Scored<BotCommand>[];
  robberTargets?(view: GameView, selfId: string, targets: readonly (number | null)[]): readonly (number | null)[];
  economy?: BotModule['economy'];
  goodValue?(turn: TurnContext, good: string, amount: number): number | null;
  readonly pacing?: Readonly<Record<string, number>>;
  readonly responseCommands?: readonly string[];
}
```

T&B 使用的平台鉤子：

- `supports`、`duty`、`answerFrame`、`preroll`、`actions`、`robberTargets`；
- `economy` 的 `cardKinds`、`costs`、`piecesLeft`、`hexYield`、`scoreExtras`，以及新的 `awards`（見 §11-1）；
- `trade` 的 `goods`、`goodValue`；
- `pacing`、`maxCommandsPerWindow`、`responseCommands`。

T&B 不使用 `phase`、`endWindow`、`banditCandidates`、`freeRouteCandidates`。module 內部的組合方式與策略 §4.2 相同：part 依 rules 順序詢問，frame 由第一個回應的 part 勝出，候選全部串接後統一評分。

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

這裡必須讀原始的 `scenario` 與 `variants`，不能用 `activeParts`：它會丟掉未知 variant（`TB/index.ts:51-52`），event-cards 會因此被放行。`tb-support.test.ts` 鎖住以下兩點：

- 4 個 `tb-event-cards*` 一律回 false；
- 測試中把一個 part 移出 `TB_READY_PARTS` 時，只有含該 part 的 profile 會關閉。

## 4. 設計

### 4.1 保底（`duty.ts`；規則 7）

保底只用 hints 與 view 裡的現成候選。依序回應的 frame 檢查 `responders[0]===self`。同時回應的 frame 由 standard 用 `includes(self)` 回應；保底保守起見，同樣只在 `responders[0]===self` 時動作（P3）。

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
| 10 | `baKnights`（回合結束排入） | 停在城堡邊、且有落點的己方騎士，用 `targets['tb.moveKnight:<e>:0'][0]` 移走；沒有這種騎士時送 `tb.endKnights` | `endKnights` 只在城堡邊騎士有落點時拒絕；落點不含城堡邊 | `:323-370` |
| 11 | `tbBarbarian`（擲出 7） | `tb.moveBarbarian`：`barbarians[0]` → `targets['tb.barbarian:'+from][0]` | 落點是所有沒有蠻族的邊 | `TB/traders/index.ts:118-133,423-425` |
| 12 | `tbWagon`（每回合結束） | `tb.wagonStop`；有 Swift Journey 額外移動時再送一次 | stop 在任何狀態都可以送 | `:219-233,297-301,373-385` |
| 13 | FR 的 `moveRobber` | `hints.robberHexes[0]`，可以等於目前所在格 | hints 已經套用 FR 的縮減；引擎接受模組列入的格 | `TB/index.ts:205-212`；`R/engine.ts:1462-1482` |
| 14 | FR 的騎士卡、Traders 的蠻族騎士卡與 Swift Journey | 不打 | 打牌不是強制動作 | — |
| 15 | base 的棄牌、偷牌、豐收之年、道路建設 | 沿用 base 的 `pendingDuty` | base 未改；Traders 牌組內有道路建設 | `B/fallback.ts` |
| 16 | setup，包括 BA 與 Traders 第 2 輪放城市、Fishing 第 2 輪拿魚 | `setup.placeBuilding` 用 `legalSettlements[0]` | 引擎依 `setupBuilding` 自動決定放城市 | `B/fallback.ts:65-71`；`TB/barbarians/index.ts:467`、`TB/traders/index.ts:337` |
| 17 | preroll、action | `turn.roll`、`turn.end` | Traders 擲出 2 或 12 會自動重擲 | `B/fallback.ts` |

保底的驗收（S2）：

- 每一列都有固定盤面的 I9 單元測試，分別測保底、standard 與 easy。
- 8 個 profile 各跑一次「全部座位只走保底」的有界局，結果是 0 拒絕，而且每一步都有動作。

### 4.2 standard 與 easy

分數尺度沿用策略 §4.2，以「勝利分當量 ÷ (1+eta)」計，資源先換算成資源當量。

| part | standard | easy（P9：必須終局，可少用進階機制） |
|---|---|---|
| variants（S3） | **FR**：`robberTargets` 直接採用 `hints.robberHexes`，在其中選阻擋價值最高的格；有合法目標時才打騎士卡。**H**：用 `scoreExtras` 估港口點數的差額；Strongest Ports 需要至少 3 點，且必須嚴格超過持有者才會轉手 | FR 規則相同；H 不估 Strongest Ports |
| coins（S3） | 1 gold = 0.5 資源（`GOLD_PER_RESOURCE=2`）。`tb.buyResource` 只在能補齊本回合的建造時使用，每回合最多 2 次。`tb.sellResources` 只在 Rivers 要脫離 Poor，或資源已超過手牌上限時使用 | 只買不賣 |
| rivers（S8） | 橋的成本是 brick 2、lumber 1，可得 +3 gold，每人 3 座，以 road 計畫評估。金幣額外計入排名效果：唯一最多者 +1，最少者（含並列）−2 | 有橋點時照樣蓋；不估排名 |
| fishing（S4） | 每個魚片期望值 55/29 ≈ 1.90 條魚（`FISH_SUPPLY` [11,10,8]，`TB/fishing/index.ts:21`）。依 `FISH_COSTS` 選用途：2 移走強盜、3 偷牌、4 取資源、5 道路、7 發展卡；買道路前先檢查剩餘道路數（G13）。有對象時立即交出舊靴。`fishSwap` 只換掉面額 1 的魚片 | 只用在道路、取資源與發展卡；不交換 |
| trains（S5） | 只用計畫外剩下的 wool 與 grain 出價，目標是車廂落在自己的道路上（權重 2），或讓車廂夾住自己的建築。分配與放置都選對自己價值最高的位置 | 出價 0；分配與放置照常選擇 |
| BA（S6） | 沿海建築受到威脅（蠻族數量接近 `CONQUER_AT=3`）時，優先買 BA 卡（wool、grain、ore 各 1）。騎士朝可驅逐的格移動；grain 足夠時才加速。Treason 選擇最傷害領先者的走法 | 同樣買 BA 卡並移動騎士，不加速；Treason 取第一個 |
| Traders（S7） | `graph.ts` 依 MP 計算最短路徑；路上有蠻族時 +2 MP；經過對手道路時付 1 gold 過路費，並為此保留 1 gold 的準備金。運貨優先。升級與加速以「本回合多送一次貨」來估值。蠻族騎士卡同時計入最大騎士團與排除擋路的蠻族，也可以在 preroll 打出。不為最長道路鋪路 | 照樣依路線送貨，不升級、不加速 |

**gold 交易與規則 9**

- standard 依 `goodValue` 估值回應含 gold 的報價；easy 一律拒絕含 goods 的報價；兩者都不主動提出 gold 報價。
- 以下情況一律拒絕：
  - 報價含 gold 以外的 goods；
  - `wantGoods` 超過自己持有的 gold；
  - `giveGoods` 超過對方公開的 gold（引擎在同意時會檢查雙方，`R/engine.ts:1874`；見 §11-3）。

### 4.3 共用檔修正（S1 獨佔）

| 修正 | 位置 |
|---|---|
| 新增 `targetOf(view, id)`，回傳 `player.victoryTarget ?? view.victoryTarget`，取代三處讀全域值的程式 | `B/heuristic.ts:214,404`、`B/trade.ts:57` |
| 讀取 `economy.awards`，`longestRoad:false` 時不再推動最長道路計畫 | `B/economy.ts:259-281` |
| `hexPips` 加上 `extraNumbers`；道路存量不算橋 | `B/board.ts:89,139-141` |
| 依 `trade.goods` 與 `goodValue` 做 goods 估值；補上規則 9 對提議者 gold 的檢查 | `B/trade.ts:38-57` |
| `robberTargets` 的 fold 已由 0.4.3 的 SFCK-P 實作；S1 只確認 FR 回傳目前所在格時，策略與保底都能用（§11-2） | `B/heuristic.ts:195-200`、`B/fallback.ts:19-25` |
| B-POLICY 的「不放自己的格」改為只在還有其他合法格時才檢查 | `packages/bots/test/policy.test.ts:57-60` |

S1 的驗收是 golden replay：base 3–6 人、每個人數 10 個種子，指令序列與改動前逐一相同（沿用策略 PL-1 的作法）。

### 4.4 節奏與每視窗上限

server 以 `command.type` 查表（`S/bot-driver.ts:431`），預設 900 ms（`:64`）。T&B 匯出的 `pacing` 如下：

| 指令 | ms | 指令 | ms |
|---|---|---|---|
| `tb.buildBridge`、`tb.buildBaCard`、`tb.upgradeWagon`、`tb.spendFish`、`tb.giveBoot` | 900 | `tb.wagonStep` | 450 |
| `tb.buyResource`、`tb.sellResources` | 800（同 `trade.bank`） | `tb.wagonBoost`、`tb.moveKnight` | 600 |
| `tb.playKnight`、`tb.playSwiftJourney` | 1100（同 `dev.play*`） | `tb.wagonStop` | 500 |
| `tb.moveBarbarian` | 1200（同 `pending.moveRobber`） | `tb.endKnights` | 700 |
| `tb.bidWagon`、`tb.driveOff` | 1000 | `tb.fishSwap`、`tb.baSteal` | 800（同 `pending.steal`） |
| `tb.assignWagon`、`tb.placeWagon`、`tb.baCapture`、`tb.baPlaceKnight`、`tb.baTreason` | 900 | | |

**每視窗上限**：`maxCommandsPerWindow` 維持 40（`S/bot-driver.ts:70`）。

- 依據：
  - 實測每個 Bot 單一視窗最多 15 個指令。
  - Traders 的車隊移動排在同一個視窗裡（`finishTurn` 才遞增 `windowId`，`R/engine.ts:563`）。理論上一次移動最多 14 個指令，加上 Swift Journey 是 28 個。
- 要求：
  - Traders 策略在單一 `tbWagon` frame 內最多送 12 個指令，之後改送 `tb.wagonStop`。
  - Q3 若任何 profile 的最大值超過 30，就把模組上限調到 60（D-TB7）。

## 5. 切片與 PR

分支命名為 `feat/bots-tb-<slice>`，worktree 放在 `.worktrees/bots-tb-<slice>/`（策略 §7）。PR 指向 `release/v0.4.4`，以 squash merge 合併，subject 保留 `(#N)`。

| 切片 | 分支／worktree slug | 檔案所有權（並行切片之間不重疊） | 內容 | src／test 行 | 依賴 | 驗收指令 |
|---|---|---|---|---|---|---|
| S0 匯出 | `feat/bots-tb-exports`／`bots-tb-exports` | `TB/**`、`R/index.ts`、`packages/rules/test/tb-exports.test.ts` | §3.1 | 100–140／20–40 | — | `pnpm --filter @catan/rules typecheck && pnpm --filter @catan/rules exec vitest run && pnpm --filter @catan/web typecheck` |
| S1 共用 | `feat/bots-tb-shared`／`bots-tb-shared` | `B/{heuristic,economy,board,trade,fallback}.ts`、`packages/bots/test/{policy,shared-tb}.test.ts`；`B/modules/types.ts` 的 `awards` 由 Orchestrator 先在此分支提交 | §4.3 | 120–160／110–150 | 0.4.1–0.4.3 的平台 | `pnpm --filter @catan/bots typecheck && pnpm --filter @catan/bots test`，加上 golden replay |
| S2 核心 | `feat/bots-tb-core`／`bots-tb-core` | `B/modules/tradersBarbarians/{index,part,parts,view,frames,duty,graph}.ts` 與 7 個 part 的 stub；`B/modules/index.ts` 的註冊；`packages/bots/test/modules/tradersBarbarians.ts` 與 `test/modules/tb/*.ts` 的 stub；`test/{tb-duty,tb-support}.test.ts` | `supports`、保底 17 列、frame 分派、守恆與擾動工具、`onEndTurn` defer 與依序多 responder 的單元測試 | 300–360／280–340 | S0、S1 | `pnpm --filter @catan/bots exec vitest run test/tb-duty.test.ts test/tb-support.test.ts && pnpm --filter @catan/bots typecheck` |
| S3 coins＋variants | `feat/bots-tb-coins-variants`／`bots-tb-coins-variants` | `…/{coins,variants}.ts`、`test/modules/tb/{coins,variants}.ts`、`test/tb-{coins,variants}.test.ts` | gold、規則 9、FR、H | 150–190／130–170 | S2 | `pnpm --filter @catan/bots exec vitest run test/tb-coins.test.ts test/tb-variants.test.ts` |
| S4 Fishing | `feat/bots-tb-fishing`／`bots-tb-fishing` | `…/fishing.ts`、`test/modules/tb/fishing.ts`、`test/tb-fishing.test.ts` | §4.2 | 150–190／110–140 | S2 | 同上，換成該檔 |
| S5 Trains | `feat/bots-tb-trains`／`bots-tb-trains` | `…/trains.ts`、`test/modules/tb/trains.ts`、`test/tb-trains.test.ts` | §4.2 | 140–180／110–140 | S2 | 同上 |
| S6 BA | `feat/bots-tb-barbarian-attack`／`bots-tb-barbarian-attack` | `…/barbarianAttack.ts`、`test/modules/tb/barbarianAttack.ts`、`test/tb-barbarian-attack.test.ts` | §4.2 | 210–260／130–170 | S2 | 同上 |
| S7 Traders | `feat/bots-tb-traders`／`bots-tb-traders` | `…/traders.ts`、`test/modules/tb/traders.ts`、`test/tb-traders.test.ts` | §4.2 | 260–320／140–180 | S2 | 同上 |
| S8 Rivers | `feat/bots-tb-rivers`／`bots-tb-rivers` | `…/rivers.ts`、`test/modules/tb/rivers.ts`、`test/tb-rivers.test.ts` | §4.2 | 100–130／80–110 | S3（gold 估值） | 同上 |
| S9 開放 | `feat/bots-tb-gate`／`bots-tb-gate` | `parts.ts` 的 `TB_READY_PARTS`；`packages/bots/test/support.test.ts` 的快照；`packages/server/test/{traders-barbarians,bots-traders-barbarians}.test.ts`；§7 的文件 | 開放 gating、快照、server 四類測試、文件 | 10–20／180–230，另有文件 40–60 | S3–S8 與 QA 結果 | `pnpm --filter @catan/server exec vitest run test/bots-traders-barbarians.test.ts test/traders-barbarians.test.ts test/bots.test.ts && BOTS_SEEDS=10 pnpm verify` |

- **合計**：src 1,540–1,950 行，test 1,290–1,670 行，總計約 2,830–3,620 行，文件另計。策略 §5 估 2,900–3,500 行。
- **各 part 測試的閘門版**：S3–S8 的驗收都要再加跑 `BOTS_SEEDS=10` 版本，並跑 `pnpm --filter @catan/bots typecheck`。
- **波次**
  - W0：S0 與 S1 並行。
  - W1：S2。
  - W2：S3、S6、S7 先做，把最長的 BA 與 Traders 提前；接著做 S4、S5，以及 S3 合併後的 S8。並行上限 3。
  - W3：QA 跑閘門矩陣與 bench。
  - W4：S9。
- **與第一輪批次的對應**
  - 批次 1 → S1–S3；
  - 批次 2 → S4、S5、S8；
  - 批次 3 → S6；
  - 批次 4 → S7。
- **共用檔**：`heuristic.ts`、`economy.ts`、`board.ts`、`trade.ts` 只歸 S1。part 切片若需要共用檔的改動，回報 Orchestrator，排進 S1 的後續 PR。
- **替代方案（策略 §5.2）**：W3 時 BA 或 Traders 仍未通過 Q1 或 Q2，S9 就只把其餘 part 放進 `TB_READY_PARTS`，先開放 6 個 profile（`tb-coins` 由 Rivers 帶入）。
  - 落後的 part 程式照樣合併，但不開放；測試保留明列的 profile 清單，繼續執行。
  - 該 part 移到 0.4.5 開放。

## 6. 測試與驗收

### 6.1 Q1 矩陣（B-GAME 仿 BotDriver 模式；策略 §4.6）

| profile | 人數 | 種子（預設／閘門） | 座位 | 步數上限 | 看門狗 N（回合） | 實測依據：最多步數／最長無得分回合 |
|---|---|---|---|---|---|---|
| FR、H、FR+H | 3、4 | 3／10 | standard 與 easy 輪替；另加 1 個種子讓 bot2 只走保底 | 3000 | 60 | 522／23 |
| Fishing | 3、4 | 3／10 | 同上 | 3000 | 60 | 451／29 |
| Rivers | 3、4 | 3／10 | 同上 | 3000 | 60 | 508／26 |
| Trains | 3、4 | 3／10 | 同上 | 3000 | 60 | 556／24 |
| BA | 3、4 | 3／10 | 同上 | 5000 | 60 | 1079／31 |
| Traders | 3、4 | 3／10 | 同上 | 5000 | 60 | 538／14；rules 腳本模擬最多 1091 步 |
| 全部座位只走保底（有界局） | 3、4 | 1／3 | 全部座位都用保底 | 800 | 不適用 | 不要求終局，只要求 0 拒絕且每一步都有動作；實測 BA 0/10、Traders 5/10 局終局 |

- 實測範圍：plus 原型跑 20 個種子 × 3、4 人，全部勝出、0 拒絕。bot2 只走保底的 80 局全部終局，無得分最長 30 回合。
- 通過條件：
  - 0 拒絕；
  - 在步數上限內分出勝負；
  - 結束時沒有殘留的 pending；
  - 守恆成立（§6.2）；
  - 不出現「策略閒置、但保底有動作」；
  - B-FAIR 與 fuzz 通過。
- B-FAIR 要擾動的隱藏資訊：
  - 對手的魚片面額（數量不變）與魚片供應的順序（`TB/fishing/index.ts:370-385`）；
  - BA 牌庫的順序；
  - Traders 的發展卡牌庫與對手手牌。

### 6.2 守恆（`test/modules/tb/<part>.ts` 的 `conservation`）

rules 測試已在模擬局結束時斷言以下不變量，因此不再列為推測。bots 端在每局結束時檢查，並每 50 步檢查一次。

| part | 不變量 | rules 已有的斷言 |
|---|---|---|
| base | 各資源：手牌 + 銀行 + 投標中的牌（`frame.data.bids`，投標結束才歸還銀行）= 19 | `TB/trains/index.ts:131-136,190-213` |
| tb-coins | 玩家 gold 合計 + supply = 100 | `packages/rules/test/tb-rivers.test.ts:439`、`tb-barbarians.test.ts:491-497`、`tb-traders.test.ts:457-463` |
| tb-fishing | 各面額的 supply + 棄堆 + 手牌 = [11,10,8]；舊靴只有 1 個 | `tb-fishing.test.ts:426` |
| trains | 車廂 + supply = 22，且邊不重複 | `tb-trains.test.ts:411-412` |
| BA | 盤上蠻族 + 俘虜 + supply = 36；牌庫 + 棄堆 = 26 | `tb-barbarians.test.ts:491-497` |
| Traders | commodity 共 36；3 個蠻族所在的邊互不相同 | `tb-traders.test.ts:457-463` |

### 6.3 Q2 門檻（全部種子合計；S = 每個人數的種子數，共 2S 局）

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

### 6.4 Q3 bench（`pnpm --filter @catan/bots bench -- --profile <id>`，只報告）

| 設定（各 50 局） | 軟目標 |
|---|---|
| 3 人：1 standard 對 2 easy | standard 勝率 ≥45%（公平份額 33.3%；base 實測 50%） |
| 4 人：2 standard 對 2 easy | standard 勝率 ≥60%（公平份額 50%；base 實測 70%） |
| 3 人：1 standard 對 2 naive | standard 勝率 ≥40%；另報告 BA 與 Traders 的 naive 終局率 |

- 其他指標與軟目標：平均回合數 ≤ plus 原型 × 1.15；拒絕數 0；fallback 次數 0；每視窗最大指令數 ≤30；`decide` 最大耗時 ≤50 ms；模組機制計數只報告。
- plus 原型的平均回合數（3 人／4 人）：FR 21／18、H 22／19、FR+H 22／19、Fishing 23／19、Rivers 19／18、Trains 24／19、BA 26／26、Traders 17／14。

### 6.5 server 測試（S9，新檔 `packages/server/test/bots-traders-barbarians.test.ts`）

1. 經 HTTP 的完整對局，用 `tb-merchant-trains-2025`。這一局同時涵蓋 `onEndTurn` defer 與依序多 responder 的 frame。
2. 由保底接手：在 `tb-traders-barbarians-2025` 的 `tbWagon` frame 注入一個不合法的 `tb.wagonStep`，預期改由 `tb.wagonStop` 接手，對局繼續。
3. 真人與 Bot 同桌，處理 `wagonBid`（依序）與 `wagonAssign`（同時）。真人在前、Bot 在前兩種順序都要測，斷言 Bot 只在輪到自己時回應，而且不會擋住真人。
4. 在 Traders 的車隊移動 frame 進行中重啟 server，Bot 恢復後完成移動。
5. 翻轉 `packages/server/test/traders-barbarians.test.ts:66-89`：開放的 profile 改為 `botSeats:true`，可以加入 Bot；若走替代方案，未開放的 profile 維持 `E_INVALID_BOT`。

### 6.6 測試檔與時間預算

- **測試檔**：B-GAME、B-POLICY 與 Q2 計數共用同一批對局，不重跑。
  - 新增 9 個檔：`tb-support`、`tb-duty`、`tb-coins`、`tb-variants`、`tb-fishing`、`tb-rivers`、`tb-trains`、`tb-barbarian-attack`、`tb-traders`。
  - 各檔明列自己的 profile，因此在開放 gating 之前就能測試（§11-5）。
- **預算估算**（實測平均每局 0.51 s，BA 0.59 s）

  | 項目 | 預設 | 閘門（`BOTS_SEEDS=10`） |
  |---|---|---|
  | B-GAME 對局數 | 每個 profile 8 局，共約 32 s | 每個 profile 22 局，約 90 s |
  | 只走保底的有界局 | 約 16 s | 約 48 s |
  | B-FAIR、fuzz 與單元測試 | 約 15 s | 約 15 s |
  | CPU 合計 | 約 63 s | 約 150 s |
  | vitest 並行後 bots 測試增加的 wall time | 約 12–20 s | 約 35–50 s |

  現行 bots 套件是 48 個測試，約 20 s。
- **拆檔規則**：預設下單檔超過 15 s，或閘門下單檔超過 60 s，就依人數拆檔，例如 `tb-barbarian-attack.3p.test.ts`。timeout 統一為 120 s。

## 7. 文件與發布

| 檔案:行（v0.4.0） | 更新內容 | 切片 |
|---|---|---|
| `docs/SPEC.md:188` | 「Today that is …」一句加入開放的 T&B profile（3–4 人）；R-BOT 條文（`:192`）不改 | S9 |
| `docs/aegis/specs/2026-11-01-bot-opponents.md:16` | 支援的 profile 加入 T&B | S9 |
| 同上 `:19` 與 §5 規則 7、9 | 範圍外保留 event-cards；保底表指向本計畫 §4.1；規則 9 補上提議者 gold 的檢查 | S9 |
| `docs/API.md:141-147` | 開放的 T&B profile 改為 `botSeats:true`；`tb-event-cards*` 仍不可加 Bot | S9 |
| `docs/FIDELITY.md:45-52` | T&B profile 列註明 bot seats | S9 |
| `docs/FIDELITY.md:144` 之後 | 新增 R-TB-BOT 證據列，指向 bots 的 `tb-*.test.ts` 與 server 測試 | S9 |
| `docs/FIDELITY.md:633-642` | 範圍段落加一句 Bot 支援的範圍 | S9 |
| `README.md:136-139` | T&B 條目加上「computer opponents」 | S9 |
| `docs/aegis/work/<date>-bots-traders-barbarians.md` | 新的工作紀錄，附 Q1／Q2／Q3 結果與實測門檻的調整 | S9 |
| `docs/aegis/INDEX.md` | 加入本計畫與工作紀錄 | S9 |

大廳文案在 0.4.1 已經改過（策略 §4.4），這一版不用動。

發布流程依策略 §7：

1. v0.4.3 stable 發布後，從 `master` 切出 `release/v0.4.4`；各切片的 PR 指向它，master 有修正時以 merge 方式同步進來。
2. 打 rc 前，Browser QA 依 DoD 5 驗證 8 個 profile：從大廳建房、加入 easy 與 standard 電腦後開局，觀察數個 Bot 回合，確認用到代表性機制且沒有停住。可沿用 `scripts/traders-barbarians/capture.py` 截圖；截圖是否提交依策略 D10。
3. 在 release 分支 push `🔖 release: v0.4.4-rc.1` 並打 tag，用 rc 映像試玩。
4. 發 stable：開 `release/v0.4.4 → master` 的 PR，以 merge commit 合併；打 tag 前先跑 `BOTS_SEEDS=10 pnpm verify`；release notes 用 `scripts/release-notes.sh` 產生並跑 `scripts/release-notes-lint.sh`；發布 PR 附上 Q3 表格並與 0.4.3 比較。
5. tag 與 Release 只在使用者明確授權後，由 Release Manager 處理。

## 8. Paseo 分工

派工前以 `list_profiles` 的實際結果為準。prompt 開頭寫「角色：…」，並寫明檔案範圍與驗收指令。

| 順序 | 角色 | 工作 | 隔離 | 並行 |
|---|---|---|---|---|
| 0 | Planner | 依 0.4.3 的程式刷新本計畫的行號與鉤子名稱；唯讀 | 共用工作區 | — |
| 0 | Orchestrator | 切出 release 分支；在 S1 分支先提交 `modules/types.ts` 的 `awards`；負責註冊表審核、Git、整合與最終驗證 | 主 worktree | — |
| W0 | Implementer（Backend）× 2 | S0、S1 | 各自的 worktree | 2 |
| W1 | Implementer（Backend） | S2 | worktree | 1 |
| W2 | Implementer（Backend）× 3 | 先做 S3、S6、S7，再做 S4、S5、S8 | 各自的 worktree | ≤3 |
| 每個 PR | Reviewer（Sol） | 審查合法性、I9、決定性、B-FAIR，以及檔案所有權是否越界；唯讀 | 共用工作區 | 跟著 PR |
| S0、S1、S2 | 再加 Reviewer（Opus） | rules 匯出是否零行為變更、共用檔與 golden replay、`duty.ts` 合約；唯讀 | 共用工作區 | — |
| W3 | QA | 跑 `BOTS_SEEDS=10` 矩陣與 bench，彙整 Q1／Q2／Q3，提出門檻調整；只改測試 | worktree | 1 |
| W3 | Architect（視需要） | 分數尺度爭議（R9）與 Q2 未達時的取捨；唯讀 | 共用工作區 | — |
| W4 | Implementer（Backend） | S9 | worktree | 1 |
| rc 前 | Browser QA | DoD 5 | 共用工作區 | — |
| 授權後 | Release Manager | rc 與 stable | — | — |

- subagent 不 push、不改 lockfile；對合約有疑義時回報 Orchestrator。
- 閒置的 agent 把交接筆記寫到 `.worktrees/_handoff/` 後停止。

## 9. 風險

| # | 風險 | 對策 |
|---|---|---|
| R1 | BA 對局偏長：最多 1079 步、218 回合；只走保底時 0/10 局終局 | 步數上限 5000、看門狗 60；easy 也必須買 BA 卡並移動騎士（P9）；S6 先開工 |
| R2 | Traders 車隊每回合都要處理 frame，視窗指令偏多；路徑計算可能不具決定性 | 每個 frame 最多 12 個指令；`graph.ts` 遇到同分時依邊或頂點編號決勝；B-GAME 重跑同一種子，必須得到相同的指令序列 |
| R3 | gold 被人類玩家用報價套利，或 Bot 同意後被拒 | 規則 9 加上提議者 gold 的檢查；easy 拒絕所有含 goods 的報價；gold 估值保守取 0.5 |
| R4 | 測試時間超出預算 | 共用對局；依 §6.6 的規則拆檔；預設種子 3 |
| R5 | FR 在沙漠的邊角情況：實測 4 人 FR 與 FR+H 共 40 局中，被迫放沙漠 3 次、留在沙漠 2 次 | `robberTargets` fold（§11-2）；固定盤面單元測試；放寬 B-POLICY 的檢查 |
| R6 | event-cards 日後實作時被自動放行 | `supports` 讀原始 id；`tb-support.test.ts` 加上 S9 的快照 |
| R7 | 標為「推測」的 Q2 門檻不切實際 | W3 由 QA 依 standard 的實測值校正；只能在使用者同意下調低（D-TB2） |
| R8 | 0.4.1–0.4.3 改動了鉤子名稱或行號 | 開工前由 Planner 刷新；S2 的介面以當時的 `modules/types.ts` 為準 |
| R9 | 各 part 的分數尺度不一致，例如 gold、魚、俘虜，導致策略偏食 | 統一換算成資源當量；bench 的機制計數若偏差就交給 Architect |
| R10 | BA 的 capture 替換迴圈理論上可能開出沒有目標的 frame（`TB/barbarians/index.ts:179-187`） | 矩陣斷言這種情況不會發生；萬一發生，走 server 的「欠動作」診斷；修正走 rules 的修正 PR，不在本版範圍 |

## 10. 待使用者決定的事

| # | 事項 | 建議 |
|---|---|---|
| D-TB1 | 一次開放 8 個 profile，或先開 6 個 | 以 8 個為目標；W3 時 BA 或 Traders 未過 Q1 或 Q2，就改走替代方案先開 6 個 |
| D-TB2 | Q2 門檻（§6.3），其中 7 項是推測 | 先照表採用；QA 實測後只允許調高，調低要經使用者同意 |
| D-TB3 | gold 交易 | standard 估值後回應、easy 一律拒絕、兩者都不主動提出 |
| D-TB4 | rules 匯出範圍（§3.1） | 照表匯出，含 frame data 型別；web 的本地型別不在本版改 |
| D-TB5 | easy 的下限 | 依 §4.2：BA 要買卡並移動騎士，Traders 要送貨；其餘進階機制關閉 |
| D-TB6 | Harbors 的 Q2 指標 | 用「Strongest Ports 有持有者的局數」；替代方案是「standard 的港口點數高於 easy」 |
| D-TB7 | 節奏與上限 | 照 §4.4；上限先維持 40，Q3 超過 30 時改為 60 |

## 11. 與整體策略的差異

> 2026-11-04：1–7 都已併入整體策略（§3.1 Q1、§4.1、§4.2、§4.4、§4.5 規則 9、§4.6、§4.7-3、§4.9、§5、§6 DoD）。第 1 項與 E&P 計畫提出的 `economy.basePlans` 統一為 `economy.awards`，由本版 S1 建立，E&P 沿用。第 2 項經獨立審查後定稿為與 rules 相同的有序 fold（`packages/rules/src/engine.ts:1462-1471`）：每個模組收到目前候選並回傳下一組，可以縮小、替換或擴大；這涵蓋了本項要的「取代」，也取代了「多個模組之間取交集」的寫法。fold 的元素型別依 SF+CK 計畫推廣為 `number | null`，並提前到 0.4.3 交付，本版直接使用。下列各項保留原始論證。worktree 路徑依策略 §7 改為 `.worktrees/bots-tb-<slice>/`。

1. **新增 `economy.awards` 鉤子**（策略 §4.1 沒有）。
   - Traders 以 `minLongestRoad=Infinity` 停用最長道路（`TB/traders/index.ts:369-372`），但 bots 無從得知，仍會推動道路計畫（`B/economy.ts:259-281`）。
   - 用 `scoreExtras` 扣分無法關掉計畫本身，所以改用 `awards: { longestRoad?: boolean }`。
   - 合約檔由 Orchestrator 修改。
2. **`robberTargets` 取代 base 的預設，而不是與它取交集**（策略 §4.1、§4.2 寫的是「只能縮小」與「取交集」）。
   - FR 在全部受保護、強盜又已在沙漠時，唯一的合法格就是目前所在格（`TB/variants/friendlyRobber.ts:34-41`；引擎接受，`R/engine.ts:1462-1482`）。
   - base 預設會排除目前所在格（`B/heuristic.ts:195-200`、`B/fallback.ts:19-25`），取交集後是空集合，Bot 就會卡住。實測 40 局中出現 2 次「留在沙漠」。
   - 多個模組之間仍然取交集。
3. **規則 9 補一條**：`giveGoods` 超過提議者公開的 gold 時也拒絕。引擎在同意時會檢查雙方（`R/engine.ts:1874`），只檢查自己這一方仍會被拒。
4. **Q1 加上兩種局**：每個人數加 1 個「bot2 只走保底」的種子，另加「全部座位只走保底」的有界局。保底不保證終局（實測 BA 0/10），所以後者只驗證 0 拒絕與不卡死。
5. **T&B 各 family 的測試檔明列自己的 profile**，不依賴 `BOT_TEST_MATRIX`，讓 S3–S8 在開放 gating 之前就能跑 B-GAME。
   - 通用矩陣跳過已由 family 測試檔涵蓋的 profile，避免重跑。
   - 另加守門測試：`BOT_TEST_MATRIX` 中的每個 profile，必須至少被一個測試檔涵蓋。
   - gating 的翻轉集中在 S9 一行。
6. **型別依策略 §4.3 由 rules 匯出**，撤回第一輪「bots 自建本地型別」的建議。
7. **FR 與 H 沒有模組指令**，DoD 1 的「發出模組指令」改用 §6.3 的行為指標判定（強盜落點、Strongest Ports）。
