# Explorers & Pirates 電腦對手：第 1 輪研究報告

> 收錄說明：2026-11-04 第一輪唯讀研究報告，內容原樣保留，基準 `a200840`（v0.4.0）。定稿計畫是 `docs/aegis/plans/2026-11-04-bots-explorers-pirates.md`，研究之後的修正一律以計畫為準。文中的 `/tmp/katan-bot-research/<slug>/report.md` 對應 `docs/aegis/work/2026-11-04-bots-<slug>-research.md`；探查腳本與輸出沒有提交。

角色：Planner（唯讀研究）。基準：worktree `graceful-swan`，分支 `docs/expansion-ai-opponent-plans`，HEAD = `a200840`（v0.4.0）。我沒有修改 repo，也沒有做任何 git 寫入（`git status` 乾淨）。探查腳本都放在 `/tmp/katan-bot-research/explorers-pirates/`：`measure.ts`、`probe.ts`、`basebot*.ts`、`strand.ts`、`stall.ts`、`city.ts`、`hist.ts`、`vp.ts`、`topo.ts`。執行時要用 `node --experimental-transform-types`，因為 `packages/rules/test/helpers.ts:49` 用了 parameter property，strip-only 模式跑不動。

> **最需要先知道的結論**
> 1. 現行 Bot 直接放進 E&P 會卡死：
>    - 變動式開局在第 0 步就停住。
>    - 只要擲出 7，`explorersPirates.pirate` frame 就停住。
>    - 兩種情況下 standard 與 fallback 都回傳 null，BotDriver 也不重試，因此違反 I9。
>    - Land Ho! 雖然不會卡死，但 3000 步、約 900 回合後仍沒有勝者。
> 2. 合法性方面，**rules 端不必修改**：
>    - 每個指令的合法目標都能從 `GameView`、hints、公開拓樸與既有常數推出來。
>    - 只有幾個常數需要補匯出，屬於純匯出，不違反 I3。
>    - 多步航線的規劃可以在 bots 端用 BFS 自算，實際每一步再只取 `hints.ships[].steps`，因此保證合法。
> 3. 我在規則層找到一個**真實的死結**：船「擱淺在滿格邊、無路可走、又沒有羊毛」時，`turn.end` 會被 `E_EP_EDGE_FULL` 拒絕，真人一樣會卡住。我已實際構造出這個狀態。Bot 端可以靠規劃避開，規則端的修正另案處理。
> 4. 平台端的硬需求：
>    - `BotPolicy` 必須能回傳 `ModuleCommand`。
>    - gating 要細到 profile 這一層，否則 5 個 E&P profile 只能一起開放。
>    - BotDriver 每個行動視窗 40 指令的上限、`ep.*` 的節奏值要調整。
>    - 保底策略要能處理擱淺。

---

## 1. 範圍

| profile id | 人數 | 啟用 | 勝利分數 | 開局放置 | layout setupMode | 拓樸（hex/vertex/edge） | 啟用的機制 |
|---|---|---|---|---|---|---|---|
| `ep-land-ho-2025` | 3、4 | `enabled: true` | 8 | **固定**（`fixedStart: true`，boards.ts:202） | `fixed` | `ep-land-ho` 50/126/175 | 霧區探索、harbour settlement、船、settler、金幣、3:1 供應交易。沒有海盜、crew 與任務軌道（boards.ts:207-208） |
| `ep-pirate-lairs-2025` | 3、4 | 同上 | 12 | **變動式三輪放置**（`fixedStart: false`，boards.ts:219） | `fixed`（盤面印刷固定） | `ep-pirate-lairs` 57/142/198 | 上列全部，加上海盜船（7／追逐）、過路費、追逐、crew、海盜巢穴任務、gold field |
| `ep-fish-2025` | 3、4 | 同上 | 15 | 變動式 | `variable` | `ep-pirate-lairs`（加 Council） | 上列全部，加上魚群淺灘、`ep.fishRoll`、Council 交付、魚軌道 |
| `ep-spices-2025` | 3、4 | 同上 | 15 | 變動式 | `variable` | `ep-spices` 64/158/221 | 海盜、crew、魚、香料農場（crew 永駐、sack、三種能力），沒有巢穴任務（boards.ts:250） |
| `ep-full-2025` | 3、4 | 同上 | 17 | 變動式 | `variable` | `ep-full` 71/174/244 | 三個任務全開 |

出處：
- `packages/rules/src/profiles.ts:246-287`
- `pieces: { settlements: 9, cities: 0, … }`、`devDeck: []`（profiles.ts:268-269）
- 任務與機制：`explorers-pirates-boards.ts:193-265`
- 拓樸大小由 `topo.ts` 實測

注意：任務說明表把 Pirate Lairs 標為「fixed setup」。那只是 layout 的 `setupMode`（盤面印刷固定）。棋子放置仍走變動式三輪，見 `setup.ts:96-106` 與 `ep-helpers.ts:23`。Bot 必須依 `view.modules.explorersPirates.setupStep` 判斷，不能看 setupMode。

**分數上限**（推導自 `core.ts:10,24-30`）：
- 建築最多 13 VP：5 座 plain settlement 各 1 VP，加 4 座 harbour 各 2 VP。
- 每條任務軌道最多 3 VP，加上 bonus 1 VP。
- 因此 Fish、Spices、Full 一定要靠任務才能贏：15 與 17 都超過 13，而且陸地點有限。
- Pirate Lairs 的 12 理論上只靠建築也夠，但實際上要靠巢穴。

這對策略設計是硬約束。

---

## 2. Bot 介面盤點

### 2a. 模組指令（27 個，已與 `index.ts:158-186` 的 commands map、`messages.ts` 及 `docs/API.md:272-292` 交叉核對）

Phase 的記法：base `turn.phase` 是 `setup`、`preroll` 或 `action`。E&P 的子階段放在 `view.modules.explorersPirates.turn.phase`，值為 `action` 或 `movement`；只有輪到自己行動時，`hints.modules.explorersPirates.phase` 才有值。下表 `H.` 代表 `hints.modules.explorersPirates`，`V.` 代表 `view.modules.explorersPirates`。

| # | type | 欄位 | 合法時機 | 合法目標來源 | 缺口與注意事項 |
|---|---|---|---|---|---|
| 1 | `ep.setupHarbor` | `vertex` | setup，`setupStep==='harbor'`，自己是 setup 游標 | `H.setup.harbor`（setup.ts:182-184、235-245） | — |
| 2 | `ep.setupSettlement` | `vertex` | setup，`'settlement'`（反向順序） | `H.setup.settlement`（setup.ts:186-196、247-257） | 會發起始資源 |
| 3 | `ep.setupRoad` | `edge` | setup，`'route'`，與 ship 不分先後 | `H.setup.road`（setup.ts:207-217、259-269） | 兩項都放完才換下一位（setup.ts:285-295） |
| 4 | `ep.setupShip` | `edge` | 同上 | `H.setup.ship`（setup.ts:219-233、271-283） | 船自帶 settler |
| 5 | `ep.buildHarbor` | `vertex` | Action 子階段，無 pending | `H.harbors`（economy.ts:130-157） | hints 不檢查成本 2 穀 2 礦（core.ts:33）；供應看 `V.players[me].supply.harbors` |
| 6 | `ep.buildShip` | `edge`、`replace?` | Action | `H.shipEdges`、`H.shipReplace`（economy.ts:160-214） | 3 艘都在場上時必須帶 `replace`。被替換船原本的邊不會出現在 `shipEdges`（規則會重算，economy.ts:196-200），屬小缺口 |
| 7 | `ep.buildSettler` | `harbor`（vertex）或 `ship`（id）、`remove?` | Action | `H.pieceHarbors`、`H.pieceShips`、`H.settlersLeft`（economy.ts:225-280） | **hints 不檢查容量**，Bot 要用 cargo 自算。settler 需要空艙（state.ts:18-20）。有別處空位時帶 `remove` 會得到 `E_EP_ROOM_ELSEWHERE`。`CARGO_SIZE`、`HOLD_CAPACITY` 沒有匯出（缺口） |
| 8 | `ep.buildCrew` | 同上 | Action，`pirates` 任務 | 同上，加 `H.crewsLeft` | 同上；crew 佔 1 格 |
| 9 | `ep.sellForGold` | `give` | Action | 無 hint；需 3 張 `give`，且 `V.goldSupply > 0`（economy.ts:66-80） | 可推導 |
| 10 | `ep.buyResource` | `receive` | Action，每回合 2 次 | `H.goldBuysLeft`；`V.players[me].gold ≥ 2`、`view.bank[r] > 0`（economy.ts:83-99） | 可推導 |
| 11 | `ep.fastGold` | `give` | Action，持有 Fast Gold 能力 | `H.fastGoldLeft`（economy.ts:107-126） | 可推導 |
| 12 | `ep.extraMove` | `ship` | Movement | 無直接 hint：條件是 `H.ships[i].extra===false && done===false`，且羊毛 ≥ 1（economy.ts:283-298） | 可推導 |
| 13 | `ep.startMovement` | — | Action | `H.canStartMovement`（economy.ts:301-307） | — |
| 14 | `ep.moveShip` | `ship`、`edge` | Movement | `H.ships[i].steps[] = {edge,tribute,full,explores}`（movement.ts:77-101） | **只有下一步，沒有多步可達集合**。改移另一艘船會結束目前的 active 船（movement.ts:111-116）；active 船擱淺時，移其他船會被拒（`E_EP_EDGE_FULL`） |
| 15 | `ep.load` | `ship`、`harbor`、`piece` | Movement | `H.ships[i].harbors`，加上 `V.harbors[].cargo` 與容量自算（movement.ts:176-196） | 不必檢查 done，也不耗 MP |
| 16 | `ep.unload` | 同上 | Movement | 同上 | 同上 |
| 17 | `ep.swap` | `ship`、`harbor` | Movement | 同上（movement.ts:199-212） | 兩邊至少一邊非空 |
| 18 | `ep.found` | `ship`、`vertex` | Movement | `H.ships[i].found`（movement.ts:217-251） | 不必檢查 done；船與 settler 回到供應 |
| 19 | `ep.dropCrew` | `ship`、`hex` | Movement、pirates | `H.ships[i].dropCrew`（index.ts:303-306；movement.ts:261-284） | 第 3 名 crew 會排入 `captures`，在 `turn.end` 結算 |
| 20 | `ep.pickCrew` | `ship`、`hex` | Movement、pirates | `H.ships[i].pickCrew`（movement.ts:287-300） | — |
| 21 | `ep.loadSpice` | `ship`、`hex` | Movement、spices | `H.ships[i].loadSpice`（movement.ts:303-317） | — |
| 22 | `ep.loadFish` | `ship`、`hex` | Movement、fish | `H.ships[i].loadFish`（movement.ts:320-334） | 魚佔 2 格（整個艙） |
| 23 | `ep.deliver` | `ship` | Movement | `H.ships[i].deliver`（movement.ts:336-363） | 位置在 `V.anchors` |
| 24 | `ep.fishRoll` | — | Movement、fish，每回合 1 次 | `H.fishRoll`（movement.ts:369-390） | 擲完會結束 active 船；擱淺時被拒 |
| 25 | `ep.chase` | `ship` | Movement、pirates | `H.ships[i].chase`（pirate.ts:165-194） | 只有尚未移動的船能用；免費，追逐後仍可移動 |
| 26 | `ep.placePirate` | `hex` | pending `explorersPirates.pirate`，stage `place`，`responders[0]` | `H.pirateTargets`（pirate.ts:42-52、75-107） | 0 或 1 名受害者時當場結算 |
| 27 | `ep.robPlayer` | `victim` | 同一 frame，stage `rob` | `H.robCandidates`，或 `view.pending.data.candidates`（pirate.ts:119-127） | — |

**E&P 中的 base 指令**

| 指令 | 狀態 | 出處 |
|---|---|---|
| `turn.roll` | 可用 | — |
| `turn.end` | 可用。**Action 子階段也接受，等於跳過 Movement**（實測 77/77 次被接受）。擱淺時被拒 | — |
| `build.road`、`build.settlement` | 可用。`legalRoads`、`legalSettlements` 已套用 fog、closed site 與 5 座 plain 上限；settlement 仍須接上自己的道路 | engine.ts:401-421；index.ts:114-127 |
| `trade.bank` | 可用，3:1（`bankRates` 全為 3） | index.ts:135-137 |
| `trade.offer`、`revise`、`respond`、`withdraw`、`settle` | 可用。報價可含金幣（`giveGoods`、`wantGoods`） | index.ts:140-149；types.ts:278-298 |
| `pending.discard` | 可用 | — |
| `setup.placeBuilding`、`setup.placeRoad` | 被 veto，`E_INVALID_COMMAND` | index.ts:79、95 |
| `build.city` | `E_NO_PIECES`。但 `hints.legalCities` **非空**，實測 `[7,98]`，會誤導 | — |
| `build.devCard` | `E_DECK_EMPTY` | — |
| Movement 子階段的 `build.*`、`trade.bank`、`offer`、`revise`、`settle` | `E_EP_MOVEMENT_PHASE`。`trade.respond` 與 `withdraw` 仍可用 | index.ts:81-84、94-99 |

### 2b. Pending frames

| frame | responder | 回答指令 | 投影資料 | 備註 |
|---|---|---|---|---|
| `explorersPirates.pirate` | `responders[0]`：擲 7 的行動者，或追逐成功的行動者 | `ep.placePirate`，接著 `ep.robPlayer` | `{kind, module, responders, data:{stage:'place'\|'rob', cause:'seven'\|'chase', candidates}}`（index.ts:199-213）。目標只給 responder：`H.pirateTargets`、`H.robCandidates`（index.ts:363-364） | 7 的來源在 pirate.ts:32-39；追逐來源在 pirate.ts:191 的 `enqueuePending`，發生在 Movement 中，結算後回到 Movement |
| base `discard` | 手牌 > 7 的非行動者與行動者 | `pending.discard` | 與 base 相同 | 上限 7，E&P 沒有 `discardLimit` |
| base `moveRobber`、`steal` | **永不出現** | — | — | `sevenRobberStep` 在 Pirate Lairs 起回傳海盜 frame，Land Ho! 回傳 `null`（只發 `ep.noPirate`）（engine.ts:1072-1099；pirate.ts:32-39）；沒有騎士卡 |
| base `yearOfPlenty`、`freeRoads` | 永不出現 | — | — | 沒有發展卡 |

7 的流程：先處理棄牌，然後 Land Ho! 直接結束；其餘任務由擲骰者放置海盜。實測 frame 投影為：
`{"stage":"place","cause":"seven","candidates":[]}`，responder 看到 14–19 個目標，其他人看到 0 個。

### 2c. 回合結構

1. **開局**
   - Land Ho!：`initGame` 直接放好固定棋子，進入第一位玩家的 `preroll`（setup.ts:96-101；實測 `land-ho after create preroll null`）。
   - 變動式：`setup.order` 是蛇行兩輪再加一輪順序（setup.ts:104）。依 index 判斷步驟：前 n 個是 harbour，接著 n 個是 settlement，最後是 route（setup.ts:156-161）。
   - **base 的 `view.turn.setup.stage` 永遠是 `'building'`**（engine.ts:958），base 的 `legalSettlements` 與 `legalRoads` 為空（`allowBuilding` 在 setup 一律 false，index.ts:114-117）。只能看 `V.setupStep` 與 `H.setup`。
2. **preroll**：只有 `turn.roll`。
3. **生產**：
   - 走 base 生產，加上 `modifyProduction`（economy.ts:31-57）。
   - 已攻下的 gold field，每座建築得 2 金。
   - 沒拿到任何東西的玩家得 1 金；擲出 7 時不發。
   - harbour 生產 1 張，與 settlement 相同。
4. **Action 子階段**：建造、交易、金幣。`ep.startMovement` 進入 Movement；也可以直接 `turn.end`。
5. **Movement 子階段**：
   - 船一次動一艘，每一步 1 MP。基本 4 MP；`extraMove` 加 2；Swift 能力加 1 或 2（movement.ts:40-49）。
   - 探索會結束該船的移動（movement.ts:141-147）。一步可以同時揭露多個霧格（interpretation 6）。
   - 過路費每船每回合付 1 金，**付給供應而不是海盜主人**（movement.ts:131-135；core.ts:93-96）。
   - 每條邊最多停 2 艘，可以穿越。進入滿格邊的條件是當下 MP ≥ 2，而且這一步不會探索（movement.ts:96）。
6. **`vetoCommand`**：見 2a。
7. **`beforeEndTurn`**：active 船停在 3 艘的邊上時拒絕 `turn.end`（`E_EP_EDGE_FULL`，index.ts:109-112）。同一個檢查會讓 `hints.canEndTurn = false`（engine.ts:2070、2097-2101）。
8. **`onEndTurn`**：`finishActiveShip`，接著 `resolveCaptures`（巢穴獎勵與 hero 擲骰），再 `checkVictory`，最後回傳 `'continue'`（index.ts:151-156；lairs.ts:22-70）。不會開出結束回合的 frame。
9. **回合紀錄**：`EpTurn` 以 `windowId` 為鍵，新視窗會自動清空（state.ts:59-82、121-136）。

### 2d. 型別形狀

`ExplorersPiratesView` 等於 `ReturnType<typeof projectState>`，定義在 `index.ts:217-285`：

```ts
{
  scenario, setupStep: 'harbor'|'settlement'|'route'|null, missions: EpMission[], pirates: boolean, victoryTarget,
  fog: { hex, region:'parrot'|'goose' }[], regionsLeft: { parrot: number, goose: number },   // 只有總數
  council: number|null, anchors: number[], harborMarks: number[], startIsland: number[],
  sites: EpSite[]  // council | lair{crews,captured} | shoal{number,fish} | spice{ability,bonus,crews,sacks}
  ships: { id, player, edge, cargo: Cargo[] }[], harbors: { vertex, player, cargo }[],
  goldSupply, fishSupply, lairTokensLeft, pirate: { hex, owner }|null,
  tracks: Partial<Record<EpMission, { positions, arrivals, leader, values }>>,
  turn: { phase:'action'|'movement', active: string|null,
          ships: Record<id,{used,extra,done,tribute,chased}>, goldBuys, fastGold, fishRolled },
  players: Record<id, { gold, harborPoints, missionPoints, supply:{harbors,settlements,ships,settlers,crews},
                        abilities:{swift,fastGold,pirateBonus}, chaseNumbers: number[] }>
}
```

`ExplorersPiratesHints` 定義在 `index.ts:289-368`：

```ts
{
  phase: 'action'|'movement'|null, setup: { step, harbor[], settlement[], road[], ship[] }|null,
  harbors[], shipEdges[], shipReplace, pieceHarbors[], pieceShips[], settlersLeft, crewsLeft,
  goldBuysLeft, fastGoldLeft, canStartMovement, fishRoll, stranded,
  ships: { id, movesLeft, steps:{edge,tribute,full,explores}[], done, extra, found[], harbors[],
           dropCrew[], pickCrew[], loadSpice[], loadFish[], deliver, chase }[],
  pirateTargets[], robCandidates[]
}
```

- 匯出狀況：`@catan/rules` 已匯出上述兩個型別、`EP_COSTS`、`EP_TRACK_VALUES`、`EP_PIECES`、`EP_SCENARIOS`、`epScenario`，以及 `EpCargo`、`EpSpiceAbility`、`EpSite`（`packages/rules/src/index.ts:11-14`）。`ModuleCommand` 與 `PublicModulePendingView` 經由 `modules/index.ts` 匯出。
- **未匯出**：`CARGO_SIZE`、`HOLD_CAPACITY`（state.ts:18-20）、`BASE_MP`、`EXTRA_MP`、`START_GOLD`（core.ts:13-15）、`LAIR_TOKENS`（core.ts:21）、`TRACK_BONUS`（core.ts:30）、`DISCOVERY_GOLD`（explore.ts:29），以及 `PIRATE_FRAME` 常數（pirate.ts:17）。
- 實測投影大小：完整 view 約 14–16 KB，其中 E&P view 3.0–4.3 KB、E&P hints 0.3 KB。

### 2e. 隱藏資訊與 B-FAIR

| 類別 | 內容 | 出處 |
|---|---|---|
| 真正隱藏 | 對手手牌的組成（`handSize` 公開） | — |
| 真正隱藏 | `ep.pirateStole` 的 `resource` 私有參數，只給行動者與受害者 | pirate.ts:146 |
| 真正隱藏 | 未來亂數：骰子、魚骰、追逐骰、hero 擲骰、偷牌抽選 | — |
| 不存在 | 未探索 tile、數字片、淺灘數字、香料能力、巢穴數字。都在揭露或攻下的當下以伺服器亂數從剩餘庫存抽出 | explore.ts:52-97；lairs.ts:65 |
| 在 GameState 但不投影 | `pools` 的組成：可由公開資訊推出 | — |
| 在 GameState 但不投影 | `pools.discs`、`abilities`、`lairTokens` 的陣列順序：沒有意義，因為抽取時隨機取 index | — |

`ep-privacy.test.ts:158-163` 明確斷言 view **沒有** `pools` 鍵。

對 B-FAIR 的影響：
- Bot 估探索期望值時，只能用「印刷庫存（`EP_SCENARIOS[sc].regions[R]`）減去盤面已揭露」推出的剩餘組成。區域歸屬用 `EP_SCENARIOS[sc].map.parrot/goose` 的 (q,r) 對照 `topology.hexes`。已揭露 tile 的身分由以下資訊讀出：`terrain`（`gold` 是巢穴；`desert` 是香料；`sea` 加 shoal site 是淺灘；其餘 `sea` 是海）、`board.numbers`、`sites`。
- 這些資料全部公開，**不需要改 rules**。
- B-FAIR 變體應包含：交換對手手牌（總數不變）、打亂 `pools.discs`、`abilities`、`lairTokens` 的順序、更換遊戲 rng。斷言 view JSON 相同，且決策相同。

### 2f. 交易的變化

- 供應交易 3:1：`bankRate` 取 `min(rate, 3)`（index.ts:135-137），沒有港口，`board.harbors` 為空。
- 3 張同種資源換 1 金：`ep.sellForGold`。
- 2 金換 1 張資源，每回合 2 次：`ep.buyResource`。
- Fast Gold 能力：1 張換 1 金。
- 國內交易可以含金幣：`tradeGoods` 的 `ids: ['gold']`（index.ts:140-149）；Offer 帶 `giveGoods`、`wantGoods`（types.ts:292-293）。
- 基本型別缺口：base `Command` 的 `trade.offer` 沒有 goods 欄位（engine.ts:98-103）。
- Movement 子階段不能 `offer`、`revise`、`settle`、`bank`；可以 `respond`、`withdraw`。行動者在 `ep.startMovement` 前必須自己結清或撤回報價。
- 沒有 paired 限制（只有 3–4 人）。

---

## 3. 現行 base Bot 的落差

實測方式：`basebot.ts`／`basebot2.ts` 把 `heuristicPolicy('standard')` 與 `fallbackPolicy` 直接放進 E&P。結果如下：
- `pirate-lairs` 在 **step 0** 停住（setup，`stage=building`）。
- 交給 fixture 完成開局後，第 6–7 步停在 `pending=explorersPirates.pirate`。
- `land-ho` 跑到 3000 步上限仍沒有勝者，期間沒有任何 `ep.*` 指令：912 次 `turn.roll`、824 次 `trade.bank`、12 次 `build.settlement`。

| # | 落差 | 出處 | 後果 |
|---|---|---|---|
| G1 | 變動式開局：`setupDecision` 依 `view.turn.setup.stage` 從 `hints.legalSettlements`／`legalRoads` 挑選；兩者在 E&P 為空。保底策略也一樣 | heuristic.ts:307-320；fallback.ts:64-74；engine.ts:958 | 回傳 null，**整局卡死**，違反 I9；就算送出 base setup 指令也會被 veto（index.ts:95） |
| G2 | 模組 frame 一律回傳 null | heuristic.ts:162-164；fallback.ts:41-43 | 海盜 frame 卡死，違反 I9 |
| G3 | BotDriver 在策略與保底都回傳 null 時直接 `return null`，不排重試 | bot-driver.ts:325-343 | G1 與 G2 變成**靜默永久停擺** |
| G4 | 完全沒有 `ep.*` 指令：不造船、不載 settler、不升級 harbour | heuristic.ts:411-456 | Land Ho! 無法結束，違反 R-BOT 的「bot-only 對局要結束且有勝者」 |
| G5 | `longestRoad` 計畫照常產生，但 E&P 沒有 Longest Road | economy.ts:260-280；index.ts:130-132 | 浪費磚與木 |
| G6 | `piecesLeft.settlements` 以 profile 的 9 座、所有建築計數；E&P plain 上限是 5 | board.ts:145-152；profiles.ts:268；core.ts:10 | 高估剩餘聚落、計畫失真（hints 仍會擋下非法） |
| G7 | `searchRoads` 不知道陸地邊、霧區、closed site | board.ts:171-206 | 規劃出蓋不了的道路；靠 `legalRoads.includes` 擋住（heuristic.ts:588），但計畫會卡住不前進 |
| G8 | `hints.legalCities` 在 E&P 非空，實測 `[7,98]` | engine.ts:2081-2088 | 目前靠 `left.cities = 0` 擋下，屬潛在陷阱 |
| G9 | 金幣完全不用：`buyResource`、`sellForGold`、`fastGold`、過路費、交易 | trade.ts 全檔 | fixture 局中金幣會囤到 133 枚以上 |
| G10 | 回應報價忽略 `giveGoods`、`wantGoods` | trade.ts:38-44 | 可能同意「付 3 金換 1 木」這類明顯虧損的報價，或高估對方報價 |
| G11 | 棄牌依 base 計畫保留城市、發展卡成本 | heuristic.ts:169-192 | 合法但打錯；應保留 settler、ship、harbour 成本 |
| G12 | 行動者有 open 報價時，base 流程在 Movement 子階段可能送 `trade.settle` | heuristic.ts:416-419；index.ts:81-84 | 被拒，改走保底 |
| G13 | 保底策略在 `action` 一律送 `turn.end`，不知道擱淺 | fallback.ts:77-78 | 擱淺時被拒；加上 G14 就會無限退避重試 |
| G14 | 每個視窗、每個 Bot 40 指令的上限，超過就強制走保底 | bot-driver.ts:70、303-312 | fixture 實測每視窗最多 30 個指令（平均 14），強一點的 Bot 會逼近上限。若此時船正擱淺，保底被拒，接著 30 秒退避重試的迴圈不會停（bot-driver.ts:416-423） |
| G15 | 節奏表沒有 `ep.*`，預設 900 ms | bot-driver.ts:40-63 | 每視窗平均 14 個指令，其中 47% 是 `ep.moveShip`，Bot 一回合約 12.6 秒 |
| G16 | 型別：`decide()` 回傳 `Command`；driver 為 `let command: Command \| null`；harness 的 `Decision.command: Command` | bots types.ts:39；bot-driver.ts:313；harness.ts:57-60 | `ModuleCommand` 只能硬轉型 |
| G17 | gating 粒度是規則模組 | support.ts:12-17；rooms.ts:291、417、725 | 只要加入 `explorersPirates`，5 個 profile 會同時開放 |
| G18 | harness 寫死 base profile 與 setupMode | harness.ts:29-50 | E&P 測不了 |
| G19 | 文案寫「電腦對手只會玩基本遊戲」 | web i18n `lobby.bots.unsupported`（zh-Hant.ts:275、en.ts:278）；SPEC:274「Bots refuse E&P rooms」 | 部分開放後要修 |

不構成問題的部分：
- 強盜、騎士、壟斷：robber 為 -1，`devDeckSize` 為 0，自然不會觸發。
- `respondToOffers` 在 base `phase==='action'` 下運作，Movement 中回應報價也合法。
- 海盜 frame 的 responder 一定是行動者，不會違反 policy.test.ts:18-25 的「非行動者只做回應」合約。

---

## 4. 平台與規則端支援需求

### 4.1 平台需求（交給 Architect）

| # | 需求 | 理由與影響 |
|---|---|---|
| P1 | 定義 `BotCommand = Command \| ModuleCommand`，讓 `BotPolicy.decide`、BotDriver、harness、`fallbackPolicy` 都用它 | G16。影響 bots/types.ts、bot-driver.ts、harness.ts |
| P2 | 模組策略插槽：base 策略依序分派 | E&P 的回合結構完全不同，base `actionDecision` 不能沿用 |
| | ① `view.pending.module` 對應的模組 frame | |
| | ② 模組接管的 setup（E&P：`V.setupStep` 非 null） | |
| | ③ 行動者的行動視窗：E&P 擁有整個 Action／Movement | |
| | ④ 模組保底策略 | |
| | 共用部分（回應報價、棄牌、偷牌受害者選擇）仍由 base 提供，但計畫成本要能由模組提供 | |
| P3 | gating 細到 profile，或「模組加上 scenario 白名單」 | 想先開放 Land Ho!（不需要海盜與任務）就必須如此。否則 E&P 只能 5 個 profile 一次上線 |
| P4 | BotDriver：補 `ep.*` 的 THINK_MS；E&P 的視窗指令上限提高，或改為「每個子階段各自計數」 | G14、G15。建議值見下方表格 |
| P5 | 保底策略分派到模組保底 | G13。必須處理 setup、海盜 frame、擱淺 |
| P6 | harness 支援指定 profile 與 setupMode，記錄每視窗指令數 | 依 `ep-helpers.ts:23`：land-ho 與 pirate-lairs 用 `fixed`，其餘用 `variable` |
| P7 | rules 純匯出：`CARGO_SIZE`、`HOLD_CAPACITY`、`BASE_MP`、`EXTRA_MP`、`DISCOVERY_GOLD`、`LAIR_TOKENS`、`TRACK_BONUS`、`START_GOLD`、`PIRATE_FRAME`、`EpSetupStep` 型別 | 不改行為，不違反 I3；避免 bots 自己複製常數。`LAIR_TOKENS` 是暫定值，匯出後日後修正時 Bot 能自動跟上 |

P4 的節奏建議值（推測，要以 bench 與觀感驗證）：

| 指令 | 建議延遲 |
|---|---|
| `ep.moveShip` | 400 ms |
| `ep.load`、`ep.unload`、`ep.swap` | 500 ms |
| `ep.startMovement` | 600 ms |
| `ep.found`、`ep.build*` | 900 ms |
| `ep.fishRoll`、`ep.chase` | 900 ms，並比照擲骰演出等待 |
| `ep.placePirate` | 1200 ms |
| `ep.robPlayer` | 800 ms |

P4 的指令上限：建議 E&P 設為 80，或讓 `ep.moveShip` 不計入上限，因為移動步數本來就有 MP 上限。

**需要與 Seafarers Planner 共用的海路能力**
1. 拓樸的「邊鄰接表」與「由 vertex 或 hex 轉成目標邊集合」的工具。
2. 一個通用的邊 BFS，以 callback 描述可通行性、停留限制、終止邊與成本，並能還原路徑。E&P 會在上面疊一層：
   - 每條邊可停 ≤ 1 艘其他船、可以穿越。
   - 探索邊是終止邊。
   - 過路費以金幣計。
   - 有 MP 預算。
3. 海邊判定 `isSeaRoute(view, edge)`：邊有已探索的水格，或者是外框邊且其唯一 hex 不在霧中（geometry.ts:23-29）。Seafarers 版本沒有霧，但外框邊的處理相同。
4. 沿海路口判定（geometry.ts:110-115）。

Seafarers 的「開放端船隻移動」與 trade route 語意不同，只共用以上原語。

### 4.2 規則端（是否需要改、對 I3 的評估）

| 項目 | 必要性 | I3 評估 |
|---|---|---|
| 合法性所需資訊 | **不需要改**：全部可由 view、hints、拓樸、匯出常數推出；每一步取 `H.ships[].steps` 保證合法 | — |
| 選配：`H.ships[].reach`（多步可達邊與 MP、過路費） | 可減少 bots 重寫的 movement 規則；不做也行，因為差異只影響規劃品質，不影響合法性 | 只新增投影欄位，GameState、事件、錯誤碼不變。屬 rules 套件與 web 型別的擴充，**不違反 I3 的字面**，但要排在 rules 的 PR |
| 選配：投影剩餘區域組成 | 建議**不做**，改在 bots 推導 | 會牴觸 `ep-privacy.test.ts:158-163` 的「只投影計數」意圖 |
| 選配：E&P 的 `legalCities` 回傳 `[]` | 低優先 | 只改 hints |
| **擱淺死結**（已實測） | **本次不改**。Bot 以規劃規避（見 §5.4），另向維護者提報規則議題 | 修正屬規則變更，需升 `ep-2025.2`，違反 I3 |

擱淺死結的構造（`strand.ts`）：船 x 穿過滿格邊 A 進入滿格邊 B，剩 1 MP；B 唯一的另一條海鄰邊 C 也滿；x 沒有 extra、沒有羊毛、沒有 settler。結果如下：

```json
{"stranded":true,"movesLeft":1,"steps":[],"canEndTurn":false,"turnEnd":"E_EP_EDGE_FULL"}
```

成因在 movement.ts:96 與 index.ts:109-112：只要求進入滿格邊時 MP ≥ 2，卻不保證之後有出口。真人也會卡死；只有 `extraMove`（要有羊毛）或 `found`（要有 settler）能脫困。

---

## 5. 策略設計草案

### 5.1 共用估值（E&P）

- **成本**：

  | 項目 | 成本 | 出處 |
  |---|---|---|
  | road | 木＋磚 | engine COSTS |
  | settlement、settler | 木＋磚＋羊＋穀 | engine COSTS；core.ts:32-38 |
  | harbour | 2 穀＋2 礦 | core.ts:32-38 |
  | ship | 木＋羊 | core.ts:32-38 |
  | crew | 羊＋礦 | core.ts:32-38 |
  | extra move | 1 羊 | core.ts:32-38 |

  羊毛用途最多，權重應上調（推測 ×1.2）。
- **金幣**：1 金約等於 0.45 張資源。依據是 2 金可換 1 張、每回合限 2 次、也用來付過路費。保留 1 枚應付過路費。
- **etaRounds**：沿用 base（economy.ts:139-174），匯率 3。另把「每回合最多 2 次、每次 2 金換 1」當成額外可兌換量。
- **分數來源**（`vp.ts` 統計 fixture 勝者）：

  | 任務 | harbour | plain | 任務軌道 |
  |---|---|---|---|
  | Land Ho! | 4.3 | 3.7 | — |
  | Pirate Lairs | 6.3 | 3.0 | 巢穴 2.7 |
  | Fish | 7.0 | — | 魚 3.0 |
  | Full | 7.3 | 2.2 | 魚 3.7、香料 2.0、巢穴 1.8 |

  一局約 10–25 輪。harbour 是分數主幹，魚軌道很強。

### 5.2 standard 與 easy：各決策窗口

**初始放置（變動式：Pirate Lairs、Fish、Spices、Full）**

| 步驟 | standard | easy |
|---|---|---|
| harbour（順序） | 分數 = 相鄰起始島 hex 的 pips × 權重，加上可放船的邊數（不碰霧、無船），加上到霧區前緣的 BFS 距離分數（越近越好），減去被他人 harbour 擋住的程度 | 前 3 名隨機挑 |
| settlement（反序） | 沿用 base `setupSpotScore`（heuristic.ts:322-347），拿掉港口項；補足 harbour 缺的資源（穀礦供升級；木羊供船；四種供 settler）；沿海加分，因為之後能升級 harbour | 前 3 名隨機挑 |
| route | road 朝下一個可蓋空點（`roadDirectionScore`，加上霧與 closed site 過濾）；ship 放在通往期望值最高霧格的邊 | road 與 ship 各取前 3 名隨機 |

Land Ho! 沒有開局決策。

**擲骰前**：只有 `turn.roll`。

**Action 子階段（standard，每次呼叫只出一個指令）**

0. 處理自己的 open 報價（沿用 `ownOfferStep`），結清後才能進 Movement。
1. **立即得分**：
   - 付得起就 `ep.buildHarbor`：選產量高，而且鄰邊可放船的點。
   - `build.settlement`（道路相連且合法）。
2. **遠征**：同時滿足以下條件就 `ep.buildSettler`：
   - 有可承載的位置：harbour 旁的空船（`pieceShips` 加上 cargo 為空）優先，其次是 harbour 的空位。
   - 遠征可行：本回合加下回合的 MP 範圍內有可建點；或霧區前緣的陸地期望值高。
   - `supply.settlements − 場上 settler 數 > 0`。這一條是防死循環的關鍵，fixture 就因為沒檢查而陷入死循環（見 §7）。
3. **任務**：
   - 巢穴：有未攻下巢穴，優先已有 2 名 crew、或自己 crew 最多的巢穴（拿 hero 加 1），而且軌道未滿，就把 crew 造到 harbour 旁的船上，一船 2 名。
   - 香料：選自己尚未進駐的農場，依能力價值排序：Swift > Fast Gold > Pirate Bonus（推測）。
4. **造船**：
   - 目標艘數：Land Ho! 2 艘；有任務時 3 艘。
   - 條件：有任務要做（harbour 有 cargo、前緣未探、要運魚或香料）。
   - 3 艘都在場上時，只替換空載而且離目標最遠的船。
5. **補缺口**：
   - 只在「補完這回合就能蓋」時才換：先 `ep.buyResource`，再 `trade.bank`（沿用 `bankTradeToward`）。
   - 手牌 ≥ 8 時先消化：bank，或 `fastGold`。`sellForGold` 只作最後手段。
6. **國內開價**：沿用 `proposeOffer`，只用資源；只差 1 張就能立即得分時才開價。
7. 有船要動就 `ep.startMovement`；否則直接 `turn.end`，省下指令。

**Movement 子階段（standard）**

0. 任務含魚而且還沒擲：**一開始就 `ep.fishRoll`**，因為擲骰會結束 active 船，而新放的魚可能本回合就裝得到。
1. 每艘 `chase === true` 的船先 `ep.chase`。追逐免費，成功時啟動自己的海盜。
2. 依任務排序船隻：
   1. 本回合能到可建點的 settler 船
   2. 能到 anchor 的運貨船
   3. 前往巢穴或農場的 crew 船
   4. 去取貨的船：有魚的淺灘、sack、harbour 裡的 cargo
   5. 探險船
   6. 閒置船
3. 處理當前的船：
   - 先做免費動作：`found`（選最佳點）、`deliver`、`dropCrew`、`loadFish`、`loadSpice`、`load`；`pickCrew` 只在 crew 供應用完、而且還有目標時才用。
   - 接著依自算 BFS 路徑，從 `steps` 挑出讓距離下降的那一步。
   - `extraMove`：目標「差 1–2 步可達」而且屬得分類（found、deliver、dropCrew），羊毛又不在計畫保留內，才付 1 羊。
   - 過路費：只在繞路代價 ≥ 2 步時才付，並保留 ≥ 1 金。
   - 探索步只在兩種情況採用：該船的最後一步；或沒有更好的用途。
   - 船做不出更好的動作時，就切到下一艘；切換會自動結束上一艘。
4. 沒有可做的事就 `turn.end`。擱淺時一定先移 active 船。

**海盜 frame（standard）**
- `placePirate` 的格分：
  - 加分：
    - 該格邊上的對手船：可偷，依領先程度加權。
    - 阻擋：對手船通往目標的路線經過此格，會被收過路費。
    - 嚇走對手要裝的魚：放在有魚的淺灘會清掉魚（pirate.ts:86-92）。
  - 減分：自己 2 步內要用的淺灘，因為擲魚時海盜所在淺灘不會放魚（movement.ts:383）。
- `robPlayer`：沿用 `stealVictim`（heuristic.ts:224-230）：手牌多者優先，同數比分數。

**棄牌**：沿用 `discardDecision` 骨架，但「保留」改用 E&P 當前計畫的成本。

**回應報價**：`offerGain` 改成計入金幣：
- `wantGoods.gold` 超過持有量就不可接受。
- 金幣以 0.45 張資源計價。

**easy（各窗口共通）**：
- 同一套估值，在前 3 名候選中隨機挑選。
- 不主動開價、不用 `extraMove`、不付過路費（改繞路或停下）。
- 探索只挑最近的霧格，不算期望值。
- 一律接受追逐（免費），但不規劃 hero。
- 海盜目標在前 3 名中隨機。
- 接受報價的門檻提高。
- **但必須保留「遠征加 harbour 升級」主線**，確保 bot-only 局會結束。

### 5.3 不確定性下的探索估值（只用公開剩餘庫存）

對揭露霧格集合 F 的一步：

```
EV(step) = Σ_{h∈F} Σ_t p_{R(h)}(t) · v(t, h)  −  c_MP · movesLeft_after
p_R(t)   = remaining_R(t) / Σ remaining_R
remaining_R(t) = EP_SCENARIOS[sc].regions[R].tiles[t] − #已揭露且屬 R 的 t
```

| tile | v(t, h) |
|---|---|
| 資源地 | 1 張資源（揭露獎勵），加上「可殖民價值」：E[pips \| R 剩餘 discs] × 是否有 settler 與 supply × 0.07 |
| gold | 2 金，加上巢穴任務價值（有巢穴任務時） |
| spice | 2 金，加上香料任務價值 |
| shoal | 2 金，加上魚任務價值 |
| sea | 2 金，加上航線延伸價值（小）。注意：揭露海格也會發 2 金（explore.ts:76-95） |

- 一步碰到 2–3 個霧格時全部揭露，期望值相加，應明顯加分。
- 「霧格全數揭露」等於不再有探索期望值，探險船改去做任務。
- 決策只依剩餘計數，與實際抽到什麼無關，因此滿足 B-FAIR。

### 5.4 防死結與防死循環

- **規劃規則**：只在抵達後 MP ≥ 2，或下一步有非滿格出口時，才進入滿格邊。如此 Bot 不會自己製造 §4.2 的擱淺死結，因為該狀態只能由行動者自己的移動造成。
- **進度監控（推測的參數）**：連續 6 輪沒有 VP 進展時，提高探索與任務權重，並停止造無用的 settler。

### 5.5 重用 base 的 `board.ts`、`economy.ts`、`trade.ts`

| 模組 | 可直接重用 | 需要修改或替換 |
|---|---|---|
| board.ts | `boardModel`、`isFreeSpot`、`vertexYield`／`playerYield`（robber -1 不影響）、`pipsOf` | `searchRoads` 加可選的邊謂詞（陸地邊、非霧、非 closed site），向下相容；`piecesLeft` 改讀 `V.players[me].supply`；gold field 的產值另計（captured lair 每座 2 金） |
| economy.ts | `deficitOf`、`canAfford`、`pay`、`addCosts`、`scaleCost`、`resourceWeights`、`weightedPips`、`etaRounds` | `economyOf` 不可用（綁定城市、發展卡、最長道路），改由 E&P 計畫產生器提供 |
| trade.ts | `offersAwaitingMe`、`ownOfferStep`、`acceptMargin`、`proposeOffer`、`bankTradeToward`（匯率 3 天然正確） | `handUtility`／`offerGain` 加入 goods |
| heuristic.ts | `Turn.pick`／topK、`LEVEL_PARAMS`、`respondToOffers`、`stealVictim`、`discardDecision` 骨架 | 其餘由 E&P 策略取代 |
| ep-sim.ts | 可當指令清單與目標優先序的參考：`goalSets`（66-104）、`actionMove`（181-221）、`movementMove`（224-281） | **不能照搬**：它讀 GameState，又靠 applyCommand 試錯 |

---

## 6. 保底策略（必定合法的最小動作）

| 情況 | 保底動作 | 依據 |
|---|---|---|
| setup，`H.setup.step==='harbor'` | `ep.setupHarbor` 用 `H.setup.harbor[0]` | setup.ts:182-184 |
| `'settlement'` | `ep.setupSettlement` 用 `settlement[0]` | — |
| `'route'` | 有 `ship[0]` 就 `ep.setupShip`，否則用 `road[0]` 送 `ep.setupRoad` | setup.ts:285-295 要求兩項都放 |
| 海盜 frame，stage `place` | `ep.placePirate` 用 `H.pirateTargets[0]` | 各地圖都有不鄰接起始島的海格 |
| stage `rob` | `ep.robPlayer` 用 `H.robCandidates[0]` | — |
| base `discard` | 沿用 base | fallback.ts:14-18 |
| `preroll` | `turn.roll` | — |
| Action 子階段 | `turn.end`（直接跳過 Movement，實測一定被接受） | engine.ts:1115-1135 |
| Movement、未擱淺 | `turn.end` | — |
| Movement、**擱淺**（`H.stranded`） | 依序嘗試：① active 船的 `steps[0]`，優先非 full 的步；② 沒有步時，若 `!extra` 而且羊毛 ≥ 1，送 `ep.extraMove`；③ active 船有 `found[0]` 就 `ep.found`；④ 都不行就回傳 null，記錄規則層死結 | 最後一種只會出現在真人或錯誤策略造成的 §4.2 狀態 |
| 非行動者 | 只回答自己欠的 frame；不回應報價（與 base 相同） | — |

在 Bot 自己的規劃規則下（§5.4），保證 Movement 子階段一定能結束：每個狀態都有 `turn.end`；或者有讓 MP 嚴格遞減的合法步；或者有 extra 與 found 可以脫困。

另外需要平台配合：BotDriver 在保底回傳 null 時要記錄並退避重試，而不是靜默停擺（G3）。

---

## 7. 測試與驗收

### 7.1 實測（fixture `epBotStep`，直接用 node 執行）

步數是決定性的；耗時則受機器負載影響很大。以下耗時取自 load average 約 1–3 的時段。另一輪在 load average 66–81 時量測（6 核，由多個 agent 共用），耗時膨脹 2–20 倍。

| profile × 人數 | 步數 中位（最大） | 視窗數 中位 | 每視窗指令 最大 | 每局耗時（低負載） |
|---|---|---|---|---|
| land-ho 3p | 390（465） | 41 | 21 | 0.50–0.59 s |
| land-ho 4p | 498（523） | 38 | 21 | 0.42–0.59 s |
| pirate-lairs 3p | 758（914） | 83 | 23 | 0.65–1.29 s |
| pirate-lairs 4p | 748（797） | 67 | 22 | 0.95–1.12 s |
| fish 3p | 851（1135） | 74 | 24 | 0.85–1.45 s |
| fish 4p | 1166（1290） | 88 | 26 | 1.68–1.70 s |
| spices 3p | 760（950） | 75 | 26 | 1.07–1.08 s |
| spices 4p | 1214（1564） | 80 | 26 | 1.78–2.50 s |
| full 3p | 1223（5304；**seed 5 跑到 20000 步仍未結束**） | 94 | 27 | 1.6 s；8.0 s（5304 步那局） |
| full 4p | 1411（1726） | 90 | 30 | 1.87–2.66 s |

補充數據：
- 每個座位一次 `projectGame` 加 `actionHints`：0.055–0.115 ms。
- 指令分布（4p、10 局、10199 個指令、728 個視窗）：每視窗平均 14.0 個。`ep.moveShip` 佔 47.3%；`turn.roll`、`ep.startMovement`、`turn.end` 各約 7%；`ep.buyResource` 6.5%；`ep.fishRoll` 5.0%。
- 既有 vitest：

  | 測試 | 低負載 | 高負載（load 66–81） |
  |---|---|---|
  | rules `ep-sim.test.ts`（10 局） | 12.2 s（每局 0.57–2.0 s） | 228 s |
  | bots `policy.test.ts`（40 局 B-GAME） | 11.2 s（每局 0.17–0.29 s） | — |
  | bots 全套件 | 12.9 s | — |

- **死循環證據**：full 3p seed 5 到第 1000 步後，分數停在 15、14、14，霧格還剩 24/32，6000 步內完全沒推進。成因：fixture 的 settler 船停在「距離為 0」的目標旁，但 p3 的 plain settlement 已滿 5 座（`foundTargets` 為空），船永遠不動（ep-sim.ts:87、270）。這是 fixture 的缺陷，不是規則問題，但證明 B-GAME 需要防死循環的設計與監控。

### 7.2 預計新增的測試

| 家族 | 案例 | 規模 |
|---|---|---|
| B-GAME | 5 profile × {3,4} 人；standard 與 easy 混合座位；斷言 `victory`、0 拒絕、`pending===null`、資源守恆、148 金守恆、6 份魚守恆（比照 ep-sim.test.ts:17-44）、每視窗指令數 ≤ 上限、沒有規則層擱淺 | CI：每組 5 seeds，Land Ho! 用 10 seeds；`maxSteps` 8000（約為已完成局最大值 1726 的 4.6 倍）；另加視窗數 ≤ 400 的監控 |
| B-GAME | 「保底座位混局」：一席 fallback，其餘 heuristic；斷言能結束 | 每 profile 1 seed |
| B-POLICY | 每個決策都被 `applyCommand` 接受；合約檢查：非行動者只送 `pending.discard` 或 `trade.respond`；Movement 不送 Action-only 指令；`ep.buildSettler` 不在別處有空位時帶 `remove`；不自造擱淺 | 隨 B-GAME 執行 |
| B-POLICY 決定性 | 同 seed 重播逐指令一致；兩個策略實例對同一 view 結果一致 | full 4p 與 pirate-lairs 3p 各 2 seeds |
| B-POLICY fuzz | 取樣中局狀態，擾動手牌與金幣（金幣守恆）與報價 → 決策仍合法 | 每 profile 約 30 個狀態 |
| B-POLICY 保底 | 純 fallback 席位每個 profile 跑 1500 步不停擺；構造的情境：setup 三步、海盜 place 與 rob、擱淺有步、擱淺無步但有羊毛、Action 直接 `turn.end` | 各 1 |
| B-FAIR | 每 profile 取 ≥ 40 個快照；變體為交換對手手牌、打亂 `pools.discs`、`abilities`、`lairTokens` 的順序；斷言 view JSON 相同、決策相同、不修改 view | standard 與 easy |
| B-FAIR 不預知 | 選決策為探索 `ep.moveShip` 的狀態，以兩個不同 rng 套用；斷言探索前的決策與 rng 無關，並且（以型別與 B-GUARD 保證）策略收不到 GameState | 每 profile 5 個 |
| 單元 | 海路 BFS（滿格邊、外框邊、霧終止、過路費）、剩餘庫存推導與 `ep-privacy` 的期望值一致、容量計算、開局評分 | — |
| B-LIFE（server） | 一桌 Land Ho! 的 Bot 局在 fake clock 下推進到 Movement；確認 `ep.*` 的節奏與上限 | 1 |

### 7.3 CI（`pnpm verify`）時間預估

注意：目前 CI workflow 只負責 docker 建置與 smoke，測試在本機 `pnpm verify` 中執行。

- E&P Bot 每局的成本推測與 fixture 相當。fixture 每次嘗試都會 clone state；Bot 則在每次決策做數次 BFS（244 條邊的圖），預估每局 0.5–2.5 s。
- B-GAME 共 55 局（5 profile × 2 人數 × 5 seeds，Land Ho! 多 5 局），CPU 時間約 30–140 s。
- 每個 profile 拆成一個測試檔，讓 vitest 多 worker 並行，低負載時 wall time 推測 25–45 s。
- 加上 B-FAIR、fuzz、保底約 10–20 s。
- bots 套件會從 12.9 s 增加到約 40–65 s（推測）。高負載時可能放大 10 倍以上，`GAME_TIMEOUT` 要維持 120 s 以上。

### 7.4 bench 要量的指標

依 profile 與人數分組：
- standard 對 easy 的勝率（目標 ≥ 60%，推測值）。
- 平均輪數與步數。
- 決策耗時（平均與最大）。
- 每視窗指令數（平均、p95、最大，對照上限）。
- `ep.moveShip` 佔比。
- 跳過 Movement 的比例。
- 探索次數與一步多揭露的比例。
- 勝者 VP 組成：plain、harbour、各軌道。
- 金幣峰值與閒置量。
- fallback 使用次數、拒絕次數（應為 0）、死循環次數（應為 0）。
- 用目前節奏表估算的「Bot 回合秒數」。

---

## 8. 切片與工作量

推估依據：
- base Bot 的 `packages/bots/src` 約 1,470 行（board 258、economy 302、heuristic 625、trade 195、fallback 84 等），測試約 1,000 行。
- E&P 多了 Movement 規劃與三個任務；base 的經濟與交易工具可重用約 40%。
- fixture `ep-sim.ts`（343 行）證明「目標集合加 BFS」就足以跑完所有任務，但它靠試錯，view-based 版本必須自己算容量、可達性與合法性。

| 批次 | 內容 | 檔案範圍 | 規模 | 粗估行數（src＋test） | 依賴 |
|---|---|---|---|---|---|
| E0 平台對接 | `BotCommand`、模組策略插槽的 E&P 實作骨架、harness 支援 profile 與 setupMode、driver 的 THINK_MS 與上限、rules 純匯出 | bots/types、harness、server/bot-driver、rules/index（只加匯出） | S | 150＋100 | Architect 的平台設計（P1–P7） |
| E1 E&P 底座與保底 | view 與 hints 存取器、幾何（霧、海邊、沿海、可建點、closed site、區域歸屬）、海路 BFS、剩餘庫存、E&P 保底（setup、海盜、擱淺）、5 profile 的保底不停擺測試 | `bots/src/modules/explorersPirates/{view,geometry,sea,explore,fallback}.ts` | M | 450＋250 | E0；海路原語可與 Seafarers 共用 |
| E2 Land Ho! | E&P 計畫與經濟（harbour、road＋settlement、settler 遠征、船、金幣、3:1）、Action pipeline、Movement（遠征、探索期望值、found、load）、棄牌、goods 估值、B-GAME 與 B-FAIR（Land Ho!） | `{plans,action,movement}.ts`、trade.ts、board.ts（`searchRoads` 謂詞） | L | 700＋300 | E1 |
| E3 Pirate Lairs | 變動式開局、海盜 frame 策略、規劃加入過路費與追逐、crew、巢穴（hero）、gold field 估值 | `{setup,pirate,missions}.ts` | M | 400＋200 | E2 |
| E4 Fish、Spices、Full | 擲魚、運魚、Council 交付、香料農場與 sack、三種能力（Swift 的 MP、Fast Gold、Pirate Bonus 追逐數字）、Full 的任務優先序 | `missions.ts`、`movement.ts` | M | 400＋200 | E3 |
| E5 bench、調參、文件 | bench 指標、SPEC §4.9 與第 274 行、FIDELITY、roadmap、work 紀錄、web i18n（`lobby.bots.unsupported` 兩語系） | bots/bench、docs、web/i18n | S | 150＋文件 | E2–E4 |

合計約 src 2,250 行、測試 1,050 行、bench 150 行；規模約等於整個 base Bot PR 的 1.3 倍。

**MVP**
- 如果 gating 可以細到 profile（P3）：最小上線版本是 E0＋E1＋E2，只開放 `ep-land-ho-2025`。
- 如果 gating 只能到模組：最小上線版本必須是 E0–E4 全做，5 個 profile 一起開放；策略維持「view-based 的 fixture 等級」即可。

**可延後的強化**：
- 含金幣的主動國內開價
- 進階的 `extraMove` 與過路費取捨
- 海盜的阻擋戰術
- 巢穴 hero 的最佳化
- 用 harbour 中轉貨物（swap、unload）
- 聰明的換船
- 與對手競速搶探索
- `sellForGold` 與 Fast Gold 的最佳化
- 讓 easy 更擬人

---

## 9. 風險與待決問題

### 需要使用者決定

1. **上線粒度**：E&P 是否接受分批開放？
   - (a) 一個小版本放出 E&P 全部 5 個 profile：工作量 E0–E4，約 3,300 行。
   - (b) 先開放 Land Ho!（或加 Pirate Lairs），其餘後補。需要 gating 細到 profile，並把 SPEC §4.9「A module joins the supported list…」改成「a profile joins the supported list once the strategies issue every command and answer every pending frame its modules can produce in that profile」。
   - 我的建議：如果節奏允許，選 (a)。Fish、Spices、Full 在 Pirate Lairs 之上只增加約 400 行；而 (b) 要多動 SPEC 與平台。
2. **Bot 節奏**：E&P 的 Bot 一回合平均 14 個指令。用目前預設約 12.6 秒，照 §4.1 的建議約 8–9 秒。是否接受 `ep.moveShip` 縮短到 400 ms？
3. **擱淺死結**：是否另開規則議題（需要 `ep-2025.2` 版本與存檔相容的處理）？還是先只讓 Bot 規避，並在 FIDELITY 記為已知缺口？
4. **國內交易含金幣**：MVP 只「正確回應」、不主動提出，是否可以接受？

### 技術風險

5. 40 指令上限：fixture 已達 30。若沒有 P4，standard Bot 中後期可能被強制走保底，造成截斷回合；擱淺時更會無限退避重試。
6. 死循環：fixture 在 full 3p 出現 2 個死循環（seed 2 跑了 5304 步，seed 5 沒有結束）。Bot 必須有供應感知與進度監控（§5.4），B-GAME 也要監控視窗數。
7. 強度：可公平取得的資訊下，Movement 的長期規劃只能用啟發式；standard 對真人的強度只能靠 bench 迭代。
8. 測試時間：bots 套件可能從 13 s 增加到 40–65 s。在共用機器上（本次量測時 load 最高到 81）可能超過 timeout，要拆檔並行，並維持寬鬆的 timeout。
9. `LAIR_TOKENS` 是暫定值（FIDELITY interpretation 1）：Bot 的 gold field 估值應讀匯出常數，避免日後修正時策略失準。
10. 選配的 rules hints 擴充（`ships[].reach`）會把 E&P 的 Bot 工作拉進 rules 套件的 PR；這與「規則不變」的發佈敘事要先對齊。
