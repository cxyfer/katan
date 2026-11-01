# 電腦對手（Bot Opponents）：規格與實作計畫

日期：2026-11-01。狀態：**使用者已批准方向與四個決策點，進入實作（PR 1 → PR 2）。**

前置閱讀：`docs/SPEC.md` §2、§3（P-17）、§4.2、§4.6、§4.9、§5.8、§8.3；`docs/API.md`。權威需求以 SPEC §4.9 為準，本文件是設計與交付紀錄。ArchitectureReviewRequired: **yes**（新增套件、伺服器排程器、房間在場語意）。TDD Route: off；每個切片仍須補測並驗證。

## 1. 目標與範圍

讓房主在房間內加入電腦對手席位，沒有朋友時也能開局。Bot 完全在服務內以本地規則策略決策，不呼叫 LLM、網路或任何外部服務。

P1 範圍內：

- 建房時可預先加入 N 個 Bot（捷徑）；大廳中房主可「加入電腦」與「移除電腦」。
- 兩種難度：`easy`、`standard`（預設）。
- Bot 自動完成初始放置、擲骰、建造、買／打發展卡、棄牌、移動強盜、偷牌、豐收之年、免費道路、銀行／港口交易、回應報價、主動提出國內報價（附收集窗與逾時）、結束回合。
- 支援目前啟用的 profile：`base-2025`（3–4 人）與 `base-paired-2025`（5–6 人；Player 2 不擲骰、不可發起或結算國內交易）。
- 座位、大廳與遊戲中玩家面板顯示「電腦」徽章與難度。

P1 範圍外：斷線托管（§9 只設計）、hard 難度、Bot 聊天、房間層級節奏設定、開局後增減 Bot、Bot 的反報價（counteroffer）、以事件紀錄推算對手手牌、目前停用的 Seafarers／C&K profile。

## 2. 已定案決策

| # | 決策 | 定案 | 理由 |
|---|---|---|---|
| D1 | 實作位置 | 伺服器內建；Bot 只透過 `GameCoordinator.submit` 送指令 | 冪等收據、交易式存檔、重啟恢復、推送全部沿用 |
| D2 | 資訊 | 只看自己座位的 `GameView`（含 hints）＋公開拓樸與規則常數 | 公平；不破 SPEC §8.3 |
| D3 | 外部依賴 | 無；`packages/bots` 只依賴 `@catan/rules` | 使用者要求 |
| D4 | 加入方式 | 大廳增減＋建房捷徑 | 調低容量、讓位給朋友都能在大廳處理 |
| D5 | 國內交易 | 回應報價＋銀行／港口＋主動開價（收集窗＋逾時） | 使用者選擇；讓真人有可交易的對手 |
| D6 | 難度 | `easy`＋`standard` | hard 需要自建推演模擬器，延後 |
| D7 | 節奏 | 伺服器預設、依動作調整；`BOT_DELAY_SCALE` 整體縮放 | 不新增房間設定 |
| D8 | 公開房 | 允許；房間列表顯示 Bot 數 | 沒有禁止的必要 |
| D9 | 上限 | 每房 Bot ≤ capacity − 1 | 房主一定是真人 |
| D10 | 托管欄位 | P1 不預留 | `policyOf` 以 `DEFAULT_POLICY` 合併，日後加欄位天然相容 |

## 3. 不變式

| ID | 不變式 | 守護方式 |
|---|---|---|
| I1 | Bot 只能經 `GameCoordinator.submit` 改變遊戲 | 程式結構；B-RACE |
| I2 | 策略輸入只有 `projectGame(state, botId, { hints })` 的結果與 `BotContext`，型別上拿不到 `GameState` | `BotPolicy` 介面；B-FAIR |
| I3 | `packages/rules` 的規則、`GameState`、事件與錯誤碼不變 | 既有 rules 測試全綠 |
| I4 | Bot 無可用登入憑證、不能成為房主、沒有 socket | `token_hash` 哨兵值；B-ROOM |
| I5 | 每局同一時間最多一個 Bot 指令在飛 | BotDriver `inFlight`；B-LIFE |
| I6 | 決策決定性：同一 view＋context → 同一指令 | 種子由 `gameId:botId:revision:attempt` 推導；B-POLICY |
| I7 | 不呼叫網路／LLM／模型檔；`packages/bots` 無 `node:` 匯入、無 `fetch`、`process`、`Date`、`Math.random` | B-GUARD 原始碼掃描 |
| I8 | 沒有任何真人 live socket 時，Bot 不推進遊戲 | BotDriver 閘門；B-LIFE |
| I9 | Bot 永不讓整局卡死：策略失敗 → 保底策略；保底失敗 → 記錄並退避重試 | B-POLICY；B-LIFE |

## 4. 架構

```text
真人 ──HTTP/WS──┐
                ├─> GameCoordinator.submit ─> applyCommand ─> 交易式存檔 ─> publish
BotDriver ──────┘          │
   ▲                       └─ onCommitted(gameId, roomId, events)
   │ kick(gameId)  ← 開局、恢復、真人連線、指令寫入、報價計時器、退避計時器
   └─ view = projectGame(state, botId, { hints }) → policy.decide(view, ctx) → Command
```

| 位置 | 內容 | PR |
|---|---|---|
| `packages/bots`（新） | `BotPolicy` 合約、`standard`／`easy` 策略、保底策略、種子、完整對局測試、bench | 1 |
| `Dockerfile` | 依賴層加入 `COPY packages/bots/package.json packages/bots/` | 1 |
| `packages/protocol` | `BotLevel`、`RoomMemberView.bot`／`botLevel`、`RoomSummaryView.botCount`、新錯誤碼 | 2 |
| `packages/server/src/db.ts` | migration `0002_bots`、`GuestRow.kind`／`bot_level`、孤兒 Bot 清理 | 2 |
| `packages/server/src/rooms.ts` | 增減 Bot、`isBotMember()` 例外（§7.3） | 2 |
| `packages/server/src/game.ts` | `onCommitted` 回呼；暫停／恢復／放棄的 Bot 例外 | 2 |
| `packages/server/src/bot-driver.ts`（新） | 排程、節奏、閘門、報價計時、失敗處理 | 2 |
| `packages/server/src/http.ts`、`config.ts`、`main.ts` | 路由、設定、組裝 | 2 |
| `packages/web` | 建房捷徑、大廳增減、徽章、i18n | 2 |
| `docs/API.md`、`docs/OPERATIONS.md` | 新端點與設定 | 2 |

## 5. `@catan/bots` 合約

```ts
export type BotLevel = 'easy' | 'standard';
export const BOT_LEVELS: readonly BotLevel[];

/** 排程器觀察到的、Bot 自己開出且仍 open 的報價階段。 */
export type OfferPhase = 'collecting' | 'ready' | 'expired';

export interface BotContext {
  selfId: string;   // 這個策略代表的座位，view 即此座位的投影
  level: BotLevel;
  seed: number;     // 32-bit 無號整數，由 botSeed(gameId, botId, revision, attempt) 推導
  offerPhases: Readonly<Record<string, OfferPhase>>; // 缺漏的 offerId 一律視為 'expired'
}

export interface BotPolicy {
  /** 回傳 selfId 此刻該送的指令；此刻無事可做回傳 null。 */
  decide(view: GameView, ctx: BotContext): Command | null;
}

export function createBotPolicy(level: BotLevel): BotPolicy;
export const fallbackPolicy: BotPolicy;
export function botSeed(...parts: (string | number)[]): number;
```

規則：

1. `decide` 是純函式：不讀時間與環境、不持有跨呼叫狀態；隨機性只來自 `seededRng(ctx.seed)`。排程器仍會攔截例外，但策略不應拋出。
2. 可用資訊：`view`、`getTopology(view.board.topologyId)`、`requireProfile(view.profileId)`、`COSTS`、`RESOURCES` 等常數。不得接收或建構 `GameState` 來取得隱藏資訊。
3. 非行動者（`selfId !== view.turn.playerId`）只在兩種情況回傳指令：自己欠的待決效果（棄牌等）；收件人包含自己、仍 open、且自己尚未回應的報價。
4. 行動者在 `action` 階段無事可做時必須回傳 `turn.end`。唯一允許回傳 `null` 的情況是自己仍有 open 報價在等回應。排程器把「行動者沒有 open 報價卻回傳 null」視為策略失敗。
5. `hints.legalSettlements`／`legalRoads` 只代表位置合法，不代表付得起；策略要用 `COSTS` 與自己的 `resources` 檢查，也要檢查剩餘棋子數（以盤面計數對照 profile 的 pieces）。
6. 報價回應只用 `consented` 或 `declined`；回應過的報價（`responses[selfId]` 有值）不再回應，報價被 revise 後才重新評估。
7. 保底策略 `fallbackPolicy` 只做必定合法的最小動作，非強制的事一律不做（回傳 null）：

| 情況 | 保底動作 |
|---|---|
| 自己要棄牌 | 依 `RESOURCES` 順序丟出應棄張數 |
| 自己要移動強盜 | 第一個非目前強盜格、非海洋的格子 |
| 自己要偷牌 | `candidates[0]` |
| 豐收之年 | 銀行仍有存量的第一種資源 |
| 免費道路 | `hints.legalRoads[0]` |
| 初始放置 | `hints.legalSettlements[0]`／`hints.legalRoads[0]` |
| `preroll` | `turn.roll` |
| `action` | `turn.end` |

報價階段由排程器以真實時間推導，策略只看階段：

| 階段 | 進入條件（預設值） | 策略行為 |
|---|---|---|
| `collecting` | 開價後未滿 6 秒 | 所有應回應者都已回應才結算或撤回；否則等待 |
| `ready` | 6 秒至未滿 20 秒 | 有人同意 → 與最佳同意者結算；全部拒絕 → 撤回；否則等待 |
| `expired` | 20 秒以上，或排程器沒有紀錄（例如重啟後） | 有人同意 → 結算；否則撤回 |

開價限制：每個行動視窗（`view.windowId`）最多主動開價 2 次；同一視窗不重複相同條件；paired Player 2 不開價、不結算國內交易。

## 6. 策略

共用評估：

- 點數權重 pips(n) = 6 − |7 − n|（2 與 12 為 1，6 與 8 為 5）。
- 產能：自己每種資源的期望產量（建築相鄰格 pips × 聚落 1／城市 2；強盜所在格不計）。
- 目標建造：計算城市、聚落、發展卡、道路各自還缺幾張，取「缺口最小且有意義」者為當前目標；聚落需要有可達空點，道路需要通往目標空點。
- 資源價值：目標缺口內的資源價值高；過剩資源價值低；能以 2:1／3:1 港口賣出的資源價值下修。

| 窗口 | standard |
|---|---|
| 初始放置 | 頂點分 = Σ 相鄰格 pips × 資源權重 ＋ 資源多樣性加分 ＋ 港口加分（自己會產該資源時）。第二座聚落偏好補足第一座缺的資源，特別是磚與木。道路朝距離 2 的最佳空點。 |
| 擲骰前 | 持有可打的騎士，且強盜在自己的產能格上，或打出後可取得或保住最大騎士團 → 先打騎士；否則擲骰。 |
| 建造順序 | 城市（付得起且有聚落）→ 聚落（付得起且有合法點）→ 道路（有可達目標空點且付得起）→ 發展卡（付得起、牌庫非空、且短期內蓋不了城市與聚落）。 |
| 發展卡 | 騎士見上；壟斷選「自己需要且對手產能最高」的資源；豐收補當前目標缺口；道路建設在有目標路線時使用。 |
| 銀行／港口 | 只在換完後「這個回合就能完成目標建造」時進行，且不賣掉目標需要的資源。 |
| 主動開價 | 只在銀行／港口補不到、且只缺 1–2 張即可完成目標時，對全桌提出 1:1（必要時 2:1）報價；遵守 §5 的開價限制。 |
| 回應報價 | 交易後距目標的缺口變小，或資源總價值上升 → 同意；對方公開分數 ≥ 勝利分 − 2 → 拒絕；其餘拒絕。 |
| 結算 | 同意者中選擇讓自己資源價值最高者；同分時選公開分數最低者。 |
| 棄牌 | 保留最接近目標的組合，先丟過剩資源。 |
| 強盜 | 格分 = Σ 對手建築 pips ×（城市 2）× 領先者加權 − 自己建築的懲罰；優先選至少有一位可偷對象的格子。偷牌選手牌最多者，同數比公開分數。 |
| 免費道路 | 朝最佳可蓋點，其次延長最長路。 |

easy：使用同一套評估，但在前 3 名候選中隨機選擇；不主動開價；擲骰前只在強盜壓在自己格子時才打騎士；接受報價需要更明顯的利益。

## 7. 伺服器整合（PR 2）

### 7.1 資料模型

```sql
-- 0002_bots
ALTER TABLE guests ADD COLUMN kind TEXT NOT NULL DEFAULT 'human';  -- 'human' | 'bot'
ALTER TABLE guests ADD COLUMN bot_level TEXT;                      -- 只有 bot 有值
```

- Bot 是 `guests` 的一列：`id = newId('bot')`、`token_hash = 'bot:' + id`（登入比對的是 64 字元 SHA-256，永遠不會命中）、`nickname` 取自固定名稱池且同房不重複、`locale = 'en'`。
- `findGuestByTokenHash` 額外過濾 `kind = 'human'`，作為縱深防禦。
- membership 照常插入：`seat` 取最小空位、`color` 取第一個未使用顏色、`ready = 1`、`connected = 1`。但讀取時一律由 `kind` 推導（§7.3），不依賴這兩個旗標。
- 在大廳移除 Bot 時同時刪除它的 guest 列；房間被刪除後殘留的 Bot guest，由既有清理週期刪除（`kind = 'bot'` 且沒有任何 membership）。

### 7.2 API

| 方法 | 路徑 | 請求 | 回應 | 錯誤 |
|---|---|---|---|---|
| POST | `/api/rooms` | 既有欄位＋`bots?: number`、`botLevel?: BotLevel` | `RoomView` | `E_INVALID_BOT`（非整數、小於 0、大於 capacity − 1、等級不明）、`E_BOTS_DISABLED` |
| POST | `/api/rooms/:roomId/bots` | `{ level?: BotLevel }` | `RoomView` | `E_NOT_HOST`、`E_ROOM_STARTED`、`E_ROOM_FULL`、`E_INVALID_BOT`、`E_BOTS_DISABLED` |
| DELETE | `/api/rooms/:roomId/bots/:playerId` | – | `RoomView` | `E_NOT_HOST`、`E_ROOM_STARTED`、`E_NOT_A_BOT` |

- 全部在 room lock 內執行；增減 Bot 會清除真人 ready（與其他設定變更一致）並廣播。
- 新錯誤碼 `error.E_BOTS_DISABLED`、`error.E_INVALID_BOT`、`error.E_NOT_A_BOT`：加入 `SERVER_ERROR_IDS` 與兩份語系；`vocabulary.test.ts` 會檢查兩邊一致。
- 設定：`BOTS_ENABLED`（預設 `1`）、`BOT_DELAY_SCALE`（預設 `1`；`0` 代表不延遲，供測試；上限 `5`）。

### 7.3 在場語意例外（集中於 `isBotMember()`）

| 路徑 | 現況 | Bot 規則 |
|---|---|---|
| `view()` 成員 ready／connected | 讀 DB 旗標 | Bot 一律 `ready = true`、`connected = true`，並帶 `bot: true`、`botLevel` |
| `startBlockers`／`startLocked` | 全員 ready 且連線 | 由上列推導，Bot 永遠不擋開局 |
| `clearReadiness` | 清所有人 | 跳過 Bot |
| `transferHost`／`ensureHost` | 最早加入且連線者 | 只考慮真人 |
| 大廳 `leave` | 最後一人離開才刪房 | 剩下的成員全是 Bot → 刪房（含 Bot guest） |
| `tryApplySuspend` | 每個 membership 同意 | 只需真人同意 |
| `setResumeReady` | 全員連線＋ready | 只等真人 |
| 放棄的缺席條件 | 任一成員缺席或退出 | 只看真人；另加「其他席位全是 Bot」時唯一真人可直接放棄 |
| 放棄投票者 | 所有連線成員 | 只算連線中的真人 |
| 開局後 policy 提案 | 每個 membership 同意 | 只需真人同意 |
| `sweepStaleLobbies` | 看 live socket | 不變（Bot 沒有 socket） |
| `publish`／廣播 | 連線中的座位 | 不變 |
| 房間列表 `summaries` | `playerCount` | 另加 `botCount` |

### 7.4 BotDriver

- **喚醒點**：`onCommitted`（每次指令成功寫入後）、開局成功、恢復成功、真人 socket 註冊、報價階段邊界計時器、失敗退避計時器。
- **閘門**：計時器觸發時再檢查一次——房間 `status === 'playing'`、遊戲沒有結果、房內至少一位真人有 live socket（`rooms.connectionsInRoom`）。
- **選擇**：讀最新狀態 → 先依座位詢問非行動者 Bot，最後詢問行動者 Bot，取第一個非 null 的指令。
- **節奏**（毫秒，乘以 `BOT_DELAY_SCALE`）：

| 指令 | 延遲 | 指令 | 延遲 |
|---|---|---|---|
| `setup.placeBuilding` | 900 | `setup.placeRoad` | 600 |
| `turn.roll` | 900 | `build.*` | 900 |
| `dev.*` | 1100 | `trade.bank` | 800 |
| `trade.offer` | 1200 | `trade.respond` | 700 |
| `trade.settle` | 800 | `trade.withdraw` | 600 |
| `pending.discard` | 900 | `pending.moveRobber` | 1200 |
| `pending.steal` | 800 | `pending.takeResource` | 700 |
| `turn.end` | 900 | 上一筆寫入含 `turn.rolled` | 距該寫入至少 2800（骰子演出 2.5 秒） |

- **送出**：計時器觸發時若 revision 已變 → 丟棄並重新選擇；否則呼叫 `submit(botId, gameId, { commandId: 'bot:' + revision + ':' + attempt, expectedRevision: revision, command })`。同一 revision 與 attempt 重送會拿到原收據（冪等）。
- **失敗處理**：`E_STALE_REVISION` → 重新選擇；其他拒絕或策略拋錯 → 同一 revision 改用 `fallbackPolicy`（attempt + 1）；保底也被拒 → `warn` 記錄（含 messageId），30 秒後重試，不進入熱迴圈。
- **報價計時**：記錄 Bot 報價被寫入的時間；未滿 6 秒為 `collecting`，未滿 20 秒為 `ready`，之後為 `expired`。有 open 報價時，在下一個階段邊界排計時器；重啟後沒有紀錄的報價視為 `expired`。
- **生命週期**：遊戲結束、放棄、暫停與 `close()` 時清除計時器；同局以 `inFlight` 序列化。
- 鎖：BotDriver 只在計時器回呼中呼叫公開的 `submit`，絕不在 `withLock` 內 await 另一個鎖定方法。

## 8. 協定與前端（PR 2）

- `RoomMemberView`：`bot: boolean`、`botLevel?: BotLevel`。
- `RoomSummaryView`：`botCount: number`。
- `ResumableGameView.players[]`：`bot?: boolean`。
- `ServerConfigView`：`bots: { enabled: boolean; levels: BotLevel[] }`；`BOTS_ENABLED=0` 時前端隱藏所有 Bot 選項。
- `BotLevel` 在 protocol 與 `@catan/bots` 各自定義（線上詞彙與策略實作分離）；伺服器以型別檢查確保兩者一致。
- 建房表單：「電腦對手」數量（0 至 capacity − 1）與難度。
- 大廳：房主看到「加入電腦」（含難度選擇）與每個 Bot 的「移除」；Bot 座位顯示徽章「電腦・標準」或「電腦・簡單」，不顯示 ready 切換。
- 遊戲中：玩家面板以房間成員的 `bot` 欄位顯示徽章（`GameView` 不改）。
- i18n：`zh-Hant` 與 `en` 同步新增，parity 測試須通過。

## 9. 托管（P3，只設計不實作）

- 房間 policy 新增 `botTakeover: 'off' | 'afterGrace'`（預設 `off`）；開局前由房主設定，開局後依 SPEC §5.8 全員同意。
- 只有在席位斷線超過 `disconnectGraceSeconds`，或玩家明確 withdraw 後才接管；連線中的真人永不被接管；真人重連立即交還。
- 新增 `memberships.controller`（`human | bot`）與稽核欄位；Bot 以該真人的 player id 送指令，規則與投影不變。
- UI 明確標示「電腦托管中」並發 system 訊息，不得悄悄取代（SPEC §4.3）。

## 10. 測試與驗收

| 家族 | 位置 | 內容 |
|---|---|---|
| B-POLICY | bots | 多種子完整對局中，每個 `decide` 輸出都被 `applyCommand` 接受（standard／easy／fallback 混合；3、4、5、6 人）；同一 view＋context 結果一致；`decide` 不拋錯 |
| B-GAME | bots | Bot 對 Bot 完整對局在步數上限內結束且有勝者；資源守恆；沒有卡住的 pending |
| B-FAIR | bots | 兩個只差在隱藏資訊（對手手牌組成、牌庫順序）的狀態投影相同 → 決策相同 |
| B-GUARD | bots | 原始碼掃描：只匯入 `@catan/rules` 與相對路徑；沒有 `node:`、`fetch`、`process`、`Date`、`Math.random` |
| B-BENCH | bots | `pnpm --filter @catan/bots bench`：勝率、平均回合數、平均決策耗時（不進 CI） |
| B-ROOM | server | 建房帶 Bot、大廳增減、容量／權限／錯誤碼、Bot 不當房主、全 Bot 大廳刪房、清除 ready 不影響 Bot |
| B-LIFE | server | 開局後 Bot 自動推進；無真人 socket 時暫停；真人重連後續行；暫停／恢復；重啟後續玩；放棄（含單人規則）；關閉時清除計時器 |
| B-RACE | server | 真人與 Bot 在同一 revision 送出：只有一個 accepted，另一個 stale，且不重複套用 |
| B-WEB | web | 建房表單、大廳按鈕與徽章、i18n parity |

完成閘門：`pnpm verify` 全綠；B-GAME 涵蓋 3、4、5、6 人各至少 10 個種子；Docker 依賴層可以建置。

模擬時間：bots 測試 harness 以步數模擬報價階段——報價建立後，其他座位各輪一次前為 `collecting`，之後為 `ready`，再一輪後為 `expired`。

## 11. 交付切片與分工

- **PR 1 `feat/bot-policy`**（`.worktrees/bot-policy`）：本規格、SPEC 修訂、INDEX、`packages/bots`、Dockerfile。使用者可見行為不變。
- **PR 2 `feat/bot-seats`**（`.worktrees/bot-seats`，stacked on PR 1）：§7、§8，以及 `docs/API.md`、`docs/OPERATIONS.md`。
- 主 agent：Git 操作、lockfile 與依賴、共用契約（`packages/bots/src/types.ts`、保底策略、protocol 型別與錯誤碼）、整合與最終驗證。
- Agent A：`packages/bots` 的策略、測試與 bench；只改 `packages/bots/**`。
- Agent B：伺服器整合；只改 `packages/server/**`、`docs/API.md`、`docs/OPERATIONS.md`。
- Agent C：前端；只改 `packages/web/**`。
- Subagent 不做 git commit／push，不改 lockfile 與其他 agent 負責的檔案；契約有疑義時回報主 agent，不自行改契約。

## 12. 風險

1. 交易品質決定樂趣：先求「會交易、不吃虧、不洗版」，強度靠 bench 迭代。
2. 公平 Bot 的強度上限較低：不偷看是刻意的取捨。
3. 單一實例假設（SPEC D-05）：排程器在程序內，與現有架構一致。
4. paired 規則：Player 2 不擲骰、不做國內交易；B-POLICY 必須覆蓋 5、6 人。
5. 事件迴圈：策略為啟發式，單次決策應在數毫秒內完成；bench 監測平均與最大耗時。
6. 既有引擎邊界（不在本次範圍）：`playYearOfPlenty` 不檢查銀行存量，銀行總存量不足 2 張時 `yearOfPlenty` 待決效果無法完成，人類與 Bot 都會卡住。策略應避免在銀行存量不足時打出豐收之年；引擎修正另案處理。

## 附錄：v1 草案審查結論

| # | 問題 | 處置 |
|---|---|---|
| A | SPEC §2 把 AI 對手與托管列為非目標，§4.3 禁止悄悄以 AI 取代 | 已修訂 SPEC §2、§3、§4.2、§4.3、§4.6、§4.9、§5.8、§6.2、§8.3 |
| B | 排程器只在寫入後喚醒，Bot 開價無人回應會卡死 | 報價階段計時器（§5、§7.4） |
| C | 「同 revision 被拒 3 次就停止」會讓整局永久卡住 | 保底策略＋退避重試（I9） |
| D | 單人對 Bot 時無法放棄（`E_NO_ABSENT_PLAYER`） | 「其他席位全是 Bot」時可直接放棄（§7.3） |
| E | `clearReadiness` 會清掉 Bot 的 ready；開局後 policy 同意漏列 | ready／connected 由 `kind` 推導；policy 只需真人同意 |
| F | 大廳房主離開後只剩 Bot，房主會被轉給 Bot | 只剩 Bot 即刪房；房主只轉給真人 |
| G | 只在建房時指定 Bot 數會與容量調整、朋友加入衝突 | 大廳增減＋建房捷徑（D4） |
| H | 喚醒點不只有指令寫入；DB `connected` 在重啟後可能是舊值 | `kick` 多來源；閘門看 live socket |
| I | `pending.takeResource` 對應 `yearOfPlenty`；hints 不檢查資源；hard 推演成本高 | 合約規則 5；hard 延後 |
| J | 托管欄位不需要預留 | D10 |
| K | 固定延遲會與骰子演出衝突 | 依指令的節奏表（§7.4） |
| L | `rules/test/simulate.ts` 已有自動對局骨架 | bots 測試沿用其做法 |
| M | `Dockerfile` 逐一 COPY 各套件 `package.json` | PR 1 加入 `packages/bots` |
| N | `base-paired-2025`（5–6 人）目前啟用 | 策略支援 paired 規則，測試涵蓋 5、6 人 |
