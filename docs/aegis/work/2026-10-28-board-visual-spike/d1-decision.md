# D1：暫時保留 SVG 工程候選

日期：2026-10-28。對應[實施計畫 D1／P3](../../plans/2026-10-28-board-visual-spike.md)與[驗收方案](../../plans/2026-10-28-board-visual-spike-acceptance.md)。評估起點為乾淨的 `feat/board-visual-spike`、`ee37ffb`；本次只同步文件並修正既有 Windows vocabulary 測試路徑，不修改 web product source。

## 決策與邊界

**暫時選 SVG 作為唯一工程候選，P2 不啟動。** 目前沒有已確認、必須使用 GPU 才能滿足的效果，也沒有持續多層 sprite／大量動畫場景或真實斜角光照的新需求。這是以現有實作與缺口作出的工程範圍決策，不是計畫 D1 第一列「可讀性與效能全部通過」的完整證明；M1／M3／M4 仍依 [P3 紀錄](p3-acceptance.md)保留未完成狀態。沒有證據可宣稱 Pixi 或 R3F 較佳、較快或成本已獲接受。

SVG 已實作地塊側緣／底面／接觸陰影及棋子側面／高光／陰影；preview ghost、290ms 確認建造、240ms 道路展開、授權 aggregate 生產與中性偷竊卡背均有測試或 production capture。動效只消費授權投影，不建立遊戲狀態、規則或命令 owner。24 飛行圖示、零粒子、八群／每群 800ms 與取消規則限制了演出成本。

## 決策證據與未滿足項

| 證據 | 可支持的判斷 | 不支持的宣稱 |
| --- | --- | --- |
| [P0 報告](p0-report.md)／[metadata](p0-evidence.json)：來源 hash、24 before 圖、6 事件序列及6取樣視窗 | M0 比較方法已建立 | before 圖是已接受的美術基準 |
| [P1A 報告](p1a-report.md)：cursor、同步世代、投影、gesture／picker、取消及 lifecycle 單元／DOM 測試 | 單一 owner 下保留事件與互動契約 | 原生裝置、輔具、GPU 或完整對局驗收 |
| [P1B 報告](p1b-report.md)／[metadata](p1b-evidence.json)：47 PASS、0 FAIL、3 NOT RUN；24 after 圖、6事件影片／trace與6效能視窗 | SVG 具有可審查的厚度／回饋與授權效果實作 | 人工已接受可讀性、收納因果與干擾程度 |
| P1B active rAF intervals：p95 8.6–8.9ms，max 58.4–108.2ms；P0 p95 8.5ms | 目前本地取樣沒有提供立即改用 GPU 的充分證據；max 必須保留追查 | P01 參考硬體通過、較 P0 更快、沒有卡頓或數值等於 GPU render time |

P0／P1B 的演出行為與活躍時窗不同，不能從平均或 p95 推定同品質效能優勝。沒有參考手機、60Hz／電源校準及完整硬體資料。P02 已有 idle／reduce 各30秒的應用 RAF 增量0，但真正背景30秒仍未跑；P03 registry／heap／GPU 趨勢與 P04 三次 cold-cache timing 未跑。

使用者尚未在相同 fixture 的 before／after 圖與10–15秒影片上接受「厚度／重量、事件因果、可讀性、干擾程度」。尤其800ms群組內收納時窗短，截圖可能已到群組移除後，不能代替影片可讀性判斷。實機 iOS／Android、screen reader、200% text zoom、Firefox／WebKit、DPR2／3與完整多席流程同樣未驗收。

## 何時重啟單一 GPU 評估

1. 使用者檢視目前 before／after 後提出具體未滿足效果；若是持續多層 sprite／大量動態場景，先選 Pixi 小型對照；若是真正斜角厚度、遮擋、光照，先選固定正交相機 R3F 小型對照。需求不明時只比較靜態構圖與一段建造，不同時建立兩套互動棋盤。
2. 在記錄型號、60Hz、電源、DPR與同品質fixture的參考桌機／手機，暖機後各3×30秒確認 P01 未達原20／33.3ms門檻，或max尖峰在trace中被定位為 SVG／CSS 演出成本；先保留原門檻與失敗樣本，排除環境／量測問題。單一max或本地模擬數字不足以觸發整盤移植。
3. 原生輸入／密集盤／最大zoom的可讀性問題被重現，且在現有owner內調整材質／短促演出仍無法達到已確認要求。以問題影片、目標identity、尺寸與反覆結果記錄限制，不以「GPU通常較快」當證據。

新候選預期收益須具體對應上述缺口，使用同fixture／品質／尺寸比較，重新核對依賴peer range，完成V／P與G01–G06後才可採用。若沒有人工可見收益、命令／目標不等價、隱私／取消不合約、效能未達門檻，或載入／維護代價未獲接受，停止該候選並保留SVG。評估不授權改規則、協定或新增平行遊戲狀態。

## 退場與回復

未建立 Pixi／R3F renderer、texture pipeline、動態載入、product query flag 或GPU依賴，故本輪沒有試驗runtime／依賴需要退場。runner保留計畫用`--renderer`標籤與URL參數，產品沒有讀取它們作renderer切換；它們不是GPU實作或故障路徑驗收。SVG與既有DOM HUD／TargetPicker仍是唯一操作路徑，不新增registry／adapter／fallback。

若短促效果造成問題，先以既有`prefers-reduced-motion`系統設定停用動效並由最新授權投影顯示結果；修復取消／可讀性後重測。需要撤回已提交材質／效果時，以明確revert `ee37ffb`及必要相依檢查處理，優先保留P1A事件／重連修正；不reset使用者工作、不重送command、不回滾server遊戲。未來GPU評估一律顯式選用；失效後回到最新SVG並丟棄舊演出，候選未採用時移除其runtime／依賴／product flag。

此決策允許整理工程整合證據與送審資料，沒有把缺少的人工／裝置／效能驗收改成PASS，也沒有更新canonical視覺基準。
