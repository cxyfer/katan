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

待發布 QA 補上：bench（`bench --profile sf-ck-new-shores-2025`、`sf-ck-new-shores-paired-2025`）在 gating 開放之後才跑得動（D6），依計畫 §6.4 在發布 PR 附上 Q3 表，並引用 #135（SF standard 在 3–4 人對 naive 未達 soft target）。

## 審查得出的限制與後續事項

- **`rescore` 只能重排，不能排除**：唯一候選即使是負分仍會被選。`knight.displace` 的小島罰分實際上幾乎不會觸發，因為 `siteBlocked` 會先把該計畫排除。
- **未調校的常數**：K6 的分數公式拿掉了計畫建議的常數項 `1`；`REACTIVATE_PRICE = 0.3`、`DEFENSE_PER_LEVEL = 0.1`（`chase.ts`）與 `OPEN_END_PENALTY = 0.3`（`rescore.ts`）都是推測值，沒有調校。
- **追擊海盜在模擬對局中是 0 次**：只有固定盤面 FX-C1／C8 守門，真實對局的行為要靠 Q3 與試玩觀察。
- **效能**：4 人固定盤面上 K2 的重算 p50 2.6 ms、最大 4.3 ms；5–6 人實際對局的 `decide` 上限交給 Q3 量測。
- **T&B（0.4.4）的後續事項**：
  - friendly robber 的 `robberTargets` 寫法：FR 在沒有合法格時回沙漠，要與 fold 的初值相容。
  - `knightDecision` 的強制第一項。
- **`fallbackDecision`** 的 JSDoc 已在 #168 補上。
