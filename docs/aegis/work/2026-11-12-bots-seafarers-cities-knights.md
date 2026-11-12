# Seafarers + Cities & Knights 電腦對手（v0.4.3）：實作紀錄

本檔是諮詢性的工作紀錄，對應 [SF+CK 計畫](../plans/2026-11-04-bots-seafarers-cities-knights.md) 與 [整體策略](../plans/2026-11-04-expansion-bots-roadmap.md)。所有切片都以 squash merge 合併進 `release/v0.4.3`。

## 切片與 PR

| 切片 | PR | squash commit | 內容 |
|---|---|---|---|
| SFCK-X | #164 | `b7e5f16` | rules 匯出 SF+CK 的 view／hints 型別與 `SEAFARERS_CITIES_KNIGHTS` 常數；`ModuleViewMap`／`ModuleHintsMap` 加上組合層 |
| 計畫刷新 | #165 | `413987a` | 依 `fc6b3b5` 刷新計畫（§12 記錄更正與 D1–D6） |
| SFCK-P | #166 | `6c806cc` | 平台：`robberTargets` fold（元素 `number \| null`、完整的盜賊預設）、`rescore` 鉤子、base 的目標與 duty 接上 fold |
| SFCK-1 | #167 | `2c305e2` | 組合層 BotModule：`robberTargets` 收窄、節奏、`supports`（旗標仍為 false）；組合測試工具 |
| SFCK-2 | #168 | `aa46ceb` | 策略：追擊海盜（`knight.chasePirate`）、開局分數合成、騎士位置的 `rescore`；C&K 的 `recruitSite` 依 `rescore` 排序（D2） |
| SFCK-3 | #169 | `218274f` | 驗收測試：SFCK 測試 kit、Q1 矩陣、Q2 門檻、固定盤面、fuzz、保底局；`PROFILE_LIMITS`、family 登記、bench |
| SFCK-G | 本 PR | 合併後補 | 開放 gating（`SFCK_BOTS_RELEASED = true`）、server 測試、文件、大廳截圖 |

## 實作期間的決定

- **§10 D-SC1–D-SC12**：2026-11-12 採用計畫的建議；D-SC10（`sfck-sim.ts` 計數）與 D-SC11（CK-C）在刷新時已解決。
- **D1–D6**（編號與 D-SC 不同）：細化寫在計畫 §10 的「2026-11-12 主 agent 決定」表，這裡只列結論：
  - D1：不提交 sf／ck 的 golden fixture，SFCK-P 在 scratch 以決策雜湊前後比對。
  - D2：`recruitSite` 依各模組的 `rescore` 差值總和排序招募點。
  - D4：看門狗維持 72 次 `turn.roll`。
  - D5：第 2 輪城市用 `citySetupScore` 加 `islandSetupBonus`，不與 `setupSpotScore` 相加。
  - D6：bench 在 SFCK-G 之後的 QA 執行。
- **D3（截圖）**：使用者在 2026-11-12 決定比照 CK-G：PR 證據放 `pr-assets` 的 `pr-<N>/`，並在 `docs/screenshots/seafarers-cities-knights/` 重拍一張大廳參考截圖。拍攝腳本為新增的 `scripts/bots-seafarers-cities-knights/capture.py`；`scripts/bots-seafarers/capture.py` 原本斷言組合房間「不能加 bot」的案例已移除。
- **D1 的決策雜湊結果**：SFCK-P 與 SFCK-2 各自比對 64/64 局相同，也就是沒有 `rescore` 提供者的 profile（base、sf、ck）的決策逐位元不變。

## Q1 與 Q2（10 種子）

數字取自 PR #169 本文，`BOTS_SEEDS=10`，策略為 `aa46ceb`。

- Q1：`sfck-game.test.ts` 在 `BOTS_SEEDS=10` 下 16/16 通過（64 秒）；預設 3 種子的四個 sfck 檔案 44/44（35 秒）。兩者也都以 `--sequence.shuffle` 通過。其中的 B-GAME 斷言：3–6 人、混合難度的 bot-only 對局都以勝利終局，沒有拒絕、殘留 pending、看門狗或閒置的職責。
- 看門狗：最長一段無創新高為 28 次擲骰（提報線 50）。每視窗每座位最多 15 個指令（上限 40）。
- fuzz：每格 150 個擾動狀態，fold 不變量成立；fuzz 暫存的追擊海盜指令全數被接受。

| Gate | 3 人 | 4 人 | 5 人 | 6 人 |
|---|---|---|---|---|
| S1 付費造船（≥ 9/10） | 10/10 | 10/10 | 10/10 | 10/10 |
| S2 小島加分（≥ 6/5/8/8） | 10/10 | 10/10 | 10/10 | 10/10 |
| C1 招募／啟動（每局最少，≥ 1） | 3 / 4 | 3 / 3 | 4 / 9 | 8 / 14 |
| C2 最高改良 ≥ 3（≥ 7/9/9/9） | 9/10 | 10/10 | 10/10 | 10/10 |
| C3 `progress.play`（每局最少，≥ 3） | 4 | 9 | 15 | 28 |
| C4 守住（≥ 2） | 17 | 11 | 4 | 4 |
| C5 大都市（≥ 5） | 12 | 15 | 23 | 24 |

- S3（每個 profile 20 局，≥ 12）：standard 20 / 20，easy 20 / 17（兩個 profile 依序）。
- S4 金礦（5–6 人，≥ 6）：17。
- 自己的騎士釘住自己的船：4.2% 與 1.7% 的視窗（第一輪原型為 14%）。
- 模擬對局中追擊海盜 0 次：X1 由 SFCK-2 的固定盤面 FX-C1／C8 守門；X2、X3 同樣由固定盤面守門（計畫 §6.2）。
- 餘裕最小的門檻：C3 3 人為 4（門檻 3）、C1 4 人為 3（門檻 1）。之後調整策略要重跑 10 種子。

## Q3 bench

bench 在 gating 開放之後才跑得動（D6）。來源：`0a9450b`（SFCK-G 的 head，與最後的 `7076e82` 只差一張 PNG）上跑 `pnpm --filter @catan/bots bench 100 --profile sf-ck-new-shores-2025`（3、4 人）與 `--profile sf-ck-new-shores-paired-2025`（5、6 人）。每組 100 局，種子從 10000 起，standard 依局數輪換座位。只報告、不擋發布（計畫 §6.4）。

「勝率／公平份額」是 1 個 standard 對其餘座位的勝率；「回合」是平均回合，「rules-sim」是 `RULES_SIM_ROUNDS` 的腳本模擬對照。

| 人數 | 1 standard vs easy：勝率／公平份額，回合 | 1 standard vs naive：勝率／公平份額，回合 | 全 standard 回合 | 全 easy 回合 | rules-sim 回合 |
|---|---|---|---|---|---|
| 3 | 79% ／ 33.3%，31.3 | 100% ／ 33.3%，29.0（只計 96 局，見下） | 28.9 | 36.7 | 75.7 |
| 4 | 63% ／ 25%，26.9 | 100% ／ 25%，32.6 | 21.9 | 29.4 | 36.5 |
| 5 | 65% ／ 20%，17.1 | 100% ／ 20%，19.1 | 16.9 | 19.7 | 32.0 |
| 6 | 55% ／ 16.7%，15.4 | 100% ／ 16.7%，18.2 | 14.9 | 17.0 | 24.2 |

- **soft target ①②（勝率 ≥ 1.3 × 公平份額、≥ 公平份額 + 10 pp）**：對 easy、對 naive 各 4 組，共 8/8 達成。**平均回合目標**（3 人 ≤ 40、4 人 ≤ 38、5 人 ≤ 24、6 人 ≤ 23）所有組都達成，最大值為 36.7／32.6／19.7／18.2。
- **穩定與效能**：16 組合計，每視窗最大指令數 19（目標 ≤ 20）；`decide` 最大 18.18 ms（3 人 1 standard vs 2 easy，目標 ≤ 50 ms）；拒絕 0、保底 0、卡死 0。看門狗只在下述一組出現。
- **釘船**：自己的騎士釘住自己的船的窗口比例，各組最高 1.92%（6 人全 standard），低於第一輪原型的 14%。
- **追擊海盜**：16 組合計幾乎是 0（只有 6 人全 standard 平均每局 0.01 次），維持由固定盤面 FX-C1／C8 守門。
- **#135**（SF standard 在 3–4 人對 naive 未達 soft target）：在 sf-ck 沒有重現，3、4 人對 naive 都是 100%；但 3 人那一組有下面的已知限制。

### 已知限制：3 人 1 standard vs 2 naive 的後期停滯（rc.1 不修）

根因由 Debugger 查明（腳本與報告放在 repo 外：`.worktrees/_scratch/sfckg-wd/`、`sfckg-wd2/`，不提交）。決定 rc.1 不修，記為已知限制，後續事項列在下一節。

- **現象**：這一組 100 局只有 96 局終局，4 局（game 9、21、36、57，種子 10009、10021、10036、10057，standard 都在座位 1）觸發 72 次擲骰的看門狗；其餘 15 組都是 0。bench 把這 4 局排除在終局局數之外，所以該列的勝率 100% 與平均回合 29.0 只算 96 局。停滯時 standard 的合法路、聚落與船全是 0，`islands` 為 0，最後 72 次擲骰沒有 `build.*` 或 `city.improve`，卻有 30–47 次 `trade.bank`。關掉看門狗重跑：game 9／57／21 在第 214／721／1563 次擲骰才靠被動的 `ck.defenderOfCatan` 結束，game 36 到 12000 步（約 2192 次擲骰）仍未終局。
- **根因（三層，缺一不可）**：
  1. naive 的天花板低於目標：naive 不造船、不改良、不養騎士，最多 4 城 + 5 聚落 + 最長道路 = 15 分，目標是 16（`packages/rules/src/profiles.ts:481`）；單獨的 SF（14）與 C&K（13）naive 仍拿得到勝利，所以 standard 一停住就沒有人能結束遊戲。
  2. 第二輪 setup 把座位 1 放進內陸：3 人 New Shores 地圖固定，座位 1 第一輪選內陸的 v35；第二輪的 ore／grain 硬過濾（`packages/bots/src/modules/seafarersCitiesKnights/setup.ts:29-30`，D5）刪掉沿海的 v78（小島加分 4.63、分數 13.22），留下內陸的 v49（加分 0、分數 10.34）。單獨的 SF 選 35／78；sf-ck 座位 1 的 34 局全選 35／49。
  3. 兩棟建築都在內陸，船出不去：船只能接自己的建築或船，不能接路（`packages/rules/src/modules/seafarers/ships.ts:69-74`），bot 找船也只從建築與船出發（`packages/bots/src/sea.ts:240,245`），沒有計畫會「修路到海岸以解鎖船」。naive 的路把唯一的沿海出口封住後（game 9、21：沿海的 v31 的海邊 39、43 被 bot3 的路占走），分數卡在 14–15，只剩防禦者與 VP 牌這類隨機分數。100 局中「standard 從未有合法船位」的局與看門狗局完全重合（4/4）；`rescore` 與追擊海盜沒有參與。
- **`city.improve` 停止與 bank 循環**（都是 v0.4.2 與 base 既有的行為，只在 sf-ck 這個條件下造成停滯）：game 21 三條軌道都滿級；game 9 的 `mainTrack` 選到已滿級的 trade（`packages/bots/src/modules/citiesKnights/improve.ts:94-112` 不跳過滿級），science、politics 又被非主軌 > 3 級的規則丟掉（`improve.ts:163`），計畫清單為空；game 36、57 的下一級要大都市，但自己每座城市都已有一座，規則回 `blocked = 'no-site'`（`packages/rules/src/modules/citiesKnights/cities.ts:124`），而 `citiesKnightsPlans`（`packages/bots/src/modules/citiesKnights/plans.ts:62`）沒有檢查 `blocked`，計畫卡在第一項、`improveCommand` 回 null（`plans.ts:131`）。bank 循環來自 base 的 `handRelief`（`packages/bots/src/heuristic.ts:520`）：手牌超過上限且計畫為空或已湊齊時，`receive` 退回權重最高的資源，C&K 又在買得起時把目標商品的權重乘 1.3（`citiesKnights/economy.ts:68`），於是換進換出；每次 2:1 都縮小手牌，會自然停止，浪費指令但不是停滯的原因。
- **看門狗是組合新出現的，與 #135 機制不同**：3 人 1 standard vs 2 naive 各 100 局，sf-new-shores-2025 在 head 與 v0.4.2（`fc6b3b5`）都是勝率 28%、平均 29.1 回合、看門狗 0；ck-2025 在 head 是勝率 100%、27.7 回合、看門狗 0。#135 的症狀是座位 2 只贏 2/33 局、船位一直可達，與這裡不同。
- **真實對手的風險低**：停滯需要其他玩家都無法獲勝；easy 與 standard 會造船與改良，下面各組都沒有觸發。4 人 1 standard vs 3 naive 已有 4 局 50–58 次擲骰的停滯，這一組天生脆弱。

  | sf-ck，各 100 局 | 看門狗 | 最長停滯（擲骰） | standard 從未有船位的局數 |
  |---|---|---|---|
  | 3 人 vs easy | 0 | 41 | 3（都輸） |
  | 3 人全 standard | 0 | 32 | 5 |
  | 4 人 vs easy／全 standard | 0 | 28／26 | 0 |
  | 5 人／6 人 vs easy | 0 | 34／31 | 14／12 |

  另有一項未驗證的觀察：3 人全 standard 的座位勝場是 21／34、12／33、1／33，可能是固定地圖的座位偏差。
- **評估過、不採用的修法**：B5（第一輪建築沒有海邊時，放寬第二輪的 ore／grain 過濾）與 B5b（保留過濾，另加 `islandSetupBonus > 0` 的候選），scratch 模擬如下。勝率沒有可測的提升（±5 pp 的雜訊內）；5–6 人的無船局略增（14 → 18／16）；3 人 vs naive 仍有 56／61 次擲骰的停滯，只是移到座位 2；而且要修改 D5，並全面重跑 Q1／Q2／Q3。

  | 組 | 現況 | B5 | B5b |
  |---|---|---|---|
  | 3 人 vs naive：看門狗／勝場 | 4／96 | 0／100 | 0／100 |
  | 3 人 vs easy：勝場／無船局 | 79／3 | 77／0 | 77／0 |
  | 3 人全 standard 無船局 | 5 | 2 | — |
  | 5 人 vs easy 勝場 | 65 | 59 | 62 |
  | 6 人 vs easy 勝場 | 55 | 56 | 53 |

## 審查得出的限制與後續事項

- **`rescore` 只能重排，不能排除**：唯一候選即使是負分仍會被選。`knight.displace` 的小島罰分實際上幾乎不會觸發，因為 `siteBlocked` 會先把該計畫排除。
- **未調校的常數**：K6 的分數公式拿掉了計畫建議的常數項 `1`；`REACTIVATE_PRICE = 0.3`、`DEFENSE_PER_LEVEL = 0.1`（`chase.ts`）與 `OPEN_END_PENALTY = 0.3`（`rescore.ts`）都是推測值，沒有調校。
- **追擊海盜在模擬對局中是 0 次**：只有固定盤面 FX-C1／C8 守門，真實對局的行為要靠 Q3 與試玩觀察。
- **效能**：4 人固定盤面上 K2 的重算 p50 2.6 ms、最大 4.3 ms；5–6 人實際對局的 `decide` 最大值由 Q3 量測：10.35 ms（5 人 1 standard vs 4 easy），其餘組都在 10 ms 以下。
- **T&B（0.4.4）的後續事項**：
  - friendly robber 的 `robberTargets` 寫法：FR 在沒有合法格時回沙漠，要與 fold 的初值相容。
  - `knightDecision` 的強制第一項。
- **`fallbackDecision`** 的 JSDoc 已在 #168 補上。
- **Q3 停滯的後續（待開 issue，尚未開）**：
  - SF／base：沒有船位時，以海岸可達性評估建點（可能與 #135 有關，未驗證）。
  - C&K：`plans.ts`、`improve.ts` 跳過 `no-site` 與滿級選項，不以滿級軌為主軌（只會改變這些狀態下 ck-\* 的決策雜湊）。
  - base 的 `handRelief`：不立刻換回剛收到的牌（會改變所有 profile 的決策雜湊，發布之後再做）。
  - 調查 3 人 sf-ck 全 standard 的座位偏差（未驗證）。
