# 沉浸式卡牌遊戲牌桌：瀏覽器證據

本目錄是本次重新設計新增的獨立證據，不覆寫既有 `docs/screenshots/` 截圖。

## 主要畫面

| 場景 | 1366×768 | 800×450 | 390×844 |
| --- | --- | --- | --- |
| 初始放置（繁中） | [初始放置](01-setup-1366x768-zh-Hant.png) | [窄橫屏](01-setup-800x450-zh-Hant.png) | [直屏](01-setup-390x844-zh-Hant.png) |
| 開局後遊戲桌（繁中） | [遊戲桌](02-game-1366x768-zh-Hant.png) | [窄橫屏](02-game-800x450-zh-Hant.png) | [直屏](02-game-390x844-zh-Hant.png) |
| 開局後遊戲桌（英文） | [遊戲桌英文](02-game-1366x768-en.png) | [窄橫屏英文](02-game-800x450-en.png) | [直屏英文](02-game-390x844-en.png) |
| 卡牌檢視 | [資源卡檢視](03-card-inspection-1366x768-zh-Hant.png) | — | — |
| 交易工具（直屏） | — | — | [交易面板](04-trade-390x844-zh-Hant.png) |

完整矩陣也包含 844×390、768×1024、360×640，以及兩種語系；總計 20 張截圖。

## 驗證範圍

- `verify-card-table.py` 使用 Python Playwright + Chromium，連接既有 `http://127.0.0.1:3000`，不另啟替代服務。
- 實際建立三個瀏覽器身分與三人房，完成準備、開局、12 次初始放置、擲骰、卡牌本地檢視、交易／聊天草稿切換、鍵盤 Escape 關閉工具與原生全螢幕進出。
- 最終結果：135 assertions、20 captures、0 browser runtime exceptions。
- [機器可讀報告](browser-report.json) · [驗證腳本](../../aegis/work/2026-10-27-island-ui/verify-card-table.py)

未涵蓋實機觸控、Safari／Firefox、螢幕閱讀器及完整 WCAG 稽核；截圖是瀏覽器與 DOM 幾何證據，使用者審美仍以實際牌桌預覽為準。
