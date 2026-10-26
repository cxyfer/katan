# 海島 UI — 回顧

## 交付與證據

從入口、首頁、大廳到遊戲桌／結算，採用同一套海島視覺與本地 SVG，而不是在原頁面只換配色。桌面把玩家、棋盤、手牌與行動分區；次要工具用頁籤收納，手機保留必要提示並使用四頁籤面板。

最新全專案驗證 311 tests／13 smoke、Chromium 304 assertions／52 captures 全部通過；兩階段獨立原始碼審查的已確認問題均修正。詳細範圍與限制由 [evidence](90-evidence.md) 單一記錄維護，不把審查或結構性 helper 當產品驗收。

## 有效做法

- 先保留 controller／server 投影，再在呈現 owner 組合新介面。沒有為美術新增網路、規則或第二份狀態。
- CSS cascade layers 明確定義 base → pregame → table；玩家 seat 規則限定作用域，避免跨畫面覆寫大廳座位。
- 分頁內容保持掛載隱藏以保存表單；chat 可見性使用既有 reducer，並針對手機／桌面掛載交接驗證未讀，而不是只看頁籤外觀。
- 審查與實際反例互補：Fit board 的失效 CSS consumer 可由 source 找出；24 字元不斷詞勝者在 360px 的溢位由真正 browser matrix 重現，修正後將同一反例保留。
- 公開分數與骰子既有文字語意在改成圖像後需要明確恢復；雙語 role/name regression 比僅檢查裝飾 SVG 更能保護使用者資訊。

## 改善機會

- 新 acceptance harness 的測試 ID、state factory、事件 discriminator、session 語系優先與 Python import 假設曾造成失敗。已分辨 harness 與 production 問題，只以最終完整成功執行當證據；下次先用小範圍契約檢查減少全矩陣重跑。
- 當前模型不能讀圖，DOM geometry、互動成功和產出截圖不等於主觀視覺驗收。下一步品質提升應由使用者／可讀圖 reviewer 檢視截圖及實機，不能追加虛假的視覺通過標記。
- 結算用明示 HTTP fixture，不把短期 UI 驗證變成冗長或非授權資料庫操控。完整伺服器勝局、其他瀏覽器與 AT 是後續可選驗收，不隱藏於本次完成宣稱。

## 複雜度與安全收束

within-budget；新增 SVG helper 與 GameTools 各有單一呈現責任，既有大 controller 沒有新責任；原全域樣式改由三層清楚的 owner 控制，沒有保留雙主題或新增 fallback。沒有未解複雜度超標事項。

使用者原有截圖變更不納入本次提交；新證據在獨立子目錄。無刪除／移動／reset／stash／資料庫重設。無 remote，不 push、建立 PR 或 merge。方法包與紀錄沒有額外完成權威。
