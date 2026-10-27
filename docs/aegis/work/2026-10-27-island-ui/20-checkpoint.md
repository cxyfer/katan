# 海島 UI — 卡牌遊戲舞台重製檢查點

- 本次接續：2026-10-27；使用者指出舊版仍是面板式網頁排版，提供橫向卡牌遊戲參考圖並要求重新研究修改。沿用同一 workstream，master @ af784f3，repository 無 remote。
- 目標已完成：滿版橫向／可全螢幕舞台、置中棋盤、上緣玩家 HUD、下緣扇形私有資源手牌、右側回合與建造操作、左下可收合工具；直屏以同一套元件保持可玩。
- 兼容邊界已保持：規則、協定、server-authoritative projection、私有資料、命令確認與 pending receipt、身分、存檔／暫停／恢復、雙語與既有 test hooks 未改語意。
- Todo：研究與計畫完成；舞台、卡牌、工具與全螢幕實作完成；B56-25 規則／房間容量 guard 完成；focused／full verification 完成；瀏覽器證據完成；reviewer agent 已回報並已處理其 P1/P2 findings，剩餘實機／AT 限制保留在 evidence。
- 最終證據：`pnpm verify` exit 0；318 tests passed、11 個既存 DB tests skipped、build、13/13 smoke；`verify-card-table.py` exit 0，144 assertions、20 screenshots、0 runtime errors。
- 目標尺寸：1366×768、800×450、844×390、768×1024、390×844、360×640，zh-Hant／en；包含三人真實房間、setup、roll、卡牌本地檢視、工具草稿、鍵盤 Escape、native fullscreen。
- Drift decision：continue → completed；沒有規則／協定／架構漂移，也沒有未決授權。TDD off / skipped。
- Retirement：遊戲 runtime 已停止掛載舊 `MobileDrawer`，新 canonical owner 是 `GameTools`；舊 reducer／carrier 暫時保留給現有 state/test surface，不在本次 scope 進行刪除，後續需另開 code-retirement slice。
- 邊界與風險：[90-evidence](90-evidence.md) 已記錄實際證據、人工視覺／實機／Safari／Firefox／AT 未涵蓋範圍；沒有 reset、stash、DB 刪除或 push／PR／merge。
- 交付檔案索引：[card-table README](../../../screenshots/card-table/README.md)、[browser report](../../../screenshots/card-table/browser-report.json)、[browser runner](verify-card-table.py)。

## 歷史基準

- 先前版本的深海藍／暖金／原創 SVG 方向仍保留於入口、首頁、大廳、結算；其舊版 304 assertions／52 captures 僅作歷史基準，不冒充本次牌桌驗證。
- 使用者原有 `docs/screenshots/` 修改與未追蹤檔案保持不動；本次新證據集中在 `docs/screenshots/card-table/`。
