# Seafarers + Cities & Knights 電腦對手：實作計畫（v0.4.3）

日期：2026-11-04。狀態：**建議計畫，待使用者確認 §10。**

本文件是 Aegis 工作紀錄，不是權威的執行期決策；權威需求以 `docs/SPEC.md` §4.9 為準。

前置閱讀：

- 整體策略 `docs/aegis/plans/2026-11-04-expansion-bots-roadmap.md`（以下簡稱「策略」），特別是 §3.1、§4.1–4.9、§6–§8。
- SF 計畫 `docs/aegis/plans/2026-11-04-bots-seafarers.md`（v0.4.1）；C&K 計畫 `docs/aegis/plans/2026-11-04-bots-cities-knights.md`（v0.4.2）。
- bot 規格 `docs/aegis/specs/2026-11-01-bot-opponents.md`（I1–I9、§5 合約）。
- rules：`packages/rules/src/modules/seafarersCitiesKnights/index.ts`（以下簡稱 `sfck/`）；`docs/FIDELITY.md` 的 R-COMB 列（`:127-137`）與 SFCK 詮釋（`:469-523`）；`docs/SPEC.md:292`。

證據：基準為 `a200840`。第一輪報告收錄在 `docs/aegis/work/2026-11-04-bots-seafarers-cities-knights-research.md`；本輪探查放在 `/tmp/katan-bot-research/seafarers-cities-knights/`（附錄），不提交。本輪 `q2-calibrate.ts` 共 84 局（load 0.5–1.2），耗時只是參考值，結論只依步數、局數、拒絕數與機制計數。原型是**天真組合**（組合層、SF 最小造船、C&K 核心與天真 F1 打卡），用來估門檻的量級，不是提案程式碼。

路徑縮寫：`B/` = `packages/bots/src/`；`sf/`、`ck/` = `packages/rules/src/modules/{seafarers,citiesKnights}/`；`engine.ts` = `packages/rules/src/engine.ts`。

**要點**

1. **組合層很薄**：SFCK 模組只負責收窄強盜與海盜目標、追擊海盜，以及仲裁 SF 與 C&K 在 setup、騎士位置上的衝突。它沒有自己的 `duty`，保底由 base 加上 SF、C&K 的 duty 完成。
2. **強盜／海盜目標**：沿用策略即將採用的 `robberTargets` fold，元素型別推廣為 `number | null`，**初值改為完整的盜賊預設**（陸地強盜格、海上海盜格、外框 `null`）。SFCK 只做收窄。不新增 `banditTargets`，第一輪的提議撤回（§4.2、§11-1）。
3. **平台需要一個小切片**（SFCK-P，src 50–90 行）。0.4.3 因此不是「只有組合層」（§11-2）。
4. **Q2 改用兩類規則**：sim 能覆蓋的機制採局數門檻；sim 覆蓋不到的機制（追擊海盜、金礦城市、`either` 時移海盜）以固定盤面守門（§6.2、§11-4）。

## 1. 目標與範圍

| 項目 | 內容 |
|---|---|
| profile | `sf-ck-new-shores-2025`：3–4 人，`fixed`（`packages/rules/src/profiles.ts:457-478`） |
| | `sf-ck-new-shores-paired-2025`：5–6 人，`variable`（`:485-511`） |
| 規則 | `ruleModules` 為 `['seafarersCitiesKnights','seafarers','citiesKnights']`（`:460`、`:489`）；`sf-ck-2025.1`；16 VP |
| 同版交付 | SFCK-X、SFCK-P、SFCK-1、SFCK-2、SFCK-3、SFCK-G。若 CK-C 延到本版，也一併交付（§5.2） |
| 目標 | 兩個 profile 的 3–6 人都能加入 easy 與 standard，並通過 Q1 與 Q2。兩種難度都會造船登島、招募並啟動騎士、改良城市；standard 會追擊海盜。每個 frame 與強制動作都有保底 |
| 非目標 | 策略 §1.3 全部；SF 與 C&K 各自已規劃的內容（只引用，不重寫）；`sfck-sim.ts` 計數問題（§10 D-SC10）；海盜騷擾、騎士封鎖航線等進階戰術（延到 0.4.x 調參） |

## 2. 現況與落差

### 2.1 依賴的 0.4.1／0.4.2 交付

| 交付 | 來源 | SF+CK 的用途 |
|---|---|---|
| `BotCommand`；registry；`answerFrame`、`duty`、`setup` 依序詢問；`actions`、`banditCandidates` 串接 | PL-1 | 組合骨架 |
| harness `newBotGame({ profileId })`；仿 BotDriver 模式；看門狗；`test/modules/<id>.ts`；`BOTS_SEEDS`；`bench --profile` | PL-2 | Q1、Q2、Q3 |
| `BOT_PACING`；依 profile 的上限；「欠動作卻沒有動作」的診斷 | PL-3 | 節奏與診斷 |
| `sea.ts`：船位模擬、兩套 BFS、含船的路線長度；`blocker?` callback 掛點 | SF-1（SF 計畫 §4.3） | 海路規劃 |
| SF 的 `duty`：gold、freeRoads 船分支、setup 放船 | SF-1 | 保底 |
| 島嶼計畫（SF-2a）；`banditCandidates` 海盜評分與 setup 評分（SF-2b） | SF-2a、SF-2b | 策略 |
| SF 模組測試工具 | SF-3 | 組合測試工具 |
| 型別匯出 | RX、CK-A | 型別 |
| CardKind 手牌；14 種 frame 的保底；`economy.{cardKinds,rates,weights,costs,hexYield,vertexBlocker,siteBlocked}` | CK-B1 | 保底與模型 |
| 防禦、改良、騎士、F1 卡、第 2 輪城市；`knights.ts` 匯出的候選建構函式（C&K 計畫 §4.9） | CK-B2 | 策略 |
| C&K 模組測試工具 | CK-B1 | 組合測試工具 |

**前提**（§8 步驟 0 由 Planner 依 0.4.2 合併後的程式核對）：

| # | 前提 | 若不成立 |
|---|---|---|
| A1 | `sea.ts` 的 `blocker` 是 options 物件中的欄位，預設回 null | SFCK-P 以相容方式加上 |
| A2 | CK-B1 的 `hexYield` 對非 `TERRAIN_COMMODITY` 地形回 `undefined` | SFCK-P 修正為 §4.6 的組合規則 |
| A3 | SF 的島嶼計畫以 `isFreeSpot` 判定空點，因此 C&K 的 `siteBlocked` 自動生效 | SFCK-2 補上 |
| A4 | SF 的 setup 評分、C&K 的第 2 輪城市評分是可以匯出的純函式 | SFCK-2 只補 `export` |
| A5 | SF 的城市計畫把金礦當萬用點數計價（金礦城市拿 2 張，`sf/gold.ts:38`） | 這是 SF 單獨也存在的缺陷，在 SFCK-2 以 SF 測試修正，並回報 SF 計畫 |

### 2.2 落差（第一輪結論經本輪核實）

| # | 落差 | 證據 | 處理 |
|---|---|---|---|
| G-SC1 | 投影的 `moveRobber` 沒有 pirate 旗標，只有 `bandit` hint 能分辨三種 frame；SF 的 `pirateTargets`、`robberTargets` 沒有被收窄 | `packages/rules/src/project.ts:175-176`；`sfck/index.ts:180-182`；`sf/index.ts:98-102`。第一輪 naive：4/40 局無限退避（`E_ILLEGAL_TARGET/pirate`） | §4.2 fold（SFCK-P、SFCK-1） |
| G-SC2 | `robberTargets` 的 fold（取代語意）排在 0.4.4，但 0.4.3 就需要 | 策略 §4.9 | SFCK-P 提前實作（§11-2） |
| G-SC3 | `sea.ts` 的船 BFS 與路線長度沒有算入騎士 | 第一輪：不含騎士時 164/8,353 個窗口（2.0%）與 rules 不一致；加入騎士 blocker 後為 0 | SFCK-P：`blocker` 預設改為組合後的 `vertexBlocker` |
| G-SC4 | **setup 被覆蓋（已確認，不再是推測）**：策略 §4.2 規定 `setup` 由第一個非 undefined 者勝出；SF 的 `setup` 回答每一輪的 setup building；C&K 的第 2 輪城市評分只在 C&K 的 `setup` 中。依順序 sfck → sf → ck，C&K 的評分永遠不會被問到 | 策略 §4.2；SF 計畫 §4.2 setup building 列；C&K 計畫 §4.1、§4.3；`profiles.ts:460`；第 2 輪放城市見 `ck/index.ts:89-92` | SFCK-2 由組合模組攔截並合成（§4.4） |
| G-SC5 | `hexYield` 沒有組合規則；COMB-8 規定金礦城市拿 2 個資源、沒有商品 | `ck/production.ts:41`（金礦沒有 `TERRAIN_RESOURCE`，直接跳過）；`sf/gold.ts:38`（城市 2 張）；策略 §4.2 沒有這一列 | §4.6 規則；A2、A5 |
| G-SC6 | 騎士與船的衝突 | 自己的騎士站在自己的船 open end 上，該船就不能移：佔 SF 模型認為「可移」窗口的 14%（363 個）；任何騎士都會擋住建地：166 個窗口中，自己的騎士站在可蓋的小島空點上。依據：`sfck/index.ts:121-125`、`ck/index.ts:126-128` | SFCK-2 以 `rescore` 仲裁（§4.4） |
| G-SC7 | 沒有任何模組會送 `knight.chasePirate` | `sfck/index.ts:98-110` | SFCK-2（§4.5） |
| G-SC8 | 3 人局的改良等級偏低：16 VP 多半靠島嶼取得，2/10 局桌上最高改良等級只有 2，C&K 的 M2「每局 ≥ 3」會失敗 | `out/q2-mixed.txt`（種子 6、10） | §6.2 的 C2 調整門檻 |

## 3. 介面摘要（只列策略與保底需要的部分）

| 項目 | 事實 | 證據 |
|---|---|---|
| 新指令 | `knight.chasePirate {vertex}`：只能在行動窗口、首攻之後使用；騎士必須是 active、可行動，且相鄰海盜 hex。騎士倒下後，排入 `{kind:'moveRobber', cause:'knight', pirate:true}` | `sfck/index.ts:98-110`（106、108）、`:167-170` |
| 覆寫指令 | `ship.move`：船只剩被騎士壓住的 open end 時，回 `E_SHIP_PINNED_BY_KNIGHT`。對手騎士在任一端也會釘住船 | `sfck/index.ts:121-138` |
| `bandit` hint | 三種值：`pending.pirate` 時為 `'pirate'`；`cause === 'knight'`（或首攻前）時為 `'robber'`；其他情況（首攻後擲出 7）為 `'either'` | `sfck/index.ts:182` |
| 首攻前 | 強盜在 -1，海盜在外框。擲 7 只棄牌，不出 `moveRobber`。`pirateChase` hint 為空 | `sfck/index.ts:146-148`、`:89-90`；`engine.ts:1091` |
| 盜賊合法性 | 強盜：陸地格，且不是目前所在格；rules 以 fold 計算（`engine.ts:1461-1472`），目前只有 T&B 實作 | `sfck/index.ts:62-81`（73、75、79） |
| | 海盜：海格，且不是目前所在格；海盜在場上時再加上 `null`（`sf/pirate.ts:13-21`） | |
| | SFCK 的 veto：追強盜不可移海盜，追海盜不可移強盜，首攻前不可移海盜 | |
| 船與騎士的 hints | `legalShips`、`movableShips` 已反映騎士阻擋與釘船 | `sf/ships.ts:72`、`:111-144` |
| 騎士的 hints | 騎士移動可沿船、可停在全海路口（`knightReach`）；`recruitSites` 含經由船連到的陸地路口 | `ck/knights.ts:80-108`、`:119-127` |
| 金礦 | 金礦算作產出，aqueduct 不補牌；金礦 frame 排在 aqueduct 補牌之前；merchant 不可放金礦 | `sfck/index.ts:153-159`、`:163-165` |
| 免費路線 | 容量使用 C&K 的 `freeRouteCapacity`：道路加上船 | `engine.ts:651-655`、`:1259-1263` |
| setup | 第 2 輪放城市，之後可以 `setup.placeShip` | `ck/index.ts:89-92`；探查 `facts.ts` |
| rules 型別 | SFCK 沒有匯出 view 與 hints 型別 | `packages/rules/src/index.ts` |

## 4. 設計

### 4.1 BotModule 對應（`B/modules/seafarersCitiesKnights/`）

| 鉤子 | 檔案 | 內容 | 切片 |
|---|---|---|---|
| `robberTargets`（fold） | `targets.ts` | 依 `bandit` 收窄（§4.2） | SFCK-1 |
| `actions` | `chase.ts` | `knight.chasePirate` 候選（§4.5） | SFCK-2 |
| `setup` | `setup.ts` | 只攔截 setup building，合成 base、SF 與 C&K 的分數；road 階段回 undefined，交給 SF | SFCK-2 |
| `rescore`（新增） | `rescore.ts` | 騎士位置的罰分（§4.4） | SFCK-2 |
| `supports` | `index.ts` | 回傳 `SFCK_BOTS_RELEASED`（SFCK-G 才改為 true）。`botsCanPlay` 會要求 `ruleModules` 中的每個 id 都已註冊，因此三個模組都必須存在（策略 §4.4、§4.9） | SFCK-1 → G |
| `pacing`、`responseCommands` | `index.ts` | `{ 'knight.chasePirate': 900 }`；沒有回應指令 | SFCK-1 |
| `duty`、`answerFrame`、`economy.*` | — | 不使用。frame 全部屬於 base、SF 或 C&K | — |

### 4.2 強盜／海盜目標：`robberTargets` fold

- **介面**：`robberTargets?(view, selfId, targets: readonly (number | null)[]): readonly (number | null)[]`。依 `profile.ruleModules` 順序 fold，比照 rules 的 `legalRobberHexes`（`engine.ts:1461-1472`）。
- **初值（「盜賊預設」）**：由平台依序計算：① 陸地 hex 且不是 `view.board.robber`（與 rules 初值相同，`engine.ts:1463`）；② 海 hex 且不是 `view.board.pirate`；③ `view.board.pirate !== null` 時加上 `null`。②③ 等同 `sf/pirate.ts:13-21`。base 沒有海格、海盜為 null，所以初值與現行完全相同。
- **用途**：fold 的結果就是本次 `pending.moveRobber` 的完整合法集合，策略與保底共用。保底取第一項。策略把 base 的強盜候選（集合中的陸地項）與各模組的 `banditCandidates` 都以集合過濾後統一評分；過濾後若沒有候選，直接採用第一項（算策略的決定，不算「策略閒置」）。
- **為什麼海盜目標要放在初值**：SFCK 排在 fold 的第一位。若改由 SF 在 fold 中擴大集合，SF 排在 SFCK 之後，會把 SFCK 在 `'robber'` frame 剔除的海盜目標加回來；純集合也無法區分「沒人提到海盜」與「明確禁止海盜」。海盜目標放在初值後，SF 不必參與 fold（SF 計畫不變），SFCK 只需要收窄。
- **SFCK 的 fold 步驟**（`targets.ts`）：

  | `bandit` | 回傳 | 合法的依據 |
  |---|---|---|
  | `'pirate'` | `targets` 中的海 hex 與 `null` | `sfck/index.ts:79` 拒絕陸地；chase 要求相鄰海盜，所以海盜一定在場上，集合必含 `null` |
  | `'robber'` | `targets` 中的陸地 hex | `:75` 拒絕海格與 `null` |
  | `'either'` 或 `null` | `targets` 原樣 | 兩者皆可；陸地排在前面，保底因此一律移強盜 |
- **空集合**：「base 保底遇到空集合時回 `undefined`」這條規則**不需要**。集合是完整的合法集合，為空時沒有任何模組的 duty 能做得更好；SFCK 收窄後的集合在三種 frame 中都不會是空的；T&B 的 FR 在沒有合法格時會回沙漠（`tradersBarbarians/variants/friendlyRobber.ts:34-40`）。base 保底遇到空集合時回 `null`，交給 server 的診斷與重試（策略 §4.7-4）。SFCK-1 以真值表斷言集合非空，且等於 rules 的合法集合。
- **easy**：SF easy 不提供海盜候選（SF 計畫 D-SF2），所以 `either` 時只移強盜。easy 不追擊海盜，因此不會遇到 `'pirate'` frame。

### 4.3 保底表（I9；合約規則 7）

順序：base 的 `pendingDuty`（套用 `cardKinds` 與 §4.2 的集合）→ SF 的 `duty` → C&K 的 `duty` → `turn.roll`／`turn.end`；SFCK 沒有 `duty`。下表涵蓋 SF+CK 會出現的每一種 frame 與強制動作；「探查」欄引用 `duty-fixtures.ts`（F1–F11）與 `q2-calibrate.ts`。

| frame 或強制動作 | 最小動作 | 為何必定合法 | 證據（探查） |
|---|---|---|---|
| setup building（第 1 輪聚落、第 2 輪城市） | `legalSettlements[0]` | hints 只列主島；第 2 輪仍送 `setup.placeBuilding` | `ck/index.ts:89-92`；SF 計畫 §4.1 |
| setup road（含第 2 輪城市之後） | 有 `legalRoads[0]` 時放路，否則 `setup.placeShip setupShips[0]` | 兩份清單都來自 hints；setup 不收費 | `facts.ts`：城市之後 `setupShips` 非空 |
| preroll | `turn.roll` | 不會打 Alchemy | C&K 計畫 §4.2 |
| `discard`（含 commodity，也含首攻前的 7） | 依 `CARD_KINDS` 順序展開手牌，交出前 `required[self]` 張 | 應棄張數依總牌數計算；engine 接受 CardKind | F4：base 被拒 `E_INVALID_DISCARD_COUNT`；組合保底成功，之後 pending 為 null、`robber = -1` |
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
| `either` 時選強盜或海盜 | base 的強盜候選與 SF 的 `banditCandidates` 經 §4.2 集合過濾後，以同一尺度（勝利分當量 ÷ (1 + eta)）評分 | 只移強盜 | `robberTargets` |
| setup building | 攔截並合成：`setupSpotScore`（base）加 `islandSetupBonus`（SF）加第 2 輪的 `citySetupScore`（C&K，含「至少相鄰 ore 或 grain」）。road 階段回 undefined，交給 SF 決定放路或放船 | 同 standard，topK 3 | `setup` |
| 騎士位置：小島空點 | 對 `knight.recruit {vertex}`、`knight.move {to}`、`knight.displace {to}` 的目標加罰分：若目標是自己現行島嶼計畫的建地，罰分等於該計畫價值。站在那裡會擋住自己蓋房（`ck/index.ts:126-128`） | 同 standard（避免自我阻擋，P9） | `rescore` |
| 騎士位置：船的 open end | 目標若是 SF 移船計畫中葉端船的 open end，罰 0.3 VP 當量（推測） | 不罰，因為 easy 不移船 | `rescore` |
| 追擊海盜 | §4.5 的保守條件 | 不追擊 | `actions` |
| 金礦城市 | 依 §4.6 的 `hexYield` 規則：金礦城市值 2 點萬用、沒有商品；森林城市值 1 lumber 加 1 paper | 同 standard | 平台與 A5 |
| aqueduct（科學 3 級）的估值 | 「沒有產出」的機率要把金礦算作產出（`sfck/index.ts:153-159`）。若 C&K 依組合後的產出計算，就自動成立；由 SFCK-2 以測試確認 | 同 standard | — |
| Road Building 卡、Merchant | 交給 C&K 計畫 §4.9：打牌條件看組合後的免費路線，merchant 只從 `targets.hexes` 選 | 同 standard | — |

**仲裁原則**：組合模組只調整分數（`rescore`），不新增或移除其他模組的候選，合法性仍只看 hints（P2）；防禦與追擊海盜的取捨，在 SFCK 自己的候選條件中處理（§4.5）。

**easy 的取捨與 P9**：easy 造船登島（SF easy）、防禦與改良（C&K easy），加上小島空點罰分；不追擊海盜、不移船，`either` 時只移強盜。實測全 easy 20 局全部終局（3–6 人各 5 局，每局 9.7–43.8 輪），每局都有付費造船，也都有人拿到小島加分（`out/q2-alleasy.txt`）。

### 4.5 `knight.chasePirate`（SFCK-2，`chase.ts`）

**保守條件**：全部成立才產生候選，而且只限 standard。

| # | 條件 | 依據 |
|---|---|---|
| K1 | `hints.modules.seafarersCitiesKnights.pirateChase` 非空 | `sfck/index.ts:89-95` |
| K2 | 海盜 hex 至少鄰接 1 艘自己的船，或在 SF 計畫的下一條船邊上 | 解除封鎖的價值，沿用 SF 的海盜評分 |
| K3 | 蠻族距離 `CK_BARBARIAN_TRACK_LENGTH − position ≥ 3` | 原型以「≥ length − 2 時不追」實測 0 拒絕、40/40 終局 |
| K4 | 追擊後，自己 active 騎士的等級和仍不少於自己的城市數（含大都市）；自己沒有城市時免檢查 | 騎士會倒下（`:106`）；對應 C&K 的個人理性防禦（D-CK1） |
| K5 | 選等級最低的追擊騎士；平手時選 vertex 最小者 | P4 決定性 |
| K6 | 分數 = SF 的解除封鎖價值 + 預期偷牌 − 騎士等級 × 防禦當量 − 1 grain 的重新啟動成本，而且 > 0 | 同一尺度 |

追擊之後的 `'pirate'` frame 由 §4.2 的集合與 SF 的海盜評分處理。固定盤面 FX-C1 到 FX-C6 見 §6.3。

### 4.6 對平台與 rules 的需求；策略 §4.2 的修訂提案

| 需求 | 內容 | 落點 |
|---|---|---|
| `robberTargets` fold | 元素型別推廣為 `number \| null`；初值為完整的盜賊預設；集合同時過濾 base 的強盜候選與 `banditCandidates`；過濾後為空時取第一項 | SFCK-P（從 0.4.4 提前，§11-2） |
| `rescore?(turn, candidate): number` | 新增。所有模組的差值相加，只調整 `actions` 候選的分數 | SFCK-P；型別由主 agent 修改 `B/modules/types.ts` |
| `sea.ts` 的 `blocker` 預設值 | 改為組合後的 `economy.vertexBlocker`（C&K 的對手騎士），套用在船 BFS、船位模擬與含船的路線長度。options 物件只增欄位，與 E&P N8（可通行性、停留限制、終止邊、成本）相容 | SFCK-P；`sea.ts` 在 0.4.3 只屬於 SFCK-P |
| rules 匯出 | `SeafarersCitiesKnightsView`、`SeafarersCitiesKnightsHints`、`SfckBandit` 型別；`SEAFARERS_CITIES_KNIGHTS` 常數；`ModuleViewMap` 的對應項。做法是把 `project`／`actionHints` 抽成具名函式（P8） | SFCK-X |
| 不需要 | 新 hints、規則修正、`moveRobber` 投影補 pirate 旗標、「首攻前海盜不活動」的掛點（首攻前不會出現 moveRobber，`pirateChase` 也為空；回答 SF 計畫 §4.3 的推測） | — |

**建議併入策略 §4.2 組合規則表的列**：

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
| **SFCK-P** 平台鉤子 | `feat/bots-sfck-hooks`／`.worktrees/bots-sfck-hooks/` | `B/heuristic.ts`、`B/fallback.ts`、`B/sea.ts`（0.4.3 期間獨占）；`packages/bots/test/sfck-hooks.test.ts`（新）；`B/modules/types.ts` 由主 agent 修改 | §4.2 的 fold 與過濾；`rescore` 的組合；`sea.ts` 的 blocker 預設；A2 若不成立，依 §4.6 修正 `hexYield` 的組合 | 50–90／90–130 | 0.4.2 stable；主 agent 先改型別（§8 步驟 0.5） | `pnpm --filter @catan/bots exec vitest run test/sfck-hooks.test.ts`（假模組：fold 的順序、初值、過濾、`rescore` 相加）；golden replay：base 3–6 人 × 10 種子，加上 sf-\* 與 ck-\* 各 3 種子，指令序列與改動前逐一相同；`pnpm --filter @catan/bots typecheck` |
| **SFCK-1** 組合模組 | `feat/bots-sfck-module`／`.worktrees/bots-sfck-module/` | `B/modules/seafarersCitiesKnights/{index,view,targets}.ts`（新）；registry 一行；`packages/bots/test/sfck-duty.test.ts`（新） | 註冊；`supports` 回 false；`robberTargets`；`pacing`；F1–F11 的 I9 固定盤面；三種 `bandit` 在 3、4、6 人地圖上的真值表（集合 = rules 合法集合，且非空）；`supports` 測試（缺任一模組就不開放） | 60–90／200–260 | 開發：SFCK-X 的型別（可先用本地型別）；合併：SFCK-P、SFCK-X 之後 | `pnpm --filter @catan/bots exec vitest run test/sfck-duty.test.ts`；`pnpm --filter @catan/bots exec vitest run`；`pnpm --filter @catan/bots typecheck` |
| **SFCK-2** 組合策略 | `feat/bots-sfck-strategy`／`.worktrees/bots-sfck-strategy/` | `B/modules/seafarersCitiesKnights/{chase,setup,rescore}.ts`（新）與 `index.ts` 的掛接；只補 `export`：`B/modules/seafarers/setup.ts`、`B/modules/citiesKnights/setup.ts`（若 A4 已成立則不動）；A5 若不成立，加上 `B/modules/seafarers/plan.ts`；`packages/bots/test/sfck-strategy.test.ts`（新） | §4.4、§4.5；FX-C、FX-S、FX-K、FX-G、FX-B | 180–260／200–260 | SFCK-1 | `pnpm --filter @catan/bots exec vitest run test/sfck-strategy.test.ts test/sf-decisions.test.ts test/ck-strategy.test.ts`；`pnpm --filter @catan/bots typecheck` |
| **SFCK-3** 驗收測試 | `feat/bots-sfck-tests`／`.worktrees/bots-sfck-tests/` | `packages/bots/test/modules/seafarersCitiesKnights.ts`（新）：`conservation`、`hideDifferently`、`perturb` 都取 SF ∪ C&K，perturb 再加上海盜位置、首攻前後與船端騎士；`responseCommands` 取 SF ∪ C&K；`mechanics` 逐步累計 `events`。另有 `test/sfck-game.test.ts`、`sfck-fair.test.ts`、`sfck-fuzz.test.ts`、`sfck-fallback.test.ts`（新）；`packages/bots/bench/run.ts`（只在需要 profile 設定時才改） | §6.1 的 Q1 矩陣、§6.2 的 Q2；family 檔明列兩個 profile（策略 §4.6） | 0／300–385 | 開發：SFCK-1；合併：SFCK-2 之後 | `BOTS_SEEDS=3 pnpm --filter @catan/bots exec vitest run test/sfck-game.test.ts test/sfck-fair.test.ts test/sfck-fuzz.test.ts test/sfck-fallback.test.ts`；`BOTS_SEEDS=10 pnpm --filter @catan/bots exec vitest run test/sfck-game.test.ts`；`pnpm --filter @catan/bots bench 10 --profile sf-ck-new-shores-2025`（paired 同法） |
| **SFCK-G** 開放 gating | `feat/bots-sfck-gate`／`.worktrees/bots-sfck-gate/` | `modules/seafarersCitiesKnights/index.ts`（`SFCK_BOTS_RELEASED = true`）；`packages/bots/test/support.test.ts`（快照加入兩個 id）；`packages/server/test/seafarers-cities-knights.test.ts:146-159`（翻轉）；`packages/server/test/bots-sfck.test.ts`（新）；§7.1 的文件 | gating；server 四類案例（策略 §4.7-5）；文件 | 5–10／150–200；docs 40–60 | SFCK-3；CK-C（若在本版） | `pnpm --filter @catan/bots exec vitest run test/support.test.ts test/sfck-game.test.ts`；`pnpm --filter @catan/server exec vitest run test/seafarers-cities-knights.test.ts test/bots-sfck.test.ts test/bots.test.ts`；`BOTS_SEEDS=10 pnpm verify` |

- **合計**：src 310–475，test 965–1,270，docs 40–60，總計約 1,315–1,805 行。比第一輪的 1,130–1,650 略高，因為 server 四類案例、組合測試工具與 golden replay 的擴充都算在本版內。
- **commit subject**（squash 後附 `(#N)`）：X `✨ feat(rules): export seafarers cities knights hint types`；P `✨ feat(bots): fold bandit targets and rescore candidates`；1 `✨ feat(bots): add the seafarers cities knights module`；2 `✨ feat(bots): chase the pirate and combine setup scores`；3 `🧪 test(bots): gate seafarers cities knights bot games`；G `✨ feat(bots): play new shores with cities & knights`。

### 5.1 階段

| 階段 | 並行開發 | 合併順序 | 備註 |
|---|---|---|---|
| A | SFCK-X ∥ SFCK-P ∥ SFCK-1 | X、P，然後 1 | X 只動 rules；P 只動共用檔；1 只動新目錄與新測試 |
| B | SFCK-2 ∥ SFCK-3 | 2，然後 3 | 3 只改新的測試檔與 bench |
| C | SFCK-G | — | gating、server 與文件集中在這一個 PR |
| D | 發布 QA、Browser QA、rc | — | §7.2 |

### 5.2 依賴與 CK-C 的退路

- **硬依賴**：SF 的 RX、SF-1（`sea.ts`、duty）、SF-2a（島嶼計畫）、SF-2b（`banditCandidates`、setup）、SF-3（測試工具）；C&K 的 CK-A、CK-B1（經濟、duty、掛點）、CK-B2（策略、setup、`knights.ts` 匯出）；平台 PL-1 到 PL-3。
- **不依賴**：CK-G、SF-4 的 gating 翻轉只影響各自的 profile。CK-C 也不是硬依賴：沒有 CK-C 時，互動卡照常回應、不主動打出（C&K 計畫 §7.3）。
- **若 CK-C 移到 0.4.3**：
  - 沿用 `feat/bots-ck-cards` 與 `.worktrees/bots-ck-cards/`，改指向 `release/v0.4.3`。檔案所有權（`B/modules/citiesKnights/{cards-interactive,preroll,tactics}.ts`、`test/ck-cards.test.ts`）與 SFCK 各切片不重疊，可以和 A、B 階段並行；`tactics.ts` 的騎士封鎖候選自動套用 SFCK 的 `rescore`，不需要協調。
  - 應在 SFCK-3 的發布矩陣之前合併；若在之後才合併，QA 以 `BOTS_SEEDS=10` 重跑 `sfck-game` 與 `ck-game`。M8 只計 ck-\* 的格子。CK-C 要為 Diplomacy 在 sf-ck 中的船邊目標補一個測試，放在它自己的 `ck-cards.test.ts`。
- **若 CK-C 再次延誤**：0.4.3 不帶 CK-C 發布，FIDELITY 的範圍註記同步寫明。

## 6. 測試與驗收

### 6.1 Q1 矩陣（發布閘門）

| 家族 | profile × 人數 | 座位 | 種子（預設／發布） | 步數上限 | 看門狗 N | 斷言 |
|---|---|---|---|---|---|---|
| B-GAME | `sf-ck-new-shores-2025` × 3、4（`fixed`）；`sf-ck-new-shores-paired-2025` × 5、6（`variable`） | `mixedLevels`（`(index + seed) % 2`，`packages/bots/test/policy.test.ts:27-29`），仿 BotDriver | 1–3／1–10 | 6000 | 72 回合沒有任何玩家的公開分數創新高 | 有勝者；0 拒絕；沒有殘留 pending；守恆（資源 19×5／24×5；commodity 36／54；進步卡 54；路與船各 ≤ 15；騎士、城牆）；0 次「策略閒置、但保底有動作」；每視窗每座位 ≤ 40；非行動者只送 `responseCommands` |
| 保底席 | 同上 | 座位 2 只走保底 | 種子 1 | 6000 | 72 | 同 B-GAME |
| 全保底有界局 | 同上 | 全部座位只走保底 | 種子 1 | 1500（不要求終局） | — | 0 拒絕；每一步都有動作 |
| B-POLICY 決定性 | 4 人、6 人 | mixed | 4 人種子 3、6 人種子 4 | 6000 | 72 | 重播兩次，指令序列逐一相同 |
| B-FAIR | 4 人、6 人 | standard、easy | 61、62 | — | — | 取樣必須包含三種 `bandit` frame、gold frame，以及有騎士相鄰海盜的 action；投影相同 → 決策相同 |
| fuzz | 4 人、6 人 | standard、easy、fallback | 各 150 個擾動狀態 | — | — | 不拋錯；指令被接受，或回 null 且確實不欠動作 |
| B-POLICY-SEA+K | 3–6 人 | — | B-GAME 每 5 步取樣一次 | — | — | `sea.ts` 的船位與含船的路線長度（含騎士 blocker）等於 hints 與 `longestRoadLength`（第一輪 8,353 次比對、0 次不一致） |

**依據（實測，`q2-calibrate.ts`）**：

| 項目 | mixed 40 局 | 全 easy 20 局 | 保底席 12 局 | 全保底 12 局 |
|---|---|---|---|---|
| 終局 | 40/40 | 20/20 | 12/12 | 皆到 1500 步上限（依設計不要求終局） |
| 拒絕 | 0 | 0 | 0 | 0 |
| 步數 | 3p 324–633、4p 431–1182、5p 477–1028、6p 581–1204 | 293–1132 | 238–888 | — |
| 最長「無人分數創新高」 | 10.3 回合（41 次擲骰） | 7.7 回合 | — | — |
| 逐 Bot 每視窗最大指令數 | 17 | 15 | 14 | — |

- **步數上限 6000**：第一輪全 standard、不打卡的版本最多 2,004 步；6000 約為它的 3 倍，也與 C&K 一致。
- **看門狗 N = 72 回合**：沿用 C&K 計畫（混席實測 36 回合的 2 倍），約為本輪最大值的 7 倍。以回合計，是因為失去城市會讓分數下降（C&K 計畫 X6）。

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

### 6.3 固定盤面（I9 與 Q2 守門；fallback、standard、easy 各驗一次）

| 組 | 案例 | 斷言 |
|---|---|---|
| F1–F11（SFCK-1） | 第一輪 `duty-fixtures.ts` 的盤面：海盜追擊、強盜追擊、`either`、首攻前含 commodity 的棄牌、Road Building 只剩船位或道路用完、金礦 frame 接著 aqueduct、騎士釘船（自己的與對手的）、merchant 不放金礦、Diplomacy 重建船、全海路口不能招募 | 保底與策略的指令都被 `applyCommand` 接受；F1、F2 另外斷言 SF＋C&K 的 naive 選擇會被拒（防止回歸） |
| 真值表（SFCK-1） | 3、4、6 人地圖 × 三種 `bandit` | fold 集合等於 rules 的合法集合，且非空 |
| FX-C1–C6（SFCK-2） | C1：K1–K6 全部成立 → 追擊；C2：蠻族距離 2；C3：追擊後防禦不足；C4：海盜沒有碰到自己的船；C5：首攻前（hint 為空）；C6：easy | 只有 C1 送 `knight.chasePirate`。C1 之後的 `'pirate'` frame 由策略與保底各自選出合法海格 |
| FX-S1–S2（SFCK-2） | S1：第 2 輪城市點 A 的點數略高，點 B 的 commodity 較多；S2：第 1 輪的沿岸點 | S1 選 B，證明 C&K 的城市評分有生效；S2 的島嶼加權與 SF 單獨時相同 |
| FX-K1–K2（SFCK-2） | K1：招募點中有一個是自己的小島計畫建地；K2：移動目標是葉端船的 open end | standard 都避開；easy 在 K1 避開、K2 不避開 |
| FX-G1–G2（SFCK-2） | G1：3–4 人局策略回答 gold frame；G2：金礦聚落與森林聚落都可升級 | G1 選最缺的資源；金礦城市估值 = 2 點萬用、0 commodity；G2 中金礦分數較高時選金礦 |
| FX-B3（SFCK-2） | 首攻後擲出 7，海盜目標可偷的對手比強盜目標多 | standard 移海盜，easy 移強盜 |

### 6.4 Q3 bench（只報告、不擋發布）

| 項目 | 內容 |
|---|---|
| 設定 | `--profile sf-ck-new-shores-2025` 3、4 人；`--profile sf-ck-new-shores-paired-2025` 5、6 人。每組 100 局，種子從 10000 起，standard 依局數輪換座位 |
| 對局 | ① 1 standard 對其餘 easy；② 1 standard 對其餘 naive（base 策略加上各模組 `duty`）；③ 全 standard；④ 全 easy |
| 指標 | 勝率與公平份額；平均回合，並與 naive 及 rules 腳本模擬對照（第一輪 8 局 13–106 回合）；平均指令數與每視窗最大指令數；decide 的平均與最大；保底次數與拒絕數 |
| 機制計數 | 造船、移船、小島加分、gold 張數、金礦城市、追擊海盜、`either` 時兩種盜賊各移幾次、自己的騎士釘住自己船的窗口數、騎士站在自己計畫小島空點的窗口數、守住與失守、各等級的失城數、大都市 |
| soft target（推測） | ① standard 勝率 ≥ 1.3 × 公平份額；② ≥ 公平份額 + 10 pp |
| | 平均回合：3 人 ≤ 40、4 人 ≤ 38、5 人 ≤ 24、6 人 ≤ 23（mixed 實測 33.6／30.9／19.2／18.6 的約 1.2 倍） |
| | 每視窗最大指令數 ≤ 20；乾淨機器上 decide 最大 ≤ 50 ms；拒絕與策略閒置都是 0；釘船窗口比例低於第一輪的 14% |

### 6.5 時間預算（參考值）

mixed 每局 0.6–1.0 s（load 0.5–1.2）。預設 3 種子是 12 局 B-GAME，再加保底席與全保底各 4 局，CPU 約 15–20 s；發布 10 種子約 40 s。分成 4 個檔案平行執行，timeout 120 s（策略 §4.6）。

## 7. 文件與發布

### 7.1 文件更新（SFCK-G；行號以 `a200840` 為準，0.4.1／0.4.2 改動後由 Planner 刷新）

| 位置 | 修改 |
|---|---|
| `docs/SPEC.md:188` | 「Today that is …」加入 `sf-ck-new-shores-2025`、`sf-ck-new-shores-paired-2025` |
| `docs/SPEC.md:292` | 「enabled for human seats」改為人類與 easy／standard Bot 都可入座 |
| `docs/SPEC.md:318` | 「accept human seats only (bot seats are refused)」改為接受 Bot 座位 |
| `docs/API.md:141-147` | 更新「today」清單（0.4.1 已改寫為通用判定） |
| `docs/API.md:402` | 「human seats only」改為可入座 |
| `docs/FIDELITY.md:43-44` | 兩列的「human seats only」改為「easy/standard bot seats」 |
| `docs/FIDELITY.md:67` | 「Bot seats are refused (`E_INVALID_BOT`) as for the other expansions」改為 Bot 證據（Q1／Q2、server 測試） |
| `docs/FIDELITY.md:136` | R-COMB service 的「bot seats refused」改為可入座；證據加上 `packages/server/test/bots-sfck.test.ts` |
| `docs/FIDELITY.md:137` 之後 | 新增 `R-COMB bots` 列：B-GAME、B-FAIR、S1–S4、C1–C5、X1–X3；證據為 `packages/bots/test/sfck-*.test.ts` |
| `docs/FIDELITY.md:520-521` | 刪除「bots cannot take a combined seat」 |
| `README.md:176-177` | 「Bot seats are not offered for the expansions」（0.4.2 會改為「只有 SF+CK 尚未支援」）改為「with easy and standard computer opponents」 |
| `docs/aegis/specs/2026-11-01-bot-opponents.md:16` | 支援清單加上兩個 sf-ck profile |
| 同上 `:19` | 刪除範圍外清單中剩下的 SF／C&K 字樣 |
| 同上 §5 規則 7 | 保底表加上 SF+CK 的 moveRobber 三列，或改為指向本計畫 §4.3 |
| `docs/aegis/work/<date>-bots-seafarers-cities-knights.md`（新）、`docs/aegis/INDEX.md` | 工作紀錄（Q1、Q2、Q3 表與探查結論）與索引列 |

- `docs/aegis/work/2026-11-02-seafarers-cities-knights.md:356` 是歷史紀錄，**不改**。
- 大廳文案在 0.4.1 已改，本版不動。

### 7.2 發布（策略 §7）

1. v0.4.2 stable 發布後，從 `master` 建立 `release/v0.4.3`，各 PR 依 §5.1 的順序合併。
2. SFCK-G 合併後，QA 執行 `BOTS_SEEDS=10 pnpm verify` 與 §6.4 的 bench，把 Q3 表附在發布 PR。
3. 在 release 分支直接 push `🔖 release: v0.4.3-rc.1`，用 rc 映像試玩。
4. Browser QA：`sf-ck-new-shores-2025` 4 人房加入 1 easy、1 standard 後開局，觀察數個 Bot 回合，至少看到造船、招募或啟動騎士、`city.improve`、小島聚落或首攻後的盜賊選擇，而且沒有停住；`sf-ck-new-shores-paired-2025` 6 人房再驗證一次，包含 P2 的 window。追擊海盜在試玩中很少見，不列為必看項目，由 FX-C1 保證。截圖放在 `.tmp/`，不提交（D10）。
5. stable：開 PR `release/v0.4.3 → master`，以 merge commit 合併；在 master 建立 `🔖 release: v0.4.3`、打 tag，並以 `scripts/release-notes.sh` 加上 `scripts/release-notes-lint.sh` 產生 notes。tag 與 Release 只在使用者授權後執行。

## 8. Paseo 分工

派工前以 `list_profiles` 的結果為準。

| 順序 | 工作 | 角色 | 隔離 | 審查 |
|---|---|---|---|---|
| 0 | 依 0.4.2 合併後的程式刷新本計畫：核對 A1–A5 與 §7.1 的行號 | Planner | 共用工作區（唯讀） | 主 agent |
| 0.5 | `B/modules/types.ts`：`robberTargets` 改為 fold 與 `number \| null`；新增 `rescore?` | 主 agent | 主 worktree | Architect（同時確認 T&B 的 FR 與 E&P N8 相容） |
| 1 | SFCK-X | Implementer（Backend）甲 | `.worktrees/bots-sfck-exports/` | Reviewer（Opus），輕量：只看行為是否不變 |
| 1′ | SFCK-P，與 1 並行 | Implementer（Backend）乙 | `.worktrees/bots-sfck-hooks/` | Architect 看語意；Reviewer（Sol）看 golden replay 與 I9 |
| 1″ | SFCK-1，與 1、1′ 並行開發 | Implementer（Backend）丙 | `.worktrees/bots-sfck-module/` | Reviewer（Opus）：I9、真值表 |
| 2 | SFCK-2，延續 SFCK-1 的脈絡 | Implementer（Backend）丙 | `.worktrees/bots-sfck-strategy/` | Reviewer（Sol）：分數尺度、決定性、B-FAIR |
| 2′ | SFCK-3，與 2 並行 | QA（只改測試） | `.worktrees/bots-sfck-tests/` | Reviewer（Opus） |
| 3 | SFCK-G；文件由主 agent 處理 | Implementer（Backend）甲 | `.worktrees/bots-sfck-gate/` | Reviewer（Sol） |
| （選配） | CK-C，若移到本版（§5.2） | Implementer（Backend）丁 | `.worktrees/bots-ck-cards/` | Reviewer（Sol） |
| 4 | `BOTS_SEEDS=10` 的 Q1／Q2 矩陣與 bench | QA | 自己的 worktree | 主 agent |
| 5 | rc 的瀏覽器驗證 | Browser QA | 共用工作區 | 主 agent |
| 6 | rc 與 stable 的 tag、Release | Release Manager（需要使用者明確授權） | — | — |

- **共用檔**：`B/{heuristic,fallback,sea}.ts` 在 0.4.3 只屬於 SFCK-P。SFCK-2 只能在 SF 與 C&K 的 `setup.ts` 補 `export`；需要其他改動時，先回報主 agent。
- **限制與閒置**：subagent 不 push、不改 lockfile；對合約有疑義時回報主 agent，不自行修改。閒置的 agent 把交接筆記寫到 `.worktrees/_handoff/` 後停止。

## 9. 風險

| # | 風險 | 對策 |
|---|---|---|
| R-SC1 | fold 的初值納入海盜目標，可能與 T&B（0.4.4）或 E&P（0.4.5）的假設衝突 | T&B 地圖沒有海格，E&P 沒有強盜；Architect 在步驟 0.5 審查；golden replay 擴大到 sf-\*／ck-\* |
| R-SC2 | `either` 時強盜與海盜候選的分數尺度不一致（策略 §5） | 同一尺度；FX-B3；Q3 記錄兩種盜賊各移幾次 |
| R-SC3 | SF 或 C&K 的實作與 A1–A5 不同 | 步驟 0 刷新；SFCK-2 只補 `export`；A5 屬於 SF 的缺陷，另行修正 |
| R-SC4 | 追擊海盜、金礦城市在 sim 中幾乎不出現 | X1、X2 以固定盤面守門；Q3 列出計數 |
| R-SC5 | Q2 門檻出自偏弱的原型；4 人局小島加分只有 6/10 | 以下限為門檻；SFCK-3 實測確認；只能由使用者調整（D-SC5） |
| R-SC6 | 保底被確定性地拒絕，造成無限退避（第一輪 naive 4/40 局） | §4.2 的完整合法集合；真值表；F1、F2 |
| R-SC7 | CK-C 與本版耦合 | §5.2：檔案不重疊；在發布矩陣之前合併，否則重跑 |
| R-SC8 | 測試時間 | 預設 3 種子；拆檔；timeout 120 s |
| R-SC9 | `rescore` 被誤用為合法性過濾 | 介面註明只調分數；審查清單 |
| R-SC10 | 單局步數受 load 影響的量測 | 結論只依步數與局數；耗時在實作階段重量 |

## 10. 待使用者決定的事

| # | 決策 | 建議 |
|---|---|---|
| D-SC1 | 強盜／海盜目標的介面 | `robberTargets` fold，元素推廣為 `number \| null`，初值為完整的盜賊預設；SFCK 只收窄；不新增 `banditTargets`（§4.2） |
| D-SC2 | 把 fold 從 0.4.4 提前到 0.4.3，並新增 `rescore` 鉤子 | 同意。fold 是 SF+CK 合法性的前提。`rescore` 只影響品質；若不同意，SFCK-2 去掉騎士位置罰分，該項只列入 Q3 |
| D-SC3 | setup 與 `hexYield` 的組合規則 | 依 §4.6 修訂策略 §4.2 |
| D-SC4 | gating | 依 `botsCanPlay` 加上 `SFCK_BOTS_RELEASED`；缺任一模組就不開放（SFCK-1 測試） |
| D-SC5 | Q2 門檻 | 採用 §6.2 的 S1–S4、C1–C5、X1–X3 |
| D-SC6 | 追擊海盜的積極度 | 保守（K1–K6），只限 standard |
| D-SC7 | easy | 造船、防禦、改良；`either` 時只移強盜；不追擊、不移船；套用小島空點罰分 |
| D-SC8 | 節奏與上限 | `knight.chasePirate` 900 ms；上限維持 40 |
| D-SC9 | rules 匯出（SFCK-X） | 同意（P8） |
| D-SC10 | `packages/rules/test/sfck-sim.ts:144-151` 從 `result.state.log` 計數，受 200 筆上限影響（`engine.ts:123`、`:251`），長局會少算 | 另開 issue，走一般 rules 測試修正（例如 `fix/rules-sfck-sim-counters`），**不併入本版切片**；Bot 的 `mechanics` 本來就逐步累計 `events` |
| D-SC11 | CK-C 的處理 | 依 C&K 計畫 D-CK7 的判定點。移到本版時，依 §5.2 並行；再延誤就不帶它發布 |
| D-SC12 | `moveRobber` 投影補 pirate 旗標 | 不補，只依賴 `bandit` hint（P8） |

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
| 7 | SF 計畫：§4.3 的 `blocker` 預設在 0.4.3 由 SFCK-P 改為組合後的 `vertexBlocker`，options 物件只增欄位（與 E&P N8 相容）；§4.3 對「首攻前海盜不活動掛點」的推測：不需要 | SF 計畫 §4.3、§4.5 | 第一輪 164 對 0 次不一致；`engine.ts:1091`；`sfck/index.ts:89-90` |
| 8 | SF 計畫：setup 評分抽成可匯出的純函式 `islandSetupBonus`；城市計畫要把金礦以 2 點萬用計價（A5） | SF 計畫 §4.2 setup building 列、§4.5 | G-SC4；`sf/gold.ts:38` |
| 9 | C&K 計畫：`hexYield` 對非 `TERRAIN_COMMODITY` 地形回 `undefined`（A2）；第 2 輪城市評分匯出為 `citySetupScore`；§4.9「騎士封住船路〔推測〕」改為由 SFCK-P 完成；§4.2 base moveRobber 列在 SF+CK 中改由 fold 集合決定 | C&K 計畫 §4.1、§4.6、§4.9、§4.2 | G-SC3、G-SC4、G-SC5 |
| 10 | 第一輪報告的 SFCK `duty`（海盜追擊後的 moveRobber）不再需要；「base 保底遇到空集合時回 undefined」也不需要 | 第一輪報告 §4、§6 | §4.2：集合完整且非空，base 保底取第一項就一定合法 |

## 附錄：探查（`/tmp/katan-bot-research/seafarers-cities-knights/`）

| 檔案 | 用途 | 執行（`node --experimental-transform-types --no-warnings …`） |
|---|---|---|
| `q2-calibrate.ts`（本輪） | mixed、`fbseat`、`allfb`、`alleasy`、`allstd` 五種座位；逐局輸出步數、回合、看門狗間隔、逐 Bot 每視窗指令數與 Q2 計數（逐步累計 `events`） | `q2-calibrate.ts mixed 3,4,5,6 1 10` → `out/q2-*.txt` |
| `duty-fixtures.ts` | F1–F11 固定盤面 | `out/fixtures.txt` |
| `conflicts.ts` | 8,353 個窗口中，各模組自己的模型與 hints 的比對 | `out/conflicts.txt` |
| `variants.ts`、`lib.ts`、`strategies.ts` | 第一輪的 variant 與共用程式（`base`、`duty`、`core`、`full`、`naive`、`naivefb`、`mixed`） | `out/{base,duty,core,full,naive}.txt` |
| `sim-measure.ts`、`facts.ts` | rules 腳本模擬的步數；地圖事實 | `out/sim.txt` |
