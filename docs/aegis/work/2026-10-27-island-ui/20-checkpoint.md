# 海島 UI — 交付檢查點

- Task ID：2026-10-27-island-ui；起點：master / 7f75bbf；repository 無 remote。
- 使用者已核准 A 海島開拓方向；入口／首頁／大廳／初始放置／遊戲桌／結算均已完成，不需重複詢問設計方向。
- 最新驗證：完整 `pnpm verify` exit 0，311 tests passed、11 既存 DB tests skipped、Web/server build、13/13 同 origin smoke；Chromium 304 assertions／52 screenshots／0 pageerror。最終 bundle：`index-BHi775Ad.css`、`index-B6m5ISOt.js`。
- 兩階段獨立審查：pregame、gameplay 各先規格再品質。checkbox／邀請碼、Fit board、跨斷點聊天未讀、可及命名、最長勝者暱稱溢位皆已在 owner 修正並回讀；目前 reviewed production scope 無待解 finding。最後測試與 browser run 在全部修正後完成。
- 保留邊界：規則、協定、server-authoritative 投影、每座位私有資料、preview-confirm、存檔／暫停／恢復、身分與既有測試 hooks。沒有新 dependency 或假統計。
- 證據：[90-evidence](90-evidence.md)、[完整 log](verify.log)、[browser runner](verify-browser.py)、[截圖索引](../../../screenshots/island-ui/README.md)。
- 殘餘範圍：模型無 image input，未宣稱主觀視覺檢視；未做實機、Safari／Firefox、讀屏器及完整 WCAG 驗收。結算是明示 HTTP fixture，非真實伺服器勝局。
- 使用者原有上層截圖保持原變更；新證據只在 `docs/screenshots/island-ui/`。沒有 reset、stash、DB 刪除或其他破壞操作。
- 交付邊界：本地實作及獨立證據，結構性 bundle/check 已 exit 0；只納入本任務檔案。無 remote，不 push／PR／merge；後續視覺回饋由使用者檢視實際畫面決定。
- 續作順序：本檢查點 → evidence 的殘餘範圍 → SPEC §8.8 → 目前 Git 差異；已完成要求不重做。若來源改變，重新驗證受影響證據，不沿用過期通過結論。
