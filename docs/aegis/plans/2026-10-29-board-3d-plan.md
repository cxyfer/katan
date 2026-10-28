# 真 3D 棋盤：實施計畫與三 agent 交接

日期：2026-10-29。狀態：**提案，等待使用者批准；本階段不實作。**

前置閱讀：[研究](2026-10-29-board-3d-research.md)、[驗收](2026-10-29-board-3d-acceptance.md)。ArchitectureReviewRequired: **yes**，涉及 renderer 邊界、相機投影、輸入與相容路徑。TDD Route: off／不宣稱 test-first；每個切片仍須補測並驗證。

## 1. 目標、邊界與變更必要性

交付真正建模的六角柱、地貌、聚落／城市、實體道路與盜賊；固定正交斜視呈現可玩且明顯立體的桌遊。沿用既有海洋視覺、權威投影、命令確認與 #7 的安全演出。

不改 rules、protocol、server、存檔格式、規則 profile、玩家身份或隱私契約；不順帶升級 React、不重設全站 UI、不引入 WebGPU、自由 OrbitControls、物理、粒子或模型下載服務。

Change Necessity：CSS／多一層 SVG 陰影無法提供本次要求的真側壁、房屋體積、道路幾何與深度遮擋；最小有效變更邊界是 web 的 BoardView 渲染／投影及其呈現層。保留現有 geometry、intent、targets、controller、animation owner，不為新 renderer 複製它們。

BaselineUsage：已閱讀 `docs/SPEC.md` §8、既有 island-ui plan、#7 本地候選 plan／acceptance／D1、相關 source 與 package manifests。基準差異為「原 SVG-only 技術方向 → 真 3D + SVG 相容路徑」；使用者已提出需求，但本提案未批准。遠端 #7 狀態與最新 base 尚未查證，實施前必須刷新。

Requirement Ready Check：建模範圍、保留行為、技術方案、驗收與分工可交接；美術接受與依賴／GPU 實測是實施 gate，不在本文件假裝完成。批准此計畫後才建立／修改 source。

## 2. Git 與 #7 相依處理（主 agent 專責）

1. 記錄 Git root、目前 branch、所有 worktree、`git status --short`、remotes、可推送權限；依環境以單次 `git -c safe.directory=<verified-root>` 讀取，不能擅改全域信任。
2. 驗證 provider 認證，再讀 #7 的 base／head／state／merged commit。權限允許時 fetch 正確 remote 的 base。若仍 HTTP 401，不宣稱 PR 狀態，使用已確認本機 ref 並在交接記錄標示不能驗證遠端。
3. **若 #7 已合併**：由已更新的 base 建立 `feat/board-3d`。**若 #7 未合併**：由確認的 #7 head 建立 `feat/board-3d`，先做 stacked PR，base 指向 #7 head branch；#7 合併後再 retarget 真正 base。若遠端 branch 不存在或禁止 stacked PR，先報阻塞，不能偷偷把 #7 的全部差異包進一個對 master 的 PR。
4. 檢查新分支是否已被 worktree 使用，存在就沿用，不重複 checkout。預設位置主 checkout 的 `.worktrees/board-3d/`；`git check-ignore -v .worktrees/board-3d/`，未排除則以 `git rev-parse --git-path info/exclude` 找到本地 exclude 補規則。不為個人 worktree 改 `.gitignore`。
5. 保留所有既有未提交變更，不 stash／reset／搬移。本機舊候選維持不動。若在 `master` 開始、但 #7 尚未落地，先走上一步繼承；**不在 master 重寫一套 gameSync／animation**。
6. 本案三個 subagent 共用上述任務 worktree 並嚴格分檔，只有主 agent 執行 Git mutation、依賴／lockfile、共用契約與整合。使用者若要求各 agent 獨立 worktree，另建不同 branch，不把同一分支同時 checkout。
7. 完成後只 push feature branch，按實際 base 建 PR；不 merge。無認證時回報未 push／未建 PR，只有 push 成功才提供 branch／compare URL。提交風格比照 history，例如 `✨ feat(board): render modeled pieces in 3d`。

本次僅研究文檔，不替既有 #7 合併、不 fetch／commit／push；以上是下一階段執行流程。

## 3. 單一 owner 與資料流

```text
TableController / latest authorized public projection
                     |
                     v
BoardView (intent, selection, viewport, one animation cursor)
  |                  |                         |
  v                  v                         v
SvgBoard          lazy BoardScene3D         TargetPicker / confirmation
  |                  |                         ^
  +-- active view projection -> BoardTargetOverlay --+
                     |
                     +-> stage-local BoardEffects -> actual DOM seat anchors
```

依賴方向：view 消費既有 rules 拓樸／public projection；renderer 消費唯讀呈現輸入。模型不 import controller、network、TableState 或 private hand；不允許 mesh callback 直接 submit。active renderer 產出投影矩陣是衍生顯示資料，不反向更改 server／viewport 意圖。

### 開工即凍結的內部契約（主 agent 建立，三者只消費）

這些是新內部接口的**規格**，不是現有 export；不新增 wire schema。

| 契約／owner | 字段與規則 |
| --- | --- |
| `board/render-contract.ts` | `RendererMode`: auto／svg／r3f；`QualityMode`: standard／low；`BoardViewportState`: board-plane center `{x,z}`、fit-relative zoom、可用 CSS rect；不含私牌或命令函式 |
| `BoardSceneInput` | 既有 `BoardGeometry`／`PublicBoardView`、public players `{id,seat,color}`、既有 `BoardIntent`、合法且仍有效的 selection、既有 `BoardEffectGroup | null`、viewport／quality／motionAllowed；引用原有 type，不複製事件或板圖 schema |
| `BoardScene3D` 邊界 | 接受上述 props；僅回報 `onProjection`、`onReady`、`onUnavailable(reason)`。不自行變更選擇、判斷規則、開 picker、保存事件進度或發 command |
| `ProjectionSnapshot` | 真正 camera 的 viewProjection 16-number matrix、Canvas CSS rect、版本號與 clip 範圍；離屏／相機背後 anchor 不可互動。只在 camera／resize 變更時發出，版本不得倒退 |
| `board/projection.ts` | 以 numeric matrix 投影 `{x,y,z}` → CSS px 與 visible；edge 另投影兩端點。純數學、不 import `three`，以免提前載入 GPU chunk。SVG 以原 viewport 函式輸出同形的 projected anchors |
| `BoardTargetOverlay` | 用 projected anchors、既有 intent／describeTarget、唯一 select callback；控制 44px hit area、歧義與 focus；DOM surface 統一手勢，模型與 ghost 不搶事件 |
| `BoardEffects` stage 契約 | 接受既有 active group／public view、stage CSS rect、實際 seat／aggregate DOM rect；render pointer-events none、aria-hidden 的 stage-local SVG，不保留自己的事件 queue |
| 模型 local origin | 地塊頂 `Y=0`；棋子底部 local `Y=0`；道路 local +X 指向邊，長度由 endpoints 與兩端退讓計算；所有 geometry 預先定中心，scene group 只做定位／方向／短暫 transform |
| fallback owner | BoardView 持有 requested／effective renderer、failure reason、session retry；renderer 切換只清呈現，controller／selection／確認流程不 remount |

呈現取消的最小介面修訂：主 agent 在既有 `useBoardAnimation` 增加 `resetPresentation()` 回傳函式，重用目前 cancel／baseline 邏輯清 timer、queue 並將同一 cursor rebase 至最新 snapshot。Renderer 切換／GPU fault 呼叫它，不新增第二條 queue、不偽造 offline／mandatory 或 sync generation。這是 hook 的內部介面擴充，非 wire／遊戲狀態更動。自動 SVG→3D 切換須等 active pointer／pinch 結束，不在手勢中換投影；選擇與 focus 仍由同一 DOM owner 保留。

三 agent 不可修改此共用檔；提出變更先回主 agent，同步所有 consumer 後才修改。測試不能為了更換 renderer 而刪掉既有 command／privacy assertions。

## 4. 檔案責任與影響面

本案預期新增／修改超過 8 個檔案；以現有 owner 拆薄呈現層是必要成本，不是全前端重構。以下新路徑均為提案；若開工前已存在同責任實作，優先沿用並由主 agent 更新此表。

| Owner | 唯一寫入範圍 | 不可碰 |
| --- | --- | --- |
| 主 agent | `components/BoardView.tsx`、`board/render-contract.ts`、`components/SvgBoard.tsx`（將原 SVG JSX 原樣抽出）、`board/useBoardAnimation.ts` 的取消介面及既有 lifecycle 測試、web `package.json`／root lockfile、`styles.css`、i18n catalogs、必要的 `GameScreen.tsx`／`PlayersPanel.tsx` anchor attributes、SPEC／FIDELITY／INDEX | rules／protocol／server；不改他人未提交內容 |
| A：投影／互動 | `board/projection.ts`、`board/camera-fit.ts`、`board/useBoardViewport.ts`、`components/BoardTargetOverlay.tsx`、`styles/board-targets.css`、`test/board-projection.test.ts`、`test/board-target-overlay.test.tsx` | 模型、scene 資源、lockfile、BoardView |
| B：模型／場景 | `board/three/` 整個目錄（scene、camera bridge、models、materials、resource lifecycle）、`assets/board3d/` 本地 atlas／來源、`test/board-models.test.ts`、`test/board-scene.test.tsx` | controller、目標選擇、state、套件清單 |
| C：演出／故障測試 | `components/BoardEffects.tsx`（stage-local 化）、`styles/board-3d-effects.css`、`test/board-renderer-fallback.test.tsx`、`test/board-3d-lifecycle.test.tsx`、`scripts/board-3d/` runner／fixtures、`docs/aegis/work/2026-10-29-board-3d/` 證據 | #7 animation／effects 純函式、state 同步、A／B source、lockfile |

必要修訂既有測試由主 agent 處理 `test/app.test.tsx`／`test/board-visual.test.tsx`／`test/table-interactions.test.tsx`。`board/geometry.ts`、`intent.ts`、`targets.ts`、#7 `animation.ts`／`effects.ts`／`viewport.ts` 原則上不改；`useBoardAnimation.ts` 僅開放主 agent 增加上述 reset 介面與直接測試。發現真缺陷先報主 agent，不各自修。

## 5. 實施切片與 gate

### S1：保留 SVG 的共同邊界（主 agent 先行）

1. 完成 Git／#7 基準處理，記錄確切 source SHA、fixtures 與既有驗證狀態。
2. 把 SVG 繪圖抽為 `SvgBoard`，BoardView 對外仍只接受同一 controller；保留 toolbar、picker、selection confirmation、animation hook。
3. 凍結上節契約，準備 scene lazy boundary／ErrorBoundary、明確 renderer mode 與同一 animation hook 的 resetPresentation；補測 reset 清 queue／不補播／不改 gameSync。先讓 svg 路徑工作，尚未接妥的 r3f 不進預設，也不建立可顯示成成功的空殼。
4. 主 agent 獨占安裝 exact `three@0.186.1`、`@react-three/fiber@9.8.2` 及 dev `@types/three@0.186.0`；若 registry／peer 已變，先回報相容差異，不自動選 alpha 或升級 React。
5. 加本地 atlas loading 失敗的可觀測路徑、renderer status 與 stage／seat anchor contract，為 A／B／C 同步介面。frozen lockfile 安裝、web typecheck／test／build 通過，SVG bundle 不預載 GPU runtime。

S1 可單獨合併且原功能可用；新 GPU runtime 未啟用，沒有破壞性資料遷移。

### S2：三個 subagent 平行，按交接點接合

**A：投影與可操作性**

1. 寫世界→clip→NDC→CSS px 投影及 round-trip／resize／DPR 測試；clip 檢查不能只看螢幕 x/y。
2. 根據 B 提供的完整 scene bounds 及相機參數實作 fit；主 agent 掛入原 toolbar、zoom 0.7–3、pan clamp／keyboard。單一 DOM gesture owner 接管多指 capture、pointercancel 與 drag suppression。
3. 建 DOM target overlay、非精準 picker 及 focus；被裝飾擋住的交點仍可選；候選依 CSS hit area 判歧義。列表選擇沿用唯一 select callback，不重新用螢幕距離阻擋已明確選定的列表項。
4. 提交投影／選點 contract 測試與完整瀏覽器互動案例，回報需要主 agent 接入的 props／styles。不自行修改 BoardView。

**B：建模與 3D 場景**

1. 依研究尺度完成 tile、settlement、city、road、robber、terrain、number token、harbor 模型與共享材質；模型測試檢查 bounds、正向尺度、非零厚度、無退化 NaN／index。
2. 建立 demand Canvas、固定正交相機、projection bridge、single-light shadow／low quality；所有模型由原拓樸 ID 定位，模型不 import controller／private view。
3. 提供 bounds 及灰模近拍：三種方向道路、聚落／城市對照、盜賊與數字牌不遮擋。加入玩家色與非色彩標記，再提供同 fixture 成品場景。
4. 3D ghost 與短促 placement transform 只讀既有 active group／confirmedPlacement；沒有 active group 就完全靜止。清理 textures／materials／geometries／listeners，支援 StrictMode remount。
5. 交付真實 browser shader／geometry smoke，不能以 mocked Canvas 的 jsdom PASS 代替 GPU。若超出效能目標，先以共享幾何／instancing 減成本，不刪掉必要建模細節。

**C：安全演出、故障與證據**

1. 以 #7 fixtures generator 產生固定 19／30 格來源，不複製一份 rules fixture engine；runner 新增 renderer／quality／事件／fault suites，保留 source hash、fixture hash、locale、實際 effective renderer。
2. 將 `BoardEffects` 改為 stage-local SVG；DOM 實席 anchor 不可用時退為彙總文字；中性偷竊卡背、aggregate 配發上限、aria-hidden／pointer-events none 不變。
3. 補 chunk／texture failure、WebGL unavailable／contextlost／restore、resize／unmount、reduced-motion／background／reconnect 測試；檢查不重送命令、不補播、草稿與選擇仍存在。發現產品問題回相應 owner，C 不越界修改。
4. A／B 可用後執行 acceptance matrix；採集 before／after、近拍、10–15 秒影片、interaction trace、冷載入、frame 與資源趨勢。未取得真機／人工接受時列 BLOCKED／NOT RUN，不能改成 PASS。

S2 以 r3f opt-in 與完整 SVG fallback 交付一個可操作的功能切片；三者輸出必須一起接合才啟用 r3f，不能聲稱單獨模型已完成整案。S1 不依賴 S2 才能使用。

### S3：整合、審查與預設切換（主 agent）

1. 主 agent 接合 A／B／C，跑完整 verify，審查七個維度：唯一 owner、模組邊界、契約、依賴方向、無 cascade、fallback 退場責任與複雜度。
2. 使用驗收文件的 V／I／E／G／P／A／R 案例；技術 gate 與使用者視覺接受分開記錄。美術未接受時只標實驗候選，不默認發佈為完成。
3. 三 agent 在停止寫入後交叉 review：A 審 B 的身份／投影／遮擋；B 審 C 的動效／資源 lifecycle；C 審 A 的手勢／可達性，主 agent 整合 findings 並分派回原 owner 修正。不再建立第 4 個 subagent。
4. 全部必須 gate 通過且使用者接受同 fixture 視覺後，預設 auto：進入棋盤才 lazy load 3D；載入期間 SVG 可操作，ready 後原地切換、不 remount controller；WebGL 失效回 SVG。保留顯式 SVG 和 low quality 選項。
5. 更新 SPEC 的 web 技術選擇與 §8.8、FIDELITY 真實覆蓋、INDEX 與 evidence。移除未用試驗程式、雙重 gesture handler、舊 board-space 特效容器和無用 CSS；不移除全站仍用的 GameArt。
6. 只提交本案檔案、push feature branch、建立／更新正確 base 的 PR。記錄 rollback：顯式選 SVG／回復 renderer default 的 client commit；不回滾資料或 server state。

S3 可獨立合併；若 S3 不通過，S2 仍是可操作 SVG 預設＋opt-in 3D，而不是壞掉的半成品主路徑。

## 6. 可直接交付的 subagent 工作單

派工時三者均使用 `gpt-6.1-sol`；以下是待實施的工作單，不表示本階段已啟動 agent。

### 工作單 A — 投影與輸入

> 閱讀本 plan、research、acceptance、主 agent 凍結的 render-contract。你只擁有檔案表 A 的範圍；你不是唯一在修改 codebase 的人，不可 revert／覆寫他人改動，需配合其他 agent 的契約。完成 I01–I07、A01 的可測行為；沿用原 kind/index／controller／確認與 TargetPicker。使用真正 camera matrix 與 CSS px，手勢單一 owner、pan/pinch/cancel 不選點。不得修改 BoardView、lockfile、模型或 state；接線需求回主 agent。交付變更檔、測試指令／結果、未覆蓋項、所需接線與 review findings；不要自行 commit／push。

### 工作單 B — 立體模型與場景

> 閱讀本 plan、research 的建模尺度及 acceptance。你只擁有檔案表 B 的範圍；你不是唯一在修改 codebase 的人，不可 revert／覆寫他人改動，需配合凍結契約。建立真厚度 hex／房屋／城市／道路／盜賊與低模地貌，不以貼圖平面假冒模型。實作 demand render、真深度遮擋、固定正交相機、projection bridge、共享資源與可清理 lifecycle；模型不得 import controller／private hand，不能自行發命令或建事件 queue。使用主 agent 安裝的 exact dependencies，不改 lockfile。交付 V01–V07／P01–P03 的工程證據、真實 WebGL smoke、模型近拍、bounds、所需接線與未完成項；不要自行 commit／push。

### 工作單 C — 演出回歸與瀏覽器證據

> 閱讀本 plan、acceptance 與 #7 animation lifecycle。你只擁有檔案表 C 的範圍；你不是唯一在修改 codebase 的人，不可 revert／覆寫他人改動，需與 A／B／主 agent 同步。沿用 cursor／MAX_EFFECT_GROUPS／confirmedPlacement／中性 theft／aggregate 配發，將 effects 轉為 stage-local 並量測實際 DOM seat anchor。建立同 fixture 比較、renderer／fault suites、隱私／history／reconnect／減少動態測試及 production captures。只報實跑結果，jsdom 不算 GPU，software renderer 不算手機效能；修正需求回原 owner。交付 E／G／P／A／R 矩陣、SHA／環境／raw data／影片及 BLOCKED 項；不要自行 commit／push。

### 交接順序與同步點

| 點 | 主 agent／A／B／C 的輸入輸出 | 繼續條件 |
| --- | --- | --- |
| H0 | 主 agent 完成 S1、契約與乾淨可建置任務 worktree | 三者回讀基準 SHA、ownership、介面版本 |
| H1（平行） | A 純投影與 overlay；B 模型／camera bridge；C fixture／fault runner 與 effects | 不互改檔案；變更契約先同步 |
| H2（接合） | B 輸出 bounds／matrix；A 驗證 pixel anchor；C 開始真 WebGL suites | 主 agent 接線、web build 與核心選點成功 |
| H3（驗收） | 固定 source 進行整套瀏覽器與效能擷取，停止影響結果的並行編輯 | evidence SHA 與測試 build 一致；失敗保留 raw data |
| H4（審查） | 三者停止寫入後交叉 review，原 owner 修正 | fresh tests／captures 重新對齊最新 SHA |
| H5（發佈） | 主 agent 收斂 findings、人工視覺接受、PR | 不自動 merge，不將尚缺真機標為完成 |

## 7. 驗證指令與時間估計

在任務 worktree 執行現有 gates：

```powershell
pnpm install --frozen-lockfile
pnpm --filter @catan/web typecheck
pnpm --filter @catan/web test
pnpm --filter @catan/web build
pnpm verify
```

新增 browser runner 的 CLI／輸出／故障注入契約見 acceptance；完成 runner 後才執行相應新指令，不能把本文件當成已存在的工具。

估計為工程規劃而非承諾：S1 約 0.5–1 工程日；S2 三人平行約 2–4 日，建模／投影接合是 critical path；S3 約 1–2 日，合計約 4–7 個工作日。原生手機／輔具取得與使用者視覺回饋另計；若造型不接受，先保留 S2，不用技術 PASS 強行切預設。

## 8. 停止、回退與完成邊界

- 需要新增私有資料／wire 欄位、重編拓樸 ID、改 rules／server、替換確認或需要未知模型授權時停止並回主 agent，不隱性擴張範圍。
- 19／30 格身份不等價、手勢誤建、離線仍有 ghost 成功、context loss 清掉草稿、隱私洩漏任一成立，即阻止預設啟用。
- 任一效能門檻不達，先量測定位再優化；不得刪除本次核心體積來宣稱通過。low 可降影、DPR、裝飾密度，但仍須保留地塊／棋子真幾何。
- 三 agent 報告完成不等於最終完成；主 agent 必須核對最新 build、測試與圖像／影片，並標示人工／真機缺口。
- 本案不做資料遷移；所有 rollback 僅是 renderer 選擇或明確 client revert。禁止 reset 使用者工作、重送命令或復原舊 server snapshot。
