# SF+CK（Heading for New Shores × Cities & Knights）Bot 支援：第一輪研究

> 收錄說明：2026-11-04 第一輪唯讀研究報告，內容原樣保留，基準 `a200840`（v0.4.0）。定稿計畫是 `docs/aegis/plans/2026-11-04-bots-seafarers-cities-knights.md`，研究之後的修正一律以計畫為準。文中的 `/tmp/katan-bot-research/<slug>/report.md` 對應 `docs/aegis/work/2026-11-04-bots-<slug>-research.md`；探查腳本與輸出沒有提交。

- 角色：Planner（唯讀研究）。目標版本 0.4.3。
- 日期：2026-11-04。repo 狀態：v0.4.0 之後（`a200840`）。
- 本報告**只寫組合本身新增的部分**。SF 與 C&K 各自的設計請見：
  - `/tmp/katan-bot-research/seafarers/report.md`（以下簡稱「SF 報告」）
  - `/tmp/katan-bot-research/cities-knights/report.md`（「C&K 報告」）
  - `/tmp/katan-bot-research/platform/report.md`（「平台報告」）
- 證據格式為 `檔案:行號`。repo 路徑相對於 repo root；`/tmp` 路徑寫全名。推論標「推測」。
- probe 與量測都在 `/tmp/katan-bot-research/seafarers-cities-knights/`。輸出放在 `out/`，腳本清單見附錄。

---

## 1. 範圍

| 項目 | 3–4 人 | 5–6 人 |
|---|---|---|
| profile | `sf-ck-new-shores-2025`（`packages/rules/src/profiles.ts:457`） | `sf-ck-new-shores-paired-2025`（`profiles.ts:485`） |
| ruleModules | `['seafarersCitiesKnights','seafarers','citiesKnights']`（`profiles.ts:460`） | 同（`profiles.ts:489`） |
| 引擎 | `sf-ck-2025.1`（`profiles.ts:458`） | 同 |
| 勝利分 | 16（`profiles.ts:470`） | 16 |
| setup | 固定（`profiles.ts:471`） | 可變（`profiles.ts:503`） |
| 商品各 | 12（`profiles.ts:478`） | 18（`profiles.ts:511`） |

**假設已完成**（依任務背景）：

- 平台：BotModule、`BotCommand`、gating、測試矩陣、pacing（平台報告 §2）。
- SF-1/2/3：`sea.ts`、gold、freeRoads 的船分支、海盜評分（SF 報告:345-347）。
- C&K PR-0/A/B：frames、商品、騎士（C&K 報告:641-643）。PR-C 視為選配。

**本報告回答兩個問題**：

1. 把 SF 與 C&K 的 BotModule 依 `ruleModules` 順序直接組合之後，還缺什麼？
2. 兩者在哪裡衝突？

**範圍外**：

- SF 或 C&K 單獨就存在的落差，例如 C&K 的 14 種 frame、SF 的 gold 與 freeRoads 船分支。這些只在量測時被當成前置條件。
- 規則本身的正確性。R-COMB 已在 0.4.0 開放（`docs/FIDELITY.md:67,127-137`；`docs/SPEC.md:283-292`）。

**組合層在 rules 端的全部內容**（`packages/rules/src/modules/seafarersCitiesKnights/index.ts`，共 190 行）：

- 雙盜賊的 veto：`moveBandit`，62-81。
- 海盜追擊：`pirateChasers`／`chasePirate`，89-110。
- 騎士釘船：`shipMoveBlocked`，121-125；組合版移船 `moveShipCombined`，131-138。
- 首攻前兩個盜賊都離場：`initGame` 把 `robber` 設為 -1，146-148。
- 金礦算作產出：`afterProduction`，153-159。
- merchant 不可放金礦：`allowMerchant`，163-165。
- 投影與 hints：172-189。

---

## 2. Bot 介面盤點（只列組合新增或改變的部分）

### 2(a) 模組指令

| 指令 | 參數 | 條件 | 證據 |
|---|---|---|---|
| `knight.chasePirate` | `{ vertex }` | 需在行動窗口、海盜已上場，且騎士為 active、相鄰海盜 hex。騎士會倒下，接著排入 `{kind:'moveRobber', cause:'knight', pirate:true}` | `seafarersCitiesKnights/index.ts:98-110`（倒下 106、排入 108）、`commands` 167-170 |
| `ship.move`（由組合層覆寫） | 同 SF | 在 SF 的檢查之外，船若有 open end 且該端被**自己的**騎士壓住，回 `E_SHIP_PINNED_BY_KNIGHT` | `index.ts:121-125,131-138`；dispatch 取第一個有 handler 的模組（`packages/rules/src/engine.ts:852-863`） |

新錯誤碼：

- `E_PIRATE_INACTIVE`：首攻前移海盜，或首攻前追擊海盜（`index.ts:73,102`）。
- `E_SHIP_PINNED_BY_KNIGHT`（`seafarersCitiesKnights/messages.ts`）。

### 2(b) pending frames

組合層**沒有新的 frame kind**，但改變了三個既有 frame 的語意。

1. **`moveRobber`**
   - rules 內部帶 `pirate:true`（`index.ts:108`），但投影只輸出 `{kind, actor, cause}`，**丟掉了 pirate 旗標**（`packages/rules/src/project.ts:175-176`）。
   - Bot 只能從 `hints.modules.seafarersCitiesKnights.bandit` 分辨（`index.ts:176-189`）：
     - 海盜追擊開出的 frame：`'pirate'`；
     - 騎士追強盜開出的 frame，或海盜還沒上場時：`'robber'`；
     - 首攻後擲出 7：`'either'`。
   - veto 位置（`index.ts:62-81`）：
     - 首攻前移海盜：`E_PIRATE_INACTIVE`（73）；
     - 追強盜卻移海盜：`E_ILLEGAL_TARGET` reason `robber`（75）；
     - 追海盜卻移強盜：`E_ILLEGAL_TARGET` reason `pirate`（79）。
   - 引擎取第一個有定義的模組結果（`engine.ts:1426-1439`），組合層排第一，所以永遠先 veto。
2. **`seafarers.gold` 與 `citiesKnights.scienceBonus`**
   - 金礦 frame 先排入，aqueduct（科學 3）的補牌排在它後面（FIDELITY SFCK-5，`docs/FIDELITY.md:469-523`）。
   - `afterProduction` 把金礦 hex 算進 `produced`（`index.ts:153-159`），因此拿到金礦的人不會觸發 aqueduct。
   - 實測：F7 中 p3 在金礦 frame 期間只能等待，之後才輪到 scienceBonus（`out/fixtures.txt`）。
3. **`freeRoads`**
   - sf-ck 的容量使用 C&K 的 `freeRouteCapacity`（`engine.ts:651-655,1259-1263`）：道路加船，受合法邊與存量限制。
   - Road Building 進步卡因此可以只放船。

### 2(c) 回合結構

- **首攻前（COMB-10）**：
  - 強盜在 -1，海盜在外框（`index.ts:143-148`）。
  - 擲 7 仍要棄牌，但不移盜賊（`engine.ts:1072-1100`，1091 的 `robberInactive`）。
- **第一次蠻族攻擊**：強盜放到 `layout.robber`（`packages/rules/src/modules/citiesKnights/barbarians.ts:111`）。
  - 3 人局：hex 0，在**小島 2** 的 12 點山丘上（`facts.ts`）。
  - 4 人與 5–6 人局：沙漠。
- **首攻來得很早**：full 原型的平均首攻回合為 3p 4.4、4p 3.3、5p 3.0、6p 2.5（`out/full-mixed.txt`）。「盜賊離場」的窗口大約只有 3 回合。
- **setup**：第 2 輪放的城市可以接著放 `setup.placeShip`（`facts.ts`）。

### 2(d) View 與 hints

- `view.modules.seafarersCitiesKnights = { pirateActive }`（`index.ts:172-174`）。
- `hints.modules.seafarersCitiesKnights = { pirateActive, bandit, pirateChase: number[] }`（`index.ts:176-189`），其中 `pirateChase` 是可以追擊的騎士所在路口。
- **SF 的 hints 沒有被組合層收窄**：`pirateTargets`、`robberTargets` 在每一個 `moveRobber` frame 都會列出（`packages/rules/src/modules/seafarers/index.ts:98-102`）。
  - 強盜追擊的 frame 有 389 個，SF hints 100% 列出海盜目標。
  - 海盜追擊的 frame 有 6 個，SF hints 100% 列出強盜目標（`out/conflicts.txt`）。
- **已經正確反映組合規則的 hints**（Bot 只要讀 hints 就合法）：
  - `legalShips`：被騎士擋住的路口不能穿越（`seafarers/ships.ts:72`、`analysis.ts:88-107`）。F8c 驗證過。
  - `movableShips`：反映 `shipMoveBlocked`（`ships.ts:111-144`）。F8 中 hint 為 `[]`。
  - C&K 的 `recruitSites`：可經由船連到的陸地路口（`citiesKnights/knights.ts:119-127`）。
  - C&K 的騎士移動：沿著船走，可停在全海路口（`knights.ts:80-108`）。
  - merchant 的 targets：排除金礦（`index.ts:163-165`）。F9 驗證過。
- rules 沒有匯出 SFCK 的 hint 型別（`packages/rules/src/index.ts` 沒有相關 export）。

### 2(e) 隱藏資訊與 B-FAIR

- 沒有新增隱藏資訊。`bandit`、`pirateChase` 都由公開狀態推導。
- B-FAIR 沿用 SF 與 C&K 的檢查即可。

### 2(f) 交易

- 沒有新增交易形式。
- 金礦城市拿 2 個資源、沒有商品（COMB-8），會影響估值，詳見 §3(b) C7。

---

## 3. 落差

### 3(a) 現行 base Bot

- gating：`BOT_RULE_MODULES = []`（`packages/bots/src/support.ts:12`）。
- server 測試明確斷言兩個組合 profile 的 `botSeats` 都是 `false`（`packages/server/test/seafarers-cities-knights.test.ts:146-159`）。
- 文件也寫明不開放：`docs/FIDELITY.md:520-521`、`docs/SPEC.md:188`、`docs/aegis/work/2026-11-02-seafarers-cities-knights.md:356`。

**實測**：variant `base` 共 40 局（3–6 人 × 10 seeds），**0 局完成**（`out/base.txt`，load 1.00–1.07）。

- 30 局卡在 `citiesKnights.pillage`：fallback 對模組 frame 回 null（`packages/bots/src/fallback.ts:41-43`）。
- 10 局卡在 `E_INVALID_DISCARD_COUNT` 的無限 backoff：base 棄牌沒有計入商品（`fallback.ts:14-17,48-56`）。
- 兩者都是 C&K 已知的落差（C&K 報告 PR-B），不是組合造成的。

**只在組合才出現的 base 落差**：

- F1：海盜追擊後，base fallback 選陸地 hex，被拒 `E_ILLEGAL_TARGET/pirate`。fallback 每次都會選同一個 hex，於是 driver 無限 backoff（`packages/server/src/bot-driver.ts:402-423`）。
- F4：首攻前擲 7，持有商品的玩家棄牌，base 被拒 `E_INVALID_DISCARD_COUNT`（`out/fixtures.txt`）。

### 3(b) SF 與 C&K 模組直接組合後仍缺的部分

方法：

- `variants.ts naive`：策略與保底都只有 SF 與 C&K 兩層，策略不讀 SFCK 的 `bandit`。
- `conflicts.ts`：用 40 局 full 對局共 8,353 個行動窗口，比對各模組自己的模型與 hints。
- `duty-fixtures.ts`：F1–F11 固定盤面。

| # | 落差 | 證據 | 實測 | 嚴重度 |
|---|---|---|---|---|
| C1 | **盜賊種類沒有收窄**：SF 的 moveRobber 決策在強盜與海盜之間取分數最高者（SF 報告:225），C&K 只會移強盜。兩者都不知道 `bandit` | `project.ts:176`；`seafarers/index.ts:98-102`；`index.ts:62-81` | naive：40 局中 **4 局無限 backoff**（`fallbackAfterReject:pending.moveRobber:E_ILLEGAL_TARGET/pirate`，3p 與 6p 各 2 局）；策略被拒 10 次（`/robber` ×6、`/pirate` ×4）。F1 中三層保底都沒有 SFCK duty，被拒 `/pirate`；F2 中 SF 選海盜被拒 `/robber` | **阻斷** |
| C2 | **平台的組合規則只有 `robberTargets`（取交集）**，沒有對應海盜的鉤子，SFCK 無法透過平台介面收窄海盜候選 | 平台報告:184,232 | — | **阻斷**（介面層） |
| C3 | **base 的 moveRobber duty 若交集為空就回 `null`**，會擋掉後面的模組 duty。平台規定 base `pendingDuty` 先跑，再跑模組 duty（平台報告:221），所以海盜追擊後若 base 回 `null`，SFCK duty 不會被問到。推測：要看 P 系列的實作 | `fallback.ts:19-25`（`hex < 0 ? null`） | — | 高（推測） |
| C4 | **SF 的 `sea.ts` 船 BFS 與 `routeLength` 沒有算入騎士阻擋**。SF 報告保留了 `isBlockedFor` callback（SF 報告:207），但平台沒有讓 C&K 模組提供它的鉤子 | `analysis.ts:88-107,115-165`；`citiesKnights/index.ts:122-124` | 不含騎士 blocker 時，route 長度與 rules 不一致 **164/8,353（2.0%）**；加入 blocker 後 0。另有 108 個窗口被對手騎士截斷自己的路線 | 中（影響決策品質，不影響合法性：建造走 `legalShips`） |
| C5 | **自己的騎士釘住自己的船**：SF 若用自己的模型判斷「葉端船可移」就會被拒 | `index.ts:121-125` | SF-only 模型認為可移的窗口 2,546 個，其中 **363 個（14%）** 被自己的騎士壓在 open end。hints 的 `movableShips` 正確（F8）。naive `ship.move` 被拒 `E_SHIP_PINNED_BY_KNIGHT` | 低：SF 報告已規定讀 hints（SF 報告:232）。仍需 decision 測試 |
| C6 | **C&K 的騎士模型若只沿道路走會漏算**：騎士可沿船移動、可停在全海路口；招募點可經由船連到 | `knights.ts:80-108,119-127` | 有移動選項的騎士窗口 2,318 個，其中 **1,124 個（48%）** 的目標只能經由船到達，320 個到全海路口。有 1,220 個窗口（15%）存在只能經由船到達的招募點。F11：naive 在全海路口招募被拒 `E_ILLEGAL_TARGET` | 中：合法性走 hints 即可，但 C&K 的評分模型（`board.ts` 的騎士阻擋，C&K 報告:643）要能看到船 |
| C7 | **金礦城市的產出組合沒有定義**：SF 的 `vertexYield` 把金礦當萬用點數（SF 報告:214）。C&K 的城市在森林、牧場、山脈產商品，但金礦城市只拿 2 個資源、沒有商品（COMB-8）。平台的 `economy.hexYield` 沒有列入組合規則表（平台報告:228-234 只列 `costs`、`cardKinds`、`pacing` 合併） | `seafarers/gold.ts:29-133`；`index.ts:153-159` | 有 275 個窗口可以升級成金礦城市，但 40 局中**實際蓋出 0 座**。原型沒有組合估值，所以這是覆蓋空洞，不是正確性的證據 | 中 |
| C8 | **setup 鉤子採「第一個非 undefined 者勝」**（平台報告:230）。SF 的 setup building 加了沿岸與登島加權（SF 報告:221），C&K 第 2 輪改放城市並加入商品加權（C&K 報告 PR-B）。依 ruleModules 順序 SF 先回答，C&K 的城市估值會被略過。推測：要看兩邊實作 setup building 的方式 | 平台報告:214,230 | — | 中（推測） |
| C9 | **騎士擋住自己的小島建地**：任何騎士都會擋建築（`citiesKnights/index.ts:126-128`）。C&K 選招募點時不知道 SF 的島嶼計畫 | `knights.ts:119-127` | 有 166 個窗口，自己的騎士站在可蓋的小島空點上 | 中（策略衝突） |
| C10 | **海盜追擊不是任何一方的候選**：`knight.chasePirate` 只存在於組合層 | `index.ts:89-110` | 40 局中只有 13 個窗口可追擊，實際追擊 6 次。頻率很低 | 低（但缺了它，海盜壓船時沒有對應手段） |
| C11 | **Diplomacy 拆掉自己的船**：重建的 frame `citiesKnights.diplomacyRoad` 的 `data.edges` 含船位。若從 `hints.legalRoads` 挑會被拒 | `citiesKnights/cards-politics.ts:110-135` | F10：從 legalRoads 選被拒 `E_ILLEGAL_TARGET`，從 `data.edges` 選則成功 | 低（C&K duty 讀 frame data 就正確） |
| C12 | **免費路線**：Road Building 進步卡可能只剩船位，或道路已用完 | `engine.ts:1259-1263` | F5：base 回 null（卡住），或被拒 `E_NO_PIECES`。SF duty 的船分支可解決 | 低：SF-1 已涵蓋（SF 報告 G4、G13），只需組合 fixture |
| C13 | **pacing 與 supports**：SFCK 需要 `knight.chasePirate` 的 pacing 鍵。`supports` 只看 SF 與 CK 會誤開；必須三個 BotModule 都存在（平台報告:240） | `support.ts:12-16` | — | 低（正確性必需） |
| C14 | **窗口指令上限**：`MAX_BOT_COMMANDS_PER_WINDOW = 40`（`bot-driver.ts:70`） | — | full 的單窗口最大指令數為 15/18/15/15（3–6 人），`forcedByLimit = 0` | 無 |

### 3(c) 衝突總表（「直接組合」會打架的地方）

| 衝突 | SF 的意圖 | C&K 的意圖 | 組合規則 | 建議 |
|---|---|---|---|---|
| 盜賊選擇 | 強盜與海盜比分 | 只移強盜、騎士追強盜 | `bandit` 三態 | SFCK 先收窄（§4 P-SFCK-1），SF 在收窄後的集合內比分 |
| 騎士位置與船 | 葉端船要能移；小島空點要留給自己 | 騎士守城、擋對手、追強盜 | 自己的騎士釘船（COMB-4/5），任何騎士擋建地 | 在騎士候選上加罰分（§5） |
| 騎士與海盜追擊 | 海盜壓船時想趕走 | 騎士要留著防蠻族 | 追擊後騎士倒下 | 只在蠻族不近、且防禦有餘裕時追擊 |
| 金礦城市 | 金礦視為萬用 ×2 | 城市產商品 | 金礦城市拿 2 個資源、沒有商品 | 定義 `hexYield` 的組合方式（§4 P-SFCK-3） |
| setup 第 2 輪 | 沿岸與島嶼加權 | 放城市、商品加權 | setup 先問者勝 | 改為分數疊加，或由 SFCK 接手（§4 P-SFCK-5） |
| 路線長度 | 路與船只在自己的建築處換乘 | 對手騎士截斷路線 | 兩者都成立 | `sea.ts` 注入 C&K 的 blocker |
| aqueduct | 金礦是「選擇」 | 沒有產出才補牌 | 金礦算作產出 | C&K 估 aqueduct 價值時，把金礦 hex 算入產出 |

---

## 4. 必要的平台或規則端支援

### 平台（`packages/bots`）

| # | 內容 | 理由 | 估計 |
|---|---|---|---|
| P-SFCK-1 | 新增 `banditTargets?(view, self): { robber: readonly number[] \| null; pirate: readonly (number \| null)[] \| null }`，各模組取交集，`null` 表示不限制。也可以把 `robberTargets` 擴成同樣的形狀。SFCK 依 `bandit` 回傳：`'pirate'` 時 `robber: []`；`'robber'` 時 `pirate: []`；`'either'` 時不限制 | C1、C2 | 30–50 行（含測試） |
| P-SFCK-2 | 新增 `economy.vertexBlocker?(model, vertex, self): boolean`，組合方式為 OR。C&K 提供騎士阻擋；`sea.ts` 的船 BFS、`routeLength` 與 `isFreeSpot` 都改為查詢它 | C4、C9；SF 報告:207 已預留 callback | 30–50 行 |
| P-SFCK-3 | 定義 `economy.hexYield` 的組合方式。建議用 fold：依序把前一個模組的結果傳給下一個，讓 C&K 只在非金礦 hex 加商品。SF 的萬用值由 `vertexYield` 處理。另一種做法是由 SFCK 覆寫 | C7 | 20–40 行 |
| P-SFCK-4 | base 的 `pendingDuty` 在交集為空時回 `undefined`，不回 `null`，讓模組 duty 接手 | C3 | 5–10 行（併入 P-SFCK-1） |
| P-SFCK-5 | setup building 改為「各模組提供分數修正、再串接」，取代 first-wins | C8 | 0–30 行（推測：SF-2 或 C&K PR-B 若已改成分數形式，則為 0） |
| — | `supports`：SFCK 的 BotModule 要求 profile 的 ruleModules 三者俱全，且三個都已註冊。`BOT_RULE_MODULES` 加入 `'seafarersCitiesKnights'` | C13 | 歸入 SFCK-3 |

合計約 80–150 行，可以併進 SFCK-1，也可以放在平台 P 系列的尾端。

### 規則端（rules）

**引擎不需要修改。** 組合規則都已經由 hints 正確暴露（§2(d)）。

選配項目：

1. **匯出 SFCK hint 型別**：只加 `export type`，符合 I3（比照 C&K 的 PR-A）。不匯出的話，Bot 端要自己寫型別，有 drift 風險。約 10 行。
2. **在 `moveRobber` 投影補上 `pirate` 旗標**（`project.ts:176`）：會改變公開投影，前端與 replay 都受影響。`bandit` hint 已經足夠，**建議不做**。
3. **修正測試工具的計數錯誤**：`packages/rules/test/sfck-sim.ts:144-151` 從 `result.state.log` 計算海域事件，但 log 上限只有 200 筆（`engine.ts:123,251`），長局會少算。這不在 Bot 範圍內；只是若 SFCK-3 要沿用它來檢查覆蓋，必須先修。

---

## 5. 策略草案（只列組合特有的決策）

共用前提：SF-2 與 C&K PR-B 的策略已存在。原型中 `ckCore` 是 C&K 的核心，`shipBuilder` 是 SF 的最小造船，`banditChoice` 與 `pirateChase` 是組合層（`strategies.ts`）。

| 時機 | standard | easy | 依據 |
|---|---|---|---|
| moveRobber，`bandit='pirate'`（海盜追擊後） | 海盜移到有可偷對手、且不壓自己船的 hex；沒有就移到外框（`null`，若海盜在場上） | 同（必要動作） | `strategies.ts:99-102` |
| moveRobber，`bandit='robber'` | base 與 C&K 的強盜評分；C&K 再加上商品 hex 的價值 | 同 base | — |
| moveRobber，`bandit='either'`（首攻後擲 7） | 比較兩邊分數：海盜分數用 SF 的公式（可偷對手 + 封鎖對手前線 − 擋到自己），強盜分數用 base 與 C&K 的公式，取高者 | 只移強盜 | 873 個 either frame 中，海盜有可偷對象的有 699 個（80%） |
| 首攻前 | 擲 7 只棄牌（含商品）。騎士追強盜與海盜追擊都不可用 | 同 | `engine.ts:1091` |
| 海盜追擊 `knight.chasePirate` | 列為 action 候選。條件：海盜壓在自己的船或計畫航線上；蠻族距離 ≥ 3（`position < length − 2`）；追擊後的騎士強度仍不少於城市數。價值為 SF 的「解除封鎖」價值減去防禦損失與重新啟動成本（1 grain） | 不追擊 | `strategies.ts:110-120`；13 個可追擊窗口中追擊 6 次 |
| 騎士招募與移動位置 | 對三類位置加罰分：(a) 自己船隊的 open end（會釘住船）；(b) SF 計畫中的小島建地。加分給能擋對手船路的海上路口（推測，屬 PR-C 的封鎖戰術） | (a)、(b) 罰分即可 | C5（363 窗口）、C9（166 窗口） |
| 島嶼擴張與城市改良的取捨 | 勝利分 16 必須靠島嶼：core（沒有造船）只完成 30/40；full 則 40/40。SF 的「島嶼聚落」計畫要與 C&K 的改良和大都會放在同一個尺度上 | 同 SF easy | `out/core.txt`、`out/full.txt` |
| 金礦城市 | 依 P-SFCK-3：金礦城市值 2 個萬用資源，其他城市值 1 個資源加 1 個商品。商品價值依改良計畫而定 | 同 | COMB-8 |
| aqueduct（科學 3）估值 | 金礦 hex 算作產出 | 同 | `index.ts:153-159` |
| Road Building 進步卡 | 沿用 SF 的 freeRoads 分支：計畫的下一步是船就放船。容量由 C&K 的 `freeRouteCapacity` 決定 | 同 | C12 |
| Diplomacy（PR-C） | 推測：可以拆掉被釘住的己方船並重建，從 `data.edges` 選；價值低 | 不用 | C11 |
| Merchant | 從 hint 的 targets 選（已排除金礦） | 同 | F9 |
| 3 人局首攻後 | 強盜落在小島 2 的 12 點山丘，該島的島嶼計畫要扣掉被封鎖的期望值 | 同 | `facts.ts` |

---

## 6. 保底策略（每個 frame 與強制動作都有必定合法的最小動作）

組合後的順序：

1. base `pendingDuty`，套用 `cardKinds` 與 `banditTargets`；交集為空時回 undefined。
2. SFCK `duty`。
3. SF `duty`。
4. C&K `duty`。
5. base 的 roll 與 end。

原型的對應實作是 `lib.ts` 的 `composedFallback = first(sfckDuty, sfDuty, ckDuty, baseFallback)`。

| frame 或強制動作 | 最小合法動作 | 負責層 | 驗證 |
|---|---|---|---|
| `moveRobber`，`bandit='pirate'` | `pirateTargets` 中第一個不是目前海盜 hex 的項目（可為 `null`；`seafarers/pirate.ts:13-19`） | SFCK | F1 ✓ |
| `moveRobber`，`'robber'` 或 `'either'` | base：`robberTargets` 的第一項 | base | F2 ✓、F3 ✓ |
| `discard`（含首攻前） | 依 `cardKinds` 棄牌，資源加商品 | base 加 C&K | F4 ✓；棄完後 pending 為 null、robber 仍為 -1 |
| `seafarers.gold` | 依 RESOURCES 順序選，受 bank 存量限制 | SF | F7a ✓ |
| `citiesKnights.scienceBonus`（排在金礦之後） | 第一個可拿的資源 | C&K | F7b ✓ |
| `freeRoads`（Road Building 進步卡） | 道路有存量且 `legalRoads[0]` 存在時放路，否則放 `legalShips[0]` | SF | F5 ×2 ✓ |
| `citiesKnights.diplomacyRoad` | `data.edges[0]`，沒有則送 `null` | C&K | F10 ✓ |
| setup 道路階段 | 有路放路，否則放 `setupShips[0]` | SF | `lib.ts` |
| 其他 14 種 C&K frame（pillage、retreat、progressExcess 等） | 依 C&K 報告的 duty | C&K | 原型 `ckDuty` |
| 行動窗口 | `turn.end`。保底永遠不送 `ship.move` 與 `knight.chasePirate` | base | F8、F8b、F8c、F11 ✓ |

**實測**：

- `mixed` 讓偶數座位只用保底：40/40 完成、0 次被拒，保底共出手 6,256 次（`out/full-mixed.txt`，load 1.34–1.45）。
- `naivefb`（naive 策略加組合保底）：40/40 完成；策略被拒 11 次，全部由保底救回（`out/naive.txt`）。

---

## 7. 測試與驗收

### 實測數據

除特別註明外，都是 3–6 人 × seeds 1–10，各 10 局。步數與完成率是決定性的：同一 seed 跑兩次結果相同（`full.txt` 與 `full-lowload.txt` 的步數一致）。時間只供參考。

| variant | 完成 | 被拒 / 結局 | 每局步數（平均） | 每局回合（平均） | 每局耗時 | load average |
|---|---|---|---|---|---|---|
| base | **0/40** | 30 局卡在 pillage；10 局 discard 無限 backoff | — | — | 155–296 ms（中途停止） | 1.00 / 1.07 |
| duty（每種人數 5 局） | **0/20** | 全部撞到 12,000 步上限；0 次被拒 | — | 4p seed 1：3,000 步時已 176 回合、49 次攻擊 | 24–31 s | 0.99 → 1.95 |
| core（C&K 核心，沒有造船） | **30/40**（10/7/6/7） | 0 次被拒；其餘撞到上限 | 768 / 1,594 / 1,379 / 1,503 | 47.6 / 58.4 / 31 / 26.3 | 0.9–12.5 s | 1.82 → 4.43 |
| **full**（核心加造船加組合層） | **40/40** | **0 次被拒，保底 0 次** | 388–1,141（784） / 653–1,523（1,136） / 473–1,301（977） / 726–2,004（1,308） | 49.6 / 45 / 22 / 24 | **1.1–1.7 s** | **1.18 → 1.27**（`full-lowload.txt`，40 局共 56.8 s） |
| mixed（偶數座位只用保底） | 40/40 | 0 次被拒 | 487 / 757 / 657 / 699 | 37.2 / 42.5 / 19.6 / 17.4 | 0.5–0.9 s | 1.45 → 1.34 |
| naive（沒有組合層） | **36/40** | **4 局無限 backoff**（`E_ILLEGAL_TARGET/pirate`）；策略被拒 10 次 | 719 / 1,140 / 974 / 1,239 | — | 1.1–2.5 s | 2.67 → 3.87 |
| naivefb | 40/40 | 策略被拒 11 次，全部由保底救回 | 807 / 1,140 / 974 / 1,257 | — | 1.4–2.4 s | 同上 |

full 的其他數據：

- 單窗口最大指令數 15/18/15/15；`decideMaxMs` ≤ 22 ms。
- 每 10 局的事件數：
  - `ship.built` 99/109/100/132
  - `island.bonus` 15/18/22/37
  - `gold.chosen` 0/8/24/53
  - `sfck.knightChasedPirate` 4/0/0/2
  - `pirate.moved` 6/11/0/14

rules 的 scripted sim（`sim-measure.ts`；試錯型腳本，會讀 GameState，不是 Bot）：

| 人數 | seed | 步數 | 回合 | 耗時 | load |
|---|---|---|---|---|---|
| 3 | 2 | 1,002 | 106.3 | 5.3 s | 21.40 |
| 4 | 1 | 846 | 41.3 | 6.9 s | 12.94 |
| 5 | 3 | 1,793 | 61.4 | 24.3 s | 33.42 |
| 6 | 3 | 963 | 28.5 | 5.6 s | 5.39 |
| 3 | 1 | 970 | 100 | 4.0 s | 3.70 |
| 4 | 2 | 501 | 33.3 | 1.4 s | 2.37 |
| 5 | 1 | 643 | 24.6 | 2.6 s | 1.95 |
| 6 | 1 | 402 | 13 | 1.2 s | 1.60 |

結論：這組耗時受 load 影響很大（1.2–24.3 s），應以步數（402–1,793）為準。full 原型的步數與 scripted sim 同一量級。scripted sim 中造船只有 0–4 艘、`islandBonuses` 0–2，而且受 C3 的 log 上限影響，可能少算。

### 新增測試（建議值）

1. **`bots/test/sfck-module.test.ts`**（SFCK-1）：
   - `banditTargets` 真值表：首攻前擲 7、首攻後擲 7、騎士追強盜、騎士追海盜，共 4 種 × robber／pirate；
   - `knight.chasePirate` 候選的條件，包括蠻族接近時不追擊；
   - `supports` 必須三模組俱全；只有 SF 加 CK 時回 false。
2. **`bots/test/sfck-fallback.test.ts`**（SFCK-1）：把 F1–F11 轉為 I9 固定盤面，每一項都斷言「保底的動作被 rules 接受」；F1 另外斷言 SF 加 C&K 的保底會被拒（防止回歸）。
3. **decision 測試**（SFCK-2）：
   - 騎士不招募在自己船隊的 open end，也不站在計畫中的小島空點；
   - `either` 時海盜比強盜好就移海盜；
   - 金礦城市的估值；
   - aqueduct 計入金礦。
4. **B-GAME**（SFCK-3）：3/4/5/6 人 × 至少 10 seeds 全部完成、0 次被拒、`maxPerWindow < 40`、步數低於 harness 上限。建議門檻：每局 ≤ 2,500 步（full 最大 2,004）。
5. **B-FAIR**、fuzz、fallback-only（等同 `mixed`）：各 3/4/5/6 人。
6. **覆蓋門檻**（待決，§9）：
   - 40 局合計 `island.bonus` ≥ 20、`gold.chosen` ≥ 20、`ship.built` ≥ 200；
   - `knight.chasePirate` 太少見（40 局只有 6 次），改由固定盤面保證，不放進 sim 門檻。
7. **server 測試**：
   - 把 `packages/server/test/seafarers-cities-knights.test.ts:146-159` 的 `botSeats` 斷言改成 `true`，並改為斷言可以加入 Bot 座位；
   - `packages/server/test/bots.test.ts:252-264` 的通用迴圈會自動涵蓋。
8. **bench**：每種人數記錄每局步數、回合、耗時與 load。

---

## 8. 切片與工作量

| 切片 | 內容 | 檔案範圍 | 估計 | 依賴 |
|---|---|---|---|---|
| SFCK-0（平台鉤子；可併入平台 P 系列或 SFCK-1） | P-SFCK-1 至 5：`banditTargets`、`vertexBlocker` 注入、`hexYield` fold、base duty 回 undefined、setup 分數疊加 | `bots/src/{module,heuristic,fallback,board,sea,economy}.ts`、`bots/test/*` | **80–150 行** | 平台 P1/P2、SF-1（`sea.ts`）、C&K PR-B（`board.ts` 的騎士阻擋） |
| SFCK-1：組合模組 | `bots/src/seafarersCitiesKnights/`：view 與 hint accessor、`duty`（海盜追擊後的 moveRobber）、`banditTargets`、`knight.chasePirate` 候選、pacing、`supports`；I9 固定盤面與真值表 | 新目錄、`bots/src/modules.ts`、`bots/test/sfck-*.test.ts` | **src 150–250、test 200–300，共 350–550 行** | SFCK-0、SF-1、C&K PR-0/A/B |
| SFCK-2：策略整合 | either 比分、騎士位置罰分（open end 與小島空點）、追擊條件、金礦城市與 aqueduct 估值、島嶼計畫與改良的同尺度評分、easy 差異 | `bots/src/{seafarersCitiesKnights,heuristic,economy}.ts`、`bots/test/decisions-sfck.test.ts` | **src 250–400、test ~200，共 450–600 行** | SFCK-1、SF-2、C&K PR-B |
| SFCK-3：開放與驗收 | `BOT_RULE_MODULES` 加 `'seafarersCitiesKnights'`；harness 參數化（兩個組合 profile）；B-GAME、B-FAIR、fuzz、fallback-only；server 測試；`THINK_MS`；bench；文件（FIDELITY 67/136/520-521、SPEC 188/318、work log） | `bots/src/support.ts`、`bots/test/*`、`bots/bench/run.ts`、`server/test/{seafarers-cities-knights,bots}.test.ts`、`docs/*` | **250–350 行，另加文件約 30 行** | SFCK-2、SF-3、C&K PR-B（gating 已開放） |
| 選配：rules 匯出 SFCK hint 型別 | 只加 `export type` | `rules/src/index.ts`、`seafarersCitiesKnights/index.ts` | ~10 行 | 無 |

- **總計約 1,130–1,650 行**（src 約 500–800，其餘為測試），另加文件約 30 行。
- 規模約為 SF MVP（1,450–1,850 行，SF 報告:350）的 70–90%。原因是大部分工作已由 SF 與 C&K 完成，組合層只要「收窄」與「調和」。
- 推測：若 SF 與 C&K 實作時就預留了 P-SFCK-2、3、5 的形狀，SFCK-0 可以降到 40 行左右。

**MVP**：SFCK-0 加 SFCK-1 加 SFCK-2 的必要部分（either 比分、騎士位置罰分），再加 SFCK-3。

- **SFCK-2 不能整片延後**：沒有造船時 core 只完成 30/40；沒有組合層的 naive 有 4/40 局無限 backoff。
- **不依賴 C&K PR-C**：PR-C 的互動卡 frame 已由 PR-B 的 duty 保底（C&K 報告:651-661）。組合層唯一相關的卡是 Diplomacy 拆自己的船（C11），它在 PR-B 的 duty 中讀 `data.edges` 即可合法。

---

## 9. 風險與待決問題

### 風險

1. **確定性的拒絕造成無限 backoff**（`bot-driver.ts:402-423`）：naive 有 4/40 局。SFCK-1 的 duty 與 F1 固定盤面可以防止；平台層的通用防護（例如連續 N 次被拒就換保底的下一個候選）建議另外處理，見平台報告。
2. **`hexYield`、setup 的組合方式未定**（C7、C8）。若 SF-2 與 C&K PR-B 先各自定型，SFCK-0 可能要回頭改它們的介面。建議在平台 P 系列定案時就寫進組合規則表。
3. **覆蓋空洞**：
   - 40 局 0 座金礦城市；
   - 海盜追擊只有 6 次；
   - 4 人局 `gold.chosen` 每 10 局只有 8 次，因為主島沒有金礦（`facts.ts`：3p 金礦點數 5/4、4p 4/10、5–6p 9/5/10，全部在小島上）。
   sim 無法穩定覆蓋這些情況，需要固定盤面。
4. **長局**：core 4 人局最長 92 回合並撞到上限。只要缺島嶼擴張，B-GAME 就會不穩。full 的最大值為 2,004 步、69 回合。
5. **耗時受 load 影響**：同一組 full 在 load 1.2 時每局 1.1–1.7 s，在 load 3.7–4.4 時 1.7–2.4 s。scripted sim 在 load 33 時達 24 s。驗收應以步數與完成率為準。
6. **測試工具計數錯誤**：`sfck-sim.ts:144-151` 受 log 上限 200 影響，長局的海域事件會少算。若沿用它做覆蓋檢查會誤判。
7. 推測：首攻很早（2.5–4.4 回合），「盜賊離場」窗口很短，而強盜與海盜的切換集中在中盤。easy 只移強盜，強度可能明顯低於 standard。需要 bench 確認。

### 需要使用者決定

1. **gating**：SF+CK 是否必須三個 BotModule 都存在才開放？**建議是**，只有 SF 加 CK 時不開放。
2. **0.4.3 是否依賴 C&K PR-C？** **建議否**（理由見 §8）。
3. **覆蓋門檻**：island bonus、gold、ship 的 sim 門檻採用 §7 的建議值，海盜追擊與金礦城市改由固定盤面保證。這樣是否可以接受？
4. **海盜追擊的積極度**：建議保守，只在蠻族距離 ≥ 3、防禦有餘裕、且海盜壓在自己的船上時追擊。或者要更積極，接受防禦被削弱？
5. **rules 匯出 SFCK hint 型別**（`export type`，約 10 行）：是否接受這一行的 rules 變更？
6. **`moveRobber` 投影是否補 `pirate` 旗標？** 建議不補，只依賴 `bandit` hint，以免改變公開投影。
7. **窗口指令上限是否調高？** 實測最大 18 < 40，**建議不調**。
8. **`sfck-sim.ts` 計數錯誤**不在 Bot 範圍內：要另開 issue，還是併入 SFCK-3？
9. **easy 的組合行為**：建議 easy 不追擊海盜、只移強盜，但會依 SF easy 造船登島（否則難以達到 16 分）。是否同意？

---

### 附錄：probe 腳本（皆在 `/tmp/katan-bot-research/seafarers-cities-knights/`）

| 檔案 | 用途 | 輸出 |
|---|---|---|
| `facts.ts` | 地圖事實：金礦位置與點數、首攻後強盜位置、setup 第 2 輪的城市加船 | stdout |
| `lib.ts` | 共用：建局、`viewFor`、hint accessor、各層 duty（`sfckDuty`、`sfDuty`、`ckDuty`、`baseFallback`）、`composedFallback`、仿 BotDriver 的 `run()`（逐指令累計 `out.events`，避開 log 上限）、`summarize()` | — |
| `strategies.ts` | 原型策略：`ckCore`、`banditChoice(naive)`、`pirateChase`、`shipBuilder`（含騎士 blocker 的船 BFS） | — |
| `variants.ts` | `base`、`duty`、`core`、`full`、`mixed`、`naive`、`naivefb` 七種 variant。用法：`node --experimental-transform-types --no-warnings variants.ts <v> <players> <from> <to>` | `out/{base,duty,core,full,full-lowload,full-mixed,naive}.txt` |
| `conflicts.ts` | 8,353 個行動窗口中，各模組自己的模型與 hints 的比對計數 | `out/conflicts.txt` |
| `duty-fixtures.ts` | F1–F11 固定盤面，比較 base、sfOnly 與 composed 三種保底，以及 naive 選擇 | `out/fixtures.txt` |
| `sim-measure.ts` | rules scripted sim 的步數（以二分搜尋 `maxSteps` 求得）、回合、耗時與 load | `out/sim.txt` |
