# 電腦對手：伺服器與前端整合驗證

日期：2026-11-01。規格：[`../specs/2026-11-01-bot-opponents.md`](../specs/2026-11-01-bot-opponents.md)。PR 1（策略套件）：#58；本紀錄對應 stacked 的 PR 2（`feat/bot-seats`）。

## 交付

- 伺服器：migration `0002_bots`、Bot 席位（建房捷徑、大廳增減）、`isBotMember()` 套用於規格 §7.3 每一條路徑、`BotDriver`（喚醒、真人在場閘門、節奏、保底、報價階段計時）、`BOTS_ENABLED`／`BOT_DELAY_SCALE` 等設定。
- 前端：建房表單、大廳工具列、座位／玩家面板／房間列表／恢復清單的電腦標示、雙語系。
- 順帶修正兩個既有缺陷（Bot 讓它們更容易發生）：
  - 不同呼叫鏈的交易會被當成巢狀交易合併，一間房回滾可能帶走另一間房的提交；PostgreSQL 還會把無關查詢導進進行中的交易。改以 `AsyncLocalStorage` 綁定交易連線，SQLite 改為排隊。
  - 從首頁「繼續對局」進入時只以 `gameId` 訂閱，伺服器會忽略，玩家收不到推送；Bot 也因此判定無人在場。

## 驗證

- `pnpm verify` 全綠（數字見 PR）。
- PostgreSQL 17（臨時 Docker 容器）：server 測試全數通過，含 `0002_bots` 在既有資料上升級與並行交易回歸測試。並行交易測試在修正前於 SQLite 與 PostgreSQL 都重現失敗。
- 服務層完整對局：1 真人（以策略經 HTTP 代打）＋ 3 Bot，約 2 秒打完，Bot 指令沒有任何非 stale 的拒絕。
- 瀏覽器：`scripts/bot-opponents/capture.py`（production build、Chromium）。檢查項目全部通過：1366×768 建房按鈕可見、大廳增減與滿座停用、Bot 完成初始放置並擲骰、關閉頁面後 Bot 停止推進、從首頁恢復後繼續、恢復清單標示電腦、無頁面錯誤。截圖在 `docs/screenshots/bot-opponents/`。

## 已知限制

- 棋盤上資源產出的備援文字空間太小，維持原名；聊天不標示（Bot 不發言）。
- Bot 名稱取自固定英文名稱池，不在地化；「電腦」標示由前端附加。
- 規格 §12 列出的四個規則引擎缺陷已由 #60 以 `base-2025.3` 修正。策略已放寬道路建設與豐收之年的存量限制，並允許打出與本回合新卡同類的舊卡；道路規劃仍依正式規則停在對手建築。
