# 棋盤與棋子 3D 化：研究與技術建議

日期：2026-10-29。狀態：**研究完成、方案待批准，尚未實作或通過視覺驗收。**

> Execution note (2026-10-29): the user approved implementation. Proposal-era observations below remain historical; current progress is in `../work/2026-10-29-board-3d/20-checkpoint.md`. Implementation approval is not visual/device acceptance.

配套文件：[實施與三 agent 交接計畫](2026-10-29-board-3d-plan.md)、[驗收標準](2026-10-29-board-3d-acceptance.md)。

## 1. 結論

建議使用 **Three.js + React Three Fiber（R3F），以真正的 3D mesh、深度測試與光照，搭配固定斜視正交相機**。產品呈現為 2.5D 桌遊視角，底層是真 3D，而非把 SVG 整盤壓扁或再次位移複製六角形。

首輪包含六角柱地塊、低多邊形地貌、聚落、城市、道路、盜賊、實體數字牌與港口標記；保留既有海洋／暖金／羊皮紙風格、DOM HUD、選取確認和權威事件。固定相機、有限 pan／zoom 是可玩性取捨，不是模型能力限制。自由旋轉、透視鏡頭、物理、後製與粒子不在本輪。

這是使用者新增「建模、明顯斜角體積、遮擋」需求後的**建議決策**，不是以過往測試證明 GPU 較快，也不代表使用者已接受新美術。

## 2. 本次查證的基準

| 項目 | 已查證狀態與影響 |
| --- | --- |
| 主要 checkout | `D:/Workspace/Projects/katan`，`master`，本機 HEAD `4e4b9841c84772f62ac71c2a69cf631224dd989f`，開始研究時工作樹乾淨 |
| 既有候選 worktree | `.worktrees/board-visual-spike`，`feat/board-visual-spike`，本機 HEAD `b44e517b8fa73a6df05b47bd555e4ecc1d80a03b`，唯讀檢查時乾淨 |
| Remote／base | `origin` 指向 `https://github.com/cxyfer/katan`，本機 `origin/HEAD` 指向 `origin/master`；本次未 fetch，不宣稱這是最新遠端狀態 |
| #7 | `gh pr view 7 --repo cxyfer/katan ...` 回 HTTP 401；無法確認目前 PR 開關、遠端 head 或 merge 狀態。本文以使用者描述和本地候選源碼為依據，不假定 #7 已合併 |
| 前端 | `packages/web/package.json` 與 lockfile：React／React DOM 19.3.1，TypeScript、Vite；沒有 Three.js、R3F 或 GPU renderer |
| 棋盤拓樸 | 直接執行 `packages/rules/src/topology.ts` 的 generator：`hex-r2` = 19 格／54 點／72 邊；`hex-r56` = 30 格／83 點／112 邊 |
| 實際視覺檢查 | 已檢視候選 `docs/aegis/work/2026-10-28-board-visual-spike/after-city-zh-Hant-desktop.png`：地塊頂面仍正對畫面，棋子微小、道路像線段，盜賊仍為 R 圓標；薄邊不等於斜視立體盤 |
| 本階段範圍 | 僅新增研究／計畫／驗收文件及文件索引；不改產品、依賴、既有候選 worktree，不 commit／push／建 PR |

### 讀過的權威與歷史文件

- `README.md`、`docs/SPEC.md` §8.1–8.8、`docs/FIDELITY.md`。
- `docs/aegis/BASELINE-GOVERNANCE.md`、`docs/aegis/plans/2026-10-27-island-ui.md`。
- 候選 worktree 的 `2026-10-28-board-visual-spike.md`、配套 acceptance 文件及 `work/2026-10-28-board-visual-spike/d1-decision.md`。

目前 SPEC 的 SVG 技術選擇與新建模方向有差異；實施獲批後應更新相關技術／視覺章節，而不是在本次研究中宣稱產品基準已變更。舊 D1 明訂「使用者要求真正斜角厚度、遮擋、光照」可重啟 R3F 評估；本次要求正好符合此條件，並非無證據推翻原決策。

## 3. 目前架構能保留什麼

| 現有 owner | 現況與遷移約束 |
| --- | --- |
| `board/geometry.ts`、rules topology | 既有 ID、hex／edge／vertex 對應是唯一身份；3D 僅換座標呈現，不重編索引或自行重算鄰接 |
| `components/BoardView.tsx` | 集中持有 pan／zoom、目標選擇、picker、骰子；目前 SVG renderer 與控制混合，需拆出薄的視覺層，保留唯一 controller |
| `board/intent.ts`、`board/targets.ts` | 沿用 hints／既有 advisory target 語意及文字描述；renderer 不能把候選當權威合法性，也不能新增 client rules |
| `TargetPicker.tsx`、`SelectionPreview.tsx` | 保留非精準選點、雙語描述、先選再確認；Canvas 不是唯一操作入口 |
| #7 的 `board/animation.ts`、`useBoardAnimation.ts` | 已有 cursor、sync generation、最多 8 組／每組 800ms、取消與不補播歷史；必須重用，不另建 Three 事件歷史 |
| #7 的 `board/effects.ts`、`BoardEffects.tsx` | aggregate 配發、中性偷竊、confirmed placement 可沿用；SVG effects 的座標不可直接拿來覆蓋斜視 Canvas |
| #7 的 `board/viewport.ts` | 現有函式是 SVG viewBox 的仿射轉換；不是 3D 投影。3D target 必須由實際 camera matrix 投影至 CSS px |
| `GameArt.tsx` | 頁首、卡片、資源 icon、首頁插畫繼續使用；不為棋盤升級而重寫全站美術 |
| `state/table.ts`、`state/useTable.ts` | 保留命令與同步 owner；只承接已授權 projection，不新增遊戲狀態或更改後端／wire contract |

候選的 `BoardEffects` 席位座標是 SVG 棋盤內的估計位置，不是讀取 HUD 實際位置。新效果若聲稱「飛向玩家席位」，必須以實際 DOM rect 作 anchor；席位收合／離屏／量測失敗時改為無飛行的彙總文字，不假裝命中席位。

## 4. 路線比較

| 方案 | 能否達到本次需求 | 成本與決策 |
| --- | --- | --- |
| SVG 真側面 + 自訂斜投影 | 可以有厚度，但遮擋排序、房屋多面體、投影與光照需自行維護 | 最小無 GPU 選項；只適合接受固定手繪假 3D 的情境，本輪不選 |
| CSS perspective + 原 SVG | 整盤可傾斜，但棋子與地貌仍是紙片，文字與點擊還會變形 | 不符合「建模」，拒絕當成本輪完成品 |
| Canvas／Pixi sprites | 適合大量 2D 圖層、粒子與貼圖，不自然提供本輪的立體幾何和深度 | 本次不建立第二 GPU 候選；不以 2D 特效替代建模 |
| 原生 Three.js | 完整 3D，可達標 | 可行替代；需手寫 React 與 scene 的差量同步、釋放與 lifecycle，比本專案需要的命令式控制更重 |
| **Three.js + R3F** | 真 3D mesh、相機、材質、光照、遮擋；仍可保留 DOM 操作 | **推薦**：沿用 React 組件／props 架構、按需繪製，減少手動同步 owner |
| Babylon.js／完整遊戲引擎 | 有能力，但本輪不需場景編輯器、物理或完整引擎系統 | 不增加另一套應用架構；未對其效能做基準，不能宣稱較差 |

### 已查證依賴與採用原則

2026-10-29 npm registry 唯讀查詢結果：

| 套件 | 查得穩定版本 | 說明 |
| --- | --- | --- |
| `three` | `0.186.1` | 使用 WebGLRenderer；目前只支援 WebGL 2，不把 WebGL 1 當 fallback |
| `@react-three/fiber` | `9.8.2` | peers：React／React DOM `>=19 <19.4`、Three `>=0.156`；現有 lockfile 19.3.1 相符 |
| `@types/three` | `0.186.0` | 放 devDependencies，與 Three r186 對齊 |

官方文件將 R3F 10 標示為 alpha；不用 alpha／WebGPU 作本輪基線。實施開始時重查 peer range、採 `--save-exact` 並提交 lockfile，不順便升級 React。現有 React 的 `^19.3.1` 日後可能解析到不符合 peer 的 19.4，故驗證以 frozen lockfile 為準，更新依賴時再檢查。這是 manifest 相容，不是已成功 install／build 的證明。

不預設新增 Drei、動畫框架、物理引擎、postprocessing 或模型 loader。此方案不需 API key、外部帳號、美術 CDN、Blender 或雲端服務。程序化模型與本地 SVG 貼圖足夠交付首輪；將來若採 Blender／glTF，另立可編輯來源、匯出與授權契約，不能只丟無來源二進位模型。

## 5. 建模與美術規格

### 統一尺度與構圖

- 六角外接圓半徑 `R = 1`。拓樸 `(x, y)` 對應世界 `(X=x, Y=高度, Z=y)`，不乘 SVG 的 100 倍 scale。+Y 向上。
- 地塊頂面 `Y=0`、底面 `Y=-0.18R`；實際六邊形閉合側壁、頂／側不同材質、`0.02R` 小倒角，輪廓不得超出原本拓樸邊界。接縫視覺間距約 `0.015R`，道路與建築仍落在原本共邊／共點，不能形成浮空裂谷。
- 桌機相機 elevation 50 度、azimuth 20 度；窄直向 elevation 60 度、azimuth 20 度。只有 viewport breakpoint 改變時調整，不在遊戲中自動繞行。正交縮放沿用 0.7–3 的操作範圍。
- 顯示 100% 代表當前視窗的 fit-relative zoom，不代表固定世界像素。Fit 以實際 camera 投影後的模型完整 bounds（含屋頂、港口、地塊底）與可用棋盤 rect 計算，不能直接沿用 SVG width／height。
- 模型採木製桌遊微縮景觀，暖光、霧面、可見切面；保留海洋深藍與暖金 UI，不全面改卡牌或頁面。

### 各物件

| 物件 | 建模方式與首輪細節 | 約束 |
| --- | --- | --- |
| 六角地塊 | 六角 Shape 的實體 extrusion，頂面與側壁分 material，細倒角；共享 geometry | 外緣可清楚看見側壁；相鄰地塊不靠手寫 painter order 遮擋 |
| 地貌 | 森林 = 少量低模樹；山地 = 切面山峰；丘陵 = 土丘／岩塊；麥田 = 分組田壟；牧場 = 草坡與低模羊；沙漠 = 低沙丘 | 裝飾限制在 hex 中央半徑 `0.55R`，一般高度不超過 `0.35R`；數字牌、道路與交點留空；由 terrain／hex index 決定固定變體，不引入遊戲 RNG |
| 聚落 | `0.22R × 0.18R` 左右底座，牆高 `0.16R`、屋脊總高約 `0.28R`；獨立雙坡屋頂、門窗淺幾何或本地紋理 | 側牆、端牆與屋頂都是真面；玩家色不能只出現在一個微小面 |
| 城市 | 兩個錯落體積與較高主樓／塔，約 `0.38R × 0.28R`，總高 `0.42R` | 不是把聚落放大；縮到正常 fit 仍能以剪影辨識兩者 |
| 道路 | 沿拓樸邊方向的有厚度木條，寬 `0.075R`、高 `0.06R`；端點各退 `0.10R`，避開建築；上緣倒角 | 不是 `Line`；可見上／側面，接地不浮空，三種方向皆無鏡像錯位 |
| 盜賊 | LatheGeometry 的底座與披風軀幹，加低模頭／兜帽；總高約 `0.48R`、最大半徑 `0.12R` | 中性深色但保留明暗輪廓；移至 hex 內固定偏移，不能蓋住數字牌；不顯示被偷資源 |
| 數字牌 | 小厚圓牌，頂面本地 SVG atlas 的數字／pips；6／8 同時保留非色彩資訊 | 不用遠端字體、SDF 文字依賴或逐幀貼圖生成；牌面不被地貌與盜賊遮住 |
| 港口 | 低模碼頭／小標牌與本地 2:1／3:1／資源符號貼圖 | 保留原 harbor.edge；保持清楚的邊對應，不因模型移位改規則 |
| 玩家辨識 | 保留既有色碼，同時以座位徽記／條紋幾何或本地圖樣區分道路、建築 | 燈光不能把白／橙、藍／綠混成同色；灰階仍能對照席位 |

先用程序化幾何：尺寸可測、無外部授權風險、便於 agent 平行工作，也能直接證明屋頂／道路確實有體積。代價是需要專門一輪美術調校；「全部是 BoxGeometry」不是美術驗收完成。

## 6. 渲染、互動與效能策略

1. 一個可見 WebGL Canvas；R3F `frameloop="demand"`。靜態場景不持續 render；只有指標移動導致 pan／zoom、projection 更新或有期限演出時 invalidate。
2. 一個 HemisphereLight 加一個暖色 DirectionalLight；標準模式一張 1024 shadow map，棋子／地貌投影，地塊／底板接影。low 模式關 shadow map、DPR 上限 1、保留真 mesh 與靜態接地陰影；standard DPR 上限 1.5。不用 SSAO、bloom、景深、反射海面或透明玻璃。
3. 重複地貌／木條按 geometry／material 合併或 instancing；單獨保留少量正在播放演出的棋子。先用 renderer.info 查瓶頸，不為 30 格建立自訂 ECS／worker／GPU picking。
4. **DOM overlay 為唯一 pointer／keyboard 選點入口**。用實際相機投影 hex／vertex／edge anchor；候選透過現有描述與確認送進 controller。裝飾 mesh 不接受 click、不攔截合法位置，也不會發命令。
5. 不直接使用 R3F mesh 事件做遊戲手勢。官方說明其事件會向後方交點傳遞，pointer capture 亦不等同 DOM 多指 capture；改由單一 DOM surface 接管 pointer map、pan／pinch／cancel，避免道路、地塊和 ghost 同時觸發。
6. 點擊先用 CSS px 候選半徑 22px 搜尋同 kind 的候選；原 30px ambiguity 檢查再擴充至所有 hit-area 相交的候選。多候選開 TargetPicker，不能靠 DOM z-index、最近 mesh 或螢幕左右順序猜測。列表按拓樸 ID 排序，視角改變不能改 ID。
7. 螢幕錨點只在 camera／rect／topology／viewport 改變時更新，不把逐幀動畫位置回寫 React state。舞台外的 HUD／手牌仍是原 DOM，不塞進 WebGL。
8. #7 配發／偷竊改為 stage-local、pointer-events none 的 SVG overlay；從 DOM 實際座位 rect 取得 anchor，公開牌面只用已投影彙總。骰子沿用 DOM。建築／道路效果改動 3D transform，但時機只有既有 active group 能決定。

官方 R3F 文件提供按需 render、invalidate、geometry reuse／instancing 與 Canvas fallback；Three.js 官方提供 orthographic、ExtrudeGeometry、LatheGeometry。此計畫採用這些現成機制，不自製 renderer 或 scene graph。未以競品畫面或第三方套件的宣傳聲稱本專案效能已成立。

## 7. 故障、回滾與最脆弱的假設

最脆弱假設：**既有密集盤在斜視後，手機仍有足夠畫面同時辨識棋子、數字與合法位置。** 正交相機只能避免遠小近大，無法消除遮擋或改善過小點擊區。以較高手機視角、地貌限高、可用 rect fit、非精準清單與真機 gate 保護；若仍失敗，先改構圖／模型尺寸，不以「使用者可 zoom」掩蓋預設不可用。

- `?renderer=svg`／`?renderer=r3f` 是實施後才有的產品開關；目前只有舊 runner 的參數標籤，**不是現有產品功能**。開發期預設 SVG；完整 gate 與人工接受後才改為 auto 選 3D。
- 無 WebGL 2、chunk／texture 載入失敗、初始化例外、`webglcontextlost`：在同一 BoardView 回 SVG，保留 controller／草稿／selection／pending receipt，丟棄演出。不要只依賴 ErrorBoundary 捕捉 context loss。
- 切回 SVG 時由相同 board-plane center／fit-relative zoom 轉接視窗；必須保證目標可見，不能要求兩種投影像素相等。保留「符合棋盤」按鈕。
- 不因 context restored 自動切回 3D；顯式重試才重新載入。卸載清除 shared scene resources、Texture／Geometry／Material、observer、listeners、timer，不能對仍在用的共享資源提早 dispose。
- 共用動畫 hook 由原 owner 增加顯式 resetPresentation 介面，切 renderer／失效時清 queue 並 baseline 最新 snapshot；不以 remount hook、偽造連線狀態或另建 queue 迴避歷史重播問題。自動 ready 切換等待當前手勢結束。
- 最後保留 SVG 是明確的無 GPU 相容路徑，不是第二份互動／規則／動畫系統；不建立通用 renderer plugin registry。若要移除，需另案證明有等效無 GPU 操作與復原能力。
- GPU／3D 不通過時可以交付實驗分支與失敗證據，但不能稱使用者要求已滿足。回退只換 client view，不回滾 server game、不重送命令。

## 8. 來源與證據邊界

以下於 2026-10-29 查閱；版本是當次快照，不是永遠最新。

- [R3F Introduction](https://r3f.docs.pmnd.rs/getting-started/introduction)：React major 配對、v10 alpha。
- [R3F Scaling performance](https://r3f.docs.pmnd.rs/advanced/scaling-performance)：按需繪製、invalidate、重用與 instancing。
- [R3F Canvas](https://r3f.docs.pmnd.rs/api/canvas)：orthographic、frameloop、fallback；API 細節以實施鎖定的 v9 為準。
- [R3F Events](https://r3f.docs.pmnd.rs/api/events)：3D propagation、capture 與多指限制。
- [Three.js OrthographicCamera](https://threejs.org/docs/pages/OrthographicCamera.html)：物件尺寸不隨距離改變。
- [Three.js ExtrudeGeometry](https://threejs.org/docs/pages/ExtrudeGeometry.html)：實體 extrusion／bevel。
- [Three.js LatheGeometry](https://threejs.org/docs/pages/LatheGeometry.html)：軸對稱幾何。
- [Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)：WebGL 2、renderer.info、shadow map。
- [Three.js cleanup 官方原始範例](https://github.com/mrdoob/three.js/blob/dev/manual/examples/cleanup-simple.html)：資源生命週期及 dispose 範例，經 Context7 讀取。
- npm manifests：[three](https://registry.npmjs.org/three/latest)、[R3F](https://registry.npmjs.org/@react-three%2Ffiber/latest)、[types](https://registry.npmjs.org/@types%2Fthree/latest)。以執行時 registry 回應核對，不僅依賴官網範例。

本次沒有安裝上述套件、建立 3D 原型、執行 GPU／效能／真機測試或更新 canonical 截圖。文中尺寸、品質設定與門檻是**待批准的設計／驗收值**，不是量測結果。舊 #7 的 SVG evidence 只能證明舊版本，不能轉用為本案 PASS。
