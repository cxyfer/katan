# 電腦對手：數量改在房間中調整

日期：2026-11-02。規格：[`../specs/2026-11-01-bot-opponents.md`](../specs/2026-11-01-bot-opponents.md)（後續變更）、`docs/SPEC.md` §4.2／§4.9。

## 需求

使用者要求建房時不再詢問 Bot 數量，改成進入房間後再調整。

## 交付

- 建房表單：移除「電腦對手」數量與難度；建立房間一律只有真人房主。
- 伺服器：`POST /api/rooms` 不再接受 `bots`／`botLevel`（未知欄位會被忽略），建房不再建立 Bot 席位；`POST`／`DELETE /api/rooms/:roomId/bots` 仍是唯一的席位入口。
- 房間：「電腦對手」面板改為數量選擇（0 至真人以外的席位數）＋難度；前端以既有的加入／移除端點逐次補齊差額，因此每次席位變更仍由伺服器在 room lock 內驗證容量、權限與開局狀態。
- 每個 Bot 席位保留個別「移除」；把數量調低時由最後入座的 Bot 先移除。
- 語系：`lobby.bots.count` 改為「電腦數量」／`Bot count`，移除不再使用的 `lobby.bots.add`，提示文字改為說明調整數量會清除準備狀態。
- 證據腳本：`scripts/bot-opponents/capture.py` 改走「建房 → 房間設定數量 → 個別移除」的實際流程。

## 驗證

- `pnpm verify` 全綠（typecheck、各套件測試、production build、smoke、dev runner）。第一次平行執行時 `@catan/bots` 的 6 人 fallback 模擬與 `board-camera-controls` 各逾時一次（單檔與單一套件重跑皆通過），屬本機負載造成的既有 5 秒測試逾時，與本次變更無關。
- Web 測試：建房請求不含 Bot 欄位；房間數量控制以 2 次加入補到 2 個席位、調回 0 時依序移除；真人坐滿時數量控制停用。
- 伺服器測試：建房帶 `bots`／`botLevel` 只建立真人房主；Bot 席位改由房間端點建立，其餘席位、權限、容量與全 Bot 大廳行為不變。
- 瀏覽器證據：`scripts/bot-opponents/capture.py`（production build、Chromium）全部檢查為 true、沒有頁面錯誤；`docs/screenshots/bot-opponents/` 已用新流程重拍（建房無 Bot 欄位、房間數量 0→2→3、個別移除後再補回 3）。

## 取捨

- 前端逐次呼叫加入／移除端點，換取沿用既有 API 與伺服器端逐次驗證；單次調整最多數個請求，介面在請求期間停用控制項。
- 未提供「一次原子設定數量」的新端點，避免在 P1 合約外增加第三種席位變更入口。
