# Cities & Knights 電腦對手：實作計畫（v0.4.2）

日期：2026-11-04；2026-11-11 刷新（§12）。狀態：**已確認，2026-11-11 依 `3664868` 刷新；§10 的 D-CK1–D-CK8 已採用建議。**

前置閱讀：整體策略 `docs/aegis/plans/2026-11-04-expansion-bots-roadmap.md`（以下簡稱「整體策略」）；bot 規格 `docs/aegis/specs/2026-11-01-bot-opponents.md`（I1–I9、§5 合約）；`docs/SPEC.md` §4.9；`docs/FIDELITY.md` 的 C&K 段落 `:41-42`、`:121-128`、`:390-513`；`packages/rules/src/modules/README.md`。

證據：第一輪 C&K 報告收錄在 `docs/aegis/work/2026-11-04-bots-cities-knights-research.md`；本輪探查 `plan-probe.ts` 放在 `/tmp/katan-bot-research/cities-knights/`，不提交；探查基準 `a200840`。2026-11-11 依 `3664868`（`release/v0.4.2` 的起點，與 `a200840` 相隔 46 個 commit）刷新：行號與引用一律以 `3664868` 為準，並依 0.4.1 的實際介面調整 §2.1、§3、§4.1–§4.9、§5、§6、§7.1、§8（清單見 §12）。本輪約 210 局，load average 1.8–4.5；耗時只是參考值，結論只依步數、局數、拒絕數與機制計數。數據出自**天真原型**（base 策略＋C&K duty＋改良＋騎士防禦＋「能打就打」的進步卡），用來估計門檻量級，不是提案程式碼。

路徑縮寫：`ck/` = `packages/rules/src/modules/citiesKnights/`；`sfck/` = `packages/rules/src/modules/seafarersCitiesKnights/`；`bots/` = `packages/bots/src/`；`engine.ts` = `packages/rules/src/engine.ts`。

**要點**

1. **切片**：CK-A（rules 匯出）→ CK-B1（定稿並接上 0.4.2 的六個 economy 鉤子、commodity 經濟、14 種 frame 的保底；第 0.5 步是它的第一個 commit）→ CK-B2（核心策略）→ CK-G（開放 gating）。CK-C（互動進度卡）可與 CK-G 並行，也可以延到 0.4.3。
2. **修正第一輪的三點**（§2.3）：「6 人單一視窗 32 個指令」是全桌合計，逐 Bot 最多 16 個，不必提高上限；只補 duty 無法終局的主因是不改良；進步卡超過上限時保底會無聲停住，而不是被否決（0.4.1 骨架在 action 階段先問模組 `duty`，C&K 的 `duty` 處理 `progressExcess` 即可解除）。
3. **Q2 門檻**（§6.2）以原型實測為依據；推測的部分另外標明。
4. **刷新結論**（§12）：§2.1 的前提成立，沒有阻擋開工的問題。六個 economy 鉤子在 0.4.1 只保留型別，第 0.5 步改為定稿簽章（`hexYield` 加 `city`）；骨架另有幾處只認 5 種資源，列入 CK-B1 的檔案所有權（§4.5、§4.6、§5）。

## 1. 目標與範圍

| profile | 人數 | `ruleModules` | 規則版本 | VP | 來源 |
|---|---|---|---|---|---|
| `ck-2025` | 3–4 | `['citiesKnights']` | `ck-2025.1` | 13 | `packages/rules/src/profiles.ts:428-440` |
| `ck-paired-2025` | 5–6 | 同上 | 同上 | 13 | `packages/rules/src/profiles.ts:442-459` |

- **目標**
  - 兩個 profile 在每種人數都能加入 `easy` 與 `standard`。0.4.2 發布時通過 Q1 與 Q2（整體策略 §3.1、§6）。
  - 兩種難度都會發出 C&K 指令（騎士、改良、進步卡），並能回應全部 14 種模組 frame，以及含 commodity 的棄牌。
- **非目標**
  - SF+CK 排在 0.4.3。本版只保留掛點（§4.9），`sf-ck-*` 的 `botSeats` 必須維持 false（`packages/server/test/seafarers-cities-knights.test.ts:152`）。C&K 的 `supports` 不必額外排除含 `seafarers` 的 profile：sf-ck 的 `seafarersCitiesKnights` 沒有註冊，`botsCanPlay` 必為 false（E-10；`packages/bots/test/support.test.ts:61-68` 守住）。
  - Bot 不主動提出含 commodity 的國內報價，只估值與回應（比照整體策略 D6）。
  - 不讀 `view.events`，不新增 hints，不改 rules 的規則行為（P4、P8）。
  - 互動型進步卡（F2，共 10 種）與 Alchemy 放在 CK-C；延誤時移到 0.4.3（§7.3）。

## 2. 現況與落差

### 2.1 依賴的 0.4.1 平台交付（整體策略 §4.9–4.10）

| 0.4.1 交付 | C&K 的用途 |
|---|---|
| `BotCommand`；`Decision.command`（PL-1、PL-3） | 送出 23 個模組指令 |
| registry（`bots/modules/registry.ts:11`）、`botsCanPlay` 加上 `supports`、可玩清單快照（PL-1） | 開放 `ck-*`；SF+CK 仍然關閉 |
| 組合骨架（PL-1）：`answerFrame`、`duty`、`setup`、`planStep` 依序詢問；`actions`、`preroll` 串接評分 | 處理 frame、行動候選、第 2 輪城市、Alchemy 與模組計畫的下一步 |
| fallback 順序（PL-1）：見下方「骨架語意」 | 14 種 frame 與 `progressExcess` 的保底 |
| 合約規則 3、4、8、9 與 I3 改寫（PL-1） | 非行動者回應 frame；拒絕無法估值的報價 |
| harness（PL-2）：`newBotGame({ profileId })`（`test/harness.ts:116`）、`BOT_TEST_MATRIX`、`GENERIC_MATRIX`（`:152`、`:160`）、`test/modules/<id>.ts`（`test/modules/types.ts:41-71`）、仿 BotDriver 模式、看門狗、`seedsFor`／`BOTS_SEEDS`（`:175-187`）、`GAME_TIMEOUT` 120 s（`:59`）、`PROFILE_LIMITS`（`:222-226`）、family 登記（`test/families.ts:42-54`） | Q1 與 Q2 |
| bench（PL-2）：`--profile`；輸出拒絕數（`rejections`）、保底次數（`fallback/game`）、機制表、每視窗指令數（`max cmds/window`，只有最大值）；`RULES_SIM_ROUNDS`（`bench/run.ts:51`、`:59-62`、`:65-80`、`:226-249`） | Q3 |
| server 端（PL-3）：`BOT_PACING` 與 base 的 `THINK_MS` 合併成全域的 `PACING_MS`，不分 profile（`bot-driver.ts:48-73`）；每視窗上限依 profile 計算（`commandLimit`，`:83`、`:446-450`；`bots/support.ts:35-44`）；「欠動作卻沒有動作」的診斷 | 套用 `pacing`；上限維持 40 |
| golden replay（PL-1）：`test/golden-base.test.ts` 比對 `test/golden/base-v040.json`，凍結的 driver 在 `test/golden/driver.ts`；共 48 局：B-GAME 40、保底席 3、wrapped 1、全保底 4；通用測試另以 `goldenIdsFor` 比對（`harness.ts:776-815`） | 證明 CK-B1 沒有改變 base 行為 |

- **前提已核實成立**：組合骨架只依 registry 查模組，`supports` 只出現在 `botsCanPlay`（`bots/heuristic.ts:52-54`、`bots/fallback.ts:57-62`、`bots/support.ts:17-22`、`bots/modules/types.ts:100`）。CK-B1 一註冊，策略與保底就會自動取用 C&K 模組，不需要測試專用的 registry 覆寫；SF-3 也是這樣在 gating 開放前跑 B-GAME。
- **骨架語意**（`bots/heuristic.ts`、`bots/fallback.ts`）
  - `answerFrame` 只以 `responders.includes(self)` 過濾；依序作答的 frame 由模組自己檢查 `responders[0]`（`heuristic.ts:70-74`）。
  - `preroll`：base 先決定是否打騎士，不打時才 pick 模組候選（`heuristic.ts:226-230`）。
  - `actions`：和 base 的立即得分建造一起經 `dedupeCandidates` 後 pick，非空時會搶在計畫步驟之前（`heuristic.ts:393-396`）。
  - `planStep`：只有模組計畫種類會走到（`heuristic.ts:477-479`；`bots/modules/types.ts:109-120`）。
  - fallback：pending 與 setup 先跑 base（`pendingDuty`、`setupDuty`），回 null 才問模組 `duty`；preroll 與 action 先問模組 `duty`，回 undefined 才送 `turn.roll`／`turn.end`；模組 frame 只有 `responders[0] === self` 時才回應，也只在這時詢問 `duty`（`fallback.ts:27-54`、`bots/base/duty.ts:7-45`）。`pendingDuty` 拿不到模組清單與 `BoardModel`，所以不套用 `cardKinds`（§4.6）。

### 2.2 第一輪落差 G1–G18 的歸屬

| 落差 | 內容 | 解決位置 |
|---|---|---|
| G1、G2、G15 | 模組 frame 回 null；`decide` 的回傳型別 | 0.4.1 骨架；CK-B1 `duty` |
| G3–G7 | 手牌只有 5 種資源；含 commodity 的棄牌；報價估值 | CK-B1（§4.5、§4.6） |
| G8、G13 | plan 只有 4 種；`handRelief` 依賴發展卡牌庫 | CK-B2（`scoreExtras` 提供 improve、knight、activate、wall，由 `planStep` 執行；以城牆、啟動騎士、commodity 換牌消化手牌） |
| G9–G11 | 騎士阻擋；城市產出 | CK-B1 的 board 掛點（§4.6） |
| G12 | 第 2 輪放的是城市 | CK-B2 `setup` |
| G14 | 發展卡邏輯 | 不改：C&K 的 `devDeck: []`（`profiles.ts:435`），`devDeckSize = 0` 時不會觸發（`bots/economy.ts:338`；`bots/heuristic.ts:414`、`:476`、`:489`） |
| G16 | 進步卡超過上限 | CK-B1 `duty`（見 §2.3 C3） |
| G17、G18 | harness 只認 base；`THINK_MS` 缺模組指令 | 已由 0.4.1 PL-2、PL-3 解決；C&K 只需要提供模組測試工具（kit）、`pacing`、family 登記與 `PROFILE_LIMITS`（§5） |

### 2.3 本輪核實後修正的結論

| # | 第一輪說法 | 核實結果 | 證據 |
|---|---|---|---|
| C1 | 6 人單一視窗最多 32 個指令，接近上限 40 | 32 是全桌合計：原型只在 `windowId` 改變時歸零，沒有分座位。BotDriver 的上限是逐 Bot 計算。逐 Bot 實測 p95 為 5–7，最大 10–16 | `proto.ts` 的計數；`packages/server/src/bot-driver.ts:367`（換視窗時歸零）、`:370`（取上限）、`:392`（逐 Bot 判斷）；`plan-probe.ts` 3–6 人全部組合 |
| C2 | 只補 duty 不夠，因為沒人蓋騎士 | 主因是不改良：完全不防禦、但會改良的原型 54 局中有 53 局終局，13–89 輪。不防禦仍有長尾：6 人 seed 8 跑滿 15000 步，共 240 輪、失守 101 次 | `plan-probe.ts <n> 6/8 {f1,none} none` |
| C3 | 進步卡超過上限時，fallback 送出 `turn.end` 被否決 | `hints.canEndTurn` 已反映否決，所以 fallback 與 heuristic 都回 null，整桌無聲停住（G-A），不是被拒。0.4.1 骨架在 action 階段先問模組 `duty`，所以只要 C&K 的 `duty` 處理 `progressExcess`，就不會停住 | `bots/fallback.ts:46-50`、`bots/heuristic.ts:302`、`engine.ts:2130`、`ck/progress.ts:145-148` |
| C4 | hints 的 targets 就是合法目標 | 單一目標合法，組合不一定合法。Smithing 依序檢查兩隻騎士，第一隻可能用掉最後一個高一級的騎士棋子，第二隻就會 `E_ILLEGAL_TARGET`（天真原型 6 人有 1/6 局發生） | `ck/cards-science.ts:191-194`、`ck/knights.ts:133-138` |
| C5 | 同意報價時 engine 不檢查付不付得起 | 成立：同意時只檢查 goods，確認時才檢查手牌 | `engine.ts:1906-1909`（同意時只查 goods）、`:2006-2011`（確認時才查手牌） |

## 3. 介面摘要（只列策略與保底需要的部分）

- **指令**（`ck/index.ts:152-191`）
  - action 指令：`build.wall`、`city.improve`、`knight.{recruit,activate,promote,move,displace,chaseRobber}`、`progress.play`、`progress.harborOffer`。
  - pending 指令共 13 個（`:177-191`）。
  - preroll 只有 `progress.play {card:'alchemy'}`。
  - 停用 5 個 base 發展卡指令（`:150`）。
  - base 的 `pending.discard` 與 `trade.bank` 已接受 `CardKind`（`engine.ts:93`、`:97`）。
- **hints**（`ck/index.ts:269-308`，函式在 `:270`，都**不檢查成本**）
  - 只在自己的 action 且沒有 pending 時：`recruitSites`、`knights[]`（`canActivate`、`canPromote`、`canAct`、`moves`、`displace`、`chase`）、`wallSites`、`improvements[]`。
  - 隨時：`knightSupply`、`commodityRates`、`twoForOne`、`costs`、`progressExcess`、`progress[]`（`targets` 只在 `playable` 時填入）、`harborTargets`。只給該 frame 的 responder：`retreat`、`pillage`；只給 `responders[0]`：`defenderDecks`、`scienceBonus`。
  - 資源匯率 `hints.bankRates` 已套用模組的 `bankRate`，包括 merchant 與 Merchant Fleet 的 2:1（`engine.ts:1763-1768`）；commodity 的 2:1 已算進 `commodityRates`（`ck/index.ts:296`）。
- **view**：`commodityBank` 與 `GameView.bank` 一樣只投影到 `BANK_VIEW_CAP` = 2（#153），只能當作「有沒有存量」，不能排序稀缺程度（`ck/index.ts:235-236`、`rules/src/bank-view.ts:18-25`）。
- **常數**（`ck/constants.ts`、`ck/cards-science.ts:18,21`）：wall 2 brick；knight 與 promote 為 wool＋ore；activate 為 grain；medicine 為 grain＋2 ore；第 n 級改良要 n 張 commodity。進步卡手牌上限 4；蠻族軌道長 7；事件骰 6 面中 3 面是船；level L 在紅骰 ≤ L＋1 時抽卡；3 級得能力、4 級可取大都市；城牆上限 3，每座棄牌上限 +2。
- **蠻族攻擊**（`ck/barbarians.ts:61-139`）：蠻族強度 = 城市數（含大都市），防守強度 = 已啟動騎士等級和，平手算防守方贏。失守時，有可掠奪城市者中貢獻最低的那一群各失一座城市（大都市免疫）。攻擊後全部騎士變回未啟動；第一次攻擊時強盜上場。
- **隱藏資訊**（B-FAIR）
  - 對手的資源與 commodity 組成、進步卡身分、牌庫順序。
  - 只有行動者看得到：`guildDues.hand`、`espionage.cards`。harbor 的資源只有交換雙方看得到（`ck/cards-trade.ts:234-244`、`ck/cards-politics.ts:507-511`）。
- **paired 的 Player 2**：不擲骰、沒有 Alchemy、不做國內交易，但可打進步卡；打 Commercial Harbor 屬於開放詮釋 P3-4（`docs/FIDELITY.md:482-487`）。Player 1 擲骰時，Player 2 持有超過 4 張進步卡就要當場棄牌（`:499-503`）。

## 4. 設計

### 4.1 BotModule 的對應

檔案都放在 `bots/modules/citiesKnights/`。

| 鉤子 | 檔案 | 內容 | 切片 |
|---|---|---|---|
| `duty` | `duty.ts` | §4.2 的保底 | B1 |
| `answerFrame` | `frames.ts` | §4.3 的 frame 偏好；B1 期間由 `duty` 代答 | B2 |
| `setup` | `setup.ts` | 第 2 輪城市選點；其餘回 undefined，交給 base | B2 |
| `preroll` | `preroll.ts` | Alchemy | B2 建 stub，C 實作 |
| `actions` | `defense.ts`、`knights.ts`、`cards.ts`、`trade.ts`；`cards-interactive.ts`、`tactics.ts` | 「現在就該做」的行動：蠻族逼近時防禦、處理 `progressExcess`、追強盜、可打的 F1 卡。`actions` 與 base 的立即建造（`1 + PIP_VALUE × 點數`）放在同一份清單 pick，非空時會搶在主要計畫之前（`heuristic.ts:378-396`），所以分數用勝利分當量（eta = 0），有成本、需要累積的目標不放在這裡 | B2；後兩檔由 B2 建 stub，C 實作 |
| `planStep` | `plans.ts`、`improve.ts` | 執行 `citiesKnights.*` 計畫的下一步，例如 knight、wall、improve、medicine；不屬於自己的 kind 回 undefined。與 `economy.scoreExtras` 成對：有成本的目標（改良、騎士、城牆）由 `scoreExtras` 提供計畫，分數尺度為「勝利分當量 ÷ (1 + eta)」（`heuristic.ts:477-479`；`bots/modules/types.ts:119-120`；SF 先例 `bots/modules/seafarers/index.ts:43`） | B2 |
| `economy.*` | `economy.ts` | `cardKinds`、`rates`、`weights`、`hexYield`、`vertexBlocker`、`siteBlocked`：六個鉤子在 0.4.1 只有型別（`bots/modules/types.ts:80-87`），由第 0.5 步定稿、CK-B1 接上（§4.6）。`costs` 已在 0.4.1 實作（`bots/economy.ts:264-267`），C&K 只需提供具名成本 | B1 |
| `economy.scoreExtras` | `plans.ts` | 見 `planStep` 列 | B2 |
| `supports` | `index.ts` | 回傳 `CK_BOTS_RELEASED` 常數；CK-G 才改為 true | B1 → G |
| `pacing`、`responseCommands` | `index.ts` | §4.8；13 個 pending 指令 | B1 |
| 存取與建構 | `view.ts` | `ckView`、`ckHints`（直接以 `moduleView(view, 'citiesKnights')`、`moduleHints(view.hints, 'citiesKnights')` 包一層，前提是 CK-A 補上 `ModuleViewMap`／`ModuleHintsMap`，見 §4.7；`bots/modules/view.ts:17-30`）、frame data 型別守衛、指令建構函式 | B1 |
| 不使用 | — | `robberTargets`、`phase`、`endWindow`、`trade.goods`；`banditCandidates`（C&K 的強盜沿用 base 候選）；`piecesLeft`（騎士存量直接讀 `hints.knightSupply`）；`freeRouteCandidates`：若 C&K 的 Road Building 改走模組候選，要遵守「非空即取代 base」的語意（`heuristic.ts:138-143`、`:327-331`），B2 建議不用 | — |

### 4.2 保底表（I9；合約規則 7）

- 只取 view、hints 或 frame data 的第一個合法選項。
- 資格判定依 P3，一律採保守的 `responders[0] === self`。依序 frame（`defenderDraw`、`scienceBonus`）的 handler 本身就要求第一位回應（`ck/barbarians.ts:198`、`ck/production.ts:140`）。
- 本輪約 210 局中，duty 本身 0 次被拒。

| frame 或強制動作 | 最小動作 | 為何必定合法 | 證據 |
|---|---|---|---|
| base `discard`（含 commodity） | `pending.discard`：依 `CARD_KINDS` 順序展開手牌，交出前 `required[self]` 張。改的是 base 的 `handList`（`bots/base/duty.ts:61-70`）：直接讀自己投影的 `resources` 與 `commodities`，**不經 `cardKinds` 鉤子**（§4.6）。策略路徑的 `discardDecision`（`bots/heuristic.ts:149-172`）同樣只看 5 種資源，張數超過資源張數時會回 null，退到保底後被算成 `idleFallbacks`，B-GAME 會失敗；CK-B1 要讓它依卡種清單挑選。base frame 沒有模組鉤子，所以 B2 只能經由 weights 與計畫影響它 | 應棄張數依總牌數計算，展開後的清單一定夠長；engine 接受 CardKind | `engine.ts:1596-1613`（`submitDiscard`，`:1608` 用 `cardKindsOf`）、`ck/index.ts:106-108`、`rules/src/project.ts:156`；`heuristic.ts:75`；`test/harness.ts:551-555` |
| base `moveRobber`（7 點或追強盜） | 沿用 base：第一個不是目前位置、也不是海的格子；SF+CK 中改由 0.4.3 的 fold 集合決定（SF+CK 計畫 §4.2） | C&K 沒有 `moveBandit` 限制；首次攻擊前不會出現 | `bots/base/duty.ts:16-22`、`ck/index.ts:110-112` |
| base `steal` | `candidates[0]` | 偷到 commodity 不影響合法性 | `bots/base/duty.ts:23-27` |
| base `freeRoads`（Road Building 卡） | `hints.legalRoads[0]`；base 的保底另外檢查道路存量（`roadStockLeft`） | 已有測試 | `bots/base/duty.ts:33-40`、`packages/bots/test/ck-road-building.test.ts`、`ck/cards-science.ts:221-231` |
| `citiesKnights.pillage` | `barbarians.pillage {vertex: data.cities[self][0]}` | 只有 2 座以上可掠奪城市才會出 frame，否則自動掠奪 | `ck/barbarians.ts:83-88`、`ck/index.ts:253-254` |
| `citiesKnights.displaced` | `knight.retreat {vertex: data.options[0]}` | 沒有退路時騎士直接移除、不出 frame；options 是即時投影。注意這個指令沒有 null 選項 | `ck/knights.ts:277-283`、`:296-311`、`ck/index.ts:255-258` |
| `citiesKnights.defenderDraw`（依序） | `barbarians.chooseDeck {track: data.decks[0]}` | data 只列非空牌組；空牌組由 `skipEmptyDecks` 跳過 | `ck/index.ts:261-262`、`ck/barbarians.ts:122` |
| `citiesKnights.progressDiscard` | `progress.discard {cards: progressCards 的前 required[self] 張}` | 張數就是超出量 | `ck/progress.ts:103-142`、`ck/index.ts:259-260` |
| `citiesKnights.scienceBonus`（依序） | `science.take {resource: null}` | 只有明確的 null 合法；`undefined` 會被拒 | `ck/production.ts:134-150` |
| `citiesKnights.harborExchange` | `progress.harborAnswer {commodity: 第一種持有的 commodity}` | 接收方持有 2 種以上 commodity 才會出 frame | `ck/cards-trade.ts:68-79`、`:92-101` |
| `citiesKnights.guildDues`（行動者） | `progress.takeCards`：把 `data.hand` 依 `CARD_KINDS` 展開，取前 `data.count` 張 | `hand` 只給行動者，且是即時投影 | `ck/cards-trade.ts:144-156`、`:239-244` |
| `citiesKnights.espionage`（行動者） | `progress.takeProgress {card: null}` | null 一定合法 | `ck/cards-politics.ts:203-215` |
| `citiesKnights.sabotage`、`citiesKnights.wedding` | 交出展開手牌的前 `data.required[self]` 張 | handler 只檢查張數與是否持有 | `ck/cards-politics.ts:344-356` |
| `citiesKnights.treasonRemove`（受害者） | `progress.treasonRemove {vertex: data.knights[0]}` | data 列的是受害者自己的騎士 | `ck/cards-politics.ts:458-468`、`:515-516` |
| `citiesKnights.treasonPlace`（行動者） | `progress.treasonPlace {vertex: null}` | null 分支不檢查 level | `ck/cards-politics.ts:470-477` |
| `citiesKnights.diplomacyRoad`（行動者） | `progress.diplomacyRoad {edge: null}` | null 一定合法，SF+CK 帶 `ship` 時也一樣 | `ck/cards-politics.ts:137-150` |
| `citiesKnights.resolveRoll` | 不動作 | responders 為空，是續行 frame | `ck/index.ts:144-146`、`ck/dice.ts:25` |
| 自己的 action、沒有 pending、`progressExcess > 0` | `progress.discard {cards: progressCards 的前 progressExcess 張}`，之後才 `turn.end` | 這時 `canEndTurn` 為 false，這是唯一能解除否決的動作（C3）；fallback 在 action 階段先問模組 `duty`，所以不會無聲停住 | `ck/index.ts:298`、`ck/progress.ts:116-119`（`:117` 計算張數，`:119` 是 `E_PROGRESS_WITHIN_LIMIT`）、`bots/fallback.ts:46-49` |
| preroll、setup（第 2 輪放城市）、action 結束 | 沿用 base：`turn.roll`、`legalSettlements[0]`、`turn.end` | 第 2 輪仍然是 `setup.placeBuilding` | `bots/fallback.ts:35-53`、`bots/base/duty.ts:48-59`、`ck/index.ts:90-93` |

- 全部座位都是保底時無法終局，因為保底不改良（C2）。B-POLICY 每桌至少要有 2 個策略席位。

### 4.3 standard

| 視窗 | 決策 | 依據 |
|---|---|---|
| setup 第 2 輪 | 城市選點分數 = 點數 + commodity 產出（森林、牧場、山脈）；至少相鄰 ore 或 grain 其中之一。寫成可匯出的純函式 `citySetupScore`，供 SF+CK 的組合 setup 使用 | 〔啟發〕；`rules/types.ts:41-45` |
| action：手牌上限 | `progressExcess > 0` 時，先打可打的卡，不夠再依價值表棄掉最低的 | C3 |
| action：防禦（D-CK1） | 條件：`7 − position ≤ 2`，且自己有可掠奪的城市。目標：自己不落入最低貢獻群。順序：先 activate，再 recruit，再 promote。若 ≤ 2 個動作就能成為唯一最高貢獻者，defender VP 約計 1 VP。只有大都市時降低優先權。攻擊前不讓防守需要的騎士移動、擠人或追強盜，因為這些動作會讓騎士變回未啟動 | `ck/knights.ts:251`、`:275`、`:321` |
| action：改良 | 主軌道分數 = commodity 產出 + 3 級能力 + 大都市期望值（對手公開等級領先自己 2 級以上時降權）+ 抽卡率 (L＋1)/36；其他軌道升到 1–3 級 | `ck/cities.ts:91-128` |
| action：建造 | base 的 plan 加上 `scoreExtras` 的 knight、wall、improve plan；城牆只在手牌常超過上限時才蓋；medicine 可代替 `build.city` | G8、G13 |
| action：騎士 | 追走壓在自己格子上的強盜；擠走擋路的較弱騎士 | hints `knights[]` |
| action：F1 卡（12 種） | 觸發條件依第一輪 §5F。Smithing 選兩隻騎士時，以 `knightSupply` 逐一模擬棋子存量 | C4 |
| action：交易 | 銀行交易可用 commodity，匯率讀 `commodityRates`；從銀行換入 commodity 時看 `moduleView(...).commodityBank[c] > 0`（只到 `BANK_VIEW_CAP` 的可得性，`ck/index.ts:236`）；規劃連續幾筆時比照 `plannedBank`（`bots/bank.ts:13-21`），上限換成 `profile.commodityBankPerType`（`profiles.ts:438`）。國內報價沿用 base，只含資源 | §4.5 |
| frame 偏好 | 見下表 | 第一輪 §5G |

frame 偏好：

| frame | 選擇 |
|---|---|
| `discard` | 保留首要 plan 需要的牌，棄多餘的。base 的棄牌 frame 沒有模組鉤子，由 base 的 `discardDecision` 處理；這個行為來自 CK-B1 讓它認得 commodity，加上 C&K 的 weights 與 plans，不由 `frames.ts` 決定（`heuristic.ts:75`、`:116-121`、`:149-172`） |
| `pillage` | 產值加城牆價值最低的城市 |
| `defenderDraw` | 主軌道的牌組 |
| `scienceBonus` | 在 `view.bank[r] > 0` 的資源中，依計畫缺口挑一張，可用 `plentyPick(turn)`（`bots/base/cards.ts:15-38`）。`view.bank` 是 `min(存量, 2)`（`rules/src/bank-view.ts:18-25`），所以「> 0」是精確的，能避開 `E_BANK_EMPTY`（`ck/production.ts:146`）；不得把投影張數當稀缺程度排序，也不要用 `plannedBank`（`bots/bank.ts:1-21`，只給一回合連續規劃好幾筆使用）。銀行空時不會產生 frame，取完後若銀行空了也會清掉 responders（`ck/production.ts:127`、`:154`），為了保底仍回 `{ resource: null }`。只有 `hints.modules.citiesKnights.scienceBonus === true`（`ck/index.ts:304`）的 `responders[0]` 才作答 |
| `progressDiscard`、`espionage` | 依卡片價值表；F2 卡在 CK-C 之前評低價 |
| `harborExchange`、`sabotage`、`wedding`、`treasonRemove` | 交出最低價值的牌，或最弱、未啟動的騎士 |
| `treasonPlace` | 阻擋價值最高的點，選允許的最高等級 |
| `diplomacyRoad` | 最能延伸路線的邊 |

### 4.4 easy（P9；D-CK3）

- 沿用 `LEVEL_PARAMS.easy` 的 `topK 3`（`bots/level.ts:21-25`，easy 在 `:23`）。
- **防禦**：只在 `position ≥ 6` 時反應，目標是不落入最低群，做法是招募 1 隻騎士再啟動。實測 easy 防禦的對局 48/48 終局。
- **改良**：一定要做（C2），但只升持有 commodity 最多的那一軌。
- **進步卡**：只打 F1，條件放寬或延後到手牌上限時才打。不打 F2 與 Alchemy，但全部 frame 照常回應。
- **hard**：C&K 不提供。`hardSupports` 要求 profile 沒有 rules module，`botLevelsFor` 只會列出 easy 與 standard；萬一 hard 座位遇到 C&K，`hardPolicy` 會帶著模組改用 standard（`bots/support.ts:24-33`；`bots/hard/index.ts:53`、`:76-78`）。

### 4.5 commodity 經濟與報價（合約規則 9；整體策略 §4.8）

1. **手牌與成本型別**（E-1）：`Hand = Record<Resource, number> & Partial<Record<Commodity, number>>`，`Cost = Partial<Record<CardKind, number>>`；`Yield`、`Economy.weights`、`Economy.rates` 同樣用交集形式。commodity 鍵只在手牌或成本有值時才寫入，base 的物件形狀不變（`bots/economy.ts:24-25`）。實測只有 `bots/hard/build.ts:16-18` 一處編譯錯誤，改成 `(economy.hand[resource] ?? 0)` 即可；若改成完整的 `Record<CardKind>`，每個以 `emptyYield()` 建立手牌的地方都要改。
2. **迴圈分兩類**（E-3）
   - 「張數類」一律走 `CARD_KINDS`，不經 `cardKinds` 鉤子：`handOf`（`economy.ts:30-33`）、`handSize`（`:35-37`）、`canAfford`、`deficitOf`、`pay`（`:59-73`）、`handList`（`bots/base/duty.ts:61-70`）、`proposerCanPay`（`heuristic.ts:272`）、`costTotal`（`bots/trade.ts:20-22`；hard 另有一份 `bots/hard/trade.ts:92-94`）。base 的 commodity 恆為 0，因此 golden replay 不變。
   - 「估值類」走 `Economy.kinds`（`RESOURCES` 加上各模組的 `cardKinds`）：`etaRounds`（`economy.ts:191-226`）、`handUtility`（`bots/trade.ts:25-36`）、`bankTradeToward`（`:134-166`）、`handRelief`（`heuristic.ts:484-507`）。base 的 `kinds` 是 `RESOURCES`，迭代順序相同。
3. **匯率**：資源讀 `hints.bankRates`，commodity 讀 `hints.modules.citiesKnights.commodityRates`。後者與 engine 的 `bankRateFor` 一致（`ck/index.ts:296`、`engine.ts:1745-1753`）。
4. **權重**：commodity 的權重 = 對主改良軌道的需求（下一級成本減去持有量），再加上依匯率換算的流動性。`handUtility` 要依 `Economy.kinds` 加上 commodity 的權重與流動性，否則估值時會把 commodity 當成 0 分。資源權重維持 base（E-4）。
5. **回應報價**，依序判斷：
   1. 報價含 `giveGoods` 或 `wantGoods`，或含 `Economy.kinds` 以外的卡種：拒絕。接點是 `offerTermsKnown`（`bots/trade.ts:58-64`）：加一個參數 `kinds: readonly CardKind[] = RESOURCES`，呼叫端 `heuristic.ts:210`、`:269` 傳入 `turn.economy.kinds`；`bots/hard/trade.ts:175` 不必改。
   2. 以 CardKind 判斷 `!canAfford(hand, offer.want)`：拒絕。`offerGain` 的 `canAfford` 在 `bots/trade.ts:41`，`canAfford` 改走 `CARD_KINDS` 後自動修正。這修正了「同意自己付不起的報價」：engine 同意時只查 goods，確認時才檢查手牌（`engine.ts:1906-1909`、`:2006-2011`）。
   3. 其他情況：照原本的效用與門檻判斷。
6. **行動者的反報價**：`proposerCanPay`（`bots/heuristic.ts:272`）改為以 CardKind 計算張數。
7. **不主動提出 commodity 國內報價**：`proposeOffer` 只在 `isImmediate(plan)` 時呼叫，`want` 依 `RESOURCES` 逐一建立（`bots/heuristic.ts:288-295`、`bots/trade.ts:187-191`）。C&K 的模組計畫預設 `immediate` 為 false（`bots/economy.ts:150-152`），B2 不要把它設為 true；`proposeOffer` 本身不必改。

### 4.6 定稿 0.4.1 已保留型別的六個鉤子（CK-B1 交付；base 行為不變，以 golden replay 驗證）

六個 economy 鉤子在 0.4.1 已宣告為「只保留型別」（`bots/modules/types.ts:80-87`），`bots/test/support.test.ts:22-31` 禁止已註冊的模組定義它們。第 0.5 步由 CK-B1 的第一個 commit 定稿簽章與組合語意（只改 `types.ts` 的型別與註解，§5），commit 後先回報主 agent，再接骨架；骨架真正呼叫它們的程式碼在 CK-B1 的後續 commit，並在同一個 PR 把它們從保留清單移除（`support.test.ts:22-31`、`:72-79`）。`costs` 已在 0.4.1 實作（`bots/economy.ts:264-267`），不在此列。

**定稿後的簽章與組合語意**（模組清單為空時 base 不變）

| 鉤子 | 簽章與組合語意 |
|---|---|
| `cardKinds` | `(model) => readonly CardKind[]`：模組讓手牌多出的卡種（C&K：paper、cloth、coin），不得含 Resource。`RESOURCES` 在前，依模組順序附加、去重，得到 `Economy.kinds`；估值類迴圈依這份清單，清單外的卡種一律視為無法估值 |
| `rates` | `(model) => Partial<Record<CardKind, number>>`：給銀行一張該卡種要付的張數，只回答自己 `cardKinds` 內的卡種（C&K：`hints.modules.citiesKnights.commodityRates`）。資源一律讀 `hints.bankRates`（已含模組調整），模組回傳的資源鍵忽略；每個鍵先出現的模組優先；缺漏的卡種視為不能與銀行交易 |
| `weights` | `(model) => Partial<Record<CardKind, number>>`：卡種的估值權重，與 `resourceWeights` 同尺度，只回答自己 `cardKinds` 內的卡種；資源權重維持 base（E-4）；先出現的模組優先，缺漏的模組卡種權重為 0 |
| `hexYield` | `(model, hex, vertex, city: boolean) => Partial<Record<CardKind, number>> \| undefined`：`vertex` 上的一座建築在 `hex` 擲中時拿到的張數；`city` 可以是假設（城市計畫的目標點目前是聚落，setup 第 2 輪的點目前是空地）。依模組順序詢問，第一個非 undefined 勝出；都沒有回答時用 base：`hexResource` 的資源 `city ? 2 : 1` 張（沙漠、海、金礦為空）。模組只回答自己定義產出的地形，其餘回 undefined（金礦仍由 `goldPipsAt` 計價）。與 0.4.1 的保留型別相比，只多了 `city` 參數 |
| `vertexBlocker` | `(model, vertex) => string \| null`：擋住 `vertex` 的非建築棋子的擁有者（C&K：騎士），沒有則回 null；第一個非 null 勝出。骨架在道路 BFS（`searchRoads`）與路線長度（`routeLength`）把「擁有者不是自己」當成對手建築，自己的不擋 |
| `siteBlocked` | `(model, vertex) => boolean`：`vertex` 不能蓋建築（C&K：上面有任何騎士，含自己的）；任一模組為 true 就算（OR）。骨架在 `isFreeSpot` 使用 |

**消費位置與 C&K 實作**

| 掛點 | 在 base 檔案的消費位置 | C&K 實作 |
|---|---|---|
| `cardKinds`、`rates`、`weights` | 新欄位 `Economy.kinds`（`bots/economy.ts:154-168`）；`weights`、`rates` 在 `:268-271`。估值類：`etaRounds`（`economy.ts:191-226`）、`handUtility`（`bots/trade.ts:25-36`）、`bankTradeToward`（`:134-166`）、`heuristic.ts:149-172`（棄牌）、`:484-507`（`handRelief`）、`bots/base/cards.ts:15-38`（`plentyPick`）。張數類（直接走 `CARD_KINDS`，不經鉤子）：`economy.ts:30-37`、`:59-73`、`trade.ts:20-22`、`base/duty.ts:61-70`（`handList`）、`heuristic.ts:272` | commodity、`commodityRates`、改良需求 |
| `economy.costs`（已實作） | `economy.ts:264-267`：base 計畫讀 `COSTS`，模組計畫讀 `Economy.costs` | knight、activate、promote、wall、medicine 與改良（n 張 commodity；`Cost` 放寬後可表達） |
| `economy.hexYield` | `bots/board.ts:131-139`（`vertexYield`）、`:142-152`（`playerYield`，取代 `:147` 的 `factor`）；`economy.ts:115-119`（`productionValue`，城市計畫與立即升城的價值，`heuristic.ts:382`，城市增量以 `city:true − city:false` 計算）。強盜評分（`base/robber.ts:23`）與 `blockedPips`（`heuristic.ts:239`）以張數計，維持不變 | C&K 的城市不論地形都產 2 張，只是組成不同：森林、牧場、山脈上產 1 資源加 1 commodity（`ck/production.ts:34-70`、`:46-51`）。對非 `TERRAIN_COMMODITY` 地形回 `undefined`，讓 SF 的金礦處理生效（SF+CK 計畫 A2、§4.6） |
| `economy.vertexBlocker` | `board.ts:200-203` 的 `opponentAt`；呼叫點 `searchRoads`（`:226`、`:245`）、`routeLength`（`:316`、`:324`） | 對手騎士封路，但不封自己（`ck/index.ts:123-125`；`docs/FIDELITY.md:123` R-CK knights） |
| `economy.siteBlocked` | `board.ts:123-128` 的 `isFreeSpot`；呼叫點 `economy.ts:312`、`base/roads.ts:49`、`hard/setup.ts:81`、`modules/seafarers/{plan,setup,actions}.ts` | 任何騎士所在的點都不能建造（`ck/index.ts:127-129`） |

**接點：組合後的盤面掛點注入 `BoardModel`**（E-2）：`BoardModel` 加上可選欄位 `blocker?`、`siteBlocked?`、`hexYield?`，由 `boardModel(view, selfId, modules = [])`（`board.ts:78-100`）依上表的組合規則建立，`Turn` 建構時傳入 `this.modules`（`bots/turn.ts:37`）。這樣 `isFreeSpot`、`searchRoads`、`routeLength`、`playerYield` 共約 20 個呼叫點不必改簽章；沒有傳模組時三個欄位省略，tracker（`bots/tracker.ts:366`）與 hard 仍是 base 行為；0.4.3 的 `sea.ts` 只要寫 `options.blocker ?? model.blocker`（§4.9）。

**CK-B1 的實作要點**（供主 agent 審核時對照）
1. 張數類迴圈不經鉤子的理由：
   - fallback 的 `pendingDuty(view, selfId)` 沒有 model 與模組（`fallback.ts:33`）；`boardModel` 用 `requireProfile`（`board.ts:91`），找不到 profile 時會 throw，而保底不得 throw（`fallback.ts:5-6`）。
   - naive 座位只保留模組的 `duty`（`test/harness.ts:400-413`）；只有張數依 `CARD_KINDS` 計算，naive 座位在 C&K 才不會因為棄牌張數不對而退到保底。
   - 這和整體策略 §4.1 原本寫的「`pendingDuty` 套用 `cardKinds`」不同，整體策略已同步改寫。
2. `offerTermsKnown(offer, kinds = RESOURCES)`，base 與 hard 的呼叫端不變。
3. `support.test.ts`：同一個 PR 從 `:22-31` 移除六個鉤子，並把 `:89` 的 `expect(BOT_PACING).toEqual(SEAFARERS_PACING)` 改成 SF 與 C&K 的節奏合併（§4.8）。
4. golden：每一步都要通過 `vitest run test/golden-base.test.ts`；另跑 `test/hard.test.ts`，hard 的決定性也必須不變。
5. `dedupeCandidates`（`heuristic.ts:424-447`）的鍵只排序頂層欄位（SF 工作紀錄 `docs/aegis/work/2026-11-07-bots-seafarers.md:74`），而 C&K 的候選可能帶巢狀 payload：B1 先改成遞迴正規化並補測試（E-11）。目前只會漏去重，不會誤合併，所以是品質問題，不是正確性問題。

### 4.7 rules 匯出（CK-A；P8）

- 只在 `packages/rules/src/index.ts` 新增匯出，並在 `ck/index.ts` 加兩行型別別名，比照 E&P（`packages/rules/src/modules/explorersPirates/index.ts:306`、`:394`），最接近的前例是 SF 的 RX（#118；`seafarers/index.ts:51`、`:82`，`packages/rules/src/index.ts:16`、`:19-20`）。
- 名稱加 `CK_`／`Ck` 前綴，比照 E&P 的別名慣例（`packages/rules/src/index.ts:15-20`，`EP_*` 別名在 `:17-18`），避免 `TRACKS`、`MAX_LEVEL`、`Track` 這類通用名稱撞名。

| 類別 | 匯出 |
|---|---|
| 型別 | `CitiesKnightsView = ReturnType<typeof projectCitiesKnights>`（`ck/index.ts:213`）、`CitiesKnightsHints = ReturnType<typeof citiesKnightsHints>`（`:270`）、`ImprovementOption`（`ck/cities.ts:101`）、`ProgressCardHint`（`ck/cards.ts:56`）、`BlockReason`（`ck/card-common.ts:22`）、`CkTrack`、`CkKnightLevel`、`CkEventFace` |
| 常數 | `CITIES_KNIGHTS`、`CK_TRACKS`、`CK_TRACK_COMMODITY`、`CK_MAX_LEVEL`、`CK_ABILITY_LEVEL`、`CK_METROPOLIS_LEVEL`、`CK_PERMANENT_METROPOLIS_LEVEL`、`ckDrawThreshold`、`CK_WALL_COST`、`CK_KNIGHT_COST`、`CK_PROMOTE_COST`、`CK_ACTIVATE_COST`、`CK_MAX_WALLS`、`CK_WALL_HAND_BONUS`、`CK_KNIGHTS_PER_LEVEL`、`CK_BARBARIAN_TRACK_LENGTH`、`CK_PROGRESS_HAND_LIMIT`、`CK_EVENT_FACES`、`CK_PROGRESS_DECKS`（kit 比對進步卡身分用，`ck/constants.ts:75`）、`CK_VP_PROGRESS_CARDS`、`CK_MEDICINE_COST`、`CK_FIXED_DISCS` |
| frame kind | 14 個常數，定義在 `ck/barbarians.ts:29-30`、`ck/knights.ts:43`、`ck/progress.ts:36`、`ck/production.ts:24`、`ck/dice.ts:25`、`ck/card-common.ts:12-19` |
| 不匯出 | frame data 型別：rules 沒有宣告這些型別。由 bots 的 `view.ts` 以型別守衛宣告，並由 CK-B1 的 frame 測試對照真實投影鎖住形狀 |
| 已匯出 | `COMMODITIES`、`CARD_KINDS`、`TERRAIN_COMMODITY`、`CardKind`、`ProgressCardType`；`moduleStateOf` 也已公開（kit 的守恆檢查用，不必新增，`rules/src/modules/index.ts:7`） |
| 對照表（新增） | 在 `ModuleViewMap` 加 `citiesKnights: CitiesKnightsView`（`rules/src/index.ts:34-37`），在 `ModuleHintsMap` 加 `citiesKnights: CitiesKnightsHints`（`:44-47`），檔首的 `import type` 一併補上（`:1-2`）。這兩張對照表在 #118 才出現；少了它們，bots 的 `moduleView`／`moduleHints`（`bots/modules/view.ts:17-30`）取不到 C&K 的型別 |

- `ck/constants.ts` 只 import 型別；其他檔案本來就經由 `BUILT_IN_MODULES` 載入，匯出不會帶進新的副作用。
- web 的本地型別（`packages/web/src/board/citiesKnights.ts:11-141`）本版不改。

### 4.8 節奏與每視窗上限

- **節奏**：C&K 的 `pacing`，單位為 ms。

  | 類別 | 指令與 ms |
  |---|---|
  | 建造 | `build.wall`、`knight.recruit`、`city.improve`、`knight.promote` 各 900；`knight.activate` 700 |
  | 移動 | `knight.move` 700；`knight.displace`、`knight.chaseRobber` 900（之後的 `pending.moveRobber` 沿用 1200） |
  | 打牌 | `progress.play` 1100；`progress.harborOffer` 900 |
  | frame 回應 | `barbarians.pillage` 1200；`science.take` 700；`progress.harborAnswer` 800；其餘 9 個 pending 指令各 900 |

  換算觀看時間：一個行動視窗 p95 約 7 個指令，約 6–7 s，加上擲骰演出 2.8 s（`ROLL_PRESENTATION_MS`，`packages/server/src/bot-driver.ts:76`）。最多 16 個指令時約 15 s。
- **每視窗上限**：不設 `maxCommandsPerWindow`，沿用預設 40。
  - 實測逐 Bot 最多 16 個（C1），打全部 22 種卡時也只有 13–16 個。
  - Commercial Harbor 每張卡最多讓 Bot 對 N−1 位對手各報價一次，6 人時兩張卡最多 12 個指令，仍在上限內。
  - 策略不必合併動作。
  - Q1 以仿 BotDriver 模式套用同一個 40 的上限，超過就判失敗；Q3 對超過 30 的情況提出警示。
- **合併規則**：`BOT_PACING` 與 base 的 `THINK_MS` 全域合併（`bot-driver.ts:48-73`；`bots/support.ts:35-44`），C&K 的鍵不得與 SF 或 base 重複；`pending.moveRobber` 不要列，沿用 base 的 1200。CK-B1 註冊 `pacing` 後，`support.test.ts:87-89` 的 `expect(BOT_PACING).toEqual(SEAFARERS_PACING)` 要改成兩者合併。

### 4.9 為 0.4.3 SF+CK 保留的掛點（〔推測〕表示依賴 0.4.1 或 0.4.3 的實作）

| 掛點 | 設計 | 依據 |
|---|---|---|
| 首次攻擊前強盜不在盤面上 | 一律讀 `robberActive`，不假設 `view.board.robber >= 0` | `sfck/index.ts:147` |
| 追擊海盜 | `knights.ts` 匯出 `chaseValue(turn, hex, bandit)` 與候選建構函式；SF+CK 模組依 `pirateChase` 產生 `knight.chasePirate` 候選 | `sfck/index.ts:168`、`:186` |
| 騎士封住船路 | `vertexBlocker` 也要供 SF 的海路 BFS 使用；0.4.3 的 SFCK-P 只要把 `sea.ts` 的 `blocker` 預設改為 `options.blocker ?? model.blocker`（`BoardModel.blocker` 在 0.4.2 已由組合後的 `vertexBlocker` 建立，§4.6；SF+CK 計畫 §4.6） | `sfck/index.ts:24-27`、`bots/sea.ts:33-38`（`VertexBlocker`、`ShipOptions.blocker`）、`:104-110`（`blockedFor`） |
| Road Building 可以放船 | 判斷要不要打 roadBuilding 時，用組合後的 `freeRouteCandidates`，不只看 `legalRoads` | `ck/cards-science.ts:227-228` |
| Diplomacy 重建船 | `diplomacyRoad` 依 `data.ship` 選擇路線模型；保底仍是 null | `ck/cards-politics.ts:141`、`:523` |
| merchant 不放金礦；Taxation 只移動強盜 | 一律以 `targets.hexes` 為準 | `sfck/index.ts:163`、`ck/cards-politics.ts:379` |
| 勝利分是 16 | 估值用 `view.victoryTarget`，不寫死 13 | `packages/rules/src/profiles.ts:481`（paired 在 `:513`） |
| 金礦不產 commodity | `hexYield` 只依 `TERRAIN_COMMODITY` 給 commodity | `rules/types.ts:41-45`、`sfck/index.ts:25-26`（COMB-8） |
| 組合模組先攔截 | 非 C&K frame 一律回 undefined；強盜或海盜的選擇交給 SF+CK | 整體策略 §4.2 |

## 5. 切片與 PR

- 分支命名為 `feat/bots-ck-<slice>`；worktree 放在 `.worktrees/bots-ck-<slice>/`；PR 一律指向 `release/v0.4.2`。
- 並行的切片之間，檔案所有權不重疊。

| 切片 | 檔案所有權 | 內容 | 行數（src／test） | 依賴 | 驗收命令 |
|---|---|---|---|---|---|
| **0.5**（CK-B1 的第一個 commit，E-12） | `packages/bots/src/modules/types.ts`：只改 §4.6 的型別與註解 | 定稿六個 economy 鉤子的簽章與組合語意（`hexYield` 加 `city`）；commit 後先回報主 agent，再接骨架 | 含在 CK-B1 | `release/v0.4.2` | `pnpm --filter @catan/bots typecheck`；`pnpm --filter @catan/bots exec vitest run test/support.test.ts test/skeleton.test.ts` |
| **CK-A** `feat/bots-ck-exports` | `packages/rules/src/index.ts`：匯出，並在 `ModuleViewMap`、`ModuleHintsMap` 加 `citiesKnights`；`ck/index.ts`（只加兩行 `export type`）；`packages/rules/test/ck-exports.test.ts`（新增） | §4.7；測試以 `rules/test/seafarers-exports.test.ts:1-40` 為範本：`Record<keyof T, true>` 鍵表加上真實投影比對 | 30–45／25–40 | `release/v0.4.2` | `pnpm --filter @catan/rules exec vitest run test/ck-exports.test.ts`；`pnpm --filter @catan/rules typecheck`；`pnpm --filter @catan/rules exec vitest run`（全綠即 I3／P8）；`pnpm --filter @catan/bots typecheck` |
| **CK-B1** `feat/bots-ck-economy` | 共用檔（獨占）：`bots/src/{economy,board,trade,heuristic,turn,bank}.ts`、`bots/src/base/{duty,cards}.ts`、`bots/src/hard/build.ts`（只改型別）；`fallback.ts` 預計不必改，列為可以改。registry：`bots/src/modules/registry.ts`（一行）。新檔：`bots/src/modules/citiesKnights/{index,view,duty,economy}.ts`。測試：`test/support.test.ts`、`test/modules/citiesKnights.ts`（conservation、hideDifferently、perturb、responseCommands）、`test/ck-duty.test.ts`、`test/ck-economy.test.ts`、`test/ck-model.test.ts`、`test/ck-road-building.test.ts`（只改 `:1` 的註解；註冊後它會走 C&K 模組，要重跑） | 第 0.5 步（第一個 commit）；§4.2 保底；§4.5；§4.6 掛點與組合後的 `BoardModel`；`dedupeCandidates` 的遞迴鍵（E-11）；模組測試工具（見下，不得 import `rules/test/ck-checks.ts`）；`supports` 回 false | 500–600／300–380 | 0.5；CK-A。不需要型別的 CardKind 部分可以先做，CK-A 合併後以 merge 方式併入 release 分支 | `pnpm --filter @catan/bots exec vitest run test/ck-duty.test.ts test/ck-economy.test.ts test/ck-model.test.ts test/ck-road-building.test.ts test/support.test.ts`；`pnpm --filter @catan/bots exec vitest run test/golden-base.test.ts test/hard.test.ts test/skeleton.test.ts`；`pnpm --filter @catan/bots typecheck`；`pnpm --filter @catan/bots exec vitest run` |
| **CK-B2** `feat/bots-ck-core` | `bots/src/modules/citiesKnights/{setup,defense,improve,knights,cards,frames,trade,plans}.ts`，`plans.ts` 含 `scoreExtras` 與 `planStep`；stub `{preroll,cards-interactive,tactics}.ts`；`index.ts` 的掛接。測試：`test/ck-decisions.test.ts`、`test/ck-frames.test.ts`、`test/ck-game.test.ts`、`test/ck-fair.test.ts`、`test/ck-fuzz.test.ts`、`test/ck-fallback.test.ts`；`test/modules/citiesKnights.ts`（加 `mechanics`）。共用測試檔只增不改：`test/harness.ts` 的 `PROFILE_LIMITS` 兩筆、`test/families.ts` 的 citiesKnights family、`bench/run.ts` 的 `BENCH_KITS` 與 `RULES_SIM_ROUNDS` | §4.3、§4.4；Q1 與 Q2 的檢查。各 family 測試檔明列 `ck-2025`、`ck-paired-2025` 與人數，gating 未開時也能跑；登記後通用矩陣會跳過它們 | 650–750／350–450 | CK-B1 | `BOTS_SEEDS=3 pnpm --filter @catan/bots exec vitest run test/ck-decisions.test.ts test/ck-frames.test.ts test/ck-game.test.ts test/ck-fair.test.ts test/ck-fuzz.test.ts test/ck-fallback.test.ts`；`BOTS_SEEDS=10 pnpm --filter @catan/bots exec vitest run test/ck-game.test.ts`；`pnpm --filter @catan/bots exec vitest run test/matrix.test.ts`；`pnpm --filter @catan/bots bench 50 --profile ck-2025`（`ck-paired-2025` 同法） |
| **CK-G** `feat/bots-ck-gate` | `bots/src/modules/citiesKnights/index.ts`（`CK_BOTS_RELEASED = true`）；`test/support.test.ts:61-68`（快照加上 `ck-2025`、`ck-paired-2025`）；`test/hard.test.ts:190-192`（可選：加一行 ck 的 `botLevelsFor` 斷言）；`packages/server/test/cities-knights.test.ts:120-134`（翻轉）；`packages/server/test/bots.test.ts:282-305`、`:357-369`；`packages/server/test/cities-knights-bots.test.ts`（新增）；`packages/web/test/bots.test.tsx:209-210`（建議）；§7.1 的文件 | 開放 gating；§6.3 的 server 案例；hard 不必改程式（`botLevelsFor` 已對有 rules module 的 profile 排除 hard，`bots/support.ts:24-33`）。web 的「不支援」fixture 改用 `sf-ck-new-shores-2025`：不改測試也不會失敗，但語意會過時 | 5–15／180–240（另有文件約 40 行） | CK-B2 | `pnpm --filter @catan/bots exec vitest run test/support.test.ts test/matrix.test.ts test/hard.test.ts test/ck-game.test.ts`；`pnpm --filter @catan/server exec vitest run test/cities-knights.test.ts test/cities-knights-bots.test.ts test/seafarers-cities-knights.test.ts test/bots.test.ts`；`pnpm --filter @catan/web exec vitest run test/bots.test.tsx`；`BOTS_SEEDS=10 pnpm verify`（QA 或發布前，在安靜的機器上跑） |
| **CK-C** `feat/bots-ck-cards` | `bots/src/modules/citiesKnights/{cards-interactive,preroll,tactics}.ts`（取代 B2 的 stub）；`packages/bots/test/ck-cards.test.ts` | F2 的 10 種卡、Alchemy 窮舉 36 種骰面、Invention、Commercial Harbor 報價、騎士封鎖戰術；M8 計數 | 400–500／300–400 | CK-B2；與 CK-G 並行 | `pnpm --filter @catan/bots exec vitest run test/ck-cards.test.ts`；`BOTS_SEEDS=10 pnpm --filter @catan/bots exec vitest run test/ck-cards.test.ts test/ck-game.test.ts` |

- **並行規則**：CK-A 與 CK-B1 可以並行，所有權不重疊：前者只動 rules，後者只動 bots。CK-G 與 CK-C 可以並行：CK-C 不碰 `index.ts`，CK-G 只改 `index.ts` 的常數，掛接已在 B2 完成。
- **CK-B2 的限制**：不得改 `heuristic.ts`、`economy.ts`、`board.ts`、`trade.ts`。棄牌偏好與交易估值只能經由 weights、rates 與 plans 影響；真的需要時要先回報主 agent。`PROFILE_LIMITS`、`families.ts`、`bench/run.ts` 只增不改。
- **kit 與守恆**（E-6）：B1 建立 `test/modules/citiesKnights.ts`，B2 再加 `mechanics`。`conservation` 不可重用 `rules/test/ck-checks.ts`：它 import 了 vitest 的 `expect`（`:3`），而 bench 會用 esbuild 把 kit 打包進去（`bench/run.ts:51`、`bench/run.mjs:11-18`）。改為以 `@catan/rules` 公開的 API 重寫，回傳字串清單（範本 `test/modules/seafarers.ts:12-25`，只 import rules 與型別）：資源與 commodity 守恆；每種進步卡身分守恆（`CK_PROGRESS_DECKS`、`state.progressDecks`、`player.progressCards`，以及 `moduleStateOf(state, 'citiesKnights')` 中的 `progressVp`）；騎士每級 ≤ 2、總數 ≤ `pieces.knights`；建築與騎士不同點。
- **測試檔拆分**（E-5，比照 SF）
  - B1：`ck-duty.test.ts`（I9 固定盤面：14 種 frame、含 commodity 的棄牌、`progressExcess`，保底、standard、easy 各跑一次，等同 `sf-duty.test.ts:1-10`）；`ck-economy.test.ts`（CardKind 手牌與成本、匯率、規則 9 的 1 coin 與 3 coin 案例、`hexYield`）；`ck-model.test.ts`（在 ck-sim 的終盤比對 `searchRoads`、`isFreeSpot` 與 hints 的 `legalRoads`／`legalSettlements`，`routeLength` 與 rules 的 `longestRouteLength`，等同 `sf-sea.test.ts:1-8`）。
  - B2：`ck-decisions.test.ts`（setup、防禦、改良、騎士、F1、交易）；`ck-frames.test.ts`（frame 偏好、依序作答的資格）；`ck-game.test.ts`（B-GAME、決定性、Q2）；`ck-fair.test.ts`、`ck-fuzz.test.ts`、`ck-fallback.test.ts`（保底混座）。family 登記的 files 列 game、fair、fuzz、fallback 四檔（`test/families.ts:42-54`）。
  - bench 不寫自訂 CONFIGS：只在 `BENCH_KITS`（`bench/run.ts:51`）加 kit、在 `RULES_SIM_ROUNDS`（`:59-62`）加 ck-sim 的回合數。

- **PR-B 拆成兩個**
  - 第一輪的 PR-B 是 L 級：src 1100–1300、test 600–800。拆成 B1（模型與安全）與 B2（決策與品質）後，兩者合計 1150–1350／650–830。
  - 兩個 PR 的審查重點不同：B1 看 I9、合法性與 base 不變；B2 看決定性、B-FAIR 與 Q2。
  - 兩者都不開 gating。第一輪已證明「只有 duty」通不過 B-GAME；本輪補充主因是不改良（C2）。
  - gating 的翻轉獨立成最後的 CK-G，讓 server 案例與文件集中在一個小 PR。
- **合計**：src 約 1,590–1,910，test 約 1,150–1,510，總計約 2,750–3,400（行數估計沿用 2026-11-04，刷新時未重估）。

## 6. 測試與驗收

### 6.1 Q1 矩陣（發布閘門）

| profile | 人數 | B-GAME 席位 | 種子數（預設／發布） | 步數上限 | 看門狗 N |
|---|---|---|---|---|---|
| `ck-2025` | 3、4 | standard 與 easy 依 `(index + seed) % 2` 交替 | 3／10 | 6000 | 72（`turn.roll` 次數，等同回合數） |
| `ck-paired-2025` | 5、6 | 同上 | 3／10 | 6000 | 72（`turn.roll` 次數，等同回合數） |

- **限制寫入 `PROFILE_LIMITS`**：`test/harness.ts:222-226` 為 `'ck-2025'`、`'ck-paired-2025'` 各加一筆 `{ maxSteps: 6000, watchdogRolls: 72 }`，並照 SF 的慣例在註解寫明量測依據。看門狗的單位是 `turn.roll` 次數（`harness.ts:587-594`）；C&K 每一回合恰好擲骰一次，paired 只有 Player 1 擲骰，所以數值等同回合數。「創新高」以各玩家自己先前的最高分為準，與 X6 一致（`harness.ts:200-226`、`:248-272`）。
- **其他測試族**
  - **B-POLICY**：使用同樣的格子。每桌放 1 個保底席位，其餘交替 standard 與 easy。合約檢查：非行動者只能送 base 的 6 個回應指令加 C&K 的 13 個；paired 的 Player 2 不送 `trade.offer`，也不打 alchemy。工具：`withFallbackSeat`（`test/harness.ts:392`）、`allowedResponseCommands`（`:651`）、`responseCommandDrift`（`:661`）；kit 的 `responseCommands` 必須是 `botResponseCommands(profile)` 的子集（`test/modules/types.ts:63-67`）。
  - **B-FAIR**：每個 family 至少 40 個狀態、100 次比較。`hideDifferently` 做三種擾動：保持 `handSize` 不變、改變資源與 commodity 的組成；把對手的進步卡與同一牌組的牌互換；反轉牌組順序。排除 `guildDues`、`espionage` 由行動者作答的狀態，以及 `harborExchange`。base 的 `hideDifferently` 只交換資源與發展卡（`harness.ts:683-733`），所以三種擾動由 kit 自己實作；`decks` 的張數是公開的，反轉牌組不影響它。
  - **fuzz**：以 `perturb` 擾動 commodity、進步卡與蠻族位置，每格 1 個種子。SF 的教訓：注入的 pending 要符合 rules 的實際形狀（`progressDiscard.data.required`、`displaced.data.{knight,from}`、guild dues 的 `{victim,count}`，以及 responders 順序）；擾動不得破壞守恆；base 的 `perturbState` 會凍結待棄牌玩家的手牌（`harness.ts:736-770`），C&K 對 `progressDiscard` 的回應者也要凍結進步卡手牌（`docs/aegis/work/2026-11-07-bots-seafarers.md:66`）。
- **通過條件**（每一格）
  - 0 次拒絕；在步數上限內分出勝者；沒有殘留 pending；看門狗沒有觸發。
  - 守恆：資源；commodity 合計 36 或 54；進步卡 54 張；棋子（騎士每級 ≤ 2、總數 ≤ `pieces.knights`、建築與騎士不同點）。這些檢查都由 kit 以公開 API 實作，不得直接使用 `checkSupplies`、`checkPieces`（§5）。
  - 仿 BotDriver 模式下：「策略閒置、但保底有動作」與「逐 Bot 每視窗超過 40 個指令」都判為失敗。
- **依據**
  - 步數：接近正式策略的組合最多 1950 步，不防禦也不打卡的退化對局最多 2581 步；6000 約為前者的 3 倍。
  - 看門狗：混席原型中，最長連續沒有人分數創新高的期間是 36 回合；退化對局 64–69 回合；真正打轉的那一局是 799 回合。72 是 36 的 2 倍。
  - 「得分」定義為任一玩家的公開分數創新高，因為失去城市會降分。

### 6.2 Q2 門檻（發布閘門；只計策略席位）

實測欄的數字來自天真原型 `plan-probe.ts … f1 mixed`：3、4、5、6 人各 10 局，standard 與 easy 混席。

| # | 指標 | 門檻 | 範圍 | 實測 |
|---|---|---|---|---|
| M1 | `knight.recruit` 與 `knight.activate` | 各 ≥ 1 | 每局策略席位合計（預設與發布都檢查） | 每局最少：招募 2–4 次、啟動 4–7 次 |
| M2 | 桌上最高的改良等級 | ≥ 3 | 每局 | 54 局混席與 standard 對局的最小值都是 3 |
| M3 | `progress.play` | ≥ 3 張 | 每局 | 混席每局最少 8–13 張；全 standard 的 6 人最少 5 張 |
| M4 | 守住蠻族（outcome = defenders） | ≥ 2 次 | 每格 10 局合計 | 9／13／10／3 |
| M5 | standard 席的失城率 | ≤ 35%，且低於 easy 席 | 每格 10 局合計 | standard 21–29%；easy 47–64% |
| M6 | 終局時持有的大都市 | ≥ 5 個 | 每格 10 局合計 | 12／20／14／15 |
| M7 | 打出過的 F1 卡種類 | ≥ 10／12 | 每格 10 局合計 | 每格 12／12 |
| M8（CK-C） | F2 的 10 種與 Alchemy；`progress.harborOffer` | 每種 ≥ 1；≥ 1 | 全部 C&K 格合計 | 天真原型打出 22 種中的全部 22 種（不含 Alchemy），intrigue 每格 1–5 次 |

- **推測**：門檻假設 B2 的策略不弱於天真原型。B2 要在開 gating 前先跑 `BOTS_SEEDS=10` 確認。
- M4–M8 只在種子數 ≥ 10 時檢查。
- **計數**（SF 的教訓）：事件欄位讀 `event.params.*`，不是頂層欄位（例如 `rules/test/ck-sim.ts:365`）；每局另外加一個交叉檢查，例如招募次數 ≤ 騎士棋子增加量。Q2 只計策略自己的答案，比照 SF 的 Q2-4 包裝 `answerFrame`（`docs/aegis/work/2026-11-07-bots-seafarers.md:55-56`）。

### 6.3 單元與 server 測試

- **I9 單元測試**（DoD §6.2）
  - 涵蓋：14 種 frame、含 commodity 的棄牌與 `progressExcess`。
  - 方法：以固定盤面，對 fallback、standard、easy 三種策略各驗一次合法性與偏好。
  - 工具：`packages/rules/test/ck-helpers.ts` 的 `emptyCkGame`、`handCards`、`playCard`、`actCk`、`addKnight`、`giveCommodities`。
- **另外的單元測試**
  - Smithing 選兩隻騎士時的棋子存量（C4）。
  - 規則 9：Bot 只持有 1 coin 時，對「1 wool 換 3 coin」回 declined；持有 3 coin 且划算時回 consented，而且 `trade.settle` 成功。
- **server 新檔 `packages/server/test/cities-knights-bots.test.ts`**（整體策略 §4.7 第 5 點；比照 `seafarers-bots.test.ts`，四類案例的結構可以照搬）
  1. 經 HTTP 跑完 `ck-2025` 3 人一局，0 次非 stale 的拒絕（範本 `seafarers-bots.test.ts:236`）。
  2. 注入會拋錯的策略，由保底代答 `citiesKnights.pillage`，不進入 30 s 退避（範本 `:302`）。
  3. `scienceBonus` 的 `responders[0]` 是真人時，Bot 要等待；之後 Bot 才回答。`progressDiscard` 由真人與 Bot 並存回答（範本 `:340`）。
  4. 在 `defenderDraw` 進行中重啟，之後能恢復（範本 `:395`）。
- **翻轉既有測試**：`packages/server/test/cities-knights.test.ts:124`、`:133`；`packages/server/test/bots.test.ts` 的三處：`:292` 翻轉，`:304` 改為 `['easy', 'standard']`，`:357-369` 的迴圈拿掉 `ck-2025`、只留 `sf-ck-new-shores-2025`。SF+CK 的 `seafarers-cities-knights.test.ts:152` 仍為 false。

### 6.4 Q3 bench（不擋發布；發布 PR 附表）

- **設定**：以 `--profile` 指定，每組 100 局。bench 每個人數自動跑四種組合（`bench/run.ts:65-80`），不寫自訂組合（E-7）：① 1 standard 對其餘 easy；② 1 standard 對其餘 naive；③ 全 standard；④ 全 easy。
  - `ck-2025`：3、4 人；`ck-paired-2025`：5、6 人。
  - 「上一版」對照是組合 ②：naive = base 策略加 C&K duty（`test/harness.ts:400-413`）。naive 不改良（C2），B2 先跑 `pnpm --filter @catan/bots bench 20 naive --profile ck-2025` 確認；若有局超過步數上限，Q3 表註明「naive 對照僅供參考」（E-8）。

| 指標 | 軟目標 | 依據 |
|---|---|---|
| standard 勝率 | ≥ 1.3 倍公平份額 | 〔推測〕 |
| naive 勝率 | ≤ 0.5 倍公平份額；改以組合 ② 的 standard 勝率判斷 | 〔推測〕 |
| 平均輪數 | 3 人 ≤ 40、4 人 ≤ 35、5 人 ≤ 25、6 人 ≤ 20 | 混席實測 33.2／26／17.9／14.7。bench 與 rules 的 ck-sim 對照用 `RULES_SIM_ROUNDS`（單位是 `stats.turns / players`，`bench/run.ts:53-62`）；B2 以種子 10000–10019 重新量測後填入，不沿用原列的 158／190／198／208 回合。〔實測，僅種子 1〕3 人 110 回合（36.7 輪）、4 人 130（32.5）、6 人 147（24.5） |
| 拒絕數；standard 的保底代答次數 | 0；0 | Q1 |
| 逐 Bot 每視窗指令數 | 最大 ≤ 30 | bench 只輸出最大值（`max cmds/window`，`bench/run.ts:234`），沒有 p95（E-7）；原型實測 p95 5–7、最大 10–16 |
| `decide` 耗時 | 平均 ≤ 0.5 ms、最大 ≤ 50 ms（乾淨的機器） | 〔推測〕；base 的平均為 0.012–0.043 ms |
| 機制計數 | 只報告 | 招募、啟動、升級；攻擊勝負；各席失城數；defender VP；大都市；各軌道等級分布；各卡種抽到、打出、棄掉的張數；harbor 報價數 |

### 6.5 CI 預算（收斂第一輪 §9 第 5 點）

- 天真原型每局 0.57／0.67／0.79／1.0 s（3–6 人，load 約 3.6）。正式策略估計每局 1–2 s〔推測〕。#138 之後 harness 每次投影都帶整局歷史（`test/harness.ts:134-136`）：〔實測，負載 0.1〕4 人 ck-sim 一局 1,158 筆事件，帶歷史投影 0.134 ms，不帶 0.070 ms（約每千筆加 0.06 ms），影響可以忽略（`rules/src/project.ts:282`）。
- **預設 3 個種子**：約 30 局，CPU 30–60 s，分散在 4 個檔案平行執行，wall 增加約 15–25 s。
- **發布 10 個種子**：約 90 局，CPU 90–180 s。
- **軟目標**：預設的 wall 增量 ≤ 20 s（乾淨的機器）；超過時，B-POLICY 只在 `BOTS_SEEDS ≥ 10` 時執行。

## 7. 文件與發布

### 7.1 文件更新清單（CK-G）

| 檔案:行 | 現況 | 修改 |
|---|---|---|
| `docs/SPEC.md:190` | Rulesets 段「Today that is the base game and Seafarers…」（0.4.1 改寫後的版本）；`:191` 的 hard 段不變 | 加入 `ck-2025`、`ck-paired-2025` |
| `docs/aegis/specs/2026-11-01-bot-opponents.md:17-19` | 支援清單；`:21` 的「範圍外」已不再提 C&K，不必刪 | 在支援清單後加一條 C&K |
| `docs/API.md:148-157` | 支援判定的說明「Today the base profiles and the two Heading for New Shores profiles…」（0.4.1 已改寫）；`:158-160` 的 hard 段不變 | 更新「today」清單 |
| `docs/API.md:481` | 「Bot seats are still refused on these profiles」 | 改為可以入座 |
| `docs/FIDELITY.md:41-42` | 「no bot seats」 | 改為支援 easy 與 standard 的 bot seats |
| `docs/FIDELITY.md:127` | R-CK service「bot seats refused」 | 改為可以入座；證據加 `packages/server/test/cities-knights-bots.test.ts` |
| `docs/FIDELITY.md`（`:127` 後新增一列） | — | R-CK bots：B-GAME、B-POLICY、B-FAIR、M1–M8，證據為 `packages/bots/test/ck-*.test.ts`；格式比照 `:120` 的 R-SF bots 列 |
| `docs/FIDELITY.md:658-661` | Known gaps 第 14 條「Bot seats are refused (no `@catan/bots` rule module)」 | 改為支援；若 CK-C 延後，註明「互動卡會回應，但不主動打出」 |
| `README.md:171` | 「Computer opponents are not available in this mode yet.」（C&K 條目） | 改為可加入電腦對手 |
| `README.md:178-179` | 「Bot seats are not offered for this combination.」（SF+CK 條目） | 不變：SF+CK 到 0.4.3 才開放 |
| `docs/screenshots/<slug>/README.md`、大廳截圖、`scripts/bots-seafarers/capture.py` 的 C&K 版 | SF-4 同時提交了這些（`e965eb7`） | CK-G 時再詢問使用者是否比照提交（E-9）；沒有授權時照 §7.2 放在 `.tmp/` |
| `docs/aegis/work/<date>-bots-cities-knights.md`、`docs/aegis/INDEX.md` | — | 新增工作紀錄（含 Q3 表與門檻實測），並在 INDEX 加一列 |

- `docs/FIDELITY.md:139`（R-COMB）與 `docs/API.md:475`（E&P）不變。大廳文案在 0.4.1 已改（SF-4 改成通用文案，`web/src/i18n/en.ts:288`、`zh-Hant.ts:285`），本版不動。

### 7.2 發布（整體策略 §7）

1. v0.4.1 stable 發布後，從 `master` 建立 `release/v0.4.2`。切片 PR 以 squash 合併，例如 `✨ feat(bots): play cities & knights core (#N)`。
2. CK-G 合併、QA 跑完 `BOTS_SEEDS=10` 的矩陣後，發 `v0.4.2-rc.1`。
3. Browser QA 試玩 `ck-2025` 4 人與 `ck-paired-2025` 5 人，席位混合 easy 與 standard；至少要看到招募與啟動騎士、`city.improve`、`progress.play`、pillage 或 defender frame，而且不會停住。截圖放在 `.tmp/`（D10）；是否提交大廳截圖，CK-G 時再詢問使用者（§7.1）。
4. 打 stable tag 前跑 `BOTS_SEEDS=10 pnpm verify`；發布 PR 附上 Q3 表。

### 7.3 CK-C 的退路

- **判定點**：rc.1 就緒時（CK-G 已合併、QA 矩陣全綠），CK-C 若還沒通過審查，0.4.2 就不帶 CK-C 發布。
- **不帶 CK-C 時的行為**
  - Bot 不打 F2 卡與 Alchemy。卡片價值表把這些卡評為低價，手牌超過上限時會先棄掉。
  - 全部 F2 frame 由 B1、B2 回應。
  - M8 不列入 0.4.2 的閘門。
- **移到 0.4.3**：CK-C 與 SF+CK 同版，因為兩者共用進度卡策略（整體策略 §5.2）。FIDELITY 的範圍註記要同步寫明。

## 8. Paseo 分工

派工前以 `list_profiles` 的實際結果為準。

| 順序 | 工作 | 角色 | 隔離 | 審查 |
|---|---|---|---|---|
| 0 | 依 0.4.1 合併後的實際 API 刷新本計畫，確認 §2.1 的前提 | Planner | 共用工作區（唯讀） | 主 agent（2026-11-11 完成，§12） |
| 0.5 | 定稿六個 0.4.2 economy 鉤子的簽章與組合語意（§4.6）：只改 `bots/modules/types.ts` 的型別與註解，作為 CK-B1 的第一個 commit（E-12），commit 後先回報主 agent，再接骨架 | Implementer（Backend）乙（同 CK-B1） | `.worktrees/bots-ck-economy/` | 主 agent、Architect |
| 1 | CK-A | Implementer（Backend）甲 | `.worktrees/bots-ck-exports/` | Reviewer（Sol）：I3／P8、命名 |
| 1′ | CK-B1，與 CK-A 並行起步 | Implementer（Backend）乙 | `.worktrees/bots-ck-economy/` | Architect 看掛點，因為 SF+CK 與 T&B 會重用；Reviewer（Opus）看 I9、合法性與 golden replay |
| 2 | CK-B2 | Implementer（Backend）乙，延續 B1 的脈絡 | `.worktrees/bots-ck-core/` | Reviewer（Sol）：決定性、B-FAIR、Q2、§4.9 清單 |
| 3 | CK-G；文件由主 agent 處理 | Implementer（Backend）甲 | `.worktrees/bots-ck-gate/` | Reviewer（Opus）：server 案例與文件 |
| 3′ | CK-C，與 CK-G 並行 | Implementer（Backend）丙 | `.worktrees/bots-ck-cards/` | Reviewer（Sol） |
| 4 | `BOTS_SEEDS=10` 的 Q1／Q2 矩陣與 bench | QA（只改測試） | 自己的 worktree | 主 agent |
| 5 | rc 的瀏覽器驗證 | Browser QA | 共用工作區 | 主 agent |
| 6 | rc 與 stable 的 tag、Release | Release Manager（需要使用者明確授權） | — | — |

- **共用檔**：`bots/src/{economy,board,trade,heuristic,turn,bank}.ts`、`bots/src/base/{duty,cards}.ts`、`bots/src/hard/build.ts`（只改型別）只屬於 CK-B1，`fallback.ts` 預計不必改；B2 需要的 `test/harness.ts`、`test/families.ts`、`bench/run.ts` 只增不改。B1 合併之後，任何 C&K 切片需要改這些檔案時，都要先回報主 agent。gating 不改 `support.ts`：它只看 `citiesKnightsBotModule.supports`，`botsCanPlay`、`hardSupports`、`botLevelsFor` 都不必改（`bots/support.ts:17-33`）。
- **閒置與限制**：閒置的 agent 把交接筆記寫到 `.worktrees/_handoff/` 後停止。subagent 不 push、不改 lockfile。

## 9. 風險

| # | 風險 | 對策 |
|---|---|---|
| K1 | 0.4.1 的實際介面與本計畫的假設不同，例如組合骨架是否受 `supports` 影響、golden replay 的檔名、harness 的 API | 依 §8 步驟 0 刷新計畫（已於 2026-11-11 完成，§12）；B1 開工前由主 agent 確認 |
| K2 | CardKind 化改變了 base 的行為 | golden replay 逐一比對 |
| K3 | hints 對單一目標合法，組合起來卻不合法（Smithing 已證實；其他推測：多目標卡） | 組合目標由策略逐一模擬；B-POLICY 必須 0 次拒絕；fuzz |
| K4 | Q2 門檻出自天真原型，正式策略可能偏離 | B2 先跑 10 個種子；未達標時由使用者決定調整門檻或策略（D-CK4） |
| K5 | 不防禦的長尾：6 人 1/8 局跑滿 15000 步 | easy 也要防禦（P9）；看門狗 72 回合；步數上限 6000 |
| K6 | 與真人同桌時一局變長（混席原型 11–44 輪） | 節奏表；用 bench 換算觀看時長 |
| K7 | B-FAIR 沒涵蓋進步卡身分與牌庫順序 | `hideDifferently` 的三種擾動；排除合法看得到手牌的 frame |
| K8 | 真人用含 commodity 的報價佔 Bot 便宜 | 規則 9 加上 CardKind 估值；Bot 不主動提出 |
| K9 | CK-C 延誤 | §7.3 的退路 |
| K10 | 高負載下測試逾時 | 拆檔平行；timeout 120 s；預設 3 個種子；#138 之後 harness 每次投影都帶整局歷史，實測影響可以忽略（§6.5） |
| K11 | 0.4.3 重用時才發現寫死 base 的假設，例如強盜位置、13 分、只看 `legalRoads` | 把 §4.9 列入 B2 的審查清單 |

## 10. 待使用者決定的事（2026-11-11 全數採用建議）

| # | 決策 | 建議 | 狀態 |
|---|---|---|---|
| D-CK1 | 防禦取向（第一輪 §9 第 2 點） | **個人理性**：只求自己不落入最低貢獻群；能在 ≤ 2 個動作內成為唯一最高貢獻者時，才去爭 defender VP；不為集體防守額外投資，因為那也會讓對手免於損失。實測顯示，個人理性的防禦已足以終局 | 已採用（2026-11-11） |
| D-CK2 | paired 的 Player 2 打 Commercial Harbor（第一輪 §9 第 3 點） | 照 engine 與 hints 的允許範圍做（P3-4 是開放詮釋）。日後若改詮釋，`hints.progress[].playable` 會讓 Bot 自動跟上。只在 CK-C 生效 | 已採用（2026-11-11） |
| D-CK3 | easy 是否打互動卡（第一輪 §9 第 6 點） | 不主動打 F2 與 Alchemy，只打 F1；全部 frame 照常回應。符合 SPEC「難度只影響選擇品質」 | 已採用（2026-11-11） |
| D-CK4 | Q2 門檻 | 採用 §6.2 的 M1–M8 | 已採用（2026-11-11） |
| D-CK5 | CI 預算（第一輪 §9 第 5 點） | 預設 3 個種子、發布 10 個（D7）；預設 wall 增量的軟目標 ≤ 20 s | 已採用（2026-11-11） |
| D-CK6 | 切片方式 | PR-B 拆成 CK-B1 與 CK-B2，gating 獨立成 CK-G | 已採用（2026-11-11） |
| D-CK7 | CK-C 延誤的判定點 | rc.1 就緒時 CK-C 仍未通過審查，就移到 0.4.3 | 已採用（2026-11-11） |
| D-CK8 | C&K 的每視窗上限 | 維持 40，不設 `maxCommandsPerWindow` | 已採用（2026-11-11） |

第一輪 §9 的第 1 點（rules 匯出）與第 4 點（版本安排）已由整體策略的 D3、D1 決定，本計畫照辦。

## 11. 與整體策略的差異

2026-11-04 主 agent 已把 X1–X3、X5–X7 併入整體策略（§3 P9、§4.1、§4.4、§4.6、§4.7、§4.9、§5、§5.2、R4）。X4 是 C&K 的命名慣例，符合 P8。整合 T&B 計畫時，C&K 的 family 測試檔明列自己的 profile，並登記在 `test/families.ts`，通用矩陣依策略 §4.6 跳過它們（§5 CK-B2）。SF+CK 計畫 §11-9 要求的修改已寫入 §4.1、§4.2、§4.6 與 §4.9 的對應列；它在 sf-ck 改寫 M2、不套用 M5、M7、M8，ck-* 的門檻不變。下表保留原始論證。

| # | 整體策略 | 本計畫 | 證據 |
|---|---|---|---|
| X1 | §4.7 第 3 點、§5、R4：「C&K 6 人原型已達 32 個」，接近上限 | 32 是全桌合計，逐 Bot 最多 16、p95 ≤ 7。C&K 不必提高上限；R4 對 C&K 的描述應改為「逐 Bot ≤ 16」 | C1 |
| X2 | P9：「C&K 不防禦……無法終局」 | 結論不變（easy 也要防禦），但主因不同：不防禦、但會改良的對局 53/54 局終局；只補 duty（不改良）的原型要 376–771 回合，部分撞到 8000 步上限（第一輪報告 §3）。建議 P9 改寫為「C&K 不改良就無法終局；不防禦會有長尾」 | C2 |
| X3 | §4.1 的 `economy` 只列 `cardKinds`、`routeEdge` 等 | PL-1 已把 `rates`、`weights`、`vertexBlocker`、`siteBlocked` 等列入保留型別（`bots/modules/types.ts:80-87`）；0.4.2 的工作是定稿六個鉤子（`hexYield` 加上 `city`）並接上骨架，由 CK-B1 的第一個 commit 完成 | §4.6 |
| X4 | §4.3：匯出「C&K 的成本與商品常數」 | 名稱加 `CK_` 前綴，沿用 E&P 的別名慣例；frame data 型別不由 rules 匯出 | `packages/rules/src/index.ts:15-20`；§4.7 |
| X5 | §4.4：`supports` 用於判定 part 與 mission | 開發期間也把 `supports` 當成發布旗標（`CK_BOTS_RELEASED`），到 CK-G 才翻轉；不必改 `support.ts` | §5 |
| X6 | §4.6 看門狗：「連續 N 回合沒有任何人得分」 | 把「得分」定義為「任一玩家的公開分數創新高」，因為失去城市會降分 | §6.1 |
| X7 | §5 的規模：約 2,600–3,000 | 約 2,750–3,400；多出的部分是 CK-G 的 server 測試與 B1 的平台掛點測試 | §5 |

## 12. 2026-11-11 刷新

0.4.1 合併後、0.4.2 開工前，Planner 依 `3664868`（`release/v0.4.2` 的起點，與計畫基準 `a200840` 相隔 46 個 commit）逐項核對本計畫的引用，並在 scratch 副本上以 tsc 驗證 §4.6 的鉤子簽章與 `Hand`／`Cost` 的型別放寬。**沒有阻擋開工的問題**；§2.1 的前提成立。行號與證據已併入各節，主要更正如下：

- 第 0.5 步的範圍改為定稿六個 economy 鉤子的簽章與組合語意；`hexYield` 加 `city` 參數（§4.6、§8）。
- 棄牌保底與其他張數類迴圈不經 `cardKinds` 鉤子，直接走 `CARD_KINDS`；整體策略 §4.1 同步改寫（§4.2、§4.5、§4.6）。
- 骨架只認 5 種資源的幾處（`discardDecision`、`offerTermsKnown`、`handUtility` 等）列入 CK-B1；`planStep` 補進 §4.1。
- CK-B1 的檔案所有權補上 `turn.ts`、`base/duty.ts`、`base/cards.ts`、`bank.ts`、`hard/build.ts` 與 `support.test.ts`（§5）。
- kit 不得 import `rules/test/ck-checks.ts`（§5）；CK-A 要在 `ModuleViewMap`／`ModuleHintsMap` 加 `citiesKnights`（§4.7）；CK-G 的範圍擴大到 `server/test/bots.test.ts` 等（§5、§6.3）。
- 測試與 bench 的現況：`PROFILE_LIMITS` 與 family 登記、bench 沒有 p95 與自訂組合（§5、§6）。
- #153 之後 `scienceBonus` 仍可用 `view.bank[r] > 0` 判斷存量，但不能用投影張數排序（§4.3）。
- 刷新之後，CK-A 已於 #154（`5d781a2`）合併進 `release/v0.4.2`：§4.7 與 §5 的 CK-A 列保留為設計記錄；本計畫的行號仍以 `3664868` 為準，`packages/rules/src/index.ts` 與 `ck/index.ts` 在 #154 之後的行號會移動。

**主 agent 的決定**（針對 Planner 報告的 E-1–E-13；§10 的 D-CK1–D-CK8 全數採用建議）

| # | 問題 | 決定 |
|---|---|---|
| E-1 | 手牌型別怎麼放寬 | 交集型別：`Hand = Record<Resource, number> & Partial<Record<Commodity, number>>`、`Cost = Partial<Record<CardKind, number>>`；`Yield`、`Economy.weights`／`rates` 同理。commodity 鍵只在有值時才寫入，base 的物件形狀不變（§4.5） |
| E-2 | 組合後的盤面掛點放在哪 | `BoardModel` 的可選欄位 `blocker?`、`siteBlocked?`、`hexYield?`，由 `boardModel(view, selfId, modules = [])` 建立，`Turn` 傳入模組；沒有模組時省略，tracker 與 hard 仍是 base（§4.6） |
| E-3 | 棄牌與張數是否經 `cardKinds` 鉤子 | 不經。張數類迴圈（`handOf`、`handSize`、`canAfford`、`deficitOf`、`pay`、`handList`、`proposerCanPay`）直接走 `CARD_KINDS`；估值類走 `Economy.kinds`（§4.5、§4.6） |
| E-4 | `weights`／`rates` 能不能覆寫資源 | 不能，只回答模組自己的卡種；資源偏好由 C&K 的計畫價值表達（§4.6） |
| E-5 | 測試檔命名與拆分 | 比照 SF：B1 為 `ck-duty`、`ck-economy`、`ck-model`；B2 為 `ck-decisions`、`ck-frames`、`ck-game`、`ck-fair`、`ck-fuzz`、`ck-fallback`；server 為 `cities-knights-bots.test.ts`（§5、§6.3） |
| E-6 | kit 歸哪個切片 | B1 建立 `test/modules/citiesKnights.ts`（conservation、hideDifferently、perturb、responseCommands），不 import `rules/test/ck-checks.ts`；B2 加 `mechanics`（§5） |
| E-7 | Q3 的 p95 與自訂組合 | 刪掉 p95，改看 `max cmds/window ≤ 30`；用 bench 預設的 ①–④，不寫自訂組合（§6.4） |
| E-8 | 「上一版」對照的 naive 座位會不會跑不完 | B2 先檢查 naive 對照；若有局超過步數上限，Q3 表註明「naive 對照僅供參考」（§6.4） |
| E-9 | CK-G 要不要像 SF-4 一樣提交大廳截圖與 capture 腳本 | 延到 CK-G 時再詢問使用者（§7.1） |
| E-10 | C&K 的 `supports` 要不要排除含 `seafarers` 的 profile | 不需要；`seafarersCitiesKnights` 沒有註冊，`botsCanPlay` 必為 false（§1） |
| E-11 | `dedupeCandidates` 對巢狀 payload 的鍵 | B1 改成遞迴正規化並補測試（§4.6） |
| E-12 | 第 0.5 步的提交時機 | 併入 CK-B1 的第一個 commit：只改 `types.ts` 的型別與註解，commit 後先回報主 agent，再接骨架（§5、§8） |
| E-13 | 文件刷新由誰提交 | 主 agent 以一個 docs PR 提交本計畫與整體策略的更正（分支 `docs/bots-ck-plan-refresh`） |
