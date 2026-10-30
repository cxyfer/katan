# 海島開拓 UI：計分側欄、手牌與骰子互動驗證

## 本輪交付

使用者已批准本輪設計與實作計畫。左側計分欄預設收合，保留每個座位的顏色、公開分數與回合狀態；展開後顯示詳細資料，含隱藏分數的個人總分仍只顯示於本人座位。桌面展開會為側欄保留棋盤空間，窄螢幕改用可關閉的側邊覆層。

下緣手牌預設收合，保留張數與操作把手。滑鼠／筆移入展開，移出延遲 320ms 收合；固定或焦點留在手牌內時保持展開。觸控與鍵盤有明確切換按鈕，Escape 收合並將焦點還原至把手。資源卡與發展卡使用獨立可水平捲動的列；短橫屏使用手牌內部垂直捲動。子元件保留掛載，monopoly 選項不因收合遺失。新購卡及勝利點數卡沒有出牌按鈕。

每個新的權威 `turn.rolled` 事件以原始骰子值在舞台中央放大呈現 1600ms，之後保留工具列結果；事件序號讓連續事件重新啟動動畫，相同事件及語系切換不重播。Reduced motion 保留結果但停用位移動畫。僅 accepted 命令結果移往右下角，持續到使用者關閉；必要回應、錯誤與未知結果的處理維持顯著。

## 最終驗證結果

- `pnpm verify`：exit 0；全 workspace typecheck、production build 成功。
- rules 110、protocol 7、server 84、web 123，合計 **324 tests passed**。Server 另有 **11 個既有資料庫 contract tests skipped**，未計入通過。
- Web 新增 [6 個互動回歸測試](../../../../packages/web/test/table-interactions.test.tsx)：六席公開／私有分數邊界、hover／延遲／固定／焦點／touch／Escape、monopoly 草稿與新購卡限制、通知位置與關閉、連續骰子事件及語系不重播。
- Smoke **13/13**：同源前端、身分／設定、房間／滿席、開局、12 次初始放置、擲骰、聊天及其他座位無私有資源。
- 最終前端產物：`index-DIALwB7a.css`、`index-BN2uccZK.js`；瀏覽器矩陣逐筆記錄同一組資產。
- 獨立程式審查原先指出手牌遮住確認面板及連續骰子不重新播放，修正後再次讀碼確認；最終瀏覽器以實際點擊與 `animationstart` 確認修正效果，無未解決 finding。

## 兩種瀏覽器證據

共同環境：現有 `http://127.0.0.1:3000`、Python 3.13.5、Playwright、`/usr/bin/chromium` 154.0.8037.57。六種 viewport：1366×768、800×450、844×390、768×1024、390×844、360×640；每種皆測 `zh-Hant`／`en`。

| 證據 | 結果 | 已執行範圍 |
| --- | --- | --- |
| [真實三人 runner](verify-card-table.py)／[報告](https://github.com/cxyfer/katan/blob/ca1e8db/docs/screenshots/table-interactions/real/browser-report.json) | exit 0，**144 assertions、20 screenshots、0 runtime errors** | 實際服務建立／加入三人房、準備、12 次初始放置、鍵盤取消／確認、擲骰、資源卡本地檢視、交易／聊天草稿跨工具與尺寸保留、聊天送出、Escape 焦點還原、原生全螢幕進出 |
| [六席密集卡牌 runner](verify-table-interactions.py)／[報告](table-interactions-report.json) | exit 0，**190/190 checks、12/12 matrix cases、8 screenshots、0 pageerrors** | 正式前端；瀏覽器內攔截全部 API／WebSocket，以六個長暱稱、30 hex、舊／新發展卡及空手牌固定資料驗證呈現與互動，未寫入真實伺服器 |

密集情境涵蓋：無文件溢出、棋盤可見、六席分數經本地捲動皆可命中、桌面側欄保留／窄屏覆層、手牌與收合側欄避讓、兩列分開且本地捲動可達、monopoly 保留、hover／固定／鍵盤／觸控模擬、Escape 還原、必要回應高於手牌及側欄、accepted 持續及關閉、rejected／unknown 回復、中央權威骰子值／尺寸／計時／連續動畫／reduced motion。

在 1366×768、844×390、360×640 另以固定展開手牌實際點擊選取預覽確認，均成功；成功通知均不與手牌相交。最窄橫屏通知寬 158px，左緣 x672，手牌右緣 x654。第二個骰子事件在第一次結束前送達，觀測到兩次 `animationstart`。檢查不使用強制點擊。

[桌面手牌](https://github.com/cxyfer/katan/blob/ca1e8db/docs/screenshots/table-interactions/02-desktop-expanded-en.png)、[手機手牌](https://github.com/cxyfer/katan/blob/ca1e8db/docs/screenshots/table-interactions/03-expanded-390x844-zh-Hant.png)、[短橫屏](https://github.com/cxyfer/katan/blob/ca1e8db/docs/screenshots/table-interactions/03-expanded-844x390-zh-Hant.png)、[中央骰子](https://github.com/cxyfer/katan/blob/ca1e8db/docs/screenshots/table-interactions/05-central-dice-en.png)、[必要回應與側欄](https://github.com/cxyfer/katan/blob/ca1e8db/docs/screenshots/table-interactions/06-mobile-required-prompt-with-rail-en.png) 已直接檢視。完整索引與重現命令見 [截圖 README](https://github.com/cxyfer/katan/blob/ca1e8db/docs/screenshots/table-interactions/README.md)。

## 責任邊界與複雜度

[已批准計畫](../../plans/2026-10-27-island-ui.md) 與 [SPEC §8.8](../../../SPEC.md) 為需求基準。`GameScreen` 負責版面、`PlayersPanel` 負責公開計分呈現、`HandPanel` 負責本地收合互動、`DevCardPanel` 保留出牌路徑、`BoardView` 負責骰子呈現、`CommandStatus` 保留命令回復責任；無新 runtime owner、規則／協定／投影／持久化／依賴變動，無 ADR 變更訊號。基準對齊：aligned，scope requirements + architecture。

複雜度控制：within-budget。新增的互動樣式依批准計畫放在既有 table cascade layer；未展開或重寫舊壓縮樣式。舊樣式仍服務舞台、工具及其他未變動結構，本輪覆寫計分／手牌互動；其整體整理應在獨立樣式維護工作中以同一瀏覽器矩陣驗證。重複底部個人 HUD 已移除，發展卡只由手牌掛載。舊 `MobileDrawer` 仍無 runtime 引用，保留既有 state/test carrier，不在本輪刪除範圍。

Aegis `bundle`、`check` 結構檢查成功；這只證明工作記錄結構，不證明功能或需求驗收。第一次以不存在的 `python` 執行 exit 127，改用主機可用的 `python3` 後 exit 0。

## 未覆蓋與交付狀態

- 未執行實機觸控、Safari／Firefox、螢幕閱讀器、完整 WCAG 對比或真實使用者測試；Chromium 觸控／鍵盤模擬不等同實機或 AT 驗收。
- 密集 fixtures 只驗證前端呈現與互動；引擎／服務證據來自完整測試、smoke 與真實三人流程。截圖不替代使用者對美術方向的判斷。
- 測試建立的本機 sessions／rooms／games 未刪除或重設資料庫。
- 無 remote；僅建立本地提交，沒有 push／PR／merge。三張原有首頁／交易／聊天截圖變更保持不動並留在提交之外。
- 證據等級：**L2、信心 B**。已覆蓋本輪目標及相關回歸；設備／瀏覽器／AT 邊界如上。

本文件取代同一路徑先前的卡牌舞台證據；舊 318 tests 與舊 HUD／扇形手牌描述屬前版。原版截圖仍在 [card-table 歷史索引](https://github.com/cxyfer/katan/blob/ca1e8db/docs/screenshots/card-table/README.md)，不作為本輪互動通過證據。
