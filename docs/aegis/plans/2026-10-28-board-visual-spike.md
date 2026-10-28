# 棋盤視覺與遊戲感強化實施計畫

## Goal

讓現有海島桌遊具有可辨識的地塊厚度、棋子重量與事件回饋，並以可比較的實作證據決定是否需要 GPU renderer。第一個正式候選是 SVG/CSS 加按需啟動的輕量 Canvas 2D 特效；PixiJS 與 React Three Fiber（R3F）是有條件的對照方案，不預設移植。

本次交付只建立開發分支、實施計畫及[驗收方案](2026-10-28-board-visual-spike-acceptance.md)。以下程式修改、依賴安裝、效能數字與視覺效果均為待執行工作，不是已完成成果。

開發位置：`D:/Workspace/Projects/katan/.worktrees/board-visual-spike`；分支：`feat/board-visual-spike`。已 fetch 並確認 base repository 為 `cxyfer/katan`、base branch 為 `master`、remote 為 `origin`；主 checkout 保留在 `master`。本次文件不 commit／push，後續程式實作依 AGENTS.md 走 feature branch 與 PR。

## Architecture

保留伺服器權威狀態、既有 table controller、規則 topology、DOM HUD／手牌／交易／聊天／對話框及 TargetPicker。先在現有 SVG owner 完成視覺切片，再按需要抽出繪製部分；不得先建立通用引擎或兩份遊戲狀態。

```text
GameScreen
  DOM HUD / hand / prompts / trade / chat
  BoardView: intent, selection, viewport, TargetPicker
    SvgBoardRenderer: geometry + projected board + interaction callbacks
    BoardEffects: presentation only, pointer-events none
    conditional GPU comparison: exactly one of Pixi or R3F
```

ArchitectureReviewRequired: yes。事件生命週期、座標投影與 renderer 邊界影響多個模組，完成時須核對單一 owner、依賴方向、取消／清理與實驗路徑退場。

## Tech Stack

- 現有 React 19.3.1、TypeScript、Vite、pnpm 10.28.0、Vitest、Testing Library。
- 第一階段：現有 inline SVG、CSS、必要時 Canvas 2D；不新增遊戲引擎依賴。
- GPU 對照候選：PixiJS 或 Three.js + R3F；只在下方 D1 選定後新增一組候選。
- 沿用 Python Playwright 驗證方法；新 runner 使用 worktree 內的獨立 Python venv、Playwright 管理的瀏覽器及可設定 executable path。
- 2026-10-28 研究已核對 PixiJS 8.22.0、@pixi/react 8.0.5、R3F 9.8.2 的套件資訊。這是研究日期快照，安裝前重新檢查 peer range、lockfile 與實際執行，不盲目使用 latest。

## Baseline / Authority Refs

優先順序：使用者本次規劃要求及前一輪視覺研究需求 → 使用者提供的 AGENTS.md → [SPEC](../../SPEC.md) → 執行程式碼 → 舊驗證紀錄。此計畫不取代產品規格。

| 已讀來源 | 對本計畫的約束 |
| --- | --- |
| SPEC §8.1–8.8、U-01–U-08、U-I18N | 棋盤優先、預覽確認、動效不阻塞、雙語、觸控／鍵盤、隱私與量測 |
| docs/aegis/BASELINE-GOVERNANCE.md | owner、相容邊界、退場與架構檢核 |
| docs/aegis/plans/2026-10-27-island-ui.md | 延續海島牌桌方向；不沿用其中過期的無遠端環境敘述 |
| packages/web/src/components/BoardView.tsx、GameArt.tsx、TargetPicker.tsx | 既有互動、骰子效果、素材與文字選取 owner |
| packages/web/src/board/geometry.ts、targets.ts、intent.ts | topology 索引、幾何投影、合法目標與歧義選取 |
| packages/web/src/state/useTable.ts、table.ts | snapshot 接收、connection／socket 狀態與權威投影 |
| packages/server/src/game.ts、packages/rules/src/project.ts、engine.ts、profiles.ts | snapshot 廣播、最近 40 事件、授權投影、彙總生產、啟用 19／30 格 |
| docs/screenshots/README.md、docs/FIDELITY.md | 現有截圖尚非已接受的視覺回歸基準；實機／輔具缺口不可當作通過 |
| packages/web/test/app.test.tsx、table-interactions.test.tsx、board.test.ts、resilience.test.tsx | SVG DOM 契約、互動／重連回歸與目前首次載入骰子演出 |
| docs/aegis/work/2026-10-27-island-ui/verify-table-interactions.py、generate-table-interactions-fixtures.mjs | 重用驗證方式；不直接假設 /usr/bin/chromium、/tmp 或 pnpm shell 行為適用 Windows |

BaselineUsageDraft: 上表來源均已在規劃前讀取或於前一輪研究核對；本計畫與驗收方案均引用；無缺失的規劃來源。SPEC 的舊 drawer／5–6 人狀態與部分 fidelity 敘述存在歷史落差，以具體章節與執行碼交叉核對，不順便重寫整份規格。

## Compatibility Boundary

- topology ID、hex／vertex／edge 索引、合法目標、價格、隨機結果與勝負不變。
- renderer 只接收本席授權 GameView；不得讀 server snapshot、未投影事件或推算對手當前手牌。
- 選取 → 預覽 → 確認 → 送出流程、command ID、未知結果與重試語意不變。
- pan／pinch／pointer cancel 不送出命令；TargetPicker 選取確定目標，不重新陷入歧義循環。
- 19 格 hex-r2 與 30 格 hex-r56、zh-Hant 與 en、現有 zoom／fit、草稿與工具狀態均保留。
- 本輪不更動規則、協定、資料庫、伺服器廣播、部署、聲音或官方美術。
- GPU 試作只在顯式 renderer 選項下 lazy load；SVG 為預設。無效選項、初始化／載入失敗有可操作的 SVG 路徑。
- 重連／初次載入不重播歷史，是待實作的行為修訂；P1 先同步 SPEC §8.8 與舊測試，不把目前行為誤稱已符合。

## Verification

完整判定、案例 ID、指令、效能取樣及人工驗收詳見[驗收方案](2026-10-28-board-visual-spike-acceptance.md)。本輪文件只做路徑／連結／diff／一致性檢查，不安裝依賴或聲稱程式測試通過。

未來執行階段的主要命令（在此 worktree 根目錄）：

```powershell
pnpm install --frozen-lockfile
pnpm --filter @catan/web typecheck
pnpm --filter @catan/web test
pnpm verify
```

## Scope Readiness and Change Necessity

- Requirement Ready Check: ready for planning。需求是提升視覺與研究 renderer；可直接規劃 P0／P1，D1 決定是否執行 GPU 對照。無須為本次文件選定最終引擎。
- Fact: source 起點為 master 與 origin/master 同步的 `4e4b9841c84772f62ac71c2a69cf631224dd989f`；已有兩種啟用棋盤、DOM 候選清單與骰子動畫。
- Assumption: 延續原創插畫與海島牌桌風格；不新增自由旋轉相機；短促事件效果比常駐環境粒子優先。
- Unknown: 實機 frame time、耗電、使用者對提升幅度的判斷、GPU 切片的實際投入。不得用假估算宣稱勝出。
- Change Necessity: 本次 docs-only；未來程式修改必要，因為單靠文字無法產生建造／生產演出。最低邊界為 web 棋盤、呈現狀態及測試，不需要規則／協定修改。
- Existence Check: 重用 BoardView 的互動 owner；動畫純函式 helper 處理去重與取消；viewport helper 處理跨 SVG／Canvas 螢幕座標。沒有第二個合法性、網路或 GameView owner。
- Plan-Time Complexity: BoardView 已約 570 行；不在其中堆入新動畫 scheduler、Canvas loop 與 GPU lifecycle。先分離可測 helper，再視切片需要抽出 SVG 繪製；不拆無關 UI。
- Architecture Integrity: 權威資料向下流，renderer 只回傳 target identity／視角操作；動畫輸入從投影產生，不回寫規則或重建狀態。
- Plan Pressure Test: 可由 P0 開始；無須先實作 adapter registry、asset atlas 系統或三套 renderer。新增模組都有案例與退場條件。
- TDD Route: off。對事件生命週期、投影及輸入契約加入有辨識力的測試；簡單材質／CSS 不寫鏡像測試，不要求每個動作 RED/GREEN。

## Planned File Ownership

以下新路徑是執行計畫，尚未建立；只有被啟動階段的檔案才建立。

| 檔案 | 工作與邊界 |
| --- | --- |
| packages/web/src/components/BoardView.tsx | 互動、viewport 與 renderer 接線；移除重複骰子 scheduler |
| packages/web/src/board/animation.ts（新增） | 純 presentation cursor／事件到效果映射、去重、重同步與容量限制 |
| packages/web/src/board/useBoardAnimation.ts（新增） | React lifecycle、可見性／motion 變更、取消與 timer 清理 |
| packages/web/src/board/viewport.ts（新增） | world／screen 投影、fit／zoom 及螢幕像素距離；不產生 topology ID |
| packages/web/src/components/SvgBoardRenderer.tsx（按需新增） | 從 BoardView 搬出的 SVG 畫面；不擁有 command／selection |
| packages/web/src/components/BoardEffects.tsx（新增） | 短促特效 overlay；只有 Canvas 確有用途才建立 Canvas context |
| packages/web/src/components/GameArt.tsx | 既有原創素材的厚度／陰影層，不重設整體美術風格 |
| packages/web/src/styles/board-visual.css（新增）、styles.css | 在現有 CSS layer 中載入；不再擴張壓縮的 table.css |
| packages/web/src/i18n/zh-Hant.ts、en.ts | 新文字／降級提示／accessible name 的雙語對照 |
| packages/web/src/state/useTable.ts、table.ts（僅必要時） | 若現有 socket 狀態無法區分重連同步，補最小「同步世代」呈現 metadata；不另建 transport |
| packages/web/test/board-animation.test.ts、board-viewport.test.ts（新增） | 純事件與投影契約 |
| packages/web/test/board-visual.test.tsx（新增）、app.test.tsx、table-interactions.test.tsx、resilience.test.tsx | 呈現、取消、Picker、初次／重連行為與既有回歸 |
| packages/web/src/board/renderers/（D1 後按需建立） | 僅選定的 Pixi 或 R3F renderer／本地素材，不同時移植兩套 |
| scripts/board-visual/fixtures.mjs、verify.py（新增） | 可攜 fixture 產生／瀏覽器驗證；不覆寫舊截圖與歷史報告 |
| docs/SPEC.md §8.8、docs/FIDELITY.md、本計畫與驗收方案 | 僅同步本工作流的行為／證據；未測項保留缺口 |

## P0 — 固定現況與建立可重跑的比較

目標：先知道測的是哪份產物，保留控制組；不修改遊戲呈現。

1. 在 worktree 安裝鎖定依賴並執行 web typecheck／test；記錄 commit、OS、Node／pnpm、瀏覽器版本及既有失敗，不能把原有失敗當新功能通過。
2. 建立 `scripts/board-visual/fixtures.mjs`，以 esbuild JS API 載入既有 fixtures 與 topology；輸出至傳入 `--out` 路徑。使用 Node os.tmpdir／path，不依賴 shell pnpm 或固定 /tmp。
3. 建立 `verify.py`：支援 `--base-url`、`--renderer`、`--out`、`--fixture`、`--browser`、`--executable-path`。不指定 URL 時，以本 worktree 的 server artifact、獨立暫存 SQLite、可用本地 port 啟動服務；finally 關閉自己啟動的程序。
4. runner 驗證 HTML／JS／CSS 對應本 worktree dist 的 hash，記錄 commit 與 dirty 狀態；外部 URL 不匹配就停止，不沿用 port 3000 上其他 checkout 的服務。
5. 以固定 fixtures 捕捉兩棋盤、兩語系、六種尺寸與無動畫的初始狀態；保存同種子動畫錄影所需的事件序列。
6. 依驗收 V01／T01／P01 保存 before 報告；截圖是待審查候選，不自動升格成 accepted baseline。

完成條件：新 runner 在 Windows 能產出帶來源 metadata 的控制組，資料無外洩，沒有覆寫 canonical screenshots。

## P1A — 事件生命週期與座標

目標：解決「何時播放、在哪裡播放」，再加入視覺。

1. 在 `animation.ts` 定義 presentation cursor：gameId、revision、view.seq、sync generation 及已消費事件序號。初次／重連／換局 baseline 使用 view.seq，不以最近 40 筆事件的尾端猜整局進度。
2. 正常連線的較新 snapshot 提取 seq 大於 cursor 的授權事件，依 seq 排序並去重；重複／舊版本資料不得觸發動畫。revision 與 seq 各自比較，不能互相替代。
3. 若事件不足以覆蓋期間、重連、背景恢復或序列倒退，取消待播效果並直接追上權威畫面。正常 snapshot 不可一律當重連而吞掉動畫；不為演出補取 server 私有事件。
4. `useBoardAnimation.ts` 管理 lifecycle。上限：最多 8 個待播效果群組、每群最長 800ms；新 mandatory action 立即中斷不必要演出。溢出直接保留最新狀態，不能逐條追播。
5. 拆出 `viewport.ts`，以 SVG CTM／等價矩陣處理 preserveAspectRatio 留白、pan／zoom 與 resize。歧義距離使用 CSS px；Canvas backing pixels 只由 DPR 決定。增加數字形式 hex corners 時保留 points 字串相容性。
6. 加入案例 E01–E10、I01–I05；明確重播 initial snapshot 測試改為「顯示最後結果但不播放歷史」。同步 SPEC §8.8 的這項修訂。

完成條件：正常 snapshot 能播放新事件，重連不重播、換局不沿用 cursor，投影往返與目標 identity 通過；舊 picker／preview／command 行為保留。

## P1B — SVG 材質與遊戲演出

目標：以同一美術方向交付可正式採用的視覺提升。

1. 用既有 GameArt 的頂面／側面／接觸陰影提升地塊與棋子；保持數字與道路清晰。先採近俯視構圖，不整盤大幅 rotateX。
2. 實作 preview ghost、確認後建築落下（約 220–350ms）、道路沿邊展開（約 180–280ms）。拒絕或取消不播放成功演出；權威狀態仍立即可查閱。
3. 骰子結果保留持久文字與 compact result；沿用單一新事件來源，新增動畫不得與既有中央骰子重複播放。
4. 生產使用「產地提示 → 實際 grants 彙總移動 → 收納區回饋」；不得將彙總假稱為逐 hex 精確支付。銀行短缺／無發放不產生虛構資源。
5. 強盜移動只表達位置改變。偷竊未知資源用中性卡背，不以顏色、文字、粒子或 aria 推洩卡種。
6. 短促粒子起始上限 80 顆，同時跨畫面飛行圖示上限 24 個，離屏／隱藏／reduced motion 時取消；不啟動永久環境 loop。
7. 完成後執行 targeted tests、production browser runner 及 `pnpm verify`。錄影與靜態畫面成對檢查，必須確認不是遮住棋盤來製造戲劇效果。

完成條件：驗收 E／I／V／A 基本案例與 P01、P02 效能目標通過，產物能作為 SVG 正式方案候選。

## D1 — 是否需要 GPU 對照

| 判斷 | 下一步 |
| --- | --- |
| SVG 已達到希望的厚度、回饋、可讀性且效能通過 | 選 SVG＋必要的特效層；跳過 P2，進 P3 |
| 仍需持續製作多層 sprite／大量可動畫場景／GPU 特效 | 選 Pixi 對照；不因「GPU 比較快」而推定勝出 |
| 希望固定斜角下有真正厚度、遮擋與光照 | 選 R3F 對照，使用程式幾何與既有插畫頂面 |
| 兩種需求仍難區分 | 先比較靜態構圖與一段建造動畫，不擴張成兩套互動棋盤 |

在工作紀錄寫明：未滿足的具體效果、SVG 的限制證據、選中候選、預期收益與停止條件。使用者檢視視覺差異前，候選仍屬技術評估，不稱為美術驗收通過。

## P2 — 單一 GPU 對照（條件階段）

1. 新增選定 renderer 與必要依賴；重新驗證 React peer range，更新 package.json／lockfile。`?renderer=pixi` 或 `?renderer=r3f` 顯式選用，未知值回到 SVG，預設 chunk 不預先載入 GPU 套件。
2. 第一片只做相同局部地形、道路、聚落、強盜和 P1 的建造／生產演出。採相同 fixture、尺寸、事件種子、錄影長度與品質設定。
3. Pixi：原 SVG 先輸出 standalone SVG／texture，測最大 zoom 與 DPR；不假設 Graphics SVG parser 完整支援 transform。R3F：固定正交相機、簡約 extrusion、單一光源；先不用物理、自由旋轉或後製。
4. 證明視覺收益後才接完整 19／30 格、港口、目標選取與 pan／zoom。輸入仍交回原 intent／selection owner；worldToScreen 由候選投影實作。
5. 初始載入、context lost／restore、resize、route unmount、StrictMode remount 與取消必須清理 GPU 資源／listeners／ticker。失效時保留遊戲與草稿，透過同一投影回 SVG；丟棄舊動畫。
6. 比較驗收 P／G 案例，寫出採用或淘汰證據。不通過就停止移植，保留已完成的 SVG 改善；不得偷偷降級驗收門檻。

完成條件：只有實測視覺及操作收益足以抵銷載入／維護代價的候選才可進 P3。Pixi 的 Canvas fallback 為實驗能力，不能取代已驗證的 SVG 故障路徑。

## P3 — 整合、退場與交付

1. 把行為測試改成共用契約，保留少量 SVG 專屬 DOM 測試；GPU 互動由真實瀏覽器驗證，不把 jsdom 當 GPU 測試。
2. 執行完整驗收；新截圖／影片／metrics 留在獨立工作流輸出，使用者接受後才更新 canonical 視覺基準。
3. 若選 SVG：刪除未採用候選、依賴與 query flag。若選 GPU：本輪交付期間保留 SVG 故障路徑，使用共用狀態／互動契約；不維護兩份規則或動畫系統。
4. 只有在另有等效、已驗證的無 GPU 操作路徑時，才另案評估移除 SVG。未使用的試驗 renderer 在本工作流交付前退場。
5. 更新 SPEC §8.8、FIDELITY 的本次相關證據與限制，建立同目錄 `work/2026-10-28-board-visual-spike/` 下的決策與驗收紀錄。沒有實機／輔具就寫未驗收。
6. 依 AGENTS.md 檢查歷史提交風格，在 feature branch 分批 commit；實作驗證完成後 push 到已核對的 origin，建立以 cxyfer/katan:master 為 base 的 PR，不自動 merge。

完成條件：驗收方案的 milestone 狀態可追溯、選中方案唯一、未選候選退場、PR 附精確證據與剩餘缺口。

## Execution Readiness View

- Intent Lock：強化視覺、事件回饋與可讀性；renderer 選擇由切片證據決定。
- Scope Fence：本次文件；後續 web 呈現與測試。不做規則／協定／資料庫／部署變更。
- Baseline Lock：4e4b984 起點、SPEC §8.1–8.8、19／30 格、授權 GameView、雙語與現有 command 流程。
- Approved Behavior：研究與規劃已授權；執行 P1 時先同步首次／重連不重播的規格修訂。GPU 仍為條件候選。
- Owner / Contract：rules topology、table transport、BoardView 互動、presentation effects 各有單一 owner。
- Compatibility / Retirement：預設 SVG，實驗依賴僅 D1 後新增；未採用候選在 P3 退場。
- Task Batches：P0 → P1A → P1B → D1 → 必要時 P2 → P3。
- Test Obligations：事件／投影單測、互動回歸、production browser、實機／輔具、效能與跨席隱私。
- Review Gates：架構邊界、自動化數據、人工視覺與實機證據；不是額外的執行許可流程。
- Drift / Rewind：一旦需要新規則資料／wire schema／獨立遊戲狀態，停止該切片擴張並回到設計；不以 fallback 掩蓋錯誤。
- Evidence：以驗收方案 ID 對照實際命令、產物來源、錄影與未測原因；方法文件不能授予完成狀態。

## Risks and Rollback

- 結構性風險：snapshot 與事件序號混用、動畫與遊戲互鎖、跨圖層投影偏移、hover 代替 touch。分別以 E、I、A 案例攔截。
- 視覺風險：厚度／陰影降低密集盤可讀性、資源動畫方向錯誤、中央效果遮住 mandatory action。V 案例須檢查演出中間幀。
- 效能風險：高 DPR、blur／shadow、常駐 ticker、紋理與 listeners 未釋放。P 案例記錄 production traces，不靠平均 FPS。
- 相容風險：GPU init／context loss、React peer 上界、Windows runner。G 案例與 P0 必須先證明可執行。
- 回復方式：先停用動效或顯式選 SVG，從最新授權投影重畫；不得重送 command 或回滾伺服器遊戲。已提交修改以明確 revert 處理，不 reset 使用者工作。
- 本計畫不承諾「五天完成」或固定 Pixi／R3F 成本倍數。P0、P1B、P2 各記錄實際投入，再估剩餘工作。
