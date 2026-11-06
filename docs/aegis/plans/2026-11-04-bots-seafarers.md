# Seafarers 電腦對手：實作計畫（v0.4.1）

日期：2026-11-04；2026-11-06 開工前依程式現況核對並刷新（策略 §12），同日併入 PL-1 的介面定案（策略 §13）。狀態：**使用者已於 2026-11-05 確認 §10 的 D-SF1–D-SF9 採用建議。**

本文件是 Aegis 工作紀錄，不是權威的執行期決策；權威需求以 `docs/SPEC.md` §4.9 為準。

前置閱讀：

- 整體策略 `docs/aegis/plans/2026-11-04-expansion-bots-roadmap.md`（以下簡稱「策略」），特別是 §3.1、§4、§6–§8
- bot 規格 `docs/aegis/specs/2026-11-01-bot-opponents.md`（I1–I9、§5 合約）
- rules：`packages/rules/src/modules/seafarers/{index,ships,gold,pirate,islands}.ts`、`docs/FIDELITY.md` 的 R-SF 列（:100-117）與 Seafarers interpretations（:219-264）

證據基準為 `a200840`。第一輪報告（`docs/aegis/work/2026-11-04-bots-seafarers-research.md`）的結論是起點；本計畫依賴的事實已以 `檔案:行號` 重新核實。2026-11-06 開工前，又依 `73a0d95`（`release/v0.4.1` 的起點）核對一次：更正了 10 處引用，並把 S1–S11 的調整併入 §3、§4.1、§4.4、§4.5、§5、§5.1、§7.1、§8、§9（清單見策略 §12）。第二輪探查腳本放在 `/tmp/katan-bot-research/seafarers/`，不提交（附錄）。探查期間 load 介於 2 與 44 之間，**耗時只是參考值**；結論只依步數、局數、拒絕數等決定性指標。

## 1. 目標與範圍

| 項目 | 內容 |
|---|---|
| profile | `sf-new-shores-2025`（3–4 人，`fixed`）、`sf-new-shores-paired-2025`（5–6 人，`variable`）；`ruleModules: ['seafarers']`，`sf-2025.2`，14 VP（`packages/rules/src/profiles.ts:370-413`） |
| 同版交付 | 平台 PL-1 到 PL-3（策略 §4.10）、rules 匯出（RX）、SF-1 到 SF-4 |
| 目標 | 兩個 profile 的 3–6 人都能加入 easy 與 standard；兩種難度都會造船並登島；每個 frame 與強制動作都有保底；paired 5–6 人與 3–4 人同版開放 |
| 非目標 | 策略 §1.3 全部；SF+CK（0.4.3）；SF 的其他劇本（由 `supports` 擋下，§4.4）；海盜騷擾、先佔金礦等進階戰術（延後到 0.4.x 調參） |

## 2. 現況與落差

第一輪的 G1–G21 經核實仍然成立，行號只有少量偏移，下表已更新。第二輪另外有兩項新發現（N1、N2）。

| # | 落差 | 證據 | 處理 |
|---|---|---|---|
| G2/G3 | 模組 frame（gold）讓保底與策略都回 null，整桌停住 | `bots/src/fallback.ts:41-43`、`heuristic.ts:162-164`；探查 F3/F4：舊保底回 `null` | SF-1 `duty`、SF-2b `answerFrame` |
| G4 | freeRoads：①只剩船位時回 null；②道路存量用完時 `legalRoads` 仍有值，送出後得到 `E_NO_PIECES` | `fallback.ts:36-40`、`heuristic.ts:157-161`；`engine.ts:2072-2076` 不扣存量，`:1203` 拒絕；探查 F1：舊保底 `null`；F2：舊保底與 standard 都是 `E_NO_PIECES` | SF-1（base 處理器加存量檢查＋船分支） |
| G5 | setup 的 road 階段只剩船位時回 null | `fallback.ts:70-73`；探查 F5 | SF-1 |
| G7/G8 | 道路 BFS 會走純海邊，也會從船的端點出發；空點判定不檢查陸地 | `board.ts:186-189`、`:194-203`、`:96-100` | SF-1 |
| G9–G11 | 不認得金礦；`PieceCounts` 沒有船；`routeLength` 不計船 | `board.ts:103-111`、`:126-152`、`:233-235`；`types.ts:33-39` | SF-1（模型）、SF-2a（估值） |
| G6/G12–G14 | 不造船、不移船、不移海盜，Road Building 不考慮船 | `heuristic.ts:198-199`、`:479`、`:519-599` | SF-2a、SF-2b |
| G15/G16 | 型別與節奏 | `types.ts:39`、`server/src/bot-driver.ts:40-64,74` | PL-1、PL-3；SF 的節奏值見 §4.6 |
| G19 | rules 沒有匯出 SF 的型別與常數 | `rules/src/index.ts:1-20`（E&P 前例 :12-13）；web 另有一份副本（`web/src/board/seafarers.ts:16-33`） | RX |
| **N1** | **現行策略並非一定能打完 SF**：仿 B-GAME 的座位與種子（`mixedLevels`、`botSeed('test',…)`、報價時鐘），3–6 人各 10 個種子中，3 人種子 7 與 6 人種子 3 跑滿 8000 步仍無勝者。主因是主島飽和：發展卡用完、每人 4 座城市、沒有合法聚落點，最高 13 分 | `q1-calibrate.ts naive sf`、`diag-naive-6p.ts`（6 人種子 2 混座：第 940 步後無人得分，`legalSettlementSpots` 全為 0） | 造船是 Q1 的前提，不只是 Q2；easy 也必須用船（P9）；看門狗（§6.1） |
| **N2** | `legalSettlements` 也不扣聚落存量 | 原型 v2 漏查存量，被 `E_NO_PIECES` 拒絕 7 次（`engine.ts:1291-1293`） | 島嶼聚落候選依合約規則 5 自行檢查 |

第一輪 §3 的「20/20 局完成」來自全 standard 座位的 5 個種子。B-GAME 的混座設定會讓 easy（topK 3）拖慢節奏，主島因此先飽和。

## 3. 介面摘要（只列策略與保底需要的部分）

| 項目 | 事實 | 證據 |
|---|---|---|
| 模組指令 | `build.ship {edge}`、`ship.move {from,to}`、`setup.placeShip {edge}`、`gold.choose {resources}` | `seafarers/index.ts:58-63` |
| pending 中可送的指令 | 只有 base 的 `PENDING_COMMANDS` 與模組的 `build.ship`、`gold.choose`；`ship.move` 只能在無 pending 的 action 階段送 | `engine.ts:620-626`；`index.ts:64` |
| `legalShips` | 只在 `inAction` 或自己的 freeRoads 時非空；**已扣船隻存量，未檢查費用** | `index.ts:94`；`ships.ts:85-88`、`:180` |
| `legalRoads`、`legalSettlements` | **都不扣存量**；`countRoads` 不計船 | `engine.ts:481-492`、`:1203`、`:1291`；`analysis.ts:47-51` |
| freeRoads 容量（`sf-2025.2`） | 有合法道路時加上剩餘道路數；有任何船位時加上**全部**剩餘船數。容量為 0 的 frame 由 `normalizedPending` 截斷，投影時 `pending` 為 null | `engine.ts:1251-1256`、`:1266-1268`、`:629-646`；探查 F2b |
| `setupShips` | setup 的 road 階段、輪到自己時，與剛放的聚落相鄰的海邊；`view.turn.setup` 沒有 `lastVertex`，只能依賴 hints | `index.ts:95`；`ships.ts:231-246` |
| `movableShips` | `inAction && !moved` 時提供，已涵蓋其他模組的 veto | `index.ts:96`；`ships.ts:111-128`（`shipMoveBlock`、`moduleShipMoveVeto`）、`:136-144`（`movableShips`） |
| gold frame | `seafarers.gold`；`responders` 依序，從擲骰者開始；`goldRequired = min(owed, 銀行總數)`，只對 `responders[0]` 非零；每種資源再各自檢查 `E_BANK_EMPTY` | `gold.ts:54-63`、`:78-85`、`:103-105` |
| 強盜與海盜 | `pending.moveRobber`、`dev.playKnight` 的 `hex` 型別本來就是 `number \| null`；傳陸地 hex 移強盜，傳海 hex 或 `null`（外框）移海盜；目標見 `hints.modules.seafarers.{robberTargets,pirateTargets}` | `engine.ts:89,94`（`Command` union）；`pirate.ts:13-21`、`:37-54`；`index.ts:98-102` |
| 騎士 blocker（SF+CK 重用） | `canPlaceShip` 經 `isBlockedFor` 呼叫 `moduleVertexBlocker`，由 C&K 的 `vertexBlocker` 提供；移船另有 `shipMoveBlocked` | `ships.ts:57-75`；`analysis.ts:88-106`；`citiesKnights/index.ts:122`；`seafarersCitiesKnights/index.ts:121` |
| 回合結構 | 沒有 `beforeEndTurn`、`onEndTurn`、`vetoCommand`，所以 `turn.end` 不會被 SF 否決 | `index.ts:27-106` |
| paired | P2 有自己的 window，可以造一次船、移一艘船，但不能國內交易；`pairedSecond` 已處理交易 | FIDELITY R-SF paired（:116）；`heuristic.ts:98-101` |
| 隱藏資訊 | 沒有新增；`hideDifferently` 可以原樣沿用 | `gold.ts:124-133`；第一輪 §2(e) |
| base 幾何 | base 與 base-paired 沒有海格，每條邊都鄰接陸地，所以陸海判定是 base 的 no-op | 探查 `base-geometry.ts`：`sea 0`、`edgesNoLand 0` |

## 4. 設計

### 4.1 保底（`modules/seafarers/duty.ts`，I9）

pending 與 setup 先跑 base 的處理器，回 null 時才詢問模組的 `duty`；preroll 與 action 先詢問模組的 `duty`，再送 `turn.roll` 或 `turn.end`（策略 §4.1）。下表涵蓋 SF profile 會出現的每一種 frame 與強制動作。「探查」欄是 `duty-fixtures.ts` 的結果：草稿保底送出的指令，全部都被 `applyCommand` 接受。

| frame／強制動作 | 最小動作 | 為何必定合法 | 證據（探查） |
|---|---|---|---|
| setup building | `legalSettlements[0]`（不變） | hints 已過濾為只有主島（`islands.ts:35-38`） | 既有 B-GAME |
| setup road | 有 `legalRoads[0]` 時送 `setup.placeRoad`；否則送 `setup.placeShip setupShips[0]` | 兩份清單都取自 hints；setup 不收費 | F5：舊保底 `null`，新保底 `setup.placeShip@30 → ok` |
| preroll | `turn.roll`（不變） | `canRoll` | — |
| action | `turn.end`（不變） | SF 沒有 end-turn veto | — |
| discard | 不變（依 `RESOURCES` 順序棄牌） | SF 沒有新的卡種 | 既有 |
| moveRobber | 不變：取第一個不是海、也不是目前強盜位置的 hex；**保底永遠不動海盜**。SF+CK 中改由 0.4.3 的 fold 集合決定，`'pirate'` frame 取第一個海格（SF+CK 計畫 §4.2） | 與 `robberTargets` 的定義相同（`index.ts:99-102`），陸地 hex 一定存在 | F6 `→ ok` |
| steal | `candidates[0]`（不變；海盜偷牌時，候選人由 engine 算好） | `pirate.ts:24-35` | — |
| yearOfPlenty | 不變 | `normalizedPending` 依銀行存量截斷 | — |
| freeRoads（**I9 風險 1、2**） | 自己的道路存量（profile 道路數減去盤面上非船的道路）> 0 且 `legalRoads[0]` 存在時送 `build.road`；否則 `legalShips[0]` 存在時送 `build.ship`；兩者都沒有時回 null（容量為 0 時 frame 已被截斷，不會發生） | 道路存量依合約規則 5 自行檢查（`engine.ts:1203`）；`legalShips` 已扣船隻存量；freeRoads 中造船免費（`ships.ts:179-182`） | F1：只剩船位 `→ ok`；F2：存量用完，舊保底 `E_NO_PIECES`，新保底 `build.ship → ok`；F2b：兩者都用完時投影 `pending: null`，改走 `turn.end` |
| `seafarers.gold`（**I9 風險 3**） | 只有 `responders[0] === self` 時才行動：依 `RESOURCES` 順序，每種資源取 `min(view.bank[r], 剩餘)`，湊滿 `goldRequired` 張 | `goldRequired ≤ 銀行總數`（`gold.ts:84`），而且每種都不超過該種存量，所以不會觸發 `E_BANK_EMPTY` | F3：欠 2、銀行 1 → `["ore"] ok`；F3b：欠 3、wool 與 ore 各 1 → `["wool","ore"] ok`；F4：第一位 responder 是非行動者 `→ ok`，行動者回 null |
| 其他模組 frame | `undefined`（不歸 SF 管），由平台記錄診斷（策略 §4.7-4） | — | — |

保底**不會**在 freeRoads 以外造船，也不會移船。base 的 freeRoads 處理器在 SF-1 補上道路存量檢查：v0.4.0 的位置是 `fallback.ts:36-40` 與 `heuristic.ts:157-161`，PL-1 之後是 `src/base/duty.ts` 的 `pendingDuty`（保底）與 `src/base/roads.ts` 的 `freeRoadDecision`（策略）。base 不受影響：`base-2025.4` 的容量經 `pendingRouteCapacity`（`engine.ts:651-655`）交給 `roadBuildingGrantCapacity`（`:1251-1256`），在 `:1254` 依道路存量截斷，存量為 0 的 frame 不會被投影出來。golden replay 驗證這一點。

### 4.2 standard 與 easy

| 時機 | standard | easy | 鉤子（策略 §4.1） |
|---|---|---|---|
| setup building | 沿用 base 的 `setupSpotScore`，加上登島加權：≤3 艘船可達的未領加分小島，以點數、金礦與 +2 VP 計價，再乘上距離折扣。登島加權寫成可匯出的純函式 `islandSetupBonus`，供 SF+CK 的組合 setup 使用 | 同 standard，topK 3 | `setup` |
| setup road | 比較最佳道路方向與最佳船方向（船 BFS 的第一步），取分數高者 | 只放路；`legalRoads` 為空時改用保底 | `setup` |
| preroll 騎士 | base 條件之外，海盜擋住我計畫航線的邊時，也打騎士把海盜移走 | 同 base | `preroll` |
| moveRobber／騎士目標 | 強盜候選（base 評分）與海盜候選放在一起評分。海盜分數＝可偷的對手＋封鎖對手 open-end 船的前線－封鎖我自己的航線；`null` 只在「海盜擋住我、又沒有更好目標」時使用 | 只移強盜 | **`banditCandidates`（新增，§11-1）** |
| freeRoads | 計畫路徑的下一步在 `legalShips` 中就造船；是路、而且道路存量 > 0、在 `legalRoads` 中就造路；否則挑延伸最佳計畫的一步。候選非空時會取代 base 的選路，所以道路選項也由 SF 提供 | 同 standard，取前 3 名 | `freeRouteCandidates` |
| `seafarers.gold` | 只在 `responders[0] === self` 時行動：重複 `goldRequired` 次 `plentyPick` 式選擇（計畫成本含船），每種資源都不超過 `view.bank[r]` | 同 standard（決定性選擇） | `answerFrame` |
| action：計畫 | 新增計畫種類「島嶼聚落」：船路徑 ≤4 艘，成本為 `SHIP_COST × n + COSTS.settlement`，`nextCost` 為 `SHIP_COST`；分數含 +2 VP（島 id 不在 `islandBonus[self]` 時）與金礦萬用點數；城市計畫中，金礦上的城市以 2 張萬用資源計價、聚落 1 張（`packages/rules/src/modules/seafarers/gold.ts:38`；SF+CK 計畫 A5）；最長路線改用含船的長度 | 同 standard，船路徑 ≤3 艘，topK 3 | `economy.costs`、`piecesLeft`、`scoreExtras`、`actions` |
| action：移船 | 有不在任何計畫路徑上的葉端船，而且它的 `targets` 含計畫的下一條邊時，送 `ship.move`；只從 `hints.movableShips` 取值 | 不移船 | `actions` |
| action：Road Building | 條件改為「道路有存量且有用」**或**「`legalShips` 非空」。前半由 base 判斷；後半由 PL-1 骨架的「任一模組的 `freeRouteCandidates` 非空」承接，所以 SF 的 `freeRouteCandidates` 在行動階段也要在 `legalShips` 非空時回傳候選 | 同 standard | `freeRouteCandidates` |
| 交易 | 沿用；`bankTradeToward` 以 `SHIP_COST` 為目標；距登島只差聚落的計畫視為「立即得分」，可以開價 | 不主動開價（同 base） | — |
| paired P2 | 與一般 window 相同，可以造船、移船；`pairedSecond` 禁止國內交易 | 同 standard | — |

### 4.3 海域模型 `packages/bots/src/sea.ts`（共用）

- **判定函式**：`isLandHex`、`isLandEdge`（任一側是陸地）、`isSeaEdge`（外框邊，或任一側是海；與 `analysis.ts:83-86` 相同）、`islandOfVertex`、`coastVertices`。
- **船位模擬**：`shipEdgesFrom(view, selfId, { blocker? })`，對應 `canPlaceShip`。
  - `blocker?: (vertex) => string | null` 是騎士 blocker 的 callback 掛點，**必須保留**，預設回 null。SF+CK 在 0.4.3 用 `hints`／view 中的騎士位置實作。這項需求有證據：`analysis.ts:88-106`、`citiesKnights/index.ts:122`。SF+CK 計畫已確認不需要「海盜在第一次攻擊前不活動」之類的掛點：首攻前不會出現 moveRobber，`pirateChase` 也為空。0.4.3 的 SFCK-P 會把 `blocker` 的預設改為組合後的 `economy.vertexBlocker`，options 物件只增欄位，與 E&P 的 N8 相容。
- **兩套獨立的 BFS**：
  - 道路 BFS：只走陸地邊，只從建築與非船道路出發，修正 G7。
  - 船 BFS：只走海邊，只從建築與船出發，避開海盜 hex 的邊，也不穿越對手建築或 blocker。
  - tie-break 一律依 edge index 遞增（P4）。
- **含船的路線長度**：路與船只在自己的建築處相接（`analysis.ts:111-114`）。只在 `profile.longestRouteIncludesShips` 時計入船。
- **重用範圍**：SF+CK 整套重用；E&P 只重用判定函式與海路 BFS 的幾何部分（策略 §5.1）。
- **合法性**：不以 `sea.ts` 判定合法性，送出前一律以 hints 過濾（P2）。`sea.ts` 只用於規劃，並以一致性測試（§6.1）確保它與 rules 不漂移。

### 4.4 gating

- SF 的 BotModule 在 SF-1 註冊，但 `supports(profile)` 回傳 `SUPPORTED_SCENARIOS.includes(profile.scenario)`，其中 `SUPPORTED_SCENARIOS` 在 SF-1 到 SF-3 期間為 `[]`。
- SF-4 把它改為 `['new-shores']`，並同步更新快照（策略 §4.4）。
- 未來的 SF 劇本不會被自動放行。
- SF+CK 仍然缺少 `seafarersCitiesKnights` 與 `citiesKnights` 兩個 BotModule，所以 `botsCanPlay` 維持 false。這與既有的 `seafarers-cities-knights.test.ts:150,159` 一致。
- `botModulesOf` 不檢查 `supports`（策略 §4.2），所以 SF-3 在 SF-4 翻轉 gating 之前就能跑 B-GAME。
- `BOT_RULE_MODULES` 在 PL-1 保留為 deprecated 的空陣列，`botsCanPlay` 不讀它；SF-4 刪除這個匯出，並更新引用它的文件與註解（策略 §4.4）。

### 4.5 對平台與 rules 的需求

| 需求 | 提供者 | 使用的 SF 切片 |
|---|---|---|
| `BotCommand`、BotModule 型別、registry、`duty`／`answerFrame`／`setup`／`preroll`／`actions`／`freeRouteCandidates`／`planStep` 的組合；`Scored`、`TurnContext` 與測試用的 `turnContext()`；`RobberCause` | PL-1 | SF-1、SF-2a、SF-2b |
| **`banditCandidates?(turn, cause): readonly Scored<BanditTarget>[]`**，接在 base 強盜候選之後一起挑選（`banditChoice`，§11-1）；分數尺度與 base 強盜候選相同，不是勝利分當量；挑選結果區分「沒有候選」（`null`）與「選中外框」（`{ target: null }`） | PL-1 | SF-2b |
| base 評分函式改為具名匯出：`setupSpotScore`、`roadDirectionScore`、`robberCandidates`（從 `robberHex` 拆出）、`plentyPick(turn, hand?, bank?)`（可重複選，供 gold 使用）、`usefulRoad`、`canPlay`；放在 `src/base/*.ts`，避免與模組循環 import | PL-1 | SF-2a、SF-2b |
| `economyOf(model, modules?, level?)` 組合 `costs`、`piecesLeft`、`scoreExtras(input: PlanInput)`；`heuristic.ts` 的通用掛點：`planStep`、「可立即得分」的判斷（`Plan.immediate`）、Road Building 條件納入模組的 `freeRouteCandidates`（策略 §4.10 合約 11、12） | PL-1 | SF-2a |
| 可注入模組清單的策略工廠 `createBotPolicy(level, { modules })`、`createFallbackPolicy(modules)`；`botOwesAction` | PL-1 | SF-3；PL-2 的 naive 座位與假模組 |
| golden replay 測試（48 局：base 3–6 人 × 10 種子，另含保底席、`createBotPolicy` 與全保底局；策略 §4.10） | PL-1 | 所有改動 `src` 的 SF 切片都要通過 |
| `newBotGame({ profileId })`、仿 BotDriver 模式、看門狗、每視窗指令數統計、`BOTS_SEEDS`、`test/modules/<id>.ts` 介面、`bench --profile`、naive 座位（只放入模組的 `duty`） | PL-2 | SF-3、SF-2a 的 bench 驗收 |
| server 依 `BOT_PACING` 查表、依 profile 的視窗上限、「欠動作卻沒有動作」的診斷；`bots.test.ts:252-264` 改用 `botsCanPlay`，`:279-291` 改用含未知模組的 fixture | PL-3 | SF-1 合併、SF-4 |
| 型別匯出 `SeafarersView`、`SeafarersHints`、`SeafarersGoldPendingView`、`ModuleViewMap`、`ModuleHintsMap`（型別）；常數 `SHIP_COST`（`ships.ts:27`）與 `GOLD_FRAME`（`gold.ts:21`）由 index 轉出。`SeafarersGoldPendingView` 目前不存在（`gold.ts:124-133` 回傳通用的 `PublicModulePendingView`），由 RX 在 `seafarers/index.ts` 定義 | RX | SF-1 起 |
| accessor `moduleView(view, 'seafarers')`、`moduleHints(hints, 'seafarers')` 放在 bots（`modules/view.ts`），讓 rules 維持只新增型別與常數（P8） | SF-1 | 全部 |

本版**不實作** `economy.routeEdge` 與 `hexYield`。陸海判定是通用幾何，直接放在 `sea.ts` 與 `board.ts`；金礦的估值在 SF 模組的 `scoreExtras` 與 setup 評分中處理。兩個鉤子保留給後續版本。

### 4.6 節奏與每視窗上限

| 指令 | 建議 ms | 依據 |
|---|---|---|
| `build.ship` | 900 | 與 `build.road` 相同（`bot-driver.ts:45`）；策略 §4.7「建造 900」 |
| `setup.placeShip` | 600 | 與 `setup.placeRoad` 相同（`:42`） |
| `ship.move` | 700 | 策略「移動 400–700」取上限：每個 window 只有一次，畫面上是 from→to 的兩段動作。第一輪建議的 1100 超出策略範圍，因此不採用 |
| `gold.choose` | 800 | 介於 `pending.takeResource` 700 與 `pending.steal` 800 之間；一次送出多張 |

- **每視窗上限**：維持 40，SF 不設定 `maxCommandsPerWindow`。
  - 仿 B-GAME 量到的每視窗每座位最大指令數：naive SF 15（含活鎖局）、造船原型 11、base 12（`q1-calibrate.ts`）。
  - 原型 p95 為 6–8（`proto-ship-greedy.ts`）。
  - 上限約有 2.6 倍餘裕。Q1 另外斷言「每視窗每座位 ≤ 40」（§6.1）。

## 5. 切片與 PR

PR 一律指向 `release/v0.4.1`，以 squash merge 合併（策略 §7）。worktree 一個切片一個，放在 `.worktrees/bots-seafarers-<slice>/`（§11-3）。行數為估計值。

| 切片 | 分支／worktree slug | 檔案所有權 | 內容 | 行數 src／test | 依賴 | 驗收命令 |
|---|---|---|---|---|---|---|
| RX rules 匯出 | `feat/bots-seafarers-exports`／`bots-seafarers-exports` | `packages/rules/src/modules/seafarers/index.ts`、`packages/rules/src/index.ts`、`packages/rules/test/seafarers-exports.test.ts`（新） | 把模組物件內的 `project`／`actionHints` 抽成具名函式 `projectSeafarers`、`seafarersHints`，模組物件改為引用它們；以 `ReturnType` 匯出 view 與 hints 型別（比照 `explorersPirates/index.ts:285,368`）；在 `seafarers/index.ts` 定義並匯出 gold pending 介面；匯出 `ModuleViewMap`、`ModuleHintsMap`、`SHIP_COST`、`GOLD_FRAME`；形狀測試比對實際 key 集合。不碰 web | 30–40／30–40 | 無（可與 PL-1 並行） | `pnpm --filter @catan/rules exec vitest run`（**rules 測試全部通過、行為不變**）；`pnpm --filter @catan/rules typecheck`；`pnpm --filter @catan/web typecheck`；`git diff --stat` 只有上述 3 檔 |
| SF-1 海域模型與保底 | `feat/bots-seafarers-sea`／`bots-seafarers-sea` | `packages/bots/src/sea.ts`（新）、`board.ts`、`economy.ts`（只改型別：`Plan.ships: number[]`，base 恆為 `[]`）、`PieceCounts.ships`（可改為選用，也可以不加：`Economy.left` 帶索引簽章，已能承載 SF `piecesLeft` 回傳的 `ships`）、base freeRoads 處理器 `src/base/duty.ts` 與 `src/base/roads.ts`（只加存量檢查；`fallback.ts` 與 `heuristic.ts` 不必改，模組的 `duty` 經 registry 接上）、`src/modules/seafarers/**`（新：`index.ts` 掛上全部鉤子並接到對應的 stub 檔：`plan.ts` 放 economy 鉤子與 `planStep`，`actions.ts` 放 `actions` 與 `freeRouteCandidates`，`frames.ts` 放 `answerFrame`，`bandit.ts` 放 `banditCandidates` 與 `preroll`，`setup.ts` 放 `setup`，都先回傳 `undefined`／`[]`，讓階段 C 不必修改 `index.ts`；另有 `duty.ts`）、`src/modules/view.ts`（新）、registry 的一行、`packages/bots/test/sf-sea.test.ts`、`sf-duty.test.ts`（新） | §4.1 保底；§4.3 模型；修正 G7–G11；`supports` 先回 false；`pacing`（§4.6） | 250–300／180–230 | PL-1、RX；**合併在 PL-2、PL-3 之後**（R-SF10） | `pnpm --filter @catan/bots exec vitest run test/sf-sea.test.ts test/sf-duty.test.ts`；golden replay（PL-1 提供的測試檔）逐一相同；`pnpm --filter @catan/bots exec vitest run`；`pnpm --filter @catan/bots typecheck`；`pnpm typecheck` |
| SF-2a 島嶼計畫與行動 | `feat/bots-seafarers-plans`／`bots-seafarers-plans` | `packages/bots/src/economy.ts`、`src/modules/seafarers/{plan,actions}.ts`、`packages/bots/test/sf-decisions.test.ts`（新）；不改 `heuristic.ts`（PL-1 已提供通用掛點；若 PL-1 的介面審查決定不提供，改由 SF-2a 在階段 C 獨占 `heuristic.ts`） | §4.2 的 action 各列（計畫、造船步驟、移船、Road Building、交易目標）與 `freeRouteCandidates`；easy 差異；SF-FAQ 18 的 hints 推導測試（§10 D-SF6） | 290–360／150–200 | SF-1；PL-2（bench） | `pnpm --filter @catan/bots exec vitest run test/sf-decisions.test.ts`；golden replay；`pnpm --filter @catan/bots bench 10 --profile sf-new-shores-2025` 與 `--profile sf-new-shores-paired-2025`：`problems 0`，每局都有 `build.ship`；`pnpm typecheck` |
| SF-2b frame、強盜與 setup | `feat/bots-seafarers-frames`／`bots-seafarers-frames` | `src/modules/seafarers/{frames,bandit,setup}.ts`、`packages/bots/test/sf-frames.test.ts`（新）；不改 `heuristic.ts`、`economy.ts` | gold 的 `answerFrame`；強盜與海盜評分；preroll 騎士；setup 的建築與「路或船」；standard 與 easy 的 I9 固定盤面測試 | 140–190／120–160 | SF-1；PL-1 的 `banditCandidates` | `pnpm --filter @catan/bots exec vitest run test/sf-frames.test.ts`；golden replay；`pnpm --filter @catan/bots typecheck`；`pnpm typecheck` |
| SF-3 驗收測試（gating 前） | `feat/bots-seafarers-tests`／`bots-seafarers-tests` | `packages/bots/test/modules/seafarers.ts`（新：`conservation`、`hideDifferently`、`perturb`、`responseCommands`、`mechanics`）、`test/sf-game.test.ts`、`sf-fair.test.ts`、`sf-fuzz.test.ts`、`sf-fallback.test.ts`（新）；在 PL-2 建立的 family 註冊檔 `packages/bots/test/families.ts` 加上 SF 一筆 | Q1 矩陣與 Q2 門檻（§6）；B-POLICY-SEA 在對局中取樣。profile 清單明寫；PL-2 的 matrix guard 在 SF-4 之後會要求 SF 由這些檔案涵蓋 | 0／260–330 | 開發：SF-1、PL-2；**合併：SF-2a、SF-2b 之後** | `pnpm --filter @catan/bots exec vitest run test/sf-game.test.ts test/sf-fair.test.ts test/sf-fuzz.test.ts test/sf-fallback.test.ts`（預設 3 種子）；`BOTS_SEEDS=10 pnpm --filter @catan/bots exec vitest run test/sf-game.test.ts`（發布閘門）；`pnpm --filter @catan/bots exec vitest run` |
| SF-4 開放 gating | `feat/bots-seafarers-gate`／`bots-seafarers-gate` | `src/modules/seafarers/index.ts`（`SUPPORTED_SCENARIOS`）、`src/support.ts`（刪除 `BOT_RULE_MODULES`）、`packages/bots/test/support.test.ts`（快照）、`packages/server/test/seafarers-bots.test.ts`（新）、`packages/server/test/bots.test.ts:266-277`（翻轉）、`packages/server/src/bot-seats.ts:46-48` 與 `packages/server/test/traders-barbarians.test.ts:67`（只改註解）、i18n 兩行、`packages/web/test/bots.test.tsx:175-195`（範例改用 `ck-2025`，期望值改成新文案）；文件：`docs/SPEC.md`、`docs/API.md`、`docs/FIDELITY.md`、`README.md`、bot 規格的 `:16`、`:19`、`:108-119`、新的工作紀錄與 `docs/aegis/INDEX.md`（§7.1）。`RELEASING.md` 歸 PL-2，SF-4 不動 | gating 翻轉；server 四類案例（策略 §4.7-5）；SPEC §4.9 改寫；大廳文案；文件 | 10–20／150–200；docs 60–90 | SF-3、PL-3 | `pnpm --filter @catan/bots exec vitest run test/support.test.ts`；`pnpm --filter @catan/server exec vitest run test/seafarers-bots.test.ts test/bots.test.ts test/seafarers-cities-knights.test.ts`；`pnpm --filter @catan/web exec vitest run test/i18n.test.ts test/bots.test.tsx`；`pnpm verify` |

**合計**：src 720–910，test 890–1,160，docs 60–90，總計約 1,670–2,160 行。比策略 §5 原估的 1,450–1,850 略高，原因是 server 四類案例與模組測試工具算在 SF 切片內；策略 §5 已依此更新。

**commit subject**：

| 切片 | subject |
|---|---|
| RX | `✨ feat(rules): export seafarers view and hint types (#N)` |
| SF-1 | `✨ feat(bots): add sea model and seafarers duties (#N)` |
| SF-2a | `✨ feat(bots): plan ships toward islands (#N)` |
| SF-2b | `✨ feat(bots): answer gold and move the pirate (#N)` |
| SF-3 | `🧪 test(bots): gate seafarers bot games (#N)` |
| SF-4 | `✨ feat(bots): build ships and settle islands in new shores (#N)` |

### 5.1 與平台切片交錯

| 階段 | 並行開發 | 合併順序 | 備註 |
|---|---|---|---|
| A | PL-1 ∥ RX | RX、PL-1（不分先後） | RX 只動 rules；PL-1 動 bots，以及 server 的型別註記與 bot 規格（策略 §4.10）。兩者互不重疊 |
| B | PL-2 ∥ PL-3 ∥ SF-1 | PL-2、PL-3，然後 SF-1 | SF-1 不用 harness（固定盤面直接用 `rules/test/seafarers-helpers.ts`），檔案也與 PL-2、PL-3 不重疊（§11-2）；PL-2 的所有權明列檔案，不含 `test/sf-*`（策略 §4.10） |
| C | SF-2a ∥ SF-2b ∥ SF-3 | SF-2a、SF-2b，然後 SF-3 | stub 讓 2a 與 2b 各改各的檔案；SF-3 修改新的 SF 測試檔，並在 `packages/bots/test/families.ts` 加上一筆 SF 登記 |
| D | SF-4 | — | SPEC、文案與 gating 都放在這一個 PR |
| E | 發布 QA、Browser QA、rc | — | §7 |

## 6. 測試與驗收

### 6.1 Q1 矩陣（發布閘門）

| 家族 | profile × 人數 | 座位 | 種子（預設／發布） | 步數上限 | 看門狗 N | 斷言 |
|---|---|---|---|---|---|---|
| B-GAME | `sf-new-shores-2025` × 3、4（`fixed`）；`sf-new-shores-paired-2025` × 5、6（`variable`） | `mixedLevels(players, seed)`（standard 與 easy 交錯，同 `policy.test.ts:27-29`），仿 BotDriver | 1–3／1–10 | 5000 | 連續 60 次 `turn.roll`，沒有任何玩家的 `ownScore` 超過自己先前的最高分（策略 §4.6） | 有勝者；0 拒絕；沒有殘留 pending；資源守恆（19×5 與 24×5）；道路與船各 ≤ 15；0 次「策略閒置、但保底有動作」；每視窗每座位 ≤ 40；非行動者只送 `responseCommands` |
| 保底混座 | 同上 | `[standard, fallback, easy, fallback, …]` | 1–3 | 800 步（不要求終局） | — | 0 拒絕、不卡死。純保底局永遠不造船，因此混座 |
| B-POLICY 決定性 | 4 人、6 人 | mixed | 4 人種子 3、6 人種子 4 | 5000 | 60 | 重播兩次，指令序列逐一相同 |
| B-FAIR | 4 人、6 人 | standard、easy | 61、62 | — | — | 取樣狀態必須包含 gold、可移海盜的 moveRobber、含船的 freeRoads；投影相同 → 決策相同 |
| fuzz | 4 人、6 人 | standard、easy、fallback | 各 150 個擾動狀態（隨機的船、海盜位置、gold frame、freeRoads） | — | — | 不拋錯；回傳的指令被接受，或是 null 且確實不欠動作 |
| B-POLICY-SEA | 3–6 人 | — | SF-1：`simulateSeafarers(n, seed, 1500)` × 種子 1、2，每位玩家都強制成行動者；SF-3：B-GAME 每 5 步取樣一次 | — | — | `sea.ts` 的船位與道路位置等於 hints；含船的路線長度等於 `longestRoadLength`（第一輪 1,311 次比對、0 次不一致） |
| I9 固定盤面 | 4 人；F8 為 6 人 | fallback、standard、easy 各一次 | — | — | — | F1 只剩船位；F2 道路存量用完；F2b 道路與船都用完；F3 gold 欠 2、銀行 1；F3b 銀行分散在兩種資源；F4 第一位 responder 是非行動者；F5 setup 只剩船位；F6 moveRobber；F7 騎士送海 hex；F8 paired P2 造船與移船、不開價；F9 道路用完時以船打出 Road Building |

**看門狗 N = 60 的依據**（實測）：

- 已終局對局中，最長無人得分間隔為：base 6–25、naive SF 6–25、造船原型 5–32。
- 活鎖局則為 933–1,513。
- N = 60 約有 2 倍餘裕，大約 400 步內就能抓到活鎖。

步數上限沿用 base 的 5000。仿 B-GAME 中，原型最長 734 步，naive SF 已終局者最長 1,040 步。

**時間預算**（推測）：

- 原型 40 局的 CPU 約 27 s，其中含探查本身的投影開銷；同一支探查跑 base 是 18 s。
- 加上海路 BFS 後，SF 的 B-GAME 預設 3 種子約 6–10 s，`BOTS_SEEDS=10` 約 20–35 s。
- 檔案拆開後由 vitest 平行執行，timeout 120 s（策略 §4.6）。

### 6.2 Q2 門檻（發布閘門）

依據來自「粗略造船原型」（`q1-calibrate.ts proto`：付得起就朝 ≤2 艘船可達的未領加分小島造船，並優先在小島建聚落；其餘沿用 base 策略）。正式策略應不低於這個下限。

| # | 指標（每個 profile × 人數，除非另註） | 發布（10 種子） | 預設（3 種子） | 原型實測（3／4／5／6 人） | 性質 |
|---|---|---|---|---|---|
| Q2-1 | 至少有一次付費 `build.ship` 的局數 | ≥ 9/10 | 3/3 | 10／10／10／10 | 實測 |
| Q2-2 | 至少有一位玩家拿到小島加分的局數 | ≥ 8/10 | ≥ 2/3 | 9／10／10／10 | 實測 |
| Q2-3 | standard 座位與 easy 座位各自有付費造船的局數（每個 profile 合計 20 局） | 各 ≥ 12/20 | 不檢查 | standard：3–4 人 13/20、5–6 人 20/20；easy：18/20、18/20 | 實測（3 人中半數種子只有 1 個 standard 座位） |
| Q2-4 | 由策略（不是保底）送出 `gold.choose` 的局數（每個 profile 合計 20 局） | ≥ 4/20 | 不檢查 | 3–4 人 7/20、5–6 人 15/20 | 實測 |
| Q2-5 | standard 送出 `ship.move` 的局數（每個 profile 合計 20 局） | ≥ 2/20 | 不檢查 | 原型不移船 | **推測** |
| — | `setup.placeShip`、海盜移動次數 | 不設門檻，列入 Q3 | — | — | §10 D-SF3 |

- 不接受「會終局但不用船」的過渡版本，由 Q2-1、Q2-2 把關。N1 也顯示，這種版本連 Q1 都不保證能過。
- 測試是決定性的：門檻只對固定種子判定，不會有偶發失敗。
- 若 SF-2a 完成後 Q2-5 仍達不到，就回到 §10 調整門檻，不降低 Q2-1 到 Q2-4。

### 6.3 Q3 bench（只報告、不擋發布）

| 項目 | 內容 |
|---|---|
| 設定 | `--profile sf-new-shores-2025` 3、4 人；`--profile sf-new-shores-paired-2025` 5、6 人。每組 100 局，種子從 10000 起；standard 依局數輪換座位 |
| 對局 | ①1 standard 對其餘 easy；②1 standard 對其餘 naive（base 策略加上 SF `duty`，等於 v0.4.0 的行為）；③全 standard；④全 easy |
| 指標 | 勝率與公平份額；平均回合數，並與 naive 及 rules 腳本模擬（seafarers-sim 333／235／126／110 回合）對照；平均指令數；每視窗最大指令數；decide 平均與最大；保底次數；拒絕數；每局造船數、移船數、setup 放船數、小島聚落與加分、gold 張數、強盜與海盜各移動幾次、含船的最長路線持有率；problems（含看門狗） |
| soft target（推測） | ①standard 勝率 ≥ 1.3 × 公平份額；②勝率 ≥ 公平份額 + 10 pp，且 naive 那幾局的活鎖不計為 standard 的勝利；平均回合數不高於 naive 的 110%；每視窗最大指令數 ≤ 20；低負載下 decide 最大 ≤ 50 ms；拒絕與「策略閒置」都是 0 |
| 基準 | PL-2 的 bench PR 必須附上 base 的同組數據，作為對照 |

## 7. 文件與發布

### 7.1 文件更新（SF-4，除非另註）

| 位置 | 修改 |
|---|---|
| `docs/SPEC.md:188` | 改用策略 §4.4 的 Rulesets 條文；「Today that is the base game and Seafarers — Heading for New Shores (`sf-new-shores-2025`, `sf-new-shores-paired-2025`), including paired 5–6 player turns.」 |
| `docs/API.md:141-147` | 改寫判定說明：依 BotModule 加上 `supports`；SF 兩個 profile 為 `botSeats: true`，其餘擴充仍為 false |
| `docs/FIDELITY.md:34-35` | 兩個 SF profile 列加上「easy／standard bot seats」 |
| `docs/FIDELITY.md:65` | 在 New Shores 開放段落補一句 Bot 證據（Q1／Q2、server 測試）；同段 C&K 句子對 `BOT_RULE_MODULES` 的引用，改寫為依 BotModule 判定 |
| `docs/FIDELITY.md:67` | 「as for the other expansions」改為「as for every expansion except New Shores」 |
| `docs/FIDELITY.md:117` 之後 | 新增 `R-SF bots` 列：bots 的 `sf-*.test.ts`、`server/test/seafarers-bots.test.ts` |
| `docs/aegis/specs/2026-11-01-bot-opponents.md:16` | 範圍加上兩個 SF profile |
| 同上 `:19` | 刪除「目前停用的 Seafarers／C&K profile」 |
| 同上 `:108-119` | 規則 7 的表格加上 §4.1 的 SF 列，或改為指向本計畫。合約條文由 PL-1 修改：`:42` 的 I3、`:76-98` 的程式碼區塊、`:104-105` 的規則 3 與 4，以及新增的規則 8、9；`:258` 的完成閘門由 PL-2 修改 |
| `README.md:153-157` | SF 段落加上「with easy and standard computer opponents」 |
| `README.md:176-177` | 「not offered for the expansions」改為「not offered for this combination」 |
| `packages/web/src/i18n/zh-Hant.ts:276`、`en.ts:279` | 改用策略 §4.4 的文案（message id 不變） |
| `packages/web/test/bots.test.tsx:175-195` | 不支援的範例改用 `ck-2025`，期望值改成新文案 |
| `RELEASING.md:102-113` | 由 PL-2 修改：pre-flight 的 `pnpm verify` 改為 `BOTS_SEEDS=10 pnpm verify`（策略 D7）；SF-4 不動 |
| `docs/aegis/work/2026-11-0x-bots-seafarers.md`（新）、`docs/aegis/INDEX.md` | 工作紀錄（Q1／Q2 表、bench 表、探查結論）與索引列 |

`docs/aegis/work/2026-11-01-seafarers.md:142-143` 是當時的歷史紀錄，**不改**。

### 7.2 發布

1. 依策略 §7：從 `master` 建立 `release/v0.4.1`，各 PR 依 §5.1 的順序合併。
2. SF-4 合併後，QA 執行 `BOTS_SEEDS=10 pnpm verify` 與 §6.3 的 bench，把 Q3 表附在發布 PR。
3. 在 release 分支直接 push `🔖 release: v0.4.1-rc.1`，以 rc 映像試玩。
4. Browser QA 在 rc 上驗證：
   - `sf-new-shores-2025` 4 人房加入 1 easy、1 standard 後開局，觀察數個 Bot 回合，至少看到造船、gold 選擇或小島聚落，而且沒有停住。
   - `sf-new-shores-paired-2025` 6 人房再驗證一次，包含 P2 的 window。
   - 截圖放在 `.tmp/`，不提交（策略 D10）。
5. stable：開 PR `release/v0.4.1 → master`，以 merge commit 合併；在 master 建立 `🔖 release: v0.4.1`、打 tag，並以 `scripts/release-notes.sh` 加上 `scripts/release-notes-lint.sh` 產生 notes。tag、Release 與發布都只在使用者授權後執行。

## 8. Paseo 分工

派工前以 `list_profiles` 的結果為準。2026-11-04 已核對下列名稱都存在。

| 切片 | 角色 | 隔離 | 審查 | 備註 |
|---|---|---|---|---|
| PL-1 合約 | Implementer (Backend) | `.worktrees/bots-platform-contract` | **Architect** 先審介面（含 `banditCandidates`、匯出的 base 評分函式與 `heuristic.ts` 的通用掛點），再由 Reviewer (Sol) 審 diff | 共用合約檔由主 agent 擁有（策略 §8） |
| PL-2 測試基礎建設 | Implementer (Backend) | `.worktrees/bots-platform-harness` | Reviewer (Opus)：harness 與 BotDriver 的語意一致、golden 沒有被改動、反例測試 | 與 PL-3、SF-1 同時派工 |
| PL-3 伺服器 | Implementer (Backend) | `.worktrees/bots-platform-server` | Reviewer (Sol)：退避重試不形成熱迴圈、上限邏輯、診斷內容 | 與 PL-2、SF-1 同時派工 |
| RX | Implementer (Backend) | `.worktrees/bots-seafarers-exports` | Reviewer (Opus)（輕量：只看行為是否不變） | 與 PL-1 同時派工 |
| SF-1 | Implementer (Backend) | `.worktrees/bots-seafarers-sea` | Reviewer (Sol)：I9、合約規則 5、golden replay | 與 PL-2、PL-3 同時派工 |
| SF-2a | Implementer (Backend) | `.worktrees/bots-seafarers-plans` | Reviewer (Sol)：決定性、tie-break | 共用檔 `economy.ts` 只給這一個 agent |
| SF-2b | Implementer (Backend) | `.worktrees/bots-seafarers-frames` | Reviewer (Opus)：B-FAIR、responder 資格 | 與 SF-2a 並行 |
| SF-3 | QA | `.worktrees/bots-seafarers-tests` | Reviewer (Opus) | 只改測試；Q2 門檻以 SF-2a、SF-2b 合併後的實測為準，達不到時回報主 agent，不自行降低 |
| SF-4 | Implementer (Backend)（bots、server）；文件與 i18n 由主 agent 處理 | `.worktrees/bots-seafarers-gate` | Reviewer (Sol) | SPEC 條文照策略 §4.4 |
| 發布閘門 | QA（`BOTS_SEEDS=10`、bench） | worktree | — | 結果交給主 agent 彙整 |
| 瀏覽器驗證 | Browser QA | 共用工作區 | — | §7.2-4 |
| tag／Release | Release Manager | — | — | 只在使用者明確授權時派工 |

- **執行順序**：A（2 個 agent）→ B（3 個）→ C（3 個）→ D（1 個）→ E。
- **閒置 agent**：寫交接筆記到 `.worktrees/_handoff/` 後停止（策略 §8）。
- **派工 prompt**：必須寫明檔案所有權（§5）、「不 push、不改 lockfile」，以及對合約有疑義時回報主 agent、不自行修改。

## 9. 風險

| # | 風險 | 對策 |
|---|---|---|
| R-SF1 | 主島飽和造成活鎖（N1；naive 2/40） | easy 也造船（P9）；看門狗 N=60；Q2-1、Q2-2 |
| R-SF2 | freeRoads 只剩船位，或道路存量用完時送出 `build.road` 被 `E_NO_PIECES` 拒絕，進入無限退避（G4） | §4.1 保底；base 處理器加存量檢查；F1、F2、F2b |
| R-SF3 | gold 欠的張數多於銀行存量，或存量分散在不同資源 | `goldRequired` 加上每種資源的上限；F3、F3b、F4 |
| R-SF4 | `sea.ts` 與 rules 漂移（規則版本或 SF-FAQ 18 改判） | 合法性只取 hints；`ship.move` 只取 `movableShips`；B-POLICY-SEA |
| R-SF5 | 3 人小島加分偏低：第一版原型只有 3/10，加上島上聚落優先後才到 9/10 | 計畫要為 +2 VP 計價；Q2-2；達不到時回 §10 D-SF1 |
| R-SF6 | 造船計畫囤積資源，讓對局變長 | 船路徑 ≤ 4；bench 的平均回合數與 naive 對照 |
| R-SF7 | 平台的 base frame 調整鉤子容不下海盜目標 | `banditCandidates`（§11-1），由 Architect 在 PL-1 審查 |
| R-SF8 | 測試時間 | 預設 3 種子；拆成多個檔案；timeout 120 s |
| R-SF9 | paired P2 的限制 | B-GAME 涵蓋 5、6 人；F8 |
| R-SF10 | 合併順序：SF-1 註冊模組時，`bots.test.ts:259-261` 若仍以 `BOT_RULE_MODULES` 推算，會與 `botsCanPlay` 不一致 | SF-1 合併在 PL-3 之後；PL-1 另把 `BOT_RULE_MODULES` 保留為 deprecated 的空陣列（策略 §4.4），所以在 SF-4 翻轉 gating 之前，兩種推算的結果都相同 |
| R-SF11 | 模組 hints 讀原始 `state.pending`（`index.ts:87-89`），已停滯的 freeRoads 會讓 `movableShips` 暫時為空 | 只會少移一次船，不影響 I9；不修 |

## 10. 待使用者決定的事

| # | 決策 | 建議 |
|---|---|---|
| D-SF1 | Q2 門檻 | 採用 §6.2：Q2-1 ≥ 9/10、Q2-2 ≥ 8/10、Q2-3 各 ≥ 12/20、Q2-4 ≥ 4/20、Q2-5 ≥ 2/20（推測，可在 SF-3 時調整） |
| D-SF2 | easy 是否用船 | **會造船**（船路徑 ≤ 3、topK 3）、**不移船**、**只移強盜**。依據：N1 顯示不用船會活鎖（P9） |
| D-SF3 | `setup.placeShip` 是否設 Q2 門檻 | 不設，只列入 Q3。理由：這是合法的替代選項，只在分數較高時使用；F5 與決策測試證明策略會送出這個指令 |
| D-SF4 | 節奏 | `build.ship` 900、`setup.placeShip` 600、`ship.move` 700、`gold.choose` 800 ms |
| D-SF5 | 每視窗上限 | 維持 40；Q1 斷言 ≤ 40，Q3 監測 |
| D-SF6 | SF-FAQ 18（船圈與迴路，`docs/FIDELITY.md:250-256`） | 不另立 Bot 的規則 fixture；只在 SF-2a 加一個測試：在 `seafarers-ships.test.ts` 的船圈盤面上，`ship.move` 的 from／to 必須落在 `hints.movableShips` 內。日後若改判，只有 rules 的 hints 會變 |
| D-SF7 | 新增 `banditCandidates` 鉤子 | 同意（§11-1） |
| D-SF8 | SF-1 提前與 PL-2、PL-3 並行 | 同意（§11-2） |
| D-SF9 | gating 的判定 | `supports` 只認 `scenario === 'new-shores'`，與 rules 的島嶼規則判定一致（`islands.ts:30-32`） |
| D-SF10 | 是否修正策略 §2.2 與 §5.1 中「SF 全部終局」的敘述 | 已於 2026-11-04 修正（§11-5） |

## 11. 與整體策略的差異

2026-11-04 主 agent 已把第 1–5、7 項併入整體策略（§2.2、§3.1、§4.1–4.4、§4.10、§5.1、§7）。第 6 項與策略一致：鉤子保留，延後實作。依獨立審查修正：每視窗上限斷言改為 ≤ 40（driver 送滿 40 個之後才改走保底）；看門狗改用策略 §4.6 的創新高定義。SF+CK 計畫 §11-6 到 §11-8 要求的修改也已寫入 §4.1 moveRobber 列、§4.2 setup building 與計畫列，以及 §4.3。下表保留原始論證。

| # | 差異 | 策略原文 | 證據與理由 |
|---|---|---|---|
| 1 | **BotModule 新增 `banditCandidates?(turn, cause): Scored<number \| null>[]`**，與 base 強盜候選串接後統一評分 | §4.1 介面沒有這個鉤子；§4.2 的 `robberTargets` 取交集 | 交集只能縮小候選，不能加入海盜的海 hex 與 `null`（`pirate.ts:13-21`）；base 評分會跳過海 hex（`heuristic.ts:198-199`）。SF+CK 依 `hints.modules.seafarersCitiesKnights.bandit` 選擇強盜或海盜時也會用到。base 不提供候選，golden replay 不受影響 |
| 2 | **SF-1 在 PL-1 之後就開始，與 PL-2、PL-3 並行開發**；合併仍排在 PL-3 之後 | §4.10：「兩者完成後才開始 SF 切片」 | SF-1 的檔案（`sea.ts`、`board.ts`、`fallback.ts`、`modules/seafarers/**`、新的 `test/sf-*.test.ts`）與 PL-2（既有測試、harness、bench）及 PL-3（server）都不重疊；固定盤面直接用 `rules/test/seafarers-helpers.ts:22-27`，不需要新的 harness |
| 3 | **釐清**：worktree 一個切片一個，放在 `.worktrees/bots-seafarers-<slice>/` | §7-2：「worktree 放在 `.worktrees/<slug>/`」 | 同一版有 3 個 SF 切片並行；共用一個 slug 會讓分支同時檢出而衝突 |
| 4 | **Q1 新增「每視窗每座位 ≤ 40」與看門狗兩項斷言** | §3.1 的 Q1 沒有列出；每視窗指令數放在 Q3 | 超過上限時 driver 只走保底（`bot-driver.ts:303-314`），測試看不到這個行為，因此與 driver 對齊；實測最大值 15。看門狗見 §4.6；N1 證明需要它 |
| 5 | **事實修正**：現行策略打 SF 是「0 拒絕」，但不保證終局 | §2.2：「會打完」；§5.1：「現行策略已能合法打完 SF」 | 仿 B-GAME 混座、10 個種子：3 人種子 7 與 6 人種子 3 各跑滿 8000 步仍無勝者（`q1-calibrate.ts`、`diag-naive-6p.ts`）。SF 先做的排序不受影響，但 P9 與 Q2 的必要性更強 |
| 6 | 本版不實作 `economy.routeEdge` 與 `hexYield` | §4.1 列出這兩個鉤子；§4.9 說 0.4.1 實作 SF 用到的鉤子 | 陸海判定是通用幾何，base 中是 no-op（`base-geometry.ts`），直接放在 `sea.ts` 與 `board.ts`；金礦在 SF 模組內估值。兩個鉤子仍保留位置 |
| 7 | accessor `moduleView` 放在 bots，rules 只匯出 `ModuleViewMap` 型別 | §4.3 沒有指定 accessor 放在哪裡 | P8 只允許 rules 新增型別與常數的匯出；accessor 是執行期函式 |

## 附錄：第二輪探查（`/tmp/katan-bot-research/seafarers/`）

| 檔案 | 用途 | 執行 |
|---|---|---|
| `q1-calibrate.ts` | 仿 B-GAME 與仿 BotDriver：終局率、步數、擲骰數、無人得分間隔、每視窗指令數、Q2 計數；支援 `naive`／`proto` 與 `sf`／`base` | `node --experimental-strip-types --no-warnings q1-calibrate.ts proto sf 10 8000` |
| `diag-naive-6p.ts` | 活鎖局的終盤：分數、建築、合法聚落點 | `--experimental-strip-types` |
| `duty-fixtures.ts` | §4.1 保底表 F1–F6 的固定盤面 | `node --experimental-transform-types --no-warnings duty-fixtures.ts` |
| `base-geometry.ts` | base 沒有海格、每條邊都鄰接陸地 | `--experimental-strip-types` |
| `proto-ship-greedy.ts`、`proto-ship-greedy-v2.ts` | 原型 v1 與 v2，以及每視窗指令數（v2 揭露 N2） | `--experimental-strip-types` |
