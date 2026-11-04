# Cities & Knights 電腦對手：實作計畫（v0.4.2）

日期：2026-11-04。狀態：**建議計畫，待使用者確認 §10。**

前置閱讀：整體策略 `docs/aegis/plans/2026-11-04-expansion-bots-roadmap.md`（以下簡稱「整體策略」）；bot 規格 `docs/aegis/specs/2026-11-01-bot-opponents.md`（I1–I9、§5 合約）；`docs/SPEC.md` §4.9；`docs/FIDELITY.md` 的 C&K 段落 `:41-42`、`:120-126`、`:418-458`；`packages/rules/src/modules/README.md`。

證據：第一輪 C&K 報告收錄在 `docs/aegis/work/2026-11-04-bots-cities-knights-research.md`；本輪探查 `plan-probe.ts` 放在 `/tmp/katan-bot-research/cities-knights/`，不提交；基準 `a200840`。本輪約 210 局，load average 1.8–4.5；耗時只是參考值，結論只依步數、局數、拒絕數與機制計數。數據出自**天真原型**（base 策略＋C&K duty＋改良＋騎士防禦＋「能打就打」的進步卡），用來估計門檻量級，不是提案程式碼。

路徑縮寫：`ck/` = `packages/rules/src/modules/citiesKnights/`；`sfck/` = `packages/rules/src/modules/seafarersCitiesKnights/`；`bots/` = `packages/bots/src/`；`engine.ts` = `packages/rules/src/engine.ts`。

**要點**

1. **切片**：CK-A（rules 匯出）→ CK-B1（commodity 經濟、14 種 frame 的保底、0.4.2 平台掛點）→ CK-B2（核心策略）→ CK-G（開放 gating）。CK-C（互動進度卡）可與 CK-G 並行，也可以延到 0.4.3。
2. **修正第一輪的三點**（§2.3）：「6 人單一視窗 32 個指令」是全桌合計，逐 Bot 最多 16 個，不必提高上限；只補 duty 無法終局的主因是不改良；進步卡超過上限時保底會無聲停住，而不是被否決。
3. **Q2 門檻**（§6.2）以原型實測為依據；推測的部分另外標明。

## 1. 目標與範圍

| profile | 人數 | `ruleModules` | 規則版本 | VP | 來源 |
|---|---|---|---|---|---|
| `ck-2025` | 3–4 | `['citiesKnights']` | `ck-2025.1` | 13 | `packages/rules/src/profiles.ts:418-430` |
| `ck-paired-2025` | 5–6 | 同上 | 同上 | 13 | `packages/rules/src/profiles.ts:432-449` |

- **目標**
  - 兩個 profile 在每種人數都能加入 `easy` 與 `standard`。0.4.2 發布時通過 Q1 與 Q2（整體策略 §3.1、§6）。
  - 兩種難度都會發出 C&K 指令（騎士、改良、進步卡），並能回應全部 14 種模組 frame，以及含 commodity 的棄牌。
- **非目標**
  - SF+CK 排在 0.4.3。本版只保留掛點（§4.9），`sf-ck-*` 的 `botSeats` 必須維持 false（`packages/server/test/seafarers-cities-knights.test.ts:150`）。
  - Bot 不主動提出含 commodity 的國內報價，只估值與回應（比照整體策略 D6）。
  - 不讀 `view.events`，不新增 hints，不改 rules 的規則行為（P4、P8）。
  - 互動型進步卡（F2，共 10 種）與 Alchemy 放在 CK-C；延誤時移到 0.4.3（§7.3）。

## 2. 現況與落差

### 2.1 依賴的 0.4.1 平台交付（整體策略 §4.9–4.10）

| 0.4.1 交付 | C&K 的用途 |
|---|---|
| `BotCommand`；`Decision.command`（PL-1、PL-3） | 送出 23 個模組指令 |
| registry、`botsCanPlay` 加上 `supports`、可玩清單快照（PL-1） | 開放 `ck-*`；SF+CK 仍然關閉 |
| 組合骨架（PL-1）：`answerFrame`、`duty`、`setup` 依序詢問；`actions`、`preroll` 串接評分 | 處理 frame、行動候選、第 2 輪城市與 Alchemy |
| fallback 順序（PL-1）：base `pendingDuty`（套用 `cardKinds`）→ 模組 `duty` → roll／end | 14 種 frame 與 `progressExcess` 的保底 |
| 合約規則 3、4、8、9 與 I3 改寫（PL-1） | 非行動者回應 frame；拒絕無法估值的報價 |
| harness `newBotGame({ profileId })`、`BOT_TEST_MATRIX`、`test/modules/<id>.ts`、仿 BotDriver 模式、看門狗、`BOTS_SEEDS`、120 s timeout（PL-2） | Q1 與 Q2 |
| bench `--profile`；輸出拒絕數、保底次數、機制計數、每視窗指令數（PL-2） | Q3 |
| server 端：`BOT_PACING` 合併、依 profile 取上限、「欠動作卻沒有動作」的診斷（PL-3） | 套用 `pacing`；上限維持 40 |
| golden replay：base 3–6 人各 10 個種子（PL-1） | 證明 CK-B1 沒有改變 base 行為 |

**前提**：組合骨架只依 registry 查模組，不受 `supports` 影響。若 PL-1 不是這樣寫，CK-B1／B2 的測試改用測試專用的 registry 覆寫。

### 2.2 第一輪落差 G1–G18 的歸屬

| 落差 | 內容 | 解決位置 |
|---|---|---|
| G1、G2、G15 | 模組 frame 回 null；`decide` 的回傳型別 | 0.4.1 骨架；CK-B1 `duty` |
| G3–G7 | 手牌只有 5 種資源；含 commodity 的棄牌；報價估值 | CK-B1（§4.5、§4.6） |
| G8、G13 | plan 只有 4 種；`handRelief` 依賴發展卡牌庫 | CK-B2（`scoreExtras` 提供 improve、knight、activate、wall；以城牆、啟動騎士、commodity 換牌消化手牌） |
| G9–G11 | 騎士阻擋；城市產出 | CK-B1 的 board 掛點（§4.6） |
| G12 | 第 2 輪放的是城市 | CK-B2 `setup` |
| G14 | 發展卡邏輯 | 不改：`devDeckSize = 0` 時不會觸發（`bots/economy.ts:248`） |
| G16 | 進步卡超過上限 | CK-B1 `duty`（見 §2.3 C3） |
| G17、G18 | harness 只認 base；`THINK_MS` 缺模組指令 | 0.4.1 PL-2、PL-3；C&K 提供模組測試工具與 `pacing` |

### 2.3 本輪核實後修正的結論

| # | 第一輪說法 | 核實結果 | 證據 |
|---|---|---|---|
| C1 | 6 人單一視窗最多 32 個指令，接近上限 40 | 32 是全桌合計：原型只在 `windowId` 改變時歸零，沒有分座位。BotDriver 的上限是逐 Bot 計算。逐 Bot 實測 p95 為 5–7，最大 10–16 | `proto.ts` 的計數；`packages/server/src/bot-driver.ts:303`、`:392`；`plan-probe.ts` 3–6 人全部組合 |
| C2 | 只補 duty 不夠，因為沒人蓋騎士 | 主因是不改良：完全不防禦、但會改良的原型 54 局中有 53 局終局，13–89 輪。不防禦仍有長尾：6 人 seed 8 跑滿 15000 步，共 240 輪、失守 101 次 | `plan-probe.ts <n> 6/8 {f1,none} none` |
| C3 | 進步卡超過上限時，fallback 送出 `turn.end` 被否決 | `hints.canEndTurn` 已反映否決，所以 fallback 與 heuristic 都回 null，整桌無聲停住（G-A），不是被拒 | `bots/fallback.ts:78`、`bots/heuristic.ts:455`、`engine.ts:2071`、`ck/progress.ts:145-149` |
| C4 | hints 的 targets 就是合法目標 | 單一目標合法，組合不一定合法。Smithing 依序檢查兩隻騎士，第一隻可能用掉最後一個高一級的騎士棋子，第二隻就會 `E_ILLEGAL_TARGET`（天真原型 6 人有 1/6 局發生） | `ck/cards-science.ts:191-194`、`ck/knights.ts:133-138` |
| C5 | 同意報價時 engine 不檢查付不付得起 | 成立：同意時只檢查 goods，確認時才檢查手牌 | `engine.ts:1873-1876`、`:1973-1978` |

## 3. 介面摘要（只列策略與保底需要的部分）

- **指令**（`ck/index.ts:151-190`）
  - action 指令：`build.wall`、`city.improve`、`knight.{recruit,activate,promote,move,displace,chaseRobber}`、`progress.play`、`progress.harborOffer`。
  - pending 指令共 13 個（`:176-190`）。
  - preroll 只有 `progress.play {card:'alchemy'}`。
  - 停用 5 個 base 發展卡指令（`:149`）。
  - base 的 `pending.discard` 與 `trade.bank` 已接受 `CardKind`（`engine.ts:93`、`:97`）。
- **hints**（`ck/index.ts:268-307`，都**不檢查成本**）
  - 只在自己的 action 且沒有 pending 時：`recruitSites`、`knights[]`（`canActivate`、`canPromote`、`canAct`、`moves`、`displace`、`chase`）、`wallSites`、`improvements[]`。
  - 隨時：`knightSupply`、`commodityRates`、`costs`、`progressExcess`、`progress[]`（`targets` 只在 `playable` 時填入）、`harborTargets`。只給該 frame 的 responder：`retreat`、`pillage`；只給 `responders[0]`：`defenderDecks`、`scienceBonus`。
- **常數**（`ck/constants.ts`、`ck/cards-science.ts:18,21`）：wall 2 brick；knight 與 promote 為 wool＋ore；activate 為 grain；medicine 為 grain＋2 ore；第 n 級改良要 n 張 commodity。進步卡手牌上限 4；蠻族軌道長 7；事件骰 6 面中 3 面是船；level L 在紅骰 ≤ L＋1 時抽卡；3 級得能力、4 級可取大都市；城牆上限 3，每座棄牌上限 +2。
- **蠻族攻擊**（`ck/barbarians.ts:61-139`）：蠻族強度 = 城市數（含大都市），防守強度 = 已啟動騎士等級和，平手算防守方贏。失守時，有可掠奪城市者中貢獻最低的那一群各失一座城市（大都市免疫）。攻擊後全部騎士變回未啟動；第一次攻擊時強盜上場。
- **隱藏資訊**（B-FAIR）
  - 對手的資源與 commodity 組成、進步卡身分、牌庫順序。
  - 只有行動者看得到：`guildDues.hand`、`espionage.cards`。harbor 的資源只有交換雙方看得到（`ck/cards-trade.ts:234-244`、`ck/cards-politics.ts:507-511`）。
- **paired 的 Player 2**：不擲骰、沒有 Alchemy、不做國內交易，但可打進步卡；打 Commercial Harbor 屬於開放詮釋 P3-4（`docs/FIDELITY.md:437-442`）。Player 1 擲骰時，Player 2 持有超過 4 張進步卡就要當場棄牌（`:454-458`）。

## 4. 設計

### 4.1 BotModule 的對應

檔案都放在 `bots/modules/citiesKnights/`。

| 鉤子 | 檔案 | 內容 | 切片 |
|---|---|---|---|
| `duty` | `duty.ts` | §4.2 的保底 | B1 |
| `answerFrame` | `frames.ts` | §4.3 的 frame 偏好；B1 期間由 `duty` 代答 | B2 |
| `setup` | `setup.ts` | 第 2 輪城市選點；其餘回 undefined，交給 base | B2 |
| `preroll` | `preroll.ts` | Alchemy | B2 建 stub，C 實作 |
| `actions` | `defense.ts`、`improve.ts`、`knights.ts`、`cards.ts`、`trade.ts`；`cards-interactive.ts`、`tactics.ts` | 行動候選，分數尺度為「勝利分當量 ÷ (1 + eta)」 | B2；後兩檔由 B2 建 stub，C 實作 |
| `economy.*` | `economy.ts`；`plans.ts` | `cardKinds`、`rates`、`weights`、`costs`、`hexYield`、`vertexBlocker`、`siteBlocked`；`scoreExtras` | B1；`plans.ts` 在 B2 |
| `supports` | `index.ts` | 回傳 `CK_BOTS_RELEASED` 常數；CK-G 才改為 true | B1 → G |
| `pacing`、`responseCommands` | `index.ts` | §4.8；13 個 pending 指令 | B1 |
| 存取與建構 | `view.ts` | `ckView`、`ckHints`、frame data 型別守衛、指令建構函式 | B1 |
| `robberTargets`、`phase`、`endWindow`、`freeRouteCandidates`、`trade.goods` | — | 不使用 | — |

### 4.2 保底表（I9；合約規則 7）

- 只取 view、hints 或 frame data 的第一個合法選項。
- 資格判定依 P3，一律採保守的 `responders[0] === self`。依序 frame（`defenderDraw`、`scienceBonus`）的 handler 本身就要求第一位回應（`ck/barbarians.ts:193`、`ck/production.ts:139`）。
- 本輪約 210 局中，duty 本身 0 次被拒。

| frame 或強制動作 | 最小動作 | 為何必定合法 | 證據 |
|---|---|---|---|
| base `discard`（含 commodity） | `pending.discard`：依 `CARD_KINDS` 順序展開手牌，交出前 `required[self]` 張 | 應棄張數依總牌數計算，展開後的清單一定夠長；engine 接受 CardKind | `engine.ts:1563-1580`、`ck/index.ts:105-107` |
| base `moveRobber`（7 點或追強盜） | 沿用 base：第一個不是目前位置、也不是海的格子；SF+CK 中改由 0.4.3 的 fold 集合決定（SF+CK 計畫 §4.2） | C&K 沒有 `moveBandit` 限制；首次攻擊前不會出現 | `bots/fallback.ts:19-25`、`ck/index.ts:109-111` |
| base `steal` | `candidates[0]` | 偷到 commodity 不影響合法性 | `bots/fallback.ts:26-30` |
| base `freeRoads`（Road Building 卡） | `hints.legalRoads[0]` | 已有測試 | `packages/bots/test/ck-road-building.test.ts`、`ck/cards-science.ts:221-229` |
| `citiesKnights.pillage` | `barbarians.pillage {vertex: data.cities[self][0]}` | 只有 2 座以上可掠奪城市才會出 frame，否則自動掠奪 | `ck/barbarians.ts:83-88`、`ck/index.ts:251-252` |
| `citiesKnights.displaced` | `knight.retreat {vertex: data.options[0]}` | 沒有退路時騎士直接移除、不出 frame；options 是即時投影。注意這個指令沒有 null 選項 | `ck/knights.ts:277-283`、`:296-311`、`ck/index.ts:253-256` |
| `citiesKnights.defenderDraw`（依序） | `barbarians.chooseDeck {track: data.decks[0]}` | data 只列非空牌組；空牌組由 `skipEmptyDecks` 跳過 | `ck/index.ts:259-260`、`ck/barbarians.ts:122` |
| `citiesKnights.progressDiscard` | `progress.discard {cards: progressCards 的前 required[self] 張}` | 張數就是超出量 | `ck/progress.ts:103-142`、`ck/index.ts:257-258` |
| `citiesKnights.scienceBonus`（依序） | `science.take {resource: null}` | 只有明確的 null 合法；`undefined` 會被拒 | `ck/production.ts:134-150` |
| `citiesKnights.harborExchange` | `progress.harborAnswer {commodity: 第一種持有的 commodity}` | 接收方持有 2 種以上 commodity 才會出 frame | `ck/cards-trade.ts:68-79`、`:92-101` |
| `citiesKnights.guildDues`（行動者） | `progress.takeCards`：把 `data.hand` 依 `CARD_KINDS` 展開，取前 `data.count` 張 | `hand` 只給行動者，且是即時投影 | `ck/cards-trade.ts:144-156`、`:239-244` |
| `citiesKnights.espionage`（行動者） | `progress.takeProgress {card: null}` | null 一定合法 | `ck/cards-politics.ts:203-215` |
| `citiesKnights.sabotage`、`citiesKnights.wedding` | 交出展開手牌的前 `data.required[self]` 張 | handler 只檢查張數與是否持有 | `ck/cards-politics.ts:344-356` |
| `citiesKnights.treasonRemove`（受害者） | `progress.treasonRemove {vertex: data.knights[0]}` | data 列的是受害者自己的騎士 | `ck/cards-politics.ts:458-468`、`:515-516` |
| `citiesKnights.treasonPlace`（行動者） | `progress.treasonPlace {vertex: null}` | null 分支不檢查 level | `ck/cards-politics.ts:470-477` |
| `citiesKnights.diplomacyRoad`（行動者） | `progress.diplomacyRoad {edge: null}` | null 一定合法，SF+CK 帶 `ship` 時也一樣 | `ck/cards-politics.ts:137-150` |
| `citiesKnights.resolveRoll` | 不動作 | responders 為空，是續行 frame | `ck/index.ts:143-145`、`ck/dice.ts:25` |
| 自己的 action、沒有 pending、`progressExcess > 0` | `progress.discard {cards: progressCards 的前 progressExcess 張}`，之後才 `turn.end` | 這時 `canEndTurn` 為 false，這是唯一能解除否決的動作（C3） | `ck/index.ts:297`、`ck/progress.ts:118-122` |
| preroll、setup（第 2 輪放城市）、action 結束 | 沿用 base：`turn.roll`、`legalSettlements[0]`、`turn.end` | 第 2 輪仍然是 `setup.placeBuilding` | `bots/fallback.ts:62-80`、`ck/index.ts:90-92` |

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
| action：交易 | 銀行交易可用 commodity，匯率讀 `commodityRates`；國內報價沿用 base，只含資源 | §4.5 |
| frame 偏好 | 見下表 | 第一輪 §5G |

frame 偏好：

| frame | 選擇 |
|---|---|
| `discard` | 保留首要 plan 需要的牌，棄多餘的 |
| `pillage` | 產值加城牆價值最低的城市 |
| `defenderDraw` | 主軌道的牌組 |
| `scienceBonus` | 最缺、且銀行仍有存量的資源（否則 `E_BANK_EMPTY`，`ck/production.ts:146`） |
| `progressDiscard`、`espionage` | 依卡片價值表；F2 卡在 CK-C 之前評低價 |
| `harborExchange`、`sabotage`、`wedding`、`treasonRemove` | 交出最低價值的牌，或最弱、未啟動的騎士 |
| `treasonPlace` | 阻擋價值最高的點，選允許的最高等級 |
| `diplomacyRoad` | 最能延伸路線的邊 |

### 4.4 easy（P9；D-CK3）

- 沿用 `LEVEL_PARAMS.easy` 的 `topK 3`（`bots/heuristic.ts:63-66`）。
- **防禦**：只在 `position ≥ 6` 時反應，目標是不落入最低群，做法是招募 1 隻騎士再啟動。實測 easy 防禦的對局 48/48 終局。
- **改良**：一定要做（C2），但只升持有 commodity 最多的那一軌。
- **進步卡**：只打 F1，條件放寬或延後到手牌上限時才打。不打 F2 與 Alchemy，但全部 frame 照常回應。

### 4.5 commodity 經濟與報價（合約規則 9；整體策略 §4.8）

1. **手牌型別**：`Hand` 改為 `Record<CardKind, number>`。卡種清單 = `RESOURCES` 加上各模組的 `cardKinds`。`canAfford`、`deficitOf`、`pay`、`costTotal` 都改為逐一走這份清單。base 的 commodity 恆為 0，因此 golden replay 不變。
2. **匯率**：資源讀 `hints.bankRates`，commodity 讀 `hints.modules.citiesKnights.commodityRates`。後者與 engine 的 `bankRateFor` 一致（`ck/index.ts:294`、`engine.ts:1712-1720`）。
3. **權重**：commodity 的權重 = 對主改良軌道的需求（下一級成本減去持有量），再加上依匯率換算的流動性。
4. **回應報價**，依序判斷：
   1. 報價含 `giveGoods` 或 `wantGoods`，或含 `cardKinds` 以外的卡種：拒絕。
   2. 以 CardKind 判斷 `!canAfford(hand, offer.want)`：拒絕。這修正了「同意自己付不起的報價」：engine 要到確認時才檢查（`engine.ts:1976-1978`）。
   3. 其他情況：照原本的效用與門檻判斷。
5. **行動者的反報價**：`proposerCanPay`（`bots/heuristic.ts:426`）改為以 CardKind 計算張數。
6. **不主動提出 commodity 國內報價**：`proposeOffer` 的 `nextCost` 只會來自資源 plan。

### 4.6 0.4.2 平台掛點（CK-B1 交付；base 行為不變，以 golden replay 驗證）

| 掛點 | 在 base 檔案的消費位置 | C&K 實作 |
|---|---|---|
| `economy.cardKinds`、`rates`、`weights` | `bots/economy.ts:22-31`（`Hand`、`handOf`）、`:57-70`；`bots/trade.ts:19-44`；`bots/heuristic.ts:169-192`（棄牌）、`:426`；`bots/fallback.ts:47-57`（`handList`） | commodity、`commodityRates`、改良需求 |
| `economy.costs` | `bots/economy.ts` 的 plan 成本 | knight、activate、promote、wall、medicine 與改良（n 張 commodity） |
| `economy.hexYield` | `bots/board.ts:103-130`（`vertexYield`、`playerYield` 的 `factor = city ? 2 : 1`） | 森林、牧場、山脈上的城市產出 1 資源加 1 commodity（`ck/production.ts:34-70`）。對非 `TERRAIN_COMMODITY` 地形回 `undefined`，讓 SF 的金礦處理生效（SF+CK 計畫 A2、§4.6） |
| `economy.vertexBlocker`（新增） | `bots/board.ts:154-157` 的 `opponentAt`，供 `searchRoads`（`:171`）與 `routeLength`（`:223`）使用 | 對手騎士封路，但不封自己（`ck/index.ts:122-124`；`docs/FIDELITY.md:120` R-CK knights） |
| `economy.siteBlocked`（新增） | `bots/board.ts:96-100` 的 `isFreeSpot` | 任何騎士所在的點都不能建造（`ck/index.ts:126-128`） |

`bots/modules/types.ts` 的四個新增欄位由主 agent 提交，因為主 agent 擁有合約檔（整體策略 §8）。

### 4.7 rules 匯出（CK-A；P8）

- 只在 `packages/rules/src/index.ts` 新增匯出，並在 `ck/index.ts` 加兩行型別別名，比照 E&P（`packages/rules/src/modules/explorersPirates/index.ts:285`、`:368`）。
- 名稱加 `CK_`／`Ck` 前綴，比照 E&P 的別名慣例（`packages/rules/src/index.ts:12-13`），避免 `TRACKS`、`MAX_LEVEL`、`Track` 這類通用名稱撞名。

| 類別 | 匯出 |
|---|---|
| 型別 | `CitiesKnightsView = ReturnType<typeof projectCitiesKnights>`（`ck/index.ts:212`）、`CitiesKnightsHints = ReturnType<typeof citiesKnightsHints>`（`:268`）、`ImprovementOption`（`ck/cities.ts:101`）、`ProgressCardHint`（`ck/cards.ts:55`）、`BlockReason`（`ck/card-common.ts:22`）、`CkTrack`、`CkKnightLevel`、`CkEventFace` |
| 常數 | `CITIES_KNIGHTS`、`CK_TRACKS`、`CK_TRACK_COMMODITY`、`CK_MAX_LEVEL`、`CK_ABILITY_LEVEL`、`CK_METROPOLIS_LEVEL`、`CK_PERMANENT_METROPOLIS_LEVEL`、`ckDrawThreshold`、`CK_WALL_COST`、`CK_KNIGHT_COST`、`CK_PROMOTE_COST`、`CK_ACTIVATE_COST`、`CK_MAX_WALLS`、`CK_WALL_HAND_BONUS`、`CK_KNIGHTS_PER_LEVEL`、`CK_BARBARIAN_TRACK_LENGTH`、`CK_PROGRESS_HAND_LIMIT`、`CK_EVENT_FACES`、`CK_PROGRESS_DECKS`、`CK_VP_PROGRESS_CARDS`、`CK_MEDICINE_COST`、`CK_FIXED_DISCS` |
| frame kind | 14 個常數，定義在 `ck/barbarians.ts:29-30`、`ck/knights.ts:43`、`ck/progress.ts:36`、`ck/production.ts:24`、`ck/dice.ts:25`、`ck/card-common.ts:12-19` |
| 不匯出 | frame data 型別：rules 沒有宣告這些型別。由 bots 的 `view.ts` 以型別守衛宣告，並由 CK-B1 的 frame 測試對照真實投影鎖住形狀 |
| 已匯出 | `COMMODITIES`、`CARD_KINDS`、`TERRAIN_COMMODITY`、`CardKind`、`ProgressCardType` |

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

  換算觀看時間：一個行動視窗 p95 約 7 個指令，約 6–7 s，加上擲骰演出 2.8 s（`packages/server/src/bot-driver.ts:66`）。最多 16 個指令時約 15 s。
- **每視窗上限**：不設 `maxCommandsPerWindow`，沿用預設 40。
  - 實測逐 Bot 最多 16 個（C1），打全部 22 種卡時也只有 13–16 個。
  - Commercial Harbor 每張卡最多讓 Bot 對 N−1 位對手各報價一次，6 人時兩張卡最多 12 個指令，仍在上限內。
  - 策略不必合併動作。
  - Q1 以仿 BotDriver 模式套用同一個 40 的上限，超過就判失敗；Q3 對超過 30 的情況提出警示。

### 4.9 為 0.4.3 SF+CK 保留的掛點（〔推測〕表示依賴 0.4.1 或 0.4.3 的實作）

| 掛點 | 設計 | 依據 |
|---|---|---|
| 首次攻擊前強盜不在盤面上 | 一律讀 `robberActive`，不假設 `view.board.robber >= 0` | `sfck/index.ts:147` |
| 追擊海盜 | `knights.ts` 匯出 `chaseValue(turn, hex, bandit)` 與候選建構函式；SF+CK 模組依 `pirateChase` 產生 `knight.chasePirate` 候選 | `sfck/index.ts:168`、`:186` |
| 騎士封住船路 | `vertexBlocker` 也要供 SF 的海路 BFS 使用；由 0.4.3 的 SFCK-P 把 `sea.ts` 的 `blocker` 預設改為組合後的 `vertexBlocker`（SF+CK 計畫 §4.6） | `sfck/index.ts:24-27` |
| Road Building 可以放船 | 判斷要不要打 roadBuilding 時，用組合後的 `freeRouteCandidates`，不只看 `legalRoads` | `ck/cards-science.ts:227-228` |
| Diplomacy 重建船 | `diplomacyRoad` 依 `data.ship` 選擇路線模型；保底仍是 null | `ck/cards-politics.ts:141`、`:523` |
| merchant 不放金礦；Taxation 只移動強盜 | 一律以 `targets.hexes` 為準 | `sfck/index.ts:163`、`ck/cards-politics.ts:379` |
| 勝利分是 16 | 估值用 `view.victoryTarget`，不寫死 13 | `packages/rules/src/profiles.ts:470` |
| 金礦不產 commodity | `hexYield` 只依 `TERRAIN_COMMODITY` 給 commodity | `rules/types.ts:41-45`、`sfck/index.ts:153` |
| 組合模組先攔截 | 非 C&K frame 一律回 undefined；強盜或海盜的選擇交給 SF+CK | 整體策略 §4.2 |

## 5. 切片與 PR

- 分支命名為 `feat/bots-ck-<slice>`；worktree 放在 `.worktrees/bots-ck-<slice>/`；PR 一律指向 `release/v0.4.2`。
- 並行的切片之間，檔案所有權不重疊。

| 切片 | 檔案所有權 | 內容 | 行數（src／test） | 依賴 | 驗收命令 |
|---|---|---|---|---|---|
| **CK-A** `feat/bots-ck-exports` | `packages/rules/src/index.ts`；`ck/index.ts`（只加兩行 `export type`）；`packages/rules/test/ck-exports.test.ts`（新增） | §4.7 | 30–45／25–40 | `release/v0.4.2` | `pnpm --filter @catan/rules exec vitest run test/ck-exports.test.ts`；`pnpm --filter @catan/rules typecheck`；`pnpm --filter @catan/rules exec vitest run`（全綠即 I3／P8） |
| **CK-B1** `feat/bots-ck-economy` | 共用檔 `bots/{economy,board,trade,fallback,heuristic}.ts`（獨占）；`bots/modules/index.ts`（registry 一行）；`bots/modules/citiesKnights/{index,view,duty,economy}.ts`；`packages/bots/test/modules/citiesKnights.ts`；`packages/bots/test/ck-duty.test.ts`、`ck-economy.test.ts` | §4.2 保底；§4.5；§4.6 掛點；模組測試工具（`conservation` 重用 `rules/test/ck-checks.ts:10,28`、`hideDifferently`、`perturb`、`responseCommands`、`mechanics`）；`supports` 回 false | 500–600／300–380 | CK-A。可以並行起步：先做不需要型別的 CardKind 部分，CK-A 合併後以 merge 方式併入 release 分支 | `pnpm --filter @catan/bots exec vitest run test/ck-duty.test.ts test/ck-economy.test.ts`；PL-1 的 golden replay（檔名以 PL-1 為準）；`pnpm --filter @catan/bots typecheck`；`pnpm --filter @catan/bots exec vitest run` |
| **CK-B2** `feat/bots-ck-core` | `bots/modules/citiesKnights/{setup,defense,improve,knights,cards,frames,trade,plans}.ts`；stub `{preroll,cards-interactive,tactics}.ts`；`index.ts` 的掛接；`packages/bots/test/ck-game.test.ts`、`ck-strategy.test.ts`、`ck-fair.test.ts`；`packages/bots/bench/run.ts`（C&K 的 CONFIGS） | §4.3、§4.4；Q1 與 Q2 的檢查。gating 未開時，`ck-game.test.ts` 以明確列出的 `CK_CELLS` 跑 C&K | 650–750／350–450 | CK-B1 | `BOTS_SEEDS=3 pnpm --filter @catan/bots exec vitest run test/ck-game.test.ts test/ck-strategy.test.ts test/ck-fair.test.ts`；`BOTS_SEEDS=10 pnpm --filter @catan/bots exec vitest run test/ck-game.test.ts`；`pnpm --filter @catan/bots bench 50 --profile ck-2025`（paired 同法） |
| **CK-G** `feat/bots-ck-gate` | `bots/modules/citiesKnights/index.ts`（`CK_BOTS_RELEASED = true`）；`packages/bots/test/support.test.ts`（快照）；`ck-game.test.ts`（保留明列的 `CK_CELLS`；通用矩陣依整體策略 §4.6 跳過已涵蓋的 profile）；`packages/server/test/cities-knights.test.ts:120-134`（翻轉）；`packages/server/test/bots-ck.test.ts`（新增）；§7.1 的文件 | 開放 gating；§6.4 的 server 案例 | 5–15／180–240（另有文件約 40 行） | CK-B2 | `pnpm --filter @catan/bots exec vitest run test/support.test.ts test/ck-game.test.ts`；`pnpm --filter @catan/server exec vitest run test/cities-knights.test.ts test/bots-ck.test.ts test/seafarers-cities-knights.test.ts test/bots.test.ts`；`BOTS_SEEDS=10 pnpm verify` |
| **CK-C** `feat/bots-ck-cards` | `bots/modules/citiesKnights/{cards-interactive,preroll,tactics}.ts`（取代 B2 的 stub）；`packages/bots/test/ck-cards.test.ts` | F2 的 10 種卡、Alchemy 窮舉 36 種骰面、Invention、Commercial Harbor 報價、騎士封鎖戰術；M8 計數 | 400–500／300–400 | CK-B2；與 CK-G 並行 | `pnpm --filter @catan/bots exec vitest run test/ck-cards.test.ts`；`BOTS_SEEDS=10 pnpm --filter @catan/bots exec vitest run test/ck-cards.test.ts test/ck-game.test.ts` |

- **PR-B 拆成兩個**
  - 第一輪的 PR-B 是 L 級：src 1100–1300、test 600–800。拆成 B1（模型與安全）與 B2（決策與品質）後，兩者合計 1150–1350／650–830。
  - 兩個 PR 的審查重點不同：B1 看 I9、合法性與 base 不變；B2 看決定性、B-FAIR 與 Q2。
  - 兩者都不開 gating。第一輪已證明「只有 duty」通不過 B-GAME；本輪補充主因是不改良（C2）。
  - gating 的翻轉獨立成最後的 CK-G，讓 server 案例與文件集中在一個小 PR。
- **合計**：src 約 1,590–1,910，test 約 1,150–1,510，總計約 2,750–3,400。

## 6. 測試與驗收

### 6.1 Q1 矩陣（發布閘門）

| profile | 人數 | B-GAME 席位 | 種子數（預設／發布） | 步數上限 | 看門狗 N |
|---|---|---|---|---|---|
| `ck-2025` | 3、4 | standard 與 easy 依 `(index + seed) % 2` 交替 | 3／10 | 6000 | 72 回合 |
| `ck-paired-2025` | 5、6 | 同上 | 3／10 | 6000 | 72 回合 |

- **其他測試族**
  - **B-POLICY**：使用同樣的格子。每桌放 1 個保底席位，其餘交替 standard 與 easy。合約檢查：非行動者只能送 base 的 6 個回應指令加 C&K 的 13 個；paired 的 Player 2 不送 `trade.offer`，也不打 alchemy。
  - **B-FAIR**：每個 family 至少 40 個狀態、100 次比較。`hideDifferently` 做三種擾動：保持 `handSize` 不變、改變資源與 commodity 的組成；把對手的進步卡與同一牌組的牌互換；反轉牌組順序。排除 `guildDues`、`espionage` 由行動者作答的狀態，以及 `harborExchange`。
  - **fuzz**：以 `perturb` 擾動 commodity、進步卡與蠻族位置，每格 1 個種子。
- **通過條件**（每一格）
  - 0 次拒絕；在步數上限內分出勝者；沒有殘留 pending；看門狗沒有觸發。
  - 守恆：資源；commodity 合計 36 或 54；進步卡 54 張；棋子（`checkSupplies`、`checkPieces`）。
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

### 6.3 單元與 server 測試

- **I9 單元測試**（DoD §6.2）
  - 涵蓋：14 種 frame、含 commodity 的棄牌與 `progressExcess`。
  - 方法：以固定盤面，對 fallback、standard、easy 三種策略各驗一次合法性與偏好。
  - 工具：`packages/rules/test/ck-helpers.ts` 的 `emptyCkGame`、`handCards`、`playCard`、`actCk`、`addKnight`、`giveCommodities`。
- **另外的單元測試**
  - Smithing 選兩隻騎士時的棋子存量（C4）。
  - 規則 9：Bot 只持有 1 coin 時，對「1 wool 換 3 coin」回 declined；持有 3 coin 且划算時回 consented，而且 `trade.settle` 成功。
- **server 新檔 `packages/server/test/bots-ck.test.ts`**（整體策略 §4.7 第 5 點）
  1. 經 HTTP 跑完 `ck-2025` 3 人一局，0 次非 stale 的拒絕。
  2. 注入會拋錯的策略，由保底代答 `citiesKnights.pillage`，不進入 30 s 退避。
  3. `scienceBonus` 的 `responders[0]` 是真人時，Bot 要等待；之後 Bot 才回答。`progressDiscard` 由真人與 Bot 並存回答。
  4. 在 `defenderDraw` 進行中重啟，之後能恢復。
- **翻轉既有測試**：`packages/server/test/cities-knights.test.ts:124`、`:133`。SF+CK 的 `:150` 仍為 false。

### 6.4 Q3 bench（不擋發布；發布 PR 附表）

- **設定**：以 `--profile` 指定，每組 100 局。
  - `ck-2025`：3 人「1 standard 對 2 easy」；4 人「1 對 3」「2 對 2」、全 standard、全 easy。
  - `ck-paired-2025`：5 人「1 對 4」；6 人「1 對 5」。
  - 「上一版」對照：4 人「1 naive 對 3 standard」，naive = base 策略加 C&K duty。

| 指標 | 軟目標 | 依據 |
|---|---|---|
| standard 勝率 | ≥ 1.3 倍公平份額 | 〔推測〕 |
| naive 勝率 | ≤ 0.5 倍公平份額 | 〔推測〕 |
| 平均輪數 | 3 人 ≤ 40、4 人 ≤ 35、5 人 ≤ 25、6 人 ≤ 20 | 混席實測 33.2／26／17.9／14.7。另與 rules 的 ck-sim 對照：158／190／198／208 回合 |
| 拒絕數；standard 的保底代答次數 | 0；0 | Q1 |
| 逐 Bot 每視窗指令數 | p95 ≤ 10、最大 ≤ 30 | 實測 p95 5–7、最大 10–16 |
| `decide` 耗時 | 平均 ≤ 0.5 ms、最大 ≤ 50 ms（乾淨的機器） | 〔推測〕；base 的平均為 0.012–0.043 ms |
| 機制計數 | 只報告 | 招募、啟動、升級；攻擊勝負；各席失城數；defender VP；大都市；各軌道等級分布；各卡種抽到、打出、棄掉的張數；harbor 報價數 |

### 6.5 CI 預算（收斂第一輪 §9 第 5 點）

- 天真原型每局 0.57／0.67／0.79／1.0 s（3–6 人，load 約 3.6）。正式策略估計每局 1–2 s〔推測〕。
- **預設 3 個種子**：約 30 局，CPU 30–60 s，分散在 4 個檔案平行執行，wall 增加約 15–25 s。
- **發布 10 個種子**：約 90 局，CPU 90–180 s。
- **軟目標**：預設的 wall 增量 ≤ 20 s（乾淨的機器）；超過時，B-POLICY 只在 `BOTS_SEEDS ≥ 10` 時執行。

## 7. 文件與發布

### 7.1 文件更新清單（CK-G）

| 檔案:行 | 現況 | 修改 |
|---|---|---|
| `docs/SPEC.md:188` | 「Today that is …」（0.4.1 改寫後的版本） | 加入 `ck-2025`、`ck-paired-2025` |
| `docs/aegis/specs/2026-11-01-bot-opponents.md:16`、`:19` | 支援清單；範圍外列有「目前停用的 Seafarers／C&K profile」 | 把 C&K 加進支援清單；從範圍外刪除 C&K |
| `docs/API.md:141-147` | 支援判定的說明（0.4.1 已改寫） | 更新「today」清單 |
| `docs/API.md:312` | 「Bot seats are still refused on these profiles」 | 改為可以入座 |
| `docs/FIDELITY.md:41-42` | 「no bot seats」 | 改為支援 easy 與 standard 的 bot seats |
| `docs/FIDELITY.md:124` | R-CK service「bot seats refused」 | 改為可以入座；證據加 `packages/server/test/bots-ck.test.ts` |
| `docs/FIDELITY.md`（`:124` 後新增一列） | — | R-CK bots：B-GAME、B-POLICY、B-FAIR、M1–M8，證據為 `packages/bots/test/ck-*.test.ts` |
| `docs/FIDELITY.md:611-612` | 「Bot seats are refused (no `@catan/bots` rule module)」 | 改為支援；若 CK-C 延後，註明「互動卡會回應，但不主動打出」 |
| `README.md:169` | 「Computer opponents are not available in this mode yet.」 | 改為可加入電腦對手 |
| `README.md:176-177` | 「Bot seats are not offered for the expansions.」 | 改為只有 SF+CK 尚未支援 |
| `docs/aegis/work/<date>-bots-cities-knights.md`、`docs/aegis/INDEX.md` | — | 新增工作紀錄（含 Q3 表與門檻實測），並在 INDEX 加一列 |

- `docs/FIDELITY.md:136`（R-COMB）與 `docs/API.md:306`（E&P）不變。大廳文案在 0.4.1 已改，本版不動。

### 7.2 發布（整體策略 §7）

1. v0.4.1 stable 發布後，從 `master` 建立 `release/v0.4.2`。切片 PR 以 squash 合併，例如 `✨ feat(bots): play cities & knights core (#N)`。
2. CK-G 合併、QA 跑完 `BOTS_SEEDS=10` 的矩陣後，發 `v0.4.2-rc.1`。
3. Browser QA 試玩 `ck-2025` 4 人與 `ck-paired-2025` 5 人，席位混合 easy 與 standard；至少要看到招募與啟動騎士、`city.improve`、`progress.play`、pillage 或 defender frame，而且不會停住。截圖放在 `.tmp/`（D10）。
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
| 0 | 依 0.4.1 合併後的實際 API 刷新本計畫，確認 §2.1 的前提 | Planner | 共用工作區（唯讀） | 主 agent |
| 0.5 | `bots/modules/types.ts` 的四個新增欄位（§4.6） | 主 agent | 主 worktree | Architect |
| 1 | CK-A | Implementer（Backend）甲 | `.worktrees/bots-ck-exports/` | Reviewer（Sol）：I3／P8、命名 |
| 1′ | CK-B1，與 CK-A 並行起步 | Implementer（Backend）乙 | `.worktrees/bots-ck-economy/` | Architect 看掛點，因為 SF+CK 與 T&B 會重用；Reviewer（Opus）看 I9、合法性與 golden replay |
| 2 | CK-B2 | Implementer（Backend）乙，延續 B1 的脈絡 | `.worktrees/bots-ck-core/` | Reviewer（Sol）：決定性、B-FAIR、Q2、§4.9 清單 |
| 3 | CK-G；文件由主 agent 處理 | Implementer（Backend）甲 | `.worktrees/bots-ck-gate/` | Reviewer（Opus）：server 案例與文件 |
| 3′ | CK-C，與 CK-G 並行 | Implementer（Backend）丙 | `.worktrees/bots-ck-cards/` | Reviewer（Sol） |
| 4 | `BOTS_SEEDS=10` 的 Q1／Q2 矩陣與 bench | QA（只改測試） | 自己的 worktree | 主 agent |
| 5 | rc 的瀏覽器驗證 | Browser QA | 共用工作區 | 主 agent |
| 6 | rc 與 stable 的 tag、Release | Release Manager（需要使用者明確授權） | — | — |

- **共用檔**：`bots/{economy,board,trade,fallback,heuristic}.ts` 只屬於 CK-B1。B1 合併之後，任何 C&K 切片需要改這些檔案時，都要先回報主 agent。gating 不改 `support.ts`。
- **閒置與限制**：閒置的 agent 把交接筆記寫到 `.worktrees/_handoff/` 後停止。subagent 不 push、不改 lockfile。

## 9. 風險

| # | 風險 | 對策 |
|---|---|---|
| K1 | 0.4.1 的實際介面與本計畫的假設不同，例如組合骨架是否受 `supports` 影響、golden replay 的檔名、harness 的 API | 依 §8 步驟 0 刷新計畫；B1 開工前由主 agent 確認 |
| K2 | CardKind 化改變了 base 的行為 | golden replay 逐一比對 |
| K3 | hints 對單一目標合法，組合起來卻不合法（Smithing 已證實；其他推測：多目標卡） | 組合目標由策略逐一模擬；B-POLICY 必須 0 次拒絕；fuzz |
| K4 | Q2 門檻出自天真原型，正式策略可能偏離 | B2 先跑 10 個種子；未達標時由使用者決定調整門檻或策略（D-CK4） |
| K5 | 不防禦的長尾：6 人 1/8 局跑滿 15000 步 | easy 也要防禦（P9）；看門狗 72 回合；步數上限 6000 |
| K6 | 與真人同桌時一局變長（混席原型 11–44 輪） | 節奏表；用 bench 換算觀看時長 |
| K7 | B-FAIR 沒涵蓋進步卡身分與牌庫順序 | `hideDifferently` 的三種擾動；排除合法看得到手牌的 frame |
| K8 | 真人用含 commodity 的報價佔 Bot 便宜 | 規則 9 加上 CardKind 估值；Bot 不主動提出 |
| K9 | CK-C 延誤 | §7.3 的退路 |
| K10 | 高負載下測試逾時 | 拆檔平行；timeout 120 s；預設 3 個種子 |
| K11 | 0.4.3 重用時才發現寫死 base 的假設，例如強盜位置、13 分、只看 `legalRoads` | 把 §4.9 列入 B2 的審查清單 |

## 10. 待使用者決定的事

| # | 決策 | 建議 |
|---|---|---|
| D-CK1 | 防禦取向（第一輪 §9 第 2 點） | **個人理性**：只求自己不落入最低貢獻群；能在 ≤ 2 個動作內成為唯一最高貢獻者時，才去爭 defender VP；不為集體防守額外投資，因為那也會讓對手免於損失。實測顯示，個人理性的防禦已足以終局 |
| D-CK2 | paired 的 Player 2 打 Commercial Harbor（第一輪 §9 第 3 點） | 照 engine 與 hints 的允許範圍做（P3-4 是開放詮釋）。日後若改詮釋，`hints.progress[].playable` 會讓 Bot 自動跟上。只在 CK-C 生效 |
| D-CK3 | easy 是否打互動卡（第一輪 §9 第 6 點） | 不主動打 F2 與 Alchemy，只打 F1；全部 frame 照常回應。符合 SPEC「難度只影響選擇品質」 |
| D-CK4 | Q2 門檻 | 採用 §6.2 的 M1–M8 |
| D-CK5 | CI 預算（第一輪 §9 第 5 點） | 預設 3 個種子、發布 10 個（D7）；預設 wall 增量的軟目標 ≤ 20 s |
| D-CK6 | 切片方式 | PR-B 拆成 CK-B1 與 CK-B2，gating 獨立成 CK-G |
| D-CK7 | CK-C 延誤的判定點 | rc.1 就緒時 CK-C 仍未通過審查，就移到 0.4.3 |
| D-CK8 | C&K 的每視窗上限 | 維持 40，不設 `maxCommandsPerWindow` |

第一輪 §9 的第 1 點（rules 匯出）與第 4 點（版本安排）已由整體策略的 D3、D1 決定，本計畫照辦。

## 11. 與整體策略的差異

2026-11-04 主 agent 已把 X1–X3、X5–X7 併入整體策略（§3 P9、§4.1、§4.4、§4.6、§4.7、§4.9、§5、§5.2、R4）。X4 是 C&K 的命名慣例，符合 P8。整合 T&B 計畫時，CK-G 的 `ck-game.test.ts` 依策略 §4.6 改為保留明列的 profile。SF+CK 計畫 §11-9 要求的修改已寫入 §4.1、§4.2、§4.6 與 §4.9 的對應列；它在 sf-ck 改寫 M2、不套用 M5、M7、M8，ck-* 的門檻不變。下表保留原始論證。

| # | 整體策略 | 本計畫 | 證據 |
|---|---|---|---|
| X1 | §4.7 第 3 點、§5、R4：「C&K 6 人原型已達 32 個」，接近上限 | 32 是全桌合計，逐 Bot 最多 16、p95 ≤ 7。C&K 不必提高上限；R4 對 C&K 的描述應改為「逐 Bot ≤ 16」 | C1 |
| X2 | P9：「C&K 不防禦……無法終局」 | 結論不變（easy 也要防禦），但主因不同：不防禦、但會改良的對局 53/54 局終局；只補 duty（不改良）的原型要 376–771 回合，部分撞到 8000 步上限（第一輪報告 §3）。建議 P9 改寫為「C&K 不改良就無法終局；不防禦會有長尾」 | C2 |
| X3 | §4.1 的 `economy` 只列 `cardKinds`、`routeEdge` 等 | 新增 `rates`、`weights`、`vertexBlocker`、`siteBlocked`。只是加法，不改既有鉤子；由主 agent 改 `modules/types.ts` | §4.6 |
| X4 | §4.3：匯出「C&K 的成本與商品常數」 | 名稱加 `CK_` 前綴，沿用 E&P 的別名慣例；frame data 型別不由 rules 匯出 | `packages/rules/src/index.ts:12-13`；§4.7 |
| X5 | §4.4：`supports` 用於判定 part 與 mission | 開發期間也把 `supports` 當成發布旗標（`CK_BOTS_RELEASED`），到 CK-G 才翻轉；不必改 `support.ts` | §5 |
| X6 | §4.6 看門狗：「連續 N 回合沒有任何人得分」 | 把「得分」定義為「任一玩家的公開分數創新高」，因為失去城市會降分 | §6.1 |
| X7 | §5 的規模：約 2,600–3,000 | 約 2,750–3,400；多出的部分是 CK-G 的 server 測試與 B1 的平台掛點測試 | §5 |
