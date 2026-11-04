# 電腦對手擴充包計畫：事實與一致性審查

> 收錄說明：2026-11-04 由 Reviewer 對整體策略與 SF、C&K、T&B、E&P 計畫所做的獨立事實核對，內容原樣保留；文中的行號指向修正前的版本，SF+CK 計畫不在核對範圍。高、中嚴重度的問題都已在同日修正：`robberTargets` 改為與 rules 相同的有序 fold（H1、H2）；每視窗上限的斷言改為 ≤（M1）；SF 看門狗改用創新高（M2）；SF 規模、整體策略 §5.1 的終局數字與 0.4.2 的 `hexYield` 都已更新（M3–M5）。

基準：v0.4.0，`a200840`。範圍：整體策略、SF、C&K、T&B、E&P 計畫及 `docs/aegis/INDEX.md`。SF+CK 計畫不在審查範圍。以下「核對」只代表對照目前工作樹內的 v0.4.0 程式碼與文件；研究目錄中的模擬數字未重新執行。

## 高嚴重度

### H1：`robberTargets` 的排除語意與 Friendly Robber 必須能留在沙漠相衝突

- 文件：整體策略 §4.2，行 199。
- 問題：同一列寫「取代 base 的預設候選（排除目前所在格）」，又寫 FR 在無其他合法格時唯一合法格是目前的沙漠格。若前半句是對模組輸出的硬性過濾，FR 的合法動作會被移除；若「排除」只描述 base 初始候選，文字沒有說清楚 FR 模組可重新加入原格。T&B 計畫 §4.1/§11-2 明確要求可以回傳目前格。
- 證據：`packages/rules/src/engine.ts:1461-1471` 先排除目前格後，把候選依序傳入各 rules module；`packages/rules/src/modules/tradersBarbarians/variants/friendlyRobber.ts:34-40` 在沒有可用目標時回傳所有沙漠格，可能包含目前格；引擎接受模組回傳的候選結果。
- 建議修文：「`robberTargets` 有回傳時，以其完整合法候選取代 base 候選；模組結果可包含目前所在格（FR 沙漠例外）。組合時依 rules 的模組順序套用候選轉換；若平台改採跨模組交集，須先定義可擴大 base 候選的例外，並以 rules 行為測試鎖定。」

### H2：文件宣稱 Bot 模組組合規則與 rules 一致，但 `robberTargets` 聚合方式並不等價

- 文件：整體策略 §4.2，行 193–200；SF 計畫 §11-1，行 332；T&B 計畫 §3.2、§11-2，行 113、433–435。
- 問題：整體策略規定多模組 `robberTargets` 取交集，而 v0.4.0 rules 是依序把前一個 module 的候選傳給下一個（不是集合交集運算）；FR 在空集合時還能重新回傳沙漠候選。未明確限定哪些組合可用，照「組合規則與 rules 一致」實作可能改變合法候選或產生空集合。這是共用介面合約問題，不只是 FR 的例外措辭。
- 證據：`packages/rules/src/engine.ts:1464-1470`；`packages/rules/src/modules/tradersBarbarians/variants/friendlyRobber.ts:34-40`。
- 建議修文：將規則寫成與 rules 相同的有序 fold：每個 module 收到當前候選並回傳下一組候選；另明列 FR 可在輸入無候選時回傳沙漠格。若刻意使用交集，需修改「與 rules 一致」聲明並提供證明 rules module 的候選函式都只會縮小集合。

## 中嚴重度

### M1：Q1 對每視窗上限使用嚴格小於，與 server 邊界及 E&P 自己的驗收不一致

- 文件：整體策略 §3.1，行 137；SF 計畫 §11-4 及 §6.1，行 335、191–197；E&P 計畫 §6.1，行 287；整體策略 §4.7，行 304–309。
- 問題：共用 Q1 說「低於上限」，SF 明定 `<40`，E&P 卻驗收 `≤80`。v0.4.0 driver 在已送 40 個指令後，下一次決策才切換保底，因此達到 40 本身是允許的。此差異可能讓 SF 矩陣錯誤拒絕恰好 40 個合法指令的局，或讓各 family 測試採不同統計口徑。
- 證據：`packages/server/src/bot-driver.ts:303-314` 以已計數 `>= MAX_BOT_COMMANDS_PER_WINDOW` 決定下一指令走保底；上限為 `:69-70` 的 40。
- 建議修文：將共用 Q1 和 SF 的斷言統一改成「策略每視窗不超過上限（`≤`）；driver 超限後的保底指令另外統計」，並說明是否把保底指令計入觀測值。

### M2：SF 矩陣看門狗把「分數有變化」當成進展，與共用看門狗定義不同

- 文件：整體策略 §4.6，行 277；SF 計畫 §6.1 的 B-GAME 列，行 191。
- 問題：共用定義要求某玩家的分數超過自己先前最高分才重設看門狗，避免城市失去或最長道路易手後的分數下降被視為進展；SF 列則寫 `ownScore`「沒有變化」。若分數只是下降或來回波動，SF 看門狗會重設，無法按共用規格抓住長時間沒有創新高的局。
- 證據：整體策略 §4.6，行 277；SF 的試算表定義同文件 §6.1，行 191；C&K 計畫 §6.1，行 6.1 矩陣表與相鄰說明（約行 270–285）亦採用看門狗 N。
- 建議修文：改成「連續 60 次 `turn.roll`，沒有任何玩家超過該玩家此前最高公開分數」；測試 harness 保存 running high-water mark，不以分數差值是否為零判斷。

### M3：SF 各切片估算合計高於整體策略的 SF 行數估算

- 文件：整體策略 §5，行 353；SF 計畫 §5 切片表，行 155–160。
- 問題：整體策略將 SF 寫為 1,450–1,850 行；SF 計畫各切片 src＋test 估算相加為約 1,580–2,030 行（RX 60–80、SF-1 430–530、SF-2a 440–560、SF-2b 260–350、SF-3 260–330、SF-4 160–220），未計文件。兩份估算差約 130–180 行以上，會低估 0.4.1 總規模並影響拆分與審查容量。
- 證據：整體策略 §5 行 353；SF 計畫 §5 行 155–160，尤其行 159 的測試行數及行 160 的 gating 行數。
- 建議修文：依 SF 計畫逐項加總後把整體策略改為「約 1,580–2,030 行（src＋test；文件另計）」；或在 SF 計畫明示哪些工作會與平台切片共用、不應重複計算，並據此更新估算。

### M4：SF 看門狗對照資料一處標示 40 局、一處標示 20 局，種子口徑未交代

- 文件：整體策略 §5.1，行 362；SF 計畫 §6.1，行 201–203；SF 計畫 §11-5，行 336。
- 問題：SF 計畫 N1 說 3–6 人各 10 seeds，且卡住的是 3 人與 6 人各一局；§6.1 說已終局局的間隔 base／naive SF 各 6–25，活鎖局 933–1,513。§11-5 引述 3 人與 6 人種子各卡住，但 roadmap §5.1 用「多數對局也能打完」概括，未說明前兩批 20/24 完局與按新 B-GAME 方式測得 2/40 卡住之差別。這不必然互斥，但計量版本、樣本分母易被讀成同一批測試。
- 證據：SF 計畫 §2.2 與 §11-5；整體策略 §2.2 行 95、§5.1 行 362。
- 建議修文：在 SF 結論旁標明「舊批次 20/20、24/24；最新混座 B-GAME 40 局中 2 局達 8,000 步上限」，並將看門狗樣本分母標成實際用來計算區間的局數。

### M5：roadmap §4.9 未明列 C&K 必需的 `economy.hexYield` 掛點

- 文件：整體策略 §4.9，行 332；C&K 計畫 §4.5 與 §5 CK-B1 切片，行 105、255。
- 問題：整體策略列 0.4.2 的 `rates`、`weights`、`vertexBlocker`、`siteBlocked`，卻沒有列 `hexYield`。C&K 計畫明列 `hexYield` 用來計入 commodity 生產，且 CK-B1 負責該掛點。若 §4.9 是平台交付的完整清單，會讓實作者漏做此共用掛點；若它刻意只列新增介面，需標明 `hexYield` 已由前版提供。
- 證據：roadmap §4.1 行 165、§4.9 行 332；C&K 計畫 §4.5 行 105、§5 CK-B1 檔案／內容列行 255。
- 建議修文：在 0.4.2 平台交付加上「`economy.hexYield` commodity 產出掛點」，或註明它由 0.4.1／其他既有切片提供並列出驗收責任。

## 低嚴重度／文件核對

- `docs/aegis/INDEX.md:8-12` 新增五筆文件路徑均存在且標題與版號相符；SF+CK 計畫沒有本次新增索引列，符合不在範圍的說明。
- 整體策略 §4.9 的 0.4.5 `phase`、`endWindow`、mission gating 與 `economy.awards`，均在 E&P 計畫 §3.1、§4.8–4.9、§5 切片表找到對應；`economy.awards` 的先建 owner 為 T&B S1、E&P 沿用，與 T&B／E&P §11 註記相符。
- C&K X1–X7、T&B 1–7、E&P D-1–D-5 的整合註記均能在 roadmap 指定的 §3、§4、§5、§6、§9、§10 找到對應文字。SF §11-1 新增的 `banditCandidates`、§11-2 平行開發、§11-3 worktree 命名及 §11-4 Q1 變更亦已落入對應章節。SF §11-7 的 `moduleView` 放置位置則落在 §4.3。
- 多版本共用檔案的所有權沒有實質衝突：SF-2a 和 C&K CK-B1、T&B S1 確實都會動 `economy.ts` 等共用檔，但分屬不同 release 版本；roadmap §8 明定共用檔同時間只交一位 agent。T&B S1 與 C&K CK-B1 各自限定獨占共用檔，須在依賴版本上串行刷新。
- Roadmap 0.4.1 平台切片估算 500–800 行，三片 PL-1 至 PL-3 有獨立驗收；但總體版本表未把 0.4.1 的 SF 切片重新加總（見 M3）。C&K、T&B、E&P 的各版總行數與各自切片表相加大致吻合（C&K 2,750–3,400、T&B 2,830–3,620、E&P 3,370）。
- 各計畫 §10 的決策表與章節引用均存在；`docs/aegis/INDEX.md` 列路徑存在。全體 PR、release、branch/worktree 命名未發現相互衝突；各計畫有沿用 roadmap 的 release 分支／squash PR／stable merge 流程。

## 程式碼引用抽查清單（共 48 項）

| # | 文件中的引用 | 核對結果 |
|---:|---|---|
| 1 | Roadmap §2.1 `packages/protocol/src/index.ts:299-303` | 正確：`CommandRequest.command` 是開放的 `{ type: string } & Record<string, unknown>`。 |
| 2 | Roadmap §2.1 `packages/rules/src/engine.ts:669-673` | 正確：`applyCommand` 接受 `Command \| ModuleCommand`。 |
| 3 | Roadmap §2.1 `packages/server/src/bot-seats.ts:45-51` | 正確：`botsSupported` 呼叫 `botsCanPlay`。 |
| 4 | Roadmap §2.1 `packages/server/src/http.ts:288` | 正確：profile API 逐 profile 填 `botSeats`。 |
| 5 | Roadmap §2.1 `packages/web/src/state/bots.ts:18-20` | 正確：前端以 `profile.botSeats` 判斷。 |
| 6 | Roadmap §2.3 `packages/bots/src/fallback.ts:41-43` | 正確：未知／模組 pending 預設回 null。 |
| 7 | Roadmap §2.3 `packages/bots/src/heuristic.ts:162-164` | 正確：模組 pending 預設回 null。 |
| 8 | Roadmap §2.3 `packages/server/src/bot-driver.ts:330-345` | 正確：策略與保底均無命令時 `findDecision` 回 null；尚無該處診斷。 |
| 9 | Roadmap §2.3 `packages/server/src/bot-driver.ts:413-423` | 正確：保底被拒後依 `retryMs` 排程重試。 |
| 10 | Roadmap §2.3 `packages/bots/src/types.ts:39` | 正確：`decide` 目前回 `Command \| null`。 |
| 11 | Roadmap §2.3 `packages/server/test/bots.test.ts:259-261` | 正確：測試用 expansions 加 variants 推算支援。 |
| 12 | Roadmap §4.5 `packages/rules/src/engine.ts:1874` | 正確：同意報價時同時檢查提議者 giveGoods 與回應者 wantGoods。 |
| 13 | Roadmap §4.6 `packages/rules/src/engine.ts:123` | 正確：`LOG_LIMIT` 為 200。 |
| 14 | Roadmap §4.7 `packages/server/src/bot-driver.ts:69-70` | 正確：目前每視窗上限常數為 40。 |
| 15 | SF §2 `packages/bots/src/board.ts:96-100` | 正確：空點／距離判定不含地形或騎士 blocker。 |
| 16 | SF §2 `packages/bots/src/board.ts:103-111` | 正確：base 產量只依 `TERRAIN_RESOURCE` 與點數。 |
| 17 | SF §2 `packages/bots/src/board.ts:126-152` | 正確：`PieceCounts` 無 ships，存量也無 ships。 |
| 18 | SF §2 `packages/bots/src/board.ts:186-203` | 正確：base BFS 對所有未佔用 edge 搜尋，沒有陸海限制。 |
| 19 | SF §2 `packages/bots/src/board.ts:233-235` | 正確：base route length 只加入非 ship roads。 |
| 20 | SF §2 `packages/bots/src/types.ts:33-39` | 正確：目前策略型別是 base `Command`。 |
| 21 | SF §2 `packages/server/src/bot-driver.ts:40-64,74` | 正確：該區是目前 base command delay 表與 `Decision.command: Command`。 |
| 22 | SF §2 `packages/rules/src/index.ts:1-20` | 正確：目前匯出 E&P 型別，未匯出 SF view/hints。 |
| 23 | SF §4 `packages/rules/src/modules/seafarers/ships.ts:57-75` | 正確：放船會呼叫 vertex blocker 檢查。 |
| 24 | SF §4 `packages/rules/src/analysis.ts:88-106` | 正確：`moduleVertexBlocker` 聚合模組 blocker。 |
| 25 | SF §4 `packages/rules/src/modules/citiesKnights/index.ts:122` | 正確：C&K 提供騎士 vertex blocker。 |
| 26 | SF §4 `packages/rules/src/modules/seafarersCitiesKnights/index.ts:121` | 正確：組合模組也有 blocker。 |
| 27 | SF §4 `packages/rules/src/modules/seafarers/pirate.ts:13-21` | 正確：海盜目標可能為海格或 null。 |
| 28 | C&K §4.5 `packages/bots/src/board.ts:113-123` | 正確：base 城市產出以城市倍數計算，未增加 commodity。 |
| 29 | C&K §4.5 `packages/bots/src/board.ts:154-157` | 正確：base blocker 只考慮對手建築。 |
| 30 | C&K §4.5 `packages/bots/src/board.ts:96-100` | 正確：base free spot 只檢查建築與距離規則。 |
| 31 | C&K §4.3 `packages/rules/src/index.ts:12-13` | 正確：E&P 型別及常數採用別名匯出，可作命名模式參照。 |
| 32 | C&K §5 `packages/rules/test/ck-checks.ts:10,28` | 正確：rules 測試輔助路徑存在，C&K 計畫引用 helper。 |
| 33 | T&B §2 `packages/bots/src/support.ts:12-17` | 正確：v0.4.0 `BOT_RULE_MODULES` 為空。 |
| 34 | T&B §2 `packages/server/test/traders-barbarians.test.ts:66-89` | 正確：現行 T&B server 測試拒絕 Bot。 |
| 35 | T&B §2 `packages/rules/src/modules/tradersBarbarians/variants/friendlyRobber.ts:34-41` | 正確：無合法格時回傳沙漠格，可能包含當前格。 |
| 36 | T&B §2 `packages/rules/src/engine.ts:1462-1482` | 正確：rules 檢查 module 給出的 robber candidates；文中描述需結合模組 callback 的結果理解。 |
| 37 | T&B §2 `packages/rules/src/modules/tradersBarbarians/traders/index.ts:369-372` | 正確：Traders 將最長道路門檻設 Infinity。 |
| 38 | T&B §2 `packages/bots/src/economy.ts:259-281` | 正確：base economy 仍會產生 longest-road plan。 |
| 39 | T&B §2 `packages/rules/src/engine.ts:1874` | 正確：同意時檢查交易雙方 goods。 |
| 40 | T&B §3 `packages/rules/src/modules/tradersBarbarians/index.ts:28-40` | 正確：場景與 variant part 次序由清單定義。 |
| 41 | T&B §3 `packages/rules/src/modules/tradersBarbarians/index.ts:45-56` | 正確：`activeParts` 解析未知 variant 的行為需由原始 variant mapping 防漏。 |
| 42 | E&P §2 `packages/bots/src/fallback.ts:65-76` | 正確：base setup 只用 base setup hints；沒有可用目標即回 null。 |
| 43 | E&P §2 `packages/rules/src/modules/explorersPirates/index.ts:79,95,116` | 正確：E&P module setup state 不等同 base setup state。 |
| 44 | E&P §2 `packages/rules/src/modules/explorersPirates/index.ts:81-84,97` | 正確：Movement 期間可用指令受階段限制。 |
| 45 | E&P §2 `packages/rules/src/modules/explorersPirates/index.ts:122-127` | 正確：模組 hints 會以 E&P 規則調整 base 合法 road/settlement 候選。 |
| 46 | E&P §3 `packages/rules/src/modules/explorersPirates/boards.ts:239-253` | 正確：Fish 與 Spices 的 mission/component 組成不同，Spices 仍含海盜。 |
| 47 | E&P §3 `packages/rules/src/modules/explorersPirates/pirate.ts:27-29` | 正確：海盜 frame 以單一 responder 處理。 |
| 48 | E&P §4 `packages/rules/src/engine.ts:2071,2100` | 行號／引用部分正確：`turn.end` 的拒絕路徑與擱淺檢查在此區；具體語意須搭配 E&P movement 與 `canEndTurn` 的檢查閱讀。 |

## 一致性與數字核對

- 共用介面：`banditCandidates`、`economy.awards`、`vertexBlocker`、`siteBlocked`、`hexYield`、`supports`、rules 3/4/7/8/9 與 I3、`BOT_TEST_MATRIX`／family tests、保底席、看門狗、逐步 `mechanics` 計數，均在 roadmap 有明確規格；各計畫使用方式大致一致。需先解決 H1/H2 的 robber target 合約。
- server 節奏與上限：roadmap §4.7 與 SF/C&K/T&B/E&P 的專屬設定大致一致；Q1 上限嚴格比較需按 M1 統一。`Decision.command` 的改型在 roadmap 與各計畫都屬 PL-3 交付。
- Q1/Q2/Q3：定義與發布閘門一致，擴充計畫提供模組專屬數值。SF 看門狗措辭依 M2 修正；T&B/E&P family 不含模組指令的 profile 以行為指標替代，與 roadmap DoD 相符。
- 分支與 worktree：roadmap 使用每切片獨立 `feat/bots-<slug>-<slice>` 與 `.worktrees/bots-<slug>-<slice>/`；各計畫的 SF、CK、TB、EP slug 均依此模式。版本依賴為 SF → C&K → SF+CK，T&B/E&P 依 0.4.1 平台，沒有同時修改共用檔的計畫性衝突。
- release：各計畫沿用 roadmap §7 的 release branch、squash 功能 PR、rc、stable merge 流程。沒有發現各版流程互相矛盾。
- Paseo：roadmap 與計畫均將 Reviewer 設為唯讀、實作者隔離 worktree、主 agent 持有共用合約；角色細分無互斥要求。
- Profile 數：2 SF + 2 C&K + 2 SF+CK + 8 T&B + 5 E&P = 19，與 roadmap §1.2 相符。
- Q2/Q3 定義、DoD 與各計畫章節引用：抽查均有目標章節；Roadmap §11 列 SF+CK 計畫路徑目前尚不存在，但使用者已明示該計畫尚在撰寫，故不列為本次缺漏。
