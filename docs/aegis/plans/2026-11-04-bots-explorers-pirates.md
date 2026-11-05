# Explorers & Pirates 電腦對手：實作計畫（v0.4.5）

日期：2026-11-04。狀態：**建議計畫，待使用者確認 §10。**

前置閱讀：整體策略 `docs/aegis/plans/2026-11-04-expansion-bots-roadmap.md`（以下簡稱「整體策略」）；bot 規格 `docs/aegis/specs/2026-11-01-bot-opponents.md`（不變式 I1–I9、§5 合約）；rules 文件 `docs/SPEC.md` §4.9 與第 274 行的 E&P 合約、`docs/FIDELITY.md` 的 R-EP 列（105–113）、`docs/aegis/work/2026-11-02-explorers-pirates.md`、`packages/rules/src/modules/explorersPirates/`。

證據來源：基準為 `a200840`（v0.4.0），行號都依此版。另有第 1 輪研究報告（`docs/aegis/work/2026-11-04-bots-explorers-pirates-research.md`）與第 2 輪核實（本計畫）。探查腳本放在研究目錄 `/tmp/katan-bot-research/explorers-pirates/`，不提交：`q2.ts`（fixture 10 種子 × 10 組，統計機制計數與最長無得分區間）、`fallback-ep.ts`（純保底，5 profile × 2 人數 × 5 種子 × 1,500 步）。所有門檻只依決定性指標（步數、回合、事件數）訂定，耗時只作參考。

> **摘要**
> 1. 0.4.5 一次開放 5 個 profile，方案 (a)。以 (b) 為預先約定的退路：未過閘門的 Fish、Spices、Full 移到 0.4.6（§5.3）。
> 2. 子階段接管：E&P 的 `phase` 只接管 Movement；Action 子階段走共用骨架，最後由 `endWindow` 決定送 `ep.startMovement` 或 `turn.end`；變動式開局由 E&P 的 `setup` 全權處理，base setup 永遠不會執行。
> 3. 保底表涵蓋每個 frame 與強制動作，純保底實測 0 拒絕、0 停擺。唯一無解的是規則層擱淺死結，交給 server 診斷與 rules 修正（§4.1、§4.5）。
> 4. 切片：E0–E5b 共 8 個 PR，另有 rules 修正 R。約 src 2,110、test 1,260 行。
> 5. Q1 的看門狗 N=60 回合，步數上限依 profile 在 2,500–8,000 之間。Q2 門檻逐任務訂定，依據是 fixture 實測（§6）。

## 1. 目標與範圍

| profile | 人數 | 勝利分 | 開局 | 部件（`supports` 依此判定） | 拓樸 hex/vertex/edge |
|---|---|---|---|---|---|
| `ep-land-ho-2025` | 3–4 | 8 | 固定開局（boards.ts:202） | core | 50/126/175 |
| `ep-pirate-lairs-2025` | 3–4 | 12 | 盤面印刷固定，棋子走變動式（boards.ts:219） | core＋pirates＋lairs | 57/142/198 |
| `ep-fish-2025` | 3–4 | 15 | 變動式 | core＋pirates＋lairs＋fish（boards.ts:239-240） | 57/142/198 |
| `ep-spices-2025` | 3–4 | 15 | 變動式 | core＋pirates＋fish＋spices（boards.ts:252-253） | 64/158/221 |
| `ep-full-2025` | 3–4 | 17 | 變動式 | 全部（boards.ts:265-266） | 71/174/244 |

- **硬約束**：建築最多 13 VP，即 5 座 plain 加 4 座 harbour × 2（core.ts:10）；每條任務軌道最多 3 VP，加上 bonus 1（core.ts:24-30）。Fish、Spices、Full 不推進任務就到不了勝利分，所以 easy 也必須做任務（P9）。
- **目標**：5 個 profile × 3、4 人 × easy／standard，各自通過 Q1 與 Q2 後才開放；`supports(profile)` 依部件判定（§4.8 N3）。
- **非目標**：CN3086 的 5–6 人、2 人變體、組合 PDF（SPEC:274 列為 Deferred）；新增 hints（包括選配的 `ships[].reach`）；`hard` 難度；MVP 不做 harbour 中轉（`ep.unload`、`ep.swap`），也不主動提出含金幣的國內報價（整體策略 D6）。擱淺死結的 rules 修正另案處理（§4.5）。

## 2. 現況與落差

### 2.1 現況

- **gating**：`BOT_RULE_MODULES = []`（support.ts:12），5 個 profile 的 `botSeats` 都是 false；server 測試斷言 `E_INVALID_BOT`（server/test/explorers-pirates.test.ts:66-74）。
- **未修改的 base 策略**（第 1 輪實測）：變動式開局在第 0 步就停住；擲出 7 後停在海盜 frame；Land Ho! 跑了 3,000 步仍沒有勝者，期間 0 個 `ep.*` 指令。
- **0.4.1–0.4.4 交付的平台**（整體策略 §4.9）：`BotCommand`、BotModule 與組合骨架、`supports` 快照、harness `newBotGame({ profileId })`、仿 BotDriver 模式與看門狗、`BOT_PACING`、診斷重試、規則 9 防護、`sea.ts`（SF）、goods 估值（T&B）。開工前由 Planner 依實際程式刷新本計畫（§8）。

### 2.2 落差與處理

| # | 落差 | 證據 | 處理（切片） |
|---|---|---|---|
| G1 | 變動式 setup：base 只看 `turn.setup.stage` 與 `legalSettlements`／`legalRoads`，這兩個在 E&P 為空；base setup 指令會被 veto | heuristic.ts:307-320；fallback.ts:65-76；E&P index.ts:79、95、116 | E&P `setup`／`duty`（E1、E3） |
| G2 | 模組 frame 一律回 null | fallback.ts:41-43；heuristic.ts:162-164 | `answerFrame`／`duty`（E1、E3） |
| G3 | 擱淺時 `canEndTurn` 為 false，保底回 null，整桌靜默停住 | fallback.ts:77-78；engine.ts:2071、2100；bot-driver.ts:325-345 | E&P `duty` 脫困（E1）；0.4.1 的診斷與重試 |
| G4 | 不發任何 `ep.*` 指令 | heuristic.ts:411-456 | E2–E4b |
| G5 | base 經濟會規劃 longestRoad，但 E&P 沒有最長道路 | economy.ts:259-280；E&P index.ts:129-132 | `economy.awards: { longestRoad: false }`（0.4.4 已建立；E2 設值，§11 D-1） |
| G6 | 剩餘聚落以 9 座計算，E&P 的 plain 上限是 5；`legalCities` 非空 | board.ts:145-152；core.ts:10；engine.ts:2081-2088 | `economy.piecesLeft`：讀 `supply`，cities 固定為 0（E2） |
| G7 | 道路 BFS 不認得霧與 closed site | board.ts:171-206；E&P index.ts:122-127 | `economy.routeEdge`（E2） |
| G8 | 不使用金幣；回應報價時忽略 goods | trade.ts:38-44 | 金幣候選與估值（E2，§4.7） |
| G9 | 棄牌時保留的是 base 計畫的成本 | heuristic.ts:169-192 | E&P 計畫進入 `plans`（E2） |
| G10 | Movement 中送 `trade.settle` 會被拒 | heuristic.ts:416-419；E&P index.ts:81-84、97 | `endWindow` 之前先結清報價（§4.2） |
| G11 | 每視窗 40 指令上限；節奏表沒有 `ep.*` | bot-driver.ts:40-63、70、303 | `maxCommandsPerWindow: 80`、`pacing`（E0，§4.9） |

### 2.3 第 2 輪核實（修正與補充第 1 輪）

| # | 項目 | 核實結果 | 證據 | 影響 |
|---|---|---|---|---|
| C1 | 第 1 輪說「擱淺時保底被拒、無限重試」 | 不正確。保底先看 `canEndTurn`，擱淺時直接回 null，結果是靜默停住，不是重試。直接送 `turn.end` 才會得到 `E_EP_EDGE_FULL` | fallback.ts:77-78；engine.ts:2071；index.ts:109-112 | 屬於 G-A，由 0.4.1 的「欠動作卻沒有動作」診斷涵蓋 |
| C2 | 擱淺後只能靠 `extraMove` 或 `found` 脫困 | 屬實。換船、擲魚、`turn.end` 都會先檢查擱淺；Movement 中不能買資源、不能銀行交易，拿不到羊毛 | movement.ts:111-116、375；core.ts:60-64；index.ts:81-84 | 決定保底的脫困順序（§4.1） |
| C3 | 擱淺只會由行動者自己的移動造成 | 屬實。新船只放在空邊（economy.ts:166）；回合紀錄每個視窗清空（state.ts:126-130）；進入滿格邊時當下要有 ≥ 2 MP（movement.ts:96），所以擱淺時至少還剩 1 MP | 同左 | 「Bot 永不擱淺」完全由 Bot 自己的規劃決定 |
| C4 | 第 1 輪建議策略內做「連續 6 輪無進展就提高權重」 | 做不到。策略是純函式、不留狀態、不得讀事件，無從知道上次得分是什麼時候 | bots types.ts:35-39；整體策略 P4 | 改為結構性守衛（§4.6）；看門狗只放在測試 |
| C5 | Fish 只多了魚任務 | 不正確。Fish 的任務是 `['lairs','fish']`；Spices 是 `['fish','spices']`，而且有海盜 | boards.ts:239-240、252-253 | 部件要包含 `pirates`；切片順序為 Lairs → Fish → Spices／Full |
| C6 | `ep.fishRoll`、`ep.chase` 要比照擲骰等待演出 | 不需要。前端只有事件文字，沒有骰子演出；`ROLL_PRESENTATION_MS` 只用在 `turn.roll` | web `i18n/modules/explorersPirates-events.ts`；bot-driver.ts:66、432 | 節奏設 1,000 ms 即可 |
| C7 | 新發現：每步守恆檢查的「每邊 ≤ 2 艘」 | 行動者的船穿越滿格邊時，該邊會暫時有 3 艘 | movement.ts:96、137-139 | harness 的每步檢查要豁免 active 船所在的邊 |
| C8 | 新發現：SPEC 寫 Pirate Lairs 用「printed start (fixed setup)」 | 只有盤面是印刷固定（setupModes 為 `['fixed']`），棋子仍走變動式三輪 | SPEC.md:274；profiles.ts:282；boards.ts:219；setup.ts:96-105 | Bot 依 `setupStep` 判斷；文件是否澄清列入 §10 E5 |
| C9 | 新驗證：純保底的合法性 | 0 拒絕、0 停擺；setup 140 次、海盜 frame 4,169 次，海盜目標最少 12 個；`rob` 階段在純保底局中沒有觸發 | `fallback-ep.ts` | 保底表成立；`rob` 階段改用固定盤面測試 |

## 3. 介面摘要（只列策略與保底用得到的部分）

以下 `V.` 代表 `view.modules.explorersPirates`，`H.` 代表 `view.hints.modules.explorersPirates`。

### 3.1 階段與處理者

| base `view.turn.phase` | `H.phase` | 處理者 | 結束這一段的指令 |
|---|---|---|---|
| `setup`（`V.setupStep` 非 null；Land Ho! 沒有這一段，setup.ts:96-101） | null | E&P `setup`（setup 游標以外的玩家回 null） | — |
| `preroll` | null | base（`turn.roll`） | — |
| 任何階段，且有 pending | null（index.ts:331） | 海盜 frame：E&P `answerFrame`；棄牌：base | — |
| `action`，行動者 | `'action'` | 骨架：base 的 settlement／road 候選（經 economy 掛點）加上 E&P `actions`，接著交易 | `endWindow` → `ep.startMovement` 或 `turn.end` |
| `action`，行動者 | `'movement'` | E&P `phase` 全權接管 | 由 `phase` 回傳 `turn.end` |
| `action`，非行動者 | null | base 回應報價（加上規則 9 與金幣估值） | — |

### 3.2 指令與合法來源

| 子階段 | 指令 | 合法目標 | hints 沒檢查、Bot 要自己檢查的 |
|---|---|---|---|
| setup | `ep.setupHarbor`、`ep.setupSettlement`、`ep.setupRoad`、`ep.setupShip` | `H.setup.{harbor,settlement,road,ship}`（index.ts:340-348） | route 步驟兩項都要放（setup.ts:285-295） |
| Action | `ep.buildHarbor` | `H.harbors` | 成本 2 穀 2 礦（core.ts:33）；`V.players[me].supply.harbors` |
| Action | `ep.buildShip {edge, replace?}` | `H.shipEdges`、`H.shipReplace` | 3 艘都在場時要帶 `replace`（economy.ts:190-196） |
| Action | `ep.buildSettler`、`ep.buildCrew {harbor\|ship, remove?}` | `H.pieceHarbors`、`H.pieceShips`、`settlersLeft`、`crewsLeft` | 容量；別處還有空位時不得帶 `remove`（economy.ts:255-263） |
| Action | `ep.buyResource`、`ep.sellForGold`、`ep.fastGold`、`ep.startMovement` | `goldBuysLeft`、`fastGoldLeft`、`canStartMovement` | 金幣 ≥ 2 且銀行有存量；3 張同種資源且 `goldSupply > 0`（economy.ts:65-99） |
| Action | base `build.road`、`build.settlement`、`trade.*` | base hints，已套用霧、closed site 與 5 座上限（index.ts:114-127） | 成本與棋子 |
| Movement | `ep.moveShip`、`ep.extraMove` | `H.ships[i].steps[]`（含 `full`、`tribute`、`explores`）、`extra`、`done` | 多步路線自行規劃；羊毛 |
| Movement | `ep.found`、`ep.load`、`ep.dropCrew`、`ep.pickCrew`、`ep.loadFish`、`ep.loadSpice`、`ep.deliver`、`ep.fishRoll`、`ep.chase` | `H.ships[i].*`（index.ts:303-316）、`H.fishRoll` | `load` 的容量 |
| frame | `ep.placePirate`、`ep.robPlayer` | `H.pirateTargets`、`H.robCandidates`，只提供給 `responders[0]`（index.ts:325-327、363-364） | — |

Movement 的語意：改移另一艘船時，會自動結束目前的 active 船（movement.ts:111-116）；探索會結束該船的移動（movement.ts:141-147）；過路費每艘船每回合付 1 次（movement.ts:91、131-135）。

### 3.3 rules 常數匯出（P8；E0 只動 `packages/rules/src/index.ts`）

| 匯出名（建議） | 來源 | 用途 |
|---|---|---|
| `EP_CARGO_SIZE`、`EP_HOLD_CAPACITY` | state.ts:19-20 | settler、crew、魚、sack 的容量計算 |
| `EP_BASE_MP`、`EP_EXTRA_MP`、`EP_START_GOLD` | core.ts:13-15 | 在 Action 子階段預估航程；開局金幣 |
| `EP_COIN_SUPPLY`、`EP_FISH_HAULS` | core.ts:11-12 | 守恆檢查（測試工具與 bench） |
| `EP_LAIR_TOKENS` | core.ts:21 | gold field 估值；目前是暫定值，讀常數才能在日後修正時自動跟上 |
| `EP_TRACK_BONUS` | core.ts:30 | 任務分數估值 |
| `EP_DISCOVERY_GOLD` | explore.ts:29 | 探索期望值 |
| `EP_PIRATE_FRAME` | pirate.ts:17 | frame 分派 |
| `type EpSetupStep`（即 `SetupStep`） | setup.ts:154 | setup 分派 |
| `EP_SWIFT_MAX`（2）、`EP_GOLD_BUYS_PER_TURN`（2） | movement.ts:42；economy.ts:90 | 預估 Swift 航程與買資源次數。這兩個目前是字面值，要先抽成具名常數再匯出；行為不變，屬 P8 允許的範圍 |
| `ModuleViewMap` 的 `explorersPirates` 項目 | index.ts:12 已匯出 view 與 hints 型別 | 供 `moduleView(view, 'explorersPirates')` 使用 |

## 4. 設計

### 4.1 保底表（模組 `duty`；整體策略合約規則 7）

| frame 或強制動作 | 最小動作 | 為何必定合法 | 證據 |
|---|---|---|---|
| setup `harbor` | `ep.setupHarbor`，`H.setup.harbor[0]` | 指令與 hints 用同一個函式驗證；有 14 個 harbour mark，最多放 4 座 | setup.ts:182-184、235-245；FIDELITY:105；探查 140/140 |
| setup `settlement`（反序） | `ep.setupSettlement`，`settlement[0]` | 同上（起始島上的空點） | setup.ts:186-196、247-257 |
| setup `route` | 有 `ship[0]` 就送 `ep.setupShip`，否則用 `road[0]` 送 `ep.setupRoad` | 已放過的那一項清單為空（`slot.setup` 旗標）。另一項一定有目標：聚落的邊至少有一條碰到陸地；依距離規則，自己 harbour 的邊上不會有別人的船 | setup.ts:207-233、259-295 |
| base 棄牌 | base `pendingDuty` | 行為不變 | fallback.ts:14-18；探查 7,216 次 |
| 海盜 frame `place`（cause 為 `seven` 或 `chase`） | `ep.placePirate`，`H.pirateTargets[0]` | 驗證用同一份清單，包含 chase 時的 `from` 排除；實測最少 12 個目標 | pirate.ts:42-52、75-79、111-113 |
| 海盜 frame `rob` | `ep.robPlayer`，`H.robCandidates[0]` | 清單就是 frame 的 `candidates` | pirate.ts:104-108、119-127；index.ts:364 |
| preroll | `turn.roll` | 行為不變 | — |
| Action 子階段 | `turn.end`，等於跳過 Movement | Action 子階段沒有 active 船，`beforeEndTurn` 不會否決 | index.ts:109-112；movement.ts:52-58；engine.ts:1115-1124 |
| Movement，未擱淺 | `turn.end` | `canEndTurn` 為 true | engine.ts:2071 |
| Movement，擱淺（`H.stranded`） | 依序：① active 船的安全步（優先非滿格步；滿格步只在之後仍有非滿格出口時才走，用 `route.ts` 的 BFS 判斷）→ ② `!extra` 且羊毛 ≥ 1 時送 `ep.extraMove` → ③ 有 `found[0]` 就送 `ep.found` → ④ 回 null | 擱淺時至少還有 1 MP（C3）；只剩 1 MP 時 `steps` 只會列出非滿格步。`extraMove` 只檢查 extra、done 與羊毛。`found` 會把船移出盤面 | movement.ts:77-101、232-251；economy.ts:283-298；探查（有羊毛）：`extraMove` → `moveShip` ×2 → `turn.end`，全部被接受 |
| 擱淺，且無步、無羊毛、無 settler | **保底無解，回 null** | 規則層死結（R7）。server 記一筆 warn（附 pending、子階段、active 船與 `stranded`），以 `retryMs` 退避重試（整體策略 §4.7-4）。重試改變不了狀態，真正的解法是 rules 修正 | strand 構造：`{"none":"null"}` |
| 非行動者 | 只回答自己欠的待決效果；不回應報價 | 合約規則 3 | — |

`duty` 只在上述情況回傳指令，其餘回 `undefined`，交給 base 的 `turn.roll` 與 `turn.end`。

### 4.2 子階段接管：`setup`、`phase`、`endWindow`

- **判斷依據**：子階段一律以 `H.phase` 判斷，它只在自己行動、而且沒有 pending 時才有值。base 的 `view.turn.phase` 不修改。
- **`setup`**：只要 `V.setupStep !== null` 就回傳非 `undefined`：自己是 setup 游標時回傳指令，否則回 null。這樣會被 veto 的 base setup 永遠不會執行。
- **`phase`**：`H.phase === 'movement'` 時全權接管，依 §4.3 決策，最後回傳 `turn.end`；其他情況回 `undefined`。只有擱淺且無解時回 null，交給保底，再交給 server 診斷。
- **Action 子階段**走整體策略 §4.1 的骨架：自己的報價 → 對我提出的報價 → 候選評分 → 交易 → `endWindow`。報價排在最前，保證進入 Movement 之前已結清或撤回（G10）。
- **`endWindow`**：只在 `H.phase === 'action'` 時回應。任一艘船有正分的航行計畫，或可以擲魚、可以追逐，就送 `ep.startMovement`；否則送 `turn.end`，省下一個指令與 600 ms。
- **合約規則 4**：Action 子階段無事可做時走 `endWindow`；Movement 無事可做時由 `phase` 回 `turn.end`。只有兩種情況允許回 null：自己有 open 報價正在等回應；擱淺且無解。
- **組合**：E&P 不與其他模組組合（SPEC:274），「第一個回傳非 `undefined` 的模組勝出」實際上只有它一個參與者；平台仍照 §4.2 實作通用版本。

### 4.3 standard 策略

分數尺度沿用整體策略：勝利分當量 ÷（1＋eta）。

| 窗口 | standard | 依據 |
|---|---|---|
| 變動式 setup | **harbour**：加分為相鄰起始島 hex 的 pips、可放船的邊數（不碰霧）、到霧區前緣的 BFS 距離（越近越好）；減分為被他人 harbour 擋住的程度。**settlement**：base `setupSpotScore` 去掉港口項，補上 harbour 缺的資源，沿海加分。**route**：ship 放在通往最高期望值霧格的第一步；road 用 `roadDirectionScore`，並過濾霧與 closed site | heuristic.ts:275-347 |
| Action | 1. 結清報價 2. 立即得分：`ep.buildHarbor`（+1 VP，且釋出 1 座 plain 供應，core.ts:114-120）或 `build.settlement` 3. 遠征：`ep.buildSettler`（條件見 §4.6） 4. 任務：造 crew，一艘船最多 2 名 5. 造船：Land Ho! 目標 2 艘、有任務時 3 艘；需要替換時只換空載、而且離目標最遠的船 6. 補缺口：只在本回合補完就能蓋時才換，先 `ep.buyResource`、再 `trade.bank` 7. 手牌 ≥ 8 時先消化：bank → `fastGold` → `sellForGold` 8. 國內開價：只用資源，只為「差 1 張就能立即得分」 9. `endWindow` | 第 1 輪 §5.2；fixture ep-sim.ts:181-221 |
| Movement | 0. 擱淺時先移 active 船 1. `ep.fishRoll`：有魚任務、尚未擲、沒有 active 船 2. `chase === true` 的船先追逐 3. 船隻排序：可建點的 settler 船 → 能到 anchor 的運貨船 → 前往巢穴或農場的 crew 船 → 取貨船 → 探險船 → 閒置船 4. 當前的船先做免費動作（`found`、`deliver`、`dropCrew`、`loadFish`、`loadSpice`、`load`；`pickCrew` 只在 crew 供應用完、仍有目標時用），再沿路徑走一步，必須是安全步（§4.5） 5. `extraMove`：差 1–2 步就能得分，且羊毛不在保留之內 6. 過路費：繞路代價 ≥ 2 步才付，並保留至少 1 金 7. 探索步：只在該船的最後一步，或沒有更好用途時 8. `turn.end` | movement.ts；ep-sim.ts:224-281 |
| 海盜 frame | **place** 格分：加分為格邊上有對手的船（依領先程度加權）、能擋住對手的航線（逼對手付過路費）、能嚇走對手要裝的魚；減分為自己 2 步內要用的淺灘。**rob**：沿用 `stealVictim` | pirate.ts:86-92；movement.ts:383；heuristic.ts:224-230 |
| 棄牌 | 沿用 `discardDecision` 骨架，保留 E&P `plans[0]` 的成本 | heuristic.ts:169-192 |

**探索估值**：剩餘庫存 = `EP_SCENARIOS[sc].regions[R].tiles` 減去已揭露的 tile（由 `terrain`、`board.numbers` 與 `sites` 判斷）。`EV(step) = Σ 霧格 Σ_t p_R(t)·v(t)`，一步揭露多個霧格時期望值相加。只用公開資訊，符合 B-FAIR（view 不含 `pools`，ep-privacy.test.ts:158-163）。

### 4.4 easy 的差異

| 項目 | easy |
|---|---|
| 選擇方式 | 同一套估值，從前 3 名中隨機挑（topK 3） |
| 不做 | 主動開價、`extraMove`、付過路費（改為繞路或停下）、hero 規劃 |
| 探索／追逐／海盜 | 去最近的霧格，不算期望值；一律追（免費）；從前 3 名中隨機挑 |
| 接受報價 | 門檻提高（`acceptMargin` 1.6） |
| 必須保留（P9） | 遠征加 harbour 升級的主線；Fish、Spices、Full 的任務主線（§1 硬約束） |

### 4.5 擱淺死結（R7、D5；#97）

1. **Bot 的規避規則**（E1 的 `route.ts` 實作，E2 起使用）
   - 路徑的終點一定是非滿格邊。BFS 狀態是（邊、剩餘 MP、是否已付過路費、金幣），轉移完全比照 `stepTargets`（movement.ts:87-97）：進入滿格邊前要剩 ≥ 2 MP，且那一步不會探索。
   - 每一步送出前再以 `isSafeStep` 驗一次：非滿格步一律安全；滿格步只有在剩餘 MP 內仍能到非滿格邊時才安全。不安全時改做免費動作或換船；換船前 active 船一定停在非滿格邊上。
   - 規劃只依賴行動者自己能改變的狀態（C3）。回合內唯一的外部變化是追逐成功後海盜換了主人，這只會讓過路費需求變少（movement.ts:60-64）。
2. **「Bot 永不擱淺」測試**
   - B-GAME 每步不變式：(a) 死結 0 次，定義為 `H.stranded` 為 true 且 active 船的 `steps` 為空；(b) `H.stranded` 為 true 時，Bot 的下一個指令必須是 active 船的 `ep.moveShip`。
   - 固定盤面（沿用 strand 構造的 A、B、C 三條滿格邊）：MP 不足時規劃器拒絕 A → B；MP 足夠穿越時接受；有羊毛時保底的脫困序列全部被接受。
   - fuzz：在中局狀態注入對手的船，讓部分邊各有 2 艘，跑完整個 Movement，斷言 (a) 與 (b)。
3. **rules 修正（`ep-2025.2`，#97）**：Bugfixer 修正、Fix Verifier 驗證，PR 指向 master。
   - 已被 #97 的維護者決策取代（2026-11-05）：未完成的 ep-2025.1 遊戲直接使用 ep-2025.2 行為，不依 engineVersion 分支。以下「只調整測試」與「舊存檔維持舊行為」兩條 bullet 已失效：保底無解的固定盤面不再需要固定 `engineVersion: 'ep-2025.1'` 或另加 `ep-2025.2` 對照（兩版行為相同），舊存檔也不維持舊行為，無出口的擱淺船可直接結束移動（FIDELITY E&P interpretation 15）。原文保留如下，僅供追溯。
   - Bot 不依 `engineVersion` 分支，只讀 `steps`、`stranded` 與 `canEndTurn`，兩種修法都不必改 Bot。**預防式**：`stepTargets` 不再列出之後沒有出口的滿格步，Bot 的規避變成多一層保險。**解套式**：沒有出口時允許 `turn.end`，保底先看 `canEndTurn`，會自動改送 `turn.end`。
   - 只調整測試：「保底無解回 null」的固定盤面固定 `engineVersion: 'ep-2025.1'`，另加一個 `ep-2025.2` 的對照案例；`server/test/explorers-pirates.test.ts:78` 的版本斷言由 R 自行更新。
   - 舊存檔維持舊行為（比照 base-2025.4，engine.ts:652、1252），所以保底無解那一列與 server 診斷都要保留。
4. **擱淺時的保底**：見 §4.1。擱淺只會由 Bot 自己的移動造成，規劃正確就不會走到「保底無解」那一列。

### 4.6 死循環防護（R8）

| 層 | 做法 | 依據 |
|---|---|---|
| 供應感知（策略內，不需要狀態） | 造 settler 前要求：`supply.settlements − 在場的 settler 數 ≥ 1`，且 2 回合航程內有可建點或有陸地期望值的霧格。settler 上船後若供應歸零，視為沒有目標的 cargo：船改做其他任務，並優先升級 harbour（會釋出一座 plain 供應） | fixture 的死循環成因：settler 船停在距離 0 的目標旁，但 5 座 plain 已滿，`foundTargets` 為空（ep-sim.ts:87、270；movement.ts:219） |
| 目標過濾 | 每個目標都要可達且還有剩餘供應：巢穴未攻下且 crew < 3；`sacks` 仍包含自己；淺灘上有魚或還能擲魚；軌道未走到底。霧格全部揭露後，探索價值歸零 | index.ts:303-316；core.ts:145-153 |
| 單調性 | 每個指令都要讓計畫勢能嚴格下降。MVP 不做 `unload` 與 `swap`，不會來回搬貨 | — |
| 測試看門狗 | 全體分數總和連續 N=60 回合沒有創新高，就判為失敗；另設步數上限（§6.1） | `q2.ts`：健康局最長無得分區間 7.7 輪（≤ 25 回合）；病態局 55、119、124、358 輪 |
| BotDriver 上限 | 每視窗 80 個指令。超過時改走保底：Movement 中送 `turn.end`，擱淺時則脫困 | bot-driver.ts:303-312 |

### 4.7 金幣與國內交易（合約規則 9）

- **持有量與估值**：`trade.goods` 回傳 `{ gold: V.players[me].gold }`，屬公開資訊（index.ts:264）。`trade.goodValue('gold')` 設為 0.4 張資源（推測，由 bench 調整），依據是市場價的上下界 [1/3, 1/2]：3 張換 1 金、2 金換 1 張（economy.ts:65-99）。
- **一律拒絕**：含 `gold` 以外的 goods id（E&P 只有 gold，index.ts:141）；`wantGoods.gold` 或要求的資源數超過自己的持有量；付出後金幣會少於 1 枚（保留來付過路費）。
- **其他報價**：goods 的價值加進 `offerGain` 後與 `acceptMargin` 比較。對方直接對行動者提出的報價估值相同，`trade.settle` 前再確認對方付得起（金幣看 `V.players[from].gold`）。
- **不主動提出含金幣的報價**（D6）。Movement 中只會送 `trade.respond` 或 `withdraw`（index.ts:81-84）。

### 4.8 對平台與 rules 的需求

| # | 需求 | 落點 | 備註 |
|---|---|---|---|
| N1 | `setup`、`phase`、`endWindow` 在骨架中生效；`fallbackPolicy` 的模組 `duty` 排在 base 的 `turn.end` 之前 | heuristic.ts、fallback.ts（E0） | 整體策略 §4.9 把它排在 0.4.5 |
| N2 | 依 profile 取 `maxCommandsPerWindow`（組合時取最大值）；E&P 設 80 | bot-driver.ts:70、303（E0） | 若 0.4.1 的 PL-3 已參數化，E0 只要設值並補測試 |
| N3 | `supports`：部件取 `epScenario(profile.scenario).missions` 再加上 `pirates`。未知 scenario（會丟例外）或人數 > 4 時回 false | modules/explorersPirates/index.ts | §11 D-2 |
| N4 | `economy.awards`：E&P 設 `{ longestRoad: false }`，不再規劃最長道路 | economy.ts:259-280（0.4.4 由 T&B 的 S1 實作；E0 只確認） | 原提案為 `economy.basePlans`，整合時與 T&B 統一，見 §11 D-1 |
| N5 | 模組的 `scoreExtras` Plan 要能帶模組成本並進入 `plans`，讓棄牌保留、`bankTradeToward` 與 `proposeOffer` 以 E&P 計畫為目標 | economy.ts:92、heuristic.ts:169-192 | 0.4.1 為 SF 建立；E0 只確認 |
| N6 | harness 的每步守恆檢查豁免 C7 的情況；`limits` 依 profile 設定 | test/harness.ts（PL-2） | E&P 的值由 E1 提供 |
| N7 | rules 常數匯出（§3.3） | rules/src/index.ts（E0） | P8 |
| N8 | `sea.ts` 的邊 BFS 支援 callback：可通行性、停留限制、終止邊與成本 | bots/src/sea.ts（SF） | 缺 callback 時，E1 以相容方式擴充 |

### 4.9 節奏與每視窗上限

| 指令 | ms | 依據 |
|---|---|---|
| `ep.moveShip` | 400 | 佔所有指令的 47%（第 1 輪） |
| `ep.load`、`unload`、`swap`、`dropCrew`、`pickCrew`、`loadFish`、`loadSpice`、`deliver` | 600 | 免費的 cargo 動作 |
| `ep.startMovement`；`ep.extraMove` | 600；700 | — |
| `ep.buyResource`、`sellForGold`、`fastGold` | 800 | 與 `trade.bank` 相同 |
| `ep.build*`、`ep.found`、`ep.setupHarbor`、`ep.setupSettlement` | 900 | 整體策略的建造類；與 `setup.placeBuilding` 相同 |
| `ep.setupRoad`、`ep.setupShip` | 600 | 與 `setup.placeRoad` 相同 |
| `ep.fishRoll`、`ep.chase` | 1,000 | 沒有骰子演出（C6） |
| `ep.placePirate`、`ep.robPlayer` | 1,200、800 | 與 `pending.moveRobber`、`pending.steal` 相同 |

- **換算**：以 fixture 的指令組合（每視窗平均 14 個）計算，一個 Bot 回合約 8–10 秒，另加擲骰演出 2.8 秒（推測）。若一律用預設的 900 ms，約 12.6 秒。實際值由 bench 的「Bot 回合秒數」確認。
- **上限 80 的推導**（MVP 規則下）：Movement 每艘船最多約 16 個指令（移動 ≤ 8：4＋extra 2＋Swift 2，movement.ts:40-43；`extraMove` 1；`chase` 1；追逐成功後的 frame 2；cargo ≤ 4），3 艘約 48，加 `fishRoll` 與 `turn.end` 約 50。Action 約 25（建造 ≤ 12、買資源 ≤ 2、兌換 ≤ 6、報價 ≤ 4、`endWindow`）。合計約 75 < 80；fixture 實測最大 30、平均 14。B-GAME 斷言每視窗 ≤ 80。

## 5. 切片與 PR

### 5.1 切片表

PR 一律指向 `release/v0.4.5`，以 squash merge 合併。分支為 `feat/bots-ep-<slice>`，worktree 為 `.worktrees/bots-ep-<slice>/`。下表 `bots/` 代表 `packages/bots/`，`EP/` 代表 `packages/bots/src/modules/explorersPirates/`。

| 切片 | 分支／worktree slug | 內容 | 檔案所有權 | 行數 src／test | 依賴 | 驗收命令 |
|---|---|---|---|---|---|---|
| E0 平台接點 | `feat/bots-ep-e0-platform`／`bots-ep-e0` | N1、N2、N7；確認 N4、N5。E&P BotModule 骨架：`supports` 一律回 false，帶 `pacing` 與 `maxCommandsPerWindow` | `rules/src/index.ts`；rules movement.ts:42、economy.ts:90（只抽常數）；`bots/src/{heuristic,fallback,economy}.ts`；`bots/src/modules/types.ts`（主 agent 核可）；`EP/index.ts`；`server/src/bot-driver.ts`（若需要）；`bots/test/support.test.ts`、`server/test/bots.test.ts` | 120／100 | `release/v0.4.5` 已建立（v0.4.4 已發布） | `pnpm --filter @catan/rules exec vitest run`；`pnpm --filter @catan/bots exec vitest run`（含 PL-1 的 golden replay，base 行為必須不變）；`pnpm --filter @catan/server exec vitest run test/bots.test.ts`；`pnpm typecheck` |
| E1 底座與保底 | `feat/bots-ep-e1-duty`／`bots-ep-e1` | view 與 hints 存取器、幾何、`route.ts`（安全步 BFS）、剩餘庫存、`duty`（§4.1）。測試工具 `test/modules/explorersPirates.ts`：conservation、hideDifferently、perturb、responseCommands、mechanics、limits。保底的固定盤面測試；5 個 profile 的純保底局不停擺 | `EP/{view,geometry,route,inventory,duty}.ts`；`bots/test/modules/explorersPirates.ts`；`bots/test/ep-duty.test.ts`、`ep-route.test.ts` | 400／250 | E0 | `pnpm --filter @catan/bots exec vitest run test/ep-duty.test.ts test/ep-route.test.ts` |
| E2 Land Ho! | `feat/bots-ep-e2-land-ho`／`bots-ep-e2` | economy 掛點（`piecesLeft`、`routeEdge`、`awards`、`costs`、`scoreExtras`）；Action 候選與金幣、`endWindow`；Movement `phase`：遠征、探索期望值、`found`、`load`；棄牌；金幣估值（§4.7）。開放 core 部件，更新快照 | `EP/{plans,action,movement,explore,trade}.ts`、`EP/index.ts`；`bots/test/ep-land-ho.test.ts`、`ep-fair.test.ts`、`ep-decisions.test.ts`；`support.test.ts`（快照） | 650／280 | E1 | `pnpm --filter @catan/bots exec vitest run test/ep-land-ho.test.ts test/ep-fair.test.ts test/ep-decisions.test.ts test/support.test.ts`；再以 `BOTS_SEEDS=10` 跑 `test/ep-land-ho.test.ts` |
| E3 Pirate Lairs | `feat/bots-ep-e3-pirate-lairs`／`bots-ep-e3` | 變動式 `setup`；海盜 `answerFrame`（place、rob）；過路費與追逐；crew、巢穴與 hero；gold field 估值；`missions/index.ts` 目標註冊，附 fish 與 spices 的空殼。開放 pirates 與 lairs 部件 | `EP/{setup,pirate}.ts`、`EP/missions/{index,lairs,fish,spices}.ts`（後兩個是空殼）；`EP/movement.ts`、`EP/action.ts`；`bots/test/ep-pirate-lairs.test.ts`、`ep-pirate.test.ts` | 380／200 | E2 | 同 E2 的寫法，跑 `test/ep-pirate-lairs.test.ts test/ep-pirate.test.ts test/ep-fair.test.ts`，再以 `BOTS_SEEDS=10` 跑一次 |
| E4a Fish | `feat/bots-ep-e4a-fish`／`bots-ep-e4a` | 先擲魚、`loadFish`、在 Council anchor 交付；海盜避開自己的淺灘、嚇走對手的魚。開放 fish 部件 | `EP/missions/fish.ts`；`bots/test/ep-fish.test.ts`；部件清單與快照的所有權先交給 E4a | 180／100 | E3 | `pnpm --filter @catan/bots exec vitest run test/ep-fish.test.ts test/support.test.ts` |
| E4b Spices 與 Full | `feat/bots-ep-e4b-spices`／`bots-ep-e4b` | 香料農場 crew、sack、交付；三種能力（Swift 的 MP、Fast Gold、Pirate Bonus 的追逐數字）；Full 的任務優先序。開放 spices 部件 | `EP/missions/spices.ts`；`bots/test/ep-spices.test.ts`、`ep-full.test.ts`；部件清單與快照在 E4a 合併後才交給 E4b | 230／130 | E3；開發可與 E4a 並行，合併排在 E4a 之後 | `pnpm --filter @catan/bots exec vitest run test/ep-spices.test.ts test/ep-full.test.ts test/support.test.ts` |
| E5a server | `feat/bots-ep-e5a-server`／`bots-ep-e5a` | 「拒絕 Bot 席位」改為依 `botsCanPlay` 判斷。§4.7-5 四類案例：經 HTTP 打完一局 Land Ho!；保底接手海盜 frame；7 之後真人與 Bot 同時棄牌（多 responder）；海盜 frame 進行到 `rob` 時重啟後恢復。E&P 牌桌上限 80、`ep.*` 有節奏值 | `server/test/explorers-pirates.test.ts`（只改 66-74）；`server/test/explorers-pirates-bots.test.ts`（新檔） | 0／200 | E3；與 E4a、E4b 並行 | `pnpm --filter @catan/server exec vitest run test/explorers-pirates.test.ts test/explorers-pirates-bots.test.ts test/bots.test.ts` |
| E5b bench 與文件 | `feat/bots-ep-e5b-bench-docs`／`bots-ep-e5b` | bench 的 E&P 設定與指標（§6.3）；§7 的文件清單；工作紀錄；INDEX | `bots/bench/**`、`docs/**`、`README.md` | 150／0（另有文件約 120 行） | E4b、E5a | `pnpm --filter @catan/bots typecheck`；`pnpm --filter @catan/bots bench 50 --profile ep-full-2025`；`BOTS_SEEDS=10 pnpm verify` |
| R rules 修正 | `fix/rules-ep-strand`／`rules-ep-strand`（PR 指向 master） | `ep-2025.2`：修正擱淺死結並處理存檔相容（§4.5-3、#97） | `rules/src/modules/explorersPirates/{movement,index}.ts`、`rules/src/profiles.ts:255`、rules 測試、`server/test/explorers-pirates.test.ts:78`、FIDELITY、SPEC:274 | 由 Bugfixer 估計 | 無；rc 前合併到 master | `pnpm --filter @catan/rules exec vitest run test/ep-*.test.ts` |

合計 src 約 2,110 行、test 約 1,260 行（R 另計）。PR subject 範例：`✨ feat(bots): sail settlers and explore in land ho (#N)`、`✨ feat(bots): place pirates and capture lairs (#N)`。

### 5.2 依賴與並行

```
R ─────────────────────────────────────────────→ master → 併入 release/v0.4.5（rc 前）
E0 → E1 → E2 → E3 ┬→ E4a ──→ E4b（合併）┬→ E5b → rc
                   ├→ E4b（開發）─────────┘│
                   └→ E5a ─────────────────┘
```

共用檔案 `heuristic.ts`、`fallback.ts`、`economy.ts` 只在 E0 修改；E1–E4b 只動 `EP/**` 與自己的測試檔。E4a 與 E4b 並行時各自只擁有一個 mission 檔案；部件清單（`EP/index.ts` 的 `SUPPORTED_PARTS` 那一行）與 `support.test.ts` 快照依 E4a → E4b 的順序交接。

### 5.3 上線粒度：(a) 與 (b)

| 面向 | (a) 0.4.5 一次開放 5 個 | (b) 0.4.5 先開放 Land Ho! 與 Pirate Lairs，其餘移到 0.4.6 |
|---|---|---|
| 工作量 | E0–E5b，約 3,370 行 | 0.4.5 少了 E4a、E4b（約 −640 行）；0.4.6 要再跑一次 rc、Browser QA 與文件更新 |
| 「一版一個擴充包」 | 符合 | 不符合；整體策略 §5.2 已把它列為退路 |
| 風險所在 | 長局與死循環集中在 Fish、Spices、Full：fixture 的 full 3 人種子 5 無法終局，spices 3 人有一局 237 輪 | 只是推遲，沒有消除 |
| 依賴 | Fish 需要 Lairs 策略，Spices 需要 fish（C5），切點自然落在 E3 之後 | 同左 |
| gating 成本與文件 | 改 `SUPPORTED_PARTS` 一行；文件改一次 | 同樣一行；SPEC 的「Today that is」、FIDELITY、README 都要改兩次 |

**建議**：以 (a) 為基準、(b) 為預先約定的退路。觸發條件：E4b 合併後跑發布閘門（`BOTS_SEEDS=10`），若某個 profile 沒有通過 Q1 或 Q2，而且 2 個修正 PR 內仍無法通過，就把它的部件留在清單之外，移到 0.4.6。Land Ho! 在 E2、Pirate Lairs 在 E3 就已通過閘門，不受影響。

## 6. 測試與驗收

### 6.1 Q1 矩陣（發布閘門）

| profile | 人數 | 種子（CI／發布） | 座位 | 步數上限 | 看門狗 N（回合） | fixture 依據：健康局最大步數；輪數中位數（3 人／4 人） |
|---|---|---|---|---|---|---|
| land-ho | 3、4 | 3／10 | standard 與 easy 交錯；每個人數另跑 1 局「1 席保底，其餘 heuristic」 | 2,500 | 60 | 526；12.7／9.5 |
| pirate-lairs | 3、4 | 3／10 | 同上 | 4,000 | 60 | 945（3 人長尾 2,559）；27.7／16.5 |
| fish | 3、4 | 3／10 | 同上 | 6,000 | 60 | 1,651；24.3／18 |
| spices | 3、4 | 3／10 | 同上 | 6,000 | 60 | 1,758（3 人長尾 7,089）；24.7／22.8 |
| full | 3、4 | 3／10 | 同上 | 8,000 | 60 | 1,996（3 人長尾 5,767；種子 5 到 12,000 步仍未終局）；31／23.8 |

- **參數依據**：步數上限約為健康局最大值的 4–5 倍（推測：假設 Bot 的步數與 fixture 同一量級）。N=60 回合等於 3 人 20 輪、4 人 15 輪；健康局最長無得分區間 7.7 輪（≤ 25 回合），病態局在 55 輪以上（`q2.ts`），中間有 2 倍以上的間隔。E2–E4 以 Bot 實測重新校準，定稿值附在發布 PR。
- **每局斷言**：勝者達到 `victoryTarget`；0 次拒絕；`pending === null`。守恆：每種資源 19 張、金幣 148 枚、魚 6 份，棋子不超過 `EP_PIECES`；每邊最多 2 艘（豁免 C7）；每視窗指令 ≤ 80；擱淺死結 0 次；「策略閒置、但保底有動作」0 次；B-FAIR 通過；fuzz 不拋錯。
- **B-POLICY 合約**（E&P 的 `responseCommands`）：非行動者只送 `pending.discard` 與 `trade.respond`；Movement 中不送只限 Action 的指令（index.ts:81-84）；永遠不送 `setup.placeBuilding`、`setup.placeRoad`、`build.city`、`build.devCard`；只在別處沒有空位時才帶 `remove`；MVP 不送 `ep.unload`、`ep.swap`。
- **B-FAIR 擾動**：交換對手手牌（總數不變）；打亂 `pools.discs`、`abilities`、`lairTokens` 的順序；換一個遊戲 rng；view 有沒有附 40 筆事件，決策都必須相同（規則 8）。
- **CI 成本**：3 個種子共 30 局，加 5 局保底混局；每個 profile 一個測試檔，timeout 120 s。

### 6.2 Q2 門檻（發布閘門）

| profile | 每局下限（每個種子都要達到） | 平均每局下限 | fixture 對照：最小／中位（3 人；4 人） | 依據 |
|---|---|---|---|---|
| Land Ho! | Bot 在新島上 `ep.settlementFounded` ≥ 1（頂點不碰起始島）；`ep.explored` ≥ 4 | `ep.harborBuilt` ≥ 1.0 | 新島 2／2；6／7。探索 13／14；8／15。harbour 1／3 | 實測（fixture）；Bot 的值為推測 |
| Pirate Lairs | `ep.lairCaptured` ≥ 1；新島 found ≥ 1 | `ep.crewLanded` ≥ 3.0；`ep.chaseRolled` ≥ 1.0 | 攻下 1／3；2／4。crew 3／11；6／12。追逐 6／28；8／25 | 同上 |
| Fish | 交付魚、推進魚軌道 ≥ 1；`ep.fishRolled` ≥ 3 | 交付魚 ≥ 3.0；`ep.lairCaptured` ≥ 0.5 | 魚軌道 10／15；2／14。攻下 1／2；1／3 | 同上；`fishRolled` 為推測 |
| Spices | 交付香料 ≥ 1，而且交付魚 ≥ 1 | 交付香料 ≥ 2.0；香料農場 crew ≥ 2.0 | 香料軌道 3／5；4／11。魚軌道 4／8；9／22 | 同上 |
| Full | 三條軌道中至少 2 條有推進 | 每條軌道 ≥ 1.0 | 巢穴 6／9；3／11。魚 1／15；1／22。香料 1／9；4／10 | 同上 |

- **共同門檻**：非保底席的模組 frame 100% 由策略回答。每個（profile, 人數）中，easy 席與 standard 席各自至少發出一次 `ep.buildSettler`、`ep.moveShip`、`ep.found`；有任務的 profile 還要各自發出該任務的 `ep.dropCrew` 或 `ep.deliver`（SPEC §4.9）。
- **計數與調整**：由 `mechanics` 逐步累計 `applyCommand` 回傳的事件（測試可以讀事件，策略不行）；`state.log` 只保留最後 200 筆，不能在終局讀取。若 Bot 實測低於門檻但通過 Q1，調整門檻要經使用者同意（D4）。

### 6.3 Q3（bench，不擋發布）

每個 profile 跑 `3p 1 standard vs 2 easy`、`4p 1 standard vs 3 easy`、`4p 2 standard vs 2 easy`、`4p 4 standard`、`4p 3 standard vs 1 fallback`（0.4.4 的 Bot 不會玩 E&P，以保底席代表「上一版」）。每組 50 局，Land Ho! 100 局；例如 `pnpm --filter @catan/bots bench 50 --profile ep-land-ho-2025`。

| 指標 | soft target | 依據 |
|---|---|---|
| standard 勝率（1 席 standard 對 easy） | 3 人 ≥ 50%、4 人 ≥ 40%（公平份額為 33% 與 25%） | 推測 |
| 保底席勝率 | 0% | 保底從不建造 |
| 平均輪數 | ≤ 1.5 倍 fixture 中位數（§6.1） | `q2.ts` |
| 每視窗指令數 | p95 ≤ 40，最大 ≤ 60（上限 80） | §4.9 |
| decide 耗時 | 平均 ≤ 2 ms，最大 ≤ 50 ms（在低負載下量測） | 推測；每座位投影 0.055–0.115 ms（第 1 輪） |
| Bot 回合秒數（依節奏表換算） | 平均 ≤ 12 s | §4.9 |
| fallback 次數、拒絕、死結 | 0 | Q1 |
| 只報告 | `ep.moveShip` 佔比、跳過 Movement 的比例、探索次數與一步揭露多格的比例、勝者 VP 組成（plain、harbour、各軌道）、金幣峰值 | 第 1 輪 §7.4 |

### 6.4 I9 固定盤面測試（DoD §6-2）

每個案例以 fallback、standard、easy 各跑一次，斷言 `applyCommand` 接受：setup 的 harbour、settlement、route（先放路，以及先放船）；海盜 place（cause 為 `seven`；cause 為 `chase`，要排除 `from`）；海盜 rob（2 名 candidates）；棄牌；Action 子階段的 `turn.end`；Movement 的 `turn.end`；擱淺（有非滿格步、只有可出口的滿格步、有羊毛、有 settler 可建、全都沒有——在 `ep-2025.1` 下回 null，在 `ep-2025.2` 下依修法而定）。

> 已被 #97 的維護者決策取代（2026-11-05）：上段擱淺「全都沒有」一項不再依 `ep-2025.1`／`ep-2025.2` 區分結果。兩版行為相同：無出口時 `stranded` 為 false、`canEndTurn` 為 true，保底送 `turn.end` 會被接受，不會回 null。

## 7. 文件與發布

行號依 v0.4.0；0.4.1–0.4.4 會先改動其中幾行，E5b 開工時要重新定位。

| 檔案:行 | 修改 |
|---|---|
| `docs/SPEC.md:188` | Rulesets 的「Today that is …」加入 5 個 E&P profile；若此時已全數支援，改寫為「every enabled profile」 |
| `docs/SPEC.md:274` | E&P 合約末句「Bots refuse E&P rooms.」改為「Bots play every mission (v0.4.5).」；是否同時澄清 Pirate Lairs 的開局措辭見 §10 E5 |
| `docs/FIDELITY.md:36-40` | 各 profile 列註記 Bot 席位，寫法比照前幾版 |
| `docs/FIDELITY.md:68` | 「bots refuse E&P rooms」改寫，並指向 Bot 證據 |
| `docs/FIDELITY.md:112` | R-EP games 列的「bots refused」改為 Bot 證據：`packages/bots/test/ep-*.test.ts`、`server/test/explorers-pirates-bots.test.ts` |
| `docs/API.md:141-145` | Bot 支援的說明與範例清單 |
| `README.md:158-163`、`README.md:176-177` | E&P 條目加上 Bot 註記；若「Bot seats are not offered for the expansions」仍在，這一版移除 |
| `docs/aegis/specs/2026-11-01-bot-opponents.md:14-17`、§5 規則 7 | 更新範圍；保底表改為引用本計畫 §4.1 |
| `docs/aegis/work/<date>-bots-explorers-pirates.md`、`docs/aegis/INDEX.md` | 新增工作紀錄，並在 INDEX 加一列 |
| rules 修正 PR（R） | 由該 PR 自行負責：`profiles.ts:255`、SPEC:274 的移動規則句、FIDELITY 的 interpretation、`server/test/explorers-pirates.test.ts:78` |

- **發布流程**（整體策略 §7）：v0.4.4 stable 發布後從 master 建立 `release/v0.4.5` → 各切片 PR 指向它、squash merge → master 有修正（包括 R）時以 merge 方式併入 → `v0.4.5-rc.1`，用 rc 映像試玩 → stable 前跑 `BOTS_SEEDS=10 pnpm verify` → 以 merge commit 併入 master。
- **Browser QA**：5 個 profile 都要從大廳建房、加入 easy 與 standard 電腦、開局後觀察數個 Bot 回合。要看到的機制：Land Ho! 的 `ep.startMovement`、船的移動、`found`；Pirate Lairs 的放海盜、crew；Fish 的擲魚、交付；Spices 的香料農場 crew；Full 的三項任務。E&P 沒有 paired profile。截圖放在 `.tmp/`，不提交（D10）。

## 8. Paseo 分工

派工前以 `list_profiles` 的實際結果為準。

| 工作 | 角色 | 隔離 | 審查 | 備註 |
|---|---|---|---|---|
| 開工前刷新計畫 | Planner | 共用工作區 | — | 依 0.4.1–0.4.4 的實際介面，更新 §4.8 與 §5 的行號；唯讀 |
| E0 | Implementer (Backend)；`modules/types.ts` 的變更由主 agent 先核可 | `.worktrees/bots-ep-e0/` | Architect（N1、N4 合約）＋Reviewer (Opus) | golden replay 必須不變 |
| E1 | Implementer (Backend) | `.worktrees/bots-ep-e1/` | Reviewer (Sol)：重點是 I9 與保底合法性 | — |
| E2 | Implementer (Backend) | `.worktrees/bots-ep-e2/` | Reviewer (Opus)：重點是決定性、B-FAIR 與規則 9 | — |
| E3 | Implementer (Backend) | `.worktrees/bots-ep-e3/` | Reviewer (Sol) | — |
| E4a、E4b | 兩個 Implementer (Backend) 並行 | 各自的 worktree | 各配一位 Reviewer | 部件清單與快照依序交接 |
| E5a | Implementer (Backend)，只改 server 測試 | `.worktrees/bots-ep-e5a/` | Reviewer (Sol) | 與 E4a、E4b 並行 |
| E5b | QA 負責 bench 與 `BOTS_SEEDS=10` 矩陣；主 agent 負責文件 | `.worktrees/bots-ep-e5b/` | Reviewer | — |
| R | Bugfixer (Backend) 修正 → Fix Verifier 驗證 | `.worktrees/rules-ep-strand/` | Fix Verifier | 與 E0–E3 並行，rc 前合併 |
| rc 試玩 | Browser QA | 共用工作區 | — | §7 |
| rc／stable 的 tag 與 Release | Release Manager | — | — | 需要使用者明確授權 |

順序：R 與主線並行；主線為 E0 → E1 → E2 → E3 → {E4a ∥ E4b（開發） ∥ E5a} → E4b 合併 → E5b → rc → stable。限制：subagent 不 push、不改 lockfile；對合約有疑義時回報主 agent，不自行修改；閒置的 agent 寫交接筆記到 `.worktrees/_handoff/` 後停止。

## 9. 風險

| # | 風險 | 對策 |
|---|---|---|
| ER1 | 擱淺死結（R7）：Bot 規劃出錯，或遇到 `ep-2025.1` 的舊存檔 | §4.5 的規避規則與測試；保底脫困；server 診斷；rules 修正 |
| ER2 | 死循環與長局（R8） | §4.6；看門狗 N=60；依 profile 的步數上限 |
| ER3 | 每視窗指令數逼近上限（R4） | 上界推導約 75 < 80；bench 報 p95；超過上限時保底仍然合法 |
| ER4 | 測試時間：5 個 profile，Full 的對局最長（R5） | 拆檔並行；CI 用 3 個種子；timeout 120 s；高負載下的耗時只作參考 |
| ER5 | 0.4.1–0.4.4 實作的平台介面與本計畫的假設不同 | 開工前由 Planner 刷新；N1–N8 不足之處由 E0 以相容方式補上 |
| ER6 | Q2 門檻以 fixture 為依據，Bot 的實際值未知 | E2–E4b 各自量測；要放寬門檻須經使用者同意 |
| ER7 | 任務供應耗盡，例如巢穴被攻完、sack 用完 | 目標過濾；交付後魚會回到供應（movement.ts:355），Full 仍能靠魚軌道推進 |
| ER8 | `LAIR_TOKENS` 是暫定值 | 讀匯出的常數 |
| ER9 | 真人用含金幣的報價佔 Bot 便宜（R9） | 規則 9 加上金幣估值（§4.7） |
| ER10 | rules 修正延誤 | Bot 端的規避已足以通過 Q1（C3），修正主要保護真人玩家，見 §11 D-3 |

## 10. 待使用者決定的事

| # | 決策 | 建議 |
|---|---|---|
| E1 | 上線粒度 | 以 (a) 為基準，(b) 為退路，觸發條件見 §5.3 |
| E2 | Q2 門檻（§6.2） | 先採用表列數值；E2–E4b 以 Bot 實測校準，在發布 PR 定稿 |
| E3 | 節奏與上限（§4.9） | 採用表列節奏值，例如 `ep.moveShip` 400 ms；每視窗上限 80（整體策略 D8） |
| E4 | 金幣估值與回應（§4.7） | 1 金估為 0.4 張資源；保留 1 枚；不主動提出含金幣的報價（D6） |
| E5 | SPEC:274 的「Land Ho! and Pirate Lairs use their printed start (fixed setup)」 | 在 E5b 澄清為「Pirate Lairs：印刷盤面、變動式放置」（C8）。這只是文件修正，不改規則 |
| E6 | rules 修正是否為 0.4.5 的硬依賴 | 照整體策略在 rc 前合併，但不擋 Bot 發布（§11 D-3） |
| E7 | rules 修正的方式 | 建議用預防式，較貼近 EP25 p. 10「may not end its movement there」；Bot 端兩種修法都相容。各修正選項，以及已卡住存檔的處理方式，見 #97 |
| E8 | MVP 延後的項目 | 延到之後的 patch：harbour 中轉（unload、swap）、主動提出含金幣的報價、海盜阻擋戰術、hero 最佳化、聰明換船 |

## 11. 與整體策略的差異

> 2026-11-04：D-1 到 D-5 都已併入整體策略（§2.3 G-A、§4.1、§4.4、§4.7-5、§4.9、§5、§9 R7、§10 D5）。D-1 與 T&B 計畫的 `economy.awards` 統一，E&P 沿用 0.4.4 的鉤子。Q2 計數依策略 §4.6 改為逐步累計事件。下列各項保留原始論證。

| # | 整體策略 | 本計畫 | 證據 |
|---|---|---|---|
| D-1 | §4.1 的 `economy` 鉤子只有 `cardKinds`、`costs`、`piecesLeft`、`hexYield`、`routeEdge`、`scoreExtras` | 關掉 base 的最長道路計畫。原提案為新增 `economy.basePlans`（允許的 base 計畫種類，組合時取交集；E&P 設 `['settlement']`），整合時與 T&B 的同類需求統一為 `economy.awards`（N4） | base 會在 E&P 規劃 longestRoad（economy.ts:259-280），但 E&P 沒有最長道路（index.ts:129-132），現有鉤子關不掉它。city 與 devCard 不受影響：`piecesLeft.cities = 0` 與 `devDeckSize = 0` 已自然關掉（economy.ts:194、248）。鉤子在 0.4.4 由 T&B 的 S1 建立並審查 |
| D-2 | §4.4：E&P 以 `missions` 判定是否支援 | 部件改為 `missions` 加上 `pirates`；人數 > 4 時也回 false | Spices 的任務不含 lairs，但有海盜 frame 與追逐（boards.ts:252-253）。CN3086 的 5–6 人尚未實作（SPEC:274 Deferred），屬於未知部件，依 §4.4 應該擋下 |
| D-3 | §5 與 R7：rules 修正是 0.4.5 的依賴，要在 0.4.5 之前完成 | 仍建議在 rc 前合併，但不列為 Bot 發布的硬依賴 | 擱淺只會由行動者自己的移動造成（C3），Bot 靠規劃避開就能通過 Q1；修正保護的是真人玩家，與 Bot 是否上線無關 |
| D-4 | §5：規模約 3,300 行 | 約 3,370 行 | 多出來的是 server 測試，約 200 行（§5.1） |
| D-5 | §4.7-5：server 測試要涵蓋「多 responder frame 中真人與 Bot 並存」 | E&P 改用 7 之後的 base 棄牌 frame 來測 | E&P 唯一的模組 frame（海盜）只有一位 responder（pirate.ts:27-29） |
