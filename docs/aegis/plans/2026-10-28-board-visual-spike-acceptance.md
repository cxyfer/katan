# 棋盤視覺與遊戲感強化驗收方案

## 目的與狀態

對應[實施計畫](2026-10-28-board-visual-spike.md)，將「看起來更有遊戲感」拆為視覺、互動、狀態一致性、無障礙、隱私、效能與 renderer 故障恢復。

建立日期：2026-10-28。所有案例目前為 **NOT RUN**；本文件不聲稱功能、測試、效能或實機驗收已通過。

產品約束以 [SPEC §8](../../SPEC.md#8-uiux-and-accessibility-requirements) 為準，尤其 U-06 已定義的回饋／確認延遲不得被新動畫預算取代。既有截圖依 [screenshots README](../../screenshots/README.md) 仍屬 captured states，不是已接受的視覺基準。

## 驗收里程碑

| 里程碑 | 通過條件 | 可宣稱的結果 |
| --- | --- | --- |
| M0 控制組 | P0 runner、來源 hash、fixtures、before 截圖／trace 可重跑 | 已建立比較方法；沒有新視覺驗收結論 |
| M1 SVG 視覺切片 | E／I／V／A 的自動化項目、P01–P04 通過；使用者檢視差異 | SVG 候選效果成立；人工項未完成時只稱工程候選 |
| M2 GPU 對照（若啟動） | 同一 fixture 的 V／P 比較、G01–G06、完整選取與載入成本 | 有證據採用或淘汰單一 GPU 候選 |
| M3 整合候選 | pnpm verify、production browser、隱私、多席流程無阻塞 | 可送 PR；未完成實機／輔具須逐項披露 |
| M4 完整驗收 | M3 加實機 iOS／Android、輔具、U-06 量測與視覺接受 | 可宣稱本次視覺功能完整驗收；不等於整個產品已達 WCAG 或全部 U-01–U-08 |

PASS、FAIL、NOT RUN、BLOCKED 四種狀態必須分開。模擬 touch 不可填入實機 PASS；錄到畫面不可填入互動 PASS；HTTP 成功不可填入遊戲流程 PASS。

## 測試矩陣與資料

- 棋盤：hex-r2（19 格、3／4 席）及 hex-r56（30 格、5／6 席）；完整港口、道路、聚落／城市、強盜與高密度合法位置。
- 語系：zh-Hant、en；長暱稱、同名、長提示、語言切換中保留草稿與選取。
- CSS viewport：1366×768、800×450、844×390、768×1024、390×844、360×640。
- 靜態主矩陣：2 棋盤 × 2 語系 × 6 尺寸 = 24 組／renderer；事件序列至少在桌面、手機直向、手機橫向各跑一次。
- DPR：主矩陣 1；另測桌面 DPR 2、手機 DPR 3，記錄有效 renderer resolution 上限，不能只測 CSS 大小。
- motion：normal、頁面啟動前 reduce、演出中切換 reduce。
- 輸入：mouse、keyboard-only、emulated touch；實機 iOS Safari、Android Chrome 另外記錄。
- 瀏覽器：Chromium 全矩陣；Firefox／WebKit 在桌面、390×844 及事件／故障核心流程抽測，記錄實際版本。
- 網路／狀態：正常連線、150ms RTT、2s 以上待確認、離線／重連、背景／恢復、save／resume、換局。
- 共同 fixture：同 seed、事件、棋子、鏡頭與粒子數。固定種子僅控制裝飾隨機，不能替代伺服器骰子或偷竊結果。

## E — 事件與動畫狀態

| ID | 操作 | 通過條件 |
| --- | --- | --- |
| E01 | 首次載入含多筆歷史事件的 snapshot | 顯示當前盤面／最後骰子與文字，不重播過去建造、生產或骰子 |
| E02 | 在線收到較新 snapshot，內含新 turn.rolled／production.resolved | 新事件各處理一次；不能因資料是 snapshot 就全部略過 |
| E03 | 重送相同 snapshot、重排事件、同 revision 重繪 | 不重播；gameId + seq 去重；翻譯切換不重建動畫 |
| E04 | 收到舊 revision／seq 或延遲 HTTP 回應 | 不由動畫層回退狀態或產生錯誤成功提示；與既有資料 owner 保持一致 |
| E05 | 離線後重連，最近事件窗不足、事件空白或 view.seq 大幅前進 | 以新同步 baseline 重畫，丟棄舊 queue，不補播最近 40 筆或私有事件 |
| E06 | 當前局結束並進入 seq 較小的新 gameId | cursor 重設；新局事件可播放且不帶前局棋子／資源 |
| E07 | 快速連續操作、超過 8 群待播或出現 mandatory action | queue 有界；提示立即可操作；中斷後仍與最新投影一致 |
| E08 | 演出中切語言、resize、開關工具／手牌 | 不重送 command、不重播事件；目標變動時投影更新或取消飛行圖示 |
| E09 | 演出中 unmount／remount、StrictMode、切到背景再回來 | timers／RAF／listeners 清理；返回不補播歷史，不重複初始化 loop |
| E10 | 拒絕、未知結果、receipt 重查與取消 preview | 只有確認的權威事件有成功演出；2s 未知結果顯示等待／恢復，無假成功 |

方法：`board-animation.test.ts` 驗證 cursor／event selection；`board-visual.test.tsx`、resilience 測試驗證接線；browser runner 以正常 snapshot 廣播重現。不得只測自造增量事件而避開實際 transport。

## I — 投影、目標與互動

| ID | 操作 | 通過條件 |
| --- | --- | --- |
| I01 | 同一點在 fit、zoom 0.7／1／3、pan、留白與不同 DPR 下 world→screen→world | 往返誤差 ≤1 CSS px；送出的 index 與 rules topology 相同 |
| I02 | 以滑鼠／touch 拖曳、pinch、pointer cancel／離開棋盤 | 沒有 select／confirm／submit 誤觸；鬆手後正常點擊可用 |
| I03 | 點選螢幕距離 <30 CSS px 的合法目標群組 | 顯示具文字位置的 TargetPicker；清單按鈕一次選定，不重新開相同歧義群組 |
| I04 | 鍵盤選取、取消、重新選擇、確認 | preview 與 command 跟既有流程一致；取消零成本，焦點可返回 |
| I05 | resize、旋轉、text zoom 200%、切工具／手牌、fit board | 視角保留或依明確 fit 操作重設；合法目標、港口與提示不錯位 |
| I06 | 同一 fixture 在 SVG 與 GPU 候選選取同目標 | kind／index／commandType 相同；renderer 不自行驗規則或直接提交 |
| I07 | overlay 播放時操作聊天、交易、required prompt、棋盤 | 特效不攔 pointer、keyboard 或焦點；提示／恢復控制可點且可讀 |

方法：`board-viewport.test.ts` 加矩陣測試；browser runner 真實輸入與命令攔截；實機補 pinch／旋轉。jsdom 不作投影幾何與 GPU 正確性證明。

## V — 視覺與資訊傳達

| ID | 場景 | 通過條件 |
| --- | --- | --- |
| V01 | 24 組主矩陣的靜態前後對照 | 地形、號碼、pips、玩家區別、道路、港口清楚；棋盤沒有被厚度／陰影裁切 |
| V02 | preview、建築落地、道路展開的起／中／終幀 | 落點正確、權威結果立即可辨；取消／拒絕無成功殘影，無全局相機晃動 |
| V03 | 骰子 → 生產 → 收納 | 一次演出；數字／資源結果有持久文字；中央效果不遮 mandatory action |
| V04 | 生產正常、強盜阻擋、7、銀行短缺、零 grants | 動畫數量／種類依實際授權 grants；沒有憑空資源、重複收取或不實逐 hex 支付 |
| V05 | 強盜移動與三席觀看偷竊 | 位置正確；未授權席只能見中性卡背；粒子／tooltip／aria 都不露卡種 |
| V06 | 六席密集棋盤、最大 zoom、低階手機配置 | 前景不遮重要數字；選取 highlight 與棋子可區分；手機不因斜角壓縮而難讀 |
| V07 | 手牌／交易／提示面板開閉時的演出 | 不靠遮掉棋盤製造效果；起終點投影不漂移；工具草稿保留 |

人工視覺接受：向使用者提供同 fixture 的 before／after 靜態圖與 10–15s 影片，分別檢視「厚度／重量」「事件因果」「可讀性」「干擾程度」。記錄接受或具體待修項；自動化不能替代美術接受。既有風格延續為海島、原創插畫與紙牌，不加入無關題材。

## A — 無障礙與隱私

| ID | 操作 | 通過條件 |
| --- | --- | --- |
| A01 | 初始 reduce／演出中切換 reduce | 取消飛行、彈跳與粒子；結果與必要位置提示立即顯示；無常駐 RAF |
| A02 | keyboard-only 完成 setup→roll→trade→build→end turn，含 discard／robber | TargetPicker、preview／cancel／confirm、必填提示完整可達；焦點可見且返回合理 |
| A03 | 200% text zoom、非色彩辨識、高對比需求與雙語 | 名稱／符號／文字不缺失；重要控制不因尺寸／效果而失去操作路徑 |
| A04 | 螢幕閱讀器完成目標選取與交易；測一組實際輔具 | 動畫不產生重複朗讀；結果／必填提示可理解；記錄 OS、reader、browser 與缺口 |
| A05 | 三席＋局外人比較 DOM、aria、canvas 輸入、log 與網路投影 | 動效僅消費本席授權資訊；無隱藏手牌、偷竊身份或 VP 洩漏 |
| A06 | 自動 accessibility scan 與人工 keyboard | 新控制無未處理的嚴重問題；自動結果不作 WCAG 全面相容宣告 |

沿用 SPEC U-04／R-VIS。若自動掃描工具尚未在本地具備，先記錄工具安裝與版本，再執行；本文件沒有宣稱現有專案已提供掃描指令。

## P — 效能與資源量測

以下分成既有產品硬目標與本工作流新增的工程目標。工程目標若未達，記錄失敗與原因，不能以改文字讓它通過；變更門檻必須保留原值、量測證據與決策。

| ID | 取樣 | 通過目標 |
| --- | --- | --- |
| P01 | 同一 production fixture、參考桌機與參考手機，暖機後連跑 3 次、每次 30s；固定活躍特效時窗 | 60Hz 桌機 active frame interval p95 ≤20ms；參考手機 p95 ≤33.3ms；與 SVG before 並列 raw data，不只報平均 FPS |
| P02 | 動畫完成後靜置 30s；另測背景 30s、reduce 30s | 動效／renderer 無待播時停止自身連續 RAF／ticker；server heartbeat 不計入；無永久環境粒子 |
| P03 | 20 次進出棋盤／切換候選及 10 次 resize | 無新增 uncaught error／unhandled rejection；owner registries 回到初始 listener／timer／canvas 數；heap／GPU 指標列趨勢，不能僅以單一 heap 值聲稱無洩漏 |
| P04 | 同一 build 記錄 HTML／JS／CSS／texture transfer、gzip／br、冷快取 3 次 | 預設 SVG 不載入 GPU runtime；GPU 所增加 bytes、載入／首個可操作時間均報 before／after；未量測不得宣稱較輕或較快 |
| P05 | 至少 100 次合法選取／提交的 browser input→下一個可見 paint | 可見本地回饋在 100ms 內；零動畫阻塞必填回應；記錄最大值、p95 與失敗樣本 |
| P06 | 6 個真實連線、150ms 模擬 RTT、無 storage failure，至少 100 個 eligible commands | SPEC U-06：committed acknowledgement p95 ≤1s；pending ≥2s 有等待／恢復提示，不能以動畫完成代替 acknowledgement |
| P07 | DPR 1／2／3 及一次至少 80 粒子、24 飛行圖示的上限場景 | 不超過配置上限；resize 不重複配置 context；低品質策略先減裝飾，不降低文字／合法目標／控制品質 |

量測規則：

1. 記錄 OS、CPU／GPU、RAM、瀏覽器版本、刷新率、電源模式、DPR、renderer、解析度及品質設定。
2. frame-time 只在 active animation window 取樣，不能把 demand 模式的閒置長間隔混入 active p95；附 trace。高刷新率另記實際目標。
3. `requestAnimationFrame` interval 是排程／呈現代理指標，搭配瀏覽器 trace；不宣稱等於 GPU render time。
4. input feedback 量到可見 paint；server ack 量到權威結果可見，起終點與 eligible command 類型寫進報告。HTTP fixture 不可充當 P06。
5. U-06 是產品既有目標；硬體尚未量測，P01 等是本工作流的規劃目標，不是現況或跨裝置保證。
6. GPU 候選至少同品質通過正確性、active frame 與操作門檻，並由人工確認可見收益才可採用；若 bytes／載入變差，量化代價並記錄是否接受，不虛構固定 bundle 上限。

## G — GPU 候選專用

| ID | 操作 | 通過條件 |
| --- | --- | --- |
| G01 | 未帶 renderer／未知 renderer／GPU 動態載入拒絕 | 正常可操作 SVG；載入失敗可見且可恢復，無白屏 |
| G02 | 初始化 context 不可用、材質載入失敗 | 錯誤被捕捉，回到最新 SVG，原 selection／草稿／待確認命令保留 |
| G03 | 可用時以 WEBGL_lose_context 模擬 loss／restore | 暫停／清理效果；回 SVG 後不重送命令、不重播；恢復事件不偷偷切回 GPU |
| G04 | 20 次 mount／unmount／候選切換，含非同步 init 尚未完成就離開 | 過期 init 結果被丟棄；無多餘 canvas、ticker、geometry／texture／listeners |
| G05 | 19／30 格與全部 target kind、fit／zoom／pan／keyboard | 與 SVG 的命令／目標相同；TargetPicker 存在，無 GPU 操作獨占 |
| G06 | Pixi texture 最大縮放或 R3F fixed camera／DPR 調整 | 文字與輪廓可辨；素材位置正確；R3F 不引入旋轉／物理規則，Pixi 不假設 SVG parser 完整 |

若環境沒有 WEBGL_lose_context，G03 記 BLOCKED 並補支援裝置，不能僅 dispatch DOM event 冒充真正資源失效。

## 真實流程與人工驗收

- 三／四席真實對局：建房→加入→開局→setup→擲骰→生產→交易→建造→結束回合；保留命令 receipt 與最終盤面。
- 五／六席真實對局：30 格 setup、paired turn、密集棋子、required responses；確認 actor／合法目標與動畫接收者。
- 實機：iOS Safari 與 Android Chrome 各跑選取／pinch／旋轉、軟鍵盤聊天、背景恢復、斷網重連；記錄型號／版本與影片。
- 輔具：keyboard-only、200% zoom、reduce 及至少一組螢幕閱讀器完成目標選取與交易。
- U-07／U-08 原有新手／整局 playtest 義務維持；本工作流沒有因視覺改動而宣稱它們已完成。若操作流程出現新增阻塞，必須修復與重測。

## 執行指令

以下是執行階段的 runbook；新的 fixtures／verify 檔案由實施計畫 P0 建立後才能執行。本次只檢查文件，不執行安裝或測試。

### 現有自動化與最終檢查

```powershell
pnpm install --frozen-lockfile
pnpm --filter @catan/web typecheck
pnpm --filter @catan/web test
pnpm verify
```

事件／投影變更後可先縮小範圍：

```powershell
pnpm --filter @catan/web test -- board-animation.test.ts board-viewport.test.ts board-visual.test.tsx
```

預期：相關案例通過、typecheck／build 成功、smoke 使用新建置完成真實三席 setup。不得只列命令而省略 exit code 與限制。

### 新瀏覽器 runner 的契約

獨立 venv 與瀏覽器安裝僅在執行階段進行；依環境權限處理，不能悄悄安裝到全域 Python。

```powershell
python -m venv .tmp/board-visual-venv
.\.tmp\board-visual-venv\Scripts\python.exe -m pip install playwright
.\.tmp\board-visual-venv\Scripts\python.exe -m playwright install chromium firefox webkit
pnpm build
node scripts/board-visual/fixtures.mjs --out test-results/board-visual/fixtures.json
.\.tmp\board-visual-venv\Scripts\python.exe scripts/board-visual/verify.py --renderer svg --fixture test-results/board-visual/fixtures.json --out test-results/board-visual/after-svg --browser chromium
```

- runner 不帶 base URL 時啟動自己的 worktree artifact server／暫存 SQLite，結束後只清理自己建立的程序／資料。
- before 使用相同指令但輸出 `test-results/board-visual/before-svg`，在 P0、尚未實作視覺時執行。
- GPU 候選以 `--renderer pixi` 或 `--renderer r3f` 輸出到獨立目錄；Firefox／WebKit 用同一 runner 的 browser 選項。
- `--base-url` 只指向已證明是本 worktree 產物的獨立服務；檢查 dist hashes，不能把其他 checkout 既有服務拿來驗收。
- fixture 模式攔截 API／WebSocket 不寫真實 DB；真實流程使用獨立測試資料庫。報告明確標出模式，不混算。
- P0 安裝後記錄 Playwright 精確版本、Python 路徑與 browser revisions，讓結果可重跑；失敗則記缺口，不以固定 Linux executable 補丁帶過。

## 證據與交付格式

每次 run 寫入獨立 `test-results/board-visual/<run>/`，其為本地生成物；需要放入 PR 的精選、去識別證據保存至 `docs/aegis/work/2026-10-28-board-visual-spike/`。不得提交 session cookie、SQLite、原始個人聊天或私人瀏覽器 profile。

每份報告至少包含：

```json
{
  "runId": "2026-10-28-before-svg-01",
  "commit": "4e4b9841c84772f62ac71c2a69cf631224dd989f",
  "dirty": false,
  "mode": "fixture",
  "renderer": "svg",
  "assetHashes": {},
  "environment": {},
  "cases": [],
  "metrics": {},
  "artifacts": [],
  "limitations": []
}
```

此 JSON 僅示範輸出形狀；空欄位不能算合格證據。實際值由 runner 寫入，不能複製示例 commit 或手填未觀測數字。

每個 case 記 ID、狀態、fixture、topology、locale、viewport、操作、實際結果與截圖／影片／trace 路徑。人工項另記操作者／日期／工具版本及未通過原因。

交付自查：

- [ ] 規格／案例／任務可對照；沒有把未執行項標為通過。
- [ ] `pnpm verify` 與 browser 使用同一來源產物；原有與新增失敗分開。
- [ ] 本地回饋與權威 acknowledgement 分開量測。
- [ ] 非色彩、keyboard、reduce、兩語系、19／30 格已覆蓋。
- [ ] 實機／輔具結果或缺口逐項記錄。
- [ ] 使用者已檢視靜態與動態差異，視覺接受有記錄。
- [ ] 被淘汰 renderer／依賴退場；保留 fallback 的理由與 owner 清楚。
- [ ] PR 附比較結果、選型理由、命令／exit code、限制與回復方式；不自動 merge。
