# P3：工程整合檢查與未完成驗收

日期：2026-10-28。對應[實施計畫 P3](../../plans/2026-10-28-board-visual-spike.md)及[驗收方案](../../plans/2026-10-28-board-visual-spike-acceptance.md)。本紀錄整合已完成工程證據與本次最終gate，**不宣稱P3完整驗收或M1／M3／M4完成**。[D1](d1-decision.md)暫時保留SVG唯一工程候選，P2不啟動。

## 起點、來源與必要變更

本次起點為乾淨的 `D:/Workspace/Projects/katan/.worktrees/board-visual-spike`、`feat/board-visual-spike`、`ee37ffb`；沒有其他人的未提交變更。Git檢查只使用命令級 `-c safe.directory=D:/Workspace/Projects/katan/.worktrees/board-visual-spike`，沒有改Git metadata或全域設定。

| 已完成commit | 切片 | 追溯證據 |
| --- | --- | --- |
| `25e97f3` | 規劃與驗收方案 | [plan](../../plans/2026-10-28-board-visual-spike.md)、[acceptance](../../plans/2026-10-28-board-visual-spike-acceptance.md) |
| `cbe920e` | P0固定控制組與portable runner | [P0 report](p0-report.md)、[evidence](p0-evidence.json) |
| `34da589` | P1A事件cursor／生命週期與投影 | [P1A report](p1a-report.md) |
| `ee37ffb` | P1B材質、建造／道路／生產／中性偷竊與capture | [P1B report](p1b-report.md)、[evidence](p1b-evidence.json) |

Change Necessity：同步實際行為、renderer工程決策與未驗收缺口；解除P0／P1A／P1B重現的Windows測試路徑失敗。唯一程式修改為 `packages/server/test/vocabulary.test.ts` 加入 `node:url` 的 `fileURLToPath`，以 `fileURLToPath(new URL('../src', import.meta.url))` 產生跨平台預設路徑，保留原遞迴掃描。沒有改server產品、rules、protocol、web source、依賴、manifest或lockfile；不加平台分支或路徑hack。ArchitectureReviewRequired：本次無新owner／契約，維持授權投影與presentation邊界。

未建立Pixi／R3F、GPU pipeline或product query flag／依賴，無試驗renderer需要刪除。既有測試分屬純cursor／effects／viewport契約及SVG DOM接線，沒有新增多renderer共用層或把jsdom當GPU驗證。canonical `docs/screenshots/` 未更新。

## M0–M4實際狀態

狀態針對完整里程碑條件；部分證據PASS不會使整個里程碑PASS。NOT RUN表示尚有必要驗收未執行，不是已知功能FAIL。

| 里程碑 | 狀態 | 已完成證據／剩餘條件 |
| --- | --- | --- |
| M0控制組 | **PASS** | P0 runner、來源hash、固定fixture、24 before capture、6序列及6量測視窗可重跑；建立比較方法，不含視覺接受 |
| M1 SVG視覺切片 | **NOT RUN（未完成）** | E／I／V／A已有單元／DOM與部分Chromium證據；P01參考硬體、P02真正背景、P03趨勢、P04冷載入與使用者視覺檢視尚未完成，只稱SVG工程候選 |
| M2 GPU對照 | **NOT RUN（未啟動）** | D1沒有確認GPU必要性；G01–G06與I06跨renderer比較未跑，不冒稱不適用即通過 |
| M3整合候選 | **NOT RUN（未完成）** | 本次`pnpm verify` PASS，P1B production fixture browser／privacy PASS，smoke真實三席setup／roll／chat PASS；完整三／四席交易建造end-turn及五／六席paired流程尚無本輪production多客戶端證據 |
| M4完整驗收 | **NOT RUN（未完成）** | M3缺口及實機iOS／Android、輔具、U-06量測、人工視覺接受均未完成 |

歷史gate：P0／P1A／P1B的`pnpm verify`均為**FAIL exit 1**，原因為Windows `.pathname`形成`D:\D:\...`並使vocabulary三項測試ENOENT。本次修正後最終gate為**PASS exit 0**；舊報告保留原時點結果，不回寫成當時已通過。其他尚未執行項目沒有被填成FAIL或PASS。

## 工程驗證與production證據

- 單元／DOM：P1A涵蓋baseline、重複／舊seq與revision、恢復同步、換局、8群／800ms、StrictMode、timer／listener清理、gesture／picker及CSS px投影。P1B新增aggregate資源／數量白名單、空／無效grants、已確認落點、24上限、完整收納、中性卡背與無焦點overlay。取消／拒絕／未知結果不產生成功演出。完整web為20 files／167 tests。
- Browser：沿用[P1B最終證據](p1b-evidence.json)的`after-svg-p1b-source-final`，source report SHA-256 `66f5a0657dcea66cb8b15f7c5434b1d53e7ac3ac78da4051fcda5aec655989e5`；50 cases中47 PASS／0 FAIL／0 BLOCKED／3 NOT RUN。24靜態圖、6事件影片／trace、6×30秒active windows、initial／changing reduce、30秒idle／reduce、3席＋局外人privacy views均完成capture。T01是runner provenance／replay檢查，不是新增的產品驗收ID。
- Capture環境：Windows 10.0.26200、Node24.12.0、pnpm10.28.0、Python3.10.6、Playwright1.64.1、headless Chromium156.0.8078.4，DPR1。Firefox／WebKit僅安裝過，未做runtime驗收。
- Browser報告記錄P1A commit `34da589`加dirty P1B來源；該來源後續提交為`ee37ffb`。本次沒有改web product或runner，最終gate重建後HTML／JS／CSS的SHA-256逐一與P1B的local及served hash相同，故不重跑6×30秒browser suite，不把舊capture冒充新run。

| 最終重建產物 | 與P1B相同SHA-256 |
| --- | --- |
| `index.html` | `07474deead646825b4fe7ad6a74deac35d3ec90a825f124d1ed6d5740756b971` |
| `assets/index-CC8C3fNQ.js` | `bb563a5ecb7c2b0bbb020127b454abbee9f72771780b4af38d774abbf4b0c59d` |
| `assets/index-Czrjx5ha.css` | `398706fa360a91c672fbc8498083d417ae6165cf86714f0e3a11b9e7398d4d44` |

### 本次命令與最終gate

命令皆由上述worktree執行，完整stdout／stderr保留在ignored `test-results/board-visual/`。終端時間約22:12–22:15（Asia/Taipei）。沒有新增測試、調整timeout或略過新失敗。

| 命令 | Exit | 實際結果／log |
| --- | --- | --- |
| `pnpm --filter @catan/server test -- vocabulary.test.ts` | **0** | PASS，1 file／4 tests；`d1-server-vocabulary.log` |
| `pnpm --filter @catan/web typecheck` | **0** | PASS；`d1-web-typecheck.log` |
| `pnpm --filter @catan/web test` | **0** | PASS，20 files／167 tests；`d1-web-test.log` |
| `pnpm verify` | **0** | PASS，四workspace typechecks；43 test files、368 passed／11 skipped／0 failed；web＋server production build；smoke13／13；`d1-p3-verify.log` |
| `git -c safe.directory=D:/Workspace/Projects/katan/.worktrees/board-visual-spike diff --check` | **0** | PASS，無whitespace錯誤 |

最終verify分項：rules12 files／110 passed，protocol1 file／7 passed，server10 files／84 passed及11 skipped，web20 files／167 passed。11 skips是未提供`TEST_POSTGRES_URL`的PostgreSQL contract；本輪沒有驗PostgreSQL，不把skip算pass。SQLite的Node experimental warning仍出現，不是新失敗。Smoke使用剛建出的server與同源client完成真實三席setup（12 commands、revision13）、roll（revision14）、chat與他席隱藏資源檢查；這不是完整多席browser對局或P06延遲測試。

### 隱私與效能限制

特效僅消費本席授權GameView／事件中的aggregate grants；不讀engine state、不推算對手手牌、不把資格地塊當逐hex支付。engine-projected三席＋局外人fixture比較中性偷竊overlay相同；各席獲授權的私人手牌／log本來可不同，不能要求整個DOM相同。動效沒有資源卡種tooltip／aria／粒子洩漏。這是fixture與測試證據，未冒充真實多client對局。

P1B桌面3次p95為8.7／8.6／8.9ms，max91.6／108.2／91.6ms；emulated mobile p95為8.6／8.9／8.8ms，max66.6／58.4／66.5ms。P0 p95均8.5ms。這些是30秒active CSS animation rAF scheduling proxies，非GPU render time；P0／P1B演出行為／活躍時窗不同，沒有參考實機、60Hz／電源校準及完整硬體資料，不能宣稱更快或沒有卡頓。原始samples／timelines留在P1B ignored run。P02 idle及兩個reduce視窗應用RAF增量均0；真正背景30秒仍NOT RUN。

## 尚未執行與交付邊界

- 使用者對before／after靜態與10–15秒影片的人工美術接受，包含厚度、因果、收納短時窗可讀性及干擾；canonical基準只在接受後另行更新。
- 實機iOS Safari／Android Chrome的touch／pinch／rotation／軟鍵盤／背景恢復／斷網；Firefox／WebKit核心runtime；DPR2／3及最大zoom／密集盤可讀性。
- 完整keyboard-only setup→trade→build→required responses旅程、200% text zoom、screen reader實測及accessibility scan／人工覆核。英文UI的靜態HTML仍為`lang=zh-Hant`，本輪未修。
- P01參考桌機／手機、P02真正背景30秒、P03進出20次／resize10次registry與heap／GPU趨勢、P04三次cold-cache timing、P05至少100次input→paint、P06六真實連線／150ms RTT／至少100 eligible commands、P07高DPR上限場景。粒子實作為0，不能以24飛行DOM測試聲稱80粒子場景已跑。
- 三／四席完整production流程、五／六席paired真實多客戶端流程、U-07新手與U-08整局playtest；本輪不聲稱完成。

本次應提交的六檔僅為D1／P3紀錄、`docs/aegis/INDEX.md`、`docs/SPEC.md` §8.8、`docs/FIDELITY.md`與server vocabulary測試。最終status沒有test-results、cache、SQLite、cookies、manifest／lockfile或web source漂移。可將這個有限工程整合切片交由主代理審查後commit／push；不得以此宣稱M3／M4已通過或自行merge。此步驟沒有commit、push或建立PR。
