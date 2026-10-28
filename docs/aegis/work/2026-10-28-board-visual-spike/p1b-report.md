# Board visual P1B：SVG 材質與授權事件演出

日期：2026-10-28。工作區 `D:/Workspace/Projects/katan/.worktrees/board-visual-spike`，分支 `feat/board-visual-spike`；切片起點 `34da589ff859139ee0097bf715e103ca220a94d5`。範圍為[計畫 P1B](../../plans/2026-10-28-board-visual-spike.md)及[驗收方案](../../plans/2026-10-28-board-visual-spike-acceptance.md)。本紀錄不宣布 M1／M3／M4、人工美術或實機驗收通過。無 commit、push 或 PR。

## 實作與 owner

Baseline alignment：aligned。`state/table.ts` 仍唯一接收權威投影；P1A 的 cursor、八群／每群 800ms queue、timer／listener 與取消生命週期不變。`BoardView` 仍持有 intent、selection、viewport／TargetPicker。新增 `board/effects.ts` 僅抽取授權事件的 presentation 資料，`BoardEffects.tsx` 僅產生 SVG。沒有第二份遊戲狀態、命令入口、renderer、依賴或 wire schema。

- 地塊新增同座標的 10 world-unit 底面、側緣與接觸陰影；道路有暗色接觸底線，GameArt 的 `BuildingPiece` 增加側面、屋頂高光與落地陰影。號碼、pips、港口、座位虛線與玩家色沿用原資料／幾何，沒有 rotateX 或相機抖動。
- `selection` 驅動半透明 preview ghost，取消即消失。只有新權威事件與當前投影的玩家／vertex／edge／建築種類一致時，才套用 290ms building drop 或 240ms road edge reveal。道路權威底線立即可見；演出不提交命令，不以 receipt 猜測成功。
- 中央骰子由 P1A 單一新事件來源播放；工具列不搖動，保留最後骰子和既有文字結果。中央裝飾 `aria-hidden`，避免重複朗讀。前段骰子退場後接生產提示；mandatory action 立即取消全組。
- `production.resolved.params.grants` 是 `Record<playerId, Partial<Record<Resource, number>>>`。只取本席投影中的正整數實際 grants，依玩家／資源彙總；每張飛行卡明示 `+amount`。符合骰子且未被強盜擋住的地塊僅作資格提示，**不宣稱卡片來自特定 hex 支付**。飛行從右側「實際彙總配發／Aggregate allocation」區，到左側按座位標記的暫時收納區；這些 SVG presentation 標記沒有推算對手手牌。既有手牌／座位總數與雙語事件紀錄立即提供持久結果。
- 空 grants、零／負／非整數／未知資源欄位不生成飛行、收納或產地提示；短缺事件不自行換算支付。強盜本體只反映權威位置。`neutralThefts` 丟棄所有私人欄位，即使觀看者獲授權也只畫相同中性卡背，無卡種文字、色彩、tooltip、aria 或粒子。
- 生產與偷竊共用最多 24 飛行圖示；超出的 aggregate 仍保留完整收納文字與權威紀錄。粒子為 **0**，無 Canvas、RAF、ticker 或常駐特效。overlay 與子節點 `pointer-events:none`、`aria-hidden`、無 tab stop；沿用 P1A 對 mandatory、offline、reconnect/gap、背景、reduce、unmount 的取消。reduced-motion CSS 也停用 drop/reveal。

Complexity control：兩個小型 presentation 模組、一個 GameArt 棋子元件與獨立 CSS layer；直接消費既有 owner，沒有通用 adapter、fallback、規則複製或大型 renderer。資源清單沿用 rules 的 `RESOURCES`。

## 自動化與 runner

新增 `board-effects.test.tsx` 驗證 aggregate 格式、金額與資源白名單、空發放、已確認落點、24 上限、完整收納、無焦點入口及三席／局外人相同卡背。App／BoardView 測試涵蓋取消 ghost、拒絕保留草稿但無成功動畫、未知結果無假演出、正常 snapshot 生產／建造與 offline 立即取消。P1A lifecycle 測試繼續覆蓋 StrictMode、unmount、visibility、reduce、8 群／800ms 及精確 listener／timer 清理。

Runner 新增 `--suite p1b`：驗證本 worktree production server 與 dist byte hashes，捕捉 24 靜態矩陣、兩棋盤各三尺寸的 10 秒序列影片／trace；在 roll／city／road 中間幀檢查 aggregate 數、drop／reveal 及 pointer-events。另驗證 initial／changing reduce、full-history baseline、30 秒 idle／reduce RAF、三席＋局外人 engine-projected 偷竊。P0 控制圖與 canonical screenshots 未覆寫。

Privacy fixture 在獨立 clone 注入 synthetic knight pending 與一張 victim 資源，再由 rules engine 執行移動／偷竊並逐席 `projectGame`；只輸出各席授權投影，未輸出 engine state／private envelope。這是 fixture 證據，非真實多客戶端對局。重複產生 SHA-256：`d03eb8bd0e97a2d016460de06894f91883f1f23dfff931333ca03464e39caa55`。

P0 performance pulse 的大幅 seq offset 在 P1A 會被正確判為缺事件並 baseline；runner 已改為連續遞增 roll＋production 序列以量測 presentation load，沒有改 P1A 配合 runner。重複 pulse 不代表真實對局重複取得資源。

```powershell
node scripts/board-visual/fixtures.mjs --out test-results/board-visual/fixtures-p1b.json
.\.tmp\board-visual-venv\Scripts\python.exe scripts/board-visual/verify.py --suite p1b --renderer svg --fixture test-results/board-visual/fixtures-p1b.json --out test-results/board-visual/after-svg-p1b-source-final --browser chromium
```

## 實際命令與狀態

| 命令 | Exit | 狀態／範圍 |
| --- | --- | --- |
| `pnpm --filter @catan/web typecheck` | 0 | PASS，含新元件／測試 |
| `pnpm --filter @catan/web test -- board-effects.test.tsx board-visual.test.tsx board-animation-lifecycle.test.tsx app.test.tsx` | 0 | PASS，4 files／46 tests |
| `pnpm --filter @catan/web test` | 0 | PASS，20 files／167 tests |
| `pnpm build` | 0 | PASS，web 與 server production artifacts |
| `pnpm smoke` | 0 | PASS，13／13，含真實三席 setup、roll、chat 與他席隱藏資源 |
| `pnpm verify` | 1 | FAIL，既有 Windows server vocabulary path defect |
| fixture generation／repeat | 0 | PASS，相同 SHA-256、19／30 hex、逐席 privacy assertions |
| Python AST／`node --check` | 0 | PASS，不產生 bytecode |
| Chromium `--suite p1b` 最終來源 | 0 | PASS，50 cases：47 PASS／0 FAIL／0 BLOCKED／3 NOT RUN |
| `git diff --check` | 0 | PASS |

`pnpm verify` 的四個 workspace typechecks、rules 110 tests、protocol 7 tests 通過。Server 81 passed／11 skipped／3 failed，均在 `packages/server/test/vocabulary.test.ts` 的 `serviceSources` line 23：`new URL('../src', import.meta.url).pathname` 在 Windows 形成 `D:\D:\Workspace\Projects\katan\.worktrees\board-visual-spike\packages\server\src`，`readdirSync` 拋出 `ENOENT`。本切片未修 server；aggregate gate 在 build／smoke 前停止，表中 build／smoke 為獨立實跑。Log：`test-results/board-visual/p1b-verify-source-final.log`。

開發過程修正過 privacy fixture 的 topology API 與預設空 events 選項；首輪 browser run 在已完成 static／events／reduce／idle 後，因 Playwright `inner_text` 不支援 SVG 而 FAIL，已改 `text_content`。視查發現底部 aggregate 被既有手牌 dock 遮擋，移到左右海域並修正卡背縱向位移。另發現 PowerShell→Python 的 ASCII pipeline 破壞新增繁中文字面值，已以 UTF-8 方式重建本報告與 zh-Hant 新鍵。舊 run 僅留 ignored raw output；最終證據需對應修正後 build。

## 驗收狀態與限制

| 案例／面向 | 狀態 | 證據或限制 |
| --- | --- | --- |
| E／I 事件與互動回歸、E10 取消／拒絕／未知、I07 overlay | PASS（自動化範圍） | web 167 tests，沒有 command／snapshot owner 變更 |
| V02 placement、V04 aggregate／空發放、V05／A05 隱私、24 上限 | PASS（純函式／DOM 範圍） | 不是 native geometry、實機或 GPU 驗收 |
| V01／V03、A01、E01、P01／P02 production capture | PASS（capture 範圍） | 24 static、6 event videos／traces、6 active windows、initial／changing reduce、30 秒 idle／reduce、4 privacy views；收納可讀性仍需人工看影片 |
| 人工美術接受、實機 iOS／Android、螢幕閱讀器、200% text zoom、Firefox／WebKit | NOT RUN | 無裝置／輔具實測；Chromium touch 為模擬 |
| P01 參考硬體門檻 | NOT RUN | active rAF interval 為排程代理，不是 GPU render time 或實機效能 |
| P02 真正背景 30 秒、P03 20 次 mount／10 resize registry／heap／GPU 趨勢 | NOT RUN（browser） | jsdom lifecycle 不升格為 native leak proof |
| P04 cold-cache 三次、P05 100-input paint、P06 六席 150ms RTT／100 commands | NOT RUN | fixture 不代表 ack latency；gzip bytes 不代表冷載入時間 |
| P07 DPR2／3 上限與實機 | NOT RUN（browser） | DOM 覆蓋24飛行、粒子0；未建立80粒子場景 |

D1：維持 SVG 工程候選；沒有證據顯示需要 GPU，也沒有使用者視覺接受，故不啟動 P2、不宣稱 renderer 決策或 P3 完成。獨立 reviewer 重點：資格提示與 aggregate 支付語意、海域收納標記在窄尺寸／zoom 的可讀性、CSS 中間幀與 mandatory prompt、偷竊 overlay 完全不依卡種、取消後權威結果仍可辨。

## 最終證據與觀察

唯一交付來源為 `test-results/board-visual/after-svg-p1b-source-final/report.json`，SHA-256 `66f5a0657dcea66cb8b15f7c5434b1d53e7ac3ac78da4051fcda5aec655989e5`。來源、dist／served assets、case 明細、工具版本、限制與精選來源 hash 均保存於 [p1b-evidence.json](p1b-evidence.json)。不是把早期 run 改名：產生精選資料時重新核對了當前 dist bytes 與 report 的本地／served SHA-256，並確認自有 server 結束、暫存 SQLite 已清除。最終 JS 為 `index-CC8C3fNQ.js`；繁中 event case 實際比對「實際彙總配發」字串。

| 裝置／重複 | P0 p95（ms） | P1B samples | P1B p95（ms） | P1B max（ms） |
| --- | --- | --- | --- | --- |
| desktop／1 | 8.5 | 869 | 8.7 | 91.6 |
| desktop／2 | 8.5 | 862 | 8.6 | 108.2 |
| desktop／3 | 8.5 | 866 | 8.9 | 91.6 |
| emulated-mobile／1 | 8.5 | 907 | 8.6 | 66.6 |
| emulated-mobile／2 | 8.5 | 906 | 8.9 | 58.4 |
| emulated-mobile／3 | 8.5 | 904 | 8.8 | 66.5 |

這些是同一最終 production build、每次 30 秒的 active CSS animation rAF intervals；raw samples 與 Chromium timelines 留在各 run 下。P0 原始資料來自既有控制組，演出時窗與 presentation 行為不同。P1B 本地 p95 低於規劃的 20／33.3ms 數值，但沒有參考實機／60Hz／電源校準，**不等於 P01 硬體驗收**。max 明顯高於 P0，不能宣稱較快或沒有卡頓；需獨立效能 review 與實機確認。30 秒 idle 及兩個 reduce 視窗的應用 RAF 增量均為 0。

精選去識別產物：

- 靜態前後：對照既有 `before-*`，新增 [19 格桌面](after-hex-r2-en-desktop.png)、[30 格繁中桌面](after-hex-r56-zh-Hant-desktop.png)、[30 格手機](after-hex-r56-en-mobile.png)、[30 格橫向](after-hex-r56-zh-Hant-landscape.png)。
- 中間幀：[生產](after-production-zh-Hant-desktop.png)、[city drop](after-city-zh-Hant-desktop.png)、[road reveal](after-road-zh-Hant-desktop.png)、[reduce](after-reduced-motion.png)、[局外人中性偷竊](after-neutral-theft-outsider.png)。
- 影片：[19 格桌面 12.08 秒](after-hex-r2-desktop-events.webm)、[30 格手機 12.60 秒](after-hex-r56-mobile-events.webm)；時長以 Chromium video metadata 讀回，均含 10 秒事件序列與導覽開頭。
- [局外人隱私 trace](after-neutral-theft-outsider-trace.zip)。其餘事件／performance traces 及 raw data 留在 ignored run 目錄。

收納階段在 800ms 預算中的時窗很短；另外擷取的 raw `production-receipt` 圖可能已到群組移除後，不能當成收納可讀性的證明。人工仍須檢視影片的因果、暫時標記大小／遮擋與干擾程度。自動 PASS 代表明列的工程檢查完成，不代表美術接受。

大量 raw screenshots／videos／traces／logs 均留在 ignored `test-results/board-visual/`；Git status 僅有本階段 source／tests／runner／報告與上述精選產物，無 cache、SQLite、session cookie、manifest／lockfile 或無關變更。
