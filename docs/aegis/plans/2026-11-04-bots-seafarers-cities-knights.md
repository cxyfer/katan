# Seafarers + Cities & Knights 電腦對手：實作計畫（v0.4.3）

日期：2026-11-04；2026-11-12 刷新（§12）。狀態：**執行中（2026-11-12 起於 `release/v0.4.3`）；§10 採建議，主 agent 的細化（D1–D6）寫在 §10 的「2026-11-12 主 agent 決定」表，並同步改入 §4.4、§5、§6.1、§7.2、§8。**

本文件是 Aegis 工作紀錄，不是權威的執行期決策；權威需求以 `docs/SPEC.md` §4.9 為準。

前置閱讀：

- 整體策略 `docs/aegis/plans/2026-11-04-expansion-bots-roadmap.md`（以下簡稱「策略」），特別是 §3.1、§4.1–4.9、§6–§8。
- SF 計畫 `docs/aegis/plans/2026-11-04-bots-seafarers.md`（v0.4.1）；C&K 計畫 `docs/aegis/plans/2026-11-04-bots-cities-knights.md`（v0.4.2）。
- bot 規格 `docs/aegis/specs/2026-11-01-bot-opponents.md`（I1–I9、§5 合約）。
- rules：`packages/rules/src/modules/seafarersCitiesKnights/index.ts`（以下簡稱 `sfck/`）；`docs/FIDELITY.md` 的 R-COMB 列（`:131-141`）與 SFCK 詮釋（`:515-569`）；`docs/SPEC.md:294`。

證據：基準為 `a200840`。2026-11-12 依 `fc6b3b5`（`release/v0.4.3` 的起點，v0.4.2 stable）刷新（Planner 報告），行號與引用以刷新後為準，更正清單見 §12。第一輪報告收錄在 `docs/aegis/work/2026-11-04-bots-seafarers-cities-knights-research.md`；本輪探查放在 `/tmp/katan-bot-research/seafarers-cities-knights/`（附錄），不提交，**刷新時該目錄已不存在**，F1–F11 改由 SFCK-1 重建（§4.3、§6.3）。本輪 `q2-calibrate.ts` 共 84 局（load 0.5–1.2），耗時只是參考值，結論只依步數、局數、拒絕數與機制計數。原型是**天真組合**（組合層、SF 最小造船、C&K 核心與天真 F1 打卡），用來估門檻的量級，不是提案程式碼。

路徑縮寫：`B/` = `packages/bots/src/`（`B/base/` 是 PL-1 從 heuristic 拆出的 base 策略，含 `robber.ts`、`duty.ts`）；`sf/`、`ck/` = `packages/rules/src/modules/{seafarers,citiesKnights}/`；`engine.ts` = `packages/rules/src/engine.ts`。

**要點**

1. **組合層很薄**：SFCK 模組只負責收窄強盜與海盜目標、追擊海盜，以及仲裁 SF 與 C&K 在 setup、騎士位置上的衝突。它沒有自己的 `duty`，保底由 base 加上 SF、C&K 的 duty 完成。
2. **強盜／海盜目標**：沿用策略即將採用的 `robberTargets` fold，元素型別推廣為 `number | null`，**初值改為完整的盜賊預設**（陸地強盜格、海上海盜格、外框 `null`）。SFCK 只做收窄。不新增 `banditTargets`，第一輪的提議撤回（§4.2、§11-1）。
3. **平台需要一個小切片**（SFCK-P，src 50–90 行）。0.4.3 因此不是「只有組合層」（§11-2）。
4. **Q2 改用兩類規則**：sim 能覆蓋的機制採局數門檻；sim 覆蓋不到的機制（追擊海盜、金礦城市、`either` 時移海盜）以固定盤面守門（§6.2、§11-4）。
5. **刷新結論**（§12）：A1–A5 全部成立，沒有阻擋開工的問題。計畫的檔案所有權有缺漏（SFCK-P、SFCK-1、SFCK-3、SFCK-G），已補齊；CK-C 已在 0.4.2 交付（#158）；sf／ck 沒有 golden 基礎設施，SFCK-P 改在 scratch 以決策雜湊前後比對（D1，§10）。

## 1. 目標與範圍

| 項目 | 內容 |
|---|---|
| profile | `sf-ck-new-shores-2025`：3–4 人，`fixed`（`packages/rules/src/profiles.ts:462-492`，定義從 `:468` 開始） |
| | `sf-ck-new-shores-paired-2025`：5–6 人，`variable`（`:494-525`，定義從 `:496` 開始） |
| 規則 | `ruleModules` 為 `['seafarersCitiesKnights','seafarers','citiesKnights']`（`:471`、`:500`）；`sf-ck-2025.1`；16 VP |
| 同版交付 | SFCK-X、SFCK-P、SFCK-1、SFCK-2、SFCK-3、SFCK-G。CK-C 已在 0.4.2 交付（#158），不在本版（§5.2） |
| 目標 | 兩個 profile 的 3–6 人都能加入 easy 與 standard，並通過 Q1 與 Q2。兩種難度都會造船登島、招募並啟動騎士、改良城市；standard 會追擊海盜。每個 frame 與強制動作都有保底 |
| 非目標 | 策略 §1.3 全部；SF 與 C&K 各自已規劃的內容（只引用，不重寫）；`sfck-sim.ts` 計數問題（#98 已由 #108 修正）；海盜騷擾、騎士封鎖航線等進階戰術（延到 0.4.x 調參） |

## 2. 現況與落差

### 2.1 依賴的 0.4.1／0.4.2 交付

| 交付 | 來源 | SF+CK 的用途 |
|---|---|---|
| `BotCommand`；registry；`answerFrame`、`duty`、`setup` 依序詢問；`actions`、`banditCandidates` 串接 | PL-1 | 組合骨架 |
| harness `newBotGame({ profileId })`；仿 BotDriver 模式；看門狗；`test/modules/<id>.ts`；`BOTS_SEEDS`；`bench --profile`（gating 前被 `botsCanPlay` 擋下，`bench/run.ts:109-113`，見 §6.4、D6） | PL-2 | Q1、Q2、Q3 |
| `BOT_PACING`；依 profile 的上限；「欠動作卻沒有動作」的診斷 | PL-3 | 節奏與診斷 |
| `sea.ts`：船位模擬、兩套 BFS、含船的路線長度；`blocker?` callback 掛點 | SF-1（SF 計畫 §4.3） | 海路規劃 |
| SF 的 `duty`：gold、freeRoads 船分支、setup 放船 | SF-1 | 保底 |
| 島嶼計畫（SF-2a）；`banditCandidates` 海盜評分與 setup 評分（SF-2b） | SF-2a、SF-2b | 策略 |
| SF 模組測試工具 | SF-3 | 組合測試工具 |
| 型別匯出 | RX、CK-A | 型別 |
| CardKind 手牌；14 種 frame 的保底；`economy.{cardKinds,rates,weights,costs,hexYield,vertexBlocker,siteBlocked}` | CK-B1 | 保底與模型 |
| 防禦、改良、騎士、F1 卡、第 2 輪城市；`knights.ts` 匯出的候選建構函式（C&K 計畫 §4.9）：`chaseValue`（對 `'pirate'` 一律回 0）、`chaseCandidates`、`displaceCandidates`、`knightActions`、`threatOf`、`blockedPipsAt`、`knightsOf`；`defense.ts` 的 `recruitSite`、`guardedKnights` | CK-B2 | 策略 |
| C&K 模組測試工具 | CK-B1 | 組合測試工具 |
| CK-C：互動進度卡、`preroll`、`tactics`（`cards-interactive.ts`、`preroll.ts`、`tactics.ts`） | **0.4.2 #158 已交付**（`1c91cce`） | `tactics.ts` 的 `knight.move` 候選會經過 SFCK 的 `rescore`（§4.4） |

**前提**（§8 步驟 0 由 Planner 依 0.4.2 合併後的程式核對；2026-11-12 的結果見最右欄，證據行號以 `fc6b3b5` 為準，`B/` = `packages/bots/src/`）：

| # | 前提 | 若不成立 | 刷新結果（2026-11-12） |
|---|---|---|---|
| A1 | `sea.ts` 的 `blocker` 是 options 物件中的欄位，預設回 null | SFCK-P 以相容方式加上 | **成立**：`B/sea.ts:33`（`VertexBlocker = (vertex) => string \| null`）、`:35-44`（`ShipOptions.blocker?`）、`:47`（`RoadOptions`）、`:105-110`（`blockedFor`）。注意 `sea.ts` 目前不讀 `model.blocker`（組合掛點在 `board.ts:66`），所以 G-SC3 仍然存在；含船的路線長度（`board.ts:367-424 routeLength`）經 `opponentAt`（`:294-299`）已讀 `model.blocker`，騎士已作用在路線長度上，缺口只剩船位模擬與船 BFS。兩種 blocker 的簽章不同：sea 的收 `(vertex)`，model 的收 `(model, vertex)` |
| A2 | CK-B1 的 `hexYield` 對非 `TERRAIN_COMMODITY` 地形回 `undefined` | SFCK-P 修正為 §4.6 的組合規則 | **成立**：`B/modules/citiesKnights/economy.ts:90-96`：聚落一律回 `undefined`，城市只有在 `TERRAIN_COMMODITY` 與 `hexResource` 都有值時才回 `{resource:1, commodity:1}`（金礦回 `undefined`）。組合規則已在 `B/board.ts:131-163` 實作（`vertexBlocker` 取第一個非 null、`siteBlocked` 取 OR、`hexYield` 取第一個非 `undefined`），與 §4.6 一致，SFCK-P **不必修** `hexYield` |
| A3 | SF 的島嶼計畫以 `isFreeSpot` 判定空點，因此 C&K 的 `siteBlocked` 自動生效 | SFCK-2 補上 | **成立**：`B/modules/seafarers/plan.ts:84`（`isFreeSpot`）、`B/board.ts:190`（`model.siteBlocked`）；setup 的 `baseSites` 也走 `isFreeSpot`（`seafarers/setup.ts:59`）。同檔 `plan.ts:72` 的 `searchShips` 沒有傳 blocker，船路徑會穿過對手的騎士，由 SFCK-P 改預設值修正 |
| A4 | SF 的 setup 評分、C&K 的第 2 輪城市評分是可以匯出的純函式 | SFCK-2 只補 `export` | **成立**（已匯出，SFCK-2 不必動 SF／C&K 的 `setup.ts`）：`islandSetupBonus(turn, vertex)`（`seafarers/setup.ts:105-116`）、`citySetupScore(model, vertex, mine?)`（`citiesKnights/setup.ts:37-60`）、`setupSpotScore(turn, vertex)`（`base/setup.ts:8-33`）；三者都不消耗 rng、不讀 hints。陷阱：「至少相鄰 ore 或 grain」是**硬篩選**，寫在 `citiesKnightsSetup` 的 `:67-71`，不在 `citySetupScore` 裡（它只扣 3 分，`:53`）。SF 的 setup 每一輪的 building 都回答（`seafarers/setup.ts:136-140`），C&K 只在第 2 輪回答（`:65`），G-SC4 成立 |
| A5 | SF 的城市計畫把金礦當萬用點數計價（金礦城市拿 2 張，`sf/gold.ts:38`） | 這是 SF 單獨也存在的缺陷，在 SFCK-2 以 SF 測試修正，並回報 SF 計畫 | **成立**，實作在平台層而不是 SF 的 `plan.ts`：`B/economy.ts:126-152`（`goldPipsAt`、`wildcardWeight`、`productionValue`）、`:214-230`（`settlementSpotValue`）。金礦城市 2 張萬用、0 張 commodity（與 COMB-8 相同）。SFCK-2 只需要寫測試（FX-G2）。已知限制：`playerYield`／`Economy.yield` 沒有計入金礦收入，ETA 會低估金礦；SF 單獨也有，不在本版 |

### 2.2 落差（第一輪結論經本輪核實）

| # | 落差 | 證據 | 處理 |
|---|---|---|---|
| G-SC1 | 投影的 `moveRobber` 沒有 pirate 旗標，只有 `bandit` hint 能分辨三種 frame；SF 的 `pirateTargets`、`robberTargets` 沒有被收窄 | `packages/rules/src/project.ts:180-181`；`sfck/index.ts:180-182`（SFCK-X 合併後以 `seafarersCitiesKnightsHints` 函式名稱引用，見 §3）；`sf/index.ts:68-72`（`seafarersHints` 內）。第一輪 naive：4/40 局無限退避（`E_ILLEGAL_TARGET/pirate`） | §4.2 fold（SFCK-P、SFCK-1） |
| G-SC2 | `robberTargets` 的 fold（取代語意）排在 0.4.4，但 0.4.3 就需要 | 策略 §4.9 | SFCK-P 提前實作（§11-2） |
| G-SC3 | `sea.ts` 的船 BFS 與路線長度沒有算入騎士 | 第一輪：不含騎士時 164/8,353 個窗口（2.0%）與 rules 不一致；加入騎士 blocker 後為 0 | SFCK-P：`blocker` 預設改為組合後的 `vertexBlocker` |
| G-SC4 | **setup 被覆蓋（已確認，不再是推測）**：策略 §4.2 規定 `setup` 由第一個非 undefined 者勝出；SF 的 `setup` 回答每一輪的 setup building；C&K 的第 2 輪城市評分只在 C&K 的 `setup` 中。依順序 sfck → sf → ck，C&K 的評分永遠不會被問到 | 策略 §4.2；SF 計畫 §4.2 setup building 列；C&K 計畫 §4.1、§4.3；`profiles.ts:471`；第 2 輪放城市見 `ck/index.ts:90-93` | SFCK-2 由組合模組攔截並合成（§4.4） |
| G-SC5 | `hexYield` 沒有組合規則；COMB-8 規定金礦城市拿 2 個資源、沒有商品 | `ck/production.ts:41`（金礦沒有 `TERRAIN_RESOURCE`，直接跳過）；`sf/gold.ts:38`（城市 2 張）；策略 §4.2 沒有這一列 | §4.6 規則；A2、A5 |
| G-SC6 | 騎士與船的衝突 | 自己的騎士站在自己的船 open end 上，該船就不能移：佔 SF 模型認為「可移」窗口的 14%（363 個）；任何騎士都會擋住建地：166 個窗口中，自己的騎士站在可蓋的小島空點上。依據：`sfck/index.ts:121-125`、`ck/index.ts:127-129`（`allowBuilding`；`vertexBlocker` 在 `:123-125`） | SFCK-2 以 `rescore` 仲裁（§4.4） |
| G-SC7 | 沒有任何模組會送 `knight.chasePirate` | `sfck/index.ts:98-110` | SFCK-2（§4.5） |
| G-SC8 | 3 人局的改良等級偏低：16 VP 多半靠島嶼取得，2/10 局桌上最高改良等級只有 2，C&K 的 M2「每局 ≥ 3」會失敗 | `out/q2-mixed.txt`（種子 6、10） | §6.2 的 C2 調整門檻 |

## 3. 介面摘要（只列策略與保底需要的部分）

| 項目 | 事實 | 證據 |
|---|---|---|
| 新指令 | `knight.chasePirate {vertex}`：只能在行動窗口、首攻之後使用；騎士必須是 active、可行動，且相鄰海盜 hex。騎士倒下後，排入 `{kind:'moveRobber', cause:'knight', pirate:true}` | `sfck/index.ts:98-110`（106、108）、`:167-170` |
| 覆寫指令 | `ship.move`：船只剩被騎士壓住的 open end 時，回 `E_SHIP_PINNED_BY_KNIGHT`。對手騎士在任一端也會釘住船 | `sfck/index.ts:121-138` |
| `bandit` hint | 三種值：`pending.pirate` 時為 `'pirate'`；`cause === 'knight'`（或首攻前）時為 `'robber'`；其他情況（首攻後擲出 7）為 `'either'` | `sfck/index.ts:182` |
| 首攻前 | 強盜在 -1，海盜在外框。擲 7 只棄牌，不出 `moveRobber`。`pirateChase` hint 為空 | `sfck/index.ts:146-148`、`:89-90`；`engine.ts:1124`（`resolveSeven` 內；函式從 `:1105` 起，棄牌之後的路徑在 `:1630-1633`） |
| 盜賊合法性 | 強盜：陸地格，且不是目前所在格；rules 以 fold 計算（`engine.ts:1495-1505`，初值在 `:1497`），目前只有 T&B 實作 | `sfck/index.ts:62-81`（73、75、79） |
| | 海盜：海格，且不是目前所在格；海盜在場上時再加上 `null`（`sf/pirate.ts:13-21`） | |
| | SFCK 的 veto：追強盜不可移海盜，追海盜不可移強盜，首攻前不可移海盜 | |
| 船與騎士的 hints | `legalShips`、`movableShips` 已反映騎士阻擋與釘船 | `sf/ships.ts:72`、`:111-144` |
| 騎士的 hints | 騎士移動可沿船、可停在全海路口（`knightReach`）；`recruitSites` 含經由船連到的陸地路口 | `ck/knights.ts:80-108`、`:119-127` |
| 金礦 | 金礦算作產出，aqueduct 不補牌；金礦 frame 排在 aqueduct 補牌之前；merchant 不可放金礦 | `sfck/index.ts:153-159`、`:163-165` |
| 免費路線 | 容量使用 C&K 的 `freeRouteCapacity`：道路加上船 | `engine.ts:673-677`、`:1292-1296` |
| setup | 第 2 輪放城市，之後可以 `setup.placeShip` | `ck/index.ts:90-93`；探查 `facts.ts` |
| rules 型別 | SFCK 沒有匯出 view 與 hints 型別，由 SFCK-X 補上（`packages/rules/src/index.ts:81-85`、`:92-96` 已有 SF／C&K 的 `ModuleViewMap`／`ModuleHintsMap`；分支 `origin/feat/bots-sfck-exports` 已加上 `seafarersCitiesKnights` 兩項與 `SfckBandit`、`SEAFARERS_CITIES_KNIGHTS`）。SFCK-X 合併後，`sfck/index.ts` 的 `:1-138` 不動，`project` 與 `actionHints` 抽成 `projectSeafarersCitiesKnights`、`seafarersCitiesKnightsHints`（新增 `:140-171`），`bandit` 的計算搬進後者，原 `:146-170` 約下移 32 行；本計畫改以函式名稱引用 | `packages/rules/src/index.ts` |

## 4. 設計

### 4.1 BotModule 對應（`B/modules/seafarersCitiesKnights/`）

| 鉤子 | 檔案 | 內容 | 切片 |
|---|---|---|---|
| `robberTargets`（fold） | `targets.ts` | 依 `bandit` 收窄（§4.2） | SFCK-1 |
| `actions` | `chase.ts` | `knight.chasePirate` 候選（§4.5） | SFCK-2 |
| `setup` | `setup.ts` | 只攔截 setup building，依 D5 合成 base、SF 與 C&K 的分數（第 1 輪 `setupSpotScore + islandSetupBonus`；第 2 輪 `citySetupScore + islandSetupBonus`，加上 ore 或 grain 的硬篩選，不把 `setupSpotScore` 與 `citySetupScore` 相加，§4.4）；road 階段回 undefined，交給 SF | SFCK-2 |
| `rescore` | `rescore.ts` | 騎士位置的罰分（§4.4）。型別已在 `B/modules/types.ts:166`，SFCK-P 只接上骨架；C&K 的 `recruitSite` 也依它排序招募點（D2） | SFCK-2 |
| `supports` | `index.ts` | 回傳 `SFCK_BOTS_RELEASED`（SFCK-G 才改為 true）。`botsCanPlay` 會要求 `ruleModules` 中的每個 id 都已註冊，因此三個模組都必須存在（策略 §4.4、§4.9） | SFCK-1 → G |
| `pacing`、`responseCommands` | `index.ts` | `{ 'knight.chasePirate': 900 }`；沒有回應指令 | SFCK-1 |
| `duty`、`answerFrame`、`economy.*` | — | 不使用。frame 全部屬於 base、SF 或 C&K | — |

### 4.2 強盜／海盜目標：`robberTargets` fold

- **介面**：`robberTargets?(view, selfId, targets: readonly (number | null)[]): readonly (number | null)[]`。依 `profile.ruleModules` 順序 fold，比照 rules 的 `legalRobberHexes`（`engine.ts:1495-1505`）。`BanditTarget`（`number | null`）、`robberTargets`、`rescore` 的型別已在 `B/modules/types.ts:38-39`、`:165-166`，SFCK-P 只接上骨架（骨架目前沒有任何地方呼叫它們，只有 `B/base/robber.ts:50` 的 TODO）。
- **初值（「盜賊預設」）**：由平台依 `view.board.terrain` 的 index 遞增依序計算：① `terrain !== 'sea'` 且 hex 不是 `view.board.robber`（與 rules 初值相同，`engine.ts:1497`）；② `terrain === 'sea'` 且 hex 不是 `view.board.pirate`；③ `view.board.pirate !== null` 時加上 `null`。②③ 等同 `sf/pirate.ts:13-21`。首攻前 `robber = -1`，所以 ① 就是全部的陸地格。base 沒有海格、海盜為 null，所以初值與現行完全相同。
- **用途**：fold 的結果就是本次 `pending.moveRobber` 的完整合法集合，策略與保底共用。保底取第一項。策略把 base 的強盜候選（集合中的陸地項）與各模組的 `banditCandidates` 都以集合過濾後統一評分；過濾後若沒有候選，直接採用第一項（不消耗 rng；算策略的決定，不算「策略閒置」）。
- **fold 之後不再排除現位**：T&B 的 FR 可能回傳強盜目前所在的格（取代式，沒有合法格時回沙漠，即使強盜已在沙漠上），所以「排除 `view.board.robber`」只在初值做一次，fold 之後不得再排除。
- **保底路徑也會呼叫 `robberTargets`**：它只讀 view 與 hints，不得 throw、不得消耗 rng。
- **為什麼海盜目標要放在初值**：SFCK 排在 fold 的第一位。若改由 SF 在 fold 中擴大集合，SF 排在 SFCK 之後，會把 SFCK 在 `'robber'` frame 剔除的海盜目標加回來；純集合也無法區分「沒人提到海盜」與「明確禁止海盜」。海盜目標放在初值後，SF 不必參與 fold（SF 計畫不變），SFCK 只需要收窄。
- **SFCK 的 fold 步驟**（`targets.ts`）：

  | `bandit` | 回傳 | 合法的依據 |
  |---|---|---|
  | `'pirate'` | `targets` 中的海 hex 與 `null` | `sfck/index.ts:79` 拒絕陸地；chase 要求相鄰海盜，所以海盜一定在場上，集合必含 `null` |
  | `'robber'` | `targets` 中的陸地 hex | `:75` 拒絕海格與 `null` |
  | `'either'` 或 `null` | `targets` 原樣 | 兩者皆可；陸地排在前面，保底因此一律移強盜 |
- **空集合**：「base 保底遇到空集合時回 `undefined`」這條規則**不需要**。集合是完整的合法集合，為空時沒有任何模組的 duty 能做得更好；SFCK 收窄後的集合在三種 frame 中都不會是空的；T&B 的 FR 在沒有合法格時會回沙漠（`tradersBarbarians/variants/friendlyRobber.ts:34-41`）。base 保底遇到空集合時回 `null`，交給 server 的診斷與重試（策略 §4.7-4）。SFCK-1 以真值表斷言集合非空，且等於 rules 的合法集合。
- **easy**：SF easy 不提供海盜候選（SF 計畫 D-SF2），所以 `either` 時只移強盜。easy 不追擊海盜，因此不會遇到 `'pirate'` frame。

### 4.3 保底表（I9；合約規則 7）

順序：base 的 `pendingDuty(view, selfId, modules)`（`moveRobber` 取 §4.2 fold 的第一項；棄牌的 `handList` 直接依 `CARD_KINDS` 展開，不經 `cardKinds` 鉤子）→ SF 的 `duty` → C&K 的 `duty` → `turn.roll`／`turn.end`；SFCK 沒有 `duty`。下表涵蓋 SF+CK 會出現的每一種 frame 與強制動作；「探查」欄引用第一輪的 `duty-fixtures.ts`（F1–F11）與 `q2-calibrate.ts`。**這些腳本已不存在**，F1–F11 改由 SFCK-1 以 `packages/rules/test/sfck-helpers.ts`（`sfckGame`、`emptySfckGame`、`afterFirstAttack`）重建；bots 測試本來就會 import rules 的測試 helper（例如 `ck-duty.test.ts:20`）。

| frame 或強制動作 | 最小動作 | 為何必定合法 | 證據（探查） |
|---|---|---|---|
| setup building（第 1 輪聚落、第 2 輪城市） | `legalSettlements[0]` | hints 只列主島；第 2 輪仍送 `setup.placeBuilding` | `ck/index.ts:90-93`；SF 計畫 §4.1 |
| setup road（含第 2 輪城市之後） | 有 `legalRoads[0]` 時放路，否則 `setup.placeShip setupShips[0]` | 兩份清單都來自 hints；setup 不收費 | `facts.ts`：城市之後 `setupShips` 非空 |
| preroll | `turn.roll` | 不會打 Alchemy | C&K 計畫 §4.2 |
| `discard`（含 commodity，也含首攻前的 7） | 依 `CARD_KINDS` 順序展開手牌，交出前 `required[self]` 張 | 應棄張數依總牌數計算；engine 接受 CardKind | F4：base 的 `handList` 已含 commodity（`base/duty.ts:61-79`），所以 base 保底就能成功（第一輪探查時 base 被拒 `E_INVALID_DISCARD_COUNT`，CK-B1 之後已修）；之後 pending 為 null、`robber = -1` |
| `moveRobber`，`bandit='either'`（首攻後擲出 7） | 集合第一項，也就是第一個陸地非現位 hex | 陸地排在前面；SFCK 不 veto 陸地 | F3 ✓ |
| `moveRobber`，`bandit='robber'`（`knight.chaseRobber` 之後） | 集合第一項（陸地） | SFCK 已剔除海格與 `null` | F2 ✓；SF 選海盜會被拒 `E_ILLEGAL_TARGET/robber` |
| `moveRobber`，`bandit='pirate'`（`knight.chasePirate` 之後） | 集合第一項，也就是第一個非現位的海 hex | SFCK 只保留海格與 `null` | F1：base 被拒 `E_ILLEGAL_TARGET/pirate`，組合集合成功 |
| `steal`（強盜或海盜） | `candidates[0]` | 候選人由 engine 算好 | 既有 |
| `freeRoads`（Road Building 進步卡） | 道路存量 > 0 且 `legalRoads[0]` 存在時造路，否則 `legalShips[0]` | 依 SF 保底：容量包含船，`legalShips` 已扣存量 | F5：只剩船位、或 15 條路用完，都能成功 |
| `seafarers.gold`（排在 aqueduct 補牌之前） | `responders[0] === self` 時，依 `RESOURCES` 順序取 `min(bank, 剩餘)` | 依 SF 保底 | F7a ✓ |
| `citiesKnights.scienceBonus` | `science.take {resource: null}` | 依 C&K 保底；金礦 frame 結束後才輪到 | F7b ✓ |
| `citiesKnights.diplomacyRoad`（拆掉自己的船） | `{edge: null}` | 依 C&K 保底，帶 ship 時也合法；若改從 `legalRoads` 選會被拒 | F10 ✓（`cards-politics.ts:137-150`） |
| 其他 C&K frame（共 12 種）、`progressExcess` | 依 C&K 保底表 | 同 C&K 計畫 §4.2 | 本輪 76 局 0 拒絕 |
| action（含 paired P2 的 window） | `turn.end` | 保底**永遠不送** `ship.move`、`knight.*`、`knight.chasePirate` | F8、F8c、F11：naive 送這些指令時會被拒 |

**實測**：

| 對局 | 結果 |
|---|---|
| 保底席（座位 2 只走保底） | 3–6 人 × 3 種子共 12 局，全部終局、0 拒絕 |
| 全保底有界局（1500 步） | 12/12 局 0 拒絕、每一步都有動作；全保底時無法終局，因為保底不改良 |
| 第一輪 `mixed`（偶數座位只走保底） | 40/40 局終局，保底出手 6,256 次 |

### 4.4 standard 與 easy（只列組合特有的決策）

| 決策 | standard | easy | 鉤子 |
|---|---|---|---|
| `either` 時選強盜或海盜 | base 的強盜候選與 SF 的 `banditCandidates` 經 §4.2 集合過濾後統一評分。兩者同為加權點數（1 VP ≈ 1/`PIP_VALUE`，`seafarers/bandit.ts:91-106`），現況已經一致，不需要換算 | 只移強盜 | `robberTargets` |
| setup building | 攔截並依 D5 合成（**不要把 `setupSpotScore` 與 `citySetupScore` 相加**：兩者都含產能與第 2 輪的懲罰，相加會重複計算）。第 1 輪：`setupSpotScore`（base）加 `islandSetupBonus`（SF），與 SF 相同，FX-S2 因此自動成立。第 2 輪：`citySetupScore`（C&K）加 `islandSetupBonus`，並套用 `touchesOreOrGrain` 的硬篩選（複製 `citiesKnightsSetup:67-71` 的寫法：有相鄰 ore 或 grain 的合法點時只在它們之中選，一個都沒有才用全部）。road 階段回 undefined，交給 SF 決定放路或放船 | 同 standard，topK 3 | `setup` |
| 騎士位置：小島空點 | 站在自己現行島嶼計畫的建地上會擋住自己蓋房（`ck/index.ts:127-129`），三個指令分開處理。**`knight.recruit {vertex}`**：點由 `recruitSite`（`citiesKnights/defense.ts:48-55`）只選一個，同時走防禦的 actions（3.5 分）與 `KNIGHT_PLAN` 的 planStep（`plans.ts:140-150`，**planStep 不經過 `rescore`**），所以 `rescore` 改不了它；`recruitSite` 已排除 `legalSettlements` 與 `economy.plans` 全部的 `vertex`（含 SF 島嶼計畫的前 3 名），招募時的 FX-K1 不需要 `rescore` 就會通過，只要寫測試確認。**`knight.move {to}`**（`tactics.ts:98-137`）已對前 3 個計畫點給 −∞（`:54`）、對合法聚落點罰分（`:61`），而且每隻騎士只產生最佳的一個 `to`，`rescore` 只能壓低它，不能換到第二好的點。**`knight.displace {to}`**（`knights.ts:146-161`）的目標正是自己的 `plans[0].vertex`，擠過去之後自己的騎士會擋住自己蓋房，`rescore` 對這一種有實質作用。後兩者：目標是自己現行島嶼計畫的建地時，罰分等於該計畫價值 | 同 standard（避免自我阻擋，P9） | `rescore`（move、displace）；`recruitSite`（recruit，見下一列與 D2） |
| 騎士位置：船的 open end | 目標若是 SF 移船計畫中葉端船的 open end，罰 0.3 VP 當量（推測）。SF 的 `movePlans`／`shipMoves` 沒有匯出（`seafarers/actions.ts:76-103`），改以 `hints.modules.seafarers.movableShips` 的 open end 判定，不必改 SF 的檔案。`knight.move`、`knight.displace` 以 `rescore` 罰分；**`knight.recruit` 依 D2 選 (b)**：SFCK-2 可改 `citiesKnights/defense.ts` 的 `recruitSite`（只動這個函式），讓 `free` 依各模組對 `knight.recruit {vertex}` 的 `rescore` 差值總和由高到低排序，同分依原有順序、再取 vertex 較小者。沒有任何模組提供 `rescore` 的 profile（除 sf-ck 以外全部）結果必須逐位元相同：以 D1 的 ck-\* 雜湊比對加上 `BOTS_SEEDS=10` 的 `ck-game` 守住。不這樣做，「招募到自己船的 open end」就無法避免，而這正是原型釘船窗口約 14% 的主要來源 | 不罰，因為 easy 不移船（`rescore` 回 0，`recruitSite` 的順序不變） | `rescore`；`recruitSite` |
| 追擊海盜 | §4.5 的保守條件 | 不追擊 | `actions` |
| 金礦城市 | 依 §4.6 的 `hexYield` 規則：金礦城市值 2 點萬用、沒有商品；森林城市值 1 lumber 加 1 paper | 同 standard | 平台與 A5 |
| aqueduct（科學 3 級）的估值 | C&K 以常數估值（`IMPROVE_VALUE.ability.science = 0.45`，`citiesKnights/improve.ts:34`），沒有產出機率的模型，不需處理（金礦算作產出、aqueduct 不補牌，見 `sfck/index.ts:153-159`） | 同 standard | — |
| Road Building 卡、Merchant | 交給 C&K 計畫 §4.9：打牌條件看組合後的免費路線，merchant 只從 `targets.hexes` 選 | 同 standard | — |

**仲裁原則**：組合模組只調整分數（`rescore`），不新增或移除其他模組的候選，合法性仍只看 hints（P2）；防禦與追擊海盜的取捨，在 SFCK 自己的候選條件中處理（§4.5）。唯一的延伸是 D2：C&K 的 `recruitSite` 也依 `rescore` 差值排序招募點，只改變它挑哪一點，不新增或移除候選。

**easy 的取捨與 P9**：easy 造船登島（SF easy）、防禦與改良（C&K easy），加上小島空點罰分；不追擊海盜、不移船，`either` 時只移強盜。實測全 easy 20 局全部終局（3–6 人各 5 局，每局 9.7–43.8 輪），每局都有付費造船，也都有人拿到小島加分（`out/q2-alleasy.txt`）。

### 4.5 `knight.chasePirate`（SFCK-2，`chase.ts`）

**保守條件**：全部成立才產生候選，而且只限 standard。

| # | 條件 | 依據 |
|---|---|---|
| K1 | `hints.modules.seafarersCitiesKnights.pirateChase` 非空 | `sfck/index.ts:89-95` |
| K2 | 海盜 hex 至少鄰接 1 艘自己的船，或在 SF 計畫的下一條船邊上 | 解除封鎖的價值，沿用 SF 的海盜評分 |
| K3 | 蠻族距離 `threatOf(view, self).away ≥ 3`（`citiesKnights/knights.ts:78-96`，`away = length − position`） | 原型以「≥ length − 2 時不追」實測 0 拒絕、40/40 終局 |
| K4 | 追擊的騎士不在 `guardedKnights(turn)` 中（`citiesKnights/defense.ts:39-42`），而且 `!threatOf(view, self, mine − level).atRisk`（`mine` 為 `threatOf(view, self).mine`，`level` 為追擊騎士的等級）。取代原本的「等級和 ≥ 城市數」 | 騎士會倒下（`:106`）；對齊 C&K 的個人理性防禦（D-CK1） |
| K5 | 選等級最低的追擊騎士；平手時選 vertex 最小者 | P4 決定性 |
| K6 | 分數 = SF 的解除封鎖價值 + 預期偷牌 − 騎士等級 × 防禦當量 − 1 grain 的重新啟動成本，而且 > 0。單位要換算：SF 的 `pirateOptions`（`seafarers/bandit.ts:155-206`）是加權點數，候選分數是勝利分當量，所以要乘上 `PIP_VALUE`。建議寫成 `1 + PIP_VALUE × max(option.net)`（Planner 建議，常數項 1 由 SFCK-2 以 FX-C1–C6 確認），再減去騎士等級的防禦當量與 1 grain。`chaseValue(turn, hex, 'pirate')` 依設計回 0（`knights.ts:115-122`），不能直接用 | 同一尺度（換算後） |

追擊之後的 `'pirate'` frame 由 §4.2 的集合與 SF 的海盜評分處理。固定盤面 FX-C1 到 FX-C6 見 §6.3。

### 4.6 對平台與 rules 的需求；策略 §4.2 的修訂提案

| 需求 | 內容 | 落點 |
|---|---|---|
| `robberTargets` fold | 元素型別推廣為 `number \| null`；初值為完整的盜賊預設；集合同時過濾 base 的強盜候選與 `banditCandidates`；過濾後為空時取第一項 | SFCK-P（從 0.4.4 提前，§11-2） |
| `rescore?(turn, candidate): number` | 所有模組的差值相加，只調整 `actions` 候選的分數。骨架在 `buildDecision` 第 a) 步（`heuristic.ts:398-399`）去重之後的合併清單上相加；沒有任何模組提供時完全跳過（golden 不變）。簽章已在 `B/modules/types.ts:166`；C&K 的 `recruitSite` 也以它為招募點排序（D2） | SFCK-P；`B/modules/types.ts` 只改註解（步驟 0.5，併入 SFCK-P 的第一個 commit，見 §8） |
| `sea.ts` 的 `blocker` 預設值 | 改為組合後的 `economy.vertexBlocker`（C&K 的對手騎士），套用在船 BFS、船位模擬；含船的路線長度（`board.ts:367 routeLength`）已經讀 `model.blocker`，不要重複加。預設值必須用**傳入的** model：`options.blocker ?? (model.blocker ? (v) => model.blocker!(model, v) : undefined)`，`reachFrom`（`seafarers/setup.ts:97`）與 `withPirate`（`bandit.ts:84-86`）展開的假設盤面才會生效（F2，見 §7）。`shipEdgesFrom`／`roadEdgesFrom` 另加選用參數 `modules`（F9；`sea.ts` 不要 import registry，以免循環）。options 物件只增欄位，與 E&P N8（可通行性、停留限制、終止邊、成本）相容 | SFCK-P；`sea.ts` 在 0.4.3 只屬於 SFCK-P |
| rules 匯出 | `SeafarersCitiesKnightsView`、`SeafarersCitiesKnightsHints`、`SfckBandit` 型別；`SEAFARERS_CITIES_KNIGHTS` 常數；`ModuleViewMap` 的對應項。做法是把 `project`／`actionHints` 抽成具名函式（P8） | SFCK-X |
| 不需要 | 新 hints、規則修正、`moveRobber` 投影補 pirate 旗標、「首攻前海盜不活動」的掛點（首攻前不會出現 moveRobber，`pirateChase` 也為空；回答 SF 計畫 §4.3 的推測） | — |

**建議併入策略 §4.2 組合規則表的列**（`vertexBlocker`／`siteBlocked`／`hexYield` 三列 0.4.2 已實作，`board.ts:131-163`，SFCK-P 不必再做；其餘待併入）：

| 鉤子 | 組合方式 |
|---|---|
| `robberTargets` | 依 `ruleModules` 順序 fold，元素為 `number \| null`；初值為「盜賊預設」；結果是完整的合法集合，策略與保底共用 |
| `rescore` | 差值相加；不新增、不移除候選 |
| `economy.vertexBlocker`、`economy.siteBlocked` | 任一模組阻擋就算阻擋（OR）；`vertexBlocker` 的回傳值取第一個非 null |
| `economy.hexYield` | 逐 hex 依序詢問，第一個非 `undefined` 者勝；都沒有回答時用 base。模組只對自己定義產出的地形回值：C&K 只回答森林、牧場、山脈上的城市；金礦由 SF 的模型處理 |
| `setup` | 維持第一個非 undefined 者勝。若兩個以上的部件模組都會回答同一個 setup 階段，組合模組必須攔截並合成；它可以 import 部件匯出的純評分函式，不另設鉤子 |

### 4.7 節奏與每視窗上限

| 指令 | 建議 ms | 依據 |
|---|---|---|
| `knight.chasePirate` | 900 | 與 C&K 的 `knight.chaseRobber` 相同（C&K 計畫 §4.8）；之後的 `pending.moveRobber` 沿用 1200 |

- **其他指令**：沿用 SF 與 C&K 的 `pacing`，不另訂。
- **每視窗上限**：不設 `maxCommandsPerWindow`，沿用 40。逐 Bot 每視窗最多 17 個（mixed 原型）、15 個（全 easy）、18 個（第一輪全 standard）；Q1 斷言 ≤ 40，Q3 對超過 30 的情況提出警示。

## 5. 切片與 PR

PR 一律指向 `release/v0.4.3`，以 squash merge 合併。分支為 `feat/bots-sfck-<slice>`，worktree 為 `.worktrees/bots-sfck-<slice>/`。並行的切片之間，檔案所有權不重疊。行數為估計值。

| 切片 | 分支／worktree | 檔案所有權 | 內容 | src／test | 依賴 | 驗收命令 |
|---|---|---|---|---|---|---|
| **SFCK-X** rules 匯出 | `feat/bots-sfck-exports`／`.worktrees/bots-sfck-exports/` | `sfck/index.ts`（抽出具名函式）；`packages/rules/src/index.ts`；`packages/rules/test/sfck-exports.test.ts`（新） | §4.6 的匯出；形狀測試比對實際 key 集合 | 15–25／25–35 | 無 | `pnpm --filter @catan/rules exec vitest run test/sfck-exports.test.ts`；`pnpm --filter @catan/rules exec vitest run`（全綠即符合 P8）；`pnpm --filter @catan/rules typecheck`；`pnpm --filter @catan/web typecheck` |
| **SFCK-P** 平台鉤子 | `feat/bots-sfck-hooks`／`.worktrees/bots-sfck-hooks/` | `B/heuristic.ts`、`B/fallback.ts`、`B/sea.ts`、`B/base/robber.ts`、`B/base/duty.ts`（0.4.3 期間獨占）；`B/modules/seafarers/plan.ts`（1 行 `kinds`）、`B/hard/economy.ts`（1 行 `kinds`）；`B/modules/types.ts`（只改註解，步驟 0.5，併入第一個 commit，見 §8）；`packages/bots/test/sfck-hooks.test.ts`（新） | §4.2 的 fold 與過濾（落點：`base/robber.ts:45-53 banditChoice`、`base/duty.ts:16-22`，`pendingDuty(view, selfId, modules = [])` 的 moveRobber 取 fold 的第一項；`fallback.ts:33` 傳入模組清單）；`rescore` 的組合；`sea.ts` 的 blocker 預設與 F9（`shipEdgesFrom`／`roadEdgesFrom` 加選用 `modules`）；F1（`etaRounds` 補傳 `kinds`：`plan.ts:94`、`hard/economy.ts:49`，沒有 C&K 時 `kinds` 就是 `RESOURCES`，所以 sf／base 的 golden 不變） | 50–90／90–130（行數未依刷新重估） | 0.4.2 stable | `pnpm --filter @catan/bots exec vitest run test/sfck-hooks.test.ts`（假模組：fold 的順序、初值、過濾、`rescore` 相加）；golden：D1 的決策雜湊前後比對（`fc6b3b5` 對 PR head，base 3–6 人 × 10 種子加上 sf-\*、ck-\* 各 3 種子，每個雜湊必須相同，表附在 PR 本文，不提交 fixture）；`pnpm --filter @catan/bots typecheck` |
| **SFCK-1** 組合模組 | `feat/bots-sfck-module`／`.worktrees/bots-sfck-module/` | `B/modules/seafarersCitiesKnights/{index,view,targets}.ts`（新）；registry 一行（`registry.ts:7-12`）；`packages/bots/test/sfck-duty.test.ts`（新）；`packages/bots/test/support.test.ts`（`:22`、`:52-61`、`:92-114`） | 註冊；`supports` 回 false；`robberTargets`；`pacing`；F1–F11 的 I9 固定盤面（以 `rules/test/sfck-helpers.ts` 重建）；三種 `bandit` 在 3、4、6 人地圖上的真值表（集合 = rules 合法集合，且非空）；`supports` 測試（缺任一模組就不開放）。`support.test.ts`：一註冊模組，`:57` 就會失敗，加了 pacing 會讓 `:94-95` 失敗，定義 `robberTargets` 會讓 `:78` 失敗，所以由 SFCK-1 改：`:22` 的 `RESERVED_HOOKS` 移除 `robberTargets`（建議一併移除 `rescore`）、`:52-61` 改為「已註冊但 `supports` 回 false」、`:94-95` 納入新的 pacing | 60–90／200–260 | 開發：SFCK-X 的型別（可先用本地型別）；合併：SFCK-P、SFCK-X 之後 | `pnpm --filter @catan/bots exec vitest run test/sfck-duty.test.ts`；`pnpm --filter @catan/bots exec vitest run`；`pnpm --filter @catan/bots typecheck` |
| **SFCK-2** 組合策略 | `feat/bots-sfck-strategy`／`.worktrees/bots-sfck-strategy/` | `B/modules/seafarersCitiesKnights/{chase,setup,rescore}.ts`（新）與 `index.ts` 的掛接；`B/modules/citiesKnights/defense.ts`（D2：只動 `recruitSite`）；`packages/bots/test/sfck-strategy.test.ts`（新）。SF 與 C&K 的 `setup.ts` 不必動（A4 成立），`plan.ts` 也不必動（A5 實作在平台的 `economy.ts`） | §4.4、§4.5；FX-C、FX-S、FX-K、FX-G、FX-B | 180–260／200–260（行數未依刷新重估） | SFCK-1 | `pnpm --filter @catan/bots exec vitest run test/sfck-strategy.test.ts test/sf-decisions.test.ts test/sf-frames.test.ts test/ck-decisions.test.ts`（`citySetupScore` 在 `ck-decisions`，`seafarersSetup` 在 `sf-frames`）；`pnpm --filter @catan/bots typecheck`；動到 `recruitSite`（D2），另跑 D1 的 ck-\* 決策雜湊比對與 `BOTS_SEEDS=10 pnpm --filter @catan/bots exec vitest run test/ck-game.test.ts` |
| **SFCK-3** 驗收測試 | `feat/bots-sfck-tests`／`.worktrees/bots-sfck-tests/` | `packages/bots/test/modules/seafarersCitiesKnights.ts`（新）：family 測試明列 `[seafarersKit, citiesKnightsKit, sfckKit]`，SF／C&K 既有的守恆、`hideDifferently`、`responseCommands` 檢查與擾動由各自的 kit 提供；SFCK kit 只補組合特有的不變量、擾動修補（首攻前狀態）與計數，不再次呼叫部件 kit；SFCK 的 `perturb` 最後執行，修補首攻前狀態，再加上海盜位置、首攻前後與船端騎士的擾動（SFCK 沒有回應指令）；`mechanics` 逐步累計 `events`。另有 `test/sfck-game.test.ts`、`sfck-fair.test.ts`、`sfck-fuzz.test.ts`、`sfck-fallback.test.ts`（新）；`packages/bots/test/harness.ts`（`PROFILE_LIMITS` 兩筆：6000 步、72 次擲骰；沒有項目時會套用預設的 5000 步、60 次擲骰，bench 也讀這裡）；`packages/bots/test/families.ts`（`BOT_FAMILIES` 一筆 family）；`packages/bots/bench/run.ts`（**一定要改**：`BENCH_KITS` `:52`、`RULES_SIM_ROUNDS` `:64-69`） | §6.1 的 Q1 矩陣、§6.2 的 Q2；family 明列兩個 profile（策略 §4.6；profile id 寫成單引號字面值，`families.ts:14-21`） | 0／300–385（行數未依刷新重估） | 開發：SFCK-1；合併：SFCK-2 之後 | `BOTS_SEEDS=3 pnpm --filter @catan/bots exec vitest run test/sfck-game.test.ts test/sfck-fair.test.ts test/sfck-fuzz.test.ts test/sfck-fallback.test.ts`；`BOTS_SEEDS=10 pnpm --filter @catan/bots exec vitest run test/sfck-game.test.ts`；回報 `longestStagnation`（D4）。**bench 不在此驗收**（`bench --profile sf-ck-…` 在 SFCK-G 之前會被 `botsCanPlay` 擋下，D6）：移到 §8 步驟 4 的 QA；SFCK-3 可在本地暫時翻開 gating 跑 bench 做校準，不提交 |
| **SFCK-G** 開放 gating | `feat/bots-sfck-gate`／`.worktrees/bots-sfck-gate/` | `modules/seafarersCitiesKnights/index.ts`（`SFCK_BOTS_RELEASED = true`）；`packages/bots/test/support.test.ts`（`:52-61` 與快照 `:64-73` 加入兩個 id）；server 測試：`packages/server/test/seafarers-cities-knights.test.ts:148-162`（翻轉；`:152` 斷言 botSeats 為 `[false,false]`、`:161` 斷言 `E_INVALID_BOT`）、`bots.test.ts:289-294`（sf-ck 的 botSeats）、`:304-307`（`levels('sf-ck-new-shores-2025')`）與 `:378-399`（整個「still refuses bot seats」測試以 sf-ck 為例，改用其他不支援的 profile，例如 `ep-land-ho-2025`）、`rooms.test.ts:218-220`（`botSeats: false`）；`packages/server/test/seafarers-cities-knights-bots.test.ts`（新；既有慣例是 `seafarers-bots.test.ts`、`cities-knights-bots.test.ts`）；§7.1 的文件；截圖（D3，待使用者決定） | gating；server 四類案例（策略 §4.7-5），加上拒絕 hard 的案例（比照 C&K：`E_INVALID_BOT`／`profileLevel`）；文件 | 5–10／150–200；docs 40–60（行數未依刷新重估） | SFCK-3 | `pnpm --filter @catan/bots exec vitest run test/support.test.ts test/sfck-game.test.ts`；`pnpm --filter @catan/server exec vitest run test/seafarers-cities-knights.test.ts test/seafarers-cities-knights-bots.test.ts test/bots.test.ts test/rooms.test.ts`；`BOTS_SEEDS=10 pnpm verify` |

- **合計**：src 310–475，test 965–1,270，docs 40–60，總計約 1,315–1,805 行。比第一輪的 1,130–1,650 略高，因為 server 四類案例與組合測試工具都算在本版內（D1 的決策雜湊比對在 scratch 進行、不提交，不計入）。
- **commit subject**（squash 後附 `(#N)`）：X `✨ feat(rules): export seafarers cities knights hint types`；P `✨ feat(bots): fold bandit targets and rescore candidates`；1 `✨ feat(bots): add the seafarers cities knights module`；2 `✨ feat(bots): chase the pirate and combine setup scores`；3 `🧪 test(bots): gate seafarers cities knights bot games`；G `✨ feat(bots): play new shores with cities & knights`。

### 5.1 階段

| 階段 | 並行開發 | 合併順序 | 備註 |
|---|---|---|---|
| A | SFCK-X ∥ SFCK-P ∥ SFCK-1 | X、P，然後 1 | X 只動 rules；P 只動共用檔；1 只動新目錄、新測試與 `support.test.ts`（P 沒有註冊模組，不會觸發守門測試；SFCK-G 之後再改同一個檔，兩者依序合併，沒有並行重疊） |
| B | SFCK-2 ∥ SFCK-3 | 2，然後 3 | 3 修改新測試檔、SFCK kit、`harness.ts` 的 `PROFILE_LIMITS`、`families.ts` 與 bench；與 SFCK-2 的檔案所有權不重疊 |
| C | SFCK-G | — | gating、server 與文件集中在這一個 PR |
| D | 發布 QA、Browser QA、rc | — | §7.2 |

### 5.2 依賴與 CK-C（已交付）

- **硬依賴**：SF 的 RX、SF-1（`sea.ts`、duty）、SF-2a（島嶼計畫）、SF-2b（`banditCandidates`、setup）、SF-3（測試工具）；C&K 的 CK-A、CK-B1（經濟、duty、掛點）、CK-B2（策略、setup、`knights.ts` 匯出）；平台 PL-1 到 PL-3。以上全部已在 0.4.1／0.4.2 交付（§2.1）。
- **不依賴**：CK-G、SF-4 的 gating 翻轉只影響各自的 profile。
- **CK-C 已在 0.4.2 交付**（#158，`1c91cce`：`B/modules/citiesKnights/{cards-interactive,preroll,tactics}.ts`），不再需要退路與並行協調。`tactics.ts` 的 `knight.move` 候選會經過 SFCK 的 `rescore`（§4.4）。M8 只計 ck-\* 的格子。

## 6. 測試與驗收

### 6.1 Q1 矩陣（發布閘門）

| 家族 | profile × 人數 | 座位 | 種子（預設／發布） | 步數上限 | 看門狗 N | 斷言 |
|---|---|---|---|---|---|---|
| B-GAME | `sf-ck-new-shores-2025` × 3、4（`fixed`）；`sf-ck-new-shores-paired-2025` × 5、6（`variable`） | `mixedLevels`（`(index + seed) % 2`，`packages/bots/test/harness.ts:138-140`），仿 BotDriver | 1–3／1–10 | 6000 | 72 次 `turn.roll`（每回合一次）沒有任何玩家的公開分數創新高 | 有勝者；0 拒絕；沒有殘留 pending；守恆（資源 19×5／24×5；commodity 36／54；進步卡 54；路與船各 ≤ 15；騎士、城牆）；0 次「策略閒置、但保底有動作」；每視窗每座位 ≤ 40；非行動者只送 `responseCommands` |
| 保底席 | 同上 | 座位 2 只走保底 | 種子 1 | 6000 | 72 | 同 B-GAME |
| 全保底有界局 | 同上 | 全部座位只走保底 | 種子 1 | 1500（不要求終局） | — | 0 拒絕；每一步都有動作 |
| B-POLICY 決定性 | 4 人、6 人 | mixed | 4 人種子 3、6 人種子 4 | 6000 | 72 | 重播兩次，指令序列逐一相同 |
| B-FAIR | 4 人、6 人 | standard、easy | 61、62 | — | — | 取樣必須包含三種 `bandit` frame、gold frame，以及有騎士相鄰海盜的 action；投影相同 → 決策相同 |
| fuzz | 4 人、6 人 | standard、easy、fallback | 各 150 個擾動狀態 | — | — | 不拋錯；指令被接受，或回 null 且確實不欠動作 |
| B-POLICY-SEA+K | 3–6 人 | — | B-GAME 每 5 步取樣一次 | — | — | `sea.ts` 的船位與含船的路線長度（含騎士 blocker）等於 hints 與 `longestRoadLength`（第一輪 8,353 次比對、0 次不一致）。要用帶模組的 `shipEdgesFrom(view, id, options, modules)`（F9）；不帶 `modules` 時它自建沒有模組的 model，看不到騎士 |

**依據（實測，`q2-calibrate.ts`）**：

| 項目 | mixed 40 局 | 全 easy 20 局 | 保底席 12 局 | 全保底 12 局 |
|---|---|---|---|---|
| 終局 | 40/40 | 20/20 | 12/12 | 皆到 1500 步上限（依設計不要求終局） |
| 拒絕 | 0 | 0 | 0 | 0 |
| 步數 | 3p 324–633、4p 431–1182、5p 477–1028、6p 581–1204 | 293–1132 | 238–888 | — |
| 最長「無人分數創新高」 | 10.3 回合（41 次擲骰） | 7.7 回合 | — | — |
| 逐 Bot 每視窗最大指令數 | 17 | 15 | 14 | — |

- **步數上限 6000**：第一輪全 standard、不打卡的版本最多 2,004 步；6000 約為它的 3 倍，也與 C&K 一致。`runBotGame` 支援 `maxSteps`，但 bench 走 `limitsFor`（`harness.ts:231-233`），所以 sf-ck 要在 `PROFILE_LIMITS`（`:222-229`）加兩筆（SFCK-3，§5）。
- **看門狗 N = 72 次 `turn.roll`**（D4）：沿用 C&K 計畫（混席實測 36 回合的 2 倍）。harness 的看門狗計的是 `turn.roll` 次數，也就是每一個回合恰好一次（`createWatchdog` `harness.ts:251-275`、計數處 `:588-596`；C&K 的 `PROFILE_LIMITS` 註解 `:226` 同義；paired 只有 Player 1 擲骰）。原型最長 41 次擲骰，72 約為它的 1.8 倍；C&K 的真實策略最長 27 次，所以 72 應該夠用。原稿說「72 回合約為本輪最大值（10.3 輪）的 7 倍」是以**輪**計算，單位不同，已更正。維持 `watchdogRolls: 72`；SFCK-3 回報 `longestStagnation`，超過約 50 次擲骰時提報。以回合而不是步數計，是因為失去城市會讓分數下降（C&K 計畫 X6）。

### 6.2 Q2 門檻（發布閘門；只計策略席位）

數據來自 `q2-calibrate.ts mixed`：每格 10 局。原型偏弱（只在沒有聚落點時才造船），正式策略應不低於它。SFCK-3 先以 `BOTS_SEEDS=10` 確認，達不到時回報主 agent，不自行降低門檻。

| # | 指標 | 3 人 | 4 人 | 5 人 | 6 人 | 預設 3 種子 | 實測（3／4／5／6） | 性質 |
|---|---|---|---|---|---|---|---|---|
| S1 | 至少有一次付費 `build.ship` 的局數 | ≥ 9/10 | ≥ 9/10 | ≥ 9/10 | ≥ 9/10 | 3/3 | 10／10／10／10 | 實測 |
| S2 | 有人拿到小島加分的局數 | ≥ 6/10 | ≥ 5/10 | ≥ 8/10 | ≥ 8/10 | 3–4 人 ≥ 1/3；5–6 人 ≥ 2/3 | 8／6／10／10 | 實測（下限） |
| S3 | standard 席與 easy 席各自有付費造船的局數（每個 profile 合計 20 局） | 各 ≥ 12/20 | | 各 ≥ 12/20 | | 不檢查 | 3–4 人：std 17、easy 13；5–6 人：20、19 | 實測 |
| S4 | 由策略送出 `gold.choose` 的局數（每個 profile 合計 20 局） | 不設門檻（改由 FX-G1） | | ≥ 6/20 | | 不檢查 | 3–4 人 2/20；5–6 人 11/20 | 實測 |
| C1 | `knight.recruit`、`knight.activate` | 每局各 ≥ 1 | 同 | 同 | 同 | 同 | 每局最少：招募 2／6／3／7，啟動 7／22／9／26 | 實測（沿用 C&K 的 M1） |
| C2 | 桌上最高改良等級 ≥ 3 的局數 | ≥ 7/10 | ≥ 9/10 | ≥ 9/10 | ≥ 9/10 | 3–4 人 ≥ 2/3；5–6 人 3/3 | 8／10／10／10 | 實測（改寫 C&K 的 M2，G-SC8） |
| C3 | `progress.play` | 每局 ≥ 3 | 同 | 同 | 同 | 同 | 每局最少 10／18／10／22 | 實測（沿用 M3） |
| C4 | 守住蠻族（每格合計） | ≥ 2 | ≥ 2 | ≥ 2 | ≥ 2 | 不檢查 | 32／37／26／27 | 實測（沿用 M4） |
| C5 | 終局時持有的大都市（每格合計） | ≥ 5 | ≥ 5 | ≥ 5 | ≥ 5 | 不檢查 | 8／21／17／23 | 實測（沿用 M6） |
| X1 | `knight.chasePirate` | **固定盤面守門**：FX-C1 中 standard 必須追擊；FX-C2–C6 中不追擊 | | | | 每次都跑 | sim 只有 1/40 局（第一輪全 standard 6/40） | sim 覆蓋不到 |
| X2 | 金礦城市 | **固定盤面守門**：FX-G2 中 standard 升級金礦聚落，加上估值單元測試 | | | | 每次都跑 | sim 0/40 | sim 覆蓋不到 |
| X3 | `either` 時移海盜 | **固定盤面守門**：FX-B3 中 standard 在海盜較好時移海盜，easy 只移強盜 | | | | 每次都跑 | 3–4 人 0/20；5–6 人 5/20 | sim 不穩定 |

- **不套用到 sf-ck 的 C&K 門檻**：M5（失城率）、M7（F1 卡種）、M8（CK-C）。卡片策略與 C&K 相同，由 ck-\* 的格子守門；這些指標在 sf-ck 只列入 Q3。
- **SF 的 Q2-5**（`ship.move`）在 sf-ck 也只列入 Q3：釘船讓移船更少見，原型也不移船。
- X1–X3 偏離策略 Q2「全部種子合計」的定義，見 §11-4。
- **計數來源**（SFCK-3）：C2 用 `maxImprovementLevel`、C5 用 `metropolisCount`（都已匯出，`test/modules/citiesKnights.ts:540`）。X1 的 Q3 計數可以直接讀 CK kit 的 `citiesKnights.cmd.knight.chasePirate`：CK kit 的 regex `knight\.`（`citiesKnights.ts:556`）會自動計入它；`sfck.knightChasedPirate` 事件因為不是 `ck.` 開頭而不會被計入，要由 SFCK kit 自己計。

### 6.3 固定盤面（I9 與 Q2 守門；fallback、standard、easy 各驗一次）

| 組 | 案例 | 斷言 |
|---|---|---|
| F1–F11（SFCK-1） | 第一輪 `duty-fixtures.ts`（已不存在）的盤面，由 SFCK-1 以 `rules/test/sfck-helpers.ts` 重建：海盜追擊、強盜追擊、`either`、首攻前含 commodity 的棄牌、Road Building 只剩船位或道路用完、金礦 frame 接著 aqueduct、騎士釘船（自己的與對手的）、merchant 不放金礦、Diplomacy 重建船、全海路口不能招募 | 保底與策略的指令都被 `applyCommand` 接受；F1、F2 另外斷言 SF＋C&K 的 naive 選擇會被拒（防止回歸） |
| 真值表（SFCK-1） | 3、4、6 人地圖 × 三種 `bandit` | fold 集合等於 rules 的合法集合，且非空 |
| FX-C1–C6（SFCK-2） | C1：K1–K6 全部成立 → 追擊；C2：蠻族距離 2；C3：追擊後防禦不足；C4：海盜沒有碰到自己的船；C5：首攻前（hint 為空）；C6：easy | 只有 C1 送 `knight.chasePirate`。C1 之後的 `'pirate'` frame 由策略與保底各自選出合法海格 |
| FX-S1–S2（SFCK-2） | S1：第 2 輪城市點 A 的點數略高，點 B 的 commodity 較多；S2：第 1 輪的沿岸點 | S1 選 B，證明 C&K 的城市評分有生效（D5：第 2 輪用 `citySetupScore + islandSetupBonus`，並斷言 ore 或 grain 的硬篩選，不重複計入產能）；S2 的島嶼加權與 SF 單獨時相同（第 1 輪是 `setupSpotScore + islandSetupBonus`） |
| FX-K1–K2（SFCK-2） | K1：招募點中有一個是自己的小島計畫建地；K2：移動目標是葉端船的 open end；另含一個招募點是自己船的 open end 的案例（D2，`recruitSite` 依 `rescore` 排序） | standard 都避開；easy 在 K1 避開、K2 不避開。K1 預期不需要 `rescore` 就會通過（`recruitSite` 已排除計畫點），要寫測試證明；沒有 `rescore` 提供者的 ck-\* 的招募順序不變（D1、D2） |
| FX-G1–G2（SFCK-2） | G1：3–4 人局策略回答 gold frame；G2：金礦聚落與森林聚落都可升級 | G1 選最缺的資源；金礦城市估值 = 2 點萬用、0 commodity；G2 中金礦分數較高時選金礦 |
| FX-B3（SFCK-2） | 首攻後擲出 7，海盜目標可偷的對手比強盜目標多 | standard 移海盜，easy 移強盜 |

### 6.4 Q3 bench（只報告、不擋發布）

| 項目 | 內容 |
|---|---|
| 設定 | `--profile sf-ck-new-shores-2025` 3、4 人；`--profile sf-ck-new-shores-paired-2025` 5、6 人。每組 100 局，種子從 10000 起，standard 依局數輪換座位。**gating 前跑不動**：`bench/run.ts:109-113` 會用 `botsCanPlay` 擋下，所以 bench 在 SFCK-G 之後的 QA（§8 步驟 4）執行（D6）；SFCK-3 校準時可在本地暫時翻開 gating，不提交（0.4.2 的做法，見 `docs/aegis/work/2026-11-11-bots-cities-knights.md:60`） |
| 對局 | ① 1 standard 對其餘 easy；② 1 standard 對其餘 naive（base 策略加上各模組 `duty`）；③ 全 standard；④ 全 easy |
| 指標 | 勝率與公平份額；平均回合，並與 naive 及 rules 腳本模擬對照（第一輪 8 局 13–106 回合；`packages/rules/test/sfck-sim.ts:136 simulateSeafarersCitiesKnights`，SFCK-3 以種子 10000–10019 實測並填入 `RULES_SIM_ROUNDS`）；平均指令數與每視窗最大指令數；decide 的平均與最大；保底次數與拒絕數 |
| 機制計數 | 造船、移船、小島加分、gold 張數、金礦城市、追擊海盜、`either` 時兩種盜賊各移幾次、自己的騎士釘住自己船的窗口數、騎士站在自己計畫小島空點的窗口數、守住與失守、各等級的失城數、大都市 |
| soft target（推測） | ① standard 勝率 ≥ 1.3 × 公平份額；② ≥ 公平份額 + 10 pp |
| | 平均回合：3 人 ≤ 40、4 人 ≤ 38、5 人 ≤ 24、6 人 ≤ 23（mixed 實測 33.6／30.9／19.2／18.6 的約 1.2 倍） |
| | 每視窗最大指令數 ≤ 20；乾淨機器上 decide 最大 ≤ 50 ms；拒絕與策略閒置都是 0；釘船窗口比例低於第一輪的 14% |

- **#135**（SF standard 在 3–4 人對 naive 時未達 Q3 soft target，OPEN）不在本版的切片內；sf-ck 的 soft target ② 在 3–4 人可能重現。Q3 表要引用 #135，不作為阻擋條件。

### 6.5 時間預算（參考值）

mixed 每局 0.6–1.0 s（load 0.5–1.2）。預設 3 種子是 12 局 B-GAME，再加保底席與全保底各 4 局，CPU 約 15–20 s；發布 10 種子約 40 s。分成 4 個檔案平行執行，timeout 120 s（策略 §4.6）。

## 7. 文件與發布

### 7.1 文件更新（SFCK-G；行號以 `fc6b3b5` 為準，2026-11-12 由 Planner 刷新）

| 位置 | 修改 |
|---|---|
| `docs/SPEC.md:190` | 「Today that is …」加入 `sf-ck-new-shores-2025`、`sf-ck-new-shores-paired-2025`。`:191`（hard 只在沒有 rules module 的 profile 提供）不改 |
| `docs/SPEC.md:294` | 「engine `sf-ck-2025.1`, enabled for human seats」改為人類與 easy／standard Bot 都可入座 |
| `docs/SPEC.md:320` | 「like the Cities & Knights rows they accept human seats only (bot seats are refused)」——**這句在 0.4.2 就過時了**（C&K 已開放）。整句改寫，例如「Since v0.4.3 every row offers easy and standard bot seats.」 |
| `docs/API.md:148-158` | 更新「Today…」清單（`:151-155`）：加入 sf-ck 的兩個 id，刪除「including Seafarers with Cities & Knights」子句 |
| `docs/API.md:573` | 刪除「human seats only」，比照 `:482` 補一句：`botSeats: true`、`botLevels: ['easy','standard']`，hard 回 `E_INVALID_BOT`／`profileLevel` |
| `docs/FIDELITY.md:43-44` | 兩列的「human seats only」改為「easy and standard bot seats」 |
| `docs/FIDELITY.md:67` | 「Bot seats are refused (`E_INVALID_BOT`): the combined `seafarersCitiesKnights` layer has no bot module yet.」改為比照 `:65` 的 SF／C&K 寫法，列出 bot 閘門（Q1／Q2、server 測試） |
| `docs/FIDELITY.md:140` | R-COMB service 的「bot seats refused」改為「easy and standard bot seats, hard refused」；證據加上新的 server 測試（`seafarers-cities-knights-bots.test.ts`）與 `bots.test.ts` |
| `docs/FIDELITY.md:140` 與 `:141` 之間 | 新增 `R-COMB bots` 列：B-GAME、B-FAIR、S1–S4、C1–C5、X1–X3；證據為 `packages/bots/test/sfck-*.test.ts`。順序比照 R-CK（service `:127` → bots `:128` → client `:129`） |
| `docs/FIDELITY.md:566-568` | 刪除「bots cannot take a combined seat」 |
| `docs/FIDELITY.md:667-668`（Known gaps #15） | 「Only Heading for New Shores is combined, with human seats only.」刪除「with human seats only」，或改為「easy and standard bots」 |
| `README.md:178-179` | 「Bot seats are not offered for this combination.」比照 `:171` 改為「Easy and standard computer opponents can be added.」 |
| `docs/aegis/specs/2026-11-01-bot-opponents.md:16-19`（支援清單） | 在 `:19`（0.4.2 的 C&K）之後加「0.4.3 起加上 `sf-ck-new-shores-2025`（3–4 人）與 `sf-ck-new-shores-paired-2025`（5–6 人）。策略與保底見本計畫」 |
| 同上 §5 規則 7（`:141-154`） | `:146`「自己要移動強盜：第一個非目前強盜格、非海洋的格子」改為「fold 集合的第一項（base 就是第一個非目前強盜格的陸地格）」；`:154` 只有 SF 的指引，之後補 C&K（C&K 計畫 §4.2）與 SF+CK（本計畫 §4.3）的指引 |
| `docs/screenshots/seafarers-cities-knights/README.md:21`、`lobby-combined.png` | 說明「電腦對手尚未支援這個規則組合。」在 SFCK-G 之後會過時；去向依 D3（使用者決定） |
| `docs/aegis/work/<date>-bots-seafarers-cities-knights.md`（新）、`docs/aegis/INDEX.md` | 工作紀錄（Q1、Q2、Q3 表與探查結論）與索引列（比照 `INDEX.md:8`） |

- `docs/aegis/work/2026-11-02-seafarers-cities-knights.md:356` 是歷史紀錄，**不改**。
- 大廳文案在 0.4.1 已改，本版不動。

### 7.2 發布（策略 §7）

1. v0.4.2 stable 發布後，從 `master` 建立 `release/v0.4.3`（2026-11-12 已建立，起點 `fc6b3b5`），各 PR 依 §5.1 的順序合併。
2. SFCK-G 合併後，QA 執行 `BOTS_SEEDS=10 pnpm verify` 與 §6.4 的 bench（bench 在 gating 開放後才跑得動，D6），把 Q3 表附在發布 PR。
3. 在 release 分支直接 push `🔖 release: v0.4.3-rc.1`，用 rc 映像試玩。
4. Browser QA：`sf-ck-new-shores-2025` 4 人房加入 1 easy、1 standard 後開局，觀察數個 Bot 回合，至少看到造船、招募或啟動騎士、`city.improve`、小島聚落或首攻後的盜賊選擇，而且沒有停住；`sf-ck-new-shores-paired-2025` 6 人房再驗證一次，包含 P2 的 window。追擊海盜在試玩中很少見，不列為必看項目，由 FX-C1 保證。截圖政策**待使用者在 SFCK-G 決定**（D3）：提案比照 CK-G（E-9，使用者 2026-11-11 決定）——PR 證據放 `pr-assets` 分支的 `pr-<N>/`，再新增或重拍 `docs/screenshots/seafarers-cities-knights/lobby-*.png`，同步更新該 README `:21`（「電腦對手尚未支援這個規則組合。」會過時）；原稿「放在 `.tmp/`，不提交（D10）」在使用者決定前不採用。
5. stable：開 PR `release/v0.4.3 → master`，以 merge commit 合併；在 master 建立 `🔖 release: v0.4.3`、打 tag，並以 `scripts/release-notes.sh` 加上 `scripts/release-notes-lint.sh` 產生 notes。tag 與 Release 只在使用者授權後執行。

## 8. Paseo 分工

派工前以 `list_profiles` 的結果為準。

| 順序 | 工作 | 角色 | 隔離 | 審查 |
|---|---|---|---|---|
| 0 | 依 0.4.2 合併後的程式刷新本計畫：核對 A1–A5 與 §7.1 的行號 | Planner | 共用工作區（唯讀） | 主 agent（**已完成**，2026-11-12，見 §12） |
| 0.5 | `B/modules/types.ts` **只改註解**（簽章已就位：`BanditTarget`、`robberTargets`、`rescore` 在 `:38-39`、`:165-166`）：把兩個鉤子從「只保留型別，骨架不呼叫」區塊移到「0.4.3 實作」區塊並寫明語意，`rescore` 另加 D2 的一句（「C&K's `recruitSite` also orders recruit sites by it (ties keep the existing order).」）。併入 SFCK-P 的第一個 commit，SFCK-P 為此擁有 `types.ts`；`support.test.ts` 的 `RESERVED_HOOKS` 清理屬於 SFCK-1 | Implementer（Backend）乙（SFCK-P） | `.worktrees/bots-sfck-hooks/` | Architect（T&B 的 FR 與 E&P N8 的相容性 Planner 已核對為相容，§12；Architect 只確認語意） |
| 1 | SFCK-X | Implementer（Backend）甲 | `.worktrees/bots-sfck-exports/` | Reviewer（Opus），輕量：只看行為是否不變 |
| 1′ | SFCK-P，與 1 並行 | Implementer（Backend）乙 | `.worktrees/bots-sfck-hooks/` | Architect 看語意；Reviewer（Sol）看 D1 的決策雜湊比對表與 I9 |
| 1″ | SFCK-1，與 1、1′ 並行開發 | Implementer（Backend）丙 | `.worktrees/bots-sfck-module/` | Reviewer（Opus）：I9、真值表 |
| 2 | SFCK-2，延續 SFCK-1 的脈絡 | Implementer（Backend）丙 | `.worktrees/bots-sfck-strategy/` | Reviewer（Sol）：分數尺度、決定性、B-FAIR |
| 2′ | SFCK-3，與 2 並行 | QA（只改測試） | `.worktrees/bots-sfck-tests/` | Reviewer（Opus） |
| 3 | SFCK-G；文件由主 agent 處理；截圖政策先問使用者（D3） | Implementer（Backend）甲 | `.worktrees/bots-sfck-gate/` | Reviewer（Sol） |
| 4 | `BOTS_SEEDS=10` 的 Q1／Q2 矩陣與 bench（`bench --profile sf-ck-…` 在 SFCK-G 之後才跑得動，D6） | QA | 自己的 worktree | 主 agent |
| 5 | rc 的瀏覽器驗證 | Browser QA | 共用工作區 | 主 agent |
| 6 | rc 與 stable 的 tag、Release | Release Manager（需要使用者明確授權） | — | — |

- **共用檔**：`B/{heuristic,fallback,sea}.ts`、`B/base/{robber,duty}.ts` 在 0.4.3 只屬於 SFCK-P。SFCK-2 在 SF 與 C&K 的檔案中只能改 `citiesKnights/defense.ts` 的 `recruitSite`（D2；SF 與 C&K 的 `setup.ts` 已匯出所需函式，不必動）；需要其他改動時，先回報主 agent。
- **限制與閒置**：subagent 不 push、不改 lockfile；對合約有疑義時回報主 agent，不自行修改。閒置的 agent 把交接筆記寫到 `.worktrees/_handoff/` 後停止。

## 9. 風險

| # | 風險 | 對策 |
|---|---|---|
| R-SC1 | fold 的初值納入海盜目標，可能與 T&B（0.4.4）或 E&P（0.4.5）的假設衝突 | T&B 地圖沒有海格，E&P 沒有強盜（Planner 已核對相容，§12）；Architect 在步驟 0.5 審查；D1 的決策雜湊比對擴大到 sf-\*／ck-\* |
| R-SC2 | `either` 時強盜與海盜候選的分數尺度不一致（策略 §5） | 同一尺度；FX-B3；Q3 記錄兩種盜賊各移幾次 |
| R-SC3 | SF 或 C&K 的實作與 A1–A5 不同 | 步驟 0 已刷新（2026-11-12）：A1–A5 全部成立，SFCK-2 不必補 `export`，A5 實作在平台的 `economy.ts` |
| R-SC4 | 追擊海盜、金礦城市在 sim 中幾乎不出現 | X1、X2 以固定盤面守門；Q3 列出計數 |
| R-SC5 | Q2 門檻出自偏弱的原型；4 人局小島加分只有 6/10 | 以下限為門檻；SFCK-3 實測確認；只能由使用者調整（D-SC5） |
| R-SC6 | 保底被確定性地拒絕，造成無限退避（第一輪 naive 4/40 局） | §4.2 的完整合法集合；真值表；F1、F2 |
| R-SC7 | CK-C 與本版耦合 | **已解決**：CK-C 已在 0.4.2 交付（#158），§5.2 |
| R-SC8 | 測試時間 | 預設 3 種子；拆檔；timeout 120 s |
| R-SC9 | `rescore` 被誤用為合法性過濾 | 介面註明只調分數；審查清單 |
| R-SC10 | 單局步數受 load 影響的量測 | 結論只依步數與局數；耗時在實作階段重量 |

## 10. 待使用者決定的事

| # | 決策 | 建議 |
|---|---|---|
| D-SC1 | 強盜／海盜目標的介面 | `robberTargets` fold，元素推廣為 `number \| null`，初值為完整的盜賊預設；SFCK 只收窄；不新增 `banditTargets`（§4.2） |
| D-SC2 | 把 fold 從 0.4.4 提前到 0.4.3，並新增 `rescore` 鉤子 | 同意。fold 是 SF+CK 合法性的前提。`rescore` 只影響品質；若不同意，SFCK-2 去掉騎士位置罰分，該項只列入 Q3（`rescore` 對 `knight.recruit` 的延伸見 D2） |
| D-SC3 | setup 與 `hexYield` 的組合規則 | 依 §4.6 修訂策略 §4.2（第 2 輪 setup 的合成公式見 D5） |
| D-SC4 | gating | 依 `botsCanPlay` 加上 `SFCK_BOTS_RELEASED`；缺任一模組就不開放（SFCK-1 測試） |
| D-SC5 | Q2 門檻 | 採用 §6.2 的 S1–S4、C1–C5、X1–X3 |
| D-SC6 | 追擊海盜的積極度 | 保守（K1–K6），只限 standard |
| D-SC7 | easy | 造船、防禦、改良；`either` 時只移強盜；不追擊、不移船；套用小島空點罰分 |
| D-SC8 | 節奏與上限 | `knight.chasePirate` 900 ms；上限維持 40 |
| D-SC9 | rules 匯出（SFCK-X） | 同意（P8） |
| D-SC10 | `packages/rules/test/sfck-sim.ts:144-151` 從 `result.state.log` 計數，受 200 筆上限影響（`engine.ts:123`、`:258`），長局會少算 | **已解決**：#98 已於 2026-11-05 關閉，由 `f4b6520`（#108）修正；不併入本版切片。Bot 的 `mechanics` 本來就逐步累計 `events` |
| D-SC11 | CK-C 的處理 | **已解決**：CK-C 已在 0.4.2 交付（#158，`1c91cce`），§5.2 |
| D-SC12 | `moveRobber` 投影補 pirate 旗標 | 不補，只依賴 `bandit` hint（P8） |

**2026-11-12 主 agent 決定**：Planner 的刷新報告（§12）另提出六個待決定項（D1–D6，編號與上表的 D-SC 不同）。上表 D-SC1–D-SC12 全數採用建議，D-SC10、D-SC11 已解決；主 agent 對六項的決定如下，細化已同步改入「影響」欄列出的段落。

| # | 問題 | 決定 | 影響 |
|---|---|---|---|
| D1 | SFCK-P 的 golden replay：golden 只涵蓋 base（`test/golden/driver.ts`；`harness.ts:779-835` 的 `goldenIdsFor`），sf-\*、ck-\* 沒有基礎設施 | 不提交 sf／ck 的 golden fixture。SFCK-P 在 scratch 以 `createDecisionHasher`（`packages/bots/test/harness.ts:821`）比對決策雜湊：同一批局在 `fc6b3b5` 與 PR head 各跑一次——base 3–6 人 × 10 種子（沿用既有 golden），加上 `sf-new-shores-2025`、`sf-new-shores-paired-2025`、`ck-2025`、`ck-paired-2025` 各 3 種子（混合難度）。每個雜湊必須相同，結果表放進 PR 本文。腳本放在 repo 外（例如 `.worktrees/_scratch/sfck-p/`），不提交 | §5 SFCK-P、SFCK-2 驗收；§8；§9 R-SC1 |
| D2 | `knight.recruit` 的點：`recruitSite` 只選一個點，planStep 也不經過 `rescore`，`rescore` 改不了它 | 選 (b)：SFCK-2 可改 `citiesKnights/defense.ts` 的 `recruitSite`（只動這個函式），讓 `free` 依各模組對 `knight.recruit {vertex}` 的 `rescore` 差值總和由高到低排序，同分依原有順序、再取 vertex 較小者。沒有任何 `rescore` 提供者的 profile（除 sf-ck 以外全部）結果必須逐位元相同：D1 的 ck-\* 雜湊比對，加上 `BOTS_SEEDS=10` 的 `ck-game`。`types.ts` 的 `rescore` 註解加一句：「C&K's `recruitSite` also orders recruit sites by it (ties keep the existing order).」（捨棄 (a)：K2 只罰 move 與 displace，釘船比例只在 Q3 觀察） | §4.1、§4.4、§4.6、§5 SFCK-2、§6.3 FX-K、§8 |
| D3 | 截圖政策：原稿「放在 `.tmp/`，不提交（D10）」；CK-G 採 E-9（使用者 2026-11-11 決定）：PR 證據放 `pr-assets` 的 `pr-<N>/`，再把一張大廳截圖收進 `docs/screenshots/` | **待使用者在 SFCK-G 決定**（屆時詢問）。提案：比照 CK-G，放 `pr-assets` 的 `pr-<N>/`，並新增或重拍 `docs/screenshots/seafarers-cities-knights/lobby-*.png`，同步更新 README `:21`（「電腦對手尚未支援這個規則組合。」） | §5 SFCK-G、§7.1、§7.2-4、§8 |
| D4 | 看門狗的單位：harness 計的是 `turn.roll` 次數，原稿「72 回合 ≈ 7 倍」是以輪計 | 維持 `watchdogRolls: 72`（= 72 次 `turn.roll`，與 C&K 同義），改正原稿的說法（原型最長 41 次擲骰，約 1.8 倍）；SFCK-3 回報 `longestStagnation`，超過約 50 次擲骰時提報 | §6.1、§5 SFCK-3 |
| D5 | 第 2 輪 setup 的合成公式：原稿三者相加，會重複計算產能 | 第 1 輪 `setupSpotScore + islandSetupBonus`；第 2 輪 `citySetupScore + islandSetupBonus`，加上 `touchesOreOrGrain` 的硬篩選（複製 `citiesKnightsSetup:67-71`）；不得把 `setupSpotScore` 與 `citySetupScore` 相加；road 階段回 undefined（交給 SF） | §4.1、§4.4、§6.3 FX-S |
| D6 | `bench --profile sf-ck-*` 在 SFCK-G 之前會被 `botsCanPlay` 擋下（`bench/run.ts:109-113`） | 從 SFCK-3 的驗收移到 SFCK-G 之後的 QA（§8 步驟 4）；SFCK-3 可在本地暫時翻開 gating 做校準，不提交 | §5 SFCK-3、§6.4、§7.2-2、§8 |
| 0.5 | `types.ts` 的步驟 0.5 由誰做 | 只改註解（Planner 草稿加 D2 那一句），併入 SFCK-P 的第一個 commit，SFCK-P 為此擁有 `types.ts`；`support.test.ts` 的 `RESERVED_HOOKS` 清理屬於 SFCK-1 | §4.6、§5、§8 |

## 11. 與整體策略的差異（含與 SF、C&K 計畫的衝突）

> 2026-11-04：1–4 已併入整體策略（§3.1 Q2、§4.1、§4.2、§4.9、§5）；5–9 已寫入 SF、C&K 計畫的對應段落，T&B 計畫改為直接使用 0.4.3 的 fold。每視窗上限的斷言依獨立審查改為 ≤ 40。

| # | 差異 | 對象與位置 | 證據與理由 |
|---|---|---|---|
| 1 | **`robberTargets` fold 的元素型別推廣為 `number \| null`；初值為完整的盜賊預設（陸地非現位、海格非現位、海盜在場時加 `null`），不只是 base 的陸地格**。fold 結果同時過濾 `banditCandidates`。撤回第一輪的 `banditTargets` | 策略 §4.1（`robberTargets` 簽名）、§4.2（`robberTargets` 列；「海格用 `banditCandidates` 加入」一句改為「`banditCandidates` 負責評分，fold 負責合法性」） | fold 依 `ruleModules` 順序，SFCK 排第一。若由 SF 在 fold 中加入海盜目標，就會把 SFCK 在 `'robber'` frame 剔除的海盜目標加回來，而 `:75` 會拒絕這些目標。初值納入海盜目標後，SF 不必參與 fold，SFCK 只要收窄；base 的初值不變（沒有海格、海盜為 null），golden replay 不受影響 |
| 2 | **0.4.3 不只有組合層**：SFCK-P 要交付 fold（策略原本排在 0.4.4）、`rescore`，以及 `sea.ts` 的 blocker 預設 | 策略 §4.9 的 0.4.3、0.4.4 兩列 | G-SC1、G-SC3、G-SC6。0.4.4 的 T&B 改為直接使用 fold |
| 3 | **新增 `rescore?(turn, candidate)`，組合方式為差值相加**；另補上 `vertexBlocker`／`siteBlocked`（OR）、`hexYield`（逐 hex 第一個非 undefined）、`setup`（部件衝突時由組合模組攔截）三條組合規則 | 策略 §4.1、§4.2 | G-SC4、G-SC5、G-SC6；組合方式見 §4.6 |
| 4 | **Q2 的 X1–X3 以固定盤面守門，不採「全部種子合計」** | 策略 §3.1 Q2 | 追擊海盜在 sim 中只有 1/40（第一輪 6/40），金礦城市 0/40，3–4 人 `either` 時移海盜 0/20。以種子合計設門檻會偶發失敗，或必須設成無意義的 0 |
| 5 | **C&K 的 M2 在 sf-ck 改為局數門檻**；M5、M7、M8 不套用到 sf-ck | C&K 計畫 §6.2 | G-SC8：16 VP 多半靠島嶼取得，3 人局 2/10 局最高改良只有 2 |
| 6 | SF 計畫：§4.1 moveRobber 列的「保底永遠不動海盜」，在 SF+CK 中改由 fold 集合決定（`'pirate'` frame 會移海盜） | SF 計畫 §4.1 | F1 |
| 7 | SF 計畫：§4.3 的 `blocker` 預設在 0.4.3 由 SFCK-P 改為組合後的 `vertexBlocker`，options 物件只增欄位（與 E&P N8 相容）；§4.3 對「首攻前海盜不活動掛點」的推測：不需要 | SF 計畫 §4.3、§4.5 | 第一輪 164 對 0 次不一致；`engine.ts:1124`；`sfck/index.ts:89-90` |
| 8 | SF 計畫：setup 評分抽成可匯出的純函式 `islandSetupBonus`；城市計畫要把金礦以 2 點萬用計價（A5） | SF 計畫 §4.2 setup building 列、§4.5 | G-SC4；`sf/gold.ts:38` |
| 9 | C&K 計畫：`hexYield` 對非 `TERRAIN_COMMODITY` 地形回 `undefined`（A2）；第 2 輪城市評分匯出為 `citySetupScore`；§4.9「騎士封住船路〔推測〕」改為由 SFCK-P 完成；§4.2 base moveRobber 列在 SF+CK 中改由 fold 集合決定 | C&K 計畫 §4.1、§4.6、§4.9、§4.2 | G-SC3、G-SC4、G-SC5 |
| 10 | 第一輪報告的 SFCK `duty`（海盜追擊後的 moveRobber）不再需要；「base 保底遇到空集合時回 undefined」也不需要 | 第一輪報告 §4、§6 | §4.2：集合完整且非空，base 保底取第一項就一定合法 |

## 12. 2026-11-12 刷新

v0.4.2 stable 發布後、0.4.3 開工前，Planner 依 `fc6b3b5`（`release/v0.4.3` 的起點，與 `origin/master` 相同）逐項核對本計畫的引用與前提。SFCK-X 的分支 `origin/feat/bots-sfck-exports`（`5c74269`、`224a55e`）只用 `git diff` 讀。**沒有阻擋開工的問題**；§2.1 的 A1–A5 全部成立。行號與證據已併入各節，主要更正如下：

- A1–A5 成立，名稱與計畫相同（§2.1）。`vertexBlocker`／`siteBlocked`／`hexYield` 的組合規則在 `B/board.ts:131-163` 已與 §4.6 一致，SFCK-P 不必修；A5 實作在平台的 `economy.ts:143-152`，SFCK-2 不必動 SF 的 `plan.ts`。
- 平台鉤子的型別已就位（`B/modules/types.ts:38-39`、`:165-166`），骨架還沒有任何地方呼叫它們；步驟 0.5 只改註解，併入 SFCK-P 的第一個 commit（§4.2、§4.6、§8）。
- 檔案所有權補漏（§5）：SFCK-P 加 `B/base/robber.ts`、`B/base/duty.ts`、`plan.ts` 與 `hard/economy.ts` 的 `kinds`（各 1 行）；SFCK-1 加 `support.test.ts`；SFCK-3 加 `harness.ts` 的 `PROFILE_LIMITS`、`families.ts`，bench 一定要改；SFCK-G 加 `bots.test.ts` 三處與 `rooms.test.ts` 一處，新的 server 測試檔改名 `seafarers-cities-knights-bots.test.ts`。
- 過時的內容：CK-C 已在 0.4.2 交付（§5.2、R-SC7、D-SC11）；#98 已由 #108 修正（§1、D-SC10）；SFCK-2 驗收命令引用不存在的 `ck-strategy.test.ts`，改為 `ck-decisions.test.ts` 加 `sf-frames.test.ts`；探查腳本已不存在，F1–F11 由 SFCK-1 重建（§4.3、§6.3、附錄）。§7.1 整張換成新行號，並補上計畫漏列的 `FIDELITY.md:667-668`、`SPEC.md:320`、bot 規格 `:146`／`:154` 與截圖 README；bot 規格 `:19` 範圍外清單的 SF／C&K 字樣已經清除，該列刪除。
- 設計修訂：fold 初值的寫法與三個陷阱（§4.2）；保底表的 discard 列（§4.3）；分數尺度、setup 合成、小島空點、船的 open end、aqueduct（§4.4）；K3、K4、K6（§4.5）；`rescore` 與 `blocker` 預設的落點（§4.6）；看門狗的單位（§6.1）。
- §5 各切片的行數估計未依刷新重估。

**相容性**（Planner 核對）

- **T&B FR**（`tradersBarbarians/variants/friendlyRobber.ts:34-41`）：rules 是取代式，沒有合法格時回沙漠，即使強盜已在沙漠上；bots 的 fold 同樣是「收到目前的集合，回傳下一組」，允許縮小、替換或擴大。T&B 計畫 `:98` 的簽章與現況相同，`:169` 寫明 FR 直接採用 `hints.robberHexes`，`:193` 已改成直接使用 0.4.3 的 fold；T&B 沒有海格、海盜為 null，初值與現行相同。**相容**。陷阱：FR 可能回傳現位格，所以只在初值排除 `view.board.robber`（§4.2）。
- **E&P N8**（E&P 計畫 `:214`）：E&P 擲出 7 時走自己的模組 frame（`explorersPirates/pirate.ts:32-38 sevenRobberStep`），不會進入 base 的 moveRobber，fold 不會被呼叫；profile 沒有海盜（`hasPirate` 預設 false，`profiles.ts:200`）。N8 要的是 `sea.ts` 的 BFS callback，SFCK-P 只替 `blocker` 加預設值，options 物件只增欄位。**相容**。

**上一版留下的待辦**

| 項目 | 現況 | 落點 |
|---|---|---|
| F1：SF 的 `plan.ts:94`、`hard/economy.ts:49` 呼叫 `etaRounds` 時沒有傳 `kinds` | `etaRounds` 遇到清單外的卡種回 `Infinity`（`economy.ts:237-249`）。島嶼計畫的成本只有資源，不會變成 `Infinity`，但 commodity 的剩牌換匯與收入被忽略，sf-ck 的島嶼 ETA 偏高 | SFCK-P 改傳 `base.kinds`／`economy.kinds`；沒有 C&K 時 `kinds` 就是 `RESOURCES`，sf／base 的決策不變（D1 的雜湊比對守住） |
| F2：組合掛點綁死建模時的 model | **已修**（`board.ts:61-66`、`:138-162`，呼叫時才收 model） | SFCK-P 的 sea 預設必須用傳入的 model（§4.6） |
| F3 `handLimit`、F4 `BoardModel.modules`、F7 | 已修 | — |
| F5：`bank.ts` 直接讀 `citiesKnights` 鍵 | 保留；SF+CK 沿用同一個鍵 | 不在本版 |
| F8 | 命名細節 | 不在本版 |
| F9：`shipEdgesFrom`／`roadEdgesFrom`（`sea.ts:150-152`、`:178-180`）自建沒有模組的 model | 未修；目前只有測試使用（`sf-sea.test.ts:135-147`、`:627`；`sf-game.test.ts:35`） | SFCK-P 加選用參數 `modules`；SFCK-3 的 B-POLICY-SEA+K 需要（§4.6、§6.1） |
| F10：T&B 的 goods 不是 CardKind | — | 0.4.4，不在本版 |
| `COMMODITY_WEIGHT` 尚未調校；M4 與 Intrigue 的餘裕很薄 | C&K 工作紀錄 `:83-84` | 不在本版。SFCK-2 動到 C&K 檔案（D2 的 `recruitSite`）時，以 `BOTS_SEEDS=10` 重跑 `ck-game` |
| #135：SF standard 在 3–4 人對 naive 時未達 Q3 soft target（OPEN） | — | 不在本版的切片；Q3 表引用它，不作為阻擋條件（§6.4） |
| #115：E&P 在 PG 上的 restart 測試（OPEN） | — | 無關 |

### 12.1 切片 brief 的補充事項

只列計畫其他段落沒有寫到的陷阱。

- **SFCK-P**
  - golden：沒有任何候選被濾掉時，候選清單與 rng 的消耗必須完全不變；easy 的 `turn.choose` 會依 `min(topK, length)` 消耗 `rng.int`。`robberCandidates` 的迭代順序不得更動（`base/robber.ts:11`）。
  - `pendingDuty` 是公開 API（`fallback.ts:17`、`index.ts:4`），新增 `modules = []` 後，兩個參數的呼叫方式要維持相容。保底不得 throw（`modules/types.ts:141-143`），fold 的回傳值要防呆，只接受整數與 null。
  - `routeLength` 已經讀 `model.blocker`，不要重複加；sea 的預設要讀傳入的 model，不要讀 `turn.model`。
  - 測試檔 `test/sfck-hooks.test.ts` 與 rules 的 `packages/rules/test/sfck-hooks.test.ts` 同名（不同 package，可以接受），描述要分清楚。`support.test.ts` 不歸 P：P 沒有註冊模組，不會觸發守門測試。
- **SFCK-1**
  - 型別：SFCK-X 合併前先用本地型別；合併後改用 `moduleHints(view.hints, 'seafarersCitiesKnights')`（`B/modules/view.ts:25-30`）、`SfckBandit` 與 `SEAFARERS_CITIES_KNIGHTS`。
  - `targets.ts` 只依 `bandit` 收窄：`'pirate'` 保留海格與 null；`'robber'` 保留陸地；`'either'`／null 原樣回傳。陸海的判定與初值相同，都用 `terrain !== 'sea'`。
  - 真值表：3 人與 4 人共用 topology `sf-new-shores-4`（`profiles.ts:484`），但 layout 依人數不同；6 人用 `sf-new-shores-56`。
  - `supports` 寫成 `() => SFCK_BOTS_RELEASED`（false）。`botsCanPlay` 本來就要求三個模組都註冊，「缺一個就不開放」的測試可以直接用 `botsCanPlay(profileWith([...]))`。確認 `BOT_PACING` 的鍵不重複（`knight.chasePirate` 是新的鍵）。
- **SFCK-2**
  - `setup.ts`：build 與 road 階段都會被問到，road 階段回 undefined，交給 SF。
  - `chase.ts`：只限 standard；候選取自 `hints…seafarersCitiesKnights.pirateChase`；價值用 `pirateOptions(turn)`（`seafarers/bandit.ts:155`，註解寫「匯出只為了測試」，沿用即可，不改 SF 的檔案），乘上 `PIP_VALUE`；防禦用 `threatOf`／`guardedKnights`；K5 取等級最低者，同分取 vertex 最小者。
  - `rescore.ts`：K2 的 open end 用 `hints.modules.seafarers.movableShips` 判定；easy 不罰。FX-K1（招募）預期不需要 `rescore` 就會通過，要寫測試證明；FX-G2 只寫測試。
- **SFCK-3**
  - kit：新的 `test/modules/seafarersCitiesKnights.ts` 只放 SFCK 自己的計數（追擊海盜事件 `sfck.knightChasedPirate`、`either` 時兩種盜賊各移幾次、自己的騎士釘住自己船的窗口數、騎士站在計畫點的窗口數），計數鍵不要和 SF／CK 的 kit 重複（bench 會三個 kit 一起用）。
  - perturb：SF kit 的 `perturb` 會無條件把海盜放到海格上（`seafarers.ts:271-276`），也會佈置 `moveRobber cause:'seven'`（`:314-321`），這兩種狀態在 sf-ck 首攻前都不可能出現；harness 的 `kits` 由呼叫端傳入，`perturb` 依陣列順序套用（`harness.ts:739` 起）。所以 family 測試傳 `[seafarersKit, citiesKnightsKit, sfckKit]`，讓 SFCK 最後執行，修補首攻前的狀態（`attacks === 0` 時把海盜設回 null、拿掉 `moveRobber`），再加上海盜位置、首攻前後與船端騎士的擾動。bench 用 `kitsOf(profile, BENCH_KITS)`（`run.ts:172`），不做 perturb，只計數，所以 SFCK kit 不要自行包住兩者（會重複計數）。
- **SFCK-G**
  - `packages/web/test/bots.test.tsx:209` 是 fixture，可以不改；`session.test.ts:78`、`rooms.test.ts:209` 只列 selectable，不受影響。
  - hard 開放與否不需要寫程式：sf-ck 開放後自動得到 `botLevels: ['easy','standard']`，hard 被拒為 `E_INVALID_BOT`／`profileLevel`（`bot-seats.ts:56-65`、`rooms.ts:488`、`:497`、`:827-831`），做法與 SF、C&K 相同；server 測試要包含拒絕 hard 的案例，文件比照 `API.md:482`。

## 附錄：探查（`/tmp/katan-bot-research/seafarers-cities-knights/`；2026-11-12 刷新時該目錄已不存在）

| 檔案 | 用途 | 執行（`node --experimental-transform-types --no-warnings …`） |
|---|---|---|
| `q2-calibrate.ts`（本輪） | mixed、`fbseat`、`allfb`、`alleasy`、`allstd` 五種座位；逐局輸出步數、回合、看門狗間隔、逐 Bot 每視窗指令數與 Q2 計數（逐步累計 `events`） | `q2-calibrate.ts mixed 3,4,5,6 1 10` → `out/q2-*.txt` |
| `duty-fixtures.ts` | F1–F11 固定盤面 | `out/fixtures.txt` |
| `conflicts.ts` | 8,353 個窗口中，各模組自己的模型與 hints 的比對 | `out/conflicts.txt` |
| `variants.ts`、`lib.ts`、`strategies.ts` | 第一輪的 variant 與共用程式（`base`、`duty`、`core`、`full`、`naive`、`naivefb`、`mixed`） | `out/{base,duty,core,full,naive}.txt` |
| `sim-measure.ts`、`facts.ts` | rules 腳本模擬的步數；地圖事實 | `out/sim.txt` |
