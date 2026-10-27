# 海島開拓 UI：卡牌遊戲舞台驗證證據

## 已交付範圍

本次使用者追蹤要求已將遊戲桌重製為類似卡牌遊戲的橫向／全螢幕舞台：棋盤居中、上緣玩家 HUD、下緣私有資源卡扇形手牌、右側回合／建造行動、左下可收合交易／聊天／事件／說明工具，並提供使用者觸發的原生 Fullscreen API。直屏仍以同一套元件重排，不切換到另一個狀態 owner。

資源卡使用本地原創 SVG 景觀插畫，點擊只做本地檢視並以 `aria-pressed` 呈現，不會送出遊戲命令。工具面板保留掛載以保存交易／聊天草稿；必要回應、連線狀態、命令結果與返回牌桌不在可關閉工具內。既有 Catan 規則、server-authoritative 投影、私有資源邊界、命令 preview／confirm、身分、存檔／暫停／恢復與雙語功能均保留。

## 最新全專案驗證

- `pnpm verify` exit 0。
- 全 workspace typecheck 成功；rules 110、protocol 7、server 84、web 117，合計 318 tests passed；server 另有 11 個既存 SQLite/PostgreSQL contract tests skipped，未當成通過證據。
- Web/server production build 成功；最後 client bundle：`index-CQPvGCia.css`、`index-CLlw1FRo.js`。
- Smoke 13/13 通過：同 origin client、session/config、房間／滿席、準備開局、12 次初始放置、棋盤、擲骰、聊天及其他座位不可取得私有資源。
- Rules R-56 額外驗證 30 hex、11 harbors、24/resource bank、34 張 development deck；server room lifecycle 覆蓋 5/6 paired start 與 settings mismatch rejection。
## 卡牌舞台瀏覽器證據

執行 [verify-card-table.py](verify-card-table.py)，Python Playwright + `/usr/bin/chromium`，連接既有 `http://127.0.0.1:3000`，不另啟替代服務。

- 最終結果：144 assertions、20 captures、0 browser runtime exceptions。
- viewport：1366×768、800×450、844×390、768×1024、390×844、360×640；每個 viewport 都跑 `zh-Hant` 與 `en`。
- 真實流程：三個瀏覽器身分建立／加入三人房、準備與開局、12 次初始放置、鍵盤選取／取消／確認、擲骰、資源卡檢視、交易／聊天草稿在面板切換與尺寸切換中保留、Escape 關閉工具並還原焦點、原生全螢幕進出與外部退出同步。
- DOM／幾何檢查：文件無水平或垂直 overflow、ID 唯一、棋盤可見、五張私有資源卡具有可讀名稱、必要提示在 viewport 內、hand 完整落在 viewport 內且文件不溢位。
- 受限環境：提供的 GUI URL 回傳 HTTP 401，因此 browser evidence 使用既有本機同源服務；未宣稱 GUI URL 已驗證。- 主要截圖：[1366×768 遊戲桌](../../../screenshots/card-table/02-game-1366x768-zh-Hant.png)、[800×450 窄橫屏](../../../screenshots/card-table/02-game-800x450-zh-Hant.png)、[390×844 直屏](../../../screenshots/card-table/02-game-390x844-zh-Hant.png)、[英文版](../../../screenshots/card-table/02-game-1366x768-en.png)。完整索引在 [card-table README](../../../screenshots/card-table/README.md)，機器可讀結果在 [browser-report.json](../../../screenshots/card-table/browser-report.json)。

## 程式與相容性審查

- 需求／介面 owner：`GameScreen` 統一舞台，`GameTools` 統一次要工具，`HandPanel` 保持私有手牌資料邊界，`ActionBar` 保持 `deriveActions` 與 server hint，`useFullscreen` 只處理瀏覽器全螢幕能力與事件同步。
- 舊 `MobileDrawer` 不再由遊戲主畫面掛載，避免同一 viewport 存在兩套面板 owner；既有 reducer／測試 carrier 暫時保留，沒有再承載 runtime UI 行為。後續若要清理 reducer API，應另開明確的 code-retirement slice，不混入本次視覺交付。
- 本輪新增的規則／服務變更限定於 `base-paired-2025` 的 profile-owned B56 layout/deck/supply 與 room profile/capacity canonical guard；沒有新增依賴或持久化 schema。
- 完整 web 117 tests 通過；reviewer agent 已針對 B56 rules、room settings、hand layout、窄橫屏 allocation 回報，修正後由本地 source readback、完整測試與真實 Chromium 證據收束。

## 未涵蓋與殘餘風險

- 未做實機觸控、Safari／Firefox、螢幕閱讀器、完整 WCAG 對比與真實使用者測試；Chromium 鍵盤與 DOM 檢查不等於完整 AT 驗收。
- 截圖與 DOM geometry 證明構圖與互動覆蓋，不取代使用者對美術方向的最後審美判斷。
- 測試服務建立的 sessions／rooms／games 沒有刪除資料庫或重設任何使用者資料。
- 無 Git remote；未 push、建 PR 或 merge。使用者原有上層截圖變更保留，新證據獨立在 `docs/screenshots/card-table/`。

信心：B。核心目標操作與多尺寸 Chromium 已實際驗證，設備／AT／外部瀏覽器仍是明確未覆蓋範圍。
