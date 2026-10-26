# 海島開拓 UI：瀏覽器截圖

本目錄是本次重設計新增的證據，不覆寫上層既有截圖。

## 主要畫面

| 畫面 | 繁體中文桌面 1366×768 | 繁體中文手機 390×844 |
| --- | --- | --- |
| 遊戲入口 | [入口](01-entry-1366x768-zh-Hant.png) | [入口](01-entry-390x844-zh-Hant.png) |
| 遊戲首頁 | [首頁](02-home-1366x768-zh-Hant.png) | [首頁](02-home-390x844-zh-Hant.png) |
| 三人房間大廳 | [大廳](03-lobby-1366x768-zh-Hant.png) | [大廳](03-lobby-390x844-zh-Hant.png) |
| 初始放置 | [初始放置](04-setup-1366x768-zh-Hant.png) | [初始放置](04-setup-390x844-zh-Hant.png) |
| 開局後遊戲桌 | [遊戲桌](05-game-1366x768-zh-Hant.png) | [遊戲桌](05-game-390x844-zh-Hant.png) |
| 結算 HTTP fixture | [結算 fixture](07-result-fixture-1366x768-zh-Hant.png) | [結算 fixture](07-result-fixture-390x844-zh-Hant.png) |

手機面板：[手牌／行動](06-mobile-hand-390x844-zh-Hant.png)、[交易](06-mobile-trade-390x844-zh-Hant.png)、[聊天](06-mobile-chat-390x844-zh-Hant.png)、[事件與說明](06-mobile-help-390x844-zh-Hant.png)。

另有英文版、768×1024 與 360×640；檔名以相同情境前綴、尺寸及 `en`／`zh-Hant` 區分。合計 52 張全頁截圖；尺寸表示瀏覽器 viewport，而非全頁影像高度。

## 證據範圍

- Chromium 實際使用既有 `http://127.0.0.1:3000` 正式建置，三個獨立瀏覽器身分透過 UI 建立／加入／準備／開局，完成 12 次合法初始放置，再由真實命令擲骰及跨身分聊天。
- 四種 viewport、兩種語系、六個情境；304 項腳本斷言涵蓋水平溢位、HTML button 尺寸、重複 ID、語言切換器、邀請碼及 checkbox 尺寸、棋盤高度，以及選取／取消／確認、分頁鍵盤、草稿與未讀交接。
- 結算以攔截該瀏覽器的 GET snapshot 回應注入公開結果欄位；**不是**實際玩到 10 分的伺服器勝利證據，也不修改資料庫。
- 截圖已產出，但目前模型不具影像輸入能力，**未宣稱主觀視覺檢視通過**。未涵蓋實機觸控、Safari／Firefox、螢幕閱讀器或完整 WCAG 稽核。

[機器可讀檢查與幾何紀錄](browser-report.json) · [重跑腳本](../../aegis/work/2026-10-27-island-ui/verify-browser.py) · [完整證據說明](../../aegis/work/2026-10-27-island-ui/90-evidence.md)。
