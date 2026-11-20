# Traders & Barbarians 電腦對手（v0.4.4）：實作紀錄

本檔是諮詢性的工作紀錄，對應 [T&B 計畫](../plans/2026-11-04-bots-traders-barbarians.md)、[第一輪研究](2026-11-04-bots-traders-barbarians-research.md) 與 [整體策略](../plans/2026-11-04-expansion-bots-roadmap.md)。所有切片都以 squash merge 合併進 `release/v0.4.4`（計畫 §5）。

## 切片與 PR

| 切片 | PR | squash commit | 內容 |
|---|---|---|---|
| 計畫刷新 | #186 | `92649c5` | 依 `58fe789`（v0.4.3 stable）刷新計畫：§12 的更正表、G1–G13 現況、切片調整與合約 C1–C6；D-TB1–D-TB7 採用建議 |
| S0 匯出 | #187 | `84e2a62` | rules 匯出各 part 的 view／hints 型別、frame data 型別、`TB_SCENARIO_PART_IDS`／`TB_VARIANT_PART_IDS`、`TB_FRAME_KINDS`、`TB_PENDING_COMMANDS` 與規則常數；`ModuleViewMap`／`ModuleHintsMap` 加上 `tradersBarbarians`。規則行為不變 |
| S1 共用 | #188 | `43781d8` | 共用檔修正：`economy.awards`、`trade` 鉤子接上骨架（C1、C2）；`targetOf`（G3）、最長道路計畫的關閉（G4）、規則 9 的 goods（G8）、Rivers 的 `extraNumbers`（G6）、`piecesOnBoard` 不算橋（G7） |
| S2 核心 | #189 | `3711496` | 註冊 `tradersBarbarians` BotModule（`TB_READY_PARTS` 為空集合）：part 組合、`supports`、保底 17 列、節奏、MP 最短路徑；測試 kit、守恆、`PROFILE_LIMITS`、`BENCH_KITS`、`tb-game.ts` |
| S6 BA | #190 | `3133afa` | Barbarian Attack 的策略 |
| S7 Traders | #191 | `a66b1d7` | Traders & Barbarians 劇本的策略 |
| S5 Trains | #192 | `f468fee` | Merchant Trains 的策略 |
| S3 coins＋variants | #193 | `2730260` | Coins、Friendly Robber 與 Harbors 的策略；gold 交易 |
| S4 Fishing | #194 | `0ac3267` | Fishing on Catan 的策略 |
| S8 Rivers | #195 | `92c6acb` | Rivers of Catan 的策略：橋、河邊聚落、財富排名；`economy.routeEdge` 接上骨架 |
| S9 開放 | 本 PR | 合併後補 | `TB_READY_PARTS` 放入 8 個 part、快照、family 登記、server 測試、文件 |

合併順序與計畫的波次不同：S6、S7 先合併，S5、S4 依序 rebase 在 #191 之上，S3 接著合併並 rebase 在 #191 之上（coins 因此也在 BA 與 Traders 的對局中出手，S6、S7 的測試檔重跑仍通過），S8 在 S3 之後合併。8 個 part 都通過 Q1、Q2，S9 一次開放 8 個 profile，沒有走替代方案。

## 實作期間的決定

- **D-TB1–D-TB7**：2026-11-20 使用者指示「直接照計畫進入開發」，全部採用建議（計畫 §10）。D-TB1 一次開放 8 個 profile 達成，替代方案（先開 6 個）沒有用到。
- **C1–C6**：照計畫 §12.4 的建議提交，只有 C2 的單位與簽章在實作中改了兩次（下面兩項）。
- **goodValue 的單位改為「一張用得上的牌」**（S1 審查，#188）：C2 原本建議以「一張過剩資源的平均效用」換算 goods。審查發現這樣計價時，1 gold = 0.5 張的模組會以約 4 倍銀行價付出 gold，所以改為 `USEFUL_CARD_UTILITY`（= 3，`handUtility` 目標內一張牌的項）。新增的測試斷言 8 gold 換 1 grain 會被拒絕。本回合用不掉的 goods 由模組的 `goodValue` 自行折價。
- **goodValue 加上收付方向**（S3 審查，#193）：`BotTradeHooks.goodValue` 多一個參數 `side: 'receive' | 'pay'`，由 `goodsGain` 對報價的兩邊分別傳入。coins 只在收進 gold 時折價，付出的 gold 固定以銀行價（1 gold = 0.5 張）計，以免對手低價收購 gold 再向銀行換牌；付出會動用 Traders 的過路費準備金，或讓 Rivers 掉一塊財富板塊時拒絕。重現案例改正後：持有 8 gold 時拒絕「4 gold 換 1 ore」，仍接受「2 gold 換 1 ore」。Bot 從不主動提出含 gold 的報價（D-TB3），所以 bot-only 對局不受影響。
- **`economy.routeEdge` 在 0.4.4 接上骨架**（S8 審查，#195 的 `79871db`）：base 的道路搜尋會把路線規劃經過空的橋位，但橋位不能蓋道路，橋用完之後計畫就停住。`routeEdge` 改為已實作的鉤子：任一模組回 false，`searchRoads` 就跳過那條空邊；沒有模組提供時不呼叫，base 的 golden 不變。Rivers 在玩家沒有橋可蓋時，對空的橋位回 false；只剩一座橋時，不在任何計畫路線上的橋要有立即建造等級的淨值。新的固定盤面（3 座橋用完、計畫經過第 4 個橋位）在沒有 `routeEdge` 時會失敗；`BOTS_SEEDS=10` 下 22 局 Rivers 對局與修正前完全相同。`support.test.ts` 因此把 `routeEdge` 移出保留清單，檢查器的自我測試改用 `phase`／`endWindow`。
- **`naiveModule` 保留 `robberTargets`**（S2 審查，#189）：測試 harness 的 naive 座位原本拿掉 `robberTargets`，FR 在所有玩家都受保護時，naive 座位的第一個 7 就被拒絕。盜賊目標的 fold 是合法集合，和 `duty` 一樣屬於正確性，因此保留；新增 3 種子的 naive FR 測試。SF+CK 的 naive 座位也因此保留 fold，只影響 bench。
- **S2 的共用對局工具 `test/tb-game.ts`**（S2 審查，#189 的 `e8abd76`）：`tbMatrix`（`seedsFor` 的種子、standard 與 easy 輪替，另加 1 個 bot2 只走保底的種子）、`runTbGame`（仿 BotDriver 模式，逐步檢查守恆、合約與指令計數）、`expectTbGameHealthy`（§6.1 的通過條件）。S3–S7 的 B-GAME 都用它。全部座位只走保底的有界局拆到 `tb-fallback.3p`、`tb-fallback.4p`（§6.6 的拆檔規則），守恆把 Trains 投標中的牌算進去。
- **全保底的有界局只用種子 1**（S2）：計畫 §6.1 寫的是 `ALL_FALLBACK_SEEDS`（1–3）。這些局從不建造，所以 Trains 的投標、BA 卡與魚片交換改由固定盤面（`tb-duty.test.ts` 等）涵蓋。
- **S9 的 family 登記**（C6）：`families.ts` 新增 `tradersBarbarians` family，登記 8 個 profile 與各 part 的 B-GAME 檔（含 Rivers 的 `tb-rivers.test.ts`、`tb-rivers-decisions.test.ts`），加上 `tb-coins.test.ts` 與兩個有界局檔。登記後 `GENERIC_MATRIX` 自動跳過 T&B，通用矩陣不重跑。
- **S9 的 server 測試檔名**：沿用既有的 `<expansion>-bots.test.ts` 慣例，命名為 `packages/server/test/traders-barbarians-bots.test.ts`（計畫 §6.5 原寫 `bots-traders-barbarians.test.ts`）。

### 各 PR 的審查修正

- **#187**：測試以各 profile 的 FNV-1a 指紋鎖住 T&B 的 view／hints；抽出前後與 `58fe789` 比對兩次相同（1,736 個取樣狀態，另一次獨立的 42,084 次比較）。`TB_FRAME_KINDS` 改為凍結。
- **#188**：goods 的單位（見上）。
- **#189**：`tb-game.ts` 與 `naiveModule`（見上）。
- **#191**（`ea7c9fa`）：
  - `budgetedLeg` 付不起最短路線時，改走過路費最少的路線（Dijkstra，過路費權重 1000 MP），車隊不會在有便宜路線時停住；
  - standard 只在 Swift Journey 能把一次移動變成送達時才打出，沒有騎士卡時也一樣；
  - 歷史中沒有 `turn.started` 時，`wagonCommandsThisFrame` 回 0。

  三個新的固定盤面對舊的 `traders.ts` 會失敗；`BOTS_SEEDS=10` 下 22 局都健康終局，0 拒絕。Q2（S = 10）：運貨 210、升級 45、騎士 116。
- **#193**：goodValue 的收付方向（見上）。
- **#195**（`79871db`）：`economy.routeEdge`（見上）。
- #190、#192、#194：審查沒有要求修改。

## Q1 與 Q2

數字取自各 PR 本文（S = 每個人數的種子數；S = 3 是預設，S = 10 是 `BOTS_SEEDS=10` 的閘門）。Q1 的通過條件見計畫 §6.1：0 拒絕、在步數上限內分出勝負、沒有殘留 pending、守恆、沒有「策略閒置、但保底有動作」、B-FAIR 與 fuzz 通過。

### Q1

| part（PR） | 結果 | 每視窗最大指令數 |
|---|---|---|
| FR、H、FR+H（#193） | 每局終局，0 拒絕、0 保底；平均回合 3 人／4 人：FR 22.5／19.0、H 20.3／18.9、FR+H 25.1／21.7 | — |
| Fishing（#194） | 0 拒絕、0 閒置保底、沒有殘留 pending；S = 10：3 人 standard／easy 勝 7／3、平均 21.8 回合，4 人 8／2、16.9 回合；最長無得分 29（3 人） | 14 |
| Trains（#192） | 0 拒絕、沒有殘留 pending、0 閒置保底；S = 10：3 人勝 6／5、4 人 6／5，平均 22.4／18.3 回合；最長無得分 20 | 12 |
| BA（#190） | 0 拒絕、0 看門狗（stub 時 8 局有 7 局觸發）；S = 10：3 人勝 8／2、18.7 回合，4 人 6／4、16.3 回合；最長無得分 17 | 15 |
| Traders（#191） | 0 拒絕、0 閒置保底、0 看門狗；策略座位的 `tbWagon`／`tbBarbarian` 答案都來自 Traders 的 part；S = 10：3 人勝 5／6、14.5 回合，4 人 9／2、12.9 回合；最長無得分 14 | 15 |
| Rivers（#195） | 0 拒絕、0 看門狗、沒有殘留 pending、守恆成立、0 閒置保底；S = 10：3 人勝 5／6、15.8 回合，4 人 8／3、13.7 回合；最長無得分 20 | 11 |
| 全部座位只走保底（#189） | 8 個 profile × 3、4 人，各 800 步：0 拒絕、沒有卡住、守恆成立 | — |

各 part 的每視窗最大指令數都遠低於 30，D-TB7（改為 60）不必啟用。

### Q2

| profile | 指標 | 門檻（S = 3／10） | 實測（S = 3／10） |
|---|---|---|---|
| FR | `pending.moveRobber` | ≥ 9／≥ 30 | 66／190 |
| FR+H | `pending.moveRobber` | ≥ 9／≥ 30 | 91／210 |
| FR、FR+H | 強盜落點在 `robberHexes` 內（含騎士卡） | 100% | 100% |
| H | 終局時 Strongest Ports 有持有者的局數 | ≥ 1／≥ 3 | 5 of 6／17 of 20 |
| FR+H | 同上 | ≥ 1／≥ 3 | 6 of 6／18 of 20 |
| Fishing | `tb.spendFish` | ≥ 6／≥ 20 | 61／193 |
| Rivers | 蓋橋 | ≥ 2／≥ 5 | 12／48（standard 7／27、easy 5／21） |
| Rivers | `tb.buyResource` + `tb.sellResources` | ≥ 3／≥ 10 | 62／228 |
| Trains | wool + grain > 0 的出價 | ≥ 3／≥ 10 | 42／121 |
| Trains | 放置的車廂 | ≥ 15／≥ 50 | 77／250 |
| BA | `tb.buildBaCard` | ≥ 15／≥ 50 | 105／369 |
| BA | 俘虜（每局最少 ≥ 1） | ≥ 9／≥ 30 | 93／340（每局最少 7／5） |
| Traders | 運貨 | ≥ 15／≥ 50 | 67／215（審查修正後 S = 10 為 210） |
| Traders | `tb.upgradeWagon` | ≥ 3／≥ 10 | 13／47（修正後 45） |
| Traders | `tb.playKnight` | ≥ 3／≥ 10 | 50／117（修正後 116） |

- standard 與 easy 各自發出各劇本的模組指令（DoD 1）：Fishing 的 `tb.spendFish`、`tb.giveBoot`；Trains 的 `tb.bidWagon`、`tb.placeWagon`；BA 的買卡與 `baKnights`；Traders 的送貨與騎士；coins 的 `tb.buyResource`（固定盤面加上一局 Rivers 短局）。easy 的限制依 D-TB5：Fishing 只用在道路、資源與發展卡，Trains 一律出價 0，BA 不加速（S = 10 時 standard 加速 23 次、easy 0 次），Traders 不升級、不加速、不驅逐、不打 Swift Journey。
- Harbors：H 加 FR+H 共 40 局（各 10 種子），standard 估港口時終局拿到 Strongest Ports 32 次，不估時 18 次。
- Fishing 的 `tb.spendFish` 門檻原本是推測值，實測遠高於門檻；Rivers 的兩項推測門檻也一樣。
- Rivers：全 standard、交換座位的 A/B（80 局），Rivers 策略開與關的勝場為 50／30。easy 也蓋橋、處理計畫路線上的橋，但不看財富排名。開局為了脫離 Poor 的賣出保留：全 standard 各 80 局的 A/B 看不出差異（雜訊內），這類賣出每局約 0.5 次。
- 推測的門檻（計畫 §6.3 的 7 項）都沒有調整（D-TB2）。

## S9 的 server 測試

`packages/server/test/traders-barbarians-bots.test.ts`，全都經過 HTTP 與真實的 BotDriver（計畫 §6.5 的 1–4）：

1. `tb-merchant-trains-2025` 3 人（真人以 standard 策略經 HTTP 送指令，Bot 為 standard 與 easy）跑到終局：0 個非 stale 的拒絕、沒有閒置警告；回合結束排入的投票（`onEndTurn` defer）中，完整的出價輪都從行動者起依座位順序出價，Bot 也放過車廂。
2. `tb-traders-barbarians-2025` 的 `tbWagon` frame：策略送出原地不動的 `tb.wagonStep`，第一次嘗試被拒（`E_ILLEGAL_TARGET`），同一個 revision 的第二次嘗試是保底的 `tb.wagonStop`，被接受；Bot 的回合結束，對局繼續輪到真人。
3. Trains 的投票，真人加 3 個 Bot，真人在前與 Bot 在前兩種順序：
   - `wagonBid`（依序）：真人在前時由真人結束回合，rules 真的在回合結束時排入投票；Bot 在前時注入 frame。輪到真人時 frame 停住，之後的 Bot 不搶先出價；出價順序與事件順序相同；
   - `wagonAssign`（同時）：Bot 不等真人（即使真人排在最前面）就分配，frame 只剩真人；真人投給第一個 Bot 選的位置後車廂直接放下，行動者的回合結束。
4. `tb-traders-barbarians-2025`：真人離線時開出 Bot 的車隊移動 frame，以 Bot 的身分先走一步（不進廣場），再重啟伺服器。frame、剩下的 MP 與車隊位置原樣恢復；真人上線後 Bot 的第一個決策就被接受，完成這一次移動並結束回合。

另外：8 個 profile 都只提供 easy 與 standard，要 hard 被拒（`E_INVALID_BOT`，reason `profileLevel`）。`traders-barbarians.test.ts` 改為斷言 8 個 profile 可以加 Bot、Bot 房可以切換過去，4 個 event-card profile 沒有 Bot 席位，也無法建房或切換過去；`bots.test.ts` 與 `rooms.test.ts` 的 profile 清單同步更新。

## Q3 bench

待 QA 填入（計畫 §6.4；C5：W3 的 QA 在本地暫時翻開 `TB_READY_PARTS` 量測，發布 PR 的 Q3 表格在 S9 之後重跑確認）。

## 限制與後續事項

- **全保底的有界局只用種子 1**，Trains 投標、BA 卡與魚片交換靠固定盤面守門（見上）。
- **Bot 不主動提出含 gold 的報價**（D-TB3），gold 交易只在真人提出時發生；easy 一律拒絕。
- 瀏覽器 QA 與大廳截圖由 QA 另外處理（計畫 §7 發布流程第 2 步）。
