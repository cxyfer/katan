# Explorers & Pirates 電腦對手（v0.4.5）：實作紀錄

本檔是諮詢性的工作紀錄，對應 [E&P 計畫](../plans/2026-11-04-bots-explorers-pirates.md) 與 [整體策略](../plans/2026-11-04-expansion-bots-roadmap.md)。所有切片都以 squash merge 合併進 `release/v0.4.5`。5 個 profile（`ep-land-ho-2025`、`ep-pirate-lairs-2025`、`ep-fish-2025`、`ep-spices-2025`、`ep-full-2025`）一次開放 easy 與 standard 座位（3–4 人，沒有 hard），走計畫 §5.3 的方案 (a)，沒有任何 profile 延到 0.4.6。

## 切片與 PR

| 切片 | PR | squash commit | 內容 |
|---|---|---|---|
| E0 骨架 | #204 | `9118579` | 骨架的 `phase`／`endWindow` 鉤子、rules 匯出的 E&P 常數、模組註冊 |
| E1 保底與路徑 | #205 | `b25b85c` | 保底 duty、安全步數的路線 BFS、測試 kit |
| E2 Land Ho! | #206 | `1e5011a` | 移民、探索期望值、港口、金幣估值、gating |
| E3 Pirate Lairs | #207 | `5894707` | 變動式開局、海盜 frame 的回答、貢品、追擊、船員與巢穴、任務登錄表 |
| E4a Fish | #208 | `40f6fcc` | 擲魚、裝載、交付 |
| E5a server 測試 | #209 | `96f3496` | `packages/server/test/explorers-pirates-bots.test.ts` |
| E4b Spices 與 Full | #210 | `4eb7721` | 香料農場、全部任務、開放 5 個 profile |
| E5b bench 與文件 | 本 PR | 本分支 | `BENCH_KITS` 加入 `explorersPiratesKit`、SPEC／FIDELITY／API／README／規格／計畫與本紀錄 |

規則層的擱淺死結（R7）由先前的 #97（`ep-2025.2`）修掉，不屬於本輪。

## 實作期間的決定

- **standard 一律追擊海盜**：追擊不花資源，所以不做取捨；easy 依計畫 §4.4 的差異。
- **Bot 不主動提出 gold 報價**：gold 交易只在真人提出時發生。
- **MVP 不做 `ep.unload` 與 `ep.swap`**：不影響任何任務的達成（Q2 全過）。
- **能力靠規則與 hints 生效**：只在選香料農場時估值；Swift 只在低於 `EP_SWIFT_MAX` 時計入。
- **變動式開局由 E&P 的 `setup` 全權處理**，base setup 不會執行（計畫 §4.2）。

## 與計畫不同之處

- #97 的規則修正取代計畫中「保底回 null」的擱淺列（§4.1、§4.5）。
- E1 的審查收緊了測試 kit 的守恆檢查：crew 計數納入駐在巢穴與香料農場的 crew（比照 rules `piecesInPlay`）；魚的檢查改依劇本有無魚任務判斷，不看剩餘總數；每邊 3 艘的豁免只給行動者 active 船所在的邊。
- E3 的審查補上追擊就緒判斷：只剩追擊可做的船也算有事可做，`endWindow` 因此會送 `ep.startMovement`，不會直接結束回合（`chaseReady` 比照 rules `canChase`）。
- E4a 與 E4b 依序進行而不是並行：Spices 需要 Fish 的任務機制。
- C8（計畫 §2.3）：Pirate Lairs 是印刷盤面加上變動式放置（`setupModes: ['fixed']` 選盤面，`fixedStart: false`）；SPEC 與 FIDELITY 的文字依此澄清，只是文件修正，規則不變。

## Q1 與 Q2

來源：`BOTS_SEEDS=10`，easy 與 standard 混合；每局 0 拒絕，watchdog 從未觸發。Q2 的所有門檻（計畫 §6.2）都達成，沒有調低。

| profile | 人數 | 步數 平均／最大 | 回合 平均／最大 | 機制計數 | 每視窗指令上限 |
|---|---|---|---|---|---|
| Land Ho! | 3 | 212／243 | 25.8／31 | 新島建立平均 2.0（最少 1）；探索 15.8（最少 15）；港口 2.9 | 16 |
| Land Ho! | 4 | 287／358 | 30.1／35 | 新島 5.6（最少 4）；探索 15.7（最少 14）；港口 3.7 | 19 |
| Pirate Lairs | 3 | 475–720 | 39–67 | 巢穴 3–6；上岸船員 9–18（約 15）；追擊 6–20（約 12）；建立 2–6 | 23 |
| Pirate Lairs | 4 | 435–813 | 35–68 | 巢穴 3–6；船員 10–18（約 14）；追擊 6–18（約 12）；建立 2–7 | 33 |
| Fish | 3 | 716／791 | 54.3／67 | 擲魚 28.2；交付 7.1（最少 5）；巢穴 3.5 | 29 |
| Fish | 4 | 819／983 | 62.3／70 | 擲魚 27.6；交付 8.9（最少 3）；巢穴 4.1 | 29 |
| Spices | 3 | 760／866 | 52.1 | 香料交付 8.0（最少 4）；農場船員 10.6；魚 8.2（最少 2） | 34 |
| Spices | 4 | 964／1148 | 63.6 | 香料 10.6（最少 4）；農場船員 13.0；魚 8.9（最少 3） | 33 |
| Full | 3 | 803／1091 | 57.5 | 香料 5.4（最少 2）；農場船員 6.8；魚 5.9（最少 3）；巢穴 2.4；軌道 巢穴／魚／香料 6.4／5.9／5.4 | 36 |
| Full | 4 | 1034／1235 | 73.1 | 香料 6.6；農場船員 9.8；魚 6.7；巢穴 3.4；軌道 10.1／6.7／6.6 | 33 |

## server 測試

`packages/server/test/explorers-pirates-bots.test.ts`（#209）以 HTTP 經 service 跑 E&P 的 bot 牌桌；bots 的測試是 `packages/bots/test/ep-*.test.ts`。

## Q3 bench

E5b 把 `explorersPiratesKit` 加進 `bench/run.ts` 的 `BENCH_KITS`，所以 `--profile ep-*` 會輸出 `explorersPirates.*` 機制計數。`configsFor` 對 3–4 人 profile 已給出 8 組設定（1 standard vs easy／naive、全 standard、全 easy，沒有 hard），沒有另加「3 standard vs 1 fallback」，那個情境由 Q1 的 fallback-only 座位測試涵蓋。`rules-sim rounds` 沒有 E&P 的固定盤面參考值，維持 `n/a`。

只跑了小規模的冒煙（共用的 4 核機器）：`pnpm --filter @katan/bots bench 10 --profile ep-land-ho-2025` 與 `bench 5 --profile ep-full-2025`，種子從 10000 起。所有設定的 rejections、stuck、watchdog、fallback/game、problems 都是 0。下表的「回合」是 bench 的 `avg rounds`（與 Q2 的回合統計口徑不同，不能互相比較）。

| profile | 設定 | 局數 | focus 勝率 % | 公平值 % | 平均回合 | 平均指令 | 每視窗最大指令 |
|---|---|---|---|---|---|---|---|
| Land Ho! | 3p 1 standard vs 2 easy | 10 | 30 | 33.3 | 8.7 | 228 | 17 |
| Land Ho! | 3p 1 standard vs 2 naive | 10 | 100 | 33.3 | 8.9 | 145 | 14 |
| Land Ho! | 3p 3 standard／3 easy | 10 | — | — | 8.6／9.1 | 207／223 | 18／16 |
| Land Ho! | 4p 1 standard vs 3 easy | 10 | 50 | 25 | 7.3 | 273 | 18 |
| Land Ho! | 4p 1 standard vs 3 naive | 10 | 100 | 25 | 7.7 | 155 | 17 |
| Land Ho! | 4p 4 standard／4 easy | 10 | — | — | 6.7／7.3 | 239／281 | 18／19 |
| Full | 3p 1 standard vs 2 easy | 5 | 40 | 33.3 | 22.3 | 881 | 31 |
| Full | 3p 1 standard vs 2 naive | 5 | 100 | 33.3 | 20.6 | 371 | 25 |
| Full | 3p 3 standard／3 easy | 5 | — | — | 18.7／21.3 | 785／837 | 30／27 |
| Full | 4p 1 standard vs 3 easy | 5 | 60 | 25 | 17.8 | 1034 | 30 |
| Full | 4p 1 standard vs 3 naive | 5 | 100 | 25 | 25.9 | 578 | 29 |
| Full | 4p 4 standard／4 easy | 5 | — | — | 14.8／20.0 | 886／1086 | 31／27 |

樣本太小，勝率只能看出 standard 勝過 naive（保底），對 easy 的差距要用 `bench 50` 才有意義；完整 Q3 留給 QA（不擋發布）。

## 限制與後續事項

- 不主動提出 gold 報價、MVP 不做 `ep.unload`／`ep.swap`（見上）。
- 計畫 §10 E8 的項目延後到之後的 patch，不屬於 0.4.5：harbour 中轉（`ep.unload`、`ep.swap`）、主動提出含金幣的報價、海盜阻擋戰術、hero 最佳化（`pickCrew` 只在 crew 用完時才用，10 種子內沒有走到）、聰明換船（`ep.buildShip` 的 `replace` 未實作；船數上限 3 等於目標，用不到）。
- 玩家公告（`player-notes.ts`）是另一個發布步驟，本輪不加。
- 瀏覽器驗收與完整 `pnpm verify` 留給 rc 前的發布流程。

## 驗證

- `pnpm --filter @katan/bots typecheck`（含 `bench` 專案）通過；`bench-args`、`matrix`、`support` 三個測試檔 37 個測試全過。
