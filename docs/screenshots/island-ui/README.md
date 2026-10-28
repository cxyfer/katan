# 走查截圖：入口到結算

本目錄以 2026-10-28 的正式建置重拍（`index-BN2uccZK.js`、`index-DIALwB7a.css`），
連線既有 `http://127.0.0.1:3000`，不另啟替代服務。影像為 CSS 像素 1:1；表列尺寸
代表瀏覽器 viewport，入口頁高於 768 時以整頁高度輸出。

## 主要畫面

| 畫面 | 繁體中文桌面 1366×768 | 繁體中文手機 390×844 |
| --- | --- | --- |
| 遊戲入口 | [入口](01-entry-1366x768-zh-Hant.png) | [入口](01-entry-390x844-zh-Hant.png) |
| 遊戲首頁 | [首頁](02-home-1366x768-zh-Hant.png) | [首頁](02-home-390x844-zh-Hant.png) |
| 三人房間大廳 | [大廳](03-lobby-1366x768-zh-Hant.png) | [大廳](03-lobby-390x844-zh-Hant.png) |
| 初始放置 | [初始放置](04-setup-1366x768-zh-Hant.png) | [初始放置](04-setup-390x844-zh-Hant.png) |
| 開局後遊戲桌 | [遊戲桌](05-game-1366x768-zh-Hant.png) | [遊戲桌](05-game-390x844-zh-Hant.png) |
| 結算 HTTP fixture | [結算 fixture](07-result-fixture-1366x768-zh-Hant.png) | [結算 fixture](07-result-fixture-390x844-zh-Hant.png) |

手機工具列：[手牌](06-mobile-hand-390x844-zh-Hant.png)、[交易](06-mobile-trade-390x844-zh-Hant.png)、[聊天](06-mobile-chat-390x844-zh-Hant.png)、[事件紀錄](06-mobile-log-390x844-zh-Hant.png)、[說明](06-mobile-help-390x844-zh-Hant.png)。

另有英文版、768×1024 與 360×640；檔名以相同情境前綴、尺寸及 `en`／`zh-Hant` 區分。
合計 53 張：6 個情境 × 4 種尺寸 × 2 個語系，加上 5 張手機工具列畫面。

## 證據範圍

- Chromium 實際使用既有 `http://127.0.0.1:3000` 正式建置，三個獨立瀏覽器身分透過 UI 建立／加入／準備／開局，完成 12 次合法初始放置，再以真實命令擲骰及跨身分聊天。
- 306 項腳本斷言涵蓋水平溢位、HTML button 尺寸、重複 ID、語言切換器、邀請碼及 checkbox 尺寸、棋盤高度，以及選取／取消／確認、工具列鍵盤操作、草稿保留與未讀徽章；0 個 pageerror。
- 現行 UI 已不再掛載 mobile drawer，390px 使用與桌面相同的工具列；腳本已改寫為 tool rail 版本。舊的 44px 觸控目標也不再成立，改記為前置畫面 36px、遊戲桌 24px（WCAG 2.5.8 AA）。
- 量測到但未修正的版面事實：入口頁在 1366×768 的文件高度為 842；360×640 大廳的邀請卡覆蓋 ready 控制。
- 結算以攔截該瀏覽器的 GET snapshot 回應注入公開結果欄位；**不是**實際玩到 10 分的伺服器勝利證據，也不修改資料庫。

截圖已產出，但產生它們的模型不具影像輸入能力，**未宣稱主觀視覺檢視通過**。未涵蓋實機觸控、Safari／Firefox、螢幕閱讀器或完整 WCAG 稽核。

[機器可讀檢查與幾何紀錄](browser-report.json) · [重跑腳本](../../aegis/work/2026-10-27-island-ui/verify-browser.py)
