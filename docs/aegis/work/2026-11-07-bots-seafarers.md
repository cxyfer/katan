# Seafarers 電腦對手（v0.4.1）：實作紀錄

本檔是諮詢性的工作紀錄，對應 [SF 計畫](../plans/2026-11-04-bots-seafarers.md) 與 [整體策略](../plans/2026-11-04-expansion-bots-roadmap.md)。所有切片都以 squash merge 合併進 `release/v0.4.1`。

## 切片與 PR

| 切片 | PR | 內容 |
|---|---|---|
| RX | #118 | rules 匯出 Seafarers 的 view／hints 型別 |
| PL-1 | #119 | BotModule 合約與組合骨架、golden replay |
| PL-2 | #123 | 測試基礎建設：harness、family 登記、bench |
| PL-3 | #121 | server：idle 診斷、重試下限、依 profile 的指令上限 |
| SF-1 | #124 | 海域模型 `sea.ts` 與 Seafarers 保底 |
| SF-2a | #127 | 島嶼計畫、造船與移船、Road Building 用船、金礦估值 |
| SF-2b | #126 | gold frame、強盜與海盜、preroll 騎士、setup |
| SF-3 | #130 | 驗收測試：Q1 矩陣、Q2 門檻 |
| SF-4 | 本 PR | 開放 gating、server 測試、大廳文案、文件 |

## 實作期間的決定

- **Q2-5（standard 移船局數）**：
  - SF-2a 單獨時，`sf-new-shores-2025` 是 0/20。能移的葉端船通常就是計畫路徑的一段，移走會讓航線斷掉。
  - 使用者在 2026-11-07 決定：SF-2b 合併後重測；3–4 人仍低於 2/20 時，改列 Q3 只報告；不放寬移船條件。
  - SF-2b 合併後重測為 10/20，所以沒有改列（SF 計畫 §6.2）。
- **`heuristic.ts`**：主 agent 授權 SF-2a 修改兩處，兩處在 base 上都不改變數值，golden replay 逐一相同：
  - 立即升級城市改用 `productionValue`，讓金礦計入；
  - `dedupeCandidates` 合併 base 與模組相同的指令，避免 easy 的 topK 重複。
- **海盜的「我的航線」**：
  - 以 SF-2a 的 `islandSettlementPlans` 為準，分別在海盜移走與海盜在各候選格時計算。
  - 放置海盜（7 點、騎士的目標）用與手牌無關的尺度：`FULL_HAND`，等價於 `value / (1 + ships × ETA_PER_SHIP)`。
  - 是否打騎士用真實手牌的 ETA，空手時不浪費騎士。
- **強盜與海盜的比較基準**：以現況為準。
  - 移海盜等於強盜留在原處，所以基準取強盜所在格的分數，計算時把手牌設為 0，因為強盜留在原處偷不到牌。
  - 海盜離開原格放開的對手前線要扣除。
- **gating**：`SUPPORTED_SCENARIOS = ['new-shores']`，刪除已棄用的 `BOT_RULE_MODULES`。SF+CK 缺 C&K 的 BotModule，仍不開放。

## Q1 與 Q2（SF-3，10 種子，SF-2a 與 SF-2b 合併後）

Q1：

- 40 局全部以勝利終局：0 拒絕、0 殘留 pending、0 看門狗、0 次「策略閒置、但保底有動作」，資源守恆，道路與船各 ≤ 15。
- 每視窗每座位最多 13 個指令（上限 40）。
- 最長 761 步，最長一段沒有新高分的擲骰為 28 次（看門狗 N=60）。

Q2：

| # | `sf-new-shores-2025`（3、4 人） | `sf-new-shores-paired-2025`（5、6 人） | 門檻 |
|---|---|---|---|
| Q2-1 付費造船 | 10/10、10/10 | 10/10、10/10 | ≥ 9/10 |
| Q2-2 小島加分 | 10/10、10/10 | 10/10、10/10 | ≥ 8/10 |
| Q2-3 standard／easy 付費造船 | 15/20、19/20 | 20/20、20/20 | 各 ≥ 12/20 |
| Q2-4 策略回應 gold | 10/20 | 19/20 | ≥ 4/20 |
| Q2-5 standard 移船 | 10/20 | 7/20 | ≥ 2/20 |

B-FAIR 與 fuzz 的取樣都包含「海盜在海上」：

- B-FAIR：4 人 71/103、6 人 82/134。
- fuzz：140/150、142/150。

## 審查

| PR | 審查 | 主要發現與處理 |
|---|---|---|
| #127 | Sol 兩輪；Codex | 立即升級城市沒有計入金礦、船用完時移船目標消失、小島聚落的即時評分漏掉 +2 VP；三項都已修正 |
| #126 | Opus 四輪；Codex 無發現 | 合併後金礦重複計價、強盜與海盜基準不一致、基準含偷牌加分、海盜放置受手牌影響；四項都已修正 |
| #130 | Opus；Codex 三個 P2 | 見該 PR |

## 已知的後續事項

- **SF-2b 的測試缺口**：四個變異仍會通過，見 #126 的 PR 說明。其中最值得補的一個是 preroll 打騎士後，目標要依放置分數挑選。
- **海盜航線的近似**：relief 只拿島嶼計畫比較，沒有和整體最佳計畫比，可能高估。等 SF-3 bench 再校準。
- **常數尚未調校**：`PREROLL_RELIEF_MIN=5`、`ISLAND_VP_VALUE=6`、`SETUP_REACH=3`、`FRONT_VALUE=1.5`。
- **`dedupeCandidates` 的鍵**：只排序頂層欄位，第一個帶巢狀 payload 的模組候選接入時要改成遞迴正規化。
- **Q3 bench**：依 SF 計畫 §7.2，在 SF-4 合併後執行，結果附在發布 PR。
