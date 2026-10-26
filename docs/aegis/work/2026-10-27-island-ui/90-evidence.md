# 海島開拓 UI：驗證證據

## 已交付範圍

使用者選定的 A 方向已實作於入口、首頁、大廳、初始放置／遊戲桌與結算：深海藍、暖金與羊皮紙色、本地原創 SVG、座位卡、資源卡、棋盤優先版面、桌面次要工具頁籤、手機面板。保留 React／TypeScript／Vite 與既有 controller、每座位投影、遊戲命令、身分及持久化邊界；沒有新增依賴、API、規則或假玩家統計。

## 最新全專案驗證

- 執行：`SMOKE_BASE_URL=http://127.0.0.1:3000 pnpm verify`，由 `set -o pipefail` 搭配 `tee` 留存完整輸出。
- 結果：exit 0；四個 package typecheck 成功；311 個測試通過（rules 109、protocol 7、server 82、web 113）。server 另有 11 個既存資料庫契約測試跳過，未當成已驗證。
- Web/server 正式建置成功；Web 75 modules，CSS 35.16 kB、JS 393.06 kB；目前檔案為 `index-BHi775Ad.css`、`index-B6m5ISOt.js`。
- 同一個已在執行的 port 3000 服務上 13/13 smoke 成功：健康、真正正式 client/bundle、session/config、公開房間／滿席、準備開局、12 次放置、基本棋盤、擲骰、聊天及其他座位不可取得私有資源。
- [完整命令輸出](verify.log)。SQLite ExperimentalWarning 與 Vitest 效能提示保留原狀，不是測試失敗。

## 瀏覽器目標與回歸

執行 [verify-browser.py](verify-browser.py)，Python Playwright 1.64 + `/usr/bin/chromium`，連接既有 `http://127.0.0.1:3000`；不另啟服務。最後一次 exit 0，**304 項斷言通過、52 張截圖、0 個 pageerror**。最後全專案 build 的 client hash 與該次瀏覽器 build 相同。

覆蓋：

- 1366×768、768×1024、360×640、390×844；`zh-Hant` 與 `en`；入口、首頁、大廳、初始放置、遊戲桌、結算 fixture 六個情境，共 48 張；另四張繁中手機手牌／交易／聊天／事件說明。
- 以實際 DOM 幾何檢查 document 不橫向溢位、ID 不重複、語言切換可用、可見 HTML buttons 至少 44×44、checkbox 維持小尺寸並排、邀請碼至少 27px、SVG 高度受實測可用高度限制。這些不是完整 WCAG／所有 SVG 目標尺寸認證。
- 空暱稱的行內錯誤；語系切換保留未提交暱稱；24 字元合法最長英文暱稱；空續局狀態及有房間的公開列表。
- 三個真實 session 透過 UI 建立／加入三人房、準備 gating、開局；用鍵盤選取及明確按鈕確認完成 12 次初始放置。選取前後 revision 不變、取消不提交、確認才讓 revision +1，轉為 preroll；之後透過真實 API 命令擲骰。
- 桌面及手機分頁的 Home／End 與焦點；交易草稿與聊天草稿在各自面板切換中保留。狀態列與必要回應提示在手機次要面板外。
- 真實跨身分聊天；離開聊天後顯示未讀、重開清除；手機可見聊天 → 桌面預設交易 → 返回手機保留聊天，再收到另一玩家訊息時不誤增未讀。手機說明內可查閱事件紀錄，兩顆真實骰子在所有尺寸可見。
- 限高 viewport 下先放大再按 Fit board，棋盤高度重新使用 `--board-available`，不是僅重設 pan/zoom。
- 直接取另一座位的真實 server 投影，確認其他玩家沒有私有 `resources`。
- 結算採 HTTP snapshot fixture 注入公開勝者／分數，未竄改 canonical 遊戲或資料庫；覆蓋結算元件與最終棋盤版面，**不證明已實際完成伺服器勝局**。

[截圖索引](../../../screenshots/island-ui/README.md) · [機器可讀斷言及版面紀錄](../../../screenshots/island-ui/browser-report.json)。

## 獨立審查與修正

先規格、再品質；分別審查 pregame 與 gameplay 整合，皆為唯讀 advisory，不代替產品驗收。

- Pregame 規格：無確認 finding；22 組新增雙語 key 與插值對齊，建立／加入／續局／host gating／profile 限制保留。
- Pregame 品質：P2 checkbox 全寬／上下排列與 P3 邀請碼字級被通用段落覆蓋。已在欄位 modifier／共用 input selector／邀請碼 owner 修正，reviewer 回讀確認；全部尺寸雙語的 computed style assertion 通過。
- Gameplay 規格：P2 Fit board 測量值沒有 CSS consumer、P2 跨斷點返回手機聊天時可見性未同步。已恢復 max-height consumer，並讓 MobileDrawer mount/cleanup 對同一 chat reducer 同步可見性；reviewer 回讀確認目前 production source 無待解規格 blocker。
- Gameplay 品質：P2 骰子／公開分數在 generic span 上不可靠的 aria naming，以及最長合法不斷詞勝者暱稱在 360px 結算頁溢位。前者已使用骰子 img role／真正隱藏文字分數標籤修正，後者實際在 Chromium 重現後於 `.result__winner` 加 `overflow-wrap:anywhere`；reviewer 回讀確認，目前沒有待解 production finding。最新完整 311 tests／13 smoke／304 browser assertions 全數在此兩項修正後通過，最長勝者名稱 fixture 保留於所有尺寸與雙語。
- 協調者補強：手機說明提供既有事件紀錄（HEAD 原本手機已無此功能，因此不是本次新增回歸）；修正擲骰／結束回合圖示依 commandType 對應。
- 新回歸：`drawer.test.ts` 四個離開聊天方向；`chat-visibility.test.tsx` 實際 MobileDrawer/GameTools 掛載交接搭配 canonical reducer，驗證未讀與保留草稿。新 harness 初稿的 state factory／event discriminator 契約錯誤由 typecheck 找出並修正，最新 113 web tests 通過；另兩個 app semantics cases 驗證雙語骰子可及角色與分數脈絡，並依正確的 session 優先規則明確操作語言切換。沒有把失敗初稿當通過證據。
- 首輪 browser harness 假設遊戲與非遊戲使用相同 locale test ID，已依既有 `locale-switch-game` 修正；該失敗不是 production UI 錯誤。最新完整 run 才作交付證據。

## 邊界與殘餘風險

- `read_image` 因模型沒有 image input 能力而失敗；已擷取截圖與量測版面，**沒有**宣稱模型主觀檢視圖片或使用者審美驗收。
- 未執行實機觸控、Safari／Firefox、讀屏器、完整對比／WCAG 稽核；鍵盤實際驗證包含頁籤及棋盤目標，不代表每個控制項的完整 AT 驗收。
- 本次不是整份 SPEC U-I18N 的混合語系全生命週期重新驗收；新介面雙語四尺寸已跑，既有交易／政策／存檔恢復等依回歸測試保護，未在真實瀏覽器重演所有組合。
- QA 使用服務正常 API 建立測試 sessions／rooms／games；沒有刪除資料庫、重設遊戲或重寫使用者資料。
- 無 remote；未推送、建立 PR 或自行合併。既有上層使用者截圖保持原變更，新截圖只在獨立子目錄。

## 基準、複雜度與安全收束

- Requirement baseline：[SPEC §8.8](../../../SPEC.md#88-approved-visual-direction--2026-10-27) 與本次使用者核准；runtime owner baseline：原 table controller／server projections／既有命令。整體 aligned；審查發現的 Implementation Drift 已回歸正確原基準，未改寫需求來合理化偏離。
- 複雜度控制：within-budget。原單一全域 stylesheet 在原 owner 取代為 base／pregame／table cascade layers；共享純 SVG 自成無狀態 helper，桌面工具與手機抽屜只管理呈現／同一 reducer 可見性。未增加 runtime source of truth、fallback、dependency 或保留第二套主題。大型 controller 未新增責任；新增測試與單一重跑腳本各有清楚 seam，無 exceeded-unresolved。
- 架構決策回填：無新增 durable runtime architecture；無需新增 ADR。樣式與面板的在地組合不改協定、儲存或部署 owner。
- 安全：只進行授權的 UI 原始碼／文件／獨立證據寫入與正常測試操作；未刪除、移動、reset、stash 或覆寫使用者截圖。未新增遠端素材或官方品牌美術。
- Workspace helper：`bundle --root /data/home/workspace/catan --work 2026-10-27-island-ui` 與 `check --root /data/home/workspace/catan` 均 exit 0；[proof bundle](proof-bundle.md) 只驗結構，Formal Evidence 欄位為 none（本任務的實際結果見此文件、完整 log 與 browser report），不是產品完成權威。
- 信心：B（實際目標操作＋回歸，仍有上述明確視覺／裝置邊界）。
