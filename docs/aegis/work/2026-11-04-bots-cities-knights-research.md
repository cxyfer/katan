# Cities & Knights（C&K）電腦對手：Round-1 研究報告

> 收錄說明：2026-11-04 第一輪唯讀研究報告，內容原樣保留，基準 `a200840`（v0.4.0）。定稿計畫是 `docs/aegis/plans/2026-11-04-bots-cities-knights.md`，研究之後的修正一律以計畫為準。文中的 `/tmp/katan-bot-research/<slug>/report.md` 對應 `docs/aegis/work/2026-11-04-bots-<slug>-research.md`；探查腳本與輸出沒有提交。

> 角色：Planner｜Repo：`graceful-swan` @ `a200840`（= v0.4.0），分支 `docs/expansion-ai-opponent-plans`
> 全程唯讀：repo 內沒有新增、修改或刪除任何檔案，也沒做任何 git 寫入。探查腳本都放在 `/tmp/katan-bot-research/cities-knights/`，以 `node --experimental-transform-types` 執行。原本指定的 `--experimental-strip-types` 不行，因為 `packages/rules/test/helpers.ts:49` 用了 parameter property。
> **路徑縮寫**：`ck/` = `packages/rules/src/modules/citiesKnights/`；`bots/` = `packages/bots/src/`；`rules/` = `packages/rules/src/`。
> **量測注意**：所有時間數字都是在其他 agent 同時使用的機器上測的（6 核，load average 12–96），只能當數量級參考。步數、指令數、拒絕數這類計數不受負載影響。
> **外部來源**：沒有引用任何外部策略文章。§5 的策略全部從 repo 內的規則推導；屬於啟發式判斷或推測的地方會明確標示。

---

## 0. 重點摘要

1. **介面規模**：C&K 有 23 個模組指令（`ck/index.ts:151–175`），其中 13 個能在 pending 期間送出（`ck/index.ts:176–190`）。pending frame 共 14 種（13 種要回應，1 種是沒有 responder 的續行 frame），另外還會用到 base 的 `discard / moveRobber / steal / freeRoads`。可打出的進步卡有 23 種，另有 2 張 VP 卡在抽到時自動公開。
2. **現況會卡死，違反 I9**：讓 base Bot 直接打 C&K（standard、4 人、10 個種子）：
   - 8/10 局在第一次蠻族攻擊後卡在 `citiesKnights.pillage`；
   - 2/10 局在 7 點棄牌時送出錯誤張數，保底策略也同樣被拒（`E_INVALID_DISCARD_COUNT`）。
3. **保底只靠 view＋hints 就做得到**：探查腳本只讀投影來回答全部 14 種 C&K frame 和含商品的 discard。7 局（3–6 人）全部完成，**0 次拒絕**。
4. **只做核心的原型已能完成整局**：原型涵蓋改良、騎士防禦、追強盜、商品換牌，沒有任何進步卡策略。3–6 人每局都完成，0 次拒絕，平均 21–38 輪。但 6 人時單一視窗最多送出 32 個指令，已接近 driver 上限 40。
5. **平台需求**（細節見 §4）：
   - `BotPolicy` 的回傳型別要涵蓋 `ModuleCommand`；
   - fallback 要有模組 duty 掛鉤；
   - harness 要依 profile 建局，資源守恆要納入商品與進步卡；
   - `THINK_MS` 要列入模組指令；
   - rules 要匯出 C&K 的 view/hints 型別與常數。
   以上都不改規則，符合 I3。
6. **切片建議**：PR-B 是核心 MVP（全部 frame 應答＋核心策略＋不涉及他人的卡），做完就能打開 gating；PR-C 補完互動型進步卡。兩個 PR 都排進同一個 minor（0.4.1）可行。若時程吃緊，0.4.1 只出 PR-B 也能通過 SPEC R-BOT 的閘門。

---

## 1. 範圍

| Profile id | 人數 | enabled | ruleModules | VP | 備註 | 來源 |
|---|---|---|---|---|---|---|
| `ck-2025` | 3, 4 | ✅ | `['citiesKnights']`（由 `expansions` 推導，`rules/profiles.ts:182`） | 13 | `devDeck: []`；pieces = base＋knights 6；商品每種 12 | `rules/profiles.ts:418–430` |
| `ck-paired-2025` | 5, 6 | ✅ | `['citiesKnights']` | 13 | `PAIRED_BASE`（hex-r56、bank 24）；商品每種 18 | `rules/profiles.ts:432–449` |
| `sf-ck-new-shores-2025` | 3, 4 | ✅ | `['seafarersCitiesKnights','seafarers','citiesKnights']` | 16 | **不在本次範圍** | `rules/profiles.ts:457–481` |
| `sf-ck-new-shores-paired-2025` | 5, 6 | ✅ | 同上 | — | **不在本次範圍** | `rules/profiles.ts:485–` |

- gating 規則：`botsCanPlay` 要求 profile 的每個 ruleModule 都在 `BOT_RULE_MODULES` 內（`bots/support.ts:12–17`），目前這個清單是空的。只把 `'citiesKnights'` 加進去，恰好會開放 `ck-2025` 和 `ck-paired-2025`。SF+CK 還需要 `seafarers` 與 `seafarersCitiesKnights`，不會被一起打開。
- SPEC 閘門：「A module joins the supported list only once the strategies issue its commands and answer its pending frames」（`docs/SPEC.md:188`）。另外 R-BOT 要求 Bot 對 Bot 的模擬局在「每個開放 bot 席位的 profile、每種人數」都要以分出勝負結束（`docs/SPEC.md:192`）。

---

## 2. Bot 介面盤點

### 2a. 模組指令（23 個，對照 `ck/index.ts:151–175`）

`messages.ts` 只定義事件（59 種，`ck/messages.ts:6–66`）和錯誤碼（14 種，`ck/messages.ts:68–81`），沒有列出指令；指令以 commands map 為準。下表把 23 個指令全部列出。

| # | type | 欄位 | 合法時機 | handler | Bot 從哪取得合法目標 |
|---|---|---|---|---|---|
| 1 | `build.wall` | `{vertex}` | 自己回合、action、無 pending | `ck/cities.ts:64` | `hints.wallSites`（只在 action 內出現，`ck/index.ts:291`）；成本看 `hints.costs.wall`。hint 不檢查付不付得起 |
| 2 | `city.improve` | `{track, vertex?}` | 同上 | `ck/cities.ts:131` | `hints.improvements[]`（`ck/cities.ts:101–128`），欄位有 `blocked`、`sites`、`metropolis`。`sites` 超過 1 個時必須帶 `vertex`，否則回 `E_INVALID_SELECTION` |
| 3 | `knight.recruit` | `{vertex}` | 同上 | `ck/knights.ts:172` | `hints.recruitSites`（要有 level-1 騎士存量才會給，`ck/index.ts:289`）＋ `costs.knight` |
| 4 | `knight.activate` | `{vertex}` | 同上 | `ck/knights.ts:190` | `hints.knights[].canActivate`（等於 `!active`，不檢查成本，`ck/index.ts:278`）＋ `costs.activate` |
| 5 | `knight.promote` | `{vertex}` | 同上；每隻騎士每回合一次；升到 3 級要 politics≥3 | `ck/knights.ts:207` | `hints.knights[].canPromote`（`ck/knights.ts:133–139`）＋ `costs.promote` |
| 6 | `knight.move` | `{from, to}` | 同上；`canAct` 為真（已啟動且不是本視窗剛啟動），執行後騎士變回未啟動 | `ck/knights.ts:239`（`:251`） | `hints.knights[].moves` |
| 7 | `knight.displace` | `{from, to}` | 同上；只能擠走等級較低的騎士 | `ck/knights.ts:259`（`:275`） | `hints.knights[].displace` |
| 8 | `knight.chaseRobber` | `{vertex}` | 同上；`attacks > 0` 且騎士與強盜相鄰；之後進入 base 的 `moveRobber`（cause `'knight'`） | `ck/knights.ts:313`（`:321`） | `hints.knights[].chase` |
| 9 | `knight.retreat` | `{vertex}` | pending `displaced`，由被擠走者回應；**沒有 null 選項** | `ck/knights.ts:296` | `pending.data.options`／`hints.retreat` |
| 10 | `barbarians.pillage` | `{vertex}` | pending `pillage`，任意順序 | `ck/barbarians.ts:157` | `pending.data.cities[self]`／`hints.pillage` |
| 11 | `barbarians.chooseDeck` | `{track}` | pending `defenderDraw`，**只有 `responders[0]`** 能回應 | `ck/barbarians.ts:193` | `pending.data.decks`／`hints.defenderDecks`（只給 responders[0]） |
| 12 | `progress.discard` | `{cards}` | (a) pending `progressDiscard`：張數必須剛好等於 `required`；(b) 自己回合 action 且超過手牌上限：否則回 `E_PROGRESS_WITHIN_LIMIT` | `ck/progress.ts:103–142` | `data.required[self]`、`hints.progressExcess`、自己的 `progressCards` |
| 13 | `science.take` | `{resource \| null}` | pending `scienceBonus`，**只有 `responders[0]`**；`undefined` 會被拒，`null` 表示放棄 | `ck/production.ts:134` | `hints.scienceBonus`（布林值）＋ `view.bank` |
| 14 | `progress.play` | `{card, …}` | 自己回合、無 pending；Alchemy 只能在 preroll，其餘卡只能在 action | `ck/cards.ts:36–54`（時機判斷在 `:28–33`） | `hints.progress[]`（`ck/cards.ts:67–83`）；`targets` 只有在 `playable` 為真時才會填 |
| 15 | `progress.harborOffer` | `{to, resource}` | 打出 Commercial Harbor 後的 action 階段 | `ck/cards-trade.ts:55` | `hints.harborTargets`、`view.modules.citiesKnights.harbor` |
| 16 | `progress.harborAnswer` | `{commodity}` | pending `harborExchange`，由接收方回應 | `ck/cards-trade.ts:92` | 自己手上的商品 |
| 17 | `progress.takeCards` | `{cards}`（張數 = `count`） | pending `guildDues`，由行動者回應 | `ck/cards-trade.ts:144` | `data.hand`（只有行動者看得到）、`data.count` |
| 18 | `progress.takeProgress` | `{card \| null}` | pending `espionage`，由行動者回應 | `ck/cards-politics.ts:203` | `data.cards`（只有行動者看得到） |
| 19 | `progress.sabotageDiscard` | `{cards}` | pending `sabotage`，任意順序 | `ck/cards-politics.ts:344`（`answerCards`） | `data.required[self]` |
| 20 | `progress.weddingGive` | `{cards}` | pending `wedding`，任意順序 | 同上 | `data.required[self]` |
| 21 | `progress.treasonRemove` | `{vertex}` | pending `treasonRemove`，由受害者回應 | `ck/cards-politics.ts:458` | `data.knights` |
| 22 | `progress.treasonPlace` | `{vertex \| null, level}` | pending `treasonPlace`，由行動者回應 | `ck/cards-politics.ts:470` | `data.sites`、`data.levels` |
| 23 | `progress.diplomacyRoad` | `{edge \| null}` | pending `diplomacyRoad`，由行動者回應 | `ck/cards-politics.ts:137` | `data.edges` |

**C&K 對 base 指令的改動**

- 停用的指令（`ck/index.ts:149`）：`build.devCard`、`dev.playKnight`、`dev.playRoadBuilding`、`dev.playYearOfPlenty`、`dev.playMonopoly`。送出會回 `E_INVALID_COMMAND`，reason 為 `not-in-ruleset`（`rules/engine.ts:680`）。
- `trade.bank {give: CardKind, receive: CardKind}`：給出和換入都可以是商品（`rules/engine.ts:80–112`、`1685–1705`）。
- `pending.discard.resources: CardKind[]`：可以棄商品（`rules/engine.ts:1563+`）。
- 國內交易的條件型別也是 `CardKind`。
- `build.city` 成本不變（`rules/engine.ts:116–121`），另由 `allowCity` 處理被推倒的城市（toppled）（`ck/cities.ts:220`）。
- `setup.settlement` 在第 2 輪會放下城市（`ck/index.ts:90–92`）。
- `turn.end` 可能被進步卡手牌上限否決（`ck/progress.ts:145–149`）。

**錯誤碼對照**（`ck/messages.ts:68–81`）

| 錯誤碼 | Bot 的避免方式 |
|---|---|
| `E_KNIGHT_ACTIVE`、`E_KNIGHT_INACTIVE` | 依 hints 的 `canActivate`／`canAct` |
| `E_KNIGHT_JUST_ACTIVATED` | 依 hints 的 `canAct` |
| `E_KNIGHT_PROMOTED`、`E_KNIGHT_TOO_WEAK` | 依 hints 的 `canPromote`／`displace` |
| `E_IMPROVEMENT_*`、`E_METROPOLIS_NO_CITY` | 依 `improvements[].blocked` |
| `E_ROBBER_INACTIVE` | 依 `hints.progress[].reason = 'robber-inactive'` |
| `E_PROGRESS_HAND_LIMIT`、`E_PROGRESS_WITHIN_LIMIT` | 依 `hints.progressExcess` |
| `E_ALCHEMY_SET` | 依 `reason = 'alchemy-set'` |
| `E_PROGRESS_DECK_EMPTY` | 依 `data.decks` |

**結論**：每個指令的合法目標都能在 view、hints 或 frame data 找到。真正得從 GameState 推導的缺口只有兩類：
1. 成本是否付得起：hints 不檢查，但可以用自己的 `resources`／`commodities` 自行比對，這不算資訊缺口。
2. 機率與牌組組成常數：未匯出，見 §4。

### 2b. Pending frames

**Base frame 在 C&K 下的變化**

| kind | C&K 的變化 | 來源 |
|---|---|---|
| `discard` | 計算的是總牌數（資源＋商品）；上限 = 7＋2×城牆數；首次攻擊前擲出 7 仍要棄牌 | `rules/engine.ts:1072–1100`、`ck/index.ts:105–107`、`docs/FIDELITY.md:129` |
| `moveRobber` | 首次攻擊前不會出現（`robberInactive`）；之後來自 7 點，或 `knight.chaseRobber`（cause `'knight'`） | `ck/index.ts:109–111`、`ck/knights.ts:313` |
| `steal` | 可能偷到商品 | `rules/engine.ts:1649+` |
| `freeRoads` | 來自進步卡 Road Building，`remaining = min(2, 可蓋數)` | `ck/cards-science.ts:221` |
| `yearOfPlenty`／monopoly（dev） | 不會出現（發展卡停用） | `ck/index.ts:149` |

**C&K 模組 frame（14 種）**

| kind | 定義 | 觸發條件 | responders／順序 | 應答指令 | 投影 data |
|---|---|---|---|---|---|
| `citiesKnights.resolveRoll` | `ck/dice.ts:25` | 擲骰結算中有任何 frame 插隊 | `[]`，續行用（`ck/index.ts:143`） | — | `{}` |
| `citiesKnights.pillage` | `ck/barbarians.ts:29` | 蠻族獲勝，且落敗者有 2 座以上可掠奪城市；只有 1 座時直接自動掠奪（`:83–88`） | 落敗者，任意順序 | `barbarians.pillage` | `{cities:{id:vertices}}`（`ck/index.ts:251–252`） |
| `citiesKnights.defenderDraw` | `ck/barbarians.ts:30` | 防守方獲勝且最高貢獻者平手 | 平手者，**依序**（responders[0]） | `barbarians.chooseDeck` | `{decks}`（`ck/index.ts:259–260`） |
| `citiesKnights.displaced` | `ck/knights.ts:43` | `knight.displace` 或 Intrigue 擊退騎士，且騎士有退路；沒退路時直接移除 | 被擠走者 | `knight.retreat` | `{player, level, active, from, options}`（`ck/index.ts:253–256`） |
| `citiesKnights.progressDiscard` | `ck/progress.ts:36` | 非輪到的玩家抽卡後超過 4 張（`ck/progress.ts:79–101`） | 任意順序 | `progress.discard` | `{required}`（`ck/index.ts:257–258`） |
| `citiesKnights.scienceBonus` | `ck/production.ts:24` | 非 7 點時，science≥3 且這次沒拿到牌的玩家（`ck/production.ts:118–131`） | **依序**（responders[0]） | `science.take` | `{}`；`hints.scienceBonus` |
| `citiesKnights.harborExchange` | `ck/card-common.ts:12` | `progress.harborOffer` 的接收方持有 2 種以上商品 | 接收方 | `progress.harborAnswer` | `{from, resource?}`（resource 只有雙方看得到，`ck/cards-trade.ts:234–238`） |
| `citiesKnights.guildDues` | `:13` | 目標超過 2 張牌且不只一種 | 行動者 | `progress.takeCards` | `{victim, count, hand?}`（hand 只有行動者看得到，`ck/cards-trade.ts:239–244`） |
| `citiesKnights.espionage` | `:14` | 目標有進步卡 | 行動者 | `progress.takeProgress` | `{victim, count, cards?}`（`ck/cards-politics.ts:507–511`） |
| `citiesKnights.sabotage` | `:15` | 被破壞者無法自動決定棄牌 | 被破壞者，任意順序 | `progress.sabotageDiscard` | `{actor, required}`（`:512–514`） |
| `citiesKnights.wedding` | `:16` | 贈與者無法自動決定 | 贈與者，任意順序 | `progress.weddingGive` | `{actor, required}` |
| `citiesKnights.treasonRemove` | `:17` | 目標有 2 隻以上騎士 | 受害者 | `progress.treasonRemove` | `{actor, knights}`（`:515–516`） |
| `citiesKnights.treasonPlace` | `:18` | Treason 移除騎士之後 | 行動者 | `progress.treasonPlace` | `{level, active, from, levels, sites}`（`:517–521`） |
| `citiesKnights.diplomacyRoad` | `:19` | Diplomacy 拆的是自己的路，且有合法重建位置 | 行動者 | `progress.diplomacyRoad` | `{edge, edges, ship?}`（`:522–523`） |

`answered` 可以把 responder 從任意位置移除（`ck/card-common.ts:72`）。只有 `defenderDraw` 和 `scienceBonus` 由 handler 強制要求 `responders[0]`，因此 Bot 必須判斷自己是不是排在第一位；hints 已經只發給 responders[0]。

**進步卡 → frame → 誰回應**

23 種可打出的卡由 `CARD_RULES` 合併而來（`ck/cards.ts:22–26`），牌組組成見 `ck/constants.ts:75–107`。

| 牌組 | 卡（張數） | 時機 | `progress.play` 欄位 | 之後的 frame → 回應者 | 規則位置 |
|---|---|---|---|---|---|
| 科學 | alchemy (2) | preroll | `{dice:[1–6,1–6]}` | 無；之後 `turn.roll` 用指定的兩顆骰，事件骰照擲 | `ck/cards-science.ts:27`、`ck/dice.ts:27–37` |
| | crane (2) | action | `{track, vertex?}` | 無 | `:56` |
| | engineering (1) | action | `{vertex}` | 無 | `:70` |
| | invention (2) | action | `{hexes:[a,b]}`（不能是 2/6/8/12，`:21`） | 無 | `:94` |
| | irrigation (2)／mining (2) | action | `{}` | 無 | `:133`、`:208`、`:220` |
| | medicine (2) | action | `{vertex}`（花 1 grain＋2 ore，`:18`） | 無 | `:209` |
| | roadBuilding (2) | action | `{}` | base `freeRoads` → 行動者 `build.road` | `:221` |
| | smithing (2) | action | `{vertices}`（1–2 隻，不重複） | 無 | `:179` |
| | printing (1) | 抽到即公開 | — | 無（+1 VP，`checkVictory`） | `ck/progress.ts:48`、`ck/constants.ts:72` |
| 貿易 | commercialHarbor (2) | action | `{}` | 之後行動者發 `progress.harborOffer`；接收方商品 0 種時退回、1 種時自動交換，2 種以上進 `harborExchange` → 接收方回應 | `ck/cards-trade.ts:33`、`:55–107` |
| | guildDues (2) | action | `{target}`（只能選公開分數較高者） | 可能自動完成，否則 `guildDues` → 行動者回應 | `:113`、`:144` |
| | merchant (6) | action | `{hex}` | 無（+1 VP、該資源 2:1） | `:160`、`ck/merchant.ts:28–57` |
| | merchantFleet (2) | action | `{kind}`（8 種） | 無 | `:183` |
| | resourceMonopoly (4)／tradeMonopoly (2) | action | `{kind}` | 無 | `:198–222`、`:228–229` |
| 政治 | constitution (1) | 抽到即公開 | — | 無（+1 VP） | `ck/constants.ts:72` |
| | diplomacy (2) | action | `{edge}` | 拆自己的路時 `diplomacyRoad` → 行動者回應 | `ck/cards-politics.ts:110`、`:137` |
| | encouragement (2) | action | `{}` | 無（啟動的騎士本視窗不能行動，P3-7） | `:166`、`docs/FIDELITY.md:449–453` |
| | espionage (3) | action | `{target}` | `espionage` → 行動者回應 | `:186`、`:203` |
| | intrigue (2) | action | `{vertex}` | 騎士有退路時 `displaced` → 受害者回應 | `:233` |
| | sabotage (2) | action | `{}` | 可能自動完成，否則 `sabotage` → 各受害者回應 | `:317`、`:262–271` |
| | taxation (2) | action | `{hex}`（強盜要已啟動） | 無（隨機偷牌） | `:375` |
| | treason (2) | action | `{target}` | 目標有 2 隻以上騎士時 `treasonRemove` → 受害者回應；之後 `treasonPlace` → 行動者回應 | `:418`、`:458–491` |
| | wedding (2) | action | `{}` | 可能自動完成，否則 `wedding` → 各贈與者回應 | `:330`、`:273–281` |

`playProgress` 只檢查卡片在 `progressCards` 中；`newProgressCards` 沒有用來擋，所以**抽到的當回合就能打出**（`ck/cards.ts:45`）。打出的卡回到該牌組底部（`ck/card-common.ts:47–53`），因此進步卡總數守恆（54 張）。

### 2c. 回合結構的改變

1. **Setup**：第 1 輪放 settlement＋road；第 2 輪的 `setup.settlement` 放的是**城市**（`ck/index.ts:90–92`）。起始配給由城市領取（`docs/FIDELITY.md:118`），每個相鄰地形給 1 張資源，不給商品。
2. **Preroll**：可打 Alchemy（只有輪到的玩家；paired 的 P2 沒有 Alchemy，`docs/FIDELITY.md:134`），然後 `turn.roll`。
3. **擲骰**（`ck/dice.ts:27–59`）：`turn.dice = [yellow, red]`，事件骰從 `EVENT_FACES` 擲出，6 面中 3 面是船（`ck/constants.ts:69`）。事件在生產之前結算。
   - 擲到船：`advanceBarbarians`（`ck/barbarians.ts:33–40`）；到達 7 時進入 `resolveAttack`（`:61–125`）。
   - 擲到城門：`resolveProgressEvent`（`ck/progress.ts:69`）依回合順序處理，紅骰 ≤ 等級＋1 的玩家抽卡；之後 `queueProgressDiscards`（`:88`）。
   - 有任何 frame 插隊時，排入 `resolveRoll` 續行 frame。
4. **生產**（`ck/production.ts:34–70`）：
   - 森林／牧場／山脈上的城市產出 1 資源＋1 對應商品（`rules/types.ts:41–45`）；丘陵／田地上的城市產出 2 資源。
   - 強盜所在的格子什麼都不產；資源短缺規則按牌種分別計算。
   - 擲出 7：base 的 `resolveSeven` 照常棄牌，但首次攻擊前不移動強盜（`ck/index.ts:98–111`）。
   - 之後處理 science 獎勵 frame（`ck/production.ts:118–131`）。
5. **蠻族攻擊**：
   - 蠻族強度 = 場上城市數（含大都市）（`ck/barbarians.ts:42–44`）；防守 = 所有已啟動騎士的等級總和（`:46–50`）。
   - 平手算防守方贏（`:71`）。
   - 蠻族獲勝：貢獻最低、且有可掠奪城市的一群玩家各失去一座城市（`:131–139`）；大都市不會被掠奪（`:53–59`）。
   - 防守方獲勝：唯一最高貢獻者 +1 defender VP；最高者平手時進入 `defenderDraw`；最高貢獻為 0 時沒有獎勵（`:89–104`）。
   - 攻擊後蠻族歸零、所有騎士變回未啟動；第一次攻擊時強盜上場（`:106–113`）。
6. **Action**：base 的建造與交易，加上 23 個模組指令；發展卡相關指令停用。
7. **結束回合**：`beforeEndTurn: progressLimitVeto`。自己的進步卡超過 4 張時回 `E_PROGRESS_HAND_LIMIT`（`ck/progress.ts:145–149`），必須先打掉或用 `progress.discard` 棄掉。`hints.canEndTurn` 已經反映這個否決（`rules/engine.ts:2060–2095`）。
8. **計分**：2×大都市＋defender VP＋進步卡 VP＋商人 VP（`ck/index.ts:192`），目標 13 分。
9. **Paired（5–6 人）**：
   - P2 不擲骰、不做國內交易、沒有 Alchemy，但可以打進步卡，包括 Commercial Harbor（P3-4 是開放詮釋，`docs/FIDELITY.md:437–442`）。
   - P1 擲骰時，P2 若超過 4 張進步卡，要當場以非輪到玩家的身分棄牌（`docs/FIDELITY.md:454–458`）。

### 2d. `GameView.modules.citiesKnights` 與 `hints.modules.citiesKnights` 的完整形狀

型別層面目前只有 `GameView.modules?: Record<string, unknown>`（`rules/project.ts:100`）和 `ActionHints.modules?: Record<string, unknown>`（`rules/engine.ts:2056`）。模組 frame 的 data 一律是 `Record<string, unknown>`，沒有 `projectPending` 的話就是 `{}`（`rules/project.ts:187`）。

**View**（`projectCitiesKnights`，`ck/index.ts:212–246`）

```ts
{
  barbarian: { position: number; length: 7; attacks: number };
  barbarianStrength: number;           // 場上城市數
  defenderStrength: number;            // 已啟動騎士等級總和
  robberActive: boolean;               // attacks > 0
  knights: { player; vertex; level: 1|2|3; active; fresh /*本視窗剛啟動*/; promoted /*本視窗已升級*/ }[];
  walls: { vertex; player | null }[];
  metropolises: { science|trade|politics: { player; vertex } | null };
  toppled: number[];
  progressVp: { [playerId]: ProgressCardType[] };   // printing/constitution，公開
  progressCounts: { [playerId]: number };           // 進步卡手牌張數，公開
  decks: { science|trade|politics: number };        // 牌組剩餘張數
  commodityBank: Record<Commodity, number>;
  lastRoll: { event; red; atSeq; alchemy? } | null;
  lastAttack: { atSeq; barbarians; defenders; contributions; outcome; losers; defender; tied; pillaged[] } | null;
  handLimit: 4;
  merchant: { player; hex } | null;
  alchemy: { player; dice } | null;   // 只在當前視窗
  fleets: { player; kind }[];         // 只在當前視窗
  harbor: { player; offers: { [id]: number } } | null;  // 只在當前視窗
}
```

**PublicPlayerView 的相關欄位**（`rules/project.ts:18–44`）
- 所有人可見：`handSize`（含商品）、`improvements`、`cityWalls`、`defenders`、`bonusPoints`。
- 只有自己可見：`resources`、`commodities`、`progressCards`、`newProgressCards`。

**Hints**（`citiesKnightsHints`，`ck/index.ts:268–307`）

```ts
{
  recruitSites: number[];                         // 只在 action 內，且要有 level-1 存量
  knightSupply: { 1: n; 2: n; 3: n };
  knights: { vertex; level; active; canActivate; canPromote; canAct; moves[]; displace[]; chase }[]; // 自己的騎士，只在 action 內
  wallSites: number[];                            // 只在 action 內
  improvements: ImprovementOption[];              // 只在 action 內；{track, level, cost, commodity, metropolis, sites, blocked}（ck/cities.ts:101–111）
  commodityRates: Record<Commodity, number>;      // 4 / 3（通用港）/ 2（trade≥3 或 fleet/merchant）
  costs: { wall; knight; promote; activate };
  progressExcess: number;
  retreat: number[]; pillage: number[];           // 只給該 frame 的 responder
  defenderDecks: Track[]; scienceBonus: boolean;  // 只給 responders[0]
  progress: ProgressCardHint[];                   // {card, track, count, playable, reason: BlockReason|null, targets}（ck/cards.ts:56–83）
  harborTargets: string[];
  twoForOne: CardKind[];
}
```

`ProgressCardHint.targets` 依卡片不同，可能包含以下鍵：`players`、`vertices`、`hexes`、`edges`、`kinds`、`tracks[{track, level, cost, metropolis, sites}]`、`cost`。`BlockReason` 定義在 `ck/card-common.ts:22–30`。

`bankRates` 只涵蓋資源（`rules/engine.ts:1730–1735`）。商品匯率要讀 `hints.modules.citiesKnights.commodityRates`，它和 engine 的 `bankRateFor` 一致（`rules/engine.ts:1712–1720`）。

web 端已經自己寫了一份型別（`packages/web/src/board/citiesKnights.ts`），但其中 `lastRoll` 漏了 `alchemy`。這說明型別目前沒有單一來源。

初始 view＋hints 約 4.2 KB；強盜一開始在沙漠（hex 17），處於未啟動狀態（探查腳本 `peek-view.ts`）。

### 2e. 隱藏資訊與 B-FAIR 的影響

- **隱藏**：
  - 對手的資源／商品組成（只看得到 `handSize`）；
  - 對手手上進步卡的身分（只看得到 `progressCounts`）；
  - 三個牌組的順序（只看得到 `decks` 張數）；
  - RNG。
- **只有特定 viewer 看得到**：
  - Guild Dues 的 `hand`：只有行動者（`ck/cards-trade.ts:239–244`）；
  - Espionage 的 `cards`：只有行動者（`ck/cards-politics.ts:507–511`）；
  - Harbor 的 `resource`：只有交換雙方（`ck/cards-trade.ts:234–238`）。
- **已被接受的資訊洩漏**：Commercial Harbor 的事件，以及 frame 是否出現，會透露接收方持有幾種商品（`docs/FIDELITY.md:443–448`）。
- **B-FAIR 的影響**：
  1. `hideDifferently`（`packages/bots/test/fair.test.ts:21`）目前只交換對手資源、發展卡與牌組。C&K 版必須另外做到：
     - 在 `handSize` 不變的前提下變動對手的資源＋商品組成；
     - 把對手的進步卡和**同一牌組**的牌互換，讓 `progressCounts` 和 `decks` 都不變；
     - 反轉三個進步卡牌組的順序。
  2. 有三種狀態必須排除，不能當 B-FAIR 的比較樣本：行動者正在 Guild Dues／Espionage frame 中（行動者合法看得到對方手牌）、Harbor 交換剛結束時、以及 frame 是否出現本身就取決於商品組成的時候。
  3. **events 不一致**：server 傳給 Bot 的 view 含 `events: state.log.slice(-40)`（`packages/server/src/bot-driver.ts:68`、`:287`），但 harness 的 `viewFor` 不帶 events（`packages/bots/test/harness.ts:53`）。如果策略讀 `view.events` 來算牌，B-FAIR 和 B-POLICY 都測不到這部分。**建議 C&K 策略完全不讀 events**，只用 `lastRoll` 和 `lastAttack` 等公開投影。

### 2f. 交易

- **商品**：`COMMODITIES = paper/cloth/coin`，`CardKind = Resource | Commodity`（`rules/types.ts:12–13`、`:104–105`）。
- **銀行**：
  - 資源匯率走 `bankRate` hook：merchant 的資源和 fleet 指定的種類 2:1（`ck/index.ts:115–120`、`ck/merchant.ts:53`）；
  - 商品匯率是 4:1，有通用港時 3:1，trade≥3 時 2:1（`rules/engine.ts:1712–1720`）。
  - `trade.bank` 的給出和換入都可以是商品。
- **國內交易**：條件可以含商品（`rules/engine.ts:284–286`）。consent 時 engine 不檢查付不付得起（`rules/engine.ts:1873–1876`），要到 confirm 才檢查（`:1973–1978`）。
- **商人**：+1 VP，加上該格資源 2:1。商人被搶走或擺放規則見 `ck/merchant.ts:28–57`。
- **Commercial Harbor**：行動者在該回合可以向每位對手各提一次「資源換商品」（`ck/cards-trade.ts:27–107`）。

---

## 3. Base Bot 的缺口（對照 `bots/*.ts`）

| # | 缺口 | 位置 | 實際後果 |
|---|---|---|---|
| G1 | `pendingDuty` 對模組 frame 一律回 null（註解寫 "bots are only seated in base profiles"） | `bots/fallback.ts:41–43` | 探查中 8/10 局卡在 pillage，違反 I9 |
| G2 | heuristic 的 `pendingDecision` 預設也回 null | `bots/heuristic.ts:134–166` | 同上 |
| G3 | `handList` 只展開 `RESOURCES` | `bots/fallback.ts:47–57` | 含商品的 discard 張數不足，`E_INVALID_DISCARD_COUNT`，保底也被拒（2/10 局） |
| G4 | `discardDecision` 只在 `RESOURCES` 中挑，需要棄商品時回 null | `bots/heuristic.ts:169–192`（`:187`） | 交給保底後撞上 G3 |
| G5 | `Hand = Record<Resource>`，`handOf` 只讀 `resources` | `bots/economy.ts:28–31` | 經濟模型看不到商品 |
| G6 | `canAfford`／`deficitOf` 只看 `RESOURCES` | `bots/economy.ts:57–65` | 報價要求商品時，Bot 誤判自己付得起 |
| G7 | `handUtility`／`offerGain` 只看 `RESOURCES` | `bots/trade.ts:24–44` | 送出商品被當成零成本；Bot 可能同意「3 coin 換 1 wool」，或同意自己付不起的報價，導致人類玩家 confirm 時被拒（`rules/engine.ts:1976–1978`） |
| G8 | `economyOf` 的 plan 只有 city/settlement/devCard/longestRoad | `bots/economy.ts:92`、`:176–284` | 沒有 knight、wall、improve 的 plan |
| G9 | `isFreeSpot` 只看建築 | `bots/board.ts:96–100` | 騎士佔住的點也不能建（`ck/index.ts:126–128`），Bot 會選到被騎士擋住的點 |
| G10 | `searchRoads`／`routeLength` 只把對手建築當阻擋 | `bots/board.ts:154–258` | 對手騎士也會擋路、切斷最長路線（`vertexBlocker`，`ck/index.ts:122–124`） |
| G11 | `vertexYield`／`playerYield` 把城市一律算 2 倍 | `bots/board.ts:103–130` | 森林／牧場／山脈上的城市實際是 1 資源＋1 商品 |
| G12 | `setupDecision`／`setupSpotScore` 假設第 2 輪放 settlement | `bots/heuristic.ts:307–347` | 不知道第 2 輪是城市、會產商品 |
| G13 | `handRelief` 依賴 devDeck | `bots/heuristic.ts:602–625` | C&K 失去一個洩手牌的方式；可改成蓋 wall、啟動騎士 |
| G14 | 發展卡相關邏輯 | `bots/heuristic.ts:372–483`、`:560`、`bots/economy.ts:248` | `devCards` 為空、`devDeckSize = 0`，邏輯自然不觸發，無害 |
| G15 | `BotPolicy.decide` 的回傳型別是 `Command \| null` | `bots/types.ts:39` | 型別上無法回傳模組指令 |
| G16 | fallback 在 action 階段直接回 `turn.end` | `bots/fallback.ts`（`decide`） | 進步卡超過上限時被否決（`E_PROGRESS_HAND_LIMIT`），必須先 `progress.discard` |
| G17 | 測試 harness 只認 base | `packages/bots/test/harness.ts:29–31`（`profileFor`）、`:194–200`（`supplyTotal` 只算資源）、`packages/bots/test/policy.test.ts:18–25`（`RESPONSE_COMMANDS` 只有 base） | C&K 測不了 |
| G18 | driver 的 `THINK_MS` 沒有模組指令 | `packages/server/src/bot-driver.ts:40–64` | 模組指令一律 900 ms |

**實測佐證**（探查腳本 `base-bot-on-ck.ts`、`base-plus-duty.ts`）

- **base Bot 直接打 C&K**（standard、4 人、10 個種子）：
  - 8 局卡在 `citiesKnights.pillage`，發生在第 49–417 步；
  - 2 局卡在 `pending.discard:E_INVALID_DISCARD_COUNT`，保底也同樣被拒；
  - 沒有其他非法指令，發展卡邏輯沒有觸發。
- **base Bot＋最小 duty**：0 次拒絕，但因為沒人蓋騎士，每次攻擊每個人都失去城市，對局極長：
  - 4/6 局在 376–771 回合結束；
  - 2/6 局撞上 8000 步上限（約 1900 回合、136 次攻擊）。
  - 結論：**光補 duty 不夠，通不過 B-GAME**。

---

## 4. 需要的平台與規則支援

### 4a. 平台（共用平台由 Architect 設計；以下只是 C&K 的需求）

1. `BotPolicy.decide` 的回傳型別要能是 `Command | ModuleCommand | null`（`bots/types.ts:39`）。driver 送出時本來就接受 `{type: string} & Record<string, unknown>`（`packages/protocol/src/index.ts:299–303`）。
2. fallback 要有**模組 duty 掛鉤**：由模組提供「這個 frame 我欠什麼最小動作」，以及「結束回合前要先做什麼」（C&K 的情況是 `progress.discard`）。
3. `THINK_MS` 要加入模組指令類型（`packages/server/src/bot-driver.ts:40–64`）。
4. 單一視窗的指令上限 `MAX_BOT_COMMANDS_PER_WINDOW = 40`（`packages/server/src/bot-driver.ts:70`、`:303–312`）。超過時會強制改用保底，結果是直接結束回合：不會卡死，但會打亂策略。原型在 6 人時最多 32 個，打進步卡後可能更多。平台需要決定是讓模組調整上限，還是由策略自己限制。
5. 測試 harness：
   - `profileFor` 要依擴充給出 profile（C&K 3–4 人用 `ck-2025`，5–6 人用 `ck-paired-2025`）；
   - `supplyTotal` 要加入商品，進步卡另做守恆檢查：牌組＋手牌＋`progressVp` = 54；
   - B-POLICY 的回應指令集合要加入 C&K 的 13 個 pending 指令。可以直接用 `moduleCommandTypes`（`rules/modules/index.ts:6`），或模組的 `pendingCommands`。
6. B-FAIR 要能讓模組提供自己的 `hideDifferently` 變體（見 §2e）。

### 4b. Rules 匯出（I3 檢核）

`@catan/rules` 的 package exports 只有 `"."`（`packages/rules/package.json`），Bot 不能 deep import。E&P 已經有先例：view 型別和常數都從 index 匯出（`rules/index.ts:12–14`）。C&K 需要匯出：

- **型別**：
  - `export type CitiesKnightsView = ReturnType<typeof projectCitiesKnights>`
  - `export type CitiesKnightsHints = ReturnType<typeof citiesKnightsHints>`
  - `ImprovementOption`、`ProgressCardHint`、`BlockReason`、`Track`、`KnightLevel`
  - 各 frame data 的型別：建議 rules 端給每種 kind 一個 data 型別，或至少匯出 frame kind 常數。
- **常數**：
  - `TRACKS`、`TRACK_COMMODITY`、`ABILITY_LEVEL`、`METROPOLIS_LEVEL`、`MAX_LEVEL`
  - `EVENT_FACES`、`drawThreshold`、`BARBARIAN_TRACK_LENGTH`、`PROGRESS_HAND_LIMIT`、`PROGRESS_DECKS`
  - `MEDICINE_COST`、`FIXED_DISCS`
  - 各 frame kind 常數
  - 已經匯出的：`COMMODITIES`、`CARD_KINDS`、`TERRAIN_COMMODITY`、`ProgressCardType`（經由 `rules/types.ts`）。

**I3 判定**：只加 `export` 不改任何規則、GameState、事件或錯誤碼，符合 I3（`docs/aegis/specs/2026-11-01-bot-opponents.md:42`）。`ck/constants.ts` 只 import 型別，匯出它不會帶進副作用。退而求其次的做法是在 bots 端複製一份常數，但會有漂移風險，需要靠測試釘住。

### 4c. Hint 缺口（都不是硬缺口）

- 成本不在 hints 裡檢查：`canActivate`、`recruitSites`、`wallSites`、`improvements` 的 `cost` 只標出值，不保證付得起。Bot 要自己比對手牌，做得到。
- 騎士、城牆、改良的 hints 只在自己的 action 內出現（`ck/index.ts:273–292`）。preroll 時要做規劃，得改用 view 中的 `knights` 和 `walls` 自己推導，做得到。
- 沒有「目標價值」的資訊，例如 Invention 換哪兩格最好。這是策略的工作，不是資訊缺口。
- 拿不到、也不該拿的：對手手牌組成、牌組順序。

---

## 5. standard／easy 策略草案

標記說明：〔啟發〕＝依規則推導的策略判斷；〔推測〕＝還沒經過量測驗證。

### 5.1 可重用的部分

- `board.ts`：拓撲、點數、`searchRoads`、`routeLength`。需要：
  - 把騎士納入阻擋判斷（G9、G10）：`isFreeSpot` 加上 `!knightAt`，搜尋路線時把對手騎士當阻擋；
  - 把城市產出改成 C&K 版（G11）：`vertexYield` 回傳 `Yield & Partial<Record<Commodity, number>>`。
- `economy.ts`：`Hand` 改成 `Record<CardKind>`。plan 增加：
  - `improve`：成本是 n 張商品；
  - `knight`：wool＋ore；
  - `activate`：grain；
  - `wall`：2 brick；
  - `metropolis`：屬於 improve 的特例。
  `etaRounds` 和 `weights` 擴充到 `CardKind`。
- `trade.ts`：
  - `bankTradeToward` 改用 `bankRates` 加 `commodityRates`，商品可以當換牌貨幣；
  - `handUtility`、`offerGain` 涵蓋商品，修掉 G6、G7。
- `order.ts`、`seed.ts`：不用改。

### 5.2 各決策視窗

**A. Setup**
- 第 1 輪 settlement：沿用 `setupSpotScore`，偏好資源多樣。
- 第 2 輪**城市**〔啟發〕：
  - 優先選高點數、而且相鄰森林／牧場／山脈的點，這樣能產商品；
  - 至少要有 ore 或 grain 其中之一，因為騎士和啟動都要用；
  - 起始配給是每格 1 張資源（`docs/FIDELITY.md:118`）。

**B. Preroll（Alchemy）**〔啟發〕
- 窮舉 36 種骰面組合，評分 = 自己的期望產量 − 領先者的產量。
- 避開 7：除非強盜已啟動、自己沒超過棄牌上限、而且有值得偷的目標。
- 另外考量紅骰與抽卡的關係：紅骰 ≤ 等級＋1 才能抽卡（`ck/constants.ts` 的 `drawThreshold`），所以紅骰值愈小，事件骰擲到城門時抽到的機會愈大。
- 只有最佳組合比平均擲骰多 2 張以上時才打。easy 不打 Alchemy。

**C. 蠻族防禦估值**〔啟發〕
- **攻擊時程**：每次擲骰有 1/2 機率擲到船（`ck/constants.ts:69`），所以距離攻擊的期望擲骰數 ≈ 2×(7 − position)。
- **風險判斷**：
  - 設 B = `barbarianStrength`、D = `defenderStrength`，「我的貢獻」= 自己已啟動騎士的等級總和。
  - 如果 B > D，而且我屬於「有可掠奪城市者當中貢獻最低」的那一群，我就會失去一座城市：損失 1 VP、產量、以及那座城市的城牆。
- **standard**：當 `7 − position ≤ 2`，而且自己有可掠奪的城市時：
  1. 先啟動既有騎士（1 grain，最便宜）；
  2. 再招募（wool＋ore），目標是讓自己的貢獻高於其他人的最低值，或讓 D ≥ B；
  3. 已經安全、而且花 1–2 個動作就能成為唯一最高貢獻者時，把 defender VP 當成約 1 VP 計入。
  - 騎士移動、擠人、追強盜之後會變回未啟動（`ck/knights.ts:251`、`:275`、`:321`），攻擊前要保留啟動狀態。
- **easy**：只在 `position ≥ 6` 時反應，而且只求不落入最低的那一群；不追 defender VP。注意 easy 也必須會防禦，否則對局過長（§3 的 duty-only 實測：376–771 回合，部分撞到 8000 步上限）。
- **只有大都市、沒有其他城市的玩家**不會被掠奪，可以降低防禦優先權。

**D. 改良路線**〔啟發〕
- 第 n 級要花 n 張該軌道的商品（`ck/cities.ts:113–128`）。
- 3 級能力（`ck/constants.ts:25`）：
  - science：aqueduct，沒拿到牌時可以領 1 張；
  - trade：商品 2:1；
  - politics：可以升出 3 級騎士。
- 4 級拿下大都市（+2 VP，且免疫掠奪）；5 級可以從 4 級持有者手上搶走大都市（`ck/cities.ts:91–111`）。
- 抽卡機率：每次擲骰 = 1/6 ×（L＋1）/6，L 是該軌道等級。
- **standard** 主軌道評分 =
  - 自己該商品的產出點數
  - ＋ 能力價值
  - ＋ 大都市期望值（看對手公開的 `improvements`；落後 2 級以上就降權）
  - ＋ 抽卡率。
  其他軌道只升到 1–3 級，用來提高抽卡率或取得能力。
- **easy**：`topK 3` 隨機選擇，只看自己商品最多的軌道。

**E. Action 的順序**（原型已驗證可行；PR-B 要細化）
1. 進步卡超過上限：先打出可打的卡，不夠再棄卡，避免 `turn.end` 被否決。
2. 攻擊逼近時的防禦（C）。
3. 改良（D）、大都市競爭。
4. 建造：城市、settlement、道路；城牆在手牌常常超過 7 張時才蓋。
5. 騎士戰術：
   - 追走自己格子上的強盜；
   - 擠走擋路的弱騎士；
   - 移動騎士封鎖對手的建地或道路〔推測：價值中等，可延後到 PR-C〕。
6. 打進步卡（F）。
7. 交易：銀行換牌（含商品）、國內報價（沿用既有上限 2 次，`bots/trade.ts`）。
8. `turn.end`。

原型 `proto.ts` 的 `ckAction` 只做了 3、2、追強盜、商品對商品換牌，3–6 人就全部完成對局。

**F. 進步卡什麼時候打**（standard；easy 只打 F1 的卡，或延後打）

F1 不需要互動、PR-B 先做的卡：

| 卡 | 觸發條件〔啟發〕 |
|---|---|
| irrigation／mining | 目標格子 ≥ 1 就打（每格 2 張） |
| merchant | 盡早打（+1 VP）；放在最缺的資源格，`targets.hexes` |
| merchantFleet | 選本回合能換 1 次以上的多餘牌種 |
| resourceMonopoly | 選對手公開產量最高、而且自己需要的資源 |
| tradeMonopoly | 選主軌道的商品 |
| medicine | 付得起，而且有可升級的點時，代替 `build.city` |
| crane | 改良只差 1 張商品，或差 1 級就拿到大都市 |
| engineering | 手牌常常超過上限，或攻擊逼近 |
| smithing | 有可升級騎士，且攻擊逼近或需要擠人 |
| encouragement | 攻擊逼近，且有 2 隻以上未啟動騎士 |
| roadBuilding | `usefulRoad` 有值 |

F2 需要互動、PR-C 才做的卡：

| 卡 | 觸發條件〔啟發〕 |
|---|---|
| alchemy | 見 B |
| invention | 自己低點數格 ↔ 對手高點數格，點數差 ≥ 2 |
| commercialHarbor | 改良卡在缺商品，且有多餘的資源 |
| guildDues | 目標選領先者；拿走最需要的牌 |
| espionage | 目標選 `progressCounts` 最多的領先者 |
| intrigue | 擠走擋路的騎士 |
| sabotage／wedding | 有手牌 4 張以上（或分數較高）的目標 |
| taxation | 強盜已啟動，且有相鄰 2 位以上有牌對手的格子 |
| treason | 領先者的高等級騎士 |
| diplomacy | 拆掉領先者最長路線端點的開放道路 |

**G. 回應 frame**（standard；easy 用 topK 隨機）

| frame | 選擇 |
|---|---|
| `discard` | 保留最優先 plan 需要的牌（含商品），棄多餘的 |
| `pillage` | 產值加城牆價值最低的城市 |
| `displaced` | 退到最靠近自己道路、或能擋人的點 |
| `defenderDraw` | 主軌道的牌組 |
| `progressDiscard` | 依卡片價值表棄掉最低的 |
| `scienceBonus` | 最需要的資源（不選 null） |
| `harborExchange` | 交出最不需要的商品 |
| `guildDues` | 拿最需要的牌 |
| `espionage` | 依價值表拿最高的 |
| `sabotage`／`wedding` | 交出或棄掉價值最低的牌 |
| `treasonRemove` | 交出最弱或未啟動的騎士 |
| `treasonPlace` | 最有阻擋價值的點，選允許的最高等級；沒有點時選 null |
| `diplomacyRoad` | 最能延伸路線的邊；沒用時選 null |

---

## 6. 保底：每種 frame 與強制動作的必定合法最小動作

已實測驗證：探查腳本 `ck-duty.ts`＋`fallback-frames.ts` 讓 ck-sim 照常打所有卡，所有 frame 只用投影來回答。

| 情境 | 最小動作 | 為什麼必定合法 |
|---|---|---|
| `discard` | `pending.discard` 交出 `cardList(資源+商品)` 的前 `required` 張 | `submitDiscard` 接受 CardKind |
| `moveRobber` | 沿用 base（第一個非現位置的陸地格） | — |
| `steal` | 沿用 base（`candidates[0]`） | — |
| `freeRoads` | 沿用 base（`legalRoads[0]`） | `bots/ck-road-building.test.ts` 已驗證 |
| `pillage` | `data.cities[self][0]` | 只有 2 座以上城市時才會出 frame |
| `displaced` | `knight.retreat {options[0]}` | 沒有退路時不出 frame，騎士直接移除 |
| `defenderDraw` | 只有 responders[0] 回應，選 `data.decks[0]` | 空牌組會被 `skipEmptyDecks` 跳過（`ck/barbarians.ts:122`） |
| `progressDiscard` | `progressCards` 的前 `required` 張 | — |
| `scienceBonus` | 只有 responders[0] 回應，`science.take {resource: null}` | null 一定合法 |
| `harborExchange` | 手上第一種商品 | 接收方持有 2 種以上才會出 frame |
| `guildDues` | `data.hand` 展開後的前 `count` 張 | — |
| `espionage` | `{card: null}` | — |
| `sabotage`／`wedding` | `cardList` 的前 `required[self]` 張 | — |
| `treasonRemove` | `data.knights[0]` | — |
| `treasonPlace` | `{vertex: null, level: null}` | 已實測被接受 |
| `diplomacyRoad` | `{edge: null}` | — |
| `resolveRoll` | 沒有動作 | responders 為空 |
| 自己 action、`progressExcess > 0` | `progress.discard` 交出 `progressCards` 的前 excess 張，然後才 `turn.end` | 繞過 `E_PROGRESS_HAND_LIMIT` |
| preroll／setup／action 結束 | 沿用 base 的 `turn.roll`、setup 選點、`turn.end` | — |

**實測結果**：

- 7 局（4p seed 42、5p seed 52、5p seed 53、4p seed 1、4p seed 2、6p seed 17、3p seed 14）全部完成，**0 次拒絕**。
- 回答次數：

  | frame | 次數 |
  |---|---|
  | scienceBonus | 128 |
  | discard | 73 |
  | sabotage | 25 |
  | defenderDraw | 16 |
  | treasonRemove | 13 |
  | guildDues | 11 |
  | espionage | 11 |
  | treasonPlace | 10 |
  | harborExchange | 10 |
  | progressDiscard | 8 |
  | wedding | 6 |
  | displaced | 4 |
  | diplomacyRoad | 4 |
  | pillage | 1 |

  pillage 次數少，是因為 ck-sim 本身會蓋騎士；在 base＋duty 的實驗中，pillage 被大量回答，同樣是 0 次拒絕。

**注意事項**

- 有先後順序的 frame（`defenderDraw`、`scienceBonus`）只能由 responders[0] 回答，其他 responder 要回 null 等待。
- `knight.retreat` 沒有 null 選項。
- 保底本身不蓋騎士，所以「全部都是保底席位」的對局在步數上限內不會結束。B-POLICY 的混席配置至少要有一個策略席位（見 §7）。

---

## 7. 測試與驗收

### 7.1 案例

**B-POLICY**
- `ck-2025` 3 人、4 人，`ck-paired-2025` 5 人、6 人，各 10 個種子以上，standard／easy／fallback 混席，每桌至少一個策略席位。要求每個 `decide` 的輸出都被 `applyCommand` 接受。
- 決定性：同一 view＋context 得到同一指令，要涵蓋模組 frame。
- 契約檢查：
  - 非行動者只能送出回應指令（base 6 個加上 C&K 13 個 pending 指令）；
  - paired 的 P2 不發 `trade.offer`、不打 alchemy；`progress.harborOffer` 依 P3-4 允許。
- 每種 frame 一個單元情境，共 14 種加上含商品的 discard：用 ck-sim 或腳本建出狀態，驗證回答合法，並且符合 §5G 的偏好。

**B-GAME**
- 每種人數至少 10 個種子（`docs/aegis/specs/2026-11-01-bot-opponents.md:258`）。
- 必須分出勝者、沒有卡住的 pending。
- 守恆檢查：
  - 資源：bank＋手牌；
  - 商品：`commodityBank`＋手牌 = 36 或 54；
  - 進步卡：三個牌組＋手牌＋`progressVp` = 54（打出的卡回到牌組底部，`ck/card-common.ts:51`）。
- 步數上限建議 6000，約為原型平均的 5 倍〔推測〕。

**B-FAIR**
- 依 §2e 擴充 `hideDifferently`。
- 門檻沿用 base：超過 40 個狀態、超過 100 次比較。
- 排除合法看得到手牌的那幾種 frame。

**B-BENCH**（不進 CI）
- 勝率：standard 對 easy、對 fallback；
- 平均回合數、平均指令數；
- 單一視窗最大指令數（對照上限 40）；
- 攻擊勝負次數、每個 Bot 被掠奪的城市數、defender VP；
- 大都市數、各軌道最終等級；
- 進步卡：依卡種統計抽到、打出、棄掉的次數；
- `decide` 耗時：平均、p99、最大；
- 保底代答次數：standard 應為 0。

### 7.2 量測（皆在負載下）

**ck-sim 精確步數**（以二分搜尋 `maxSteps` 求得；ck-sim 是試錯型腳本玩家，會讀 GameState）

| 人數 | 步數 | 回合數 | 時間 |
|---|---|---|---|
| 3 | 496 | 158 | 1959 ms |
| 4 | 652 | 190 | 1364 ms |
| 5 | 1017 | 198 | 22912 ms（負載尖峰；先前一次 3.5 s） |
| 6 | 1245 | 208 | 3461 ms |

- 10 組案例：seq 1111–2495、攻擊 9–15 次、打出 15–125 張進步卡、card frame 2–42 個，每局 1.1–4.2 s。
- `packages/rules` 的 ck-sim 測試檔：6 個測試通過，Duration 46.99 s（real 55.4 s）。

**原型**（只有核心，不打進步卡；0 次拒絕，每局都完成）

| 人數 | 平均步數 | 平均輪數 | 單一視窗最大指令數 | 每局約 |
|---|---|---|---|---|
| 3 | 633 | 37.5 | 18 | 970 ms |
| 4 | 836 | 33.4 | 23 | 1016 ms |
| 5 | 1071 | 23.8 | 26 | 1167 ms |
| 6 | 1160 | 21.1 | 32 | 1172 ms |

**base 對照**（4 人，10 局）
- 平均 17.1–20.5 輪、300–353 個指令；
- decide 平均 0.063–0.536 ms，最大值有 21–447 ms 的尖峰（負載造成）；
- 每 10 局 4–28.5 s。

**單次成本**
- `projectGame`＋hints：base 0.097 ms、C&K 0.149 ms；
- decide：0.09–0.11 ms。

**現有 bots 測試**：8 個檔案、48 個測試，Duration 30.19 s（real 32.6 s）。

### 7.3 CI 時間估計〔推測〕

- C&K 的 B-GAME 加 B-POLICY 共 40 局，每局約 1.0–1.2 s，約 40–50 s；
- 加上逐步契約檢查和打進步卡的成本，大約 ×1.5，即 60–75 s；
- B-FAIR 約 10–20 s；
- 合計 bots 測試時間約從 30 s 增加到 100–125 s（負載下）。
- 如果太慢，CI 每種人數只跑 10 個種子，更多種子留給 bench。

---

## 8. 切片與工作量

| PR | 內容 | 檔案範圍 | 大小 | 約行數 | 依賴 |
|---|---|---|---|---|---|
| PR-0（平台；可能由 Architect 負責） | 放寬 `decide` 回傳型別；fallback 模組 duty 掛鉤；`THINK_MS` 模組鍵；harness 依 profile 建局、守恆檢查可由模組擴充；`RESPONSE_COMMANDS` 由 registry 提供 | `bots/types.ts`、`bots/fallback.ts`、`packages/server/src/bot-driver.ts`、`packages/bots/test/harness.ts`、`policy.test.ts` | S–M | 150 | 無 |
| PR-A | rules 匯出 C&K 型別與常數（I3 安全） | `rules/index.ts`、`ck/index.ts`（只加 `export type`） | S | 30 | 無；可以併進 PR-B |
| **PR-B（MVP，打開 gating）** | `bots/src/citiesKnights/`：view 存取器、duty（14 種 frame）、CardKind 手牌與商品估值、knight/wall/improve plan、`board.ts` 加騎士阻擋與 C&K 產出、setup 城市、蠻族防禦、action 整合、F1 類卡片（約 12 種）；`support.ts` 加 `'citiesKnights'`；修正 G6/G7 | `bots/*`、`packages/bots/test/*` | L | 正式碼 1100–1300＋測試 600–800 | PR-0、PR-A |
| PR-C | F2 類互動卡（11 種）、回應品質、Alchemy 與 Invention 窮舉、騎士封鎖戰術 | `bots/citiesKnights/cards*.ts`、測試 | M–L | 正式碼 500＋測試 400 | PR-B |

**估算依據**
- base 的 `heuristic.ts` 是 625 行，`economy`、`board`、`trade` 合計約 900 行。C&K 新增的決策面大約是 base 的 1.5 倍：23 個指令、14 種 frame、23 種卡。
- duty 的骨架已經用約 80 行的探查腳本驗證過；核心原型 `ckAction` 約 60 行就能讓對局完成。
- 測試量參考 base 的 policy/fair/harness 測試加上 14 個 frame 情境。

**為什麼 PR-B 不能再切出「只有 duty」的版本**：只補 duty 的話，對局長達 376–771 回合，還會撞到 8000 步上限，通不過 B-GAME，所以不能只靠它打開 gating。

**方案比較**

| | 方案 1：同一版 0.4.1 出兩個 PR（核心＋全部卡） | 方案 2：只打部分卡、其餘只回應 |
|---|---|---|
| 是否符合 R-BOT | 是 | 是：Bot 會發出模組指令，包括部分 `progress.play`，並回應所有 frame。人類打出的互動卡也都有回應 |
| 強度 | 完整 | 較弱：互動卡只會被棄掉。但 F1 已涵蓋 VP、資源、改良，屬於高價值的那一半〔推測〕 |
| 風險 | PR-C 可能讓整個版本延期 | 低 |

**建議**：以方案 1 為目標，方案 2 當退路。PR-B 本身就滿足 gating，合併後就能打開；PR-C 在同一個 minor 補上。如果 PR-C 來不及，0.4.1 先出 PR-B，PR-C 移到 patch 版。

**對後續擴充的重用**
- SF+CK：重用整個 C&K Bot 元件，再加 `knight.chasePirate` 和船的阻擋，重用度高。
- T&B 的蠻族攻擊：騎士在邊上、靠卡片放置（`packages/rules/src/modules/tradersBarbarians/barbarians/index.ts:28–49`、`196–244`），只能重用「防禦估值」的概念。

---

## 9. 風險與要請使用者決定的問題

**風險**

1. **單一視窗指令上限 40**：6 人原型已到 32，打進步卡後可能超過。超過時會強制改用保底結束回合（`packages/server/src/bot-driver.ts:303–312`）。不會卡死，但策略會被截斷。
2. **節奏**：模組指令預設 900 ms。一個 Bot 回合如果有 10–30 個指令，就是 9–27 秒〔推測〕。需要訂 `THINK_MS`，並讓策略合併動作。
3. **對局長度**：C&K 一局 21–38 輪，base 約 17–20 輪。人類同桌時的總時長會明顯變長。
4. **events 與 harness 不一致**（§2e）：建議在規範中寫明「策略不讀 `view.events`」。
5. **easy 也必須防禦**，否則對局無法在步數上限內結束（§3 的實測）。
6. **人類對 Bot 的商品報價**：目前 Bot 會同意自己付不起的報價（G6、G7），PR-B 必須修正。在 gating 打開之前這個情境不會發生。

**請使用者決定**

1. **rules 匯出**：只新增 C&K 型別與常數的 `export`，是否接受視為符合 I3？若不接受，bots 端要複製一份常數並靠測試釘住。
2. **防禦取向**：standard 只求自己不落入最低的那群（個人理性），還是要協助集體防守？集體防守也會讓對手免於損失。
3. **P3-4**：paired 的 P2 打 Commercial Harbor。目前 Bot 照 engine 允許的方式做；如果詮釋改了，Bot 會跟著 hints 自動調整。這樣可以嗎？
4. **版本安排**：0.4.1 一定要包含 PR-C，還是接受方案 2 的退路？C&K 是不是第一個做 Bot 的擴充？若是，SF+CK 可以緊接在 SF Bot 之後。
5. **CI 預算**：bots 測試從約 30 s 增加到約 100–125 s（負載下估計），能否接受？或者要把部分種子移到 bench。
6. **難度差異**：easy 是否完全不打互動型進步卡？SPEC 規定難度只影響策略品質，不影響資訊存取（`docs/SPEC.md:189`），兩種做法都合規。
