# Seafarers（Heading for New Shores）電腦對手：第一輪研究報告

> 收錄說明：2026-11-04 第一輪唯讀研究報告，內容原樣保留，基準 `a200840`（v0.4.0）。定稿計畫是 `docs/aegis/plans/2026-11-04-bots-seafarers.md`，研究之後的修正一律以計畫為準。文中的 `/tmp/katan-bot-research/<slug>/report.md` 對應 `docs/aegis/work/2026-11-04-bots-<slug>-research.md`；探查腳本與輸出沒有提交。

> 角色：Planner（唯讀研究）。基準是 `docs/expansion-ai-opponent-plans` 分支，與 v0.4.0 `a200840` 相同。
> 研究期間沒有修改 repo 內任何檔案，也沒有任何 git 寫入。所有 probe 腳本都放在 `/tmp/katan-bot-research/seafarers/`（清單見附錄）。
> 時間量測分兩批：
> - **高負載批**：load 24–103，6 核，與其他 agent 共用機器。
> - **低負載批**：2026-11-04 20:44–20:48，load 1.1–2.5。
>
> 以下以低負載批為主，高負載批只作對照。標示「推測」的段落是推論，未經量測或程式碼證實。
> 本報告沒有引用任何外部策略文章，策略草案只依 repo 規則與實測。

---

## 1. 範圍

| profile id | 人數 | enabled | ruleModules | engine | VP 目標 | setupModes | topology | 其他 |
|---|---|---|---|---|---|---|---|---|
| `sf-new-shores-2025` | 3–4 | `true` (`packages/rules/src/profiles.ts:385`) | `['seafarers']`，由 `expansions` 推導 (`profiles.ts:182`, `:372`) | `sf-2025.2` (`:371`) | 14 (`:376`) | `['fixed']` (`:377`) | `sf-new-shores-4` (`:379`) | `pieces.ships: 15`、`hasPirate`、`longestRouteIncludesShips` (`:380-382`) |
| `sf-new-shores-paired-2025` | 5–6 | `true` (`:412`) | `['seafarers']` (`:394`) | `sf-2025.2` | 14 (`:399`) | `['variable']` (`:400`) | `sf-new-shores-56` (`:402`) | `PAIRED_BASE`（銀行每種 24 張、paired 回合）、`PAIRED_DEV_DECK` (`:392`, `:403`) |

地圖事實（`packages/rules/src/seafarers-boards.ts`，另以 probe `island-distance.ts` 實測）：

- 主島 id 是 `MAIN_ISLAND = 1`（`seafarers-boards.ts:29`），主島上沒有金礦。
- 海盜起始在外框，即 `pirate: null`（`:18-19`, `:209`）。
- 5–6 人地圖的主島地形是隨機的（`:225-228`，用 `PAIRED_TERRAIN_MULTISET`），港口也隨機。

| 人數 | 主島路口數 | 主島沿岸路口數 | 小島（路口數，是否有金礦） | 主島到各小島的最少船數 |
|---|---|---|---|---|
| 3 | 42 | 26 | 島 2（10，有金礦）、島 3（17，有金礦）、島 4（10，無） | 皆為 1 |
| 4 | 54 | 30 | 島 2（10，無）、島 3（21，有金礦）、島 4（10，無） | 皆為 1 |
| 5–6 | 80 | 38 | 島 2（14，有金礦）、島 3（14，有金礦）、島 4（12，無）、島 5（12，有金礦） | 皆為 1 |

「最少 1 艘船」指的是路口與路口之間的海路距離。推論：受距離規則限制，緊鄰主島建築的小島路口不能蓋聚落，所以實際登島通常需要 2–3 艘船。

另外，3 人地圖的強盜起始在島 2 的 12 點 hills 上，不在主島。

---

## 2. Bot 介面盤點

### 2(a) 模組指令

命令表在 `packages/rules/src/modules/seafarers/index.ts:58-63`，共四種：`build.ship`、`ship.move`、`setup.placeShip`、`gold.choose`。`pendingCommands` 只有 `['build.ship','gold.choose']`（`:64`）。

`applyCommand` 在 pending 期間會拒絕 `PENDING_COMMANDS`（`engine.ts:620-626`）與模組 `pendingCommands` 以外的所有指令（`engine.ts:702-704`）。因此 **`ship.move` 不能在任何 pending 中使用**。

事件與錯誤碼已和 `messages.ts:8-21` 對照過：

- 事件：`ship.built`、`ship.moved`、`setup.ship`、`pirate.moved`、`gold.required`、`gold.chosen`、`island.bonus`
- 錯誤碼：`E_SHIP_NOT_MOVABLE`、`E_SHIP_ALREADY_MOVED`、`E_SHIP_BUILT_THIS_TURN`、`E_PIRATE_BLOCKS`、`E_PIRATE_SAME_HEX`

| 指令 | 欄位 | 合法時機 | 合法目標來源 | 拒絕碼（依檢查順序） | 落差 |
|---|---|---|---|---|---|
| `build.ship` | `{ edge: number }` | ① 自己的 `action` 階段且無 pending（`actionWindowGuard`，`ships.ts:155-159`）；② 自己的 `freeRoads` frame 中，此時免費（`ships.ts:165-169`）。 | `hints.modules.seafarers.legalShips`（`index.ts:96`）。只在 `inAction \|\| freeRoads` 時非空，**已扣除船隻存量**（`buildableShipEdges`，`ships.ts:85-88`），但**沒有檢查費用**。 | `E_PENDING_EFFECT`、`E_NOT_ACTOR`、`E_NOT_YOUR_TURN`/`E_WRONG_PHASE`、`E_INVALID_COMMAND`、`E_PIRATE_BLOCKS`、`E_ILLEGAL_TARGET`、`E_NO_PIECES`、`E_INSUFFICIENT_RESOURCES`（`ships.ts:162-190`） | 費用 `SHIP_COST = {lumber:1, wool:1}`（`ships.ts:27`）沒有從 `@catan/rules` 匯出，web 自己複製了一份（`packages/web/src/board/seafarers.ts`）。 |
| `ship.move` | `{ from: number, to: number }` | 自己的 `action` 階段且無 pending；每個 action window 一次；這個 window 造的船不能移；只有具備 open end 的船能移；船的起點與終點都不能在海盜 hex 的邊上（`ships.ts:111-121`, `:193-225`）。 | `hints.modules.seafarers.movableShips: {edge, targets[]}[]`（`index.ts:98`），條件是 `inAction && !moved`。已涵蓋其他模組的 veto（`ships.ts:124-129`）。 | `E_ILLEGAL_TARGET`(from)、`E_SHIP_ALREADY_MOVED`、`E_SHIP_BUILT_THIS_TURN`、`E_PIRATE_BLOCKS`、`E_SHIP_NOT_MOVABLE`、`E_PIRATE_BLOCKS`(to)、`E_ILLEGAL_TARGET`(to) | 無。移船免費。 |
| `setup.placeShip` | `{ edge: number }` | setup 的 `road` 階段，且輪到自己；必須是與剛放的聚落 `lastVertex` 相鄰的海邊（`ships.ts:231-246`），用來取代 `setup.placeRoad`。 | `hints.modules.seafarers.setupShips`（`index.ts:97`） | `E_WRONG_PHASE`、`E_NOT_YOUR_TURN`、`E_INVALID_COMMAND`、`E_PIRATE_BLOCKS`、`E_ILLEGAL_TARGET` | `view.turn.setup` 沒有 `lastVertex`（`project.ts:85`, `:260-267`），Bot 無法自行推算，只能依賴 hints。hints 已足夠。 |
| `gold.choose` | `{ resources: Resource[] }` | `seafarers.gold` frame 中，且自己是 `responders[0]`（`gold.ts:88-122`） | `hints.modules.seafarers.goldRequired`，即 `min(owed, bankTotal)`，只對 `responders[0]` 非零（`gold.ts:78-85`）。`view.bank` 提供每種資源的上限。 | `E_PENDING_EFFECT`、`E_NOT_ACTOR`、`E_NOT_YOUR_TURN`、`E_INVALID_SELECTION`（張數必須剛好等於 required）、`E_BANK_EMPTY` | 無。 |

**語意有變的 base 指令**：

- `dev.playKnight {hex: number|null}` 與 `pending.moveRobber {hex: number|null}`：
  - 傳陸地 hex 時移動強盜。
  - 傳海 hex 或 `null`（外框）時移動海盜（`pirate.ts:13-21`, `:37-54`；`engine.ts:1385`, `:1615`）。
  - 目標都不能和原位置相同（`E_ROBBER_SAME_HEX` 在 `engine.ts:1478-1481`；`E_PIRATE_SAME_HEX` 在 `pirate.ts:50`）。
  - 合法目標：`hints.modules.seafarers.robberTargets` / `pirateTargets`（`index.ts:100-104`），在自己的 moveRobber frame 或自己的回合任何階段提供。
- `build.road`：只能放在陸地邊（含沿岸邊），而且只能從自己的建築或自己的**道路**延伸，不能從船延伸（`roadCanExtendFrom`，`engine.ts:472-482`；`canPlaceRoad`，`:494-511`）。
- `build.settlement`：可以經由道路**或船**連通（`canPlaceBuilding`，`engine.ts:420`）。
- `setup.placeBuilding`：只能放在主島（`islands.ts:35-38`）。`hints.legalSettlements` 已經過濾。
- `pending.steal`：海盜偷牌的候選人是「在該海 hex 邊上有船、手上有牌的對手」（`pirate.ts:24-35`）。engine 已算好放在 `candidates` 中。

### 2(b) pending frames

| kind | 誰回應 | 回應指令 | 投影資料 | 和 base 的差異 |
|---|---|---|---|---|
| `discard` | `waitingFor` | `pending.discard` | 同 base | 無 |
| `moveRobber` | `actor` | `pending.moveRobber {hex\|null}` | `{kind, actor, cause}`（`project.ts:111`, `:176`）；內部的 `pirate` 旗標不投影（`types.ts:214-220`） | 可選擇移動強盜或海盜 |
| `steal` | `actor` | `pending.steal {victim}` | `{actor, hex, candidates}`（`project.ts:178`） | `hex` 是海 hex 時為海盜偷牌，候選人由 engine 算好 |
| `yearOfPlenty` | `actor` | `pending.takeResource` | 同 base | 無 |
| `freeRoads` | `actor` | `build.road {edge}` **或** `build.ship {edge}` | `{actor, remaining}`（`project.ts:182`） | `sf-2025.2` 的授予容量計算如下（`engine.ts:1251-1256`, `:1266`）：若有合法道路就加上剩餘道路棋子數，若至少有一個船位（`grantAllAvailable`）就加上**全部剩餘船隻存量**。已停滯的 frame 由 `normalizedPending` 截斷（`engine.ts:629-646`）。 |
| `seafarers.gold`（模組） | `responders` 依序，從擲骰者起按座位順序（`gold.ts:49-63`） | `gold.choose` | `{kind, module:'seafarers', responders, data:{picks: Record<playerId, number>}}`（`gold.ts:125-133`），內容公開 | 新增。7 點時不觸發；強盜所在的金礦 hex 不產出（`gold.ts:34`）；銀行空了的 responder 會被自動跳過（`skipEmptySupply`，`gold.ts:69-75`）。 |

### 2(c) 回合結構變化

- **setup**：
  - snake order 與 base 相同。
  - 聚落只能放在主島。
  - road 階段可以改用 `setup.placeShip`（`ships.ts:231-246`）。
  - 小島加分在 setup 期間不計（`islands.ts:43`）。
- **roll**：
  - 非 7 點：先 base 產出，再由 `afterProduction` 建立 gold frame（`gold.ts:54-63`）。
  - 7 點：discard → moveRobber（可選強盜或海盜）→ steal。
- **phase veto**：Seafarers 沒有 `beforeEndTurn`、`onEndTurn`、`vetoCommand`（hook 清單見 `index.ts:20-105`），所以 `canEndTurn` 等同 base（`engine.ts:2071`, `:1115-1135`）。
- **paired 回合**：
  - Player 2 有自己的 action window（`openActorWindow`，`engine.ts:544-571`）。
  - Seafarers 的 `built/moved` 依 `windowId` 重置（`state.ts:38-46`, `:49-53`），所以 **P2 可以在自己的 window 造船，也可以移一艘船**。
  - P2 不能進行國內交易（`engine.ts:1161-1167`）。
- **結束條件**：14 VP，含小島加分（`bonusPoints`，`islands.ts:41-57`）與最長貿易路線（含船，`analysis.ts:115-165`）。

### 2(d) `GameView.modules.seafarers` 與 `hints.modules.seafarers` 的完整形狀

```ts
// GameView.modules.seafarers — index.ts:70-78
{
  islandBonus: Record<string /*playerId*/, number[] /*已領加分的小島 id*/>;
  islandClaims: { player: string; island: number; vertex: number }[];
  shipsBuiltThisTurn: number[];   // 本 action window 造的船（edge）
  shipMoved: boolean;             // 本 window 是否已移船
}

// hints.modules.seafarers — index.ts:85-105
{
  legalShips: number[];                        // inAction || 自己的 freeRoads；已扣存量，未檢查費用
  setupShips: number[];                        // setup road 階段且輪到自己
  movableShips: { edge: number; targets: number[] }[];  // inAction && !moved
  shipMoved: boolean;
  pirateTargets: (number | null)[];            // 自己的 moveRobber frame 或自己的回合
  robberTargets: number[];                     // 同上；陸地 hex 且不是目前強盜位置
  goldRequired: number;                        // 只對 gold responders[0] 非零
}
```

相關的 base view 欄位：

- `board.terrain`：含 `'sea'`、`'gold'`。
- `board.islands`：小島 id，海為 0。
- `board.pirate`：`number | null`。
- `board.roads[].ship`（`project.ts:46-58`）。
- `players[].bonusPoints`、`longestRoadLength`（含船，`project.ts:28-29`）。

小瑕疵（不需要修）：模組的 `actionHints` 讀的是原始 `state.pending`（`index.ts:87-89`），base 讀的是 `effectivePending`（`engine.ts:2061`）。只有在讀取已停滯 frame 的舊快照時，`movableShips` 會短暫為空，下一個指令就會正規化。

**view 可推導性實測**（`view-emulation.ts`）：只用 view、topology 與 profile 重現 `canPlaceShip`、`canPlaceRoad`，以及含船的 `longestRouteLength`，與 hints 和 `longestRoadLength` 比對。取樣範圍是 seafarers-sim 的 3/4/5/6 人 × 種子 1、2，每 3 步取一次。結果 **1,311 次比對、0 次不一致**。結論：沒有任何硬性的 hint 缺口。

### 2(e) 隱藏資訊與 B-FAIR

- Seafarers **沒有新增隱藏資訊**：
  - gold 的 `picks` 與 `gold.chosen` 的 `resources` 都公開（`gold.ts:114-118`, `:125-133`）。
  - island claims 公開。
  - `shipsBuiltThisTurn` 公開。
  - 海盜偷牌的資源只對當事人可見，與 base 的強盜相同（`projectEvent`，`project.ts:199-207`）。
- `goldRequired` 只依賴公開的銀行總數。`pirateVictims` 只依賴公開的 `handSize > 0`。
- B-FAIR 的 `hideDifferently`（交換對手手牌、發展卡、牌庫順序）可以原樣沿用。只需要讓取樣的狀態涵蓋 gold frame、可移海盜的 moveRobber，以及含船的 freeRoads。

### 2(f) 交易變化

- 交易規則不變。港口依地圖而定，5–6 人地圖的港口隨機，包含一個額外的 wool 2:1。`bankRates` 由 hints 提供（`engine.ts:2092`），`economy.ts:183` 已直接使用。
- 金礦不是資源種類，沒有新的卡牌類型。
- paired P2 不能進行國內交易，但銀行交易照常；heuristic 已處理（`pairedSecond`，`heuristic.ts:98-101`）。
- 船的費用是 lumber + wool，wool 需求會上升。`trade.ts`（`proposeOffer` `:161-194`、`bankTradeToward` `:120-151`）以 plan cost 為輸入，可以直接沿用。

---

## 3. 現行 base Bot 的落差

先講實測（`base-bot-timing.ts`，低負載批）：

- 現行 heuristic 直接玩 New Shores，3–6 人 × 種子 1–5 共 **20/20 局完成**，沒有任何拒絕或卡死，但**全部 0 艘船**，完全在主島上取勝。
- 每局步數 296–782，回合數 12–41。對照 base 遊戲為 198–687 步、11–27 回合。
- 能「零事故」完成，原因是 Bot 從不離開主島。主島沒有金礦，因此從不觸發 gold frame。

| # | 落差 | 來源 | 影響（實測或推論） |
|---|---|---|---|
| G1 | `BOT_RULE_MODULES` 為空 | `packages/bots/src/support.ts:12`；測試 `support.test.ts:16`；server 端 `bots.test.ts:266-277`；`rooms.ts:418,726` 回 `E_INVALID_BOT` | 目前無法入座 |
| G2 | fallback 遇到模組 frame 回傳 `null` | `fallback.ts:41-43` | **實測**：gold frame 中 standard 與 fallback 都回 `null`，driver 不再排程（`bot-driver.ts:330-345` 回傳 `null`），整桌卡死，違反 I9 |
| G3 | heuristic 遇到模組 frame 回傳 `null` | `heuristic.ts:162-164` | 同 G2 |
| G4 | freeRoads 只會造路 | `fallback.ts:36-40`、`heuristic.ts:157-161` | **實測**：①只剩船位時兩者都回 `null`，卡死；②道路棋子用完時 `legalRoads` 仍列出位置（`legalRoadEdges` 不檢查存量，`engine.ts:2073-2074`），兩者都送 `build.road`，得到 `E_NO_PIECES`。策略被拒後改用保底，保底也被拒後進入退避重試（`bot-driver.ts` `rejected()`：“bot fallback rejected; retrying later”），形成無限迴圈 |
| G5 | setup 從不放船 | `heuristic.ts:307-320`、`fallback.ts:65-73` | 理論上 `legalRoads` 為空時會卡死。實測 5,400 次隨機 setup road 階段皆為 0 次（`setup-road-empty.ts`），所以只是理論風險；但策略上浪費了「先造船」的開局 |
| G6 | 建造與計畫完全不考慮船 | `heuristic.ts:519-568`, `:571-599`；`PlanKind`（`economy.ts:92`） | 不符 SPEC §4.9「模組要等策略會下它的指令才加入」（`docs/SPEC.md:188`） |
| G7 | `searchRoads` 會走任何邊（含純海邊），也從船的端點起算 | `board.ts:171-206`（`:185-188`, `:191-203`） | **實測**（`impossible-plans.ts`）：553 個「需要修路的主聚落計畫」中有 **109 個（約 20%）** 的目標在主島外、路徑跨越純海邊，不可能完成。`planStep` 的 `legalRoads.includes` 守門（`heuristic.ts:589`）避免了非法指令，但 Bot 會為了不可能的計畫囤積資源、做銀行交易 |
| G8 | `isFreeSpot` 沒有檢查陸地 | `board.ts:96-100` | 純海路口可能被當成候選聚落，與 G7 疊加 |
| G9 | `vertexYield` 忽略金礦 | `board.ts:103-111`；`TERRAIN_RESOURCE` 沒有 gold（`types.ts:33-39`） | 金礦島的聚落價值被低估。`robberHex` 用 `hexPips`，有把金礦點數算進去（`heuristic.ts:200`）。setup 只在主島，所以不受影響 |
| G10 | `PieceCounts` 沒有船 | `board.ts:126-152` | 無法依合約規則 5 檢查船隻存量（`docs/aegis/specs/2026-11-01-bot-opponents.md:106`） |
| G11 | `routeLength` 不計船 | `board.ts:234` | 但 `longestRoadLength` 有計船，`economy.ts:259-280` 的最長路線計畫會誤判差距 |
| G12 | 強盜與騎士只選陸地 | `heuristic.ts:195-222`, `:398-409` | 從不移動海盜：不能用海盜封鎖或偷取對手，也不會把海盜移離自己的航線 |
| G13 | Road Building 只看道路 | `heuristic.ts:479` | 道路用完但有船位時不會打出（`sf-2025.2` 規則允許） |
| G14 | 從不 `ship.move` | 全檔無此指令 | 無法回收死路船 |
| G15 | 型別上不能回傳模組指令 | `BotPolicy.decide: Command\|null`（`types.ts:39`）、`Decision.command: Command`（`bot-driver.ts:74`）、`Command` union（`engine.ts:80-112`） | `applyCommand` 已接受 `Command \| ModuleCommand`（`engine.ts:669-674`），protocol 也是泛型的（`packages/protocol/src/index.ts:302`），只差 bots 與 driver 的型別 |
| G16 | `THINK_MS` 沒有模組指令 | `bot-driver.ts:40-64` | 全部落到 `DEFAULT_THINK_MS = 900` |
| G17 | 測試 harness 寫死 base | `harness.ts:29-31`；預設 `'variable'`（`:33-50`）會被 SF 3–4 人拒絕；`policy.test.ts:94` 的守恆檢查用 base profile | 無法直接跑 SF 的 B-GAME |
| G18 | bench 只有 base 設定 | `packages/bots/bench/run.ts` | 無法量測 SF |
| G19 | rules 沒有匯出 SF 的 view/hint 型別與 `SHIP_COST` | `packages/rules/src/index.ts:1-20`（E&P 有前例：`:12-13`） | Bot 只能用 `unknown` 強制轉型，或複製常數 |
| G20 | 文件寫明 SF 拒絕 Bot | `docs/SPEC.md:188`；bot spec `:19`；`docs/aegis/work/2026-11-01-seafarers.md:142-143` | 開放時要同步更新 |
| G21 | server 測試用 `'seafarers'` 代表「不支援的模組」 | `bots.test.ts:279-289` | 要改用其他模組 |

---

## 4. 必要的平台或規則端支援

| # | 需求 | 歸屬 | 是否違反 I3（`specs/…bot-opponents.md:42`） |
|---|---|---|---|
| P1 | 放寬 `BotCommand` 型別，例如 `Command \| ModuleCommand` 或具型別的 `SeafarersCommand` union，套用到 `BotPolicy` 與 driver 的 `Decision`。`ModuleCommand` 已從 `@catan/rules` 匯出（`modules/index.ts:5`） | 平台（bots＋server） | 否 |
| P2 | 可依模組擴充的待決責任分派：fallback 的 `pendingDuty`，以及 heuristic 的 `pendingDecision`，兩者的 default 分支都要能交給模組 handler；SF 提供 `seafarers.gold` 的處理，以及 freeRoads 與 setup road 的船分支 | 平台 | 否 |
| P3 | harness 與 B-GAME/B-FAIR/fuzz/fallback 改為以 `(profileId, players, seed, setupMode)` 參數化；資源守恆讀取實際 profile 的銀行數 | 平台 | 否 |
| P4 | 開放閘門的粒度：目前以模組為單位（`support.ts:15-17`）。只要把 `'seafarers'` 加入，**未來任何 SF 情境都會自動開放**。建議平台支援 profile 或 scenario 層級的允許清單（見 §9 Q3） | 平台 | 否 |
| P5 | `THINK_MS` 補上 `build.ship`、`ship.move`、`setup.placeShip`、`gold.choose`，或由模組提供 | server | 否 |
| P6 | rules **只新增型別與常數匯出**：`SeafarersView`、`SeafarersHints`、gold pending view 型別、`SHIP_COST`，做法比照 E&P（`index.ts:12-13`）；web 可以順便去掉重複的定義 | rules（只動 index.ts） | 否：規則行為、`GameState`、事件與錯誤碼都不變 |
| P7 | 共用的 view 層海域幾何（land/sea/coast 判定、海路 BFS、船位模擬），讓 SF+CK 與 E&P 重用；可由平台持有，或由 SF-1 先實作再上提 | 平台或 SF-1 | 否 |
| — | **不需要**任何新 hint。可選的「freeRoads 時 `legalRoads` 扣除存量」會改變 hints 與 web 行為，不建議做；Bot 依合約規則 5 自行檢查即可 | — | 會改變 hints，因此不做 |

---

## 5. 策略設計草案（standard／easy）

### 共用模型（新增 `packages/bots/src/sea.ts`）

- **判定函式**：`isLandHex`、`isSeaEdge`（外框邊或任一側為海）、`isLandEdge`、`coastVertices`、`islandOf(vertex)`。只依 `view.board` 與 topology 計算。
- **船位模擬**：等同 `canPlaceShip`，已有 1,311 次比對、0 次不一致的實證。同時保留 `isBlockedFor` 的 callback 掛點，留給 SF+CK 的騎士。
- **兩套獨立的 BFS**，不需要混合路徑：
  - 道路 BFS：只走陸地邊，只從建築或道路的端點出發，修正 G7。
  - 船 BFS：只走海邊，只從建築或船的端點出發，避開海盜 hex 的邊，不穿越對手建築。
  - 規則上路與船只能在自己的建築處換乘（`analysis.ts:115-165`），新聚落本身就是新起點，所以兩套 BFS 分開跑就正確。
- **含船的 `routeLength`**：同樣只在自己的建築處換乘，修正 G11，且已比對 0 次不一致。
- **`PieceCounts` 加上 `ships`**，修正 G10。
- **`vertexYield` 把金礦視為萬用點數**：每點依該玩家目前最缺資源的權重計價，修正 G9。
- **`isFreeSpot` 加上陸地檢查**，修正 G8。

### 依決策時機

| 時機 | standard | easy | 重用 |
|---|---|---|---|
| setup building | 沿用 `setupSpotScore`，另加沿岸與登島加權：從該點出發 ≤3 艘船可到達的未領加分小島，以點數、是否有金礦、+2 VP 計價，並乘上距離折扣 | 同 standard，但 `topK = 3` | `board.ts`、`economy.ts` 的權重 |
| setup road | 比較「最佳道路方向」（`roadDirectionScore`）與「最佳船方向」（往最佳島嶼目標的船 BFS 第一步），選分數高者；`setupShips` 為空時只能放路 | 預設放路；只有 `legalRoads` 為空時才放船 | `heuristic.ts:275-294` |
| preroll | 除了 base 的解除封鎖與奪取最大騎士團之外，**海盜位於我計畫航線的邊上**時也打騎士，把海盜移走 | 同 base | `knightDecision` |
| discard | 沿用；計畫成本含 `SHIP_COST`，wool 會自然被保留 | 同 | `discardDecision` |
| moveRobber / 騎士 | 計算強盜候選（base `robberHex` 加上金礦點數）與海盜候選的分數，取最高者。海盜分數＝可偷對手（`pirateVictims` 的鏡像）＋封鎖對手船路前線（該 hex 邊上有對手 open-end 船）− 封鎖我自己的計畫航線。`null`（移到外框）只在「海盜目前擋住我」且沒有更好的目標時使用 | 只移強盜（同 base） | `robberHex` |
| steal | 沿用 `stealVictim` | 同 | — |
| yearOfPlenty / monopoly | 沿用；計畫成本含船 | 同 | `plentyPick` |
| freeRoads | 計畫路徑的下一步若是船且在 `legalShips` 中，就送 `build.ship`；若是路，且道路還有存量、在 `legalRoads` 中，就送 `build.road`；否則從兩邊挑「延伸最佳計畫」者 | 同 standard，但取前 3 名 | `usefulRoad` |
| `seafarers.gold` | 只在 `responders[0] === self` 時行動：重複 `goldRequired` 次 `plentyPick` 式選擇，挑主計畫最缺的資源，且不超過 `view.bank[r]` | 同（取前 3 名） | `plentyPick` |
| action：分數 | 付得起的城市與聚落立即建造。小島首座聚落價值額外 +2 VP：只要島 id 不在 `islandBonus[self]` 中就成立，與他人是否已登島無關（`islands.ts:3-6`） | 同 | `buildDecision` a) |
| action：計畫 | `Plan` 新增 `ships: number[]`（或 `route: {edge, kind}[]`）。新計畫種類是「島嶼聚落」：船路徑 ≤4 艘（推測合理上限），每艘船打 0.9 折，成本為 `SHIP_COST × n + COSTS.settlement`，`nextCost` 為 `SHIP_COST`。最長路線計畫改用含船的 `routeLength`，可走路或船 | 同，但取前 3 名 | `economy.ts:218-280` |
| action：移船 | 在建造之前檢查 `movableShips`：若有不在任何計畫路徑上的葉端船，且 targets 中有計畫路徑的下一條邊，就送 `ship.move`，等於免費前進一格；或者在船隻存量用完時拿來延伸航線 | 不移船（推測：降低強度，也減少意外） | — |
| action：發展卡 | Road Building 的條件改為「道路有存量且有可用的路」**或**「船有存量且 `legalShips` 非空」，修正 G13 | 同 | `devCardDecision` |
| action：交易 | 沿用；`bankTradeToward` 以 `SHIP_COST` 為目標 | 不主動報價（同 base） | `trade.ts` |
| paired P2 | 與一般 action window 相同，也可以造船、移船；沿用 `pairedSecond` 禁止國內交易 | 同 | `heuristic.ts:98-101` |

**SF+CK 與 E&P 的重用（推測）**：

- **SF+CK**：可以整套重用 `sea.ts`。另外需要：
  - 騎士 blocker 的 callback；
  - `shipMoveBlocked`，對應 `E_SHIP_PINNED_BY_KNIGHT`（FIDELITY R-COMB，`docs/FIDELITY.md:132`）；
  - 處理海盜在第一次攻擊前不活動。
  - hints 的 `movableShips` 已經反映模組 veto（`ships.ts:124-129`）。
- **E&P**：船的模型不同（有 id、移動點數、3 艘船），只能重用海域判定與 BFS。

---

## 6. 保底策略（最小合法動作）

| 責任 | 指令 | 為什麼必定合法 |
|---|---|---|
| setup building | `legalSettlements[0]`（不變） | hints 已過濾為只有主島 |
| setup road | `legalRoads[0]`；為空時用 `setupShips[0]`；兩者都空時回 `null` 並記錄（規則上不應發生） | 補上 G5 |
| preroll / action | `turn.roll` / `turn.end`（不變） | SF 沒有 end-turn veto |
| discard / steal / yearOfPlenty | 不變 | — |
| moveRobber | 不變：第一個非海且不是目前強盜位置的 hex（`fallback.ts:19-25`），**永遠不動海盜** | 強盜候選必定非空 |
| freeRoads | 道路還有存量（profile 道路數減去自己的非船道路數）且 `legalRoads[0]` 存在時送 `build.road`；否則 `legalShips[0]` 存在時送 `build.ship`；否則 `null`，frame 會被 `normalizedPending` 截斷 | 補上 G4 的兩種情況 |
| `seafarers.gold` | `responders[0] === self` 時，依 `RESOURCES` 順序取 `min(view.bank[r], 剩餘)`，湊滿 `goldRequired` | `goldRequired ≤ bankTotal`（`gold.ts:84`），必定湊得滿 |
| 其他未知模組 frame | `null` 並記錄（平台層級） | — |

保底策略**不會**在 freeRoads 以外造船，也不會移船，因為這些都不是必要動作。

---

## 7. 測試與驗收

### 新增案例（建議值）

- **SF B-GAME**
  - 範圍：3/4 人用 `sf-new-shores-2025` 搭配 `'fixed'`，5/6 人用 `sf-new-shores-paired-2025` 搭配 `'variable'`，各跑種子 1–10。
  - 步數上限：maxSteps 5000。實測現有策略最多 782 步，腳本模擬最多 2,052 步。
  - 斷言：
    - 有勝者、0 拒絕、沒有卡住的 pending、資源守恆（依 profile 銀行數）；
    - 覆蓋率（彙總到人數層級）：≥ 8/10 局有 `build.ship`，至少 1 局有小島加分，至少 1 局有 `gold.choose`（門檻待 §9 Q2 決定）。
- **SF B-POLICY 決定性**：4 人、種子 3，重播兩次，指令序列必須相同。
- **SF fallback**：3–6 人 × 種子 1–3 × 800 步，**混合 standard 與 fallback 座位**。純 fallback 局永遠不造船，也就永遠不會遇到 gold frame。
- **I9 固定盤面單元測試**：參考 `stall-cases.ts` 的建構方式，每個案例都要對 fallback、standard、easy 驗證指令被接受：
  1. freeRoads 只剩船位；
  2. freeRoads 道路存量用完；
  3. gold 欠 2 張、銀行剩 1 張；
  4. gold 的 responder 不是行動者；
  5. setup road 階段只剩船位；
  6. moveRobber 時海盜目標明顯較優。
- **SF fuzz**：4 人與 6 人的擾動狀態，隨機加入船、海盜位置、gold frame、freeRoads。
- **SF B-FAIR**：種子 61（4 人）與 62（6 人）；取樣狀態必須含 gold、海盜、freeRoads；standard 與 easy 都要測。
- **一致性測試（B-POLICY-SEA）**：`sea.ts` 的模擬結果必須等於 hints，路線長度必須等於 `longestRoadLength`。取樣來源可以直接 import `../../rules/test/seafarers-sim.ts`，`ck-road-building.test.ts:4` 已有跨套件匯入 helper 的前例。建議 2 局、每 5 步取樣一次。
- **server**：
  - 把 `bots.test.ts:266-277` 反轉為「SF 房可以加入 Bot」；
  - 新增 SF 房含 Bot 開局的測試（`delayScale 0`），驗證 setup 能完成；
  - `:279-289` 改用其他模組。

### 實測數據

腳本模擬（seafarers-sim，低負載）：

| 人數 | 接受的指令數 | 嘗試次數 | 回合數 | 每局時間 |
|---|---|---|---|---|
| 3 | 641–971 | 2,342–3,833 | 78–111 | 1.2–2.0 s |
| 4 | 745–846 | 2,752–3,417 | 54–60 | 1.4–1.7 s |
| 5 | 599–911 | 2,261–3,808 | 25–40 | 1.3–2.2 s |
| 6 | 549–2,052 | 2,247–7,263 | 18–66 | 1.3–4.8 s |

- 16 局合計 real 31.4 s、user 32.1 s。高負載批同樣 16 局為 real 3m7s、user 44.8 s。
- `seafarers-sim.test.ts`：低負載 13.5 s（5 tests）；高負載 67 s。

現有 heuristic 對 SF 與 base 的對照（低負載，各 20 局）：

| | 每局 CPU | 投影平均 | decide 平均／最大 |
|---|---|---|---|
| SF | 約 0.51 s | 0.031 ms | 0.023 ms ／ 2.4 ms |
| base | 約 0.26 s | 0.012 ms | 0.015 ms ／ 1.1 ms |

bots 測試套件現況：8 檔、48 tests，wall 13.4 s、user 32.7 s。其中 base B-GAME 四個 test 合計約 10.7 s；fallback 約 6.7 s；fuzz 約 4.9 s。

**CI 估算（推測）**：

- SF 策略加入海路 BFS 後，每局成本約為 base 的 2.5–3 倍。
- 各套件 CPU：B-GAME 約 25–35 s、fallback 約 8–13 s、fuzz 約 6–10 s、B-FAIR 與一致性測試約 4–7 s。
- 合計 **+45–65 s CPU**。vitest 以檔案平行執行，閒置時 wall 約 **+12–20 s**；在先前觀察到的負載下會慢 2–4 倍。

### bench 應量測的項目

- 新增 `sf-3p`、`sf-4p`、`sf-5p`、`sf-6p` 四組設定。
- 沿用既有指標：勝率、fair share、回合數、指令數、decide 平均與最大、報價、問題數。
- SF 專屬指標：
  - 每局船數、移船數、setup 放船數；
  - 小島聚落數與加分；
  - gold 選擇次數；
  - 海盜與強盜各被移動幾次；
  - 含船的最長路線持有率。
- 對局安排：
  - 新策略與「naive」（現行 heuristic）混座對戰；
  - standard 對 easy；
  - 每個 window 的最大指令數，對照 driver 上限 `MAX_BOT_COMMANDS_PER_WINDOW = 40`（`bot-driver.ts:70`）；
  - fallback 次數。

---

## 8. 切片與工作量

基準：bots 套件目前有 src 1,521 行、test 1,125 行、bench 88 行，合計 2,774 行。

| 切片 | 內容 | 檔案範圍 | 規模 | 依賴 |
|---|---|---|---|---|
| SF-1 | 海域模型與必要責任：`sea.ts`；`board.ts` 修正 G7–G11；fallback 與 heuristic 補 gold、freeRoads 船分支、setup 船分支；`BotCommand`；一致性測試與 I9 固定盤面測試 | `bots/src/{sea,board,economy,fallback,heuristic,types}.ts`、`bots/test/*` | **M**，約 450–600 行（src 250–300，test 200–300）。依據：模擬函式已在 probe 中寫成約 70 行，加上 BFS、型別與測試 | 平台 P1、P2（或 SF-1 自帶最小版本）、P6 |
| SF-2 | 島嶼擴張策略：島嶼計畫、造船步驟、移船、海盜評分、Road Building 用船、setup 選擇路或船、gold 選擇、easy 的差異；decision 單元測試 | `bots/src/{heuristic,economy,sea}.ts`、`bots/test/decisions*.ts` | **L**，約 650–800 行（src 400–450，test 250–350）。依據：base 的 `heuristic.ts` 加 `economy.ts` 約 930 行，此切片約為其 50–60% | SF-1 |
| SF-3 | 開放與驗收：`BOT_RULE_MODULES` 或 profile 閘門；harness 參數化；SF 版 B-GAME/B-FAIR/fuzz/fallback；server 測試；`THINK_MS`；bench；文件（SPEC §4.9、bot spec、FIDELITY、work log） | `bots/src/support.ts`、`bots/test/*`、`bots/bench/run.ts`、`server/src/bot-driver.ts`、`server/test/bots.test.ts`、`docs/*` | **M**，約 350–450 行加文件約 40 行 | SF-2、平台 P3–P5 |
| SF-4（延後） | 調參與進階戰術：海盜騷擾、先佔金礦、航線封鎖、easy 個性化 | `bots/src/*` | S–M | bench 數據 |

**MVP 為 SF-1 + SF-2 核心 + SF-3，約 1,450–1,850 行**，大約是現有 base bots 套件的 55–65%。依 SPEC §4.9，SF-2 不能延後：只有 SF-1 + SF-3 時，Bot 仍然不會主動造船。

---

## 9. 風險與待決問題（需要使用者做產品決定）

1. **「會完成但不用船」的過渡版本可以接受嗎？** 實測現行策略已能 20/20 完成 SF 對局，但 SPEC §4.9 要求策略要「下模組指令、回應模組 frame」（`docs/SPEC.md:188`）。我的建議是不接受：SF-2 核心要與開放閘門同一版本發布。
2. **強度門檻**：standard 對 naive 在 bench 中應達到多少勝率才算完成（例如混座 ≥ 55%）？B-GAME 的覆蓋率門檻（≥ 8/10 局造船）是否寫成硬性斷言？
3. **閘門粒度**：模組層級的開放，會讓未來的 SF 情境自動開放 Bot。要改成 profile 或 scenario 允許清單嗎？此外，`bots.test.ts:260` 以 `expansions + variants` 判斷 `botSeats`，與 `ruleModules` 不完全等價；SF+CK 多一個 `seafarersCitiesKnights`，未來可能出現不一致。
4. **easy 要用船嗎？** 我的建議是會造船、不移船、只移強盜。
5. **節奏**：模組指令的 `THINK_MS`。建議值：setup.placeShip 600、build.ship 900、ship.move 1100、gold.choose 800 ms。
6. **每個 window 40 個指令的上限**：SF 的 action window 指令較多，連續造船、移船、交易都會累計。bench 應量測最大值，確認不會觸頂後被迫改用保底。
7. **SF-FAQ 18 的未決 fixture**（船圈與迴路，`docs/FIDELITY.md:250-256`）：engine 依 SF25 判定。Bot 依 hints 行事所以不受影響；如果日後改判，一致性測試會抓到 `sea.ts` 的差異。
8. **發布順序**：SF 先發布，因為 SF+CK 會完整重用海域工具，E&P 可部分重用幾何與 BFS。5–6 人 paired 是否與 3–4 人同版開放？兩者共用同一套程式碼，我的建議是同版。
9. **已知但非阻塞**：
   - Road Building 打出後，第一條路可能封死所有道路位置，使 frame 只剩船位，觸發 G4 卡死。實測 20 局未出現，但 SF-1 必須修。
   - 模組 hints 讀原始 `state.pending` 的小瑕疵（§2(d)），只影響舊快照。

---

### 附錄：probe 腳本（皆在 `/tmp/katan-bot-research/seafarers/`）

執行方式：`node --experimental-strip-types <檔名>`。

| 檔案 | 用途 |
|---|---|
| `sim-copy.ts` | 插樁版的 seafarers-sim |
| `sim-timing.ts` | 腳本模擬的步數與時間 |
| `base-bot-on-sf.ts` | 現行 Bot 直接玩 SF |
| `base-bot-timing.ts` | SF 與 base 的耗時對照 |
| `stall-cases.ts` | 重現 I9 卡死情境 |
| `setup-road-empty.ts` | setup 只剩船位的機率（0/5,400） |
| `impossible-plans.ts` | 跨海不可能完成的計畫（109/553） |
| `island-distance.ts` | 主島到各小島的距離 |
| `view-emulation.ts` | hints 可推導性（1,311 次比對、0 次不一致） |
