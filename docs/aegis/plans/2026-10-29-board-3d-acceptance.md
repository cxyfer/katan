# 真 3D 棋盤驗收標準

日期：2026-10-29。狀態：**待批准驗收契約，所有案例尚未在新 3D 實作上執行。**

> Execution note (2026-10-29): the user approved implementation. Proposal-era observations below remain historical; current progress is in `../work/2026-10-29-board-3d/20-checkpoint.md`. Implementation approval is not visual/device acceptance.

配套：[研究](2026-10-29-board-3d-research.md)、[實施與三 agent 分工](2026-10-29-board-3d-plan.md)。

## 1. 如何判定交付

需要同時滿足「實際建模與可見改善」「玩法與資訊安全不退步」「可用效能與故障恢復」。加了 Three.js、測試全綠、FPS 高，或只有單一漂亮近拍，都不能單獨判定完成。

| Gate | 必要證據 | 可宣稱的結果 |
| --- | --- | --- |
| K1 工程接合 | S1 SVG 無行為退步、exact dependencies／lockfile、完整基準 SHA | 共同邊界可用，不代表 3D 完成 |
| K2 3D 候選 | 19／30 格真模型、完整互動、WebGL 實跑、E／G 不洩漏／不誤送 | 可操作 opt-in 工程候選 |
| K3 美術接受 | 相同 fixture 的 before／after、完整盤與近拍、10–15 秒操作影片；使用者逐項接受 V01–V07 | 視覺方向獲接受，不代替效能／真機 |
| K4 預設啟用 | 本表全部 must-pass、真機／瀏覽器／無障礙要求完成、fresh verify／PR | 可將 auto 3D 設為預設 |

如缺真機或人工視覺回覆，明確列 BLOCKED／NOT RUN，保留 SVG 預設與 opt-in 3D，不宣稱整案驗收完成。不得把舊 #7 的美術／效能紀錄當新 3D 結果。

## 2. 測試矩陣與 fixtures

- 拓樸：`hex-r2`（19／54／72）及 `hex-r56`（30／83／112）；完整盤、邊緣位置、三種道路方向、同點升級城市、所有玩家色、盜賊與港口。
- 視窗（CSS px）：1366×768、768×1024、390×844、360×640、844×390、800×450；兩語 `zh-Hant`／`en`。靜態／核心操作完整交叉；故障／壓力至少在桌機與窄直向兩端各跑兩語。
- DPR：1／2／3；測 browser DPR 與 renderer 實際 capped DPR，不把 cap=1.5 記成「DPR3 原生解析度」。
- 操作：mouse、keyboard-only、原生多點 touch；200% text zoom、reduced-motion、前／背景、旋轉／resize、收合／展開 HUD／手牌。
- renderer：明確 svg／r3f、auto、未知值；quality standard／low。r3f suite 必須讀回 effective renderer=r3f 及 WebGL 2 成功，fallback 靜默成功不得當 3D PASS。
- 狀態：setup、正常回合、道路／聚落／城市選取、preroll、moveRobber／偷竊、production、discard、結果、offline／reconnecting、unknown receipt、suspended／resume。
- 固定資料：重用 #7 `scripts/board-visual/fixtures.mjs` 與 deterministic rules generator，保存 seed、JSON 與 SHA-256；密集盤只在合法／明確標註的渲染 fixture 使用，不能冒充真實對局已達成。
- 私密資料：至少三個席位加未入席 outsider 的授權 payload。只保存去識別測試身份，不將 cookie／token／私牌 trace 推送到 PR。
- 參考裝置：一台 60Hz 桌機及真 Android Chrome／iOS Safari，開始測試時記錄確切型號、OS、CPU／GPU、RAM、瀏覽器版本、電源與 thermal 狀態；本階段沒有取得裝置，不填虛構型號。

## 3. V：必須看得出真正立體（B 產出，主 agent／使用者確認）

| ID | 案例 | 通過標準 |
| --- | --- | --- |
| V01 | 無動畫完整棋盤與外緣近拍 | 固定斜角能同時看到 hex 頂面、閉合側壁、底部與倒角；厚度來自非零 Y geometry，關陰影後仍有側面；不能只位移同一 polygon |
| V02 | 聚落與城市同色並排，正常 fit 與 2× 近拍 | 聚落有牆、雙坡屋頂與端面；城市為多體積／主樓，剪影不同，不是放大聚落。六席色與非色彩標記仍可辨，沒有黑面／反法線 |
| V03 | 三種方向道路及與房屋相接 | 道路是有厚度木條，可見上／側面與端點退讓；不穿屋、不漂浮、不埋入地塊，沒有 z-fighting；不能以陰影線充當模型 |
| V04 | 盜賊在沙漠與生產格 | 有底座、軀幹／披風、頭／兜帽輪廓及光照；不是 R 圓形／billboard；當前位置清楚且不蓋數字與 pips |
| V05 | 兩種拓樸的前後遮擋／地貌 | depth test 正確、遠側棋子不錯蓋近側，地貌確實有體積；數字／pips／港口／玩家色不因遮擋失讀；局部裝飾不得侵占交點與道路走廊 |
| V06 | 桌機及窄直向 fit、手牌／HUD 切換 | 初始即看得到完整模型 bounds／港口，不裁屋頂或地塊底；不能要求先 zoom 才能開始操作。手牌展開時必要目標／提示仍可達，無整頁橫向 overflow |
| V07 | before／after 同 fixture 靜態與影片 | 使用者明確接受「地塊厚度、棋子重量／形體、盜賊、整盤斜視、可讀性」五項；若任一未接受，記錄具體差異並回修，不以工程 review 替代 |

擷取至少：19 格／30 格全盤、聚落城市對照、三方向道路、盜賊與數字牌、密集交點、mobile fit、low 品質。另保留可檢查的 geometry bounds 與無陰影畫面，證明不是視覺作弊。不要更新 canonical 截圖以掩蓋未被接受的變更。

## 4. I：選點、相機與手勢（A）

| ID | 案例 | 通過標準 |
| --- | --- | --- |
| I01 | 全部 vertex／edge／hex，SVG 對照 3D | 對應相同 kind／index／commandType；確認後 command envelope／目標與既有路徑一致，沒有重編 ID；UI advisory 不取代 server reject |
| I02 | camera projection、pan／zoom 0.7–3、DPR、resize | anchor 與預期 mesh 世界位置的螢幕投影差 ≤2 CSS px（非動畫、穩定 layout）；rect offset、letterbox、clip 正確，零尺寸 rect 不產 NaN 或可點的錯位置 |
| I03 | 30px 歧義、44px hit areas、密集道路 | 共用 DOM target 每項 44×44px；相交候選一律 picker，不由 z-index 決定。mouse／touch 不猜多候選；鍵盤或清單明確選擇不再被歧義阻止 |
| I04 | drag／pinch／wheel／pointercancel／capture lost | 不選點、不 submit，不殘留 pointer map／ghost；拖曳 CSS 位移達 6px 或有第二指即 suppress click。pointerup、取消與失焦都清理，下一次真正 tap 正常 |
| I05 | 數字牌、房屋、地貌蓋住 target；無 precision 操作 | 裝飾不吃點擊；TargetPicker 全部候選可達、描述與港口相符，先選後確認／取消行為與 SVG 一致 |
| I06 | fit／旋轉／切 renderer／更換 topology | fit 納入完整模型與實際可用 rect；保留 board-plane center／zoom 的合理對應或顯式 fit，不產空盤；選擇身份／草稿不丟失 |
| I07 | keyboard-only、focus 在目標時新 snapshot 改合法性 | 有焦點樣式、Enter／Space 選擇、Escape／取消可用；失效 target 不提交，焦點回合理控制；同一選擇確認不發兩次命令 |

I02 的獨立驗證以已知 topology world point 與真 camera 矩陣／瀏覽器位置交叉核對，不只讓同一個錯誤 helper 和自己比。edge 不只測 midpoint，也測兩端與方向。

## 5. E：既有演出契約不退步（B／C）

| ID | 案例 | 通過標準 |
| --- | --- | --- |
| E01 | 初載、join、restore、reconnect、重複／舊 seq／不同 game | 顯示最新盤面與骰子，不補播舊事件；沿用單一 cursor／sync generation，renderer 切換不能 reset 成可重播歷史 |
| E02 | 正確與不相符的建造事件 | 只有 player／target／kind 符合最新盤面的 confirmedPlacement 能播放；最新盤面即時呈現，動畫不是延後 authoritative update；聚落／城市約 290ms、道路約 240ms |
| E03 | 合法 preview、取消、目標過期、離線 | 3D ghost 只代表選擇，半透明且 depthWrite=false、不攔輸入；取消／失效立刻移除，不保留成功效果，不假裝建成 |
| E04 | 新擲骰、production、銀行缺貨／強盜格 | 骰子只取新的權威值、≤800ms；只提示符合點數且未被強盜佔據的格；配發顯示實際 aggregate，不把它捏造成某個格支出；最多 24 飛行 icon，數值不丟 |
| E05 | 偷竊者／受害者／第三席與 outsider | 所有可見偷竊動畫用相同中性卡背，不以色／材質／DOM attribute／物件名／trace 洩漏種類；outsider 不取得未授權事件或遊戲投影 |
| E06 | pending／setup／preroll、離線、背景、減少動態 | 依 #7 mandatory 條件立即清 queue／停 render，自最新 snapshot 顯示穩態；最多 8 組、每組≤800ms；返回不補播 |
| E07 | HUD 收合／六席／resize／離屏 anchor | 飛行終點與實際可見 seat DOM 中心差≤8 CSS px；無 anchor／離屏時不飛、保留文字彙總，不用棋盤內虛構位置；overlay aria-hidden 且 pointer-events none |

## 6. G：GPU 故障與資源生命週期（B／C／主 agent）

| ID | 注入方式 | 通過標準 |
| --- | --- | --- |
| G01 | WebGL 2 不可用、初始化 throw、shader error | 可觀測 reason、SVG 可繼續操作、無白屏／error loop；不能只顯示「不支援」並讓對局無法進行 |
| G02 | 阻擋 3D chunk／atlas、模擬延遲、未知 query | Loading 時 SVG 可操作；失敗留 SVG、可顯式重試，未知 renderer 回 auto；明確 svg 不發 GPU chunk／atlas 請求 |
| G03 | `WEBGL_lose_context`（可用時）／restore | lost 時取消演出並回 SVG，selection／手牌草稿／pending receipt 保留，不重送命令；restore 不自動切回 GPU。extension 缺失另標限制，不以 dispatch event 冒充真 loss |
| G04 | StrictMode remount、進出棋盤 20 次、resize 10 次 | 無額外 context／Canvas／listener／timer 殘留或 uncaught errors；heap／renderer.info 列趨勢與快取理由，不只看一次 heap |
| G05 | scene 失敗同時 server snapshot／receipt 到達 | controller 持續同步，fallback 按最新 projection 顯示，已完成命令不重送／不消失，unknown receipt 恢復路徑可用 |
| G06 | manual renderer switch、同時 pan／animation、auto ready | 只替換 view、不 remount controller；使用唯一 hook 的 resetPresentation 清 queue／rebase，不改 gameSync／server；保留確認／取消與 focus。auto ready 等手勢結束才切換，不能在同次 pointerdown/up 之間更換投影 |

Canvas fallback、React ErrorBoundary 和原生 contextlost listener 各自測試，不假設任一能涵蓋全部故障。

## 7. P：效能、載入與量測方法

下列為**提議門檻，不是實測結果**。沿用 #7 active frame／idle／資源紀律；不以「WebGL」或平均 FPS 證明較快。

| ID | 測法 | 通過標準 |
| --- | --- | --- |
| P01 | production build、同 seed／fixture，暖機後 standard 桌機／low 參考手機各 3×30s，包含 pan／zoom／build／production | 60Hz 桌機 active frame interval p95≤20ms；手機≤33.3ms；保留 raw intervals、max／long tasks／trace，與 SVG 並列，不只報 FPS |
| P02 | 無演出／相機穩定後 idle、背景、reduce 各 30s | board 自身不連續 RAF／render／invalidate；非 board heartbeat／CSS 環境動效獨立列。reduce 的 snapshot／輸入仍可觸發必要單幀，不能以禁止一切 render 造成 stale 畫面 |
| P03 | 30 格六席密集盤，renderer.info／lifecycle | standard 整幀總 draw calls（含 shadow pass）目標≤250、submitted triangles≤150k；low≤150／100k。共享 geometry／material、無逐幀配置、20 次 lifecycle 無單調無界增長；超標必須記錄定位與重新審核，不靜默改門檻 |
| P04 | cold cache 各 3 次，記 browser／network profile／bytes | SVG／入口首頁不預載 GPU runtime；記 JS／CSS／atlas transfer 與 gzip／br、parse／compile、首次可操作與 3D ready。auto 在 3D ready 前已有可操作 SVG；不可因等待 3D 阻斷遊戲；新增 bytes／時間交使用者接受，不虛構已量測大小 |
| P05 | 本地選擇＋既有 U-06 workload | visible local selection p95≤100ms；沿用六 clients、150ms RTT、≥100 eligible commands 的 acknowledgement p95≤1s 目標與 2s waiting cue。renderer 不增加 command 往返；不足 samples 標 NOT RUN，不以單機 mock 代替 |

frame interval 是排程／呈現代理，非 GPU render time；不得混用 browser rAF 與 renderer.info 數字。使用 SwiftShader／headless 時標出，只能作功能 smoke；不能推論真 Android／iOS FPS。GPU VRAM 無可靠量測時寫無法取得，以 renderer.info／heap 趨勢輔助，不捏造 MB。

若模型品質與 P01 衝突，優先共享／合批、DPR／shadow 降級、限制裝飾；不可把房屋／道路改回平面卻仍稱模型驗收通過。standard 的最終啟用需其自身過門檻，low 不能替它背書。

## 8. A／R：可達性、隱私與回歸

| ID | 範圍 | 通過標準 |
| --- | --- | --- |
| A01 | DOM 語意與輔具 | Canvas 視覺裝飾不形成重複焦點；保留棋盤 region label、文字盤面參照、全部合法目標真 button、required prompt／live status；自動掃描加 keyboard／screen reader walkthrough |
| A02 | 非色彩、文字與減少動態 | 玩家棋子／道路不只靠顏色，6／8 有數值與 pips；200% text zoom、兩語長名、high contrast／灰階可判；reduce 不禁用靜態 3D 或丟掉結果 |
| A03 | 資料邊界 | scene input 不含私牌、deck、hidden score；三席＋outsider 的 payload／DOM／scene metadata 不新增洩漏；GPU debug／trace 不記真認證資料 |
| R01 | 功能回歸 | `pnpm verify` 通過；保留原 tests 的命令／receipt／visibility assertions。SVG 專屬 DOM assertion 只對 SVG；共同行為在兩 renderer 跑，jsdom 不宣稱測 GPU |
| R02 | 真實三席／六席服務流程 | 建房／就緒／setup→roll→build→trade→end turn；robber／discard、save／resume、斷線重連／unknown receipt、結果皆可用；無需修改 rules／wire |
| R03 | 裝置與多瀏覽器 | Chromium／Firefox／WebKit 記版本；真 iOS Safari＋Android Chrome 記旋轉、多指、背景、soft keyboard、密集盤；模擬補充而非取代實機 |
| R04 | 視覺擷取重現 | 檔名含 fixture／renderer／quality／viewport／locale，report SHA 與 build 一致；保留 before、不偽造美術 PASS，不將 mock 場景標成真對局 |

## 9. 指令與 runner 交付契約

### 已存在、可於實施後重跑的 gates

```powershell
pnpm install --frozen-lockfile
pnpm --filter @catan/web typecheck
pnpm --filter @catan/web test
pnpm --filter @catan/web build
pnpm verify
```

### C 必須建立的新工具（目前不存在，以下不是已執行紀錄）

沿用既有 Python Playwright runner 的環境記錄／臨時服務／清理方法，建立 `scripts/board-3d/verify.py`；`scripts/board-3d/fixtures.mjs` 為重用既有 generator 的入口，不複製規則。Python／Playwright 只供測試，並非新增產品 runtime；安裝於任務 worktree 的 `.tmp/board-3d-venv`，browsers 也放該處，不安裝全域套件。

新 runner 必須接受：`--fixture`、`--out`、`--renderer svg|r3f|auto`、`--quality standard|low`、`--suite visual|interaction|events|faults|performance|real-flow|all`、`--browser chromium|firefox|webkit`、可選 `--base-url`。無 base URL 時以本 worktree production artifacts 與臨時 DB 啟動自己的服務，結束清理；有 URL 時先核對實際 served build SHA，不能誤測舊程序。

```powershell
# 實施 runner 後執行；每個 worktree 使用自己的 build／測試環境。
node scripts/board-3d/fixtures.mjs --out .tmp/board-3d-fixtures.json
.tmp/board-3d-venv/Scripts/python.exe scripts/board-3d/verify.py --fixture .tmp/board-3d-fixtures.json --out docs/aegis/work/2026-10-29-board-3d/svg --renderer svg --quality standard --suite all --browser chromium
.tmp/board-3d-venv/Scripts/python.exe scripts/board-3d/verify.py --fixture .tmp/board-3d-fixtures.json --out docs/aegis/work/2026-10-29-board-3d/r3f --renderer r3f --quality standard --suite all --browser chromium
.tmp/board-3d-venv/Scripts/python.exe scripts/board-3d/verify.py --fixture .tmp/board-3d-fixtures.json --out docs/aegis/work/2026-10-29-board-3d/low --renderer r3f --quality low --suite all --browser chromium
```

其他 browser／renderer auto 使用相同 CLI 改值並輸出獨立目錄；真機／screen reader／人工視覺另存手動紀錄。runner return code：0=選定 automated suite 全部必要項 PASS；1=FAIL；2=BLOCKED。需人工／硬體的案例不能因 automated suite exit 0 被改成 PASS。

## 10. 證據與最終交付格式

每案記 `PASS / FAIL / BLOCKED / NOT RUN`、case ID、source／build SHA、fixture hash、requested／effective renderer、quality／DPR、環境、步驟、expected／actual、artifact path。無證據不列 PASS；輸出 aggregate status 與未跑必要項，不能只看 process exit code。

交付目錄 `docs/aegis/work/2026-10-29-board-3d/` 至少包含 report、環境、原始效能 JSON、完整盤／模型近拍、前後比較、10–15 秒影片、必要 trace、人工接受紀錄、review findings／修復／retest。大影片或 trace 若不適合入 Git，以 PR artifact 連結及 hash 保留，不直接堆進產品 bundle；公開前檢查身份／cookie／私牌資訊。

最終報告分開回答：哪些模型完成、哪些行為已實跑、哪些裝置／輔具未驗收、使用者是否接受造型、是否已切預設、branch 是否 push、PR 是否真正建立。任何一項未完成都如實列出，不用「3D 已完成」概括掩蓋。
