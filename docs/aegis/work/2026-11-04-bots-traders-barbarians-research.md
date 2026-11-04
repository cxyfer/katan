# Traders & Barbarians 電腦對手：第 1 輪研究報告（Planner）

> 收錄說明：2026-11-04 第一輪唯讀研究報告，內容原樣保留，基準 `a200840`（v0.4.0）。定稿計畫是 `docs/aegis/plans/2026-11-04-bots-traders-barbarians.md`，研究之後的修正一律以計畫為準。文中的 `/tmp/katan-bot-research/<slug>/report.md` 對應 `docs/aegis/work/2026-11-04-bots-<slug>-research.md`；探查腳本與輸出沒有提交。

**結論**

- **現行 base Bot 不能直接上 T&B**：8 個 profile 裡，只有 Harbors 與 Rivers 能把一局打完。其餘的不是在模組 frame 上停住不動，就是 Friendly Robber 的強盜指令被拒後無限重試。兩種情況都違反 I9。
- **保底策略補齊後，6 個 profile 已能終局**：FR／H／FR+H／Fishing／Rivers／Trains 在原型中 100% 終局、0 次被拒。
- **BA 與 Traders 需要真正的劇本策略**：只靠保底，BA 0/10 終局，Traders 5/10。原型加上約 80 行劇本啟發式後，20 種子 × 3/4 人共 320 局全部終局、0 次被拒。
- **不需要改 rules**：所有合法目標都能從 view 與 hints 推導，因此不涉及 I3。
- **建議逐 profile 分批開放**：這需要修訂 SPEC §4.9 的一句話（第 9 節第 1 項待決）。

**基準與方法**

- 分支 `docs/expansion-ai-opponent-plans`，內容等於 v0.4.0（`a200840`）。全程唯讀，未修改 repo，也沒有任何 git 寫入。
- 探查腳本都在 `/tmp/katan-bot-research/traders-barbarians/`：
  - `base-bots-on-tb.ts`：現行 Bot 原封不動跑 T&B。
  - `scripted-sim.ts`：rules 腳本玩家計步。
  - `proto-fallback.ts`：T&B 保底原型，加上 plus 劇本啟發式。
  - `proto-window.ts`：每回合指令數量測。
- 所有腳本都模擬 BotDriver 的語意：策略先行；策略被拒或欠動作時改走保底；保底也被拒就判定卡住。
- **量測環境**：WSL2（Linux 5.15），與其他 agent 共用機器。量測期間 load average 在 70 到 2 之間變動，因此**耗時只是雜訊很大的參考值**。步數、回合數與終局率是決定性的，不受影響。
- 路徑縮寫：
  - `TB/` = `packages/rules/src/modules/tradersBarbarians/`
  - `R/` = `packages/rules/src/`
  - `B/` = `packages/bots/src/`
  - `BT/` = `packages/bots/test/`
  - `S/` = `packages/server/src/`
- 標「（推測）」的內容是依程式碼推論或設計判斷，尚未實測。

---

## 1. 範圍

| profile id | 人數 | 狀態 | parts（`activeParts`） | 勝利分 | topology | 出處 |
|---|---|---|---|---|---|---|
| `tb-friendly-robber-2025` | 3–4 | enabled，botSeats=false | `friendly-robber` | 10 | base 盤面 | `R/profiles.ts:293` |
| `tb-harbors-2025` | 3–4 | 同上 | `harbors` | 11（已含 Strongest Ports 的 +1） | base | `R/profiles.ts:294` |
| `tb-friendly-robber-harbors-2025` | 3–4 | 同上 | `friendly-robber`, `harbors` | 11 | base | `R/profiles.ts:295–298` |
| `tb-fishing-2025` | 3–4 | 同上 | `tb-fishing` | 10（持 old boot 者個人目標 +1） | `tb-r2` | `R/profiles.ts:299–304` |
| `tb-rivers-2025` | 3–4 | 同上 | `tb-coins`, `tb-rivers` | 10 | `tb-r2` | `R/profiles.ts:305–310` |
| `tb-merchant-trains-2025` | 3–4 | 同上 | `tb-merchant-trains` | 12 | `tb-r2` | `R/profiles.ts:311–317` |
| `tb-barbarian-attack-2025` | 3–4 | 同上 | `tb-coins`, `tb-barbarian-attack` | 12（`devDeck: []`、`retainLargestArmy: false`） | `tb-r2` | `R/profiles.ts:318–328` |
| `tb-traders-barbarians-2025` | 3–4 | 同上 | `tb-coins`, `tb-traders-barbarians` | 13（牌庫：16 barbarianKnight、3 roadBuilding、3 swiftJourney、3 VP） | `tb-traders-r2` | `R/profiles.ts:329–341` |

- 所有 profile 的 `ruleModules` 都是 `['tradersBarbarians']`，rule version 為 `tb-2025.2`（`R/profiles.ts:215–235`）。parts 由 scenario 與 variants 組成（`TB/index.ts:28–56`）。
- part id 就是 view 與 hints 的 key：
  - `tb-fishing`（`TB/fishing/index.ts:16`）
  - `tb-coins`（`TB/coins/index.ts:14`）
  - `tb-rivers`（`TB/rivers/index.ts:15`）
  - `tb-merchant-trains`（`TB/trains/index.ts:14`）
  - `tb-barbarian-attack`（`TB/barbarians/index.ts:18`）
  - `tb-traders-barbarians`（`TB/traders/index.ts:24`）
  - `friendly-robber`（`TB/variants/friendlyRobber.ts:15`）
  - `harbors`（`TB/variants/harbors.ts:12`）
- **不在範圍**：4 個 `tb-event-cards*` profile，均為 implemented:false（`R/profiles.ts:343–353`）。
- **現行 gating**：
  - `BOT_RULE_MODULES = []`，`botsCanPlay` 以 module 為單位判斷（`B/support.ts:12–17`）。
  - 伺服器逐 profile 呼叫（`S/bot-seats.ts:49–51`；`S/http.ts:288`）。
  - 測試 `packages/server/test/traders-barbarians.test.ts:72–89` 斷言所有 T&B profile 都是 `botSeats:false`，加入 Bot 時回 `E_INVALID_BOT`。
  - SPEC 文字見 `docs/SPEC.md:188`。

---

## 2. Bot 介面盤點

### 2.0 所有 part 共通

- **view**：`view.modules.tradersBarbarians` 的型別是 `Record<partId, project()>`（`TB/index.ts:184–188`）。外層型別只有 `Record<string, unknown>`（`R/project.ts:100`）。
- **hints**：`view.hints.modules.tradersBarbarians` 的形狀為 `{ [partId]: partHints, targets: Record<string, number[]>, board: BoardChoice | null, robberHexes?: number[] }`（`TB/index.ts:194–215`；`R/engine.ts:2103–2107`；`R/project.ts:68`）。
  - `targets` 是各 part `targets` 的合併。
  - `board` 取第一個非 null 的值。
  - `robberHexes` 只在某個 part 有 `robberTargets` 時才存在，目前只有 friendly-robber。
- **pending**：形狀為 `PublicModulePendingView { kind, module, responders, data }`（`R/modules/types.ts:181–187`）。composite 的預設 `data` 是 `{}`（`TB/index.ts:189–193`）。
- **指令**：
  - `ModuleCommand` 是 `{ type: string; [field]: unknown }`（`R/modules/types.ts:33–36`）。
  - `applyCommand` 同時接受 `Command | ModuleCommand`（`R/engine.ts:669–673`），伺服器端的 `CommandRequest.command` 也已是寬鬆型別（`packages/protocol/src/index.ts:299–303`）。
  - pending 存在時，只接受 `PENDING_COMMANDS` 與模組的 `pendingCommands`，其餘回 `E_PENDING_EFFECT`（`R/engine.ts:701–703`）。T&B 的 `pendingCommands` 是所有 part 的聯集（`TB/index.ts:172`）。
- **回合結束**：`turn.end` 先過 `beforeEndTurn`；任一 `onEndTurn` 回 `'defer'` 時，回合停在 action 並帶著 frame，由模組自行呼叫 `kit.finishTurn`（`R/engine.ts:1115–1135`）。`checkVictory` 只檢查當前玩家（`R/engine.ts:580–595`）。
- **沒有 phase veto**：逐 part grep 確認，T&B 沒有實作 `vetoCommand`、`beforeEndTurn`、`disabledCommands`、`discardLimit`、`modifyProduction`、`activatePending`、`resumePending` 等 hook。回合結構只透過以下途徑改變：`frames`、`onEndTurn`、`rollDice`、`sevenRobberStep`、`setupBuilding`、`roadAllowed`／`buildingAllowed`、`afterBuild`／`afterProduction`、`awardRules`、`score`、`victoryTarget`、`robberTargets`／`stealCandidates`。
- **型別缺口**：`R/index.ts:12` 只匯出 EP 的 view 型別，T&B 的 view 與 hints 型別都沒有匯出。web 端自行定義了本地型別（`packages/web/src/components/tb/model.ts`，共 36 行，只有 `HarborsView`）。
- **frame／pendingCommands 清單核對**（與 `TB/messages.ts` 及各 part 的 `commands` map 交叉比對，沒有遺漏）：

| part | `frames` | `commands` | `pendingCommands` |
|---|---|---|---|
| fishing | `TB/fishing/index.ts:333` | `:361–365` | `:366` |
| trains | `TB/trains/index.ts:249` | `:279–283` | `:284` |
| barbarians | `TB/barbarians/index.ts:444` | `:499–507` | `:508` |
| traders | `TB/traders/index.ts:317` | `:384–393` | `:394` |
| coins | 無 frame | `TB/coins/index.ts:113–116` | — |
| rivers | 無 frame | `TB/rivers/index.ts:90` | — |
| friendly-robber、harbors | 無 frame | 無指令 | — |

### 2.1 friendly-robber（`TB/variants/friendlyRobber.ts`）

- **(a) 指令**：沒有新指令。base 的 `pending.moveRobber` 與 `dev.playKnight` 可選的格子被縮小，`pending.steal` 的候選人也被過濾。
  - 合法格的取得方式：`hints.modules.tradersBarbarians.robberHexes`（`TB/index.ts:208–212`）。
  - steal 候選：base 的 `pending.candidates` 已套用 `stealCandidates`，會濾掉公開分數 ≤2 的玩家（`:42–44`）。
- **(b) frames**：沒有新 frame。
  - 被保護的格子：碰到公開分數 ≤2 玩家建築的格子（`:19–31`）。
  - 若所有格子都受保護，合法格只剩 desert，**即使強盜已經在 desert 上**（`:34–40`）。
  - engine 在有模組時，以 `legalRobberHexes` 判定合法性，因此「原地不動」是合法的（`R/engine.ts:1462–1482`）。
- **(c) 回合**：與 base 相同。
- **(d) view／hints**：沒有 project。hints 只有 root 上的 `robberHexes`。
  - 小差異：hints 計算 `robberHexes` 時沒有過濾 `isLandHex`（`TB/index.ts:210`），engine 則有過濾（`R/engine.ts:1464`）。FR 只用在 base 盤面，19 格都是陸地，所以沒有實害。
- **(e) 隱藏資訊**：沒有新增。**(f) 交易**：沒有變化。

### 2.2 harbors（`TB/variants/harbors.ts`）

- **(a)(b)**：沒有新指令，也沒有 frame。
  - 每次 `afterBuild` 重算港口點數：港口路口上的聚落算 1、城市算 2。
  - 第一位達到 3 點的玩家得 Strongest Ports（2 VP）。之後只有**嚴格更多**才會轉移；並列第一時不轉移（`:17–58`）。
- **(d) view**：`harbors: { holder: string | null, portPoints: Record<id, number>, minimum: 3 }`（`:62–65`）。沒有 hints。
- **(e)**：沒有隱藏資訊。**(f)**：港口匯率仍是 base 規則。

### 2.3 tb-coins（Rivers／BA／Traders 共用，`TB/coins/index.ts`）

| 指令 | 欄位 | 合法時機 | 目標與可行性來源 |
|---|---|---|---|
| `tb.buyResource` | `{resource}` | 自己的 action phase（`:59–63`） | 每回合 2 次，以 windowId 計（`:19`、`:71–76`）；每次 2 gold（`:18`）；銀行要有貨。依據：view 的 `purchasesLeft`、`gold`，以及 `view.bank`（`R/project.ts:77`） |
| `tb.sellResources` | `{resource}` | 同上 | 付 `harborRates[resource]` 張資源換 1 gold，gold supply 要 >0（`:84–103`）。依據：hints 的 `sellRates` |

- 錯誤碼：`E_TB_PURCHASE_LIMIT`、`E_TB_GOLD_SHORT`、`E_BANK_EMPTY`、`E_INSUFFICIENT_RESOURCES`、`E_TB_GOLD_SUPPLY_EMPTY`、`E_INVALID_SELECTION`。
- **view**：`tb-coins: { gold: Record<id, number>, supply, purchasesLeft, goldPerResource }`（`:124–134`）。
- **hints**：`{ canTrade, sellRates }`（`:135–138`）。
  - 缺口：沒有「能買哪些資源」的清單，要從 `view.bank` 推導。
- **(f) 國內交易**：`tradeGoods.ids = ['gold']`（`:117–123`，由 composite 轉接，`TB/index.ts:159–169`），所以報價可以帶 `giveGoods` 與 `wantGoods`。
  - 建立報價：`R/engine.ts:1818–1828`。
  - consent 時檢查對方是否持有：`R/engine.ts:1874`。
  - settle 時轉移 gold：`R/engine.ts:1979–1990`。
- **(e)**：gold 全部公開。

### 2.4 tb-fishing（`TB/fishing/index.ts`）

**(a) 指令**

| 指令 | 欄位 | 合法時機 | 合法目標來源 | 缺口（需由 Bot 自行推導） |
|---|---|---|---|---|
| `tb.spendFish` | `{action: 'removeRobber' \| 'steal' \| 'takeResource' \| 'road' \| 'devCard', tokens: (1\|2\|3)[], victim?, resource?, edge?}` | 自己的 action phase | `tokens` 填 **token 的值**，不是索引，從 view 的 `mine` 取（`:203–206`）。成本見 view 的 `costs`：2/3/4/5/7。多付不找零（`:207–209`）。road 的邊從 `hints.targets['tb.spendFish']` 取（`:394–397`） | victim：`view.players[].resourceCount > 0`（`:219–224`）；resource：`view.bank[r] > 0`（`:226–230`）；removeRobber：`view.board.robber >= 0`（`:215–217`）；**hints 的 road 清單沒有檢查道路棋子是否用完**（`:394–397` 與 `:233–238` 對照）；devCard：`view.devDeckSize > 0` |
| `tb.giveBoot` | `{to}` | 自己的 action phase，且持有 boot | `hints.bootTargets`：公開分數 ≥ 自己的玩家（`:402–405`、`:286–300`） | — |
| `tb.fishSwap` | `{token: 1\|2\|3\|null}` | SWAP frame 的 `responders[0]`（`:302–306`） | `mine`；`hints.swap` | 傳 `null` 表示放棄，但同樣會用掉本回合的交換權（`:320–324`） |

**(b) frame**

- `tradersBarbarians.fishSwap`：發魚途中，若某位玩家已持有 7 枚 token（以枚數計，`:66–68`、`:23`），且本回合尚未交換過，就開啟這個 frame，並把剩下的發放暫停排隊（`:99–117`）。
- responder 可能是**非行動者**。
- `data` 只對 responder 提供 `{limit}`，排隊中的發放不投影（`:386–388`）。
- 回答 `tb.fishSwap` 後繼續發放（`:325–327`）。
- 沒有修改 base frame。fishing 盤面上強盜起始位置是 -1（`TB/fishing/board.ts:74–75`）。

**(c) 回合**

- 擲出 7 不發魚（`:357`）。
- 其他點數依漁場（4、5、6、8、9、10）與湖（2、3、11、12）發魚。
- setup 第二座聚落若鄰接漁場或湖，得 1 魚（`:351–355`）。
- 沒有 onEndTurn。

**(d) 形狀**

- view `tb-fishing`（`:370–385`）：

  ```
  { grounds: {..., number, vertices[], edges[]}[], lake, lakeNumbers,
    supplyCount, discard: [n1, n2, n3], tokenCounts: Record<id, n>,
    boot: string | null, mine?: (1|2|3)[], limit: 7, costs }
  ```

- hints（`:389–409`）：

  ```
  { canSpend, fish /* 手上 token 總值 */, canGiveBoot, bootTargets,
    targets: {'tb.spendFish': number[]}, swap }
  ```

- 持有 boot 的人勝利目標 +1（`:367–369`）。這個個人目標放在 `PublicPlayerView.victoryTarget`，只有與 profile 不同時才出現（`R/project.ts:147–148`）。

**(e) 隱藏資訊**

- 他人手上 token 的值不公開，只公開 `tokenCounts`。
- supply 的組成不公開，只公開 `supplyCount`；初始為 11 枚 1、10 枚 2、8 枚 3，外加 1 隻 boot（`:21`）。
- 交換抽到的 token 只告訴本人（`:319`）；偷到的資源只告訴雙方（`:259`）。

**(f)**：交易規則不變。

### 2.5 tb-rivers（`TB/rivers/index.ts`）

- **(a) 指令** `tb.buildBridge {edge}`：自己的 action phase。
  - 成本 brick 2、lumber 1；每人最多 3 座；每造一座得 3 gold（`:17–18`、`:54–74`）。
  - 合法邊：`hints.targets['tb.buildBridge']`（`:107–115`）。
- **(b)**：沒有 frame。
- **(c) 回合與規則**：
  - bridge site 永遠不能蓋路，setup 也不行（`:81–84`）。
  - 在河流格的路口蓋聚落、在河流格的邊蓋道路（含 setup），各得 1 gold（`:85–89`）。
  - 計分：gold 唯一最多者 +1；**所有** gold 最少者 −2（`:33–42`、`:91–94`）。依程式推論，開局人人 0 gold，所以人人都是 −2。
  - 12 那格同時產出點數 2（`TB/rivers/board.ts:103`；投影在 `view.board.extraNumbers`，`R/project.ts:250`）。
  - 強盜起始在 swamp 上（`TB/rivers/board.ts:101`）。
- **(d) 形狀**：
  - view `tb-rivers`：`{ hexes, bridgeSites, edges, vertices, ...RiverGeometry, bridges: Record<id, 剩餘數>, wealthiest, poor: string[], bridgeCost }`（`:95–106`；`TB/rivers/board.ts:48–56`）。
  - hints：`{ targets: {'tb.buildBridge': number[]} }`。
- **橋的表示**：橋存成 `board.roads[e] = {bridge: true}`（`:68`）。它算在路線長度裡，但不算道路棋子（`R/types.ts:141–142`；`R/analysis.ts:47–51`）。
- **(e)**：gold 公開。**(f)**：同 coins。

### 2.6 tb-merchant-trains（`TB/trains/index.ts`）

**(a) 指令**

| 指令 | 欄位 | 合法時機 | 目標來源 |
|---|---|---|---|
| `tb.bidWagon` | `{wool, grain}`（非負整數，且要持有） | BID frame 的 `responders[0]`，依座位從行動者開始輪（`:190–213`、`:273–276`） | `hints.bidTurn` |
| `tb.assignWagon` | `{edge}` | ASSIGN frame 中任何尚未指派的出價者，不限順序（`:215–231`） | `hints.locations`／`board.targets` |
| `tb.placeWagon` | `{edge}` | PLACE frame 的 responder（`:233–245`） | 同上 |

**(b) frames**：`wagonBid` → `wagonAssign` → `wagonPlace`（`:140–175`）

- **觸發條件**：行動者本回合在 action phase 蓋了聚落或城市，就收集一節車廂（`:260–267`）。回合結束時，若本回合有收集、還有庫存且有可放的位置，就開啟 BID 並 defer（`:268–278`）。
- **出價之後**：
  - 有人得票過半 → 由他 PLACE。
  - 沒有人出價 → 由行動者 PLACE。
  - 其餘情況 → 所有出價者進入 ASSIGN。
- **ASSIGN 之後**：得票最多的位置直接放置。若平手，由唯一的最高出價者 PLACE，否則由行動者 PLACE。
- 所有出價最後都退回銀行（`:177–181`）。
- `projectPending` 公開完整的 `data`（`:312–315`）。

**(c) 計分**

- 放了車廂的邊在最長道路中權重為 2（`:285–291`）。
- 位於兩節車廂之間的建築 +1 VP（`:114–116`、`:292–295`）。
- 強盜起始 -1（`TB/trains/board.ts:52`）。

**(d) 形狀**

- view `tb-merchant-trains`（`:296–311`）：

  ```
  { oasis, starts, wagons: {edge, train}[], heads, supply, collected,
    betweenWagons, vote: {bids, assignments, active} | null }
  ```

- hints（`:316–332`）：`{ locations, bidTurn, board: {kind: 'edge', commandType, labelId, targets} | null }`。

**(e)**：沒有新增隱藏資訊（出價公開）。**(f)**：沒有變化。

### 2.7 tb-barbarian-attack（`TB/barbarians/index.ts`）

**(a) 指令**

| 指令 | 欄位 | 合法時機 | 目標來源 |
|---|---|---|---|
| `tb.buildBaCard` | `{}` | 自己的 action phase；花 wool、grain、ore 各 1（`:22`）；牌庫加棄牌堆不能為空（`:170–176`） | `hints.canBuildCard`（`:578`） |
| `tb.baCapture` | `{hex}` | CAPTURE frame 的 responder | `board.targets`，kind 為 hex（`:551`） |
| `tb.baPlaceKnight` | `{edge}` | KNIGHTHOOD frame（castle 的空邊）或 SWIFT frame（任何空邊）（`:232–253`） | `board.targets`（`:552–559`） |
| `tb.baTreason` | `{from, to}`（`from = -1` 表示從 supply 拿） | TREASON frame，最多 2 步（`:255–287`） | `hints.treasonMoves: [from, to][]` |
| `tb.baSteal` | `{victim}` | STEAL frame | `hints.stealVictims` |
| `tb.moveKnight` | `{from, to, boost?}` | KNIGHTS frame；每個騎士每回合動一次；射程 3，花 1 grain 加速為 5（`:331–352`） | `hints.knightMoves[{from, targets, boosted}]`，root `targets['tb.moveKnight:<from>:<0\|1>']`（`:561–571`） |
| `tb.endKnights` | `{}` | KNIGHTS frame；若自己有騎士在 castle 邊上，且它還有地方可去，會回 `E_TB_KNIGHT_MUST_MOVE`（`:355–370`） | 缺口：要自行用 `knights`、`castleEdges` 與 `knightMoves` 判斷 |

**(b) frames**：responder 都只有行動者一人（`:135–137`）

- `baSteal`：7 結算棄牌後，若有可偷的對象就開啟（`:484–488`）。
- `baCapture`／`baKnighthood`／`baSwiftKnight`／`baTreason`：由 `buildBaCard` 抽到對應牌時開啟；牌無效時直接棄掉或不開 frame（`:178–216`）。
- `baKnights`：回合結束時，若自己有騎士就開啟並 defer；沒有騎士則直接驅逐（`:489–498`）。
- `projectPending` 只提供 TREASON 與 KNIGHTS 的 `data`（`:538–542`）。

**(c) 回合**

- setup 第二座蓋城市（`:467`）。
- action phase 每蓋一個非道路建築就觸發入侵：擲 3 次，點數不重複且不是 7，在對應的海岸格放野蠻人。一格累積 3 隻即被征服（`:109–125`、`:480–483`）。
- 被征服的格子不生產，不能在上面蓋路或建築，港口也失效（`:468–479`）。
- 驅逐後才 `finishTurn`（`:366–369`）。
- 沒有強盜、沒有發展卡（`R/profiles.ts:318–328`）。
- 計分：`floor(俘虜數 / 2) − 被征服建築的分數`（`:509–518`）。

**(d) 形狀**

- view `tb-barbarian-attack`（`:519–537`）：

  ```
  { castle, castleEdges, coastal, barbarians: Record<hex, n>, conquered,
    conqueredBuildings, supply, knights: {player, edge}[], knightsLeft,
    prisoners, deckCount, discard, orientations }
  ```

- hints（`:543–584`）：`{ canBuildCard, board, targets, knightMoves, treasonMoves, stealVictims }`。

**(e) 隱藏資訊**

- 手牌組成不公開。
- 牌庫順序雖不公開，但抽牌時才以 rng 隨機抽（`:154–162`），所以順序本身不含資訊。剩餘組成可以由 `BA_DECK` 減去 `discard` 推得（`:28–33`）。

**(f) gold 來源**：Treason 得 2 gold（`:205`）；驅逐時平手者，以及每損失一名騎士，各得 3 gold（`:430–440`）；另可透過 coins 買賣。

### 2.8 tb-traders-barbarians（`TB/traders/index.ts`）

**(a) 指令**

| 指令 | 欄位 | 合法時機 | 目標來源與缺口 |
|---|---|---|---|
| `tb.moveBarbarian` | `{from, to}` | BARBARIAN frame（7 結算棄牌後，`:346–349`） | `from` 取自 view 的 `barbarians`；`to` 取自 root `targets['tb.barbarian:'+from]`，即所有空邊（`:425–427`）。若 `to` 是對手的道路，會偷該玩家一張牌（`:103–116`） |
| `tb.playKnight` | `{from, to}` | 自己的 preroll 或 action phase；本回合還沒出過發展卡；持有 barbarianKnight 且不是本回合買的（`:136–164`） | `hints.canPlayKnight`；目標同上。計入 `playedKnights`，可爭 Largest Army |
| `tb.playSwiftJourney` | `{}` | 同上（`:166–172`） | `hints.canPlaySwift` |
| `tb.upgradeWagon` | `{}` | 自己的 action phase（`:174–187`） | `hints.canUpgrade` 與 view 的 `upgradeCosts`；缺口：資源是否足夠要自行檢查 |
| `tb.wagonStep` | `{to: vertex}` | MOVE frame；成本不能超過剩餘 MP；走對手的路要付 1 gold（`:236–259`） | `hints.steps`／`board.targets`（`:304–315`、`:430–435`） |
| `tb.wagonBoost` | `{}` | MOVE frame，每次移動限一次；1 grain 換 +2 MP（`:261–273`） | 缺口：要看 `pending.data.boosted` 與手牌 |
| `tb.driveOff` | `{barbarian, to}` | MOVE frame；馬車等級 ≥2；野蠻人要在相鄰邊；每隻每回合只能試一次；擲骰達門檻才成功（`:275–295`） | `hints.driveOff`，`to` 從 targets 取 |
| `tb.wagonStop` | `{}` | MOVE frame（`:297–301`） | 永遠合法 |

**(b) frames**

- `tbWagon`：只要馬車已放上盤面，回合結束時一律開啟（`:373–383`）。`data { mp, boosted, extra, drivenOff }` 公開（`:414–416`）。
- `tbBarbarian`：7 結算棄牌後開啟，`data` 為 `{}`。

**(c) 回合**

- 擲出 2 或 12 重擲（`:338–345`）。
- setup 第二座蓋城市，並決定馬車起點（`:337`、`:362–368`）。
- X edge 不能蓋路（`:350–352`）。plaza 與只連到 X edge 的路口不能蓋聚落（`:353–361`）。
- **Longest Road 停用**：`minLongestRoad = Infinity`（`:369–372`）。
- 移動成本：沒有路 2 MP、有路 1 MP，有野蠻人再 +2；走對手的路付 1 gold 給路主（`:190–197`）。
- 進入 plaza：先交貨（得到與馬車等級對應的 gold），再裝貨，本次移動結束（`:200–234`、`:254–257`）。
- Swift Journey 讓本回合多一次移動（`:220–228`、`:377`）。
- 計分：交貨數，馬車升滿再 +1（`:395–399`）。起始 5 gold（`:25`、`:333–336`）。

**(d) 形狀**

- view `tb-traders-barbarians`（`:400–413`）：

  ```
  { sites: {id, hex, plaza, needs[]}[], xEdges, barbarians: number[],
    stackCounts, wagons: Record<id, {vertex, level, cargo, delivered}>,
    levels, upgradeCosts, swift }
  ```

- hints（`:417–449`）：`{ targets, board, steps, driveOff, moveBarbarian, canUpgrade, canPlayKnight, canPlaySwift }`。

**(e) 隱藏資訊**

- 貨物堆的內容不公開，只公開 `stackCounts`；裝貨時才以 rng 抽出（`:212–215`）。
- 發展卡牌庫與他人手上的發展卡不公開。

**(f) gold**：交貨收入、過路費（轉給路主）、coins 買賣。

### 2.9 對 B-FAIR 的影響

現行 `hideDifferently` 只會擾動資源、`devCards` 與 `devDeck`（`BT/fair.test.ts`）。要涵蓋 T&B，需另外擾動：

- **Fishing**：在公開枚數不變的前提下，改變對手 token 的值與 supply 的組成。
- **BA**：改變牌庫順序。
- **Traders**：改變貨物堆內容與牌庫組成。

其他資訊（gold、出價、騎士、野蠻人）都是公開的。T&B 事件帶有個人化參數（例如 `tb.fishSwapped` 的抽到值），但 `view.events` 已經依座位投影過；策略本來就不需要讀 events。

---

## 3. 現行 base Bot 的落差

**實測一：現行 Bot 原封不動跑 T&B**（`base-bots-on-tb.ts`，每種人數 3 個種子）

| profile | 結果 |
|---|---|
| 對照組 `base-2025`（10 種子／人數） | 全部終局，平均 299 步、70 回合、每局 501 ms |
| FR、FR+H | 第一次擲出 7 就卡住（第 15–32 步）：策略與保底的 `pending.moveRobber` 都被回 `E_ILLEGAL_TARGET` |
| Harbors | 全部終局（235–447 步） |
| Fishing | 6 局中 5 局停在 `fishSwap`（第 174–246 步） |
| Rivers | 全部終局（149–388 步） |
| Trains | 停在 `wagonBid`（第 35–70 步） |
| BA | 停在 `baSteal`（第 19–36 步） |
| Traders | 第 1 回合就停在 `tbWagon` 或 `tbBarbarian`（第 14–19 步） |

**落差清單**

**G1｜模組 frame 一律回 null，違反 I9（嚴重，會卡死）**
- `pendingDuty` 遇到模組 frame 時走 `default: return null`，註解寫著「bots are only seated in base profiles」（`B/fallback.ts:41–43`）。`pendingDecision` 也一樣（`B/heuristic.ts:162–164`）。
- pending 存在時，`decide` 只回 `pendingDuty` 的結果（`B/fallback.ts:60`；`B/heuristic.ts:117`）。
- BotDriver 因此找不到任何動作，回傳 null（`S/bot-driver.ts:296–345`）。因為沒有指令被拒，**連退避重試都不會排程**，整局永久停住。這違反 I9（`docs/aegis/specs/2026-11-01-bot-opponents.md:48`）與 SPEC 的 Safeguards（`docs/SPEC.md:190`）。
- 受影響：Fishing、Trains、BA、Traders。

**G2｜Friendly Robber 的強盜目標非法（嚴重，無限重試）**
- 保底選第一個「不是強盜目前位置、也不是海」的格子（`B/fallback.ts:19–25`）；策略的評分同樣只排除這兩種（`B/heuristic.ts:195–222`）。兩者都沒有讀 `robberHexes`。
- 保底也被拒後，BotDriver 每 `retryMs`（預設 30 秒，`S/config.ts:104`）重試一次（`S/bot-driver.ts:420–423`），但永遠失敗。
- 全部格子都受保護時，唯一的合法格是「留在 desert 原地」，而兩者都把當前格排除在外。
- `dev.playKnight` 有相同問題（`B/heuristic.ts:398–409`）。

**G3｜從不使用模組指令（BA 與 Traders 因此無法終局）**
- fish、gold 買賣、造橋、BA 卡、BA 騎士、Traders 的升級、Knight 卡、Swift Journey，Bot 全都不會用。
- 實測（第 7 節）：只補保底時，BA 0/10 終局，到 8000 步上限時已打了約 2400 回合；Traders 5/10。
- （推測）BA 不終局的原因：沒有 BA 卡就沒有騎士，也就沒有俘虜分；每次蓋建築又會引來入侵、被征服而扣分。

**G4｜忽略個人勝利目標**
- `B/heuristic.ts:214`、`:404` 與 `B/trade.ts:57` 都用 `view.victoryTarget`，忽略 `PublicPlayerView.victoryTarget`（`R/project.ts:147–148`）。
- 在 Fishing，持有 boot 的一方會錯判「這步就能贏」，對其他玩家的威脅估計也會偏差。

**G5｜Traders 白追已停用的最長道路**
- 沒有人持有最長道路時，以 `max(5, holderLength + 1)` 估計所需長度（`B/economy.ts:259–280`）。
- 但 Traders 的最長道路已停用（`TB/traders/index.ts:369–372`），這些資源等於浪費。道路本身仍有降低馬車 MP 成本的價值，只是估值方式錯了。

**G6｜Traders 錯過 Largest Army**
- barbarianKnight 會累加 `playedKnights`（`TB/traders/index.ts:155–160`），但 `canPlay` 與 `knightDecision` 只認 `'knight'`（`B/heuristic.ts:372–378`、`:398–409`）。

**G7｜交易估值忽略 goods（可被真人利用）**
- `offerGain` 只看 `give` 與 `want`（`B/trade.ts:38–44`）。
- 依程式推論（未實測）：若對手提出「我給 1 wool，你給 5 gold」，Bot 會以為白拿 1 wool 而同意。engine 在 consent 時只檢查 Bot 是否持有那些 gold（`R/engine.ts:1874`），settle 時就轉走（`:1989–1990`）。
- 在 Rivers，這會直接影響 Wealthiest／Poor 的分數。

**G8｜盤面模型錯估（不會送出非法指令）**
- 忽略 `extraNumbers`（`B/board.ts:89`）。
- 把橋算進道路棋子（`B/board.ts:139–141`；對照 `R/analysis.ts:49`）。
- `routeLength` 沒有計入車廂權重 2。
- 道路搜尋不知道 bridge site、X edge、被征服格不能蓋路。
- 實際送出的道路仍會用 `legalRoads` 過濾（`B/heuristic.ts:588`、`:592`），所以只是估值錯誤，不會變成非法指令。

**G9｜setup 估值沒有劇本權重**
- 沒算到：漁場與湖、河流 gold、港口分、馬車起點、BA 的城市與海岸征服風險（`B/heuristic.ts:312–316` 只用 base 評分）。

**G10｜型別**
- `decide` 的回傳型別是 `Command | null`（`B/types.ts:39`），BotDriver 也寫成 `let command: Command | null`（`S/bot-driver.ts:314`）。模組指令只能靠轉型送出。

**G11｜節奏與上限**
- `THINK_MS` 沒有任何 `tb.*` 項目，一律套用 900 ms 預設（`S/bot-driver.ts:39–64`）。
- 每回合 40 指令上限（`:70`）：實測每個 Bot 每回合最多 15 道，目前不構成問題（第 7 節）。

**G12｜測試設施**
- `profileFor` 寫死 base（`BT/harness.ts`）。
- `RESPONSE_COMMANDS` 不含模組回應指令（`BT/policy.test.ts:18–25`）。

---

## 4. 需要的平台與規則端支援

| # | 需求 | 理由 | 影響面 |
|---|---|---|---|
| P1 | `decide` 回傳 `Command \| ModuleCommand \| null`（例如定義 `BotCommand` 型別） | G10；runtime 已經支援 | `B/types.ts:39`、`B/fallback.ts`、`B/heuristic.ts`、`S/bot-driver.ts:314` 的 Decision 型別 |
| P2 | 逐 profile 的 gating：`botsCanPlay(profile)` 改看 profile id 白名單，或改看「profile 的 parts 是否都受支援」 | T&B 只有一個 composite module，以 module 為單位就無法分批開放 | 只需改 `B/support.ts:12–17`，伺服器與網頁本來就逐 profile 呼叫（`S/bot-seats.ts:49–51`、`S/http.ts:288`）；另需更新 SPEC `docs/SPEC.md:188` 與 `packages/server/test/traders-barbarians.test.ts:72–89` |
| P3 | T&B view 與 hints 的型別存取層 | `R/index.ts:12` 沒有匯出 T&B 型別 | 建議在 bots 內自訂本地型別與 guard，比照 web 的 `model.ts`，再加一個形狀測試，以真實投影驗證欄位存在。另一個做法是 rules 只新增型別匯出（見第 9 節第 5 項） |
| P4 | `THINK_MS` 補上 `tb.*` 項目 | 例如 `tb.wagonStep` 400 ms、`tb.fishSwap` 700 ms、`tb.bidWagon` 900 ms（數值為推測） | `S/bot-driver.ts:39–62` |
| P5 | harness 接受 profile 參數；contract 加入模組回應指令 | 非行動者可能需要送出 `tb.fishSwap`、`tb.bidWagon`、`tb.assignWagon`、`tb.placeWagon` | `BT/harness.ts`、`BT/policy.test.ts:18–25` |
| P6 | B-FAIR 能擾動模組的隱藏狀態 | 見 2.9 | `BT/fair.test.ts` |
| P7 | 40 指令上限 | 實測最多 15，暫時不需要動；建議在 bench 中監控 | 不需修改 |

**不需要改 rules，不涉及 I3**。I3 要求 rules 的規則、GameState、事件與錯誤碼不變（`docs/aegis/specs/2026-11-01-bot-opponents.md:42`）。所有缺口都能從 view 推導：

- fish 偷牌對象：`players[].resourceCount`
- fish 拿資源：`bank`
- 移除強盜：`board.robber`
- 道路棋子剩餘：`piecesLeft`
- boost 可否使用：`pending.data` 加上手牌
- 騎士是否必須移動：`knights`、`castleEdges` 與 `knightMoves`
- 升級與購買可否負擔：成本表加上手牌與 gold

另有兩個 rules 端的小差異，建議不修：hints 的 `robberHexes` 沒過濾陸地（無實害），fishing 的 road 目標清單沒檢查道路棋子。由 Bot 在本地檢查即可。

---

## 5. 策略設計草案

### 5.0 共通架構

- 新增 `B/tb/` 目錄：
  - `view.ts`：型別存取層。
  - `duty.ts`：保底動作，由 `B/fallback.ts` 的 `pendingDuty` 呼叫。BotDriver 直接呼叫的是 `fallbackPolicy`（`S/bot-driver.ts:333`），所以 I9 必須在這一層成立。
  - 各 part 的策略：`fishing.ts`、`coins.ts`、`rivers.ts`、`trains.ts`、`barbarianAttack.ts`、`traders.ts`。
- `heuristic.ts` 開三個掛點：
  - `pendingDecision` 的 default 分支改為交給模組。
  - `actionDecision` 在建造前後插入模組動作。
  - 計畫清單（`economy.ts` 的 `PlanKind`，`B/economy.ts:92`）新增 `bridge`、`baCard`、`wagonUpgrade` 等計畫，並把 gold 視為可替代資源。
- **重用既有程式**：
  - `board.ts` 的 `BoardModel`：補上 `extraNumbers`、魚 pip、河流 gold 路口、海岸征服風險、港口點數、車廂權重。
  - `economy.ts`：計畫評分與 `bankRates`（`:183`）。
  - `trade.ts`：`offerGain` 補上 goods。
  - `heuristic.ts`：`robberHex` 的評分（`:195–222`）可用於 FR 合法格、BA 偷牌對象與 Traders 野蠻人目標；`knightDecision`（`:398–409`）可泛化給 barbarianKnight。
- **easy 等級的共通原則**：
  - 沿用 `topK = 3`（`B/heuristic.ts:63–66`）。
  - 只使用「能完成建造」或「不用就虧」的模組動作，不出價，也不主動提出含 gold 的報價。
  - 實測只靠保底時，BA 與 Traders 不會終局，所以 easy 仍需要最低限度的劇本行為。
- **交易**：
  - 個人勝利目標一律改用 `me.victoryTarget ?? view.victoryTarget`。
  - 收到含 `giveGoods`／`wantGoods` 的報價：MVP 一律拒絕；強化版再用 gold 估值計算。

### 5.1 Friendly Robber

- **standard**：moveRobber 與 playKnight 的格子先與 `robberHexes` 取交集，再套用既有評分。
- **easy**：從交集中取 topK。
- 全部受保護時直接選 desert（含原地不動）。

### 5.2 Harbors

- **standard**：
  - setup 與聚落／城市估值加入港口點數：港口路口的聚落 +1 點、城市 +2 點。
  - 若這一步讓自己達到 3 點並嚴格超過持有者，視為 +2 VP。
  - 城市優先升級港口上的聚落。
- **easy**：權重減半，或維持 base 行為。

### 5.3 Fishing

- **setup**：第二座聚落鄰接漁場或湖時 +1 魚。路口的魚價值以「魚 pip × 約 0.4 張資源」估算（權重為推測）。
- **spendFish（standard，依序判斷）**：
  1. 強盜在自己的產出格上，且魚 ≥2 → removeRobber。
  2. 魚 ≥5，且計畫的下一步是道路、該邊在 targets 中、道路棋子還有剩 → road。
  3. 魚 ≥4，且只缺一張資源就能完成建造 → takeResource。
  4. 魚 ≥3，領先者手上有牌 → steal。
  5. 魚 ≥7，且牌庫還有牌 → devCard。
  - token 組合：手上最多 7 枚，枚舉 2^7 種子集，選總值 ≥ 成本且最小的組合。
- **fishSwap**：
  - standard：手上有值為 1 的 token 就換掉它，否則放棄。依程式推論，初始 supply 的期望值約 1.9（`TB/fishing/index.ts:21`），抽到 boot 的機率約 1/30。
  - easy：一律放棄（`null`）。
- **giveBoot**：
  - standard：持有 boot 就送出，對象選 `bootTargets` 中公開分數最高者。
  - easy：只在自己接近勝利時才送。

### 5.4 Rivers（加上 coins）

- **setup**：河流格的路口與邊額外加 gold 價值；bridge site 不能列入道路搜尋；12 那格的 pip 要加上點數 2 的 pip。
- **造橋（`bridge` 計畫）**：
  - standard：能連到目標建點，或能改善 Wealthiest／Poor 排名時才造。
  - easy：手上資源在 base 計畫之外還有剩，且 targets 不空時才造。
- **gold 管理**：
  - standard：每次花 gold 前試算 Wealthiest／Poor 的變化。若會讓自己變成 Poor 或失去 Wealthiest，除非這筆花費能完成價值 ≥1 VP 的建造，否則不花。buyResource 只用來補齊建造。sellResources 用於避開 7 的棄牌，或脫離 Poor。
  - easy：只在補齊城市或聚落時買；只在需要減少手牌時賣。

### 5.5 Merchant Trains

- **位置估值** V(e)：
  - 這個位置讓自己的最長道路加長多少（權重 2）；
  - 加上會不會讓自己的建築落在兩節車廂之間（+1 VP）；
  - 再扣掉同樣的計算套在對手身上，依對手威脅加權。
- **bid**：
  - standard：V 為正，且出價後仍負擔得起當前計畫，就出 1 張；可能拿到 VP 時出 2 張。出價會退回銀行，等於成本。
  - easy：一律出價 0。
- **assign／place**：standard 選 V 最大者；easy 取 topK。
- 盤面模型的 `routeLength` 要加入車廂權重。

### 5.6 Barbarian Attack

- **setup（城市）**：避開「所在格都是海岸格」的路口。海岸格的風險依點數出現機率估算：每次入侵擲 3 次，約 pip/36 × 3（推測）。
- **buildBaCard（`baCard` 計畫）**：手上有 wool、grain、ore 各一，且這回合無法升城市時就建。這個劇本沒有發展卡，所以 BA 卡取代 devCard 計畫，每張估約 0.4 VP（推測）。原型 plus 模式就是這樣做的。
- **Capture**：選野蠻人最多、且威脅到自己建築的海岸格。
- **Knighthood**：任選一條空的 castle 邊；三種方向被擲中的機率相同，不必挑。
- **Swift Knight**：直接放到「自己能贏下驅逐」的海岸格邊上。
- **Treason**：把野蠻人從自己附近移到領先者附近，避免自己附近的格子累積到 3 隻。
- **Steal**：選領先者中手上有牌的人。
- **Knights phase**：
  - castle 邊上的騎士必須移出。
  - 其他騎士往「騎士數 > 野蠻人數，能拿到俘虜」的海岸格移動；只有加速能促成勝利時才花 grain。
  - 最後 endKnights。
- **easy**：castle 上的騎士移到 `targets[0]`；其餘 frame 取 topK；buildBaCard 與 standard 相同。

### 5.7 Traders & Barbarians

- **setup**：城市的估值加上「到各 plaza 的 MP 距離」，因為城市決定馬車起點。
- **preroll／action**：
  - barbarianKnight：把擋路的野蠻人移到對手的路上偷牌，同時累積 Largest Army。
  - Swift Journey：兩次移動內能完成交貨時使用。
  - `wagonUpgrade` 計畫：前期優先升到等級 3，升滿有 +1 VP。
  - 修正 G5：拿掉最長道路計畫，道路只保留「降低 MP 成本」的價值。
  - gold：保留預估過路費所需的量，其餘用來補資源。
- **MOVE**：
  - 以 Dijkstra 規劃路線，邊成本依 `stepCost` 規則複製（推測可在 bots 內重寫，不依賴 rules 的內部函式）。
  - 目標：有貨時，去需要這批貨的 plaza；沒貨時，去最近、還有貨的 plaza。
  - 能走就走；加速若能讓本回合抵達就使用；野蠻人擋在最短路徑上且等級 ≥2 時嘗試 driveOff；沒有能縮短距離的步就停。
  - tie-break 要固定，以符合 I6。
- **BARBARIAN（7）**：
  - standard：把野蠻人移到領先者手上有牌的道路上。
  - easy：`barbarians[0]` 移到 `targets[0]`。

### 5.8 與 C&K 騎士可共用之處（推測；C&K Bot 尚未實作，`B/support.ts:13` 仍是空清單）

- BA 的騎士走邊、有射程；C&K 的騎士站路口、有啟用與強度，機制不同，只能共用圖論工具。建議抽出 `B/graph.ts`，提供 BFS／Dijkstra，供 Traders 馬車、BA 騎士與日後 C&K 騎士使用。
- 「野蠻人威脅 vs 防守數」的評估模式也可以共用。
- Traders 的 barbarianKnight 與 base 的騎士卡接近（移動一個盜賊類棋子，並計入 Largest Army），可以共用泛化後的 `knightDecision`。

---

## 6. 保底策略（每個 frame 的必定合法最小動作）

只有 `responders` 中輪到自己的那一位才動作，其他人回 null。原型 `proto-fallback.ts` 實作了這張表：只用保底時 80 局、plus 模式 320 局，**都是 0 次被拒**。

| frame 或強制動作 | 誰回答 | 最小動作 | 為何必定合法 |
|---|---|---|---|
| `fishSwap` | `responders[0]` | `tb.fishSwap {token: null}` | 傳 null 時不檢查其他條件（`TB/fishing/index.ts:320–324`） |
| `wagonBid` | `responders[0]` | `tb.bidWagon {wool: 0, grain: 0}` | 0 是合法的非負整數，一定持有（`TB/trains/index.ts:196–201`） |
| `wagonAssign` | 任一 responder | `tb.assignWagon {edge: locations[0]}` | 只有在有可放位置時才會開始投票（`:272`），投票期間位置不變 |
| `wagonPlace` | responder | `tb.placeWagon {edge: locations[0]}` | 同上 |
| `baSteal` | responder | `tb.baSteal {victim: stealVictims[0]}` | 只有在有可偷對象時才開（`TB/barbarians/index.ts:484–488`） |
| `baCapture` | responder | `tb.baCapture {hex: board.targets[0]}` | 沒有海岸野蠻人時，抽到的 capture 會被換掉（`:180–187`） |
| `baKnighthood` | responder | `tb.baPlaceKnight {edge: board.targets[0]}` | 只有在有空的 castle 邊時才開（`:197–201`） |
| `baSwiftKnight` | responder | 同上 | 盤面任何空邊都可放，空邊數遠多於騎士數 |
| `baTreason` | responder | `treasonMoves[0]` | 只有在有合法移動時才開，用盡會自動結束（`:207–209`、`:285–286`） |
| `baKnights` | responder | 若自己有騎士在 castle 邊上且它還有目標 → `tb.moveKnight` 到 `targets[0]`（不加速）；否則 `tb.endKnights` | 對應 must-move 的判斷條件（`:355–370`） |
| `tbBarbarian` | responder | `tb.moveBarbarian {from: barbarians[0], to: targets['tb.barbarian:'+from][0]}` | 空邊數遠多於野蠻人數 |
| `tbWagon` | responder | `tb.wagonStop` | 永遠合法（`TB/traders/index.ts:297–301`） |
| FR 的 `moveRobber` | actor | `robberHexes[0]`；沒有 `robberHexes` 時沿用 base 規則 | 一定有合法格，最差是 desert（`friendlyRobber.ts:34–40`） |
| FR 的 `dev.playKnight` | — | 保底不出騎士卡 | — |
| action phase | actor | `turn.end`（base 已處理） | 模組沒有 `beforeEndTurn` 這類否決 |

---

## 7. 測試與驗收

### 實測 A：rules 腳本玩家跑一局的步數與耗時

`scripted-sim.ts` 使用各 `tb-*.test.ts` 的種子再加 2 個種子，與 `simulateGame` 結果核對一致。腳本玩家以試錯推進，步數指的是成功套用的指令數。

| profile | 步數 | 回合 | 耗時（受負載影響） |
|---|---|---|---|
| base | 425–754 | 120–196 | 1.4–4.5 s |
| FR | 374–742 | 105–202 | 0.5–2.8 s |
| Harbors | 462–688 | 126–192 | 1.6–3.6 s（另有一筆 49 s 的負載離群值） |
| FR+H | 414–915 | 109–261 | — |
| Fishing | 417–792 | 93–166 | 0.5–1.5 s |
| Rivers | 269–570 | 73–165 | 0.6–9.7 s |
| Trains | 513–875 | 125–229 | 1.5–20.8 s |
| BA | 498–1027 | 109–180 | 0.7–1.5 s |
| Traders | 668–1091 | 110–177 | 0.8–12.3 s |

### 實測 B：原型 Bot（`proto-fallback.ts`）

**只用保底**（5 種子／人數）：

| profile | 終局 | 平均步數（3p / 4p） |
|---|---|---|
| FR | 100% | 286 / 355 |
| H | 100% | 294 / 375 |
| FR+H | 100% | 302 / 396 |
| Fishing | 100% | 291 / 321 |
| Rivers | 100% | 220 / 297 |
| Trains | 100% | 337 / 418 |
| BA | **0/10** | — |
| Traders | **3p 4/5，4p 1/5** | — |

FR 到 Trains 每局約 130–300 ms。

**plus 模式**（20 種子／人數，共 320 局）：

| profile | 3p 步數／回合／ms | 4p 步數／回合／ms |
|---|---|---|
| FR | 248 / 63 / 163 | 336 / 72 / 228 |
| H | 274 / 67 / 159 | 346 / 77 / 197 |
| FR+H | 261 / 66 / 148 | 349 / 76 / 233 |
| Fishing | 280 / 68 / 155 | 332 / 75 / 187 |
| Rivers | 233 / 57 / 132 | 311 / 72 / 191 |
| Trains | 339 / 72 / 185 | 395 / 74 / 234 |
| BA | 406 / 77 / 241 | 553 / 105 / 361 |
| Traders | 340 / 50 / 199 | 398 / 54 / 378 |

- 全部 320 局終局，0 次被拒，0 次停住。
- `decide` 平均 0.01–0.025 ms，最大 16.5 ms（Traders 4p）。
- 把步數上限壓到 1000 時，只有 BA 4p 種子 15 被截斷（第 200 回合）。
- 每個 Bot 每回合最多 10–15 道指令（`proto-window.ts`）；`windowId` 以回合為單位（`R/engine.ts:563`），離 40 的上限還很遠。

### 實測 C：既有 bots 套件

8 個檔案、48 個測試，牆鐘 20.1 s。其中 B-GAME 每種人數 10 種子約 3.7–5.3 s，fuzz 3.2 s（4p）／5.9 s（6p），B-FAIR 約 0.5 s。

### 驗收設計

- **B-POLICY**：
  - 每個開放的 T&B profile × 3/4 人 × 3–5 種子，standard、easy、保底混合。
  - 每個決策都必須被接受、決定性一致、不拋錯。
  - `RESPONSE_COMMANDS` 加入 4 個模組回應指令；檢查「standard 不把強盜放在只有自己建築的格子」也要套用到 FR 的合法格。
- **B-GAME**：
  - 8 個 profile × 2 種人數 × 10 種子 = 160 局，`maxSteps` 沿用 5000。
  - 斷言：有勝者，沒有卡住的 pending，資源守恆。
  - 另加模組守恆（推測，需先確認模組確實維持這些不變式）：Σgold + supply = 100；魚 token 總數守恆；BA 的 36 隻野蠻人守恆；22 節車廂守恆。
  - 再加回合數軟上限（例如 400），用來抓出像 BA 只靠保底那樣打不完的情況。
- **B-FAIR**：依 2.9 擴充擾動項目。
- **單元測試**：比照 `BT/decisions.test.ts`，用 `packages/rules/test/tb-helpers.ts` 逐一建構每個 frame，驗證保底與兩個等級都會送出合法指令。
- **CI 時間估計**（推測）：
  - B-GAME 160 局 × 0.2–0.4 s ≈ 35–60 s CPU。
  - B-POLICY 約 80 局，每步多做檢查 ≈ 30–50 s CPU。
  - 依 profile 拆成多個檔案讓 vitest 平行跑，牆鐘約增加 20–40 s。
- **bench 要量的項目**：
  - 每種 frame 的 `decide` 平均與最大耗時。
  - 每回合指令數（上限 40）。
  - 每局步數與回合數。
  - standard 對 easy 的勝率，例如 1 個 standard 對 2 個 easy 應 >50%。
  - 保底被迫使用的比例（應為 0）。
  - 依 `THINK_MS` 換算的真人觀看時長：步數 × 約 0.9 s，例如 Traders 400 步約 6 分鐘。

---

## 8. 切片與工作量

bots 目前的原始碼共約 1,555 行（wc）。原型只用了 306 行，其中保底約 60 行、劇本啟發式約 80 行，就達成全部終局。正式版還要加上型別、兩個難度等級、估值與測試，因此估計需要約 3,000–3,400 行（含測試）。

| 批次 | 內容 | 檔案範圍 | 規模 | 依賴 | 開放的 profile |
|---|---|---|---|---|---|
| 0 平台前置 | P1、P2、P4、P5 | `B/types.ts`、`B/support.ts`、`S/bot-driver.ts`、`BT/harness.ts`、`BT/policy.test.ts`、`docs/SPEC.md:188`、server 測試 | S–M，約 150–250 行 | 無（可能與 Architect 的平台工作重疊） | 無 |
| 1 保底與修正 | `tb/view.ts`、`tb/duty.ts`、robberHexes、個人勝利目標、goods 防護、coins 共用模組、harbors 輕量估值 | `B/tb/*`、`B/fallback.ts`、`B/heuristic.ts`、`B/trade.ts`，以及測試 | M，約 500–600 行 | 0 | FR、H、FR+H |
| 2 簡單劇本 | 2a Fishing；2b Rivers；2c Trains；外加 `board.ts` 修正（extraNumbers、橋、車廂權重）與 economy 掛點 | `B/tb/fishing.ts`、`rivers.ts`、`trains.ts`、`B/board.ts`、`B/economy.ts`，以及測試 | M–L，約 900–1,100 行 | 1 | Fishing、Rivers、Trains |
| 3 BA | 卡牌、騎士、Treason、征服風險、`baCard` 計畫、`graph.ts` | `B/tb/barbarianAttack.ts`、`B/graph.ts`，以及測試 | M，約 650–750 行 | 1（coins） | BA |
| 4 Traders | Dijkstra、貨物目標、加速與驅趕、升級、Knight 卡與 Swift、野蠻人放置、最長道路停用修正 | `B/tb/traders.ts`、`B/economy.ts`，以及測試 | L，約 700–800 行 | 1、3 的 `graph.ts` | Traders |

**每批的 MVP**：保底，加上能通過 B-GAME 的最低限度啟發式，並修掉明顯錯誤（G2、G4、G5、G7）。

**可以延後的強化**：
- Strongest Ports 的積極爭奪；
- fish 交換的期望值計算；
- Rivers 的財富排名最佳化；
- 車廂出價的賽局推理；
- Treason 的目標選擇；
- Traders 的多回合過路費與野蠻人預測；
- Bot 主動提出含 gold 的報價。

批次 2、3、4 在批次 1 完成後可以平行進行。

---

## 9. 風險與待決問題

**需要使用者決定**

1. **是否接受逐 profile 分批開放？**（建議接受）
   - 需要把 `docs/SPEC.md:188` 的「every rules module the built-in strategies support」改為以 profile 為單位的支援清單。
   - R-BOT 的驗收條件（`docs/SPEC.md:192`）已經是「every enabled profile that offers bot seats」，與分批開放相容。
   - lobby 中說明「為何不能加 Bot」的雙語文案也要相應調整。
   - 若不接受分批，就得一次完成批次 0–4，約 3k 行。
2. **Bot 是否參與含 gold 的國內交易？** 建議 P1 階段一律拒絕、不主動提出。
3. **easy 的強度下限**：BA 與 Traders 的 easy 仍需要基本的劇本行為，否則打不完；是否接受這樣的 easy？
4. **思考延遲**：`tb.wagonStep` 是否採用較短的延遲？（推測：不調整時，Traders 每回合會多出 3–6 秒）
5. **型別放在哪裡**：bots 自訂本地型別（建議），或由 rules 新增型別匯出。後者不改變規則、狀態、事件與錯誤碼，依文字不違反 I3，但會動到 `packages/rules`，請確認。

**技術風險**

- Dijkstra 與各種 tie-break 必須決定性（I6）。
- B-FAIR 要擾動模組狀態，建構測試狀態的成本偏高。
- Traders 的完整策略可能讓每回合指令數往 40 靠近（推測，需要在 bench 中監控）。
- event-cards 的 4 個 profile 日後開放時，需要另外處理新的 hook。
- 本報告中的耗時受機器負載影響，CI 時間估計需要在乾淨的 runner 上重新量測。
