# 海島 UI — 卡牌遊戲舞台重製回顧

## 交付與證據

這次追蹤修正沒有再堆疊側邊面板，而是保留既有 Catan 規則並重建遊戲畫面的視覺層級：滿版舞台、浮動玩家 HUD、中心棋盤、下緣扇形手牌、右側操作 rail 與可收合工具 dock。資源卡使用原創本地 SVG 景觀，檢視只改本地 UI state；Fullscreen 由使用者按鈕觸發，事件狀態是真實瀏覽器狀態。

`pnpm verify` exit 0：318 tests passed、11 個既存 DB tests skipped、build、13/13 smoke。`verify-card-table.py` 以真實 Chromium 完成 144 assertions、20 captures、0 browser exceptions，覆蓋六個 desktop/tablet/mobile 尺寸、兩語系、三人 setup、卡牌檢視、工具草稿與 native fullscreen。Rules R-56 另覆蓋 30 hex、11 harbors、24/resource bank、34-card deck；完整範圍與限制由 [90-evidence](90-evidence.md) 維護。

## 有效做法

- 先保留 controller、projection 與命令 owners，再只在畫面 owners 重組，避免把「卡牌遊戲感」誤做成另一套規則。
- 用同一個 GameTools owner 跨尺寸重排，工具內容保持掛載，交易與聊天草稿不因工具或 viewport 切換遺失。
- 用 CSS grid 的 `auto + 1fr` 承載雙語 status strip，再用 `minmax(0, ...)` 限制手牌 row；這解決英文長文案在窄橫屏推高舞台的實際回歸。
- 用 strict browser evidence 檢查真實 DOM geometry、全螢幕外部退出、鍵盤焦點與 server revision，而不是只靠靜態截圖。

## 保留邊界與改善機會

- 舊 MobileDrawer 已停止掛載，GameTools 是牌桌的 canonical secondary-panel owner；state reducer carrier 仍保留，避免把 code retirement 混入本次視覺交付。若要清理，應另開明確 slice 並完成負向引用檢查。
- 本次沒有 Safari／Firefox、實機觸控、讀屏器與完整 WCAG 稽核；Chromium 的焦點與語意檢查不能代表所有 assistive technology。
- 瀏覽器證據使用正常服務建立測試資料，未刪除 DB 或重設真實資料。沒有 remote，因此不 push、建 PR 或 merge。
- 兩個獨立 reviewer agent 在回覆前失敗，沒有把失敗視為通過；本次以 coordinator readback、full verify、strict browser report 以及明確殘餘風險完成交付判斷。

## 複雜度與安全收束

within-budget；新增 ResourceCardArt 與 useFullscreen 都是局部純呈現／瀏覽器能力 owner，沒有新增 server、規則、依賴、API、資料 schema 或第二份遊戲狀態。原使用者截圖變更保持原狀，新證據獨立保存。
