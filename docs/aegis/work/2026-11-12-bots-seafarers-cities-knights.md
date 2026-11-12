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

### 已知限制（待根因）：3 人 1 standard vs 2 naive 的後期停滯

- **現象**：這一組 100 局只有 96 局終局，4 局（game 9、21、36、57，種子 10009、10021、10036、10057，standard 都在座位 1）觸發 72 次擲骰的看門狗；其餘 15 組的看門狗與 problems 都是 0。bench 把這 4 局排除在終局局數之外，所以該列的勝率 100% 與平均回合 29.0 只算 96 局。
- **不是 naive 造成的退化局**：用 bench 相同的種子與座位輪換在 scratch 重現。四局停滯時，standard 的三條改良軌道多在 4–5 級、手上有 2–3 座城市與大都市，但陸上的 `legalBuildingVertices` 與 `legalRoadEdges` 都是 0（沒有可蓋的點），`islands` 也都是 0（沒有登上新島）。最後 72 次擲骰沒有任何 `build.*` 或 `city.improve`，卻有 30–47 次 `trade.bank`（例如 game 21 的 `grain→lumber` 13 次、`lumber→brick` 9 次），在幾種資源之間來回換，手牌湊不成一組建築。standard 被蠻族劫掠的城市只有 1–4 座，兩個 naive 座位各損失 8–24 座；naive 座位在 game 9、21、57 只有 9–11 分，game 36 則是 6 分與 14–15 分。
- **關掉看門狗（`watchdogRolls: null`）重跑**：game 9 在第 214 次擲骰、game 57 在第 721 次、game 21 在第 1563 次才由 standard 勝出，三局最後的 1–2 分都來自蠻族攻擊時被動拿到的 `ck.defenderOfCatan`；game 36 在 12000 步（約 2192 次擲骰）後仍未終局（standard 11 分、naive 14–15 分，目標 16 分；另以 20000 步上限跑也未終局）。
- **狀態**：已知限制，根因與是否在本版修正尚未判斷，之後可能改寫這段。重現腳本放在 repo 外（`.worktrees/_scratch/sfckg-wd/`），不提交。

## 審查得出的限制與後續事項

- **`rescore` 只能重排，不能排除**：唯一候選即使是負分仍會被選。`knight.displace` 的小島罰分實際上幾乎不會觸發，因為 `siteBlocked` 會先把該計畫排除。
- **未調校的常數**：K6 的分數公式拿掉了計畫建議的常數項 `1`；`REACTIVATE_PRICE = 0.3`、`DEFENSE_PER_LEVEL = 0.1`（`chase.ts`）與 `OPEN_END_PENALTY = 0.3`（`rescore.ts`）都是推測值，沒有調校。
- **追擊海盜在模擬對局中是 0 次**：只有固定盤面 FX-C1／C8 守門，真實對局的行為要靠 Q3 與試玩觀察。
- **效能**：4 人固定盤面上 K2 的重算 p50 2.6 ms、最大 4.3 ms；5–6 人實際對局的 `decide` 最大值由 Q3 量測：10.35 ms（5 人 1 standard vs 4 easy），其餘組都在 10 ms 以下。
- **T&B（0.4.4）的後續事項**：
  - friendly robber 的 `robberTargets` 寫法：FR 在沒有合法格時回沙漠，要與 fold 的初值相容。
  - `knightDecision` 的強制第一項。
- **`fallbackDecision`** 的 JSDoc 已在 #168 補上。
