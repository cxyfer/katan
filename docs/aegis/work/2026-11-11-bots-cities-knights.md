# Cities & Knights 電腦對手（v0.4.2）：實作紀錄

本檔是諮詢性的工作紀錄，對應 [C&K 計畫](../plans/2026-11-04-bots-cities-knights.md) 與 [整體策略](../plans/2026-11-04-expansion-bots-roadmap.md)。所有切片都以 squash merge 合併進 `release/v0.4.2`。

## 切片與 PR

| 切片 | PR | 內容 |
|---|---|---|
| CK-A | #154 | rules 匯出 C&K 的 view／hints 型別、`CK_*` 常數與 14 個 frame kind；`ModuleViewMap`／`ModuleHintsMap` 加上 `citiesKnights` |
| 第 0 步 | #155 | 依 `3664868` 刷新計畫與整體策略（§12 記錄 E-1–E-13 的決定） |
| CK-B1 | #156 | 第 0.5 步的 economy 鉤子簽章；`Hand`／`Cost` 改為 CardKind；`BoardModel` 的組合掛點；commodity 交易與棄牌；14 種 frame 的保底；測試 kit |
| CK-B2 | #157 | 核心策略：setup、防禦、改良、計畫、騎士、F1 卡、frame 偏好；Q1／Q2 測試 |
| CK-C | #158 | 互動型進步卡（F2）、Alchemy、Commercial Harbor 報價、騎士封鎖戰術；M8 |
| CK-G | #159 | 開放 gating、server 測試、文件、大廳截圖 |

## 實作期間的決定

- **§10 D-CK1–D-CK8**：2026-11-11 採用計畫的建議。
- **刷新後的 E-1–E-13**：見計畫 §12。主要內容：
  - 手牌型別改用交集形式。
  - 組合掛點放在 `BoardModel`。
  - 張數類迴圈走 `CARD_KINDS`，估值類迴圈走 `Economy.kinds`。
  - 第 0.5 步併入 CK-B1 的第一個 commit。
- **CK-B1 審查後新增的平台修正**：
  - `etaRounds` 遇到清單外的卡種時回 `Infinity`。
  - 組合掛點改成呼叫時才接收 model。
  - 新增 `discardLimit` fold 鉤子與 `Economy.handLimit`，C&K 為 7 + 2 × 城牆數。
  - `BoardModel.modules`。
  - base 的城市計畫在 `legalCities` 中選點。
  - dedupe 鍵區分物件與陣列。
- **CK-B2**：見計畫 §12.1。
  - 防禦視窗由 ≤ 2 放寬為 ≤ 4，順序改為 activate → promote → recruit。
  - M5 的定義。
  - naive 對照僅供參考。
- **CK-C**：見計畫 §12.2。
  - Intrigue 的價值條件。
  - 騎士封鎖戰術保留，但不列入 M8。
- **E-9（截圖）**：使用者在 2026-11-11 決定比照 SF-4：PR 證據放 `pr-assets` 的 `pr-159/`，`docs/screenshots/cities-knights/lobby-cities-knights.png` 收一張大廳的參考截圖。拍攝腳本為 `scripts/bots-cities-knights/capture.py`。

## Q1 與 Q2（10 種子）

- Q1：
  - 40 局全部以勝利終局：0 拒絕、0 殘留 pending、0 看門狗、0 次「策略閒置、但保底有動作」，資源、commodity、進步卡與棋子都守恆。
  - 每視窗每座位最多 16 個指令（上限 40）。
- Q2：數字取自 CK-C 的 head `282f65f`，與合併後的 `1c91cce` 內容相同。審查期間的 `9ce1f0b`、`b20ae03` 實測數字相同。

| 格 | M1 招募／啟動（每局最少） | M2 最高改良 | M3 打牌（每局最少） | M4 守住 | M5 失城 standard | M6 大都市 | M7 F1 卡種 |
|---|---|---|---|---|---|---|---|
| `ck-2025` 3 人 | 3／5 | 4 | 9 | 9 | 0.27 | 16 | 12 |
| `ck-2025` 4 人 | 3／7 | 4 | 14 | 3 | 0.24 | 19 | 12 |
| `ck-paired-2025` 5 人 | 6／7 | 4 | 11 | 4 | 0.24 | 23 | 12 |
| `ck-paired-2025` 6 人 | 5／8 | 4 | 12 | 4 | 0.21 | 25 | 12 |

- M5 的 standard 每格都低於 easy。同一個 head 上 easy 為 0.58–0.67（#159 審查實測）。
- M8 為四格合計，只計策略席位：invention 34、commercialHarbor 23、guildDues 18、espionage 61、intrigue 5、sabotage 34、wedding 33、taxation 44、treason 19、diplomacy 13、alchemy 37、`progress.harborOffer` 68。
- 穩健度：#157 第 2 輪審查（Sol）另外抽測 `ck-2025` 4 人的種子 11–30，當時尚未含 CK-C。M2 最小為 4；M4 合計 9，11 個連續 10 局視窗為 3–7；M5 standard 為 26.5%，最差的視窗為 30.19%。三項中 M4 的餘裕最薄。

## Q3 bench

依計畫 §7.2，發布 PR 會附上 Q3 表，並在含 CK-C 的 release 上重量。下列是 CK-B2 審查修正前（尚未含 CK-C）每組 50 局的量測，期間暫時開啟 gating：

- 1 standard 對 easy 的勝率：3 人 62%、4 人 74%、5 人 52%、6 人 40%。公平份額依序為 33%、25%、20%、16.7%。
- 拒絕 0、保底代答 0；每視窗最多 18 個指令；`decide` 平均 ≤ 0.05 ms，最大 9.4 ms。

## 審查

| PR | 審查 | 主要發現與處理 |
|---|---|---|
| #154 | Sol；Codex 無發現 | 無 |
| #155 | Codex | `plentyPick` 必須維持只挑 Resource；`addHand` 要走 `CARD_KINDS`。兩項都已採納 |
| #156 | Opus 兩輪；Architect；Codex 兩輪 | ETA 忽略 commodity；組合掛點綁住建模時的盤面；手牌上限寫死為 7；測試缺口（5 個變異存活）；dedupe 鍵。全部已修正 |
| #157 | Sol 兩輪；Codex 兩輪 | easy 超額時先棄牌；Road Building 沒有保留船路掛點；第 2 輪城市沒有保證相鄰 ore 或 grain；Q2 在其他種子數會跳過；fuzz 的 Diplomacy staging。全部已修正 |
| #158 | Sol；Codex 兩輪 | Alchemy 在 4 張進步卡時低估抽牌；抽牌沒有受牌庫張數限制；Diplomacy 的最長道路平手判定；Treason 改為依騎士存量判斷可否放置。全部已修正 |
| #159 | Opus | CK-C 合併後，共用 frame 的 server 案例會 flaky：Bot 主動打出 Sabotage 等卡；FIDELITY 兩處仍寫不支援；注入的 responders 改為真實可達的順序；完整對局的建造斷言改為檢查 C&K 行動。全部已修正 |

## 已知的後續事項

- **0.4.3（SF+CK）**：
  - SF 的 `plan.ts` 與 `hard/economy.ts` 呼叫 `etaRounds` 時要傳入 `kinds`。
  - `sea.ts` 改用 `options.blocker ?? model.blocker`；`shipEdgesFrom`／`roadEdgesFrom` 要帶入模組（#156 Architect F9）。
- **0.4.4（T&B）**：T&B 的 gold／fish 是 goods，不是 CardKind。Planner 要先確認 goods 只走 `trade.goods`／`goodValue`（#156 Architect F10）。
- **`bank.ts`**：直接讀 `citiesKnights` 這個鍵。出現第二個 commodity 提供者時，改成 `bankStock?` 鉤子。
- **`COMMODITY_WEIGHT` 等常數**：都還沒調校。
- **M4 與 Intrigue 的餘裕**：都很薄，之後調整策略時要重跑 10 種子。
